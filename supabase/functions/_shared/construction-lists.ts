/** K4's first boundary: quantities and uncut blanks from the checked checkpoint.
 * Raw-stock nesting, reservations and product-dependent hardware are separate
 * evidence. In particular, summed area is never a sheet purchase count. */
import { constructionInstancePolicy } from './construction-instance-policy.ts'
import type { FastenerSchedule } from './construction-fasteners.ts'
export const CONSTRUCTION_LIST_VERSION = 'construction-blanks-role-v1'
type Row = Record<string, any>
export type Dependency = { joint_id: string; depends_on: string[] }

/** Bob's proposed assembly order as numbered stages of joint ids: every saved
 * joint exactly once, prerequisites among the saved joints, no cycles. The
 * physical joint graph may have cycles; only this order may not. */
export function assemblyStages(jointIds: readonly string[], dependencies: Dependency[]):
 { status: 'ok'; layers: string[][] } | { status: 'invalid'; message: string; joint_ids?: string[] } {
 const ids = new Set(jointIds)
 if (dependencies.length !== ids.size || new Set(dependencies.map(d => d.joint_id)).size !== ids.size
  || dependencies.some(d => !ids.has(d.joint_id) || new Set(d.depends_on).size !== d.depends_on.length
   || d.depends_on.some(id => !ids.has(id) || id === d.joint_id)))
  return { status: 'invalid', message: 'Supply each saved joint exactly once, with distinct existing prerequisite joint IDs. Physical joint contacts and assembly dependencies are different graphs.' }
 const remaining = new Map(dependencies.map(d => [d.joint_id, new Set(d.depends_on)]))
 const layers: string[][] = []
 while (remaining.size) {
  const ready = [...remaining].filter(([, deps]) => !deps.size).map(([id]) => id).sort()
  if (!ready.length) return { status: 'invalid', message: 'Assembly dependencies contain a cycle. Correct only the order; physical joint cycles are permitted.', joint_ids: [...remaining.keys()].sort() }
  layers.push(ready)
  for (const id of ready) remaining.delete(id)
  for (const deps of remaining.values()) for (const id of ready) deps.delete(id)
 }
 return { status: 'ok', layers }
}

/** fasteners: undefined keeps the original unverified-hardware list; null means
 * the server schedule could not be read; otherwise its proposals fill the joints. */
