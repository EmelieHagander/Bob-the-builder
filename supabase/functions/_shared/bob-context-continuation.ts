import { applyCatalogModelOptions, type AiCatalogSession } from './ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { contextTokenPrefix, countContextTokens, countSerializedTokens } from './bob-token-budget.ts'
import { stableJsonValue } from './bob-job-journal.ts'

type Message = NonNullable<OpenAIServiceOptions['messages']>[number]
type ToolCall = NonNullable<OpenAIServiceResponse['toolCalls']>[number]
type ModelCall = (options: OpenAIServiceOptions, beforeDispatch?: () => Promise<void>) => Promise<OpenAIServiceResponse<any>>
export type ContextSurface = Pick<OpenAIServiceOptions, 'systemMessage' | 'tools' | 'catalogSchemaParameters' | 'catalogToolParameters'>
type Handoff = { summary: string; open_questions: string[]; next_steps: string[]; source_refs: string[] }
type Operation = { call_id: string; tool_name: string; arguments: string; output: Message['content'] }
type Chain = {
  identity: string; seed: Message[]; groups: Message[][]; handoff?: Handoff; compacted: boolean
  pendingInternal: Message[]; inputTokens: number; outputTokens: number
  operations: Map<string, Operation>
}
const HISTORY_TOOL = 'get_work_history'
const PAGE_TOKENS = 1600
const SOURCE_BATCH_TOKENS = 12000
const clone = <T>(value: T): T => structuredClone(value)
/** Operations are write-once records; copy the index, not every recorded
 * output, so a long chain is not deep-cloned twice per step. */
const copyChain = (chain: Chain): Chain => ({ ...clone({ ...chain, operations: undefined }), operations: new Map(chain.operations) })
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Count text separately from native image transport. Base64/URL spelling is
 * not visual token usage. Reserve a conservative per-image allowance until
 * the provider reports actual usage; this is an estimate, not image billing.
 * Only a counting copy changes: original pixels/references stay on the wire. */
// Replay recounts the same chain on every step. Count each message once per
// worker invocation and add one separator token per element, so a resumed
// journal stays within the Edge CPU limit instead of re-encoding the chain.
const messageTokens = new Map<string, number>()
function countInputTokens(value: unknown): number {
  let imageAllowance = 0
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (!object(item)) return item
    if (item.type === 'image_url' && (typeof item.image_url === 'string' || object(item.image_url))) {
      const detail = object(item.image_url) ? item.image_url.detail ?? 'auto' : 'auto'
      imageAllowance += detail === 'low' ? 1024 : 8192
      return { type: 'image_url', image_url: { url: 'image', detail } }
    }
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, normalize(child)]))
  }
  const count = (item: unknown): number => {
    if (Array.isArray(item)) return item.reduce((sum: number, child) => sum + count(child) + 1, 1)
    // Inside an array JSON spells an absent value as null.
    const text = JSON.stringify(item) ?? 'null'
    if (text.length < 256) return countContextTokens(text)
    let tokens = messageTokens.get(text)
    if (tokens === undefined) {
      if (messageTokens.size >= 4096) messageTokens.clear()
      messageTokens.set(text, tokens = countContextTokens(text))
    }
    return tokens
  }
  return count(normalize(value)) + imageAllowance
}

/** The instruction and tool surface repeats on every step; count each exact
 * surface once per invocation. */
const surfaceTokens = new Map<string, number>()
function countSurfaceTokens(value: unknown): number {
  const text = JSON.stringify(value)
  let tokens = surfaceTokens.get(text)
  if (tokens === undefined) {
    if (surfaceTokens.size >= 64) surfaceTokens.clear()
    surfaceTokens.set(text, tokens = countContextTokens(text))
  }
  return tokens
}

/** A page boundary is a Unicode-codepoint offset into an immutable original.
 * This is paging, never truncation of the persisted source. */
function textPage(text: string, after: number, tokens: number): { text: string; next: number | null } {
  const chars = Array.from(text)
  if (after > chars.length) throw new Error('context_cursor_invalid')
  // Encode a bounded window from the cursor, never the whole remaining source:
  // a resumed job re-pages every summarized batch, under the Edge CPU limit.
  let span = Math.max(256, tokens * 8), window: string
  for (;;) {
    window = chars.slice(after, after + span).join('')
    if (after + span >= chars.length || countContextTokens(window) > tokens) break
    span *= 2
  }
  const page = Array.from(contextTokenPrefix(window, tokens)).length
  if (page === 0 && after < chars.length) throw new Error('context_page_unavailable')
  const low = after + page
  return { text: chars.slice(after, low).join(''), next: low < chars.length ? low : null }
}

