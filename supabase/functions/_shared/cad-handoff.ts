import { DESIGN_HANDOFF_SCHEMA, parseDesignHandoff, type DesignHandoff } from './cad-review.ts'
import { fingerprint } from './bob-job-journal.ts'

type Requirement = DesignHandoff['requirements'][number]
type RequirementInput = Omit<Requirement, 'id'>
const { id: _id, ...requirementProperties } = DESIGN_HANDOFF_SCHEMA.properties.requirements.items.properties
export const HANDOFF_INPUT_SCHEMA = {
  ...DESIGN_HANDOFF_SCHEMA,
  properties: { ...DESIGN_HANDOFF_SCHEMA.properties, requirements: {
    ...DESIGN_HANDOFF_SCHEMA.properties.requirements,
    items: { type: 'object', additionalProperties: false, properties: requirementProperties, required: Object.keys(requirementProperties) },
  } },
}
export const REQUIREMENT_CHANGES_SCHEMA = {
  type: 'array', maxItems: 24, description: 'Explicit changes to a saved request only. Empty to resume. Copy requirement_id from the saved handoff to update it; null only for a genuinely new requirement. Never invent an ID. Earlier requirements are retained.',
  items: { type: 'object', additionalProperties: false,
    properties: { requirement_id: { type: ['string', 'null'], maxLength: 40 }, ...requirementProperties },
    required: ['requirement_id', ...Object.keys(requirementProperties)],
  },
}
const identity = (r: RequirementInput) => [r.requirement.trim().replace(/\s+/g, ' '), r.basis, r.source_ref]
/** Content identities are deterministic across worker replays. Only the server
 * allocates them; IDs from older pinned model contracts are never allocations. */
export async function requirementId(r: RequirementInput): Promise<string> {
  return 'req_' + (await fingerprint(identity(r))).slice(0, 32)
}
function parseInput(value: unknown): DesignHandoff | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = structuredClone(value) as any
  if (!Array.isArray(v.requirements)) return null
  for (const [index, r] of v.requirements.entries()) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null
    // Only the historical exact ID-bearing format is accepted for compatibility.
    if ('id' in r && typeof r.id !== 'string') return null
    if ('id' in r && !/^[a-zA-Z0-9_-]{1,40}$/.test(r.id)) return null
    r.id = 'input_' + index
  }
  return parseDesignHandoff(v)
}
export type PreparedHandoff = { handoff: DesignHandoff; ignored_legacy_ids: string[] } | { reason: string }
export async function prepareDesignHandoff(value: unknown, previous: DesignHandoff | null = null, changes: unknown = [], immutable = false): Promise<PreparedHandoff> {
  if (!Array.isArray(changes) || changes.length > 24) return { reason: 'invalid_requirement_changes' }
  let handoff: DesignHandoff
  const ignored: string[] = []
  if (previous) {
    handoff = structuredClone(previous)
    if (value !== null) {
      // Old pinned jobs resend a complete handoff. Saved identity wins: an
      // unknown old model ID must never append another copy of an existing need.
      const legacy = parseDesignHandoff(value)
      if (!legacy) return { reason: 'saved_handoff_required' }
      handoff = { ...legacy, requirements: structuredClone(previous.requirements) }
      for (const r of legacy.requirements) {
        const index = handoff.requirements.findIndex(old => old.id === r.id)
        if (index < 0) ignored.push(r.id)
        else if (!immutable) handoff.requirements[index] = r
      }
    }
  } else {
    if (changes.length) return { reason: 'saved_request_required' }
    const input = parseInput(value)
    if (!input) return { reason: 'invalid_handoff' }
    handoff = { ...input, requirements: [] }
    for (const r of input.requirements) {
      const id = await requirementId(r)
      if (!handoff.requirements.some(old => old.id === id)) handoff.requirements.push({ ...r, id })
    }
  }
  const updated = new Set<string>()
  for (const change of changes) {
    if (!change || typeof change !== 'object' || Array.isArray(change)
      || Object.keys(change).sort().join(',') !== 'basis,requirement,requirement_id,source_ref') return { reason: 'invalid_requirement_changes' }
    const { requirement_id, ...r } = change
    // Use the strict stored validator for all prose, provenance and field limits.
    if (!parseDesignHandoff({ ...handoff, requirements: [{ ...r, id: 'validation' }] })) return { reason: 'invalid_requirement_changes' }
    if (requirement_id !== null) {
      if (typeof requirement_id !== 'string' || updated.has(requirement_id)) return { reason: 'invalid_requirement_changes' }
      const index = handoff.requirements.findIndex(old => old.id === requirement_id)
      if (index < 0) return { reason: 'unknown_requirement_id' }
      if (immutable) return { reason: 'restored_requirements_immutable' }
      handoff.requirements[index] = { ...r, id: requirement_id }
      updated.add(requirement_id)
    } else {
      // Exact repeated additions reuse even a historical saved ID.
      const same = handoff.requirements.find(old => JSON.stringify(identity(old)) === JSON.stringify(identity(r)))
      if (!same) handoff.requirements.push({ ...r, id: await requirementId(r) })
    }
  }
  if (handoff.requirements.length > 24) return { reason: 'drawing_requirement_limit' }
  const valid = parseDesignHandoff(handoff)
  return valid ? { handoff: valid, ignored_legacy_ids: ignored } : { reason: 'invalid_handoff' }
}
