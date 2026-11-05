import type { OpenAIServiceOptions } from './openai-service.ts'
import { readResponseItems } from './openai-content.ts'

type Message = NonNullable<OpenAIServiceOptions['messages']>[number]
/** Installing code is not activation. New jobs opt in through an immutable
 * catalog contract; existing jobs retain their recorded execution identity. */
export function bobCompleteRequestVersions(checkpoint: boolean, metadata: Record<string, unknown>): { completeRequestVersion?: 1; resultReferenceVersion?: 1; imageInputDedupVersion?: 1 } {
  if (metadata.complete_request_version === undefined && metadata.result_reference_version === undefined) return {}
  if (metadata.complete_request_version !== 1 || metadata.result_reference_version !== 1 || metadata.context_strategy_version !== 1) throw new Error('complete_request_contract_invalid')
  // Called only inside the journalled execution-identity factory. Restored
  // jobs keep their recorded pins; only newly created identities adopt this.
  return checkpoint ? { completeRequestVersion: 1, resultReferenceVersion: 1, imageInputDedupVersion: 1 } : {}
}
export type BobRequestState = {
  seed: Message[]
  history: Message[]
  /** Transitional context handoff; PR3 replaces it with exact result references. */
  handoff?: Message
  historicalImages?: Message[]
  imageInputDedupVersion?: 1
}

/** Deduplicate only private resolver identities in this complete request.
 * Their exact version is part of the reference; public URLs need not name
 * immutable pixels. Keep the first occurrence to preserve the earlier native
 * prefix and every text/metadata notice. The caller's archive is unchanged. */
function uniqueImageInputs(messages: Message[]): Message[] {
  const seen = new Set<string>()
  return messages.flatMap(message => {
    if (message.role !== 'user' || message.nativeOutput !== undefined || message.tool_calls?.length || message.tool_call_id || !Array.isArray(message.content)) return [message]
    const content = message.content.filter(part => {
      if (part.type !== 'image_url') return true
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url
      if (!url.startsWith('private-image:')) return true
      const detail = typeof part.image_url === 'string' ? 'auto' : part.image_url.detail ?? 'auto'
      const key = JSON.stringify([url, detail])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return content.length ? [{ ...message, content }] : []
  })
}

/** One complete provider input, rebuilt from the restored turn. The local
 * response cursor can locate state, but must never become a provider chain.
 * Private pixels are hydrated later, only for a fresh authorized submission. */
export function buildBobRequest(options: OpenAIServiceOptions, state: BobRequestState): OpenAIServiceOptions {
  const { previousResponseId: _cursor, prompt: _prompt, ...request } = options
  if (state.imageInputDedupVersion !== undefined && state.imageInputDedupVersion !== 1) throw new Error('image_input_dedup_version_invalid')
  const original = structuredClone([...state.seed, ...(state.handoff ? [state.handoff] : []),
    ...(state.historicalImages ?? []), ...state.history])
  const messages = state.imageInputDedupVersion === 1 ? uniqueImageInputs(original) : original
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
