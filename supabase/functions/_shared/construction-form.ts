import type { DesignIntent, DesignReadiness } from './project-design-intent.ts'
import { evaluateConcept, type ConceptIssue } from './solution-concept.ts'
import type { CadAssemblyRequest } from './cad-adapter.ts'

/** A refinement belongs to the construction revision and its selected Solution.
 * Coverage and remaining work are derived, never supplied as a caller verdict. */
export type FormRefinement = { version: 1; mappings: { component_id: string; instance_ids: string[] }[] }
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
export const FORM_REFINEMENT_SCHEMA = { anyOf: [{ type: 'null' }, object({
  version: { type: 'integer', enum: [1] },
  mappings: { type: 'array', minItems: 1, maxItems: 48, items: object({
    component_id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,31}$' },
    instance_ids: { type: 'array', minItems: 1, maxItems: 128, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$' } },
  }) },
})] }
const exact = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.sort().join(',')
export function parseFormRefinement(value: unknown): FormRefinement {
  const f = value as FormRefinement
  if (!exact(f, ['version', 'mappings']) || f.version !== 1 || !Array.isArray(f.mappings) || !f.mappings.length || f.mappings.length > 48
    || f.mappings.some(m => !exact(m, ['component_id', 'instance_ids']) || typeof m.component_id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(m.component_id)
      || !Array.isArray(m.instance_ids) || !m.instance_ids.length || m.instance_ids.length > 128 || m.instance_ids.some(id => typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(id)))
    || new Set(f.mappings.map(m => m.component_id)).size !== f.mappings.length
    || new Set(f.mappings.flatMap(m => m.instance_ids)).size !== f.mappings.flatMap(m => m.instance_ids).length) throw Error('invalid_form_refinement')
  return structuredClone(f)
}

export function constructionFormScope(intent: DesignIntent, raw: unknown) {
  const refinement = parseFormRefinement(raw), model = intent.model
  if (!model || refinement.mappings.some(m => !model.components.some(c => c.active && c.id === m.component_id))) throw Error('invalid_form_refinement')
  const selected = new Set(refinement.mappings.map(m => m.component_id))
  const components = model.components.filter(c => c.active)
  // Conservative dependency closure: shared inputs, derived values and numeric
  // constraints all connect components. Even a shared zero is not ignored.
  const closure = (roots: string[]) => {
    const ids = new Set(roots)
    let changed = true
    while (changed) {
      const before = ids.size
      for (const n of model.nodes) if (n.role === 'derived' && (ids.has(n.id) || n.operands.some(id => ids.has(id)))) { ids.add(n.id); n.operands.forEach(id => ids.add(id)) }
      for (const c of model.constraints) if (c.relation !== 'view_plane' && (ids.has(c.left) || ids.has(c.right))) { ids.add(c.left); ids.add(c.right) }
      changed = before !== ids.size
    }
    return ids
  }
  const affected = new Set(selected), boxes = evaluateConcept(intent).boxes
  let changed = true
  while (changed) {
    const current = components.filter(c => affected.has(c.id)), nodes = closure(current.flatMap(c => [...c.position, ...c.size]))
    const features = new Set(current.flatMap(c => c.features)), before = affected.size
    for (const p of components) {
      const box = boxes.find(b => b.id === p.id)
      const touches = box && boxes.some(b => affected.has(b.id) && box.min.every((v,k) => v <= b.min[k]+b.size_mm[k] && b.min[k] <= v+box.size_mm[k]))
      if (touches || p.features.some(f => features.has(f)) || [...p.position,...p.size].some(id => nodes.has(id))) affected.add(p.id)
    }
    changed = before !== affected.size
  }
  const pendingChoices = intent.choices.filter(c => {
    if (c.status === 'resolved') return false
    const linked = components.filter(p => p.choices.includes(c.id))
    return linked.length > 0 && linked.every(p => !affected.has(p.id))
  }).map(c => c.id)
  return { component_ids: components.filter(c => selected.has(c.id)).map(c => c.id),
    pending_component_ids: components.filter(c => !selected.has(c.id)).map(c => c.id),
    pending_choice_ids: pendingChoices, verification: 'unverified' as const }
}

