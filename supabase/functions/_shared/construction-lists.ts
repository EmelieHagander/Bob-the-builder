/** K4's first boundary: quantities and uncut blanks from the checked checkpoint.
 * Raw-stock nesting, reservations and product-dependent hardware are separate
 * evidence. In particular, summed area is never a sheet purchase count. */
export const CONSTRUCTION_LIST_VERSION = 'construction-blanks-v1'
type Row = Record<string, any>
type Dependency = { joint_id: string; depends_on: string[] }

export function constructionLists(draft: Row, catalog: Map<string, Row>, dependencies: Dependency[]) {
 const instances: Row[] = draft.recipe.instances
 const joints: Row[] = draft.joints
 const ids = new Set(joints.map(j => j.id))
 if (dependencies.length && (dependencies.length !== ids.size || new Set(dependencies.map(d => d.joint_id)).size !== ids.size
  || dependencies.some(d => !ids.has(d.joint_id) || new Set(d.depends_on).size !== d.depends_on.length
   || d.depends_on.some(id => !ids.has(id) || id === d.joint_id))))
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
 const bom: Row[] = [], cuts: Row[] = []
 for (const definition of draft.recipe.definitions as Row[]) {
  const used = instances.filter(i => i.definition_id === definition.id)
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
 return { status: 'derived', calculation_version: CONSTRUCTION_LIST_VERSION,
  source: { artifact_id: draft.artifact_id, revision: draft.revision }, concept_only: true, fabrication_ready: false,
  bom, cuts, joints: joints.map(j => ({ joint_id: j.id, method: j.method, first: j.first, second: j.second,
   hardware_quantity: null, hardware_product: null, adhesive_quantity: null })),
  assembly: { status: dependencies.length ? 'proposed_order' : 'needs_dependencies', provenance: 'design_choice', steps, access_verified: false },
  gaps: [
   { code: 'raw_stock_cutting_unverified', ids: bom.map(row => row.definition_id), message: 'Raw format, saw kerf, grain direction and a feasible stock cutting layout are not verified by this list. Use check_construction_cut_fit for an explicit candidate-sheet layout; that read assessment does not reserve stock or unlock Shopping. These are blank dimensions, not a raw-sheet purchase count.' },
   { code: 'joint_hardware_unverified', ids: joints.map(j => j.id), message: 'Joint methods do not specify screw/adhesive products, quantities, spacing or capacity. No hardware purchase quantity has been inferred.' },
   { code: 'assembly_access_unverified', ids: joints.map(j => j.id), message: 'Acyclic order is a design proposal; tool access, clamping, machining and stability during assembly still require evidence.' },
   ...(!dependencies.length ? [{ code: 'assembly_dependencies_missing', ids: joints.map(j => j.id), message: 'Supply an explicit dependency entry for every joint to validate a proposed order.' }] : []),
  ], open_questions: draft.open_questions ?? [],
  delivery: { saved: false, material_requirements: 'Use derive_cad_material_requirement with this construction Artifact/revision and each used definition. The server derives blank quantity; preserve existing requirement identities. Shopping and stock allocation remain blocked until raw-stock fit is supported.' },
 }
}
