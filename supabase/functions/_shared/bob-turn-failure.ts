/** Internal diagnostics only. Never record exception text, provider payloads or
 * project content, including strings that happen to look like an error code. */
const stages = ['recover', 'prepare_context', 'answer', 'checkpoint', 'model', 'settle', 'current_view', 'project_context', 'commit'] as const
export type BobTurnFailureStage = typeof stages[number]
export type BobTurnFailure = { stage: BobTurnFailureStage; code: string }
const codes = new Set([
  'context_preparing', 'context_unavailable', 'context_input_too_large', 'project_denied', 'tool_catalog_unavailable',
  'turn_budget_exhausted', 'turn_timeout', 'ai_unavailable', 'unsupported_tool_response', 'tool_no_progress',
  'commentary_limit', 'empty_response', 'step_budget_exhausted', 'provider_state_unavailable',
  'turn_checkpoint_too_large', 'context_checkpoint_image_not_reference', 'context_checkpoint_invalid',
  'context_chain_unavailable', 'context_chain_scope_mismatch', 'context_operation_changed', 'context_operation_unavailable',
  'context_tool_protocol_invalid', 'context_compaction_unavailable', 'context_page_unavailable', 'context_cursor_invalid',
  'context_changed', 'context_image_seed_requires_messages',
  'bob_native_output_orphan', 'bob_native_call_unfinished', 'bob_native_call_duplicate',
  'image_not_opened', 'private_image_resolver_missing', 'provider_image_unsupported',
  'write_not_saved', 'conversation_unavailable',
])
export function bobTurnFailure(stage: BobTurnFailureStage, error: unknown): BobTurnFailure {
  const message = error instanceof Error ? error.message : error
  return { stage: stages.includes(stage) ? stage : 'answer',
    code: typeof message === 'string' && codes.has(message) ? message : 'unclassified' }
}
