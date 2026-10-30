import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

// Owner decision 2026-10-30: a stair of summaries written once, with exact
// message ranges, and a project snapshot locked for the thread.
let pg: PGlite
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002'
type Claim = { project: string; user: string; thread: string; turn: string; generation: number }
const bind = (c: Claim) => [c.project, c.user, c.thread, c.turn, c.generation]
const service = async (sql: string, params: unknown[]) => (await asProjectUser(pg, null, sql, params, 'service_role')).rows[0] as any
async function claim(text: string, user = one, project = 'stair-A'): Promise<Claim> {
  const turn = randomUUID(), row = (await service('select bob.bob_claim_turn($1,$2,$3,$4) d', [project, user, turn, text])).d
  assert.equal(row.status, 'claimed')
  return { project, user, thread: row.thread_id, turn, generation: row.generation }
}
const commit = (c: Claim, answer: string) => service('select bob.bob_commit_turn_v2($1,$2,$3,$4,$5,$6,$7,$8) d',
  [...bind(c), answer, JSON.stringify({ kind: 'ai_assessment', sources: [], partial: false }), 'test-response'])
const load = async (c: Claim) => (await service('select bob.bob_load_memory_stair($1,$2,$3,$4,$5) d', bind(c))).d
const save = async (c: Claim, level: number, from: number, to: number, text: string, supersede: string[] = []) =>
  (await service('select bob.bob_save_memory_summary($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[]) d', [...bind(c), level, from, to, text, supersede])).d
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (e: any) => e.code === code || String(e.message).includes(code))

before(async () => {
  pg = await projectSchema()
  await pg.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())', [one, 'stair-one@example.test', two, 'stair-two@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name,description,phase) values('stair-A','stair-a','Lådan','En låda av plywood.','design')")
  await pg.exec("insert into bob.areas(id,project_id,slug,name,sort_order,phase) values('stair-area','stair-A','verkstad','Verkstaden',1,'design')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('stair-one','stair-A','One','ON',$1),('stair-two','stair-A','Two','TW',$2)", [one, two])
})
after(async () => { await pg?.close() })

test('the first turn locks the project snapshot; later messages arrive raw after the last summary, never the current request', async () => {
  const first = await claim('Bygg en låda'); await commit(first, 'Lådan är ritad.')
  const second = await claim('Gör den bredare')
  const frame = await load(second)
  assert.equal(frame.snapshot.project.name, 'Lådan'); assert.equal(frame.snapshot.project.phase, 'design')
  assert.deepEqual(frame.snapshot.areas, [{ name: 'Verkstaden', phase: 'design' }])
  assert.deepEqual(frame.raw.map((m: any) => [m.seq, m.role]), [[1, 'user'], [2, 'assistant']])
  assert.equal(frame.current.text, 'Gör den bredare'); assert.deepEqual(frame.summaries, []); assert.equal(frame.summarizedThroughSeq, 0)
  // An unchanged project and thread give identical bytes on every load.
  assert.equal(JSON.stringify((await load(second)).snapshot), JSON.stringify(frame.snapshot))
  assert.equal((await load(second)).snapshotLockedAt, frame.snapshotLockedAt)
  // A later project change is not written into the locked snapshot; it arrives as an event.
  await pg.query("update bob.projects set phase='build' where id='stair-A'")
  await pg.query("insert into bob.phase_history(project_id,scope_kind,from_phase,to_phase,reason,recorded_by,actor_label,recorded_at) values('stair-A','project','design','build','Ritningen är klar',$1,'One',clock_timestamp())", [one])
  const after = await load(second)
  assert.equal(after.snapshot.project.phase, 'design')
  assert.deepEqual(after.events.map((e: any) => [e.kind, e.from, e.to]), [['project_phase', 'design', 'build']])
  // Another member cannot load this thread.
  await rejects(service('select bob.bob_load_memory_stair($1,$2,$3,$4,$5) d', ['stair-A', two, second.thread, second.turn, second.generation]), '42501')
  await commit(second, 'Bredden är 500 mm.')
})

