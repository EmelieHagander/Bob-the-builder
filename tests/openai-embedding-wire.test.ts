import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createAiCatalogSession, validateAiCall, type AiCatalogManifest, type AiCatalogDefinition } from '../supabase/functions/_shared/ai-catalog.ts'

const definition = (key: string, kind: AiCatalogDefinition['definition_kind'], body: Record<string, unknown>): AiCatalogDefinition => ({ id: key + ':v1', prompt_id: key, prompt_key: key, version: 1, definition_kind: kind, definition_format_version: 1, content: '', definition: body, metadata: {}, payload_hash: 'fixture' })
function manifest(): AiCatalogManifest {
  return { format_version: 1, app: 'bob', manifest_id: 'embedding-pinned', created_at: '2026-10-18T09:00:00Z', definitions: [
    definition('role.memory-embedding', 'role', { profile_key: 'profile.memory-embedding', prompt_keys: [] }),
    definition('profile.memory-embedding', 'execution_profile', { tier: 'embedding', provider_parameters: { dimensions: 256 }, timeout_ms: 700 }),
    definition('tier.embedding', 'tier_binding', { tier: 'embedding', model_name: 'fixture-embedding' }),
  ], models: [{ model_name: 'fixture-embedding', provider: 'openai', model_type: 'embedding', is_active: true, is_default: false, max_output_tokens: 1, supports_images: false, supports_reasoning: false, supports_image_output: false, input_cost_per_1m_tokens: 0.02, output_cost_per_1m_tokens: 0, cached_input_cost_per_1m_tokens: null, capabilities: { provider_adapter: 'openai-embeddings-v1', supports_embedding_dimensions: true, max_embedding_dimensions: 1536, max_batch_inputs: 2048 } }] }
}
const resolve = (snapshot = manifest()) => createAiCatalogSession({ rpc: async () => { throw new Error('pinned') } }, { app: 'bob', manifest: snapshot }).role('memory-embedding')

test('embedding roles pin dimensions without a language prompt and cannot use Responses or image adapters', () => {
  const role = resolve()
  assert.equal(role.providerParameters.dimensions, 256)
  assert.equal(role.systemMessage, '')
  assert.equal(role.maxOutputTokens, 0)
  validateAiCall(role, { app: 'bob', embeddings: true })
  for (const input of [{ app: 'bob' }, { app: 'other', embeddings: true }, { app: 'bob', imageOutput: true }, { app: 'bob', embeddings: true, tools: true }]) assert.throws(() => validateAiCall(role, input), /ai_profile_incompatible/)
  for (const mutate of [
    (m: AiCatalogManifest) => { m.definitions[1].definition.provider_parameters = { dimensions: 0 } },
    (m: AiCatalogManifest) => { m.definitions[1].definition.provider_parameters = { dimensions: 2048 } },
    (m: AiCatalogManifest) => { m.definitions[1].definition.provider_parameters = { dimensions: 256, temperature: 0 } },
    (m: AiCatalogManifest) => { m.definitions[1].definition.reasoning_effort = 'high' },
    (m: AiCatalogManifest) => { m.definitions[1].definition.max_output_tokens = 100 },
    (m: AiCatalogManifest) => { m.models[0].capabilities.supports_embedding_dimensions = false },
    (m: AiCatalogManifest) => { m.models[0].capabilities.provider_adapter = 'openai-responses-v1' },
    (m: AiCatalogManifest) => { m.definitions[0].definition.prompt_keys = ['instructions'] },
  ]) { const snapshot = manifest(); mutate(snapshot); assert.throws(() => resolve(snapshot), /ai_profile_incompatible/) }
})

