import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { anthropicCostUsd, anthropicRequestBody, callAnthropicMessages, nativeItems, strictSchema, type AnthropicCallContext } from '../supabase/functions/_shared/anthropic-service.ts'
import { createAiCatalogSession, validateAiCall, type AiCatalogDefinition, type AiCatalogManifest, type AiCatalogModel } from '../supabase/functions/_shared/ai-catalog.ts'

const claude = { model_name: 'claude-opus-5-5', input_cost_per_1m_tokens: 4, output_cost_per_1m_tokens: 20, cached_input_cost_per_1m_tokens: 0.2, supports_images: true, capabilities: {} }
const sse = (...events: object[]) => new Response(events.map(e => 'event: x\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { status: 200 })
const ctx = (over: Partial<AnthropicCallContext> = {}): AnthropicCallContext => ({ apiKey: 'k', model: claude, systemMessage: 'Du är Bob.', maxOutputTokens: 16000, effort: 'high', timeoutMs: 5000, log: async () => {}, sleep: async () => {}, ...over })
const base = { app: 'bob', module: 'global', aiFunction: 'ask-bob', coworkerId: 'bob', functionName: 'ask-bob' }
const tool = { type: 'function' as const, function: { name: 'save_note', description: 'Save', parameters: { type: 'object', properties: { text: { type: 'string' } } }, strict: true } }

test('request maps system, effort, strict tools, schemas, images and native replay onto the Messages API', async () => {
  const thinking = { type: 'thinking', thinking: '', signature: 'sig' }
  const body: any = await anthropicRequestBody({ ...base, responseItemsMode: 'preserve', tools: [tool], tool_choice: 'required',
    messages: [
      { role: 'system', content: 'ignored' },
      { role: 'user', content: [{ type: 'text', text: 'Titta' }, { type: 'image_url', image_url: 'private-image:1' }] },
      { role: 'assistant', content: null, nativeOutput: [
        { type: 'reasoning', encrypted_content: 'openai-only' },
        { type: 'reasoning', provider: 'anthropic', encrypted_content: JSON.stringify(thinking) },
        { type: 'function_call', call_id: 'toolu_1', name: 'save_note', arguments: '{"text":"a"}' },
        { type: 'function_call', call_id: 'toolu_2', name: 'save_note', arguments: '{"text":"b"}' }] },
      { role: 'tool', tool_call_id: 'toolu_1', content: 'ok' },
      { role: 'tool', tool_call_id: 'toolu_2', content: 'ok' },
    ] }, ctx({ resolveImage: async () => 'data:image/png;base64,AAAA' }))
  assert.equal(body.system, 'Du är Bob.'); assert.equal(body.max_tokens, 16000); 
  assert.deepEqual(body.output_config, { effort: 'high' }); assert.equal(body.stream, true)
  // Tools go non-strict with their own schema (grammar limit); replayed thinking may be dropped, never fatal.
  assert.deepEqual(body.tools[0].input_schema, tool.function.parameters); assert.equal(body.tools[0].strict, undefined)
  assert.deepEqual(body.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } })
  assert.deepEqual(body.tool_choice, { type: 'auto' }, 'forced choice needs a declared model capability')
  assert.equal(body.messages.length, 3)
  assert.deepEqual(body.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
  assert.deepEqual(body.messages[1].content.map((b: any) => b.type), ['thinking', 'tool_use', 'tool_use'], 'OpenAI reasoning dropped, Claude thinking replayed unchanged')
  assert.deepEqual(body.messages[1].content[0], thinking)
  assert.deepEqual(body.messages[2].content.map((b: any) => b.tool_use_id), ['toolu_1', 'toolu_2'], 'all results in one user turn')
  const schema: any = await anthropicRequestBody({ ...base, prompt: 'x', schemaName: 's', schema: { type: 'object', properties: { a: { type: 'string' } } } }, ctx({ effort: null }))
  assert.deepEqual(schema.output_config, { format: { type: 'json_schema', schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false } } })
  await assert.rejects(anthropicRequestBody({ ...base, prompt: 'x', previousResponseId: 'resp_1' }, ctx()), /previous response pointer/)
  await assert.rejects(anthropicRequestBody({ ...base, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'file-abc' }] }] }, ctx()), /provider_image_unsupported/)
})