/** This is permission to save a checkpoint, never a whole-delivery pin. */
export function constructionFormReadiness(design: DesignReadiness, refinement: FormRefinement) {
  if (!design.design_intent) return { status: design.status, issues: design.issues, form_scope: null, design_readiness: design }
  const scope = constructionFormScope(design.design_intent, refinement)
  const scopedCodes = new Set(['design_choice_open', 'design_geometry_choice_open', 'design_deferral_out_of_scope'])
  const issues = design.issues.filter(i => !(scopedCodes.has(i.code) && i.choice_id !== null && scope.pending_choice_ids.includes(i.choice_id)))
  const status = design.status === 'conflict' || design.status === 'unavailable' ? design.status : issues.length ? 'needs_data' : 'ready'
  return { status, issues, form_scope: scope, design_readiness: design }
}

/** Envelope preservation bounds a refinement; it does NOT prove function,
 * joinery, loads or fidelity. Every explicit refinement remains unverified. */
export function constructionFormIssues(intent: DesignIntent, recipe: CadAssemblyRequest, referenceIds: Set<string>, raw: unknown, checkpoint = false): ConceptIssue[] {
  const refinement = parseFormRefinement(raw), scope = constructionFormScope(intent, refinement)
  const result = evaluateConcept(intent), issues = [...result.issues]
  const add = (code: string, ids: string[], message: string) => issues.push({ code, ids, message })
  const mapped = refinement.mappings.flatMap(m => m.instance_ids)
  if (mapped.length !== recipe.instances.length || recipe.instances.some(i => !mapped.includes(i.id))) add('form_instance_unmapped', [], 'Map every construction instance exactly once to an active concept component.')
  for (const m of refinement.mappings) {
    const box = result.boxes.find(b => b.id === m.component_id)
    if (!box) continue // The canonical concept issues above explain unknown geometry.
    const parts = m.instance_ids.map(id => {
      const i = recipe.instances.find(i => i.id === id), d = recipe.definitions.find(d => d.id === i?.definition_id)
      return { id, i, d }
    })
    if (parts.some(p => !p.i || !p.d)) { add('form_instance_missing', [m.component_id], 'The refinement names a missing construction instance.'); continue }
    if (parts.some(({ i, d }) => d!.primitive !== 'box' || d!.cuts?.length || [i!.placement.rx, i!.placement.ry, i!.placement.rz].some(n => n !== 0))) {
      add('concept_mapping_unsupported', [m.component_id], 'Refinement currently supports only uncut, unrotated boxes.'); continue
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (const { id, i, d } of parts) {
      const p = i!.placement, size = d as { x_mm: number; y_mm: number; z_mm: number }
      const at = [p.x, p.y, p.z], dimensions = [size.x_mm, size.y_mm, size.z_mm]
      at.forEach((v, k) => { min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v + dimensions[k]) })
      if ((box.kind !== 'solid') !== referenceIds.has(id)) add('concept_geometry_changed', [m.component_id, id], 'The physical/reference role differs from the selected concept.')
    }
    if (min.some((v, k) => v !== box.min[k] || Math.abs(max[k] - (box.min[k] + box.size_mm[k])) > 1e-7)) add('concept_geometry_changed', [m.component_id], 'The refinement envelope differs from the exact selected concept.')
  }
  if (!checkpoint) {
    if (scope.pending_component_ids.length) add('form_components_pending', scope.pending_component_ids, 'These selected concept components remain outside this saved checkpoint.')
    add('form_refinement_unverified', scope.component_ids, 'A saved refinement preserves its envelope only. Functional fidelity and whole-model delivery remain unverified.')
  }
  return issues
}
