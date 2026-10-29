import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import type { PGlite } from './support/pglite.ts'
import { createBobJournal, BobContinuation } from '../supabase/functions/_shared/bob-job-journal.ts'
import { createBobTurnCheckpoint } from '../supabase/functions/_shared/bob-turn-checkpoint.ts'

// Owner decision 2026-10-29: a checkpoint save answers with a short receipt
// instead of echoing the whole stored state back.
let pg: PGlite
const owner = '00000000-0000-4000-8000-000000000001'
const worker = 'https://fixture.supabase.co/functions/v1/bob-worker'
const service = async (name: string, args: unknown[] = []) => (await asProjectUser(pg, null, `select bob.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, 'service_role')).rows[0].result as any
const row = async (id: string) => (await pg.query<any>('select * from bob_private.bob_jobs where id=$1', [id])).rows[0]
const claim = async (id: string) => service('bob_claim_job_v2', [id, (await row(id)).capability])
const enqueue = async () => service('bob_enqueue_job_v4', ['A', owner, randomUUID(), 'Spara uppgiften.', { ciphertext: 'fixture' }, new Date(Date.now() + 3600000).toISOString(), worker, null, null])
const cursor = (positions: Record<string, number> = {}) => ({ version: 1, positions, reusedModelCalls: 0, uncertainResends: 0 })
const stored = async (job: string) => (await pg.query<any>('select revision,state,journal_state from bob_private.bob_turn_checkpoints where job_id=$1', [job])).rows[0]

before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name === '20260924120448_bob_background_jobs.sql') await db.exec(`create schema cron; create schema net; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint'; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
  })
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'owner@test.invalid'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Build')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('one','A','Owner','O',$1)", [owner])
  // Same fixture as bob-turn-checkpoint-db: background jobs need the work-allowance contract.
  const current = (await pg.query<any>("select active_version_id from shared.ai_prompts where app='bob' and prompt_key='agent-contract.ask-bob'")).rows[0].active_version_id
  const version = (await pg.query<any>(`insert into shared.ai_prompt_versions(prompt_id,version,content,metadata,available_variables,flow,definition_kind,definition_format_version,definition)
    select prompt_id,(select max(version)+1 from shared.ai_prompt_versions where prompt_id=v.prompt_id),content,metadata||'{"work_allowance_version":1}',available_variables,flow,definition_kind,definition_format_version,definition
    from shared.ai_prompt_versions v where id=$1 returning id`, [current])).rows[0].id
  await pg.query("update shared.ai_prompts set active_version_id=$1 where app='bob' and prompt_key='agent-contract.ask-bob'", [version])
})
after(() => pg.close())

