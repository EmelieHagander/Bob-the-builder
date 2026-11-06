import { applyCatalogModelOptions, textContinuationMode, type AiCatalogSession } from './ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { contextTokenPrefix, countContextTokens, countSerializedTokens } from './bob-token-budget.ts'
import { stableJsonValue } from './bob-job-journal.ts'
import { saveReceipt } from './bob-workers.ts'
import { buildBobRequest, type BobImageInputCounts } from './bob-complete-request.ts'
import { readResponseItems } from './openai-content.ts'
import { STAGE_CONTEXT_TOOL, parseStageContextNote, prepareStageContext, type StageContextNote } from './bob-stage-context.ts'
import { releaseUsedImages } from './bob-image-release.ts'
import { bobResultPage, projectBobResult, prepareBobResult, selectBobResultWindow, supersededBobResult, BOB_RESULT_PAGE_TOKENS, type BobArchivedOperation } from './bob-result-references.ts'

type Message = NonNullable<OpenAIServiceOptions['messages']>[number]
type ToolCall = NonNullable<OpenAIServiceResponse['toolCalls']>[number]
type ModelCall = (options: OpenAIServiceOptions, beforeDispatch?: () => Promise<void>, imageInputs?: BobImageInputCounts) => Promise<OpenAIServiceResponse<any>>
export type ContextSurface = Pick<OpenAIServiceOptions, 'systemMessage' | 'tools' | 'catalogSchemaParameters' | 'catalogToolParameters' | 'catalogRuntimeSurface'>
type Handoff = { summary: string; open_questions: string[]; next_steps: string[]; source_refs: string[] }
type Operation = BobArchivedOperation
type Chain = {
  identity: string; seed: Message[]; groups: Message[][]; handoff?: Handoff; compacted: boolean
  pendingInternal: Message[]; inputTokens: number; outputTokens: number
  operations: Map<string, Operation>
  historicalImages?: Message[]
  resultReferences?: 1
  stageNote?: StageContextNote
}
/** Only live provider heads are retained. Map entries are arrays on disk so
 * a worker can restore a chain without replaying completed model/tool calls. */
export interface BobContextContinuationState {
  version: 1;
  strategyVersion: number;
  resultReferenceVersion?: 1;
  imageInputDedupVersion?: 1;
  stageContextVersion?: 1;
  workerStageContextVersion?: 1;
  imageReleaseVersion?: 1;
  chains: [string, Omit<Chain, 'operations'> & { operations: [string, Operation][] }][];
}
const HISTORY_TOOL = 'get_work_history'
const PAGE_TOKENS = 1600
/** The main-turn ceiling sizes Bob's own conversation. A specialist's single
 * request (e.g. the CAD review with its preview images) is bounded by its own
 * model, so it gets this wider envelope: a 2026-10-20 review stopped at 96k. */
export const SPECIALIST_INPUT_CEILING_TOKENS = 200000
const SOURCE_BATCH_TOKENS = 12000
const clone = <T>(value: T): T => structuredClone(value)
/** Operations are write-once records; copy the index, not every recorded
 * output, so a long chain is not deep-cloned twice per step. */
const copyChain = (chain: Chain): Chain => ({ ...clone({ ...chain, operations: undefined }), operations: new Map(chain.operations) })
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
/** A result already replaced by a historical reference in the transcript. */
const omittedContent = (content: unknown): boolean => {
  if (typeof content !== 'string' || !content.startsWith('{')) return false
  try { return (JSON.parse(content) as { content_omitted?: unknown }).content_omitted === true } catch { return false }
}

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
  let reasoningAllowance = 0
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (!object(item)) return item
    if (item.nativeOutput !== undefined) {
      // Count every visible native item (including commentary beside calls)
      // once. Ciphertext length is not its token count; use reported usage.
      const { nativeOutput, nativeReasoningTokens } = item
      reasoningAllowance += typeof nativeReasoningTokens === 'number' ? nativeReasoningTokens : 0
      return normalize((nativeOutput as Record<string, unknown>[]).map(({ encrypted_content: _opaque, ...visible }) => visible))
    }
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
  const normalized = normalize(value)
  return count(normalized) + imageAllowance + reasoningAllowance
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

/** Conservative provider input estimate, including reported native reasoning
 * and image allowance. Ciphertext size is transport, never billed tokens. */
export function estimateBobRequestInput(request: OpenAIServiceOptions) {
  const surface = Math.ceil(countSurfaceTokens({ instruction: request.systemMessage,
    tools: request.tools ?? [], schema: request.schema ?? null,
    schemaName: request.schemaName ?? null, schemaDescription: request.schemaDescription ?? null }) * 1.1) + 256
  const conversation = countInputTokens(request.messages ?? request.prompt ?? '')
  return { surface, conversation, total: surface + conversation }
}

