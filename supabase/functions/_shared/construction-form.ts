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

export function constructionFormDependencies(intent: DesignIntent, componentIds: string[]) {
  const model = intent.model
  if (!model || componentIds.some(id => !model.components.some(c => c.active && c.id === id))) throw Error('invalid_form_refinement')
  const selected = new Set(componentIds)
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
  return components.filter(c => affected.has(c.id)).map(c => c.id)
}

export function constructionFormScope(intent: DesignIntent, raw: unknown) {
  const refinement = parseFormRefinement(raw), selected = new Set(refinement.mappings.map(m => m.component_id))
  const affected = new Set(constructionFormDependencies(intent, [...selected]))
  const components = intent.model!.components.filter(c => c.active)
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

/** Owner decision 2026-11-07 (lean_construction_version 1): code keeps the
 * FORM mapping in step with the parts. A part no mapping names goes to the one
 * concept component whose envelope holds it; a removed part leaves its
 * mapping; assign moves a part on purpose. Entry, 2026-11-07 13:48 and 13:59:
 * a part edit could not name the mapping, so every added stud was refused
 * (form_instance_unmapped) and only a complete save could add one. */
export type FormAssignment = { instance_id: string; component_id: string }
export const FORM_ASSIGN_SCHEMA = { type: 'array', maxItems: 128,
  description: 'The concept component for a part that several components hold. Code maps every other part itself; empty for none.',
  items: object({ instance_id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$' }, component_id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,31}$' } }) }
// A part no component holds names the nearest component and by how many mm
// it reaches past each face (entré, 2026-11-10: ground screws 3 mm into the
// floor and 15.5 mm past the front; the builder could not see why).
function outsideIssue(id: string, lo: number[], hi: number[], boxes: { id: string; min: number[]; size_mm: number[] }[]): ConceptIssue {
  const axes = ['x', 'y', 'z'], mm = (n: number) => Math.round(n * 10) / 10
  const past = (b: { min: number[]; size_mm: number[] }) => axes.flatMap((a, k) => [
    ...(lo[k] < b.min[k] - 1e-7 ? [`${a} ${mm(b.min[k] - lo[k])} mm below ${mm(b.min[k])}`] : []),
    ...(hi[k] > b.min[k] + b.size_mm[k] + 1e-7 ? [`${a} ${mm(hi[k] - b.min[k] - b.size_mm[k])} mm above ${mm(b.min[k] + b.size_mm[k])}`] : [])])
  const over = (b: { min: number[]; size_mm: number[] }) => axes.reduce((t, _, k) => t + Math.max(0, b.min[k] - lo[k]) + Math.max(0, hi[k] - b.min[k] - b.size_mm[k]), 0)
  const near = [...boxes].sort((a, b) => over(a) - over(b))[0]
  if (!near) return { code: 'form_instance_outside', ids: [id], message: 'No concept component holds this part; move it inside one or revise the Solution concept.' }
  return { code: 'form_instance_outside', ids: [id, near.id],
    message: `No concept component holds this part. Nearest is ${near.id}; the part reaches past it: ${past(near).join(', ')}. Move the part inside, or have the Solution concept resize ${near.id}.` }
}
export function extendFormMapping(intent: DesignIntent, recipe: CadAssemblyRequest, raw: unknown, referenceIds: Set<string>, assign: FormAssignment[] = []): { refinement: FormRefinement; issues: ConceptIssue[]; changed: boolean } {
  // null: a construction without a saved scope; code derives its first one.
  const before: FormRefinement = raw == null ? { version: 1, mappings: [] } : parseFormRefinement(raw), issues: ConceptIssue[] = []
  const active = new Set((intent.model?.components ?? []).filter(c => c.active).map(c => c.id))
  const boxes = evaluateConcept(intent).boxes.filter(b => active.has(b.id))
  const present = new Set(recipe.instances.map(i => i.id))
  const mapping = new Map<string, string>()
  for (const m of before.mappings) for (const id of m.instance_ids) if (present.has(id)) mapping.set(id, m.component_id)
  for (const a of assign) {
    if (!present.has(a.instance_id)) continue // a part removed since it was assigned
    if (!active.has(a.component_id)) { issues.push({ code: 'form_assignment_invalid', ids: [a.instance_id, a.component_id], message: 'Assign a part to an active concept component.' }); continue }
    mapping.set(a.instance_id, a.component_id)
  }
  const mappedComponents = new Set(before.mappings.map(m => m.component_id))
  for (const i of recipe.instances) {
    if (mapping.has(i.id)) continue
    const d = recipe.definitions.find(d => d.id === i.definition_id) as { primitive: string; cuts?: unknown[]; x_mm: number; y_mm: number; z_mm: number } | undefined
    const p = i.placement
    if (!d || d.primitive !== 'box' || d.cuts?.length || [p.rx, p.ry, p.rz].some(n => n !== 0)) {
      issues.push({ code: 'concept_mapping_unsupported', ids: [i.id], message: 'Refinement currently supports only uncut, unrotated boxes.' }); continue
    }
    const lo = [p.x, p.y, p.z], hi = [p.x + d.x_mm, p.y + d.y_mm, p.z + d.z_mm]
    const solid = !referenceIds.has(i.id)
    const holding = boxes.filter(b => (b.kind === 'solid') === solid && lo.every((v, k) => v >= b.min[k] - 1e-7) && hi.every((v, k) => v <= b.min[k] + b.size_mm[k] + 1e-7))
    // Only an unambiguous match is mapped by code (owner review 2026-11-07).
    if (holding.length === 1) mapping.set(i.id, holding[0].id)
    else issues.push(holding.length
      ? { code: 'form_instance_ambiguous', ids: [i.id, ...holding.map(b => b.id)], message: 'Several concept components hold this part; assign it to one.' }
      : outsideIssue(i.id, lo, hi, boxes.filter(b => (b.kind === 'solid') === solid)))
  }
  const grouped = new Map<string, string[]>()
  for (const i of recipe.instances) { const c = mapping.get(i.id); if (c) grouped.set(c, [...(grouped.get(c) ?? []), i.id]) }
  const order = [...before.mappings.map(m => m.component_id), ...[...grouped.keys()].filter(c => !mappedComponents.has(c))]
  const mappings = order.filter(c => grouped.has(c)).map(c => ({ component_id: c, instance_ids: grouped.get(c)! }))
  if (!mappings.length) return { refinement: before, issues: issues.length ? issues : [{ code: 'form_instance_unmapped', ids: [], message: 'Map every construction instance exactly once to an active concept component.' }], changed: false }
  const refinement = { version: 1 as const, mappings }
  return { refinement, issues, changed: JSON.stringify(refinement) !== JSON.stringify(before) }
}

