import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

test('phase-aware Responses parsing selects final text, bounds commentary and preserves legacy callers', async () => {
  const g = globalThis as any, oldFetch = g.fetch, oldDeno = g.Deno
  const requests: any[] = [], ledger: any[] = []
  let output: any = {}
  const model = { model_name: 'phase-fixture', supports_images: true, supports_reasoning: true,
    supports_image_output: false, is_default: true, max_output_tokens: 16000,
    input_cost_per_1m_tokens: 1, output_cost_per_1m_tokens: 1, cached_input_cost_per_1m_tokens: null }
  g.__phaseClient = () => ({ from: (table: string) => {
    const q: any = { select: () => q, eq: () => q, in: () => q,
      insert: async (row: any) => { ledger.push(row); return { error: null } },
      then: (yes: any, no: any) => Promise.resolve({ data: table === 'ai_models' ? [model] : [], error: null }).then(yes, no) }
    return q
  } })
  g.Deno = { env: { get: (name: string) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture', OPENAI_API_KEY: 'fixture' } as any)[name] } }
  g.fetch = async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return Response.json({ id: 'resp-phase', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, ...output })
  }
  try {
    let source = await readFile(new URL('../supabase/functions/_shared/openai-service.ts', import.meta.url), 'utf8')
    source = source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/, 'const createClient = (globalThis as any).__phaseClient;')
    for (const file of ['openai-content', 'ai-background', 'ai-catalog', 'schema-issues']) source = source.replace(`'./${file}.ts'`, JSON.stringify(new URL(`../supabase/functions/_shared/${file}.ts`, import.meta.url).href))
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    const { callOpenAIResponses: call } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
    const options = { app: 'bob', coworkerId: 'bob', functionName: 'ask-bob', aiFunction: 'ask-bob', module: 'global', prompt: 'Continue', responsePhaseMode: 'aware' }
    const message = (phase: string | undefined, ...text: string[]) => ({ type: 'message', role: 'assistant', ...(phase ? { phase } : {}), content: text.map(text => ({ type: 'output_text', text })) })
    output = { output: [message('commentary', 'I will do it.'), message('final_answer', 'Saved one.', 'Saved two.'), message('final_answer', 'All requested changes saved.')], output_text: 'Unfiltered preamble and answer' }
    const final = await call(options)
    assert.equal(final.data, 'Saved one.\n\nSaved two.\n\nAll requested changes saved.'); assert.equal(final.outputPhase, 'final_answer')
    output = { output: [message('commentary', 'Working.')] }
    const progress = await call(options)
    assert(progress.success); assert.equal(progress.data, null); assert.equal(progress.outputPhase, 'commentary'); assert.equal(progress.responseId, 'resp-phase')
    output = { output: [message('commentary', 'Working.'), { type: 'function_call', call_id: 't1', name: 'read_work_context', arguments: '{}' }] }
    const tools = await call(options)
    assert.equal(tools.outputPhase, 'tool_calls'); assert.equal(tools.toolCalls[0].function.name, 'read_work_context'); assert.equal(tools.data, null)
    output = { output: [message(undefined, 'Legacy one.', 'Legacy two.'), message(undefined, 'Legacy three.')] }
    const aggregate = await call(options)
    assert.equal(aggregate.data, 'Legacy one.\n\nLegacy two.\n\nLegacy three.'); assert.equal(aggregate.outputPhase, 'legacy')
    const legacy = await call({ ...options, app: 'other-app', responsePhaseMode: undefined })
    assert.equal(legacy.data, 'Legacy one.'); assert.equal(legacy.outputPhase, undefined)
    output = { output: [message('final_answer', 'Done.')] }
    await call({ ...options, previousResponseId: 'prior', messages: [{ role: 'assistant', phase: 'commentary', content: 'Working.' }, { role: 'user', content: 'Continue.' }] })
    assert.equal(requests.at(-1).input[0].phase, 'commentary'); assert.equal(requests.at(-1).previous_response_id, 'prior')
    await call({ ...options, responsePhaseMode: undefined, messages: [{ role: 'assistant', phase: 'commentary', content: 'Working.' }] })
    assert.equal(requests.at(-1).input[0].phase, undefined)
    const strict = { ...options, schemaName: 'strict_reply', schema: { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } }, structuredToolOutput: true }
    output = { output: [message('commentary', '{"answer":"Preamble is not a verdict"}')] }
    const noVerdict = await call(strict)
    assert.equal(noVerdict.success, false); assert.equal(noVerdict.data, null); assert.equal(noVerdict.error, 'model_commentary_only')
    output = { output: [message('commentary', 'Working.'), message('final_answer', '{"answer":"Verified"}')] }
    assert.deepEqual((await call(strict)).data, { answer: 'Verified' })
    output = { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I cannot do that.' }] }, { type: 'function_call', call_id: 'bad', name: 'save', arguments: '{}' }] }
    const refusal = await call(options)
    assert.equal(refusal.data, 'I cannot do that.'); assert.equal(refusal.outputPhase, 'refusal'); assert.equal(refusal.toolCalls, undefined)
    assert.equal((await call(strict)).error, 'model_refusal')
    output = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [message('final_answer', 'Partial'), { type: 'function_call', call_id: 'bad', name: 'save', arguments: '{}' }] }
    const incomplete = await call(options)
    assert.equal(incomplete.success, false); assert.equal(incomplete.outputPhase, 'incomplete'); assert.equal(incomplete.data, null); assert.equal(incomplete.toolCalls, undefined)
    assert.equal(ledger.length, requests.length, 'every terminal outcome is accounted once')
  } finally { g.fetch = oldFetch; g.Deno = oldDeno; delete g.__phaseClient }
})
