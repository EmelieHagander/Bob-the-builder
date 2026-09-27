import type { WriteReadback } from './project-write.ts'

// All drawing writers return a pinned Artifact receipt. A Task, measurement,
// selected solution, rendered-but-unsaved candidate or prose is not delivery.
export const DRAWING_SAVE_TOOLS = new Set(['save_cad_design', 'save_project_drawing', 'save_project_building_plan', 'save_project_stair', 'create_project_room_layout', 'edit_project_room_layout'])
export function hasSavedDrawingReceipt(receipts: WriteReadback[]): boolean {
  // Geometry writers supply these readback fields; link/metadata writers don't.
  return receipts.some(r => r.dataset === 'artifacts' && Number.isSafeInteger(r.revision) && Number(r.revision) > 0
    && !!(r.record.cad === true || r.record.recipe || r.record.multifloor_plan || r.record.stair_study || r.record.room_layout))
}
export function drawingSaved(receipts: WriteReadback[], events: { operation: string; name: string; status: string }[], initiallySaved = false): boolean {
  return receipts.some(r => r.dataset === 'artifacts' && Number.isSafeInteger(r.revision) && Number(r.revision) > 0)
    && (events.some(e => e.operation === 'execute' && DRAWING_SAVE_TOOLS.has(e.name) && e.status === 'saved')
      // Initial recovery is checkpointed: receipts discovered on a later worker
      // must not change an earlier continuation branch during journal replay.
      || initiallySaved && hasSavedDrawingReceipt(receipts))
}