/** A page boundary is a Unicode-codepoint offset into an immutable original.
 * This is paging, never truncation of the persisted source. */
// summarize() pages one source many times; split it into codepoints once.
let pagedText: { text: string; chars: string[] } | undefined
function textPage(text: string, after: number, tokens: number): { text: string; next: number | null } {
  if (pagedText?.text !== text) pagedText = { text, chars: Array.from(text) }
  const chars = pagedText.chars
  if (after > chars.length) throw new Error('context_cursor_invalid')
  // Encode a bounded window from the cursor, never the whole remaining source:
  // a resumed job re-pages every summarized batch, under the Edge CPU limit.
  // A window that fits whole is returned unchanged; only then is it widened.
  let span = Math.max(256, tokens * 8), prefix: string
  for (;;) {
    const window = chars.slice(after, after + span).join('')
    prefix = contextTokenPrefix(window, tokens)
    if (after + span >= chars.length || prefix !== window) break
    span *= 2
  }
  const page = Array.from(prefix).length
  if (page === 0 && after < chars.length) throw new Error('context_page_unavailable')
  const low = after + page
  return { text: chars.slice(after, low).join(''), next: low < chars.length ? low : null }
}

// Operations are write-once, and a rollover lists the latest forty again.
const statuses = new WeakMap<Operation, Record<string, unknown>>()
function statusOf(operation: Operation): Record<string, unknown> {
  let status = statuses.get(operation)
  if (!status) statuses.set(operation, status = readStatus(operation))
  return { ...status }
}
function readStatus(operation: Operation): Record<string, unknown> {
  let output: unknown = operation.output
  try { if (typeof output === 'string') output = JSON.parse(output) } catch { /* exact original remains available */ }
  return { call_id: operation.call_id, tool_name: operation.tool_name,
    ...(object(output) && typeof output.status === 'string' ? { status: output.status } : {}),
    ...(object(output) && typeof output.saved === 'boolean' ? { saved: output.saved } : {}) }
}

function workerStageFacts(operation: Operation): Record<string, unknown> {
  let output: unknown = operation.output
  try { if (typeof output === 'string') output = JSON.parse(output) } catch { /* exact output remains archived */ }
  return { ...statusOf(operation), ...saveReceipt(operation.tool_name, output) }
}