test('summaries append contiguously, merges supersede exactly their level, and every save locks the snapshot again', async () => {
  const c = await claim('Fortsätt')
  const frame = await load(c), last = frame.raw.at(-1).seq
  // A chunk must start right after the last summarized message and end before the current request.
  await rejects(save(c, 2, 2, 3, 'fel start'), 'memory_changed')
  await rejects(save(c, 2, 1, frame.current.seq, 'tar med nuvarande'), 'memory_changed')
  const one1 = await save(c, 2, 1, 2, 'Ägaren bad om en låda; den ritades.')
  assert.deepEqual(one1.summaries.map((s: any) => [s.level, s.seqFrom, s.seqTo]), [[2, 1, 2]])
  assert.deepEqual(one1.raw.map((m: any) => m.seq), [3, 4].filter(s => s <= last))
  // The save locked a fresh snapshot: the phase change is now in it, and no longer an event.
  assert.equal(one1.snapshot.project.phase, 'build'); assert.deepEqual(one1.events, [])
  const two2 = await save(c, 2, 3, last, 'Bredden ändrades till 500 mm.')
  // A merge names exactly the active level-2 summaries and covers their whole range.
  await rejects(save(c, 1, 1, last, 'halv', [two2.summaries[0].id]), 'memory_changed')
  await rejects(save(c, 1, 2, last, 'fel intervall', two2.summaries.map((s: any) => s.id)), 'memory_changed')
  const merged = await save(c, 1, 1, last, 'Lådan ritades och gjordes 500 mm bred.', two2.summaries.map((s: any) => s.id))
  assert.deepEqual(merged.summaries.map((s: any) => [s.level, s.seqFrom, s.seqTo]), [[1, 1, last]])
  const kept = (await pg.query<any>('select level,superseded_at is not null superseded from bob_private.bob_thread_memory_summaries where thread_id=$1 order by created_at', [c.thread])).rows
  assert.deepEqual(kept.map(k => [k.level, k.superseded]), [[2, true], [2, true], [1, false]], 'superseded summaries stay as history')
  // A level-0 merge needs at least two summaries to merge.
  await rejects(save(c, 0, 1, last, 'ensam', [merged.summaries[0].id]), 'memory_changed')
  await rejects(save(c, 2, last + 1, last + 1, ' '), '22023')
  await commit(c, 'Klart.')
})

test('plan revisions and decisions are separate immutable events after the snapshot', async () => {
  const c = await claim('Hur ser planen ut?')
  const locked = (await load(c)).snapshotLockedAt
  await pg.query("insert into bob.project_plans(project_id,next_revision) values('stair-A',2) on conflict (project_id) do nothing")
  await pg.query("insert into bob.project_plan_revisions(project_id,revision,status,summary,reason,proposed_by,created_at) values('stair-A',1,'proposed','Ny ordning','Test',$1,clock_timestamp())", [one])
  const proposed = (await load(c)).events
  assert.deepEqual(proposed.map((e: any) => [e.kind, e.revision]), [['plan_revision', 1]])
  await pg.query("update bob.project_plan_revisions set status='approved',decided_at=clock_timestamp(),approved_by=$1 where project_id='stair-A' and revision=1", [one])
  const decided = (await load(c)).events
  assert.deepEqual(decided.map((e: any) => [e.kind, e.revision, e.status ?? null]), [['plan_revision', 1, null], ['plan_decision', 1, 'approved']])
  assert.equal(JSON.stringify(decided[0]), JSON.stringify(proposed[0]), 'an earlier event never changes')
  assert.equal((await load(c)).snapshotLockedAt, locked)
  // At the 60-event cap the snapshot is locked again, so no later change is dropped.
  for (let i = 0; i < 60; i++) await pg.query("insert into bob.phase_history(project_id,scope_kind,from_phase,to_phase,reason,recorded_by,actor_label,recorded_at) values('stair-A','project','build','build','Steg',$1,'One',clock_timestamp())", [one])
  const relocked = await load(c)
  assert.notEqual(relocked.snapshotLockedAt, locked); assert.deepEqual(relocked.events, [])
})
