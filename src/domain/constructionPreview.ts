import { constructionInstancePolicy } from '../../supabase/functions/_shared/construction-instance-policy.ts'
import { constructionLists } from '../../supabase/functions/_shared/construction-lists.ts'
import type { ConstructionFasteners, ConstructionPreparationSource } from '../data/buildPreparation'

export interface PreliminaryPart {
  definitionId: string
  materialName: string
  materialRevision: number
  materialId: string
  quantity: number
  dimensions: { x: number; y: number; z: number }
  partLabels: string[]
}

export type PreliminaryResult =
  | { status: 'preliminary'; artifactId: string; revision: number; parts: PreliminaryPart[]; partCount: number
      referenceCount: number; retainedCount: number; completeItemCount: number; questions: string[] }
  | { status: 'needs_data' | 'changed'; message: string; questions: string[] }

/** This is deliberately NOT a cutting plan, saw sequence, stock count or shopping quantity.
 * Reuse K4's role-aware blank calculation rather than the old all-instances CAD CSV. */
export function preliminaryConstructionList(source: ConstructionPreparationSource): PreliminaryResult {
  const { draft, catalog } = source
  const questions = Array.isArray(draft.open_questions) ? draft.open_questions.filter(q => typeof q === 'string') : []
  if (draft.archived || draft.current_revision !== draft.revision || draft.source_state !== 'current') {
    return { status: 'changed', message: 'Construction sources have changed or cannot be verified. Reopen the current revision before preparing material.', questions }
  }
  try {
    const policy = constructionInstancePolicy(draft.recipe, draft.instance_policy)
    const unknown = policy.instances.filter(item => item.quantity_policy === 'unknown')
    if (unknown.length) return { status: 'needs_data',
      message: String(unknown.length) + ' construction instances need an explicit manufacturing role.', questions }

    const manufactured = new Set(policy.instances.filter(item => item.quantity_policy === 'manufacture').map(item => item.instance_id))
    const usedDefinitions = new Set(draft.recipe.instances.filter(item => manufactured.has(item.id)).map(item => item.definition_id))
    for (const definition of draft.recipe.definitions) {
      if (!usedDefinitions.has(definition.id)) continue
      if (definition.primitive !== 'box' || ![definition.x_mm, definition.y_mm, definition.z_mm]
        .every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
        return { status: 'needs_data', message: 'A manufactured part has unsupported or incomplete blank geometry.', questions }
      }
      const binding = draft.materials.find(item => item.definition_id === definition.id)
      const material = binding && catalog.get(String(binding.material_id) + '@' + String(binding.material_revision))
      if (!binding || !material || typeof material.name !== 'string'
        || !Number.isFinite(Number(material.properties?.thickness?.value))
        || Number(material.properties.thickness.value) <= 0) {
        return { status: 'needs_data', message: 'The exact saved material specification is unavailable for part ' + definition.id + '.', questions }
      }
    }

    const derived = constructionLists(draft, catalog, [])
    if (derived.status !== 'derived') return { status: 'needs_data',
      message: derived.status === 'invalid' ? derived.message : 'The saved manufacturing roles need review.', questions }
    const parts: PreliminaryPart[] = derived.bom.map(row => {
      const material = catalog.get(String(row.material_id) + '@' + String(row.material_revision))!
      return {
        definitionId: row.definition_id, materialName: material.name, materialId: row.material_id,
        materialRevision: row.material_revision, quantity: row.quantity,
        dimensions: row.blank_mm,
        partLabels: derived.cuts.filter(cut => cut.definition_id === row.definition_id).map(cut => cut.label),
      }
    })
    return {
      status: 'preliminary', artifactId: draft.artifact_id, revision: draft.revision,
      parts, partCount: derived.cuts.length, referenceCount: derived.reference_instances.length,
      retainedCount: derived.retained_instances.length, completeItemCount: derived.complete_items.length,
      questions,
    }
  } catch {
    // Bad provenance must never become a plausible-looking cutting list.
    return { status: 'needs_data', message: 'The saved construction or its role classifications could not be validated.', questions }
  }
}

/** Explicitly preliminary export. Formula-like catalog names are never interpreted by spreadsheets. */
export function preliminaryCutCsv(value: Extract<PreliminaryResult, { status: 'preliminary' }>, fasteners?: ConstructionFasteners | null): string {
  const cell = (input: unknown) => '"' + String(input).replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""') + '"'
  const data: unknown[][] = [
    ['PRELIMINARY ONLY - NOT APPROVED FOR CUTTING'],
    ['Construction artifact', value.artifactId, 'revision', value.revision],
    ['Definition', 'Material', 'Material revision', 'Quantity', 'X (mm)', 'Y (mm)', 'Z (mm)', 'Part labels'],
    ...value.parts.map(part => [
      part.definitionId, part.materialName, part.materialRevision, part.quantity,
      part.dimensions.x, part.dimensions.y, part.dimensions.z, part.partLabels.join(' '),
    ]),
    // Exact schedule counts, no waste added; a rule-of-thumb proposal, not a strength calculation.
    ...(fasteners ? [
      [],
      ['Fasteners - exact count from the saved joints, no waste added, not a strength calculation'],
      ['Kind', 'Diameter (mm)', 'Length (mm)', 'Count', 'Joints'],
      ...fasteners.totals.map(t => [t.kind, t.diameterMm, t.lengthMm, t.count, t.joints]),
      ...(fasteners.gluePackages ? [['Glue packages', fasteners.gluePackages]] : []),
      ...(!fasteners.complete ? [['Not counted', fasteners.unsizedJoints + (fasteners.unsizedJoints === 1 ? ' joint has' : ' joints have') + ' no fastener rule or size yet']] : []),
    ] : []),
  ]
  return data.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