test('streamed tool turn returns tool calls, replayable native items, usage, cost and one ledger row', async () => {
  const ledger: any[] = [], sent: any[] = []
  let calls = 0
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push(init); calls++
    if (calls === 1) return new Response('{"error":{"type":"overloaded_error"}}', { status: 529 })
    return sse(
      { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_9', name: 'save_note', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"text":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"hej"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 500 } },
      { type: 'message_stop' })
  }) as typeof globalThis.fetch
  const result = await callAnthropicMessages({ ...base, prompt: 'Spara', tools: [tool], responseItemsMode: 'preserve', responsePhaseMode: 'aware' }, ctx({ fetch, log: async r => { ledger.push(r) } }))
  assert.equal(calls, 2, 'overloaded is retried')
  assert.equal((sent[1].headers as any)['x-api-key'], 'k')
  assert.equal(result.success, true); assert.equal(result.outputPhase, 'tool_calls')
  assert.deepEqual(result.toolCalls, [{ id: 'toolu_9', type: 'function', function: { name: 'save_note', arguments: '{"text":"hej"}' } }])
  assert.deepEqual(result.outputItems!.map(i => i.type), ['reasoning', 'function_call'])
  assert.deepEqual(JSON.parse(String(result.outputItems![0].encrypted_content)), { type: 'thinking', thinking: '', signature: 'abc' })
  assert.deepEqual(result.usage, { input_tokens: 3100, output_tokens: 500, total_tokens: 3600, cached_input_tokens: 2000, reasoning_tokens: 0 })
  const cost = (100 * 4 + 1000 * 4 * 1.25 + 2000 * 0.2 + 500 * 20) / 1e6
  assert.ok(Math.abs(result.estimatedCostUsd! - cost) < 1e-12)
  assert.equal(ledger.length, 1); assert.equal(ledger[0].success, true)
})

// Entry, 2026-11-06: Konrad thought in silence past our 120 s twice; the
// identical resend repeated it. After message_start the deadline means the
// answer did not fit the window, so the caller retries with a note instead.
test('a locally timed-out Claude stream after message_start reports content-free timing and the silent window code', async () => {
  const originalError = console.error
  const diagnostics: string[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"secret-message","content":[]}}\n\n'))
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
      },
    })
    return new Response(stream, { status: 200, headers: { 'request-id': 'req_fixture' } })
  }) as typeof globalThis.fetch
  console.error = (...parts: unknown[]) => { diagnostics.push(parts.map(String).join(' ')) }
  try {
    const logged: any[] = []
    const result = await callAnthropicMessages({ ...base, prompt: 'private prompt' }, ctx({ fetch, timeoutMs: 40, log: async r => { logged.push(r) } }))
    assert.equal(result.success, false)
    assert.equal(result.error, 'model_output_window')
    assert.deepEqual((result as any).failure, { code: 'model_output_window' })
    // The stream never reported its input: the cost stays unknown, not 0.
    assert.deepEqual(logged.map(r => [r.errorCode, r.costUsd, r.costBasis, r.outputTokens, r.success]), [['model_output_window_silent', null, undefined, 0, false]])
    assert.equal(diagnostics.length, 1)
    const diagnostic = JSON.parse(diagnostics[0].slice('[Anthropic Service] Request error '.length))
    assert.equal(diagnostic.kind, 'local_timeout')
    assert.equal(diagnostic.timeout_ms, 40)
    assert.equal(diagnostic.events, 1)
    assert.equal(diagnostic.request_id, 'req_fixture')
    assert.ok(diagnostic.first_event_ms !== null)
    assert.ok(diagnostic.since_last_event_ms !== null)
    assert.ok(diagnostic.elapsed_ms >= 30)
    assert.doesNotMatch(diagnostics[0], /private prompt|secret-message/, 'no request or streamed content may enter logs')
  } finally { console.error = originalError }
})