function statusOf(operation: Operation): Record<string, unknown> {
  let output: unknown = operation.output
  try { if (typeof output === 'string') output = JSON.parse(output) } catch { /* exact original remains available */ }
  return { call_id: operation.call_id, tool_name: operation.tool_name,
    ...(object(output) && typeof output.status === 'string' ? { status: output.status } : {}),
    ...(object(output) && typeof output.saved === 'boolean' ? { saved: output.saved } : {}) }
}

function resultMessage(result: OpenAIServiceResponse): Message {
  return { role: 'assistant', content: typeof result.data === 'string' ? result.data : result.data === null ? '' : JSON.stringify(result.data),
    ...(result.toolCalls?.length ? { tool_calls: clone(result.toolCalls) } : {}),
    ...(result.outputPhase === 'commentary' || result.outputPhase === 'final_answer' ? { phase: result.outputPhase } : {}) }
}

function initialMessages(options: OpenAIServiceOptions): Message[] {
  if (options.messages?.length) return clone(options.messages)
  // Existing Bob specialist callers normalize image requests to messages. A
  // prompt-only image/PDF request must keep its original wire, never pretend
  // that serializing its URL means its pixels reached a fresh conversation.
  if (options.images?.length) throw new Error('context_image_seed_requires_messages')
  return [{ role: 'user', content: options.prompt ?? '' }]
}

/** Do not feed image encodings to a text summarizer. The original is retained
 * by the journal; exact native image messages remain in the recent exchange. */
function compactSource(messages: Message[][]): unknown {
  return messages.map(group => group.map(message => ({ ...message,
    content: Array.isArray(message.content) ? message.content.map(part => part.type === 'image_url'
      ? { type: 'archived_image', reference: typeof part.image_url === 'string' && part.image_url.startsWith('private-image:') ? part.image_url : null }
      : part) : message.content,
  })))
}

function validHandoff(value: unknown, allowed: ReadonlySet<string>, tokens: number): value is Handoff {
  return object(value) && Object.keys(value).length === 4 && typeof value.summary === 'string' && !!value.summary.trim()
    && value.summary.length <= 12000
    && ['open_questions', 'next_steps'].every(key => Array.isArray(value[key]) && value[key].length <= 12
      && value[key].every((item: unknown) => typeof item === 'string' && item.length <= 600))
    && Array.isArray(value.source_refs) && value.source_refs.length <= 80
    && value.source_refs.every((ref: unknown) => typeof ref === 'string' && ref.length <= 180 && allowed.has(ref))
    && countSerializedTokens(value) <= tokens
}

/** Request-local context management shared by main Bob and every colleague.
 *
 * callModel MUST be the existing journalled dispatcher. The adapter is outside
 * that journal: replay reconstructs identical chains/archives from recorded
 * results, and each compactor call is recorded before the fresh provider call.
 * Neither replay nor compaction executes a project operation. Historical
 * execution manifests opt out completely via version 0.
 *
 * The threshold is a refresh target, not a work quota or a claim about a
 * provider's maximum context window. Exact assignment/current instructions and
 * unresolved native tool protocol are never shortened to meet it.
 */
