import assert from 'node:assert/strict'

// Exact retained outcome of the first live K4 turn. A changed checkpoint needs
// inspection, not an automatic second model request.
export const K4_RECOVERY_TURN = 'c85346d0-e8c4-408d-8523-9a3f7e5d3d24'
export const K4_SAVED_REQUIREMENT = '2b5ffd76-5ece-4f32-b2e4-7e4112391003'
const project = 'p_43702f4cbdfb40f0907f5cd0c12a5143'
const artifact = '01349f1c-100b-4ac2-a5b9-de4c839b51a4'

export function assertK4RecoveryCheckpoint(requirements, sources, history) {
 assert.equal(requirements.length, 1, 'Recovery requires exactly the retained side-panel need')
 assert.equal(sources.length, 1, 'Inspect unexpected requirement provenance before recovery')
 assert.equal(history.length, 1, 'The retained need must still have its original history')
 const r = requirements[0], s = sources[0], h = history[0]
 assert.equal(r.id, K4_SAVED_REQUIREMENT); assert.equal(r.project_id, project); assert.equal(r.revision, 1)
 assert.equal(r.artifact_id, artifact); assert.equal(r.artifact_revision, 4); assert.equal(r.target_revision, 3)
 assert.equal(r.unit, 'pcs'); assert.equal(r.source_kind, 'deterministic')
 assert.equal(r.method_key, 'construction_blank_pieces'); assert.equal(r.method_version, '1')
 for (const flag of ['archived', 'target_changed', 'artifact_changed', 'stock_changed', 'component_changed']) assert.equal(r[flag], false)
 for (const key of ['required_quantity', 'required_with_waste', 'purchase_quantity']) assert.equal(Number(r[key]), 2)
 for (const key of ['stock_quantity', 'component_quantity', 'waste_percent']) assert.equal(Number(r[key]), 0)
 assert.equal(Number(r.purchase_increment), 1)
 assert.equal(Date.parse(r.recorded_at), Date.parse('2026-10-05T22:32:47.129181Z'))
 assert.deepEqual(s, {
  project_id: project, requirement_id: K4_SAVED_REQUIREMENT, requirement_revision: 1,
  artifact_id: artifact, artifact_revision: 4, definition_id: 'side_panel', quantity_mode: 'pieces',
  instance_ids: ['left_side', 'right_side'], blank_mm: { x: 21, y: 300, z: 800 },
  material_binding: { definition_id: 'side_panel', material_id: '766d4e1a-db42-4a0e-af25-da2739783fc4', material_revision: 1, part_id: null, part_revision: null },
 })
 assert.equal(h.requirement_id, r.id); assert.equal(h.project_id, project); assert.equal(h.revision, 1)
 assert.equal(h.recorded_at, r.recorded_at)
}
