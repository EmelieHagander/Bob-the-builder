// Owner decision 2026-11-07: "Konrad får inte bestämma vilken version … dom
// ska alltid få senaste versionen." No model types a revision number. Each
// field below is removed from the schema the model sees; the server fills it
// from the database (catalog items, measurements, constructions, the plan,
// the selected target) or, for records without a current reader, from the
// newest revision the model read in this turn. A value the model sends anyway
// is dropped. Pinned per job (server_revisions_version 1).

export type RevisionResolver = 'memory' | 'catalog' | 'measurement' | 'space_measurement' | 'construction' | 'plan' | 'proposal' | 'target' | 'profile'
/** path is relative to the arguments; '*' is every item of an array. id and
 * area name sibling keys of the field; when set, kind must equal the
 * sibling `kind`. A null id gives `create` (or null). */
export type RevisionRule = { path: string[]; resolver: RevisionResolver; id?: string[]; area?: string[]; kind?: string; create?: number }
type Rules = Record<string, RevisionRule[]>

const rule = (path: string, resolver: RevisionResolver, extra: Omit<RevisionRule, 'path' | 'resolver'> = {}): RevisionRule => ({ path: path.split('.'), resolver, ...extra })
const sources = (prefix: string): RevisionRule[] => [
  rule(prefix + '.source.revision', 'measurement', { id: ['id'], kind: 'project_measurement' }),
  rule(prefix + '.source.space_revision', 'space_measurement', { id: ['id'], kind: 'space_measurement' }),
]
const materials = (prefix: string): RevisionRule[] => [
  rule(prefix + '.material_revision', 'catalog', { id: ['material_id'] }),
  rule(prefix + '.part_revision', 'catalog', { id: ['part_id'] }),
]
const construction = rule('expected_revision', 'construction', { id: ['record_id'], create: 0 })