export function constructionLists(draft: Row, catalog: Map<string, Row>, dependencies: Dependency[], fasteners?: FastenerSchedule | null) {
 const instances: Row[] = draft.recipe.instances
 const policy=constructionInstancePolicy(draft.recipe,draft.instance_policy)
 const unknown=policy.instances.filter(i=>i.role==='unknown')
 if(unknown.length)return {status:'needs_data' as const,reason:'instance_roles_unknown',source:{artifact_id:draft.artifact_id,revision:draft.revision},
  gaps:unknown.map(i=>({code:'instance_role_unknown',ids:[i.instance_id],message:i.reason})),
  message:'Classify these exact saved instances with change_construction_roles. Names do not establish manufacturing or ownership.'}
 const manufactured=new Set(policy.instances.filter(i=>i.quantity_policy==='manufacture').map(i=>i.instance_id))
 const joints: Row[] = draft.joints
 let layers: string[][] = []
 if (dependencies.length) {
  const order = assemblyStages(joints.map(j => j.id), dependencies)
  if (order.status === 'invalid') return order.joint_ids ? { status: 'invalid' as const, message: order.message, joint_ids: order.joint_ids } : { status: 'invalid' as const, message: order.message }
  layers = order.layers
 }
 const bom: Row[] = [], cuts: Row[] = []
 for (const definition of draft.recipe.definitions as Row[]) {
  const used = instances.filter(i => i.definition_id === definition.id && manufactured.has(i.id))
  if (!used.length) continue
  const binding = draft.materials.find((m: Row) => m.definition_id === definition.id)
  const material = catalog.get(`${binding.material_id}@${binding.material_revision}`)!
  const dims = [definition.x_mm, definition.y_mm, definition.z_mm]
  const thickness = Number(material.properties.thickness.value)
  const thicknessAxes = dims.map((v, i) => Math.abs(v - thickness) <= 0.000001 ? i : -1).filter(i => i >= 0)
  const source = { artifact_id: draft.artifact_id, revision: draft.revision, definition_id: definition.id,
   material_id: binding.material_id, material_revision: binding.material_revision, part_id: binding.part_id, part_revision: binding.part_revision }
  bom.push({ ...source, quantity: used.length, unit: 'pcs', instance_ids: used.map(i => i.id), blank_mm: { x: dims[0], y: dims[1], z: dims[2] } })
  for (const i of used) cuts.push({ ...source, instance_id: i.id, label: `P${instances.findIndex(item => item.id === i.id) + 1}`,
   blank_mm: { x: dims[0], y: dims[1], z: dims[2] }, thickness_axes: thicknessAxes.map(axis => ['x', 'y', 'z'][axis]),
   machining: 'uncut_box', tolerance: null, grain_direction: null })
 }
 const steps = layers.map((layer, index) => ({ stage: index + 1, joints: layer.map(id => {
  const joint = joints.find(j => j.id === id)!
  return { joint_id: id, method: joint.method, first: joint.first, second: joint.second,
   depends_on: dependencies.find(d => d.joint_id === id)!.depends_on, reason: joint.reason }
 }) }))
 return { status: 'derived' as const, calculation_version: CONSTRUCTION_LIST_VERSION,
  source: { artifact_id: draft.artifact_id, revision: draft.revision }, concept_only: true, fabrication_ready: false,
  instance_policy:policy, retained_instances:policy.instances.filter(i=>i.role==='existing_part'),
  complete_items:policy.instances.filter(i=>i.role==='prefabricated_part'), reference_instances:policy.instances.filter(i=>i.role==='reference'),
  bom, cuts, joints: joints.map(j => ({ joint_id: j.id, method: j.method, first: j.first, second: j.second,
   ...(fasteners ? jointFastener(fasteners, j.id) : { hardware_quantity: null, hardware_product: null, adhesive_quantity: null }) })),
  ...(fasteners ? { fasteners: { rule_version: fasteners.rule_version, complete: fasteners.complete, totals: fasteners.totals,
   glue_packages: fasteners.glue_packages, basis: fasteners.joints.some(j => j.source === 'chosen') ? 'chosen_catalog_items' : 'rule_of_thumb_proposal' } } : {}),
  assembly: { status: dependencies.length ? 'proposed_order' : 'needs_dependencies', provenance: 'design_choice', steps, access_verified: false },
  gaps: [
   ...policy.instances.filter(i=>i.role==='prefabricated_part'||i.role==='existing_part').map(i=>({code:i.role==='existing_part'?'retained_part_condition_unverified':'complete_item_procurement_unverified',
    ids:[i.instance_id],message:i.role==='existing_part'?'This role excludes new manufacturing; condition, availability and any reuse allocation still need their own evidence.':'This is a complete item, not manufactured blanks. Product, procurement/ownership and compatibility remain explicit checks; no duplicate raw material need was inferred.'})),
   { code: 'raw_stock_cutting_unverified', ids: bom.map(row => row.definition_id), message: 'Raw format, saw kerf, grain direction and a feasible stock cutting layout are not verified by this list. Use check_construction_cut_fit for an explicit candidate-sheet layout; that read assessment does not reserve stock or unlock Shopping. These are blank dimensions, not a raw-sheet purchase count.' },
   ...(fasteners === undefined
    ? [{ code: 'joint_hardware_unverified', ids: joints.map(j => j.id), message: 'Joint methods do not specify screw/adhesive products, quantities, spacing or capacity. No hardware purchase quantity has been inferred.' }]
    : fasteners === null
     ? [{ code: 'fastener_schedule_unavailable', ids: joints.map(j => j.id), message: 'The server fastener schedule could not be read. No hardware quantity is shown; read the lists again.' }]
     : [{ code: 'fastener_capacity_unverified', ids: joints.map(j => j.id), message: 'Fasteners are fixed rule-of-thumb proposals from board thickness and contact length (or an explicit joint override). Strength, edge and end distances, pilot holes and the exact product are not verified.' },
       ...fasteners.joints.filter(j => Array.isArray(j.gaps) && j.gaps.length).map(j => ({ code: 'fastener_rule_gap', ids: [j.joint_id], message: 'Fastener rule notes: ' + j.gaps.join(', ') + '.' }))]),
   { code: 'assembly_access_unverified', ids: joints.map(j => j.id), message: 'Acyclic order is a design proposal; tool access, clamping, machining and stability during assembly still require evidence.' },
   ...(!dependencies.length ? [{ code: 'assembly_dependencies_missing', ids: joints.map(j => j.id), message: 'Supply an explicit dependency entry for every joint to validate a proposed order.' }] : []),
  ], open_questions: draft.open_questions ?? [],
  delivery: { saved: false, material_requirements: 'Use derive_cad_material_requirement with this construction Artifact/revision and each used definition. The server derives blank quantity; preserve existing requirement identities. Shopping and stock allocation remain blocked until raw-stock fit is supported.' },
 }
}

function jointFastener(schedule: FastenerSchedule, jointId: string) {
 const rows = schedule.joints.filter(j => j.joint_id === jointId)
 // A joint held by several chosen items (2026-11-01) lists each of them.
 if (rows.length > 1) {
  const mechanical = rows.filter(r => ['screw', 'nail', 'bolt'].includes(r.kind))
  return {
   hardware_quantity: mechanical.length === 1 ? mechanical[0].count ?? null : null,
   hardware_product: mechanical.length === 1 && mechanical[0].diameter_mm != null && mechanical[0].length_mm != null
    ? { kind: mechanical[0].kind, diameter_mm: mechanical[0].diameter_mm, length_mm: mechanical[0].length_mm } : null,
   adhesive_quantity: rows.some(r => r.kind === 'glue') ? 'shared_package' : null,
   fasteners: rows.map(f => ({ source: f.source, kind: f.kind, diameter_mm: f.diameter_mm, length_mm: f.length_mm, count: f.count, spacing_mm: f.spacing_mm, gaps: f.gaps,
    material_id: f.material_id ?? null, material_revision: f.material_revision ?? null })),
  }
 }
 const f = rows[0]
 if (!f) return { hardware_quantity: null, hardware_product: null, adhesive_quantity: null, fastener: null }
 const mechanical = ['screw', 'nail', 'bolt'].includes(f.kind)
 return {
  hardware_quantity: mechanical ? f.count ?? null : null,
  hardware_product: mechanical && f.diameter_mm != null && f.length_mm != null ? { kind: f.kind, diameter_mm: f.diameter_mm, length_mm: f.length_mm } : null,
  adhesive_quantity: f.kind === 'glue' ? 'shared_package' : null,
  fastener: { source: f.source, kind: f.kind, diameter_mm: f.diameter_mm, length_mm: f.length_mm, count: f.count, spacing_mm: f.spacing_mm, gaps: f.gaps,
   ...(f.proposal ? { rule_proposal: f.proposal } : {}), ...(f.source === 'chosen' ? { material_id: f.material_id, material_revision: f.material_revision } : {}) },
 }
}
