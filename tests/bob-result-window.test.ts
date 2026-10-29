import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bobResultRecordKey, projectBobResult, selectBobResultWindow, BOB_RESULT_WINDOW_TARGET_SHARE, type BobArchivedOperation } from '../supabase/functions/_shared/bob-result-references.ts'
import { countSerializedTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'
import { catalogFixture, preResultWindowCatalogFixture } from './support/ai-catalog-fixture.ts'

// Owner decision 2026-10-29: Bob gets what he needs when he needs it. A read of
// the same record repeated later leaves the window first; the latest result
// per record stays whole under the unchanged ceiling.
const entry = (call_id: string, tool_name: string, args: unknown, tokens: number, older = true) =>
  ({ call_id, tool_name, arguments: typeof args === 'string' ? args : JSON.stringify(args), tokens, older })
const work = (revision: number | null, extra: Record<string, unknown> = {}) =>
  ({ artifact_id: 'A', revision, view: 'work', work_kind: 'parts', ids: [], after: null, section: null, result_id: null, step_id: null, ...extra })

test('record keys: a revision is the same record, a page cursor or another view is not, writes have none', () => {
  const key = (name: string, args: unknown) => bobResultRecordKey({ tool_name: name, arguments: JSON.stringify(args) })
  assert.equal(key('read_construction_draft', work(1)), key('read_construction_draft', { ...work(3), artifact_id: 'A' }))
  assert.equal(key('read_construction_draft', work(1)), key('read_construction_draft', Object.fromEntries(Object.entries(work(1)).reverse())), 'argument order is irrelevant')
  assert.notEqual(key('read_construction_draft', work(1)), key('read_construction_draft', work(1, { after: 'c2' })))
  assert.notEqual(key('read_construction_draft', work(1)), key('read_construction_draft', work(1, { view: 'parts' })))
  assert.notEqual(key('read_construction_draft', work(1)), key('read_construction_draft', work(1, { artifact_id: 'B' })))
  assert.equal(key('save_construction_draft', work(1)), null)
  assert.equal(key('check_construction_draft', { artifact_id: 'A', revision: 2 }), null)
  assert.equal(bobResultRecordKey({ tool_name: 'read_record', arguments: 'not json' }), null)
})

test('under pressure an older repeat of a record leaves first and the latest read stays whole', () => {
  const results = [
    entry('r1', 'read_construction_draft', work(1), 3000),
    entry('s1', 'search_material_catalog', { query: 'plywood' }, 800),
    entry('w1', 'save_construction_draft', work(1), 400),
    entry('r2', 'read_construction_draft', work(2), 3000),
    entry('r3', 'read_construction_draft', work(2), 3000, false),
  ]
  // Within the ceiling nothing is demoted, duplicates included: the cached prefix stays valid.
  const fits = selectBobResultWindow(results, 20000)
  assert.equal(fits.supersededBy.size, 0); assert.equal(fits.whole.size, 4)
  // Above the ceiling the superseded copies go first, with the newer call named.
  const over = selectBobResultWindow(results, 7000)
  assert.deepEqual([...over.supersededBy].sort(), [['r1', 'r3'], ['r2', 'r3']])
  assert.deepEqual([...over.whole].sort(), ['s1', 'w1'])
  // A repeat inside the always-whole recent exchanges is never superseded.
  const recent = selectBobResultWindow([entry('a', 'read_record', { id: 1 }, 10, false), entry('b', 'read_record', { id: 1 }, 10, false)], 1)
  assert.equal(recent.supersededBy.size, 0)
})

test('within the ceiling nothing else changes; above it the window drops to the target, state before discovery', () => {
  const results = [
    entry('state-old', 'read_solution_context', { ref: 'S' }, 6000),
    entry('search-1', 'search_material_catalog', { query: 'a' }, 4000),
    entry('search-2', 'search_material_catalog', { query: 'b' }, 4000),
    entry('state-new', 'read_construction_draft', work(1), 5000),
    entry('write', 'save_construction_draft', work(1), 900),
  ]
  const fits = selectBobResultWindow(results, 20000)
  assert.equal(fits.whole.size, 5, 'all 19,900 tokens fit: no demotion, so the prompt prefix is unchanged')
  const all = [...results, entry('search-3', 'search_material_catalog', { query: 'c' }, 4000)]
  const over = selectBobResultWindow(all, 20000)
  const target = Math.floor(20000 * BOB_RESULT_WINDOW_TARGET_SHARE)
  const used = [...over.whole].reduce((sum, id) => sum + all.find(r => r.call_id === id)!.tokens, 0)
  assert(used <= target, `${used} <= ${target}`)
  // 11,900 tokens of state and write results; no 4,000-token search fits under 15,000.
  assert.deepEqual([...over.whole].sort(), ['state-new', 'state-old', 'write'], 'state reads and writes outrank newer searches')
  // A smaller search still fits behind them: the fill skips, it does not stop.
  const small = selectBobResultWindow([...all, entry('search-4', 'search_material_catalog', { query: 'd' }, 2000)], 20000)
  assert(small.whole.has('search-4') && !small.whole.has('search-3'))
})

// --- Continuation integration -------------------------------------------------
const disk = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const schema = (name: string) => ({ type: 'function' as const, function: { name, description: 'Manual ' + name, parameters: { type: 'object' } } })
const fakeCatalog = { definition: () => ({ metadata: { continuation_input_tokens: 1_000_000, context_input_ceiling_tokens: 2_000_000,
  continuation_summary_tokens: 1600, retained_tool_exchanges: 1, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Keep uncertainty explicit.' }), tool: schema } as unknown as AiCatalogSession
const seed: OpenAIServiceOptions = { app: 'bob', coworkerId: 'bob', module: 'global', functionName: 'ask-bob', catalogRoleKey: 'ask-bob',
  responseItemsMode: 'preserve', tools: ['read_construction_draft', 'search_material_catalog', 'save_construction_draft'].map(schema),
  messages: [{ role: 'user', content: 'Build the box.' }] }
const body = (label: string, tokens: number) => JSON.stringify({ status: 'ok', revision: 1, label, text: (label + ' ').repeat(Math.ceil(tokens / 2)) })
type Step = { name: string; args: unknown; output: string }
function respond(step: Step | null, id: string): OpenAIServiceResponse {
  const calls = step ? [{ id, type: 'function' as const, function: { name: step.name, arguments: JSON.stringify(step.args) } }] : []
  return { success: true, model: 'fixture', data: step ? null : 'Done.', responseId: id, toolCalls: step ? calls : undefined,
    outputPhase: step ? 'tool_calls' : 'final_answer', usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    outputItems: step ? calls.map(c => ({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments }))
      : [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }] }
}
async function run(steps: Step[], window: { resultWindowTokens?: number; resultWindowVersion?: 2 }) {
  const sent: OpenAIServiceOptions[] = []
  const opts = { version: 1, mainResultReferences: 1 as const, aiCatalog: fakeCatalog, ...window,
    callModel: async (request: OpenAIServiceOptions) => { sent.push(disk(request)); return respond(steps[sent.length - 1] ?? null, 'c' + sent.length) } }
  let adapter = createBobContextContinuation(opts)
  for (let i = 0; i <= steps.length; i++) {
    // Every request runs on a fresh worker restored from the checkpoint.
    const saved = disk(adapter.exportState()); adapter = createBobContextContinuation(opts); adapter.restoreState(saved)
    await adapter.call(i === 0 ? seed : { ...seed, previousResponseId: 'c' + i, messages: [{ role: 'tool', tool_call_id: 'c' + i, content: steps[i - 1].output }] })
  }
  return { sent, adapter }
}
const steps: Step[] = [
  { name: 'read_construction_draft', args: work(1), output: body('packet-1', 3000) },
  ...['plywood', 'osb', 'mdf', 'glue'].map(query => ({ name: 'search_material_catalog', args: { query }, output: body('search-' + query, 2500) })),
  { name: 'read_construction_draft', args: work(2), output: body('packet-2', 3000) },
  ...['screw', 'nail', 'lath', 'board'].map(query => ({ name: 'search_material_catalog', args: { query }, output: body('search-' + query, 2500) })),
  { name: 'save_construction_draft', args: work(2), output: JSON.stringify({ status: 'saved', saved: true, revision: 2 }) },
  { name: 'search_material_catalog', args: { query: 'paint' }, output: body('search-paint', 2500) },
]
const tools = (request: OpenAIServiceOptions) => request.messages!.filter(m => m.role === 'tool').map(m => ({ id: m.tool_call_id!, content: String(m.content) }))
const olderWholeTokens = (request: OpenAIServiceOptions) => tools(request).slice(0, -2)
  .filter(m => !JSON.parse(m.content).content_omitted).reduce((sum, m) => sum + countSerializedTokens(m.content), 0)

test('version 2 keeps the latest construction packet whole and leaves an honest reference for the superseded one', async () => {
  const { sent, adapter } = await run(steps, { resultWindowTokens: 20000, resultWindowVersion: 2 })
  const last = tools(sent.at(-1)!)
  const first = JSON.parse(last.find(m => m.id === 'c1')!.content)
  assert.equal(first.content_omitted, true); assert.equal(first.superseded_by, 'c6')
  assert.deepEqual(first.reopen, { tool: 'get_work_history', arguments: { call_id: 'c1', after: null } })
  assert.equal(first.observed_result.revision, 1)
  assert.match(last.find(m => m.id === 'c6')!.content, /packet-2/, 'the latest packet is whole')
  for (const request of sent) assert(olderWholeTokens(request) <= 20000, 'the hard ceiling holds on every request')
  // The superseded original remains exactly recoverable from the private archive.
  const chain = (adapter.exportState() as any).chains.find(([, c]: any) => c.operations.some(([id]: any) => id === 'c1'))[1]
  assert.equal(chain.operations.find(([id]: any) => id === 'c1')[1].output, steps[0].output)
})

test('version 1 (pinned jobs) keeps its contiguous newest-first window and no superseded references', async () => {
  const { sent } = await run(steps, { resultWindowTokens: 20000 })
  // Reference: the version 1 rule as published on 2026-10-20.
  for (const request of sent) {
    const results = tools(request), older = results.slice(0, -2)
    let used = 0, contiguous = true
    for (let i = older.length - 1; i >= 0; i--) {
      const omitted = !!JSON.parse(older[i].content).content_omitted
      const size = countSerializedTokens(older[i].content)
      if (!omitted && contiguous) used += size
      if (omitted) contiguous = false
      else assert(contiguous, 'no whole result behind a demoted one')
      assert.equal(JSON.parse(older[i].content).superseded_by, undefined)
    }
    assert(used <= 20000)
  }
  const last = tools(sent.at(-1)!)
  assert.equal(JSON.parse(last.find(m => m.id === 'c1')!.content).content_omitted, true, 'the first packet aged out')
})

test('when material searches push past the ceiling, version 2 keeps the work packet that version 1 ages out', async () => {
  // A work packet followed by more material searches than the 2026-10-29
  // create turn had. Version 1 demotes the packet by age; version 2 ranks it
  // above the discovery reads.
  const shape: Step[] = [
    { name: 'read_construction_draft', args: work(null), output: body('packet', 4500) },
    ...['plywood 12', 'plywood', 'skiva 12', 'birch', 'sheet', 'board', 'panel', 'ply'].map(query => ({ name: 'search_material_catalog', args: { query }, output: body('s-' + query, 3500) })),
    { name: 'search_material_catalog', args: { query: 'profile' }, output: body('s-profile', 2500) },
  ]
  const v1 = tools((await run(shape, { resultWindowTokens: 20000 })).sent.at(-1)!)
  const v2 = tools((await run(shape, { resultWindowTokens: 20000, resultWindowVersion: 2 })).sent.at(-1)!)
  assert.equal(JSON.parse(v1[0].content).content_omitted, true)
  assert.match(v2[0].content, /packet/)
  assert(!JSON.parse(v2[0].content).content_omitted)
})

test('the catalog pins version 2 for new manifests only, and the runtime reads it', () => {
  assert.equal(catalogFixture().definition('agent-contract.ask-bob', 'agent_contract').metadata.result_window_version, 2)
  assert.equal(preResultWindowCatalogFixture().definition('agent-contract.ask-bob', 'agent_contract').metadata.result_window_version, undefined)
  const source = readFileSync(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  assert.match(source, /resultWindowVersion: contract\.result_window_version === 2 \? 2 as const : 1 as const/)
  assert.match(source, /execution\.resultWindowVersion === 2 \? \{ resultWindowTokens: BOB_RESULT_WINDOW_TOKENS, resultWindowVersion: 2 as const \}/)
})

test('the publication versions only the main contract metadata, is idempotent and matches the fixture', async () => {
  const { projectSchema } = await import('./support/project-schema.ts')
  const migration = '20261029200500_bob_result_window_catalog.sql'
  let prior: any
  const pg = await projectSchema(async (db, name) => {
    if (name.endsWith(migration)) prior = (await db.query<{ m: any }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  }, migration)
  try {
    const read = async () => (await pg.query<{ m: any }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
    const current = await read()
    const byKey = (m: any) => new Map<string, any>(m.definitions.map((d: any) => [d.prompt_key, d]))
    const before = byKey(prior), after = byKey(current)
    assert.deepEqual([...after.keys()].filter(k => JSON.stringify(after.get(k)) !== JSON.stringify(before.get(k))), ['agent-contract.ask-bob'])
    const { result_window_version, publication, ...rest } = after.get('agent-contract.ask-bob').metadata
    const { publication: _p, ...was } = before.get('agent-contract.ask-bob').metadata
    assert.equal(result_window_version, 2); assert.equal(publication, 'bob-result-window-v2'); assert.deepEqual(rest, was)
    const fixture = catalogFixture().definition('agent-contract.ask-bob', 'agent_contract')
    assert.deepEqual(fixture.metadata, after.get('agent-contract.ask-bob').metadata)
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'))
    assert.deepEqual(await read(), current)
  } finally { await pg.close() }
})

test('a superseded read keeps no content but its reference stays far below the original', () => {
  const operation: BobArchivedOperation = { call_id: 'x', tool_name: 'read_record', arguments: '{"id":1}', output: body('long', 4000) }
  assert(countSerializedTokens(String(projectBobResult(operation, true))) < 200)
})
