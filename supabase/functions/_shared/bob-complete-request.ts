import type { OpenAIServiceOptions } from './openai-service.ts'
import { readResponseItems } from './openai-content.ts'

type Message = NonNullable<OpenAIServiceOptions['messages']>[number]
/** Installing code is not activation. New jobs opt in through an immutable
 * catalog contract; existing jobs retain their recorded execution identity. */
export function bobCompleteRequestVersions(checkpoint: boolean, metadata: Record<string, unknown>): { completeRequestVersion?: 1; resultReferenceVersion?: 1 } {
  if (metadata.complete_request_version === undefined && metadata.result_reference_version === undefined) return {}
  if (metadata.complete_request_version !== 1 || metadata.result_reference_version !== 1 || metadata.context_strategy_version !== 1) throw new Error('complete_request_contract_invalid')
  return checkpoint ? { completeRequestVersion: 1, resultReferenceVersion: 1 } : {}
}
export type BobRequestState = {
  seed: Message[]
  history: Message[]
  /** Transitional context handoff; PR3 replaces it with exact result references. */
  handoff?: Message
  historicalImages?: Message[]
}

/** One complete provider input, rebuilt from the restored turn. The local
 * response cursor can locate state, but must never become a provider chain.
 * Private pixels are hydrated later, only for a fresh authorized submission. */
export function buildBobRequest(options: OpenAIServiceOptions, state: BobRequestState): OpenAIServiceOptions {
  const { previousResponseId: _cursor, prompt: _prompt, ...request } = options
  const messages = structuredClone([...state.seed, ...(state.handoff ? [state.handoff] : []),
    ...(state.historicalImages ?? []), ...state.history])
  const calls = new Set<string>(), outputs = new Set<string>()
  for (const message of messages) {
    if (message.nativeOutput) {
      if (message.role !== 'assistant') throw new Error('bob_native_output_role_invalid')
      for (const item of readResponseItems(message.nativeOutput)) if (item.type === 'function_call') {
        const id = String(item.call_id)
        if (calls.has(id)) throw new Error('bob_native_call_duplicate')
        calls.add(id)
      }
    } else for (const call of message.tool_calls ?? []) {
      if (calls.has(call.id)) throw new Error('bob_native_call_duplicate')
      calls.add(call.id)
    }
    if (message.role === 'tool') {
      if (!message.tool_call_id || !calls.has(message.tool_call_id) || outputs.has(message.tool_call_id)) throw new Error('bob_native_output_orphan')
      outputs.add(message.tool_call_id)
    }
  }
  if ([...calls].some(id => !outputs.has(id))) throw new Error('bob_native_call_unfinished')
  return { ...request, messages, responseItemsMode: 'preserve', responsePhaseMode: 'aware' }
}
