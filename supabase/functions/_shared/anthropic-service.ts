/**
 * The ONE place an Anthropic (Claude) request is built and parsed.
 *
 * Pattern copied from Launchpad (`_shared/ai-services/anthropic/service.ts` +
 * `registry.ts`): one adapter module per provider, chosen by the model
 * catalog row (`provider` + `capabilities.provider_adapter`), never by a
 * caller. Callers keep calling `callOpenAIResponses`; when the pinned catalog
 * model is an Anthropic model, that service hands the call to this adapter
 * and gets back the SAME response shape, so tool loops, budgets, journals and
 * the usage ledger do not know which provider answered.
 *
 * Dormant by default. Two locks must both be opened by the owner:
 *   1. `ANTHROPIC_ENABLED` below (a code switch, flipped by a PR + deploy);
 *   2. a catalog publish that binds a tier to an active Anthropic model row
 *      (the database publish check still refuses non-OpenAI providers).
 *
 * Native replay: Claude's thinking blocks must be sent back unchanged in a
 * tool loop. They are carried as opaque `reasoning` items (provider
 * 'anthropic', the whole block JSON in `encrypted_content`), exactly like
 * OpenAI's encrypted reasoning, so Bob's existing journal and checkpoint
 * code stores them without knowing the provider.
 *
 * Pure module: no Supabase import, no env reads. The caller passes the key,
 * the pinned model row and the ledger writer.
 */

/** THE Claude on/off switch for this repo. Off until the owner approves.
 * Only this repo's Edge functions carry this module, so other apps sharing
 * the database are unaffected by flipping it. */
export const ANTHROPIC_ENABLED = true
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import type { OpenAIResponseItem } from './openai-content.ts'
import { schemaIssues,safeSchemaPaths } from './schema-issues.ts'
import { dedupSchema } from './tool-schema-dedup.ts'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
// Pinned so a wire-shape change is a deliberate code edit.
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA = 'thinking-binding-controls-2026-08-01'
const MAX_RETRIES = 2
/** Answer text or thinking arrived this recently when our deadline closed. */
const CLAUDE_ACTIVE_STREAM_MS = 10_000
/** One cache point; the five-minute default so every point shares one TTL. */
const cachePoint = (): Json => ({ type: 'ephemeral' })
// 5-minute cache writes cost 1.25x the base input price.
const CACHE_WRITE_MULTIPLIER = 1.25
/** Characters of streamed text, thinking or tool input per output token, for
 * a cut answer that never reported its usage. Bob's output is mostly JSON and
 * Swedish prose. */
export const STREAMED_CHARS_PER_TOKEN = 3.5

type Json = Record<string, unknown>
type Block = Json & { type: string }

