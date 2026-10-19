import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextTokenPrefix, countContextTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'

// Incident 2026-10-18: a resumed 14-step job exceeded the Edge CPU limit on every
// claim while re-paging summarized history. Paging must stay proportional to a page.
test('a token prefix is whole characters, fits, and makes real progress', () => {
  const text = 'Gavel 45×95 mm 🪵 vänster stolpe. '.repeat(400)
  for (const tokens of [1, 7, 100, 999]) {
    const prefix = contextTokenPrefix(text, tokens), chars = Array.from(prefix)
    assert.ok(text.startsWith(prefix)); assert.ok(countContextTokens(prefix) <= tokens)
    // Within one token of the longest fitting prefix: one more token's text no longer fits.
    assert.ok(countContextTokens(prefix) >= tokens - 1 || chars.length === Array.from(text).length, `progress for ${tokens}`)
  }
  assert.equal(contextTokenPrefix('short', 50), 'short')
})

test('summarized history pages reconstruct the exact source without re-encoding all of it per page', async () => {
  const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
  const catalog = { definition: () => ({ metadata: { continuation_input_tokens: 20000, context_input_ceiling_tokens: 400000, continuation_summary_tokens: 1600,
    retained_tool_exchanges: 1, continuation_retention_version: 2 } }), role: () => ({ systemMessage: 'Role.' }), tool } as unknown as AiCatalogSession
  const big = (i: number) => JSON.stringify({ status: 'ok', rows: Array.from({ length: 900 }, (_, k) => ({ id: `part-${i}-${k}`, name: 'Gavel stolpe ' + k, l_mm: 1800 + k })) })
  const segments: { after: number; text: string; has_more: boolean }[][] = []
  let n = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async (o: any) => {
    if (o.catalogRoleKey === 'context-compactor') {
      const source = JSON.parse(o.messages[0].content)
      if (source.source_segment.after === 0) segments.push([])
      segments.at(-1)!.push(source.source_segment)
      return { success: true, model: 'm', data: { summary: 'S', open_questions: [], next_steps: [], source_refs: source.allowed_source_refs.slice(0, 1) }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
    }
    n++
    return { success: true, model: 'm', responseId: 'r' + n, data: null, usage: { input_tokens: 10000 + n * 15000, output_tokens: 1, total_tokens: 1 },
      outputPhase: 'tool_calls', toolCalls: [{ id: 'c' + n, type: 'function', function: { name: 'read', arguments: '{}' } }] }
  } })
  const seed: any = { app: 'bob', module: 'global', functionName: 'ask-bob', coworkerId: 'bob', aiFunction: 'ask-bob', catalogRoleKey: 'ask-bob',
    systemMessage: 'Role', messages: [{ role: 'user', content: 'Fix the gables' }], tools: [tool('read')] }
  const started = performance.now()
  await adapter.call(seed)
  for (let i = 1; i < 14; i++) await adapter.call({ ...seed, previousResponseId: 'r' + i, messages: [{ role: 'tool', tool_call_id: 'c' + i, content: big(i) }] })
  assert.ok(segments.length >= 2, 'history was summarized')
  for (const pages of segments) {
    let cursor = 0
    for (const page of pages) { assert.equal(page.after, cursor); assert.ok(countContextTokens(page.text) <= 12000); cursor += Array.from(page.text).length }
    assert.equal(pages.at(-1)!.has_more, false)
  }
  assert.ok(performance.now() - started < 5000, 'replay of this journal stays far from seconds of CPU per step')
})

test('replaying a long journal stays linear: retry markers are looked up, not scanned', async () => {
  const { createBobJournal } = await import('../supabase/functions/_shared/bob-job-journal.ts')
  const entries: any[] = []
  const first = createBobJournal({ entries, save: async e => { entries.push(e) } }, Infinity, Date.now, new Map(), { unlimitedWork: true })
  for (let i = 0; i < 4000; i++) await first.run('tool:read', { i }, async () => ({ status: 'ok', i }))
  const replay = createBobJournal({ entries, save: async () => assert.fail('a replay never saves') }, Infinity, Date.now, new Map(), { unlimitedWork: true })
  const started = performance.now()
  for (let i = 0; i < 4000; i++) assert.equal((await replay.run('tool:read', { i }, async () => assert.fail('no dispatch')) as any).i, i)
  assert.ok(performance.now() - started < 2000)
})

test('a resumed job reads recorded summary page boundaries instead of re-tokenizing each batch', async () => {
  const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
  const catalog = { definition: () => ({ metadata: { continuation_input_tokens: 20000, context_input_ceiling_tokens: 400000, continuation_summary_tokens: 1600,
    retained_tool_exchanges: 1, continuation_retention_version: 2 } }), role: () => ({ systemMessage: 'Role.' }), tool } as unknown as AiCatalogSession
  const big = (i: number) => JSON.stringify({ status: 'ok', rows: Array.from({ length: 900 }, (_, k) => ({ id: `part-${i}-${k}`, name: 'Gavel stolpe ' + k, l_mm: 1800 + k })) })
  const run = async (pageBoundaries: (source: string, compute: () => Promise<(number | null)[]>) => Promise<unknown>) => {
    const inputs: string[] = []
    let n = 0
    const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, pageBoundaries, callModel: async (o: any) => {
      if (o.catalogRoleKey === 'context-compactor') {
        inputs.push(o.messages[0].content)
        const source = JSON.parse(o.messages[0].content)
        return { success: true, model: 'm', data: { summary: 'S', open_questions: [], next_steps: [], source_refs: source.allowed_source_refs.slice(0, 1) }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
      }
      n++
      return { success: true, model: 'm', responseId: 'r' + n, data: null, usage: { input_tokens: 10000 + n * 15000, output_tokens: 1, total_tokens: 1 },
        outputPhase: 'tool_calls', toolCalls: [{ id: 'c' + n, type: 'function', function: { name: 'read', arguments: '{}' } }] }
    } } as any)
    const seed: any = { app: 'bob', module: 'global', functionName: 'ask-bob', coworkerId: 'bob', aiFunction: 'ask-bob', catalogRoleKey: 'ask-bob',
      systemMessage: 'Role', messages: [{ role: 'user', content: 'Fix the gables' }], tools: [tool('read')] }
    await adapter.call(seed)
    for (let i = 1; i < 6; i++) await adapter.call({ ...seed, previousResponseId: 'r' + i, messages: [{ role: 'tool', tool_call_id: 'c' + i, content: big(i) }] })
    return inputs
  }
  const recorded: unknown[] = []
  const live = await run(async (_source, compute) => { const ends = await compute(); recorded.push(ends); return ends })
  assert.ok(recorded.some(ends => (ends as unknown[]).length > 1), 'a batch spans several pages')
  let position = 0
  const replayed = await run(async () => structuredClone(recorded[position++]))
  assert.deepEqual(replayed, live, 'recorded boundaries rebuild the exact compactor inputs')
  await assert.rejects(run(async () => [5, 3, null]), /context_cursor_invalid/)
  await assert.rejects(run(async () => [5]), /context_cursor_invalid/)
})
