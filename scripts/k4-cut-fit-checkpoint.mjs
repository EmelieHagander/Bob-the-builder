import assert from 'node:assert/strict'
import { K4_SAVED_REQUIREMENT, assertK4RecoveryCheckpoint } from './k4-recovery-checkpoint.mjs'

// The completed recovery is a new read-only test boundary, never a replay.
export const K4_CUT_FIT_PREVIOUS_TURN = '93751f7c-8ac1-4eef-af08-188e556bb291'
export const K4_SHELF_REQUIREMENT = '48a56c7f-82fd-4daf-8b41-e04e39717be2'
export function assertK4CutFitCheckpoint(requirements, sources, history) {
 for (const rows of [requirements, sources, history]) assert.equal(rows.length, 2, 'Inspect changed/extra needs before a new model test')
 assertK4RecoveryCheckpoint(requirements.filter(r => r.id === K4_SAVED_REQUIREMENT),
  sources.filter(s => s.requirement_id === K4_SAVED_REQUIREMENT), history.filter(h => h.requirement_id === K4_SAVED_REQUIREMENT))
 const r = requirements.find(r => r.id === K4_SHELF_REQUIREMENT), s = sources.find(s => s.requirement_id === K4_SHELF_REQUIREMENT), h = history.find(h => h.requirement_id === K4_SHELF_REQUIREMENT)
 assert(r && s && h)
 const retained = requirements.find(r => r.id === K4_SAVED_REQUIREMENT)
 for (const key of ['project_id', 'revision', 'artifact_id', 'artifact_revision', 'target_revision', 'unit', 'source_kind', 'method_key', 'method_version',
  'archived', 'target_changed', 'artifact_changed', 'stock_changed', 'component_changed', 'stock_quantity', 'component_quantity', 'waste_percent', 'purchase_increment']) assert.equal(String(r[key]), String(retained[key]), key)
 for (const key of ['required_quantity', 'required_with_waste', 'purchase_quantity']) assert.equal(Number(r[key]), 3)
 assert.equal(Date.parse(r.recorded_at), Date.parse('2026-10-06T07:46:56.68927Z'))
 assert.deepEqual(s, { project_id: retained.project_id, requirement_id: K4_SHELF_REQUIREMENT, requirement_revision: 1,
  artifact_id: retained.artifact_id, artifact_revision: 4, definition_id: 'shelf_panel', quantity_mode: 'pieces',
  instance_ids: ['bottom_panel', 'middle_shelf', 'top_panel'], blank_mm: { x: 658, y: 300, z: 21 },
  material_binding: { definition_id: 'shelf_panel', material_id: '766d4e1a-db42-4a0e-af25-da2739783fc4', material_revision: 1, part_id: null, part_revision: null } })
 assert.equal(h.requirement_id, r.id); assert.equal(h.project_id, r.project_id); assert.equal(h.revision, 1); assert.equal(h.recorded_at, r.recorded_at)
}

// The completed read-only trial is the sole starting turn for saved-plan acceptance.
export const K4_CUT_PLAN_PREVIOUS_TURN = '58d32191-8ac0-4847-8df7-8083f96c75e3'

// Recheck only this completed saved turn/plan; never submit a replacement turn.
export const K4_SAVED_CUT_PLAN_TURN = 'cdcbb834-91a9-4aee-9dff-98c847ee4d86'
export const K4_SAVED_CUT_PLAN_ID = '7c9d8791-001e-4b6b-a85b-a3971ebd5842'

// The first paid pack run (2026-10-07) saved its screw need but no product.
// A retry starts from that turn and that need; the two blanks stay unchanged.
export const K4_PACK_RETRY_TURN = '7436d801-7e5c-456a-8035-e7a848d319f1'
export const K4_PACK_LEFTOVER_NEED = '305b4985-d860-4fde-9302-877c1b9a42e0'
export function assertK4PackRetryCheckpoint(requirements, sources, history) {
 const leftover = requirements.find(r => r.id === K4_PACK_LEFTOVER_NEED)
 assert(leftover && leftover.unit === 'pcs' && !leftover.archived && Number(leftover.stock_quantity) === 0 && Number(leftover.component_quantity) === 0,
  'Inspect the leftover screw need before a new model test')
 assert(history.some(h => h.requirement_id === K4_PACK_LEFTOVER_NEED))
 assertK4CutFitCheckpoint(requirements.filter(r => r.id !== K4_PACK_LEFTOVER_NEED), sources.filter(s => s.requirement_id !== K4_PACK_LEFTOVER_NEED),
  history.filter(h => h.requirement_id !== K4_PACK_LEFTOVER_NEED))
}