test('an answer still streaming when our deadline closes is reported as too long, not as a lost connection', async () => {
  const originalError = console.error
  console.error = () => {}
  const fetch = (async (_url: string, init: RequestInit) => {
    const encode = (e: object) => new TextEncoder().encode('event: x\ndata: ' + JSON.stringify(e) + '\n\n')
    let timer: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode({ type: 'message_start', message: { id: 'm', content: [], usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90 } } }))
        controller.enqueue(encode({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
        timer = setInterval(() => controller.enqueue(encode({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'del ' } })), 5)
        init.signal?.addEventListener('abort', () => { clearInterval(timer); controller.error(new DOMException('aborted', 'AbortError')) }, { once: true })
      },
    })
    return new Response(stream, { status: 200 })
  }) as typeof globalThis.fetch
  try {
    const logged: any[] = []
    const result = await callAnthropicMessages({ ...base, prompt: 'x' }, ctx({ fetch, timeoutMs: 60, log: async r => { logged.push(r) } }))
    assert.equal(result.success, false); assert.equal(result.error, 'model_output_window')
    // A billed request is priced in the ledger: its known input, and its output
    // estimated from what streamed, marked as an estimate (owner decision 2026-11-07).
    assert.equal(logged.length, 1)
    const { outputTokens, costUsd, totalTokens, ...rest } = logged[0]
    assert.deepEqual({ ...rest, latencyMs: undefined }, { model: 'claude-opus-5-5', inputTokens: 1000, cachedInputTokens: 900, reasoningTokens: 0,
      costBasis: 'streamed_output_estimate', success: false, errorCode: 'model_output_window', latencyMs: undefined })
    assert.ok(outputTokens > 0, 'the streamed text counts as output')
    assert.equal(totalTokens, 1000 + outputTokens)
    assert.equal(costUsd, anthropicCostUsd(ctx({}).model, { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: outputTokens }))
    // The turn budget counts the estimate; it is not a provider receipt, so a
    // drawing reservation stays pending rather than storing a reusable failure.
    assert.deepEqual((result as any).costEstimate, { usd: costUsd, basis: 'streamed_output_estimate' })
    assert.equal((result as any).estimatedCostUsd, undefined)
    assert.deepEqual((result as any).failure, { code: 'model_output_window' })
  } finally { console.error = originalError }
})