export function createBobContextContinuation(opts: {
  version?: number; aiCatalog: AiCatalogSession; callModel: ModelCall
  snapshot?: (value: { functionName: string; role: string }) => unknown
  onRollover?: (value: { functionName: string; role: string }) => void
  refreshSurface?: (value: { functionName: string; role: string }) => Promise<ContextSurface | undefined>
}) {
  const chains = new Map<string, Chain>()
  const enabled = opts.version === 1
  const policy = enabled ? opts.aiCatalog.definition('agent-contract.ask-bob', 'agent_contract').metadata : {}
  const limit = Number(policy.continuation_input_tokens)
  const ceiling = Number(policy.context_input_ceiling_tokens)
  const summaryLimit = Number(policy.continuation_summary_tokens)
  const keep = Number(policy.retained_tool_exchanges)
  // Existing pinned manifests must reconstruct their recorded summarizer and
  // model inputs byte-for-byte. Only newly activated manifests use the fixed
  // exchange counter; an unknown explicit version is never guessed.
  const retentionVersion = policy.continuation_retention_version === undefined ? 1 : policy.continuation_retention_version
  if (enabled && (!Number.isInteger(limit) || limit < 1000 || !Number.isInteger(ceiling) || ceiling < limit
    || !Number.isInteger(summaryLimit) || summaryLimit < 100
    || !Number.isInteger(keep) || keep < 1 || keep > 10
    || (retentionVersion !== 1 && retentionVersion !== 2))) throw new Error('context_strategy_invalid')

  const readArchivedOperation = (input: unknown, chain?: Chain): Record<string, unknown> => {
    if (!enabled || !object(input) || Object.keys(input).some(key => !['call_id', 'after'].includes(key))
      || !(input.call_id === null || typeof input.call_id === 'string' && input.call_id.length > 0 && input.call_id.length <= 180)
      || !(input.after === null || Number.isInteger(input.after) && Number(input.after) >= 0)) return { status: 'invalid' }
    if (!chain) return { status: 'not_found' }
    const after = Number(input.after ?? 0)
    if (input.call_id === null) {
      const all = [...chain.operations.values()]
      if (after > all.length) return { status: 'invalid' }
      const page = all.slice(after, after + 20).map(statusOf)
      const next = after + page.length < all.length ? after + page.length : null
      return { status: 'ok', operations: page, after, next_after: next, truncated: next !== null }
    }
    const operation = chain.operations.get(input.call_id as string)
    if (!operation) return { status: 'not_found' }
    try {
      const page = textPage(JSON.stringify({ arguments: operation.arguments, output: operation.output }), after, PAGE_TOKENS - 100)
      return { status: 'ok', call_id: operation.call_id, tool_name: operation.tool_name,
        content: page.text, after, next_after: page.next, truncated: page.next !== null }
    } catch { return { status: 'invalid' } }
  }

  const recordOperations = (chain: Chain, incoming: Message[]) => {
    const pending = chain.groups.flatMap(group => group.flatMap(message => message.tool_calls ?? []))
    for (const message of incoming) {
      if (message.role !== 'tool' || !message.tool_call_id) continue
      const tool = pending.find(call => call.id === message.tool_call_id)
      if (!tool) throw new Error('context_tool_protocol_invalid')
      const operation = { call_id: tool.id, tool_name: tool.function.name, arguments: tool.function.arguments, output: clone(message.content) }
      const prior = chain.operations.get(tool.id)
      if (prior && JSON.stringify(stableJsonValue(prior)) !== JSON.stringify(stableJsonValue(operation))) throw new Error('context_operation_changed')
      chain.operations.set(tool.id, operation)
    }
  }

  const summarize = async (options: OpenAIServiceOptions, chain: Chain, groups: Message[][], beforeDispatch?: () => Promise<void>): Promise<Handoff> => {
    const refs = new Set([...(chain.handoff?.source_refs ?? []), ...groups.flatMap(group => group.flatMap(message =>
      (message.tool_calls ?? []).map(call => 'operation:' + call.id)))])
    // Source batches are independently bounded, including the manager's own
    // input. Its previous compact handoff is the only carried context.
    const source = JSON.stringify(stableJsonValue(compactSource(groups)))
    let after = 0, handoff = chain.handoff
    do {
      const page = textPage(source, after, SOURCE_BATCH_TOKENS)
      let accepted: Handoff | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await opts.callModel({ app: options.app, coworkerId: options.coworkerId,
          userId: options.userId, workspaceId: options.workspaceId, module: 'context', functionName: 'context-summary',
          aiFunction: 'context-summary', catalogRoleKey: 'context-compactor', catalogSchemaKey: 'bob_context_handoff',
          messages: [{ role: 'user', content: JSON.stringify({ role: options.catalogRoleKey ?? options.functionName,
            previous_handoff: handoff ?? null, source_segment: { after, text: page.text, has_more: page.next !== null },
            allowed_source_refs: [...refs].filter(ref => handoff?.source_refs.includes(ref) || page.text.includes(ref.slice('operation:'.length))).sort(), summary_max_tokens: summaryLimit,
            ...(attempt ? { validation_issues: ['invalid_shape_source_reference_or_token_limit'] } : {}) }) }],
          timeoutMs: options.timeoutMs,
        }, beforeDispatch)
        let candidate = response.data
        try { if (typeof candidate === 'string') candidate = JSON.parse(candidate) } catch { /* repair through the same catalog role */ }
        if (response.success && validHandoff(candidate, refs, summaryLimit)) { accepted = clone(candidate); break }
      }
      if (!accepted) throw new Error('context_compaction_unavailable')
      handoff = accepted
      if (page.next === null) break
      after = page.next
    } while (true)
    return handoff!
  }

  const call: ModelCall = async (requested, beforeDispatch) => {
    // The compactor is deliberately not recursive. Other callers can use this
    // adapter without rewriting their schema, specialist loop or old journal.
    if (!enabled || requested.catalogRoleKey === 'context-compactor') return opts.callModel(requested, beforeDispatch)
    let options = requested
    for (;;) {
      const consumedResponseId = options.previousResponseId
      const identity = JSON.stringify([options.app, options.coworkerId, options.functionName, options.catalogRoleKey ?? options.functionName])
      let chain: Chain
      if (options.previousResponseId) {
        const previous = chains.get(options.previousResponseId)
        if (!previous) throw new Error('context_chain_unavailable')
        if (previous.identity !== identity) throw new Error('context_chain_scope_mismatch')
        chain = copyChain(previous)
        const incoming = [...chain.pendingInternal, ...clone(options.messages ?? [])]
        chain.pendingInternal = []
        recordOperations(chain, incoming)
        chain.groups.at(-1)!.push(...incoming)
        options = { ...options, messages: incoming }
      } else {
        // A one-shot prompt-only image request needs no continuation shadow.
        if (!options.messages?.length && options.images?.length) return opts.callModel(options, beforeDispatch)
        chain = { identity, seed: initialMessages(options), groups: [], compacted: false, pendingInternal: [], inputTokens: 0, outputTokens: 0, operations: new Map() }
      }
      // This wrapper is deliberately outside catalog resolution/journalling.
      // Resolve a counting copy: caller options may contain only a schema key
      // or thin tool cards while the actual wire carries their complete bound
      // schemas. Keep the original options unchanged for stable replay.
      const resolved = applyCatalogModelOptions(opts.aiCatalog, options)
      const fixed = Math.ceil(countSurfaceTokens({ instruction: resolved.systemMessage,
        tools: resolved.tools ?? [], schema: resolved.schema ?? null,
        schemaName: resolved.schemaName ?? null, schemaDescription: resolved.schemaDescription ?? null }) * 1.1) + 256
      const input = countInputTokens(options.messages ?? options.prompt ?? '')
      if (fixed + input > ceiling) throw new Error('context_input_too_large')
      const estimate = Math.max(fixed + countInputTokens([chain.seed, chain.handoff, chain.groups]),
        chain.inputTokens + chain.outputTokens + fixed + input)
      if (options.previousResponseId && estimate >= limit && chain.groups.length > keep) {
        const all = chain.groups.flat()
        const calls = all.flatMap(message => message.tool_calls ?? [])
        // Never cross an unfinished native call/output boundary. Callers may
        // submit parallel outputs separately; preserve that provider chain.
        const complete = calls.every(tool => all.some(message => message.role === 'tool' && message.tool_call_id === tool.id))
        let split = chain.groups.length - keep
        if (retentionVersion === 2) {
          // An exchange is a native assistant tool-call batch plus all of its
          // outputs, not any assistant response. Commentary and completion
          // review nudges cannot consume a retained exchange slot. Keep the
          // contiguous suffix so those intervening messages stay exact too.
          // With no calls, retain the latest response and incoming context.
          split = chain.groups.length - 1
          let exchanges = 0
          for (let i = chain.groups.length - 1; i >= 0; i--) {
            if (!chain.groups[i].some(message => message.tool_calls?.length)) continue
            split = i
            if (++exchanges === keep) break
          }
        }
        // A late output can belong to an earlier parallel call. Retain that
        // call's entire group too, so a fresh native input never starts with an
        // orphaned function_call_output.
        for (let i = chain.groups.length - 1; i >= split; i--) for (const message of chain.groups[i]) {
          if (message.role !== 'tool') continue
          const owner = chain.groups.findIndex(group => group.some(item => item.tool_calls?.some(tool => tool.id === message.tool_call_id)))
          if (owner >= 0) split = Math.min(split, owner)
        }
        if (complete && split > 0) {
          chain.handoff = await summarize(options, chain, chain.groups.slice(0, split), beforeDispatch)
          chain.groups = chain.groups.slice(split)
          chain.compacted = true
          const rollover = { functionName: options.functionName, role: options.catalogRoleKey ?? options.functionName }
          // The owning tool session rebuilds its offered fence together with
          // its schemas/instructions. Never advertise previously loaded tools
          // after their manuals have moved into the summarized history.
          const surface = await opts.refreshSurface?.(rollover)
          if (surface) options = { ...options, ...surface }
          const recentOperations = [...chain.operations.values()].slice(-40).map(statusOf)
          const { previousResponseId: _previous, prompt: _prompt, ...fresh } = options
          options = { ...fresh, messages: [...clone(chain.seed), { role: 'user', content: JSON.stringify({
            context_handoff: chain.handoff, original_assignment_preserved: true,
            completed_operations: recentOperations, operation_archive: { tool: HISTORY_TOOL, list: { call_id: null, after: null } },
            ...(opts.snapshot ? { confirmed_work_state: opts.snapshot({ functionName: options.functionName, role: options.catalogRoleKey ?? options.functionName }) } : {}),
          }) }, ...clone(chain.groups.flat())] }
          opts.onRollover?.(rollover)
        }
      }
      if (chain.compacted) {
        const history = opts.aiCatalog.tool(HISTORY_TOOL)
        options = { ...options, tools: [...(options.tools ?? []).filter(tool => tool.function.name !== HISTORY_TOOL), history],
          ...(options.catalogSchemaKey || options.schema ? { structuredToolOutput: true } : {}) }
      }
      // Compaction preserves the exact seed and native tool exchanges. If
      // these indispensable inputs themselves exceed the configured envelope,
      // report it rather than silently trimming the assignment or tool result.
      if (!options.previousResponseId) {
        const fresh = applyCatalogModelOptions(opts.aiCatalog, options)
        const freshTokens = Math.ceil(countSurfaceTokens({ instruction: fresh.systemMessage,
          tools: fresh.tools ?? [], schema: fresh.schema ?? null,
          schemaName: fresh.schemaName ?? null, schemaDescription: fresh.schemaDescription ?? null }) * 1.1) + 256
          + countInputTokens(fresh.messages ?? fresh.prompt ?? '')
        if (freshTokens > ceiling) throw new Error('context_input_too_large')
      }
      const response = await opts.callModel(options, beforeDispatch)
      if (!response.success || !response.responseId) return response
      chain.inputTokens = Math.max(0, response.usage.input_tokens)
      chain.outputTokens = Math.max(0, response.usage.output_tokens)
      chain.groups.push([resultMessage(response)])
      const internal: ToolCall[] = chain.compacted ? response.toolCalls?.filter(tool => tool.function.name === HISTORY_TOOL) ?? [] : []
      const external = response.toolCalls?.filter(tool => !internal.includes(tool)) ?? []
      for (const tool of internal) {
        let input: unknown
        try { input = JSON.parse(tool.function.arguments) } catch { input = null }
        chain.pendingInternal.push({ role: 'tool', tool_call_id: tool.id, content: JSON.stringify(readArchivedOperation(input, chain)) })
      }
      chains.set(response.responseId, copyChain(chain))
      // Only the live head is needed. Keeping a full archive copy at every
      // historical response would make long work consume quadratic RAM.
      if (consumedResponseId && consumedResponseId !== response.responseId) chains.delete(consumedResponseId)
      if (!internal.length) return response
      if (external.length) return { ...response, toolCalls: external }
      // History-only calls stay inside this adapter. Mixed batches deliver the
      // remaining calls to the owning loop, then join both exact output sets
      // on its next invocation. The journal always sees the raw model result.
      options = { ...options, previousResponseId: response.responseId, messages: [], prompt: undefined }
    }
  }
  // Native readers are implicitly bound to their own chain. This explicit
  // server-only accessor requires the same response identity for diagnostics.
  return { call, readOperation: (input: unknown, responseId?: string) => readArchivedOperation(input, responseId ? chains.get(responseId) : undefined) }
}