export interface AnthropicModelRow {
  model_name: string
  input_cost_per_1m_tokens: number
  output_cost_per_1m_tokens: number
  cached_input_cost_per_1m_tokens: number | null
  supports_images?: boolean
  capabilities?: Json
}
export interface AnthropicUsageRecord {
  model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number
  reasoningTokens: number; totalTokens: number; costUsd: number | null; success: boolean;errorCode?:string;latencyMs?:number
  /** Set when the cost is estimated from streamed output, not reported. */
  costBasis?: 'streamed_output_estimate'
}
export interface AnthropicCallContext {
  apiKey: string
  model: AnthropicModelRow
  systemMessage: string
  /** Anthropic requires max_tokens; the caller passes the pinned ceiling. */
  maxOutputTokens: number
  /** From the catalog profile; validated against the model's declared efforts. */
  effort: string | null
  timeoutMs: number
  /** Must return pixels as a data: URL (provider file ids are OpenAI-only). */
  resolveImage?: (ref: string) => Promise<string>
  log: (record: AnthropicUsageRecord) => Promise<void>
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const fail = <T>(model: string, error: string): OpenAIServiceResponse<T> =>
  ({ success: false, data: null, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model, error })

/** Same normalisation the OpenAI path applies (all properties required,
 * closed objects when strict), so one catalog schema serves both providers. */
// Claude's strict mode (strict tools and output_config.format) accepts a
// subset of JSON Schema. Live 2026-11-02 every Claude turn got a 400 on
// maxItems. The wire schema keeps types, enums, required and nesting; the
// dropped bounds stay in the original schema, which Bob's validators check
// (schemaIssues and the domain validators), as the SDKs do client-side.
const UNSUPPORTED_KEYWORDS = new Set(['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf',
  'minLength','maxLength','pattern','maxItems','uniqueItems','contains','minContains','maxContains',
  'minProperties','maxProperties','patternProperties','propertyNames','dependentRequired','dependentSchemas',
  'if','then','else','not','unevaluatedProperties','unevaluatedItems'])
const SUPPORTED_FORMATS = new Set(['date-time','time','date','duration','email','hostname','uri','ipv4','ipv6','uuid'])
const SCHEMA_MAPS = ['properties','$defs','definitions']
const SCHEMA_LISTS = ['anyOf','allOf','prefixItems']

/** Translate a schema into the subset Claude's strict mode accepts. Objects
 * close (additionalProperties false) and list every property as required, the
 * same shape OpenAI strict mode needs; nullable types carry optionality. */
export function strictSchema(schema: Json, strict = true): Json {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const out: Json = {}, limits: string[] = []
  const note = (key: string, value: unknown) => { if (typeof value !== 'object') limits.push(key + ': ' + JSON.stringify(value)) }
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) { note(key, value); continue }
    if (key === 'format' && !(typeof value === 'string' && SUPPORTED_FORMATS.has(value))) { note(key, value); continue }
    if (key === 'minItems' && !(value === 0 || value === 1)) { note(key, value); continue }
    if (key === 'oneOf') { out.anyOf = (value as Json[]).map(v => strictSchema(v, strict)); continue }
    if (SCHEMA_MAPS.includes(key) && value && typeof value === 'object') {
      out[key] = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, strictSchema(v as Json, strict)])); continue
    }
    if (SCHEMA_LISTS.includes(key) && Array.isArray(value)) { out[key] = value.map(v => strictSchema(v as Json, strict)); continue }
    if (key === 'items') { out.items = Array.isArray(value) ? value.map(v => strictSchema(v as Json, strict)) : strictSchema(value as Json, strict); continue }
    out[key] = value
  }
  // The model still sees each dropped bound, as the Anthropic SDKs do.
  if (limits.length) out.description = [typeof out.description === 'string' ? out.description : '', '{' + limits.join(', ') + '}'].filter(Boolean).join(' ')
  const isObject = out.type === 'object' || (Array.isArray(out.type) && out.type.includes('object'))
  if (isObject && out.properties && typeof out.properties === 'object') {
    out.required = Array.from(new Set([...(Array.isArray(out.required) ? out.required as string[] : []), ...Object.keys(out.properties as Json)]))
    if (strict) out.additionalProperties = false
  }
  return out
}

async function imageBlock(url: string, ctx: AnthropicCallContext): Promise<Block> {
  if (url.startsWith('private-image:')) {
    if (!ctx.resolveImage) throw new Error('private_image_resolver_missing')
    url = await ctx.resolveImage(url)
  }
  const data = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(url)
  if (data) return { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } }
  if (/^https:\/\//.test(url)) return { type: 'image', source: { type: 'url', url } }
  // Never let an answer pretend an image was viewed.
  throw new Error('provider_image_unsupported')
}

async function contentBlocks(content: unknown, ctx: AnthropicCallContext): Promise<Block[]> {
  if (content === null || content === undefined) return []
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) throw new Error('Unsupported multimodal content')
  const blocks: Block[] = []
  for (const part of content as Json[]) {
    if (['text', 'input_text', 'output_text'].includes(String(part.type))) {
      if (typeof part.text === 'string' && part.text) blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image_url') {
      const ref = typeof part.image_url === 'string' ? part.image_url : (part.image_url as Json)?.url
      if (typeof ref !== 'string' || !ref) throw new Error('Invalid image content')
      blocks.push(await imageBlock(ref, ctx))
    } else throw new Error('Unsupported multimodal content')
  }
  return blocks
}