export const SERVER_REVISIONS: Rules = {
  // Konrad
  save_construction_draft: [construction, ...materials('materials.*'), rule('joints.*.fasteners.*.material_revision', 'catalog', { id: ['material_id'] }),
    rule('joint_rules.*.fasteners.*.material_revision', 'catalog', { id: ['material_id'] }), ...sources('parameter_plan.nodes.*')],
  edit_construction_parts: [construction, ...materials('changes.materials.upsert.*'), rule('changes.joints.upsert.*.fasteners.*.material_revision', 'catalog', { id: ['material_id'] }),
    rule('joint_rules.*.fasteners.*.material_revision', 'catalog', { id: ['material_id'] }), ...sources('changes.nodes.upsert.*')],
  change_construction_parameters: [construction, ...sources('changes.*')],
  change_construction_roles: [construction],
  calculate_project: [...sources('calculation.nodes.*'), rule('calculation.needs.*.revision', 'memory', { id: ['id'] }),
    rule('calculation.article_revision', 'memory', { id: ['article_id'] }), rule('calculation.plan_revision', 'memory', { id: ['plan_id'] }),
    rule('calculation.revision', 'memory', { id: ['record_id', 'requirement_id'] })],
  check_construction_cut_fit: [rule('candidates.*.material_revision', 'catalog', { id: ['material_id'] })],
  save_construction_cut_plan: [rule('candidates.*.material_revision', 'catalog', { id: ['material_id'] }),
    rule('candidate_sources.*.revision', 'memory', { id: ['record_id'] })],
  // Bob
  archive_project_measurement: [rule('expected_revision', 'measurement', { id: ['record_id'] })],
  save_project_measurement: [rule('expected_revision', 'measurement', { id: ['record_id'], create: 0 })],
  cancel_drawing_request: [rule('expected_revision', 'memory', { id: ['request_id'] })],
  restore_drawing_request: [rule('expected_revision', 'memory', { id: ['request_id'] }), rule('plan_revision', 'plan')],
  ensure_drawing_gap_task: [rule('expected_revision', 'memory', { id: ['request_id'] }), rule('plan_revision', 'plan')],
  decide_project_plan: [rule('expected_revision', 'plan'), rule('proposal_revision', 'proposal')],
  propose_project_plan: [rule('expected_revision', 'plan')],
  link_project_plan_evidence: [rule('plan_revision', 'plan'), rule('evidence_revision', 'memory', { id: ['evidence_id'] })],
  link_project_plan_task: [rule('plan_revision', 'plan')],
  set_project_plan_focus: [rule('plan_revision', 'plan')],
  inspect_building_projection: [rule('expected_revision', 'memory', { id: ['record_id'] })],
  inspect_stair_options: [rule('plan_revision', 'memory', { id: ['plan_id'] })],
  manage_task_readiness: [rule('expected_revision', 'memory', { id: ['record_id'], create: 0 })],
  save_project_build_day: [rule('expected_revision', 'memory', { id: ['record_id'], create: 0 })],
  save_catalog_definition: [rule('expected_revision', 'catalog', { id: ['record_id'], create: 0 }), rule('profile_revision', 'profile', { id: ['profile_code'] }),
    rule('material_revision', 'catalog', { id: ['material_id'] })],
  save_project_building_plan: [rule('expected_revision', 'memory', { id: ['record_id'], create: 0 }), rule('target_revision', 'target', { area: ['create_area_id'] }),
    rule('recipe.building_revision', 'memory', { id: ['building_id'] }), rule('recipe.levels.*.level_revision', 'memory', { id: ['level_id'] }),
    rule('recipe.spaces.*.space_revision', 'memory', { id: ['space_id'] }), rule('measurements.*.revision', 'measurement', { id: ['id'] })],
  save_project_drawing: [rule('expected_revision', 'memory', { id: ['record_id'], create: 0 }), rule('target_revision', 'target', { area: ['create_area_id'] }),
    rule('measurements.*.revision', 'measurement', { id: ['id'] })],
  save_project_solution: [rule('expected_revision', 'memory', { id: ['record_id'], create: 0 }), rule('measurements.*.revision', 'measurement', { id: ['id'] })],
  save_project_stair: [rule('expected_revision', 'memory', { id: ['record_id'], create: 0 }), rule('plan_revision', 'memory', { id: ['plan_id'] })],
  select_project_target: [rule('expected_revision', 'target', { area: ['area_id'] }), rule('solution_revision', 'memory', { id: ['record_id'] })],
  create_project_room_layout: [rule('target_revision', 'target', { area: ['create_area_id'] }), rule('left_space_revision', 'memory', { id: ['left_space_id'] }),
    rule('right_space_revision', 'memory', { id: ['right_space_id'] }), rule('wall_element_revision', 'memory', { id: ['wall_element_id'] }),
    rule('furniture_revision', 'memory', { id: ['furniture_artifact_id'] }), rule('measurements.*.revision', 'measurement', { id: ['id'] })],
  edit_project_room_layout: [rule('expected_revision', 'memory', { id: ['record_id'] }), rule('target_revision', 'target')],
  save_building_context: [rule('expected_building_revision', 'memory', { id: ['building_id'], create: 0 }),
    rule('operations.*.expected_revision', 'memory', { id: ['record_id'], create: 0 }), rule('operations.*.fields.measurements.*.revision', 'memory', { id: ['id'] })],
}
/** Identity fields a worker job owns; a value the model sends is dropped
 * before the job binding checks the call, instead of refusing it. */
export const JOB_OWNED_FIELDS: Record<string, string[][]> = {
  derive_cad_material_requirement: [['data', 'artifact_id'], ['data', 'artifact_revision'], ['data', 'target_revision'], ['expected_revision']],
  save_construction_cut_plan: [['expected_revision'], ['requirements', '*', 'revision']],
  manage_project_material: [['expected_revision'], ['expected_updated_at']],
  save_construction_draft: [['expected_revision']], edit_construction_parts: [['expected_revision']],
  change_construction_parameters: [['expected_revision']], change_construction_roles: [['expected_revision']],
}

type Json = Record<string, any>
const object = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** The parents of a path's last key, with that key. */
function parents(root: unknown, path: string[]): Json[] {
  let nodes: unknown[] = [root]
  for (const key of path.slice(0, -1)) {
    const next: unknown[] = []
    for (const node of nodes) {
      if (key === '*') { if (Array.isArray(node)) next.push(...node) }
      else if (object(node) && key in node) next.push(node[key])
    }
    nodes = next
  }
  return nodes.filter(object)
}