test('embedding wire preserves pins, accounts malformed billable output, checks live controls, and never retries', async () => {
  const g = globalThis as any, previous = { fetch: g.fetch, Deno: g.Deno, client: g.__embeddingClient }
  const requests: { url: string; body: any }[] = [], ledger: any[] = []
  let enabled = true, active = true, settingsAvailable = true, scenario = 'valid'
  g.__embeddingClient = () => ({ from: (table: string) => {
    const query: any = { select: () => query, eq: () => query, in: () => query,
      insert: async (row: any) => { ledger.push(row); return { error: null } },
      then: (yes: any, no: any) => Promise.resolve({ data: table === 'ai_models' ? [{ model_name: 'fixture-embedding', is_active: active }] : settingsAvailable ? [{ module_id: 'global', is_enabled: enabled, model: 'mutable-ignored' }] : [], error: null }).then(yes, no) }
    return query
  } })
  g.Deno = { env: { get: (name: string) => ({ OPENAI_API_KEY: 'provider-fixture', SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture' } as any)[name] } }
  const vector = (value: number) => new Array(256).fill(value)
  g.fetch = async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    if (scenario === 'transport') throw new Error('private source MUST_NOT_LEAK')
    if (scenario === 'http') return Response.json({ error: { message: 'private source MUST_NOT_LEAK' } }, { status: 429 })
    const result = { model: 'fixture-embedding', data: [{ index: 1, embedding: vector(.2) }, { index: 0, embedding: vector(.1) }], usage: { prompt_tokens: 100, total_tokens: 100 } }
    if (scenario === 'dimensions') result.data[0].embedding.pop()
    if (scenario === 'duplicate') result.data[0].index = 0
    if (scenario === 'model') result.model = 'other-model'
    if (scenario === 'zero') result.data[0].embedding = vector(0)
    return Response.json(result)
  }
  try {
    let source = await readFile(new URL('../supabase/functions/_shared/openai-service.ts', import.meta.url), 'utf8')
    source = source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/, 'const createClient = (globalThis as any).__embeddingClient;')
    for (const file of ['openai-content', 'ai-background', 'ai-catalog', 'schema-issues']) source = source.replace(`'./${file}.ts'`, JSON.stringify(new URL(`../supabase/functions/_shared/${file}.ts`, import.meta.url).href))
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    const { callOpenAIEmbeddings } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
    const options = { app: 'bob', module: 'global', aiFunction: 'memory-embedding', coworkerId: 'bob', functionName: 'memory-embedding', userId: 'user-id', aiDefinition: resolve(), input: ['private source MUST_NOT_LEAK', 'another private source'] }
    const reply = await callOpenAIEmbeddings(options)
    assert(reply.success)
    assert.deepEqual(reply.data, [vector(.1), vector(.2)], 'provider indices determine caller order')
    assert.equal(reply.estimatedCostUsd, .000002)
    assert.deepEqual(requests[0], { url: 'https://api.openai.com/v1/embeddings', body: { model: 'fixture-embedding', input: options.input, dimensions: 256, encoding_format: 'float' } })
    assert.equal(ledger[0].input_tokens, 100)
    assert.equal(ledger[0].output_tokens, 0)
    assert.equal(ledger[0].input_price_per_1m, .02)
    assert.equal(ledger[0].user_id, 'user-id')
    for (const invalid of [{ model: 'override' }, { dimensions: 512 }, { input: [] }, { input: [' '] }]) {
      assert.equal((await callOpenAIEmbeddings({ ...options, ...invalid })).success, false)
    }
    enabled = false; assert.equal((await callOpenAIEmbeddings(options)).error, 'AI function is disabled'); enabled = true
    active = false; assert.match((await callOpenAIEmbeddings(options)).error, /model retired/); active = true
    settingsAvailable = false; assert.match((await callOpenAIEmbeddings(options)).error, /function enablement/); settingsAvailable = true
    assert.equal(requests.length, 1, 'invalid calls and live revocation never reach provider')
    for (scenario of ['dimensions', 'duplicate', 'model', 'zero']) {
      const invalid = await callOpenAIEmbeddings(options)
      assert.equal(invalid.success, false); assert.equal(invalid.data, null)
      assert.equal(ledger.at(-1).input_tokens, 100, 'billable malformed responses remain accounted')
      assert.equal(ledger.at(-1).success, false)
    }
    scenario = 'http'
    assert.equal((await callOpenAIEmbeddings(options)).error, 'ai_embedding_provider_error: 429')
    assert.equal(ledger.at(-1).cost_usd, null, 'unknown provider usage is not invented')
    scenario = 'transport'
    const uncertain = await callOpenAIEmbeddings(options)
    assert.equal(uncertain.priorAttemptUncertain, true)
    assert.equal(requests.length, 7, 'exactly one dispatch per invocation, including rate limits and transport errors')
    assert.doesNotMatch(JSON.stringify(ledger) + JSON.stringify(uncertain), /MUST_NOT_LEAK|another private source|service-fixture|provider-fixture/)
  } finally { g.fetch = previous.fetch; g.Deno = previous.Deno; g.__embeddingClient = previous.client }
})