/** Native items (ours or OpenAI's) back into Claude content blocks. OpenAI
 * reasoning is unreadable to Claude and is dropped, as on a model switch. */
function nativeBlocks(items: OpenAIResponseItem[]): Block[] {
  const blocks: Block[] = []
  for (const item of items) {
    if (item.type === 'reasoning') {
      if (item.provider === 'anthropic' && typeof item.encrypted_content === 'string') blocks.push(JSON.parse(item.encrypted_content))
    } else if (item.type === 'message') {
      for (const part of (item.content as Json[]) ?? []) if (typeof part.text === 'string' && part.text) blocks.push({ type: 'text', text: part.text })
    } else if (item.type === 'function_call') {
      blocks.push({ type: 'tool_use', id: item.call_id, name: item.name, input: JSON.parse(String(item.arguments || '{}')) })
    }
  }
  return blocks
}

export async function anthropicMessages(options: OpenAIServiceOptions, ctx: AnthropicCallContext): Promise<Array<{ role: 'user' | 'assistant'; content: Block[] }>> {
  const out: Array<{ role: 'user' | 'assistant'; content: Block[] }> = []
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (!blocks.length) return
    const last = out.at(-1)
    if (last?.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }
  if (options.messages?.length) {
    for (const msg of options.messages) {
      if (msg.role === 'system') continue
      if (msg.nativeOutput !== undefined) {
        // Claude needs its own thinking blocks back in every tool loop, so
        // native replay is always accepted here (unlike the OpenAI opt-in).
        if (msg.role !== 'assistant') throw new Error('native_response_replay_not_enabled')
        push('assistant', nativeBlocks(msg.nativeOutput))
      } else if (msg.role === 'tool') {
        push('user', [{ type: 'tool_result', tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }])
      } else if (msg.role === 'assistant') {
        const blocks = await contentBlocks(msg.content, ctx)
        for (const call of msg.tool_calls ?? []) blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || '{}') })
        push('assistant', blocks)
      } else push('user', await contentBlocks(msg.content, ctx))
      // A fixed cache point on the last block of a stable prefix (owner
      // decision 2026-11-06): a read point that outlives a later rewrite of
      // the transcript. Only pinned executions mark; others send the same bytes.
      if (options.promptCachePoints === 1 && msg.cacheBoundary === 1) {
        const block = out.at(-1)?.content.at(-1)
        if (block) block.cache_control = cachePoint()
      }
    }
  } else {
    const blocks: Block[] = []
    for (const [i, img] of (options.images ?? []).entries()) {
      if (img.mimeType === 'application/pdf') {
        if (img.url) blocks.push({ type: 'document', source: { type: 'url', url: img.url } })
        else if (img.data) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.data }, title: options.fileName || `document_${i + 1}.pdf` })
      } else if (img.type === 'base64' && img.data) {
        blocks.push(await imageBlock(img.data.startsWith('data:') ? img.data : `data:${img.mimeType || 'image/jpeg'};base64,${img.data}`, ctx))
      } else if (img.url ?? img.data) blocks.push(await imageBlock((img.url ?? img.data)!, ctx))
    }
    blocks.push({ type: 'text', text: options.prompt || '' })
    push('user', blocks)
  }
  if (out[0]?.role !== 'user') throw new Error('anthropic_conversation_must_start_with_user')
  return out
}

