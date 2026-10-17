import { randomUUID } from 'node:crypto'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

const user = '00000000-0000-4000-8000-000000000001'
const stranger = '00000000-0000-4000-8000-000000000002'
const quote = 'Create the requested tasks and update their work.'
const migration = '20261017100500_bob_unlimited_write_receipts.sql'
const inventorySql = `select p.oid::regprocedure::text signature,p.prosrc,p.prosecdef,p.proconfig,p.proacl::text acl
 from pg_proc p where p.pronamespace='bob_private'::regnamespace
 and p.proname like 'bob_project_write%' and position('write_budget_exhausted' in p.prosrc)>0 order by p.proname`
let pg: Awaited<ReturnType<typeof projectSchema>>, beforeWriters: any[]
before(async () => {
  pg = await projectSchema(async (db, name) => { if (name === migration) beforeWriters = (await db.query(inventorySql)).rows })
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [user, 'owner@example.test', stranger, 'stranger@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Work A'),('B','b','Other project'); insert into bob.areas(id,project_id,slug,name) values('areaA','A','assembly','Assembly'),('areaB','B','other','Other')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('ownerA','A','Owner','OA',$1),('strangerB','B','Stranger','SB',$2)", [user, stranger])
})
after(async () => { await pg?.close() })

type Claim = { thread: string; turn: string; generation: number; job?: string }
let previous: Claim | undefined
async function claim(mode: 0 | 1 | null): Promise<Claim> {
  if (previous) {
    await asProjectUser(pg, null, "select bob.bob_fail_turn_v2('A',$1,$2,$3,$4)", [user, previous.thread, previous.turn, previous.generation], 'service_role')
    if (previous.job) await pg.query("update bob_private.bob_jobs set status='failed',claim_token=null,lease_until=null where id=$1", [previous.job])
  }
  const turn = randomUUID()
  const result: any = (await asProjectUser(pg, null, "select bob.bob_claim_turn('A',$1,$2,$3) result", [user, turn, quote], 'service_role')).rows[0].result
  assert.equal(result.status, 'claimed')
  const c: Claim = { thread: result.thread_id, turn, generation: result.generation }
  if (mode !== null) {
    // A service-owned job pin is the boundary under test; clients cannot insert
    // this row or select/change its mode. Catalog selection is tested with the
    // lifecycle migration, independently of these domain-write cases.
    const manifest: any = (await pg.query("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
    c.job = randomUUID()
    await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,status,
      claim_token,lease_until,credential,worker_url,expires_at,work_allowance_version,ai_catalog_manifest_id)
      values($1,'A',$2,$3,$4,$5,'running',$6,clock_timestamp()+interval '4 minutes','{"fixture":true}',
      'https://fixture.supabase.co/functions/v1/bob-worker',clock_timestamp()+interval '30 minutes',$7,$8)`,
    [c.job, user, c.thread, c.turn, c.generation, randomUUID(), mode, manifest.manifest_id])
  }
  previous = c
  return c
}
async function snapshot(resource: string, id: string) {
  return (await asProjectUser(pg, user, "select bob.read_bob_work_snapshot('A',$1,$2) s", [resource, id])).rows[0].s
}
function createTask(scope: any, name: string) {
  const domain = { kind: 'task', record_id: null, expected_updated_at: null, expected_revision: null, request_quote: quote,
    data: { area_id: 'areaA', name, instructions: 'Keep these instructions.' } }
  return { ...domain, kind: 'bound_work', data: { pins: [scope], domain } }
}
async function write(c: Claim, payload: any, actor = user, version = 19) {
  return (await asProjectUser(pg, actor, `select bob.bob_project_write_v${version}('A',$1,$2,$3,$4::jsonb) result`, [c.thread, c.turn, c.generation, JSON.stringify(payload)])).rows[0].result as any
}
async function count(c: Claim) {
  return (await pg.query('select count(*)::int n from bob_private.bob_write_receipts where turn_id=$1', [c.turn])).rows[0].n
}

test('all retained receipt quota guards change only their pinned-mode predicate and preserve authority settings', async () => {
  const current = (await pg.query(inventorySql)).rows as any[]
  assert.ok(beforeWriters.length >= 16, 'includes original and renamed domain writers')
  assert.deepEqual(current.map(x => x.signature), beforeWriters.map(x => x.signature))
  const pattern = /if\s*(\(select count\(\*\) from bob_private\.bob_write_receipts where project_id=p_project and actor_id=auth\.uid\(\) and turn_id=p_turn\)>=(?:8|32)) then/g
  for (let i = 0; i < current.length; i++) {
    const old = beforeWriters[i], next = current[i]
    const expected = old.prosrc.replace(pattern, 'if not bob_private.bob_turn_unlimited_work(p_project,p_thread,p_turn,p_generation) and $1 then')
    assert.notEqual(expected, old.prosrc, old.signature)
    assert.equal(next.prosrc, expected, old.signature)
    assert.deepEqual([next.prosecdef, next.proconfig, next.acl], [old.prosecdef, old.proconfig, old.acl], old.signature)
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await pg.query("select has_function_privilege($1,'bob_private.bob_turn_unlimited_work(text,uuid,uuid,bigint)','execute') allowed", [role])).rows[0].allowed, false)
  }
})

test('a pinned unlimited job saves over 32 writes, keeps exact retries, and still enforces domain, CAS and project guards', async () => {
  const c = await claim(1), scope = await snapshot('areas', 'areaA')
  const first = createTask(scope, 'Unlimited task 0')
  const original = await write(c, first)
  for (let i = 1; i < 40; i++) await write(c, createTask(scope, 'Unlimited task ' + i))
  assert.equal(await count(c), 40)
  assert.deepEqual(await write(c, first), original)
  assert.equal(await count(c), 40, 'exact retry creates no duplicate receipt or task')
  await assert.rejects(write(c, { ...first, data: { ...first.data, domain: { ...first.data.domain, data: { ...first.data.domain.data, instructions: 'A different request is not an exact retry.' } } } }), /record_changed/)
  await assert.rejects(write(c, createTask(scope, 'Foreign attempt'), stranger), /project_denied/)
  await assert.rejects(write({ ...c, generation: c.generation + 1 }, createTask(scope, 'Stale worker')), /turn_not_claimed/)

  const task: any = await snapshot('tasks', original.recordId)
  const domain = { kind: 'task_work', record_id: original.recordId, expected_updated_at: task.record.updated_at,
    expected_revision: null, request_quote: quote, data: { status: 'doing', person_ids: [] } }
  const status = { ...domain, kind: 'bound_work', data: { pins: [task], domain } }
  const started = await write(c, status)
  assert.equal(started.record.status, 'doing', 'the retained expert-status writer also bypasses only its quota')
  assert.equal(started.record.instructions, 'Keep these instructions.')
  await assert.rejects(write(c, { ...status, data: { ...status.data, domain: { ...domain, data: { ...domain.data, status: 'done' } } } }), /record_changed/)
  const check = randomUUID()
  await pg.query("insert into bob.task_steps(id,project_id,task_id,title,position,is_checkpoint,required,created_by) values($1,'A',$2,'Actual inspection',1,true,true,$3)", [check, original.recordId, user])
  const checked: any = await snapshot('tasks', original.recordId)
  await assert.rejects(write(c, { ...status, expected_updated_at: checked.record.updated_at, data: { pins: [checked], domain: { ...domain, expected_updated_at: checked.record.updated_at, data: { ...domain.data, status: 'done' } } } }), /Complete required checks/)
  assert.equal(await count(c), 41)
  const recovered: any = (await asProjectUser(pg, user, "select bob.bob_read_write_receipts('A',$1,$2,$3) result", [c.thread, c.turn, c.generation])).rows[0].result
  assert.equal(recovered.length, 41, 'recovery returns every committed write')
})

test('legacy synchronous turns and old pinned jobs still stop at their original quota', async () => {
  const scope = await snapshot('areas', 'areaA')
  for (const mode of [null, 0] as const) {
    const c = await claim(mode)
    for (let i = 0; i < 32; i++) await write(c, createTask(scope, 'Legacy ' + mode + ' task ' + i))
    await assert.rejects(write(c, createTask(scope, 'Legacy rejected ' + mode)), /write_budget_exhausted/)
    assert.equal(await count(c), 32)
  }
})

test('unlimited mode is private and cannot outlive its matching active job authority', async () => {
  const c = await claim(1), scope = await snapshot('areas', 'areaA')
  await assert.rejects(asProjectUser(pg, user, 'update bob_private.bob_jobs set work_allowance_version=1 where id=$1', [c.job]), /permission denied/)
  await assert.rejects(asProjectUser(pg, user, "select bob_private.bob_turn_unlimited_work('A',$1,$2,$3)", [c.thread, c.turn, c.generation]), /permission denied/)
  const enabled = async (actor = user, g = c.generation) => pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor })])
    return (await tx.query("select bob_private.bob_turn_unlimited_work('A',$1,$2,$3) enabled", [c.thread, c.turn, g])).rows[0].enabled
  })
  assert.equal(await enabled(), true)
  assert.equal(await enabled(stranger), false)
  assert.equal(await enabled(user, c.generation + 1), false)
  await pg.query("update bob_private.bob_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [c.job])
  assert.equal(await enabled(), false)
  await pg.query("update bob_private.bob_jobs set lease_until=clock_timestamp()+interval '4 minutes',expires_at=clock_timestamp()-interval '1 second' where id=$1", [c.job])
  assert.equal(await enabled(), false)
  await pg.query("update bob_private.bob_jobs set expires_at=clock_timestamp()+interval '30 minutes',status='queued' where id=$1", [c.job])
  assert.equal(await enabled(), false)
  assert.equal(await count(c), 0)
  assert.equal((await pg.query("select count(*)::int n from bob.tasks where name='Stale worker'")).rows[0].n, 0)
})
