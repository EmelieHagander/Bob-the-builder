import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

test('native search uses the selected domain, requires retrieval and returns provider source evidence with an unknown total', async () => {
  const g = globalThis as any, prior = { fetch: g.fetch, Deno: g.Deno }
  const catalog = catalogFixture(), role = catalog.role('store-worker'), schema = catalog.schema('bob_store_research')
  const requests: any[] = [], ledger: any[] = []
  g.__webClient = () => ({ from: (table: string) => {
    const q: any = { select: () => q, eq: () => q, in: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      insert: async (row: any) => { ledger.push(row); return { error: null } },
      then: (yes: any, no: any) => Promise.resolve({ data: table === 'ai_models' ? [role.model] : table === 'ai_settings' ? [{ module_id: 'global', is_enabled: true }] : [], error: null }).then(yes, no) }
    return q
  } })
  g.Deno = { env: { get: (name: string) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture', OPENAI_API_KEY: 'fixture' } as any)[name] } }
  g.fetch = async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return Response.json({ id: 'resp-web', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url: 'https://byggmax.se/p', title: 'Product' }] } },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ products: [], missing: ['No matching size'] }),
          annotations: [{ type: 'url_citation', url: 'https://byggmax.se/p', title: 'Product' }] }] }] })
  }
  try {
    let source = await readFile(new URL('../supabase/functions/_shared/openai-service.ts', import.meta.url), 'utf8')
    source = source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/, 'const createClient = (globalThis as any).__webClient;')
    for (const file of ['openai-content', 'ai-background', 'ai-catalog', 'schema-issues', 'anthropic-service'])
      source = source.replace(`'./${file}.ts'`, JSON.stringify(new URL(`../supabase/functions/_shared/${file}.ts`, import.meta.url).href))
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    const { callOpenAIResponses: call } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
    const opts = { app: 'bob', coworkerId: 'bob', functionName: 'store-worker', aiFunction: 'store-worker', module: 'global',
      aiDefinition: role, systemMessage: role.systemMessage, schemaName: schema.name, schema: schema.schema,
      messages: [{ role: 'user', content: 'Plywood 15 mm' }], webSearch: { allowedDomains: ['byggmax.se'] } }
    const result = await call(opts)
    assert.equal(result.success, true, result.error)
    assert.deepEqual(requests[0].tools, [{ type: 'web_search', external_web_access: true, filters: { allowed_domains: ['byggmax.se'] } }])
    assert.equal(requests[0].tool_choice, 'required')
    assert.deepEqual(requests[0].include, ['web_search_call.action.sources'])
    assert.equal(result.webSearch.completedCalls, 1)
    assert.deepEqual(result.webSearch.sources, [{ url: 'https://byggmax.se/p', title: 'Product' }])
    assert.equal(result.estimatedCostUsd, null)
    assert.equal(ledger[0].cost_usd, null)
    assert.equal(ledger[0].cost_basis, 'native_search_total_unknown')
    assert.equal(result.webSearch.tokenCostUsd > 0, true)
    assert.equal((await call({ ...opts, aiDefinition: undefined })).success, false)
    assert.equal((await call({ ...opts, webSearch: { allowedDomains: ['https://byggmax.se'] } })).success, false)
    assert.equal(requests.length, 1, 'invalid requests never reach the provider')
  } finally { g.fetch = prior.fetch; g.Deno = prior.Deno; delete g.__webClient }
})
