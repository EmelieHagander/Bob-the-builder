// Only exact application codes may cross RPC/worker boundaries. Provider and
// database diagnostics can contain private payloads and stay out of job status.
const codes = new Set([
  'drawing_request_cancelled', 'drawing_context_cleared', 'drawing_request_complete',
  'drawing_request_changed', 'drawing_request_denied', 'drawing_request_not_paused',
  'drawing_request_inactive', 'drawing_scope_changed', 'drawing_requirements_changed',
  'drawing_requirements_unavailable', 'drawing_restore_conflict', 'request_quote_required',
  'drawing_request_pixels_forbidden', 'project_denied', 'revision_conflict',
  'drawing_continuation_mismatch', 'drawing_packet_mismatch', 'drawing_write_turn_changed',
  'drawing_execution_ambiguous', 'drawing_execution_mismatch', 'drawing_request_legacy_unsupported',
  'drawing_budget_period_closed', 'budget_period_missing', 'budget_call_not_reserved',
  'budget_receipt_changed', 'invalid_budget_receipt', 'invalid_budget_cost',
  'budget_remaining', 'budget_outcome_unknown', 'budget_changed', 'budget_unavailable',
])

export function drawingErrorCode(error: unknown): string | undefined {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : undefined
  return typeof message === 'string' && codes.has(message) ? message : undefined
}