test('the receipt save stores exactly what the packet save stores and answers with the revision only', async () => {
  const state = { nextStep: 3, big: 'x'.repeat(20000) }, journal = cursor({ startup: 1, model: 2 })
  // One active job per member and project: save through the packet function, then through the receipt.
  const a = await claim((await enqueue()).jobId)
  const packet = await service('bob_save_turn_checkpoint', [a.id, a.claimToken, 0, state, journal])
  const sa = await stored(a.id)
  await service('bob_finish_job', [a.id, a.claimToken, 'fixture_done'])
  const b = await claim((await enqueue()).jobId)
  const receipt = await service('bob_save_turn_checkpoint_receipt', [b.id, b.claimToken, 0, state, journal])
  assert.deepEqual(receipt, { receipt_version: 1, job_id: b.id, revision: 1, unchanged: false })
  assert.equal(packet.revision, 1)
  const sb = await stored(b.id)
  assert.deepEqual([sb.revision, sb.state, sb.journal_state], [sa.revision, sa.state, sa.journal_state])
  assert(JSON.stringify(receipt).length < 120 && JSON.stringify(packet).length > 20000)
  // A lost acknowledgement retries to the same revision; an unchanged write keeps it.
  assert.deepEqual(await service('bob_save_turn_checkpoint_receipt', [b.id, b.claimToken, 0, state, journal]), receipt)
  assert.deepEqual(await service('bob_save_turn_checkpoint_receipt', [b.id, b.claimToken, 1, state, journal]), { ...receipt, unchanged: true })
  assert.deepEqual(await service('bob_save_turn_checkpoint_receipt', [b.id, b.claimToken, 1, { nextStep: 4 }, journal]), { ...receipt, revision: 2 })
  // Every guard of the original save still applies.
  await assert.rejects(service('bob_save_turn_checkpoint_receipt', [b.id, b.claimToken, 0, {}, journal]), /checkpoint_conflict/)
  await assert.rejects(service('bob_save_turn_checkpoint_receipt', [b.id, b.claimToken, 2, {}, cursor({ startup: 1, model: 1 })]), /checkpoint_cursor_regression/)
  await assert.rejects(service('bob_save_turn_checkpoint_receipt', [b.id, randomUUID(), 2, {}, journal]), /job_not_claimed/)
  await assert.rejects(service('bob_save_turn_checkpoint_receipt', [b.id, b.claimToken, 2, {}, { ...cursor(), version: 2 }]), /invalid_turn_checkpoint/)
  // Service only: a signed-in member cannot call either layer.
  for (const fn of ['bob.bob_save_turn_checkpoint_receipt', 'bob_private.bob_save_turn_checkpoint_receipt'])
    await assert.rejects(asProjectUser(pg, owner, `select ${fn}($1,$2,2,'{}'::jsonb,$3::jsonb)`, [b.id, b.claimToken, JSON.stringify(journal)]), /permission denied/)
})

test('the runtime builds its checkpoint from the receipt, still accepts a packet and rejects a wrong receipt', async () => {
  const binding = { jobId: 'job-1', turnId: 'turn-1', catalogManifestId: 'manifest-1' }
  const journal = createBobJournal({ entries: [], save: async () => {} }, Infinity)
  const writes: any[] = []
  const store = createBobTurnCheckpoint({ ...binding, checkpoint: null, journal,
    save: async write => { writes.push(write); return { receipt_version: 1, job_id: 'job-1', revision: write.expectedRevision + 1, unchanged: false } } })
  const first = await store.commit({ step: 1 })
  assert.equal(first.revision, 1); assert.deepEqual(first.state, { step: 1 }); assert.deepEqual(store.current()?.state, { step: 1 })
  assert.equal((await store.commit({ step: 2 })).revision, 2)
  assert.deepEqual(writes.map(w => w.expectedRevision), [0, 1])
  // Older function: the full packet still validates.
  const legacy = createBobTurnCheckpoint({ ...binding, checkpoint: null, journal,
    save: async write => ({ ...binding, version: 1, revision: 1, state: write.state, journalState: write.journalState }) })
  assert.equal((await legacy.commit({ step: 1 })).revision, 1)
  for (const wrong of [{ receipt_version: 1, job_id: 'other', revision: 1, unchanged: false }, { receipt_version: 1, job_id: 'job-1', revision: 5, unchanged: false },
    { receipt_version: 1, job_id: 'job-1', revision: 0, unchanged: true }, { receipt_version: 2, job_id: 'job-1', revision: 1, unchanged: false }]) {
    const bad = createBobTurnCheckpoint({ ...binding, checkpoint: null, journal, save: async () => wrong })
    await assert.rejects(bad.commit({ step: 1 }), (e: unknown) => e instanceof BobContinuation)
    assert.equal(bad.current(), null)
  }
})

test('the worker saves checkpoints through the receipt function', () => {
  const source = readFileSync(new URL('../supabase/functions/_shared/bob-background.ts', import.meta.url), 'utf8')
  assert.match(source, /s\.rpc\('bob_save_turn_checkpoint_receipt'/)
  assert.doesNotMatch(source, /s\.rpc\('bob_save_turn_checkpoint',/)
})
