import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { anthropicRequestBody, callAnthropicMessages, nativeItems, type AnthropicCallContext } from '../supabase/functions/_shared/anthropic-service.ts'
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
  assert.equal(body.system, 'Du är Bob.'); assert.equal(body.max_tokens, 16000); assert.deepEqual(body.thinking, { type: 'adaptive' })
  assert.deepEqual(body.output_config, { effort: 'high' }); assert.equal(body.stream, true)
  assert.deepEqual(body.tools[0].input_schema.required, ['text']); assert.equal(body.tools[0].input_schema.additionalProperties, false); assert.equal(body.tools[0].strict, true)
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
  const env: Record<string, string> = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'x', OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'a' }
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
    const adapterSource = (await readFile(shared('anthropic-service'), 'utf8')).replace("'./schema-issues.ts'", JSON.stringify(shared('schema-issues').href))
    assert.match(adapterSource, /export const ANTHROPIC_ENABLED = false\n/, 'the committed switch is off')
    const load = async (enabled: boolean) => {
      let source = await readFile(shared('openai-service'), 'utf8')
      source = source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/, 'const createClient = (globalThis as any).__claudeClient;')
      for (const file of ['openai-content', 'ai-background', 'ai-catalog', 'schema-issues']) source = source.replace(`'./${file}.ts'`, JSON.stringify(shared(file).href))
      source = source.replace("'./anthropic-service.ts'", JSON.stringify(asModule(adapterSource.replace('ANTHROPIC_ENABLED = false', 'ANTHROPIC_ENABLED = ' + enabled))))
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