/** The schema the model sees: every server-owned field removed. */
export function withoutServerRevisions<T extends { function: { name: string; parameters: any } }>(spec: T, rules: Rules = SERVER_REVISIONS): T {
  const own = rules[spec.function.name]
  if (!own?.length) return spec
  const out = structuredClone(spec)
  const strip = (schema: any, path: string[]): void => {
    if (!schema || typeof schema !== 'object') return
    for (const key of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(schema[key])) for (const s of schema[key]) strip(s, path)
    const [head, ...rest] = path
    if (head === '*') { if (schema.items) strip(schema.items, rest); return }
    if (!schema.properties || !(head in schema.properties)) return
    if (!rest.length) {
      delete schema.properties[head]
      if (Array.isArray(schema.required)) schema.required = schema.required.filter((k: string) => k !== head)
      return
    }
    strip(schema.properties[head], rest)
  }
  for (const r of own) strip(out.function.parameters, r.path)
  return out
}

/** Drop server-owned values the model sent anyway. */
export function stripServerRevisions(name: string, raw: unknown, rules: Rules = SERVER_REVISIONS, owned: Record<string, string[][]> = JOB_OWNED_FIELDS): unknown {
  const paths = [...(rules[name] ?? []).map(r => r.path), ...(owned[name] ?? [])]
  if (!paths.length || !object(raw)) return raw
  const out = structuredClone(raw)
  for (const path of paths) for (const parent of parents(out, path)) delete parent[path.at(-1)!]
  return out
}

export type RevisionReaders = {
  catalog?: (id: string) => Promise<number | null>
  measurement?: (id: string) => Promise<number | null>
  spaceMeasurement?: (id: string) => Promise<number | null>
  construction?: (id: string) => Promise<number | null>
  plan?: () => Promise<number | null>
  target?: (areaId: string | null) => Promise<number | null>
}

const ID_KEYS = ['id', 'record_id', 'recordId', 'artifact_id', 'request_id', 'plan_id', 'building_id', 'level_id', 'space_id', 'element_id', 'solution_id', 'item_id']
/** Revisions the model read in this turn: the newest per record id. */
export function createRevisionMemory() {
  const seen = new Map<string, number>()
  const note = (key: string, revision: unknown) => {
    if (Number.isSafeInteger(revision) && Number(revision) >= 0) seen.set(key, Math.max(seen.get(key) ?? 0, Number(revision)))
  }
  const visit = (node: unknown, depth: number): void => {
    if (depth > 12 || !node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const item of node.slice(0, 2000)) visit(item, depth + 1); return }
    const o = node as Json
    for (const key of ID_KEYS) if (typeof o[key] === 'string') { note(o[key], o.revision); note(o[key], o.current_revision) }
    if (typeof o.profile_code === 'string') note('profile:' + o.profile_code, o.profile_revision)
    if (o.status === 'proposed' && Number.isSafeInteger(o.revision)) note('proposal', o.revision)
    if (Number.isSafeInteger(o.proposal_revision)) note('proposal', o.proposal_revision)
    for (const value of Object.values(o)) if (value && typeof value === 'object') visit(value, depth + 1)
  }
  return {
    observe(name: string, result: unknown) {
      visit(result, 0)
      if (name === 'propose_project_plan' && object(result) && object(result.receipt)) note('proposal', result.receipt.revision)
    },
    get: (key: string) => seen.get(key) ?? null,
    exportState: () => [...seen],
    restoreState(state: unknown) {
      seen.clear()
      if (Array.isArray(state)) for (const row of state) if (Array.isArray(row) && typeof row[0] === 'string') note(row[0], row[1])
    },
  }
}
export type RevisionMemory = ReturnType<typeof createRevisionMemory>

