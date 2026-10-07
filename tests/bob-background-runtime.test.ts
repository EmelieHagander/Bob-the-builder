import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BobContinuation, createBobJournal, fingerprint, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { sealCredential, openCredential } from '../supabase/functions/_shared/bob-job-credentials.ts'
import { createBobHandler } from '../supabase/functions/_shared/bob-request.ts'
import { runClaimedProjectTurn } from './support/bob-model-routing.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'

test('a server restart replays model/tool results, continues after the save, and commits one answer', async () => {
  const entries: JournalEntry[] = [], receipts: any[] = []
  let modelCalls = 0, writes = 0, commits = 0, failed = 0, settled = 0, now = 0
  const run = () => {
    const journal = createBobJournal({ entries, save: async e => { entries.push(structuredClone(e)) } }, 20000, () => now)
    const writer = createProjectWriter('A', 'Spara', payload => journal.run('write', payload, async () => {
      writes++
      const receipt = { projectId: 'A', dataset: 'tasks', recordId: 'saved', label: 'Task', operation: 'created', savedAt: '2026-09-24T12:00:00Z', record: { id: 'saved', name: 'Task' } }
      receipts.push(receipt); now = 15000
      return { data: receipt, error: null }
    }), async () => ({ data: receipts, error: null }), async () => { settled++; return { data: { receipts, generation: 3 }, error: null } })
    return runClaimedProjectTurn({ projectId: 'A', userId: 'member', message: 'Spara', generation: 2, resume: entries.length > 0,
      writer, hasAccess: async () => true, beforeSettle: () => journal.check(),
      lookup: createProjectLookup('A', async () => ({ data: { records: [{ id: 'A', name: 'Project' }], related: [], truncated: false }, error: null })),
      callModel: options => journal.run('model', options, async () => {
        modelCalls++
        const common = { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
        return modelCalls === 1 ? { ...common, responseId: 'resp_tools', data: '', toolCalls: [{ id: 'call_save', type: 'function' as const,
          function: { name: 'save_project_task', arguments: JSON.stringify({ record_id: null, area_id: 'areaA', name: 'Task', instructions: 'Build', expected_updated_at: null, request_quote: 'Spara' }) } }] }
          : { ...common, responseId: 'resp_final', data: 'Saved and continued.' }
      }, 10000),
      commit: async result => { commits++; assert.equal(result.answer, 'Saved and continued.') }, fail: async () => { failed++ },
    })
  }
  await assert.rejects(run(), e => e instanceof BobContinuation && e.kind === 'yield')
  assert.equal(writes, 1); assert.equal(modelCalls, 1); assert.equal(settled, 0); assert.equal(failed, 0)
  now = 0
  const result = await run()
  assert.equal(result.ok, true); assert.equal(writes, 1); assert.equal(modelCalls, 2); assert.equal(commits, 1); assert.equal(settled, 1)
})

test('changed replay inputs stop instead of dispatching another operation', async () => {
  const entries: JournalEntry[] = []
  const store = { entries, save: async (e: JournalEntry) => { entries.push(e) } }
  await createBobJournal(store, Infinity).run('write', { expected_revision: 1 }, async () => 'saved')
  let calls = 0
  const replay = createBobJournal(store, Infinity)
  await assert.rejects(replay.run('write', { expected_revision: 2 }, async () => { calls++; return 'duplicate' }), /continuation_changed/)
  assert.equal(calls, 0)
  assert.throws(() => replay.check(), /continuation_changed/)
})

test('provider retry count survives workers and stops the failing call without losing earlier work',async()=>{
  const entries:JournalEntry[]=[],store={entries,save:async(e:JournalEntry)=>{entries.push(structuredClone(e))}}
  let saved=0,attempts=0
  const run=async(input='same')=>{
    const journal=createBobJournal(store,Infinity)
    assert.equal(await journal.run('write',{},async()=>{saved++;return 'receipt'}),'receipt')
    return journal.run('model:cad',{input},async()=>{attempts++;throw new BobContinuation('yield','provider_retry')})
  }
  for(let i=0;i<2;i++)await assert.rejects(run(),e=>e instanceof BobContinuation&&e.kind==='yield')
  await assert.rejects(run('changed'),/continuation_changed/)
  assert.equal(attempts,2)
  await assert.rejects(run(),/provider_retry_exhausted/)
  await assert.rejects(run(),/provider_retry_exhausted/)
  assert.equal(attempts,3);assert.equal(saved,1)
})

test('provider failures and segment timeouts share one retry budget across workers; unknown outcomes re-send once', async () => {
  for (const [reasons, dispatches] of [
    [['segment_wall', 'segment_wall', 'segment_wall'], 2],
    [['provider_uncertain', 'provider_uncertain'], 2],
    [['provider_retry', 'segment_wall', 'provider_retry'], 3],
    [['provider_retry', 'provider_retry', 'provider_retry'], 3],
  ] as const) {
    const entries: JournalEntry[] = [], store = { entries, save: async (e: JournalEntry) => { entries.push(structuredClone(e)) } }
    let attempts = 0
    const run = () => createBobJournal(store, Infinity).run('model:cad', { input: 'same' }, async () => {
      throw new BobContinuation('yield', reasons[attempts++])
    })
    for (let i = 0; i < dispatches - 1; i++) await assert.rejects(run(), e => e instanceof BobContinuation && e.kind === 'yield')
    await assert.rejects(run(), /provider_retry_exhausted/)
    await assert.rejects(run(), /provider_retry_exhausted/)
    assert.equal(attempts, dispatches, 'restarting the worker cannot reset the paid-call budget')
    assert.deepEqual(entries.filter(e => e.key.includes(':retry:')).map(e => (e.value as any).reason), reasons.slice(0, dispatches - 1))
  }
})

test('an uncertain re-send is counted across workers so the answer can report it', async () => {
  const entries: JournalEntry[] = [], store = { entries, save: async (e: JournalEntry) => { entries.push(structuredClone(e)) } }
  let attempts = 0
  const run = () => createBobJournal(store, Infinity).run('model:ask-bob', { input: 'same' }, async identity => {
    if (++attempts === 1) throw new BobContinuation('yield', 'provider_uncertain')
    assert.equal(identity.attempt, 1)
    return 'answer'
  })
  await assert.rejects(run(), BobContinuation)
  assert.equal(await run(), 'answer')
  assert.equal(createBobJournal(store, Infinity).uncertainResends(), 1)
  const definite: JournalEntry[] = []
  let tries = 0
  const again = () => createBobJournal({ entries: definite, save: async e => { definite.push(e) } }, Infinity).run('model:x', {}, async () => {
    if (++tries === 1) throw new BobContinuation('yield', 'provider_retry')
    return 'ok'
  })
  await assert.rejects(again(), BobContinuation); await again()
  assert.equal(createBobJournal({ entries: definite, save: async () => {} }, Infinity).uncertainResends(), 0, 'a definite 429/5xx was never billed and is not reported')
})

test('waiting for an accepted AI job and yielding before dispatch do not spend retries', async () => {
  const entries: JournalEntry[] = [], store = { entries, save: async (e: JournalEntry) => { entries.push(structuredClone(e)) } }
  let dispatches = 0
  for (let i = 0; i < 5; i++) {
    await assert.rejects(createBobJournal(store, 1000, () => 0).run('model:cad', {}, async () => { dispatches++; return 'unexpected' }, 1000), BobContinuation)
    await assert.rejects(createBobJournal(store, Infinity).run('model:cad', {}, async () => {
      throw new BobContinuation('yield', 'ai_wait', { id: 'existing-job', accepted: true, role: 'cad-designer' })
    }), BobContinuation)
  }
  assert.equal(dispatches, 0)
  assert.equal(entries.length, 0)
  let attempts = 0
  const run = () => createBobJournal(store, Infinity).run('model:cad', {}, async () => {
    if (++attempts === 1) throw new BobContinuation('yield', 'provider_retry')
    return 'recovered'
  })
  await assert.rejects(run(), BobContinuation)
  assert.equal(await run(), 'recovered')
  assert.equal(await run(), 'recovered')
  assert.equal(attempts, 2, 'a genuine transient failure can still recover')
})

test('checkpoint delivery cannot be changed by a caller mutating its nested result', async () => {
  const entries:JournalEntry[]=[]
  const store={entries,save:async(e:JournalEntry)=>{entries.push(e)}}
  const original={z:{label:'Saved',revision:1},a:[{y:2,x:1}]}
  const first=await createBobJournal(store,Infinity).run('read',{},async()=>original)
  first.z.revision=999
  const replay=await createBobJournal(store,Infinity).run('read',{},async()=>{throw new Error('must replay')})
  assert.deepEqual(replay,original)
  assert.equal(original.z.revision,1)
})

test('unknown paid-image outcome is never blindly generated a second time', async () => {
  const entries: JournalEntry[] = [], store = { entries, save: async (e: JournalEntry) => { entries.push(e) } }
  let calls = 0
  await assert.rejects(createBobJournal(store, Infinity).run('image:generate', 'brief', async () => { calls++; throw new Error('worker killed') }))
  await assert.rejects(createBobJournal(store, Infinity).run('image:generate', 'brief', async () => { calls++; return 'image' }), /image_outcome_unknown/)
  assert.equal(calls, 1)
})

test('encrypted caller token cannot move to another principal, turn or key', async () => {
  const sealed = await sealCredential('caller-token', 'member/project/turn', 'server-key')
  assert(!JSON.stringify(sealed).includes('caller-token'))
  assert.equal(await openCredential(sealed, 'member/project/turn', 'server-key'), 'caller-token')
  await assert.rejects(openCredential(sealed, 'other/project/turn', 'server-key'))
  await assert.rejects(openCredential(sealed, 'member/project/turn', 'other-key'))
})

test('opted-in HTTP requests return accepted without running the synchronous model', async () => {
  let sync = 0, queued = 0
  const handler = createBobHandler({ authenticate: async () => 'member', answer: async () => { sync++; return { ok: false, error: 'not_used' } },
    enqueue: async input => { queued++; return { ok: true, status: 'accepted', projectId: input.projectId, jobId: 'fixture', expiresAt: '2026-09-24T13:00:00Z' } } })
  const request = (background: unknown) => new Request('https://fixture.test', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify({ action: 'send', projectId: 'A', message: 'Draw', background }) })
  const response = await handler(request(true))
  assert.equal(response.status, 202); assert.equal((await response.json()).status, 'accepted')
  assert.equal(sync, 0); assert.equal(queued, 1)
  assert.equal((await handler(request('true'))).status, 400)
  assert.equal((await handler(request(false))).status, 503); assert.equal(sync, 1)
})