export async function anthropicRequestBody(options: OpenAIServiceOptions, ctx: AnthropicCallContext): Promise<Json> {
  // Claude is stateless: a server-side conversation pointer cannot be honoured.
  if (options.previousResponseId) throw new Error('ai_profile_incompatible: previous response pointer')
  const caps = ctx.model.capabilities ?? {}
  const body: Json = {
    model: ctx.model.model_name,
    max_tokens: ctx.maxOutputTokens,
    messages: await anthropicMessages(options, ctx),
    // Adaptive thinking: Claude decides how much to think; effort sets depth.
    // Bob rebuilds context on purpose (tool picks per turn, result windows,
    // handoffs), so a replayed thinking block can belong to another prefix.
    // Drop it instead of failing the turn (live 400, 2026-11-02 21:23).
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    // Automatic prompt caching at the end of the request (the growing tail).
    cache_control: cachePoint(),
    stream: true,
  }
  // Tools render before the system prompt, so a point on the system prompt's
  // last block keeps tools and system readable whatever changes later in the
  // transcript (every compaction and job start paid for them again, 2026-11-06).
  // With the automatic point that is at most four: system, job start, settled
  // compaction, tail.
  if (ctx.systemMessage) body.system = options.promptCachePoints === 1
    ? [{ type: 'text', text: ctx.systemMessage, cache_control: cachePoint() }] : ctx.systemMessage
  const outputConfig: Json = {}
  if (ctx.effort) outputConfig.effort = ctx.effort
  const tools = options.tools ?? []
  if (tools.length) {
    body.tools = tools.map(tool => ({ name: tool.function.name, description: tool.function.description,
      // No strict tools on Claude: Bob's large tool schemas exceed its grammar
      // limit (live 400 "compiled grammar is too large", 2026-11-02 21:30).
      // Each tool keeps its full schema, and Bob's validators check every call.
      // Owner decision 2026-11-06: repeated sub-schemas go once as $defs (measured
      // 44,096 -> 34,561 tokens for Bob's five write tools, lossless).
      input_schema: options.toolSchemaDedup === 1 ? dedupSchema(tool.function.parameters) as Json : tool.function.parameters,
      ...(options.promptCachePoints === 1 && options.cacheAfterTool === tool.function.name ? { cache_control: cachePoint() } : {}) }))
    const parallel = (options.aiDefinition?.providerParameters as Json | undefined)?.parallel_tool_calls
    const choice = options.tool_choice
    // Forced tool choice is rejected by current Claude models unless the
    // catalog row declares support; fall back to 'auto' with the tools offered.
    const forced = caps.forced_tool_choice === true
    let mapped: Json = { type: 'auto' }
    if (choice === 'none') mapped = { type: 'none' }
    else if (choice === 'required' && forced) mapped = { type: 'any' }
    else if (choice && typeof choice === 'object' && forced) mapped = { type: 'tool', name: choice.function.name }
    if (parallel === false && mapped.type !== 'none') mapped.disable_parallel_tool_use = true
    body.tool_choice = mapped
  }
  if (options.schema && options.schemaName && (!tools.length || options.structuredToolOutput)) {
    outputConfig.format = { type: 'json_schema', schema: strictSchema(options.schema, true) }
  }
  if (Object.keys(outputConfig).length) body.output_config = outputConfig
  capCachePoints(body)
  return body
}

const MAX_CACHE_POINTS = 4

// Claude refuses a request with more than four cache points (live 400,
// 2026-11-07 13:41: a compacted Konrad job sent system, core tool, job start,
// settled compaction and the automatic tail). Tools and system stay the same
// within a job, so the job-start point already covers the system prompt: drop
// that one first, then the earliest message points.
function capCachePoints(body: Json): void {
  const marked = (blocks: unknown) => Array.isArray(blocks) ? (blocks as Block[]).filter(b => b.cache_control) : []
  const messages = (body.messages as Array<{ content: Block[] }>).flatMap(m => marked(m.content))
  const system = marked(body.system)
  let excess = (body.cache_control ? 1 : 0) + system.length + marked(body.tools).length + messages.length - MAX_CACHE_POINTS
  for (const block of [...(messages.length ? system : []), ...messages]) {
    if (excess <= 0) break
    delete block.cache_control
    excess--
  }
}