/** Envelope preservation bounds a refinement; it does NOT prove function,
 * joinery, loads or fidelity. Every explicit refinement remains unverified. */
/** partial (a construction still being sketched, owner decision 2026-11-07):
 * a component whose parts lie inside its envelope but do not fill it yet is
 * reported as form_envelope_incomplete, not as changed geometry. */
export function constructionFormIssues(intent: DesignIntent, recipe: CadAssemblyRequest, referenceIds: Set<string>, raw: unknown, checkpoint = false, partial = false): ConceptIssue[] {
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
    const exact = !min.some((v, k) => v !== box.min[k] || Math.abs(max[k] - (box.min[k] + box.size_mm[k])) > 1e-7)
    const inside = min.every((v, k) => v >= box.min[k] - 1e-7) && max.every((v, k) => v <= box.min[k] + box.size_mm[k] + 1e-7)
    if (!exact && partial && inside) add('form_envelope_incomplete', [m.component_id], 'The parts of this component lie inside its concept envelope but do not fill it yet.')
    else if (!exact) {
      // Name the parts that reach past the envelope and the numbers (deep audit
      // 2026-11-08: a door beam was refused three times with no part named).
      const hi = box.min.map((v, k) => v + box.size_mm[k]), axes = ['x', 'y', 'z']
      const outside = parts.filter(({ i, d }) => {
        const p = i!.placement, size = d as { x_mm: number; y_mm: number; z_mm: number }, at = [p.x, p.y, p.z], dims = [size.x_mm, size.y_mm, size.z_mm]
        return at.some((v, k) => v < box.min[k] - 1e-7 || v + dims[k] > hi[k] + 1e-7)
      }).map(p => p.id)
      const span = (lo: number[], up: number[]) => axes.map((a, k) => `${a} ${+lo[k].toFixed(3)}..${+up[k].toFixed(3)}`).join(', ')
      add('concept_geometry_changed', [m.component_id, ...outside.slice(0, 12)],
        `The refinement envelope differs from the exact selected concept. Component ${m.component_id} spans ${span(box.min, hi)} mm; its parts span ${span(min, max)} mm.`
        + (outside.length ? ` Parts outside it: ${outside.slice(0, 12).join(', ')}.` : ' Its parts do not fill it.'))
    }
  }
  if (!checkpoint) {
    if (scope.pending_component_ids.length) add('form_components_pending', scope.pending_component_ids, 'These selected concept components remain outside this saved checkpoint.')
    add('form_refinement_unverified', scope.component_ids, 'A saved refinement preserves its envelope only. Functional fidelity and whole-model delivery remain unverified.')
  }
  return issues
}