test('a retried turn reuses an earlier successful model result with identical input and dispatches the rest', async () => {
  const entries: JournalEntry[] = [], store = { entries, save: async (e: JournalEntry) => { entries.push(structuredClone(e)) } }
  const same = { input: 'same' }, reusable = new Map([[await fingerprint(same), { ok: true, result: { success: true, text: 'paid once' } }]])
  let sent = 0
  const journal = createBobJournal(store, Infinity, Date.now, reusable)
  assert.deepEqual(await journal.run('model:ask-bob', same, async () => { sent++; return { success: true, text: 'again' } }), { success: true, text: 'paid once' })
  assert.deepEqual(await journal.run('model:ask-bob', { input: 'changed' }, async () => { sent++; return { success: true, text: 'new' } }), { success: true, text: 'new' })
  // Tools are never answered from the earlier attempt.
  await journal.run('tool:lookup', same, async () => { sent++; return 'fresh' })
  assert.equal(sent, 2)
  assert.equal(journal.reusedModelCalls(), 1)
  // The reused result is this job's own step: a later segment replays it, not the map.
  assert.deepEqual(await createBobJournal(store, Infinity).run('model:ask-bob', same, async () => { sent++; return null }), { success: true, text: 'paid once' })
  assert.equal(sent, 2)
})