function resultMessage(result: OpenAIServiceResponse): Message {
  return { role: 'assistant', content: typeof result.data === 'string' ? result.data : result.data === null ? '' : JSON.stringify(result.data),
    ...(result.toolCalls?.length ? { tool_calls: clone(result.toolCalls) } : {}),
    ...(result.outputPhase === 'commentary' || result.outputPhase === 'final_answer' ? { phase: result.outputPhase } : {}),
    ...(result.outputItems ? { nativeOutput: readResponseItems(result.outputItems), nativeReasoningTokens: result.usage.reasoning_tokens ?? 0 } : {}) }
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
  return messages.map(group => group.map(({ nativeOutput: _opaque, nativeReasoningTokens: _tokens, ...message }) => ({ ...message,
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
  /** Pinned only for new native main turns. CAD and legacy jobs keep their
   * existing compactor and archive cursor contract. */
  mainResultReferences?: 1
  /** New execution identities only; old journalled requests remain exact. */
  imageInputDedupVersion?: 1
  /** Explicit, source-bound stage handoff; published only for new main jobs. */
  stageContextVersion?: 1
  /** New worker chains use the same exact archive and explicit stage lifecycle. */
  workerStageContextVersion?: 1
  imageSource?: (url: string) => string | undefined
  /** New executions only: opened pixels leave after use (owner decision 2026-11-06). */
  imageReleaseVersion?: 1
  onInternalTool?:(input:{name:string;status:string;callId:string;role:string;ms:number})=>Promise<void>
  /** Pinned per execution. Older results stay whole, newest first, up to this
   * many tokens before they become references. A fixed two-exchange window
   * hid results Bob had just reopened, so he reopened them again (2026-10-20). */
  resultWindowTokens?: number
  /** Pinned per execution with resultWindowTokens. 2 (2026-10-29): an older
   * read repeated later leaves first and the latest result per record stays
   * whole; see selectBobResultWindow. Absent keeps the version 1 window. */
  resultWindowVersion?: 2
  /** Pinned per job (2026-11-01). Workers and other specialists refresh at this
   * many tokens instead of Bob's continuation limit. At 64k Konrad's chain was
   * summarized almost every step on a 70-part construction, so he lost the
   * pages he had read and read them again without saving. Capped below the
   * specialist ceiling. Absent keeps Bob's limit for every role. */
  specialistContinuationTokens?: number
  /** Per-tool literal size for a recent result, pinned per job. Tools not
   * named here keep BOB_RESULT_PAGE_TOKENS. */
  literalResultTokens?: Record<string, number>
  /** Pinned per execution. Version 1 counts the provider-reported input once
   * (it already contains the tool surface) and refreshes only when the part
   * it would summarize is large enough to make the next request smaller. */
  rolloverVersion?: 1
  /** Pinned with the prompt tiers (2026-10-30). Older exchanges are compacted
   * (results to references, reasoning removed) this many at a time, so the
   * start of the input stays byte-identical between batches and is read from
   * the provider's prompt cache. Absent compacts one exchange per step. */
  compactionBatch?: number
  snapshot?: (value: { functionName: string; role: string }) => unknown
  onRollover?: (value: { functionName: string; role: string }) => void
  refreshSurface?: (value: { functionName: string; role: string }) => Promise<ContextSurface | undefined>
  /** Journalled checkpoint for summary page boundaries. Paging is pure but
   * tokenizes the whole batch; a resumed job reads the recorded boundaries
   * instead of re-encoding every summarized batch on each claim. */
  pageBoundaries?: (source: string, compute: () => Promise<(number | null)[]>) => Promise<unknown>
}) {
  const chains = new Map<string, Chain>()
  const resultTokens = new Map<string, number>()
  const enabled = opts.version === 1
  if (opts.imageInputDedupVersion !== undefined && opts.imageInputDedupVersion !== 1) throw new Error('image_input_dedup_version_invalid')
  if (opts.stageContextVersion !== undefined && (opts.stageContextVersion !== 1 || opts.mainResultReferences !== 1 || opts.imageInputDedupVersion !== 1)) throw new Error('stage_context_version_invalid')
  if (opts.workerStageContextVersion !== undefined && (opts.workerStageContextVersion !== 1 || opts.stageContextVersion !== 1)) throw new Error('worker_stage_context_version_invalid')
  if (opts.imageReleaseVersion !== undefined && (opts.imageReleaseVersion !== 1 || opts.stageContextVersion !== 1 || !opts.imageSource)) throw new Error('image_release_version_invalid')
  const exportState = (): BobContextContinuationState => clone({ version: 1, strategyVersion: opts.version ?? 0,
    ...(opts.mainResultReferences === 1 ? { resultReferenceVersion: 1 as const } : {}),
    ...(opts.imageInputDedupVersion === 1 ? { imageInputDedupVersion: 1 as const } : {}),
    ...(opts.stageContextVersion === 1 ? { stageContextVersion: 1 as const } : {}),
    ...(opts.workerStageContextVersion === 1 ? { workerStageContextVersion: 1 as const } : {}),
    ...(opts.imageReleaseVersion === 1 ? { imageReleaseVersion: 1 as const } : {}),
    chains: [...chains].map(([id, chain]) => [id, { ...chain, operations: [...chain.operations] }]),
  })
  const restoreState = (state: BobContextContinuationState): void => {
    const message = (value: unknown): boolean => object(value) && ['system', 'user', 'assistant', 'tool'].includes(String(value.role))
      && (typeof value.content === 'string' || Array.isArray(value.content))
      && (value.nativeOutput === undefined || value.role === 'assistant' && !!readResponseItems(value.nativeOutput))
      && (value.nativeReasoningTokens === undefined || typeof value.nativeReasoningTokens === 'number' && Number.isFinite(value.nativeReasoningTokens) && value.nativeReasoningTokens >= 0)
      && (value.tool_calls === undefined || Array.isArray(value.tool_calls) && value.tool_calls.every(call => object(call)
        && typeof call.id === 'string' && call.type === 'function' && object(call.function)
        && typeof call.function.name === 'string' && typeof call.function.arguments === 'string'))
    const messages = (value: unknown): boolean => Array.isArray(value) && value.every(message)
    const natural = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
    if (!state || state.version !== 1 || state.strategyVersion !== (opts.version ?? 0)
      || state.resultReferenceVersion !== opts.mainResultReferences || state.imageInputDedupVersion !== opts.imageInputDedupVersion || state.stageContextVersion !== opts.stageContextVersion || state.workerStageContextVersion !== opts.workerStageContextVersion || state.imageReleaseVersion !== opts.imageReleaseVersion || !Array.isArray(state.chains)
      || new Set(state.chains.map(entry => Array.isArray(entry) ? entry[0] : null)).size !== state.chains.length) throw new Error('context_checkpoint_invalid')
    const restored = new Map<string, Chain>()
    for (const entry of state.chains) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0] || !object(entry[1])) throw new Error('context_checkpoint_invalid')
      const [id, chain] = entry
      if (typeof chain.identity !== 'string' || !messages(chain.seed) || !Array.isArray(chain.groups) || !chain.groups.every(messages)
        || chain.resultReferences !== undefined && (chain.resultReferences !== 1 || opts.mainResultReferences !== 1 || chain.compacted || chain.handoff !== undefined)
        || chain.historicalImages !== undefined && !messages(chain.historicalImages)
        || chain.stageNote !== undefined && (opts.stageContextVersion !== 1 || chain.resultReferences !== 1 || !parseStageContextNote(chain.stageNote))
        || typeof chain.compacted !== 'boolean' || !messages(chain.pendingInternal) || !natural(chain.inputTokens) || !natural(chain.outputTokens)
        || !Array.isArray(chain.operations) || new Set(chain.operations.map(entry => Array.isArray(entry) ? entry[0] : null)).size !== chain.operations.length
        || chain.handoff !== undefined && (!object(chain.handoff) || typeof chain.handoff.summary !== 'string'
          || !['open_questions', 'next_steps', 'source_refs'].every(key => Array.isArray(chain.handoff![key as keyof Handoff])
            && (chain.handoff![key as keyof Handoff] as unknown[]).every(value => typeof value === 'string')))) throw new Error('context_checkpoint_invalid')
      for (const operation of chain.operations) {
        if (!Array.isArray(operation) || operation.length !== 2 || typeof operation[0] !== 'string' || !object(operation[1])
          || operation[1].call_id !== operation[0] || typeof operation[1].tool_name !== 'string' || typeof operation[1].arguments !== 'string'
          || !(typeof operation[1].output === 'string' || Array.isArray(operation[1].output))) throw new Error('context_checkpoint_invalid')
        if (chain.resultReferences === 1) {
          const view = operation[1].presentation
          if (!object(view) || !object(view.observed) || view.observed.call_id !== operation[0] || view.observed.tool_name !== operation[1].tool_name
            || !(typeof view.older === 'string' || Array.isArray(view.older))) throw new Error('context_checkpoint_invalid')
        }
      }
      const copy = clone(chain)
      restored.set(id, { ...copy, operations: new Map(copy.operations) })
    }
    chains.clear()
    for (const [id, chain] of restored) chains.set(id, chain)
  }
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
      const page = all.slice(after, after + 20).map(operation => operation.presentation?.observed ?? statusOf(operation))
      if (chain.resultReferences === 1) while (page.length && countSerializedTokens(page) > BOB_RESULT_PAGE_TOKENS - 100) page.pop()
      const next = after + page.length < all.length ? after + page.length : null
      return { status: 'ok', operations: page, after, next_after: next, truncated: next !== null }
    }
    const operation = chain.operations.get(input.call_id as string)
    if (!operation) return { status: 'not_found' }
    try {
      if (chain.resultReferences === 1) return bobResultPage(operation, after)
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
      if (prior) {
        const { presentation: _view, ...original } = prior
        if (JSON.stringify(stableJsonValue(original)) !== JSON.stringify(stableJsonValue(operation))) throw new Error('context_operation_changed')
      }
      const literal = Object.hasOwn(opts.literalResultTokens ?? {}, operation.tool_name) ? opts.literalResultTokens![operation.tool_name] : undefined
      const archived = prior ?? (chain.resultReferences === 1 ? prepareBobResult(operation, literal) : operation)
      chain.operations.set(tool.id, archived)
      if (chain.resultReferences === 1) message.content = projectBobResult(archived, false, literal)
    }
  }

  // Each entry is a page's exclusive end; null marks the final page.
  const sourcePages = async (source: string): Promise<{ text: string; next: number | null }[]> => {
    const compute = async () => {
      const ends: (number | null)[] = []
      for (let after = 0; ;) {
        const { next } = textPage(source, after, SOURCE_BATCH_TOKENS)
        ends.push(next)
        if (next === null) return ends
        after = next
      }
    }
    const ends = opts.pageBoundaries ? await opts.pageBoundaries(source, compute) : await compute()
    if (pagedText?.text !== source) pagedText = { text: source, chars: Array.from(source) }
    const chars = pagedText.chars
    if (!Array.isArray(ends) || !ends.length || ends.at(-1) !== null) throw new Error('context_cursor_invalid')
    let after = 0
    return ends.map((next, index) => {
      const last = index === ends.length - 1
      if (last ? next !== null : !Number.isInteger(next) || Number(next) <= after || Number(next) >= chars.length) throw new Error('context_cursor_invalid')
      const page = { text: chars.slice(after, next ?? chars.length).join(''), next: next as number | null }
      after = next ?? chars.length
      return page
    })
  }

  const summarize = async (options: OpenAIServiceOptions, chain: Chain, groups: Message[][], beforeDispatch?: () => Promise<void>): Promise<Handoff> => {
    const refs = new Set([...(chain.handoff?.source_refs ?? []), ...groups.flatMap(group => group.flatMap(message =>
      (message.tool_calls ?? []).map(call => 'operation:' + call.id)))])
    // Source batches are independently bounded, including the manager's own
    // input. Its previous compact handoff is the only carried context.
    const source = JSON.stringify(stableJsonValue(compactSource(groups)))
    const pages = await sourcePages(source)
    let after = 0, handoff = chain.handoff
    do {
      const page = pages.shift()!
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

  /** The pinned adapter declares its wire protocol; Bob's loop is provider-neutral. */
  const replaysMessages = (options: OpenAIServiceOptions): boolean =>
    textContinuationMode(opts.aiCatalog.role(options.catalogRoleKey ?? options.functionName, options.catalogVariables).providerAdapter) === 'message-replay'
  const call: ModelCall = async (requested, beforeDispatch) => {
    // The compactor is deliberately not recursive. Other callers can use this
    // adapter without rewriting their schema, specialist loop or old journal.
    if (!enabled || requested.catalogRoleKey === 'context-compactor') return opts.callModel(requested, beforeDispatch)
    const role = requested.catalogRoleKey ?? requested.functionName
    const references = opts.mainResultReferences === 1 && requested.responseItemsMode === 'preserve'
      && requested.functionName === role && (role === 'ask-bob' || opts.workerStageContextVersion === 1
        && ['structure-worker','materials-worker','drawing-worker'].includes(role))
    let options = requested
    const isBob = (requested.catalogRoleKey ?? requested.functionName) === 'ask-bob'
    const roleCeiling = isBob ? ceiling : Math.max(ceiling, SPECIALIST_INPUT_CEILING_TOKENS)
    const roleLimit = isBob || !opts.specialistContinuationTokens ? limit : Math.min(Math.max(limit, opts.specialistContinuationTokens), roleCeiling)
    for (;;) {
      const consumedResponseId = options.previousResponseId
      const native = options.responseItemsMode === 'preserve'
      // Validate the pinned text protocol before any model dispatch; an
      // unsupported adapter cannot silently inherit OpenAI's response cursor.
      const replay = replaysMessages(options)
      const identity = JSON.stringify([options.app, options.coworkerId, options.functionName, options.catalogRoleKey ?? options.functionName,
        ...(native ? ['complete-request-v1'] : []), ...(references ? ['result-references-v1'] : []),
        ...(native && opts.imageInputDedupVersion === 1 ? ['image-input-dedup-v1'] : []),
        ...(references && opts.stageContextVersion === 1 ? ['stage-context-v1'] : [])])
      let chain: Chain
      if (options.previousResponseId) {
        const previous = chains.get(options.previousResponseId)
        if (!previous) throw new Error('context_chain_unavailable')
        if (previous.identity !== identity) throw new Error('context_chain_scope_mismatch')
        if (previous.resultReferences !== (references ? 1 : undefined)) throw new Error('context_chain_scope_mismatch')
        chain = copyChain(previous)
        const incoming = [...chain.pendingInternal, ...clone(options.messages ?? [])]
        chain.pendingInternal = []
        recordOperations(chain, incoming)
        chain.groups.at(-1)!.push(...incoming)
        options = { ...options, messages: incoming }
      } else {
        // A one-shot prompt-only image request needs no continuation shadow.
        if (!options.messages?.length && options.images?.length) return opts.callModel(options, beforeDispatch)
        chain = { identity, seed: initialMessages(options), groups: [], compacted: false, pendingInternal: [], inputTokens: 0, outputTokens: 0, operations: new Map(),
          ...(references ? { resultReferences: 1 as const } : {}) }
      }
      if (references) {
        // Groups before this index are compacted; the newest two always stay whole.
        const settled = opts.compactionBatch ? Math.floor(Math.max(0, chain.groups.length - 2) / opts.compactionBatch) * opts.compactionBatch : chain.groups.length - 2
        // Original results live once in the private operation archive. Keep
        // only bounded projections in the model transcript/checkpoint; native
        // assistant items, images and user constraints remain literal.
        let whole = new Set<string>()
        let supersededBy = new Map<string, string>()
        if (opts.resultWindowTokens && opts.resultWindowVersion === 2) {
          const results: Parameters<typeof selectBobResultWindow>[0] = []
          chain.groups.forEach((group, index) => {
            // Batched: only the settled part decides, so nothing earlier changes between batches.
            if (opts.compactionBatch && index >= settled) return
            for (const message of group) {
              if (message.role !== 'tool' || !message.tool_call_id) continue
              const operation = chain.operations.get(message.tool_call_id)
              if (!operation) throw new Error('context_operation_unavailable')
              const key = message.tool_call_id + '\u0000' + (typeof message.content === 'string' ? message.content.length : 'parts')
              let size = resultTokens.get(key)
              if (size === undefined) resultTokens.set(key, size = countSerializedTokens(message.content))
              results.push({ call_id: message.tool_call_id, tool_name: operation.tool_name, arguments: operation.arguments, tokens: size,
                older: index < settled })
            }
          })
          ;({ whole, supersededBy } = selectBobResultWindow(results, opts.resultWindowTokens))
        } else if (opts.resultWindowTokens) {
          // Newest first and contiguous: a demoted result is never restored.
          let used = 0
          window: for (let i = settled - 1; i >= 0; i--) for (const message of [...chain.groups[i]].reverse()) {
            if (message.role !== 'tool' || !message.tool_call_id) continue
            const key = message.tool_call_id + '\u0000' + (typeof message.content === 'string' ? message.content.length : 'parts')
            let size = resultTokens.get(key)
            if (size === undefined) resultTokens.set(key, size = countSerializedTokens(message.content))
            if (used + size > opts.resultWindowTokens) break window
            used += size; whole.add(message.tool_call_id)
          }
        }
        chain.groups = chain.groups.map((group, index) => group.map(message => {
          if (message.nativeOutput && index < settled) {
            // Private reasoning belongs to the exchange it led to. Older ones
            // add their full size to every later request, so a long turn ran
            // out of context (40-step probe); their calls and text remain.
            // Item ids go too: the provider rejects an id-bearing call whose
            // reasoning item is missing.
            const visible = readResponseItems(message.nativeOutput).filter(item => item.type !== 'reasoning').map(({ id: _id, ...item }) => item)
            const { nativeOutput: _items, nativeReasoningTokens: _reasoning, ...plain } = message
            return visible.length ? { ...plain, nativeOutput: visible, nativeReasoningTokens: 0 } : plain
          }
          if (message.role !== 'tool' || !message.tool_call_id) return message
          const operation = chain.operations.get(message.tool_call_id)
          if (!operation) throw new Error('context_operation_unavailable')
          const newer = supersededBy.get(message.tool_call_id)
          // An already demoted reference stays byte-stable for the prompt cache.
          if (newer !== undefined && index < settled) return omittedContent(message.content) ? message : { ...message, content: supersededBobResult(operation, newer) }
          return index < settled && !whole.has(message.tool_call_id) ? { ...message, content: projectBobResult(operation, true) } : message
        }))
      }
      if (!references) {
      // Legacy rollover sizing is unnecessary in the reference mode; its
      // fully assembled native request is counted once below.
      // This wrapper is deliberately outside catalog resolution/journalling.
      // Resolve a counting copy: caller options may contain only a schema key
      // or thin tool cards while the actual wire carries their complete bound
      // schemas. Keep the original options unchanged for stable replay.
      const resolved = applyCatalogModelOptions(opts.aiCatalog, options)
      const fixed = Math.ceil(countSurfaceTokens({ instruction: resolved.systemMessage,
        tools: resolved.tools ?? [], schema: resolved.schema ?? null,
        schemaName: resolved.schemaName ?? null, schemaDescription: resolved.schemaDescription ?? null }) * 1.1) + 256
      const input = countInputTokens(options.messages ?? options.prompt ?? '')
      if (fixed + input > roleCeiling) throw new Error('context_input_too_large')
      const fullEstimate = fixed + countInputTokens(native
        ? [chain.seed, chain.handoff, chain.historicalImages, chain.groups]
        : [chain.seed, chain.handoff, chain.groups])
      // Version 0 added the surface on top of reported input that already
      // includes it, so a fresh request could look over the limit at once
      // and every step was summarized again (2026-10-20 read loop).
      const reported = chain.inputTokens + chain.outputTokens + (opts.rolloverVersion === 1 ? 0 : fixed) + input
      const estimate = native ? fullEstimate : Math.max(fullEstimate, reported)
      if (options.previousResponseId && estimate >= roleLimit && chain.groups.length > keep) {
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
        // A refresh that would only fold a few small exchanges cannot bring
        // the request under the limit; it would just drop exact results Bob
        // has just read. Wait until the older part is worth summarizing.
        const worthwhile = opts.rolloverVersion !== 1 || split > 0 && countInputTokens(chain.groups.slice(0, split)) >= Math.ceil(roleLimit / 4)
        if (complete && split > 0 && worthwhile) {
          chain.handoff = await summarize(options, chain, chain.groups.slice(0, split), beforeDispatch)
          if (native) {
            // Image delivery remains literal even while the legacy text
            // compactor is retained for the separately tested PR3 transition.
            const images = [...(chain.historicalImages ?? []), ...chain.groups.slice(0, split).flat()
              .filter(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))]
            chain.historicalImages = [...new Map(images.map(message => [JSON.stringify(message), clone(message)])).values()]
          }
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
          const handoffMessage: Message = { role: 'user', content: JSON.stringify({
            context_handoff: chain.handoff, original_assignment_preserved: true,
            completed_operations: recentOperations, operation_archive: { tool: HISTORY_TOOL, list: { call_id: null, after: null } },
            ...(opts.snapshot ? { confirmed_work_state: opts.snapshot({ functionName: options.functionName, role: options.catalogRoleKey ?? options.functionName }) } : {}),
          }) }
          options = { ...fresh, messages: [...clone(chain.seed), handoffMessage, ...clone(chain.groups.flat())] }
          // A stateless provider is re-sent this exact request on every later
          // call, so the handoff stays in the chain byte for byte.
          if (!native && replay) chain.groups = [[clone(handoffMessage)], ...chain.groups]
          opts.onRollover?.(rollover)
        }
      }
      }
      if (chain.compacted || references) {
        const history = opts.aiCatalog.tool(HISTORY_TOOL, references ? { card: false, include_manual: true } : undefined)
        const stage = references && opts.stageContextVersion === 1 ? opts.aiCatalog.tool(STAGE_CONTEXT_TOOL) : null
        options = { ...options, tools: [...(options.tools ?? []).filter(tool => tool.function.name !== HISTORY_TOOL && (!stage || tool.function.name !== STAGE_CONTEXT_TOOL)), history, ...(stage ? [stage] : [])],
          ...(references ? { catalogToolParameters: { ...options.catalogToolParameters, [HISTORY_TOOL]: { card: false, include_manual: true } } } : {}),
          ...(options.catalogSchemaKey || options.schema ? { structuredToolOutput: true } : {}) }
      }
      // A message-replay adapter keeps no conversation on its side: the
      // continuation pointer becomes the chain this adapter already holds,
      // sent in full with the exact native items (thinking blocks included).
      if (!native && options.previousResponseId && replay) {
        const { previousResponseId: _pointer, prompt: _prompt, ...rest } = options
        options = { ...rest, messages: [...clone(chain.seed), ...clone(chain.groups.flat())] }
      }
      let imageInputs: BobImageInputCounts | undefined
      if (native && opts.imageReleaseVersion === 1) {
        const release = releaseUsedImages({ groups: chain.groups, imageSource: opts.imageSource!, saved: id => {
          const operation = chain.operations.get(id)
          if (!operation) return false
          const status = statusOf(operation)
          return status.status === 'saved' || status.saved === true
        } })
        chain.groups = release.groups
        if (release.released) console.log('[Bob image release]', JSON.stringify({ role: options.catalogRoleKey ?? options.functionName, released: release.released }))
      }
      if (native) options = buildBobRequest(options, {
        seed: chain.seed, history: chain.groups.flat(), historicalImages: chain.historicalImages,
        ...(opts.imageInputDedupVersion === 1 ? { imageInputDedupVersion: 1 as const } : {}),
        ...(chain.stageNote ? { handoff: { role: 'user', content: JSON.stringify(stableJsonValue({
          stage_handoff: chain.stageNote, unverified_working_note: true, approval_not_implied: true,
          original_assignment_preserved: true, operation_archive: { tool: HISTORY_TOOL, list: { call_id: null, after: null } },
          ...(!isBob ? { completed_operations: [...chain.operations.values()].slice(-40).map(workerStageFacts) } : {}),
          ...(opts.snapshot ? { confirmed_work_state: opts.snapshot({ functionName: options.functionName, role: options.catalogRoleKey ?? options.functionName }) } : {}),
        })) } as Message } : chain.handoff ? { handoff: { role: 'user', content: JSON.stringify({
          context_handoff: chain.handoff, original_assignment_preserved: true,
          completed_operations: [...chain.operations.values()].slice(-40).map(statusOf),
          operation_archive: { tool: HISTORY_TOOL, list: { call_id: null, after: null } },
          ...(opts.snapshot ? { confirmed_work_state: opts.snapshot({ functionName: options.functionName, role: options.catalogRoleKey ?? options.functionName }) } : {}),
        }) } as Message } : {}),
      }, counts => { imageInputs = counts })
      // Compaction preserves the exact seed and native tool exchanges. If
      // these indispensable inputs themselves exceed the configured envelope,
      // report it rather than silently trimming the assignment or tool result.
      if (!options.previousResponseId) {
        const fresh = applyCatalogModelOptions(opts.aiCatalog, options)
        const freshTokens = estimateBobRequestInput(fresh).total
        if (freshTokens > roleCeiling) throw new Error('context_input_too_large')
      }
      const response = await opts.callModel(options, beforeDispatch, imageInputs)
      if (!response.success || !response.responseId) return response
      if (native) readResponseItems(response.outputItems)
      chain.inputTokens = Math.max(0, response.usage.input_tokens)
      chain.outputTokens = Math.max(0, response.usage.output_tokens)
      chain.groups.push([resultMessage(response)])
      const internal: ToolCall[] = chain.compacted || references ? response.toolCalls?.filter(tool => tool.function.name === HISTORY_TOOL
        || references && opts.stageContextVersion === 1 && tool.function.name === STAGE_CONTEXT_TOOL) ?? [] : []
      const external = response.toolCalls?.filter(tool => !internal.includes(tool)) ?? []
      let refreshedSurface: ContextSurface | undefined
      for (const tool of internal) {
        let input: unknown
        try { input = JSON.parse(tool.function.arguments) } catch { input = null }
        const began=Date.now()
        let result: Record<string, unknown>
        if (tool.function.name === STAGE_CONTEXT_TOOL) {
          const prepared = response.toolCalls?.length === 1
            ? prepareStageContext({ value: input, seed: chain.seed, history: [...(chain.historicalImages ?? []), ...chain.groups.flat()], callIds: new Set(chain.operations.keys()), imageSource: opts.imageSource ?? (() => undefined) })
            : { status: 'invalid' as const, reason: 'handoff_must_be_only_call' }
          if (prepared.status !== 'ready') result = prepared
          else {
            // Refresh tools/manuals and their invocation gates together. Keep
            // the handoff's native call/output pair; older pairs leave whole.
            refreshedSurface = await opts.refreshSurface?.({ functionName: options.functionName, role: options.catalogRoleKey ?? options.functionName })
            chain.seed = prepared.seed
            chain.stageNote = prepared.note
            chain.groups = [chain.groups.at(-1)!]
            chain.historicalImages = undefined
            result = { status: 'advanced', saved: false, approval_not_implied: true, kept_image_refs: prepared.note.keep_image_refs,
              original_assignment_preserved: true, operation_archive_retained: true }
            opts.onRollover?.({ functionName: options.functionName, role: options.catalogRoleKey ?? options.functionName })
            console.log('[Bob stage handoff]', JSON.stringify({ before: prepared.before, after: prepared.after, released: prepared.before - prepared.after }))
          }
        } else result=readArchivedOperation(input,chain)
        chain.pendingInternal.push({ role: 'tool', tool_call_id: tool.id, content: JSON.stringify(result) })
        await opts.onInternalTool?.({name:tool.function.name,status:String(result.status??'returned'),callId:tool.id,role:options.functionName,ms:Date.now()-began})
      }
      // Specialists continue a chain only through their own tool calls; only
      // Bob's main loop resumes after a final message (nudges, completion
      // check). A finished specialist chain is dead weight: a CAD review kept
      // ~2.4 MB of preview pixels in every later checkpoint (2026-10-21).
      const continuable = !!response.toolCalls?.length
        || (requested.catalogRoleKey ?? requested.functionName) === 'ask-bob'
      if (continuable) chains.set(response.responseId, copyChain(chain))
      // Only the live head is needed. Keeping a full archive copy at every
      // historical response would make long work consume quadratic RAM.
      if (consumedResponseId && consumedResponseId !== response.responseId) chains.delete(consumedResponseId)
      if (!internal.length) return response
      if (external.length) return { ...response, toolCalls: external }
      // History-only calls stay inside this adapter. Mixed batches deliver the
      // remaining calls to the owning loop, then join both exact output sets
      // on its next invocation. The journal always sees the raw model result.
      options = { ...options, ...refreshedSurface, previousResponseId: response.responseId, messages: [], prompt: undefined }
    }
  }
  // Native readers are implicitly bound to their own chain. This explicit
  // server-only accessor requires the same response identity for diagnostics.
  /** A worker that stopped (step or time budget) leaves its last chain
   * continuable. Nothing resumes it: its full tool outputs filled half of a
   * 2 MB checkpoint and stopped a 70-part drawing turn (2026-11-02). */
  const release = (responseId: string): void => { chains.delete(responseId) }
  return { call, exportState, restoreState, release,
    readOperation: (input: unknown, responseId?: string) => readArchivedOperation(input, responseId ? chains.get(responseId) : undefined) }
}