test('text, strict JSON, refusal and output limit outcomes are honest', async () => {
  const reply = (stop: string, text: string) => (async () => sse(
    { type: 'message_start', message: { id: 'm', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 3 } })) as unknown as typeof fetch
  assert.equal((await callAnthropicMessages({ ...base, prompt: 'Hej' }, ctx({ fetch: reply('end_turn', 'Hej!') }))).data, 'Hej!')
  const strict = { ...base, prompt: 'x', schemaName: 's', schema: { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } }, tools: [tool], structuredToolOutput: true }
  assert.deepEqual((await callAnthropicMessages(strict, ctx({ fetch: reply('end_turn', '{"a":"b"}') }))).data, { a: 'b' })
  assert.equal((await callAnthropicMessages(strict, ctx({ fetch: reply('end_turn', '{"a":1}') }))).error, 'invalid_structured_output')
  assert.equal((await callAnthropicMessages(strict, ctx({ fetch: reply('refusal', '') }))).error, 'model_refusal')
  const limit = await callAnthropicMessages({ ...base, prompt: 'x', responsePhaseMode: 'aware' }, ctx({ fetch: reply('max_tokens', 'Halv') }))
  assert.equal(limit.success, false); assert.equal(limit.error, 'model_output_limit'); assert.equal(limit.outputPhase, 'incomplete')
  const bad = await callAnthropicMessages({ ...base, prompt: 'x' }, ctx({ fetch: (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch }))
  assert.equal(bad.error, 'Anthropic API error: 400')
  assert.deepEqual(nativeItems([{ type: 'text', text: 'a' }]), [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a' }] }])
})

const def = (key: string, kind: AiCatalogDefinition['definition_kind'], body: Record<string, unknown> = {}, content = ''): AiCatalogDefinition => ({ id: key + ':v1', prompt_id: key, prompt_key: key, version: 1, definition_kind: kind, definition_format_version: 1, content, definition: body, metadata: {}, payload_hash: 'h' })
const claudeRow = (): AiCatalogModel => ({ model_name: 'claude-opus-5-5', provider: 'anthropic', model_type: 'standard', is_active: true, is_default: false, max_output_tokens: 128000, supports_images: true, supports_reasoning: true, supports_image_output: false, input_cost_per_1m_tokens: 4, output_cost_per_1m_tokens: 20, cached_input_cost_per_1m_tokens: 0.2, capabilities: { provider_adapter: 'anthropic-messages-v1', reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max'], supports_functions: true, supports_json_schema: true } })
const claudeManifest = (tier = 'standard', params: Record<string, unknown> = {}): AiCatalogManifest => ({ format_version: 1, app: 'bob', manifest_id: 'm', created_at: '2026-11-02T00:00:00Z', models: [claudeRow()], definitions: [
  def('role.ask-bob', 'role', { prompt_keys: ['bob.persona'], profile_key: 'profile.ask-bob' }), def('bob.persona', 'prompt', {}, 'Du är Bob.'),
  def('profile.ask-bob', 'execution_profile', { tier, reasoning_effort: 'high', max_output_tokens: 16000, provider_parameters: params }),
  def('tier.' + tier, 'tier_binding', { tier, model_name: 'claude-opus-5-5' })] })
const catalog = (m: AiCatalogManifest) => createAiCatalogSession({ rpc: async () => { throw new Error('no') } }, { app: 'bob', manifest: m })

test('the catalog binds Claude to text tiers only, without OpenAI-only parameters', () => {
  const role = catalog(claudeManifest()).role('ask-bob')
  assert.equal(role.providerAdapter, 'anthropic-messages-v1')
  validateAiCall(role, { app: 'bob', tools: true, images: true, schema: true })
  assert.throws(() => validateAiCall(role, { app: 'bob', embeddings: true }), /provider adapter/)
  assert.throws(() => catalog(claudeManifest('standard', { temperature: 0.2 })).role('ask-bob'), /provider parameters/)
  assert.throws(() => catalog(claudeManifest('image')).role('ask-bob'), /model class/)
  const wrong = claudeManifest(); wrong.models[0].provider = 'openai'
  assert.throws(() => catalog(wrong).role('ask-bob'), /provider adapter/)
})

test('the shared service keeps Claude off unless the ANTHROPIC_ENABLED code switch is true', async () => {
  const g = globalThis as any, oldFetch = g.fetch, oldDeno = g.Deno
  // A vendor adapter must not require another vendor's API credentials.
  const env: Record<string, string> = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'x', ANTHROPIC_API_KEY: 'a' }
  const urls: string[] = [], ledger: any[] = []
  g.__claudeClient = () => ({ from: (table: string) => {
    const q: any = { select: () => q, eq: () => q, in: () => q, insert: async (row: any) => { ledger.push(row); return { error: null } },
      then: (yes: any, no: any) => Promise.resolve({ data: table === 'ai_models' ? [{ model_name: 'claude-opus-5-5', is_active: true }] : [{ module_id: 'global', is_enabled: true }], error: null }).then(yes, no) }
    return q
  } })
  g.Deno = { env: { get: (name: string) => env[name] } }
  g.fetch = async (url: string) => { urls.push(url); return sse(
    { type: 'message_start', message: { id: 'm', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hej' } }, { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }) }
  try {
    const shared = (file: string) => new URL(`../supabase/functions/_shared/${file}.ts`, import.meta.url)
    const asModule = (code: string) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')
    const adapterSource = (await readFile(shared('anthropic-service'), 'utf8')).replace("'./schema-issues.ts'", JSON.stringify(shared('schema-issues').href)).replace("'./tool-schema-dedup.ts'", JSON.stringify(shared('tool-schema-dedup').href))
    assert.match(adapterSource, /export const ANTHROPIC_ENABLED = (true|false)\n/, 'one literal switch')
    const load = async (enabled: boolean) => {
      let source = await readFile(shared('openai-service'), 'utf8')
      source = source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/, 'const createClient = (globalThis as any).__claudeClient;')
      for (const file of ['openai-content', 'ai-background', 'ai-catalog', 'schema-issues']) source = source.replace(`'./${file}.ts'`, JSON.stringify(shared(file).href))
      source = source.replace("'./anthropic-service.ts'", JSON.stringify(asModule(adapterSource.replace(/ANTHROPIC_ENABLED = (true|false)/, 'ANTHROPIC_ENABLED = ' + enabled))))
      return (await import(asModule(source))).callOpenAIResponses
    }
    const aiDefinition = catalog(claudeManifest()).role('ask-bob')
    const off = await (await load(false))({ ...base, prompt: 'Hej', aiDefinition })
    assert.equal(off.success, false); assert.equal(off.error, 'ai_provider_disabled: anthropic'); assert.equal(urls.length, 0, 'no provider call while off')
    const on = await (await load(true))({ ...base, prompt: 'Hej', aiDefinition })
    assert.equal(on.data, 'Hej'); assert.deepEqual(urls, ['https://api.anthropic.com/v1/messages'])
    assert.equal(ledger.length, 1); assert.equal(ledger[0].model, 'claude-opus-5-5'); assert.equal(ledger[0].app, 'bob')
  } finally { g.fetch = oldFetch; g.Deno = oldDeno; delete g.__claudeClient }
})

test('every strict Bob tool and response schema translates to the keyword subset Claude strict mode accepts', async () => {
  const { catalogFixture } = await import('./support/ai-catalog-fixture.ts')
  let manifest: any
  catalogFixture(snapshot => { manifest = structuredClone(snapshot) })
  const banned = /^(minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf|minLength|maxLength|pattern|maxItems|uniqueItems|minProperties|maxProperties|oneOf)$/
  const check = (schema: any, where: string) => {
    const walk = (node: any, path: string) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, path + '[' + i + ']'))
      for (const [k, v] of Object.entries(node)) {
        const parent = path.split('.').at(-1)
        if (parent !== 'properties' && banned.test(k)) assert.fail(where + ' keeps ' + path + '.' + k)
        if (parent !== 'properties' && k === 'minItems') assert.ok(v === 0 || v === 1, where + ' minItems ' + v)
        if (parent !== 'properties' && k === 'additionalProperties') assert.equal(v, false, where + ' ' + path)
        walk(v, path + '.' + k)
      }
    }
    walk(strictSchema(schema, true), '$')
  }
  let count = 0
  for (const d of manifest.definitions) {
    const body = d.definition, fn = body.function ?? body
    if (d.definition_kind === 'tool_contract' && fn.strict === true) { check(fn.parameters, d.prompt_key); count++ }
    if (d.definition_kind === 'response_schema' && body.strict !== false) { check(body.schema ?? body, d.prompt_key); count++ }
  }
  assert.ok(count > 10, 'checked ' + count)
  const sample = strictSchema({ type: 'object', properties: { tags: { type: 'array', maxItems: 3, minItems: 2, items: { type: 'string', maxLength: 9, format: 'json' } }, id: { type: 'string', format: 'uuid' } } }, true)
  assert.deepEqual(sample, { type: 'object', properties: { tags: { type: 'array', items: { type: 'string', description: '{maxLength: 9, format: "json"}' }, description: '{maxItems: 3, minItems: 2}' }, id: { type: 'string', format: 'uuid' } }, required: ['tags', 'id'], additionalProperties: false })
})

test('structured helper failures retain safe codes, field paths and ledger latency without raw output',async()=>{
 for(const [text,code,paths] of [['not json PRIVATE','model_invalid_json',[]],['{"tools":[1],"PRIVATE_KEY":"PRIVATE_VALUE"}','model_schema_violation',['$.tools[0]']]] as const){
  const ledger:any[]=[]
  const response=await callAnthropicMessages({...base,aiFunction:'tool-picker',prompt:'PRIVATE PROMPT',schemaName:'bob_tool_pick',structuredToolOutput:true,schema:{type:'object',additionalProperties:false,required:['tools'],properties:{tools:{type:'array',items:{type:'string'}}}}},ctx({log:async r=>{ledger.push(r)},fetch:(async()=>sse({type:'message_start',message:{id:'msg_diag',model:claude.model_name,content:[],usage:{input_tokens:10,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}})) as typeof fetch}))
  assert.equal(response.success,false);assert.equal(response.failure?.code,code);assert.deepEqual(response.failure?.schemaPaths,paths);assert.equal(ledger[0].errorCode,code);assert(ledger[0].latencyMs>=0);assert(!JSON.stringify({failure:response.failure,ledger}).includes('PRIVATE'))
 }
})

test('a deadline before Claude sends anything keeps the plain network code, so the identical retry stays allowed', async () => {
  const originalError = console.error
  console.error = () => {}
  const fetch = (async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
    start(controller) { init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true }) },
  }), { status: 200 })) as typeof globalThis.fetch
  try {
    const logged: any[] = []
    const result = await callAnthropicMessages({ ...base, prompt: 'x' }, ctx({ fetch, timeoutMs: 40, log: async r => { logged.push(r) } }))
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /^Network error:/)
    assert.equal((result as any).failure, undefined)
    assert.deepEqual(logged.map(r => [r.errorCode, r.inputTokens, r.costUsd]), [['local_timeout', 0, null]])
  } finally { console.error = originalError }
})

