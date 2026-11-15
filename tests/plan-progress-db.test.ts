import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

// Owner decision 2026-11-15: execution progress is not a plan change. Saved
// evidence and the owner's own answers close Steps in place, and focus moves on.
const id = (n: number) => '98200000-0000-4000-8000-' + String(n).padStart(12, '0')
const none = { kind: 'none', id: null, subject: null, area_id: null }
const criterion = (title: string, responsible_kind = 'bob') => ({ requirement_id: null, type: 'check', title, description: title, resolution: 'open', responsible_kind, responsible_person_id: null, evidence_selector: none })
const step = (title: string, requirements: unknown[]) => ({ step_id: null, title, goal: title, state: 'planned', area_id: null, phase: 'design', responsible_kind: 'bob', responsible_person_id: null, notes: '', requirements })

let pg: PGlite
const owner = id(901), outsider = id(902)
const call = async (uid: string, fn: string, args: unknown[], root = false): Promise<any> =>
  (await asProjectUser(pg, uid, `select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, root ? 'postgres' : 'authenticated')).rows[0].result
before(async () => { pg = await projectSchema(); await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'owner@example.test', outsider, 'outsider@example.test']) })
after(() => pg.close())

async function fixture() {
  const pid = (await call(owner, 'bob.create_project', [JSON.stringify({ name: 'Progress fixture' })])).id
  const plan = { summary: 'Plan', reason: 'Fixture', steps: [
    step('Model', [criterion('Show the model'), criterion('Owner confirms sizes', 'unassigned')]),
    step('Parts', [criterion('Parts and purchases')]),
    step('Assemble', [criterion('Built bed checked', 'unassigned')]),
  ] }
  const proposed = await call(owner, 'bob_private.project_plan_propose', [pid, 0, plan], true)
  const current = (await call(owner, 'bob_private.project_plan_decide', [pid, 0, proposed.record.revision, 'approve', 'Use'], true)).record
  const measurement = await call(owner, 'bob.evidence_command', [pid, 'measurement', 'create', randomUUID(), 0, { subject: 'Mattress', value: '1650', unit: 'mm', truth: 'measured', source: 'Owner', notes: '', required: true, area_id: null, component_id: null, source_media_id: null, change_note: 'Measured' }])
  const thread = (await pg.query<{ id: string }>('insert into bob.bob_threads(project_id,owner_user_id) values($1,$2) returning id', [pid, owner])).rows[0].id
  const answer = (await pg.query<{ id: string }>("insert into bob.bob_messages(thread_id,seq,turn_id,role,text) values($1,1,$2,'user','Vi har samma mått som alltid') returning id", [thread, randomUUID()])).rows[0].id
  const reply = (await pg.query<{ id: string }>("insert into bob.bob_messages(thread_id,seq,turn_id,role,text) values($1,2,$2,'assistant','Måtten är klara') returning id", [thread, randomUUID()])).rows[0].id
  return { pid, current, measurement, answer, reply }
}
const req = (current: any, s: number, q: number) => current.steps[s].requirements[q].id
const steps = async (pid: string) => (await pg.query<{ title: string; state: string }>(
  'select s.title,s.state from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=$1 order by s.position', [pid])).rows

test('saved evidence and the owner answer close a Step in place and move focus to the next open Step', async () => {
  const f = await fixture()
  const rev = f.current.revision
  const result = await call(owner, 'bob_private.project_plan_record_progress', [f.pid, rev, JSON.stringify([
    { requirement_id: req(f.current, 0, 0), evidence_kind: 'measurement', evidence_id: f.measurement.id },
    { requirement_id: req(f.current, 0, 1), evidence_kind: 'message', evidence_id: f.answer },
  ]), '[]'], true)
  assert.deepEqual(result.closed_steps.map((s: any) => s.title), ['Model'])
  assert.equal(result.focus.title, 'Parts')
  assert.equal(result.focus.state, 'active', 'the next Step is taken up')
  assert.deepEqual(await steps(f.pid), [{ title: 'Model', state: 'completed' }, { title: 'Parts', state: 'active' }, { title: 'Assemble', state: 'planned' }])
  const head = (await pg.query<{ current_revision: number }>('select current_revision from bob.project_plans where project_id=$1', [f.pid])).rows[0]
  assert.equal(head.current_revision, rev, 'no new plan revision and no approval')
  const pinned = (await pg.query<{ evidence_revision: number | null }>("select evidence_revision from bob.project_plan_evidence where project_id=$1 and evidence_kind='measurement'", [f.pid])).rows[0]
  assert.equal(pinned.evidence_revision, f.measurement.revision, 'the server pins the current revision')
})

test('a Step with an unmet requirement stays open, and only the owner\'s own messages count', async () => {
  const f = await fixture()
  const rev = f.current.revision
  const partial = await call(owner, 'bob_private.project_plan_record_progress', [f.pid, rev, JSON.stringify([
    { requirement_id: req(f.current, 0, 0), evidence_kind: 'measurement', evidence_id: f.measurement.id }]), JSON.stringify([f.current.steps[0].id])], true)
  assert.deepEqual(partial.closed_steps, [])
  assert.deepEqual(partial.not_closed, [f.current.steps[0].id], 'naming a Step does not bypass its requirements')
  await assert.rejects(call(owner, 'bob_private.project_plan_record_progress', [f.pid, rev, JSON.stringify([
    { requirement_id: req(f.current, 0, 1), evidence_kind: 'message', evidence_id: f.reply }]), '[]'], true), /plan_evidence_not_found/, 'Bob\'s own reply is not the owner\'s word')
  await assert.rejects(call(owner, 'bob_private.project_plan_record_progress', [f.pid, rev + 1, JSON.stringify([
    { requirement_id: req(f.current, 0, 1), evidence_kind: 'message', evidence_id: f.answer }]), '[]'], true), /record_changed/)
  await assert.rejects(call(outsider, 'bob_private.project_plan_record_progress', [f.pid, rev, JSON.stringify([
    { requirement_id: req(f.current, 0, 1), evidence_kind: 'message', evidence_id: f.answer }]), '[]'], true), /project_denied/)
})

test('the weigher reads open Steps, their requirement states and candidate records, owner messages only', async () => {
  const f = await fixture()
  const context = await call(owner, 'bob.read_plan_progress_context', [f.pid])
  assert.equal(context.revision, f.current.revision)
  assert.deepEqual(context.steps.map((s: any) => s.title), ['Model', 'Parts', 'Assemble'])
  assert.deepEqual(context.steps[0].requirements.map((q: any) => q.state), ['missing', 'missing'])
  const kinds = context.records.map((r: any) => r.kind)
  assert.ok(kinds.includes('measurement'))
  assert.deepEqual(context.records.filter((r: any) => r.kind === 'message').map((r: any) => r.id), [f.answer])
  await assert.rejects(call(outsider, 'bob.read_plan_progress_context', [f.pid]), /project_denied/)
})