/** Fill every server-owned revision of one call. */
export async function fillServerRevisions(name: string, raw: unknown, memory: RevisionMemory, readers: RevisionReaders, rules: Rules = SERVER_REVISIONS):
  Promise<{ args: unknown } | { error: Json }> {
  const own = rules[name]
  if (!own?.length || !object(raw)) return { args: raw }
  const args = structuredClone(raw)
  const unknown: string[] = []
  for (const r of own) {
    const field = r.path.at(-1)!
    for (const parent of parents(args, r.path)) {
      if (r.kind && parent.kind !== r.kind) continue
      const idKey = r.id?.find(k => k in parent)
      const id = idKey ? parent[idKey] : undefined
      if (r.id && (id === null || id === undefined)) { parent[field] = r.create ?? null; continue }
      const area = r.area ? (r.area.map(k => parent[k]).find(v => typeof v === 'string') ?? null) : null
      let value: number | null = null
      switch (r.resolver) {
        case 'memory': value = memory.get(String(id)); break
        case 'profile': value = memory.get('profile:' + String(id)); break
        case 'proposal': value = memory.get('proposal'); break
        case 'catalog': value = readers.catalog ? await readers.catalog(String(id)) : memory.get(String(id)); break
        case 'measurement': value = readers.measurement ? await readers.measurement(String(id)) : memory.get(String(id)); break
        case 'space_measurement': value = readers.spaceMeasurement ? await readers.spaceMeasurement(String(id)) : memory.get(String(id)); break
        case 'construction': value = readers.construction ? await readers.construction(String(id)) : memory.get(String(id)); break
        case 'plan': value = readers.plan ? await readers.plan() : null; break
        case 'target': value = readers.target ? await readers.target(area) : null; break
      }
      if (value === null) { unknown.push(r.path.join('.') + (id !== undefined ? ' (' + String(id) + ')' : '')); continue }
      parent[field] = value
    }
  }
  if (unknown.length) return { error: { status: 'invalid', reason: 'version_unknown', saved: false, validation: { code: 'version_unknown', fields: unknown.slice(0, 12) },
    message: 'Nothing changed. The server takes each version from the database or from what you read in this request; read these records first: ' + unknown.slice(0, 6).join(', ') + '.' } }
  return { args }
}

// Owner feedback 2026-11-07 ("stoppa felloopar"): the same refused call must
// not run again, and a third refusal for the same reason asks for another
// approach. Since 2026-10-25 one requirement write was refused 18 times for
// one reason; on 2026-11-07 Konrad sent the same edit with the same wrong
// target four times. Refusals that depend on the project's state (read
// first, a changed source) may succeed after a read and are only counted.
const STATEFUL = new Set(['version_unknown', 'operation_reference_required', 'operation_reference_changed', 'operation_scope_changed',
  'operation_source_required', 'target_revision_required', 'construction_sources_changed', 'sketch_base_differs', 'key_already_saved',
  'plan_required', 'construction_changed', 'design_target_required'])
const REFUSED = new Set(['invalid', 'conflict', 'needs_data'])
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable((value as Json)[k])).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
const fnv = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16) }
export function createRefusalGuard() {
  const refused = new Map<string, string>(), reasons = new Map<string, number>()
  const reasonOf = (result: Json) => String(result.reason ?? result.validation?.code ?? result.status)
  return {
    /** A refusal to return instead of running the call, or null. */
    before(name: string, args: unknown): Json | null {
      const earlier = refused.get(name + ':' + fnv(stable(args)))
      return earlier ? { status: 'invalid', reason: 'repeated_refusal', saved: false, refused_before: earlier,
        message: 'Not run: this exact call was refused earlier in this request (' + earlier + '). Change what the refusal names, or take another approach.' } : null
    },
    after(name: string, args: unknown, result: unknown): unknown {
      if (!object(result) || !REFUSED.has(String(result.status))) return result
      const reason = reasonOf(result)
      if (!STATEFUL.has(reason) && result.status === 'invalid') refused.set(name + ':' + fnv(stable(args)), reason)
      const count = (reasons.get(name + ':' + reason) ?? 0) + 1
      reasons.set(name + ':' + reason, count)
      return count >= 3 ? { ...result, repeated: { count, reason,
        note: 'Refused ' + count + ' times for the same reason in this request. Do not repeat the same fix: read what the refusal names, use another tool, or report the blocker.' } } : result
    },
    exportState: () => ({ refused: [...refused], reasons: [...reasons] }),
    restoreState(state: unknown) {
      refused.clear(); reasons.clear()
      const s = state as { refused?: unknown; reasons?: unknown } | null
      if (Array.isArray(s?.refused)) for (const r of s!.refused as unknown[]) if (Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string') refused.set(r[0], r[1])
      if (Array.isArray(s?.reasons)) for (const r of s!.reasons as unknown[]) if (Array.isArray(r) && typeof r[0] === 'string' && Number.isSafeInteger(r[1])) reasons.set(r[0], r[1] as number)
    },
  }
}