// Owner decision 2026-11-06: fixed cache points beside the automatic one.
test('fixed cache points mark the system prompt and flagged messages only under the pin; the automatic tail point stays', async () => {
  const messages = [{ role: 'user' as const, content: 'Job start.', cacheBoundary: 1 as const }, { role: 'assistant' as const, content: 'Reading.' }, { role: 'user' as const, content: 'More.' }]
  const plain: any = await anthropicRequestBody({ ...base, messages }, ctx())
  const pinned: any = await anthropicRequestBody({ ...base, messages, promptCachePoints: 1 }, ctx())
  assert.equal(plain.system, 'Du är Bob.')
  assert.deepEqual(plain.cache_control, { type: 'ephemeral' })
  assert.ok(plain.messages.every((m: any) => m.content.every((b: any) => b.cache_control === undefined)), 'a flag without the pin changes nothing')
  assert.deepEqual(pinned.system, [{ type: 'text', text: 'Du är Bob.', cache_control: { type: 'ephemeral' } }])
  assert.deepEqual(pinned.cache_control, { type: 'ephemeral' })
  assert.deepEqual(pinned.messages.map((m: any) => m.content.map((b: any) => b.cache_control ? 1 : 0)), [[1], [0], [0]])
  // A flagged tool result keeps its point on that block even when the next user text merges into the same message.
  const merged: any = await anthropicRequestBody({ ...base, promptCachePoints: 1, messages: [{ role: 'user', content: 'a' },
    { role: 'assistant', content: 'b', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'save_note', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}', cacheBoundary: 1 }, { role: 'user', content: 'next' }] }, ctx())
  assert.deepEqual(merged.messages.map((m: any) => m.content.map((b: any) => [b.type, b.cache_control ? 1 : 0])),
    [[['text', 0]], [['text', 0], ['tool_use', 0]], [['tool_result', 1], ['text', 0]]])
})