/** Collect one streamed Messages response into the final message object. */
export async function collectStream(response: Response, onEvent?: (type: string, message: Json, outputChars: number) => void): Promise<Json> {
  if (!response.body) throw new Error('anthropic_stream_missing')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const message: Json = { content: [] as Block[], usage: {} }
  const partial = new Map<number, string>()
  let buffer = ''
  const handle = (event: Json) => {
    const content = message.content as Block[]
    switch (event.type) {
      case 'message_start': Object.assign(message, event.message as Json, { content }); break
      case 'content_block_start': {
        const block = { ...(event.content_block as Block) }
        if (block.type === 'tool_use') partial.set(Number(event.index), '')
        content[Number(event.index)] = block
        break
      }
      case 'content_block_delta': {
        const block = content[Number(event.index)], delta = event.delta as Json
        if (!block) break
        if (delta.type === 'text_delta') block.text = String(block.text ?? '') + delta.text
        else if (delta.type === 'thinking_delta') block.thinking = String(block.thinking ?? '') + delta.thinking
        else if (delta.type === 'signature_delta') block.signature = String(block.signature ?? '') + delta.signature
        else if (delta.type === 'input_json_delta') partial.set(Number(event.index), (partial.get(Number(event.index)) ?? '') + delta.partial_json)
        break
      }
      case 'content_block_stop': {
        const index = Number(event.index), json = partial.get(index)
        if (json !== undefined) { content[index].input = json ? JSON.parse(json) : {}; partial.delete(index) }
        break
      }
      case 'message_delta': {
        const delta = event.delta as Json
        if (delta?.stop_reason !== undefined) message.stop_reason = delta.stop_reason
        if (delta?.stop_details !== undefined) message.stop_details = delta.stop_details
        Object.assign(message.usage as Json, event.usage as Json)
        break
      }
      case 'error': throw new Error('anthropic_stream_error: ' + String((event.error as Json)?.type ?? 'unknown'))
    }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let cut
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut); buffer = buffer.slice(cut + 2)
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('')
      if (data) {
        const event = JSON.parse(data) as Json
        const delta = event.type === 'content_block_delta' ? event.delta as Json : null
        onEvent?.(String(event.type ?? 'unknown'), message, delta ? String(delta.text ?? delta.thinking ?? delta.partial_json ?? '').length : 0)
        handle(event)
      }
    }
    if (done) break
  }
  if (message.stop_reason === undefined) throw new Error('anthropic_stream_incomplete')
  return message
}

/** Content blocks to the provider-neutral native items Bob already stores. */
export function nativeItems(content: Block[]): OpenAIResponseItem[] {
  const items: OpenAIResponseItem[] = []
  for (const block of content) {
    if (block.type === 'thinking' || block.type === 'redacted_thinking') items.push({ type: 'reasoning', provider: 'anthropic', encrypted_content: JSON.stringify(block) })
    else if (block.type === 'text' && typeof block.text === 'string') items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: block.text }] })
    else if (block.type === 'tool_use') items.push({ type: 'function_call', call_id: String(block.id), name: String(block.name), arguments: JSON.stringify(block.input ?? {}) })
  }
  return items
}

export function anthropicCostUsd(model: AnthropicModelRow, usage: Json): number | null {
  const rate = (v: unknown) => Number(v) / 1_000_000
  const input = Number(usage.input_tokens ?? 0), write = Number(usage.cache_creation_input_tokens ?? 0)
  const read = Number(usage.cache_read_input_tokens ?? 0), output = Number(usage.output_tokens ?? 0)
  if (![model.input_cost_per_1m_tokens, model.output_cost_per_1m_tokens].every(v => Number.isFinite(Number(v)))) return null
  const cached = model.cached_input_cost_per_1m_tokens ?? model.input_cost_per_1m_tokens
  return input * rate(model.input_cost_per_1m_tokens) + write * rate(model.input_cost_per_1m_tokens) * CACHE_WRITE_MULTIPLIER
    + read * rate(cached) + output * rate(model.output_cost_per_1m_tokens)
}

function retryDelayMs(response: Response, attempt: number): number {
  const after = Number(response.headers.get('retry-after'))
  if (Number.isFinite(after) && after > 0) return Math.min(after * 1000, 8000)
  return Math.min(500 * 2 ** attempt, 8000)
}

