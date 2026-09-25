import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectWriter, type WritePayload, type WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { runProjectAnswer, type ModelCall } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

const message = 'Uppdatera arbetsinstruktionerna för skåpet.\nBehåll de andra uppgifterna.'
const time = '2026-09-25T10:00:00.000Z'
const step = '30000000-0000-4000-8000-000000000001'
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const task = (record_id = 'task-a') => ({ record_id, area_id: 'area-a', step_id: step, name: 'Cabinet instructions', instructions: 'Keep the existing finish; update the proposed opening.', expected_updated_at: time, request_quote: message })
const call = (id: string, args: unknown) => ({ id, type: 'function' as const, function: { name: 'save_project_task', arguments: JSON.stringify(args) } })
const response = (data: string | null, toolCalls?: ReturnType<typeof call>[]) => ({ success: true, data, model: 'fixture', responseId: 'response', usage, toolCalls })
const noError = (data: unknown) => ({ data, error: null })
function fixture(failTransport = false) {
  const writes: WritePayload[] = [], receipts: WriteReadback[] = []
  const writer = createProjectWriter('A', message, async payload => {
    writes.push(structuredClone(payload))
    if (failTransport) throw new Error('unknown transport outcome')
    const receipt: WriteReadback = { projectId: 'A', dataset: 'tasks', recordId: payload.record_id!, label: String(payload.data.name), operation: 'updated', savedAt: time, record: { id: payload.record_id, ...payload.data } }
    receipts.push(receipt); return noError(receipt)
  }, async () => noError(receipts), async () => noError({ generation: 2, receipts }))
  return { writer, writes, receipts }
}
function run(writer: ReturnType<typeof createProjectWriter>, callModel: ModelCall, deadline?: number) {
  return runProjectAnswer({ projectId: 'A', userId: 'user', message, writer, callModel, deadline, hasAccess: async () => true,
    lookup: createProjectLookup('A', async () => noError({ records: [{ id: 'A', name: 'Synthetic cabinet', updated_at: time }], related: [], truncated: false })),
  })
}

test('Task diagnostics distinguish a Step ID and timestamp defect from a valid request quote', async () => {
  const f = fixture()
  for (const [field, value] of [['step_id', 'Step title'], ['expected_updated_at', null]] as const) {
    const result = await f.writer.write('save_project_task', { ...task(), [field]: value })
    assert.equal(result.status, 'invalid'); assert.deepEqual(result.validation, { code: 'field_value', fields: [field] })
    assert.equal(f.writes.length, 0)
  }
  assert.equal(f.writer.needsRepair, true)
  assert.equal((await f.writer.write('save_project_task', task())).status, 'saved')
  assert.equal(f.writes.length, 1); assert.equal(f.writer.hasUnresolvedWrites, false)
})

test('an altered quote stays rejected; diagnostic guidance never replaces it or grants permission', async () => {
  const f = fixture(), input = { ...task(), request_quote: message.replace('\n', ' ') }
  const result = await f.writer.write('save_project_task', input)
  assert.equal(result.status, 'invalid'); assert.deepEqual(result.validation, { code: 'request_quote', fields: ['request_quote'] })
  assert.equal(input.request_quote, message.replace('\n', ' ')); assert.equal(f.writes.length, 0)
  assert.equal((await f.writer.write('save_project_task', { ...task(), actor_id: 'forged-user' })).validation?.code, 'tool_shape')
  assert.equal(f.writes.length, 0)
  assert.equal((await f.writer.write('save_project_task', task())).status, 'saved')
  assert.equal(f.writes[0].request_quote, message)
})

test('saving one Task cannot hide a rejected edit of another Task with the same name', async () => {
  const f = fixture()
  for (const id of ['task-a', 'task-b']) await f.writer.write('save_project_task', { ...task(id), step_id: 'wrong' })
  await f.writer.write('save_project_task', task('task-a'))
  assert.equal(f.writer.hasUnresolvedWrites, true); assert.equal(f.writer.needsRepair, true)
  await f.writer.write('save_project_task', task('task-b'))
  assert.equal(f.writer.hasUnresolvedWrites, false)
  assert.deepEqual(f.writes.map(p => p.record_id), ['task-a', 'task-b'])
})

