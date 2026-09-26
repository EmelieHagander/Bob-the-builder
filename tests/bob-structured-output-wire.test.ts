import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createCadAssistant } from '../supabase/functions/_shared/cad-assistant.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createDeliveryLanguage, DELIVERY_MEANINGS } from '../supabase/functions/_shared/delivery-language.ts'
import { handoff } from './support/cad-review-fixture.ts'

// Real Bob call sites through the unchanged shared adapter. Only database and
// HTTP I/O are mocked; inspecting call-site options alone missed this regression.
test('CAD review and recovery language send strict response schemas and no tools to the provider', async () => {
  const g = globalThis as any, oldFetch = g.fetch, oldDeno = g.Deno
  const requests: any[] = []
  const model = { model_name: 'wire-fixture', supports_images: true, supports_reasoning: true,
    supports_image_output: false, is_default: true, max_output_tokens: 16000,
    input_cost_per_1m_tokens: 1, output_cost_per_1m_tokens: 1, cached_input_cost_per_1m_tokens: null }
  g.__bobStructuredWireClient = () => ({ from: (table: string) => {
    let functionName = ''
    const query: any = { select: () => query, eq: (key: string, value: string) => { if (key === 'function_name') functionName = value; return query }, in: () => query,
      insert: async () => ({ error: null }),
      then: (yes: any, no: any) => Promise.resolve({ data: table === 'ai_models' ? [model] : functionName === 'cad-reviewer' ? [{ model: model.model_name, module_id: 'cad', max_output_tokens: 12000, reasoning_effort: 'high', is_enabled: true }] : [], error: null }).then(yes, no) }
    return query
  } })
  g.Deno = { env: { get: (name: string) => ({ SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', OPENAI_API_KEY: 'fixture-provider' } as any)[name] } }
  const review = { verdict: 'pass', summary: 'Concept reviewed', requirements: [{ id: 'shape', status: 'met', evidence: 'Exact panel dimensions' }], issues: [] }
  const language = { ...DELIVERY_MEANINGS, missing_label: 'Missing results', saved_label: 'Saved changes' }
  g.fetch = async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    const body = JSON.parse(String(init.body)); requests.push(body)
    const name = body.text?.format?.name
    return Response.json({ id: 'review-response', output_text: JSON.stringify(name === 'bob_delivery_language' ? language : review),
      usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 } })
  }
  try {
    let source = await readFile(new URL('../supabase/functions/_shared/openai-service.ts', import.meta.url), 'utf8')
    source = source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/, 'const createClient = (globalThis as any).__bobStructuredWireClient;')
    source = source.replace("'./openai-content.ts'", JSON.stringify(new URL('../supabase/functions/_shared/openai-content.ts', import.meta.url).href))
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    const service = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
    const recipe = { contract_version: 1 as const, units: 'mm' as const, assembly_id: 'panel',
      definitions: [{ id: 'panel', primitive: 'box' as const, x_mm: 600, y_mm: 250, z_mm: 18, material_ref: null }],
      instances: [{ id: 'panel-1', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front' as const, 'top' as const] }
    const reply = { success: true, data: 'Inspect the rendered panel', responseId: 'designer-response', model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
    let designerCalls = 0
    const cad = createCadAssistant({ projectId: 'A', userId: 'u', ownerRequest: 'Draw the panel', available: true,
      deadline: Date.now() + 300000, hasAccess: async () => true, readArtifact: async () => null,
      makeLookup: () => createProjectLookup('A', async (_p, q) => ({ data: { records: q.dataset === 'target' ? [{ id: 'project', revision: 1, solution_id: 'solution' }] : [], related: [], truncated: false }, error: null }), 1000, 40),
      render: async r => ({ recipe: r, manifest: {}, files: {}, previews: { front: 'Zml4dHVyZQ==', top: 'Zml4dHVyZQ==' } }),
      callModel: async o => o.functionName === 'cad-reviewer' ? service.callOpenAIResponses(o) : ++designerCalls === 1 ? { ...reply, toolCalls: [{ id: 'render', type: 'function', function: { name: 'render_cad_candidate', arguments: JSON.stringify({ recipe, title: 'Panel', description: 'Synthetic panel', assumptions: 'Concept only', target_revision: 1, measurements: [], source_artifact_id: null, source_revision: null, part_ids: [] }) } }] } : reply,
    })
    assert.equal((await cad.consult({ handoff, brief: 'Draw the panel', area_id: null, component_id: null, step_id: null, artifact_id: null })).status, 'ready')
    const format = createDeliveryLanguage({ userId: 'u', message: 'Continue in English', hasAccess: async () => true, callModel: service.callOpenAIResponses })
    assert.equal(await format({ notice: 'incomplete' }), language.incomplete)
    assert.equal(requests.length, 2)
    for (const [i, name] of ['bob_cad_review', 'bob_delivery_language'].entries()) {
      const body = requests[i]
      assert.equal(body.text?.format?.name, name, 'The declared response schema must reach the actual provider request')
      assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true)
      assert.equal(body.text.format.schema.additionalProperties, false)
      assert.equal(body.tools, undefined); assert.equal(body.previous_response_id, undefined)
    }
    assert(requests[0].input.some((m: any) => m.content?.some((p: any) => p.type === 'input_image')))
    assert.deepEqual(requests[0].text.format.schema.required, ['verdict', 'summary', 'requirements', 'issues'])
    assert.equal(requests[0].max_output_tokens, 12000, 'The governed reviewer budget must not be silently clipped to 5k')
    assert.deepEqual(requests[0].reasoning, { effort: 'high' })
    assert.equal(requests[1].max_output_tokens, 2000, 'Recovery language retains its separate bounded budget')
  } finally { g.fetch = oldFetch; g.Deno = oldDeno; delete g.__bobStructuredWireClient }
})
