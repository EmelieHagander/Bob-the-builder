/** Canonical preflight for the v4 Construction review gate before handing work
 * to Konrad. Unlike a model suggestion, this is read from the authorized
 * database and must not be overridden by a tool prompt or workpad.
 *
 * No database writes, no automatic Step changes, and no inferred user approval.
 * Projects without a configured review policy keep their existing behavior.
 */
export function constructionPieceHandoffGate(piece: Record<string, unknown>): Record<string, unknown> | null {
  if (piece.status === 'not_configured' || piece.status === 'ready'
    || piece.status === 'correction_requested') return null

  if (piece.status === 'awaiting_review') return {
    status: 'awaiting_design_review', reason: 'show_saved_construction', worker: 'structure-worker',
    saved_revision: piece.saved_revision, artifact_id: piece.artifact_id,
    view_id: piece.pending_view, user_feedback: 'not_recorded',
    note: 'Show the exact saved construction and matching facade view. Ask naturally whether the placement matches before another construction edit.',
  }

  // The approved Plan may be complete in evidence yet still focused on the
  // preceding Step. Konrad cannot save this workpiece until Bob explicitly
  // changes focus through the ordinary authorized Plan tool.
  if (piece.status === 'not_focused') return {
    status: 'needs_verification',
    reason: 'construction_piece_step_not_focused',
    worker: 'structure-worker',
    required_step_id: typeof piece.step_id === 'string' ? piece.step_id : null,
    current_focus_step_id: typeof piece.focus_step_id === 'string' ? piece.focus_step_id : null,
    plan_revision: Number.isSafeInteger(piece.plan_revision) ? piece.plan_revision : null,
    note: 'The Plan is still focused on another Step. Read its evidence and confirm it is complete, then use the authorized plan-focus flow to select the intended facade-opening Step before delegating construction again. Do not mark steps completed or change geometry merely to bypass the gate.',
  }

  // Including unfamiliar statuses: fail closed, never pay for a specialist
  // whose save will later be refused by the database.
  return { status: 'needs_verification', reason: 'construction_piece_gate_unavailable',
    worker: 'structure-worker' }
}