test('partial Task success gets one completion review and repairs only the rejected target', async () => {
  const f = fixture(); let calls = 0
  const result = await run(f.writer, async options => {
    if (++calls === 1) return response(null, [call('a', task('task-a')), call('b', { ...task('task-b'), step_id: 'title instead of UUID' })])
    if (calls === 2) {
      const results = options.messages!.map(m => JSON.parse(String(m.content)))
      assert.deepEqual(results.map(r => r.status), ['saved', 'invalid'])
      assert.deepEqual(results[1].validation.fields, ['step_id'])
      return response('One edit was saved. The other failed, so I will stop here.')
    }
    if (calls === 3) {
      assert.equal(options.messages![0].role, 'system', 'review must not fabricate owner approval')
      assert.match(String(options.messages![0].content), /current request/)
      return response(null, [call('repair-b', task('task-b'))])
    }
    return response('Both requested edits are saved.')
  })
  assert.equal(result.ok, true); assert.equal(calls, 4)
  assert.deepEqual(f.writes.map(p => p.record_id), ['task-a', 'task-b'])
  if (result.ok) { assert.equal(result.evidence.writes?.length, 2); assert.equal(result.evidence.partial, false) }
})

test('repairing directly from field feedback incurs no extra completion review', async () => {
  const f = fixture(); let calls = 0
  const result = await run(f.writer, async () => ++calls === 1 ? response(null, [call('bad', { ...task(), expected_updated_at: null })])
    : calls === 2 ? response(null, [call('fixed', task())]) : response('Saved.'))
  assert.equal(result.ok, true); assert.equal(calls, 3); assert.equal(f.writes.length, 1)
})

test('an unrepaired rejection stays partial and cannot cause an unbounded completion-review loop', async () => {
  const f = fixture(); let calls = 0
  const result = await run(f.writer, async () => ++calls === 1 ? response(null, [call('bad', { ...task(), step_id: 'bad' })]) : response('The edit remains blocked.'))
  assert.equal(result.ok, true); assert.equal(calls, 3); assert.equal(f.writes.length, 0)
  if (result.ok) { assert.equal(result.evidence.partial, true); assert.equal(result.evidence.writes, undefined) }
})

test('completion review respects exhausted write budget, closing deadline and uncertain transport', async () => {
  for (const limit of ['budget', 'deadline', 'uncertain'] as const) {
    const f = fixture(limit === 'uncertain')
    for (let i = 0; i < (limit === 'budget' ? 8 : 1); i++) await f.writer.write('save_project_task', { ...task(), step_id: 'bad' })
    if (limit === 'uncertain') assert.equal((await f.writer.write('save_project_task', task())).status, 'unknown')
    let calls = 0
    const result = await run(f.writer, async () => { calls++; return response('The edit remains incomplete.') }, limit === 'deadline' ? Date.now() + 30000 : undefined)
    assert.equal(result.ok, true); assert.equal(calls, 1, limit)
    assert.equal(f.writes.length, limit === 'uncertain' ? 1 : 0)
    if (result.ok) assert.equal(result.evidence.partial, true)
  }
})

test('a worker yield rebuilds rejected-target tracking from replay and saves the corrected Task once', async () => {
  const entries: JournalEntry[] = []; let now = 0, providerCalls = 0, writes = 0
  const resume = () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, 20000, () => now)
    const f = fixture()
    return run(f.writer, options => journal.run('model:ask-bob', options, async () => {
      providerCalls++
      if (providerCalls === 1) { now = 15000; return response(null, [call('bad', { ...task(), step_id: 'bad' })]) }
      if (providerCalls === 2) return response('The edit failed.')
      if (providerCalls === 3) return response(null, [call('fixed', task())])
      return response('Saved.')
    }, 10000)).finally(() => { writes += f.writes.length })
  }
  await assert.rejects(resume(), error => error instanceof BobContinuation && error.kind === 'yield')
  assert.equal(writes, 0); now = 0
  const result = await resume()
  assert.equal(result.ok, true); assert.equal(providerCalls, 4); assert.equal(writes, 1)
})