export async function callAnthropicMessages<T = unknown>(options: OpenAIServiceOptions, ctx: AnthropicCallContext): Promise<OpenAIServiceResponse<T>> {
  const model = ctx.model.model_name
  const doFetch = ctx.fetch ?? fetch
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  let body: Json
  try { body = await anthropicRequestBody(options, ctx) }
  catch (error) { return fail(model, error instanceof Error ? error.message : 'anthropic_request_invalid') }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs)
  let message: Json
  let response: Response | null = null
  const startedAt = Date.now()
  let events = 0, firstEventAt: number | null = null, lastEventAt: number | null = null, lastOutputAt: number | null = null
  let streamed: Json | null = null, outputChars = 0
  try {
    for (let attempt = 0; ; attempt++) {
      response = await doFetch(ANTHROPIC_URL, { method: 'POST', signal: controller.signal, body: JSON.stringify(body),
        headers: { 'x-api-key': ctx.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-beta': ANTHROPIC_BETA, 'content-type': 'application/json' } })
      if (response.ok) break
      const retryable = response.status === 429 || response.status === 529 || response.status >= 500
      if (!retryable || attempt >= MAX_RETRIES) {
        // The provider's error type explains a rejection; never log request content.
        let detail = ''
        try { const j = await response.json(); detail = [j?.error?.type, j?.error?.message].filter(v => typeof v === 'string').join(' | ').slice(0, 300) } catch { /* no body */ }
        console.error('[Anthropic Service] API error', JSON.stringify({ status: response.status, request_id: response.headers.get('request-id'), detail }))
        return fail(model, `Anthropic API error: ${response.status}`)
      }
      await response.body?.cancel()
      await sleep(retryDelayMs(response, attempt))
    }
    message = await collectStream(response!, (type, partial, chars) => {
      const now = Date.now()
      streamed = partial
      outputChars += chars
      events++
      if (firstEventAt === null) firstEventAt = now
      lastEventAt = now
      if (type === 'content_block_delta') lastOutputAt = now
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Request failed'
    // Content-free diagnostics distinguish our own deadline from a provider
    // disconnect, and a stalled prefill from a stream that was still active.
    console.error('[Anthropic Service] Request error', JSON.stringify({
      kind: controller.signal.aborted ? 'local_timeout' : 'network_or_stream',
      elapsed_ms: Date.now() - startedAt, timeout_ms: ctx.timeoutMs,
      events, first_event_ms: firstEventAt === null ? null : firstEventAt - startedAt,
      since_last_event_ms: lastEventAt === null ? null : Date.now() - lastEventAt,
      request_id: response?.headers.get('request-id') ?? null,
      error: msg.slice(0, 120),
    }))
    // Our own deadline closed after the provider had begun the answer: it did
    // not fit one window, whether text was still streaming or the model was
    // still thinking in silence. Resending the same request repeats that
    // (bed, 2026-11-06: twice 120 s, nothing saved; entry the same evening,
    // silent both times), so callers get a distinct code and retry with a
    // note. A deadline before the first event keeps the plain network code.
    const cut = controller.signal.aborted && response?.ok === true && firstEventAt !== null
    const active = lastOutputAt !== null && Date.now() - lastOutputAt <= CLAUDE_ACTIVE_STREAM_MS
    // A request that reached the provider is billed. Its input is known from
    // the start of the stream; its output is estimated from what streamed
    // (owner decision 2026-11-07: three cut Konrad answers had no price).
    // Thinking that streamed as a summary counts at its summary length, so
    // the estimate is a lower bound.
    if (response?.ok) {
      const raw = ((streamed as Json | null)?.usage ?? {}) as Json
      const read = Number(raw.cache_read_input_tokens ?? 0)
      const input = Number(raw.input_tokens ?? 0) + Number(raw.cache_creation_input_tokens ?? 0) + read
      const output = Math.ceil(outputChars / STREAMED_CHARS_PER_TOKEN)
      const priced = firstEventAt !== null ? anthropicCostUsd(ctx.model, { ...raw, output_tokens: output }) : null
      try { await ctx.log({ model, inputTokens: input, cachedInputTokens: read, outputTokens: priced === null ? 0 : output, reasoningTokens: 0, totalTokens: input + (priced === null ? 0 : output),
        costUsd: priced, ...(priced === null ? {} : { costBasis: 'streamed_output_estimate' as const }), success: false, latencyMs: Date.now() - startedAt,
        errorCode: cut ? active ? 'model_output_window' : 'model_output_window_silent' : controller.signal.aborted ? 'local_timeout' : 'network_or_stream' }) }
      catch { /* the ledger never decides the call outcome */ }
    }
    if (cut) return { ...fail<T>(model, 'model_output_window'), failure: { code: 'model_output_window' } }
    return fail(model, `Network error: ${msg}`)
  } finally { clearTimeout(timer) }

  const raw = (message.usage ?? {}) as Json
  const write = Number(raw.cache_creation_input_tokens ?? 0), read = Number(raw.cache_read_input_tokens ?? 0)
  const inputTokens = Number(raw.input_tokens ?? 0) + write + read, outputTokens = Number(raw.output_tokens ?? 0)
  const usage = { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens, cached_input_tokens: read, reasoning_tokens: 0 }
  const estimatedCostUsd = anthropicCostUsd(ctx.model, raw)
  const servedBy = typeof message.model === 'string' ? message.model : model
  const log = (success: boolean,errorCode?:string) => ctx.log({errorCode,latencyMs:Date.now()-startedAt, model: servedBy, inputTokens, cachedInputTokens: read, outputTokens, reasoningTokens: 0,
    totalTokens: usage.total_tokens, costUsd: estimatedCostUsd, success })
  const base = { usage, model: servedBy, reasoningEffort: ctx.effort, estimatedCostUsd, responseId: typeof message.id === 'string' ? message.id : undefined }
  const phaseAware = options.responsePhaseMode === 'aware'
  const content = (message.content as Block[]).filter(Boolean)
  // Always returned: a stateless provider's caller must replay these items.
  const native = { outputItems: nativeItems(content) }
  const strict = !!(options.schema && options.schemaName)
  const text = content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n\n')

  if (message.stop_reason === 'refusal') {
    await log(!strict,strict?'model_refusal':undefined)
    return { ...base, success: !strict, data: strict ? null : (text || 'model_refusal') as T, outputPhase: 'refusal', ...native, ...(strict ? { error: 'model_refusal',failure:{code:'model_refusal'} } : {}) }
  }
  if (message.stop_reason === 'max_tokens') {
    await log(false,'model_output_limit')
    return { ...base, success: false, data: null, failure:{code:'model_output_limit'}, error: 'model_output_limit', ...(phaseAware ? { outputPhase: 'incomplete' as const } : {}) }
  }
  const calls = content.filter(b => b.type === 'tool_use')
  if (calls.length) {
    await log(true)
    return { ...base, success: true, data: null, ...native, ...(phaseAware ? { outputPhase: 'tool_calls' as const } : {}),
      toolCalls: calls.map(b => ({ id: String(b.id), type: 'function' as const, function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } })) }
  }
  if (!text) {
    await log(false,content.some(b=>b.type==='thinking')?'model_reasoning_only':'model_empty_response')
    return { ...base, success: false, data: null, failure:{code:content.some(b=>b.type==='thinking')?'model_reasoning_only':'model_empty_response'}, error: content.some(b => b.type === 'thinking') ? 'model_reasoning_only' : 'No content in Anthropic response' }
  }
  const phase = phaseAware ? { outputPhase: 'legacy' as const } : {}
  if (!strict || (options.tools?.length && !options.structuredToolOutput)) {
    await log(true)
    return { ...base, success: true, data: text as T, ...native, ...phase }
  }
  let parsed: T | null = null
  try { parsed = JSON.parse(text) } catch { /* honest parse failure */ }
  // The wire schema drops bounds Claude cannot enforce; the original holds them.
  const issues=parsed!==null&&options.schema?schemaIssues(options.schema,parsed):[]
  const valid=parsed!==null&&!issues.length,code=parsed===null?'model_invalid_json':'model_schema_violation'
  await log(valid,valid?undefined:code)
  return { ...base, success: valid, data: valid ? parsed : null, ...native, ...phase,
    ...(valid ? {} : { error: options.structuredToolOutput ? 'invalid_structured_output' : 'Failed to parse JSON response',failure:{code,schemaPaths:options.schema?safeSchemaPaths(options.schema,issues):[]} }) }
}
