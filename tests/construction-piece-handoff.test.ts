import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constructionPieceHandoffGate } from '../supabase/functions/_shared/construction-piece-handoff.ts'

const current = {
  status: 'not_focused', plan_revision: 2, artifact_id: 'c1',
  step_id: 'step-windows', focus_step_id: 'step-reconciliation',
  requested_total_openings: 7,
}

test('v4 blocks unfocused facade work before launching a paid specialist', () => {
  const r = constructionPieceHandoffGate(current)!
  assert.equal(r.status, 'needs_verification')
  assert.equal(r.reason, 'construction_piece_step_not_focused')
  assert.equal(r.worker, 'structure-worker')
  assert.equal(r.required_step_id, 'step-windows')
  assert.equal(r.current_focus_step_id, 'step-reconciliation')
  assert.equal(r.plan_revision, 2)
  assert.match(String(r.note), /plan-focus flow/)
  assert.equal('saved_revision' in r, false, 'the gate must not invent a save or approval')
})

test('v4 does not confuse a needed correction or unrelated unconfigured project with a completed facade', () => {
  assert.equal(constructionPieceHandoffGate({ status: 'not_configured' }), null)
  assert.equal(constructionPieceHandoffGate({ status: 'ready' }), null)
  assert.equal(constructionPieceHandoffGate({ status: 'correction_requested', pending_view: 'front' }), null)
  const review = constructionPieceHandoffGate({
    status: 'awaiting_review', artifact_id: 'c1', saved_revision: 3, pending_view: 'front',
  })!
  assert.deepEqual([review.status, review.reason, review.view_id, review.user_feedback],
    ['awaiting_design_review', 'show_saved_construction', 'front', 'not_recorded'])
})

test('v4 fail-closes unknown and inconsistent gate results, with no plan/geometry writes', () => {
  for (const status of ['plan_changed', 'unavailable', 'ambiguous', 'unknown_new_state', undefined]) {
    const blocked = constructionPieceHandoffGate({ status })
    assert.deepEqual({ status: blocked?.status, reason: blocked?.reason },
      { status: 'needs_verification', reason: 'construction_piece_gate_unavailable' })
  }
})
