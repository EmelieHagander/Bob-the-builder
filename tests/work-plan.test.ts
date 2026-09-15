import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'

const pg = new PGlite()
const ownerA = '00000000-0000-0000-0000-000000000601'
const ownerB = '00000000-0000-0000-0000-000000000602'
const outsider = '00000000-0000-0000-0000-000000000603'
const uuid = (n: number) => `96000000-0000-0000-0000-${String(n).padStart(12, '0')}`

async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}

async function work(task: string, action: string, item: string | null, expected = 0, data: Record<string, unknown> = {}) {
  return (await as(ownerA, 'select bob.work_plan_command($1,$2,$3,$4,$5,$6) data',
    ['A', task, action, item, expected, JSON.stringify(data)])).rows[0].data as any
}

async function solution(action: string, id: string | null, expected: number, data: Record<string, unknown>) {
  return (await as(ownerA, 'select bob.solution_command($1,$2,$3,$4,$5) data',
    ['A', action, id, expected, JSON.stringify(data)])).rows[0].data as any
}

async function requirement(action: string, id: string, expected: number, data: Record<string, unknown> = {}) {
  return (await as(ownerA, 'select bob.material_requirement_command($1,$2,$3,$4,$5) data',
    ['A', action, id, expected, JSON.stringify(data)])).rows[0].data as any
}

async function readiness(task: string) {
  return (await as(ownerA, 'select * from bob.current_task_readiness where task_id=$1', [task])).rows[0] as any
}

before(async () => {
  await pg.exec([
    'create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;',
    'create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);',
    "create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;",
    "create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;",
    'grant usage on schema auth to anon,authenticated;',
    'create schema storage;',
    'create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);',
    'create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));',
    'alter table storage.buckets enable row level security; alter table storage.objects enable row level security;',
    'grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;',
    'create policy unrelated_broad_objects on storage.objects for all to anon,authenticated using(true) with check(true);',
    'create policy unrelated_broad_buckets on storage.buckets for all to anon,authenticated using(true) with check(true);',
    "insert into storage.buckets(id,name) values('other-app','other-app');",
  ].join('\n'))
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())', [
    ownerA, 'work-a@example.test', ownerB, 'work-b@example.test', outsider, 'work-x@example.test',
  ])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  }
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Build A'),('B','b','Build B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('owner-a','A','Alice','AL',$1),('owner-b','B','Bob','BO',$2)", [ownerA, ownerB])
  await setupSharedSocial(pg)
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, migrations), 'utf8'))
  }
  await pg.exec("insert into bob.areas(id,project_id,slug,name,phase) values('a1','A','work','Work','build'),('a2','A','design','Design','design'),('b1','B','private','Private','build')")
  await pg.exec("insert into bob.tasks(id,area_id,name,status) values('prep','a1','Prepare opening','todo'),('frame','a1','Frame opening','todo'),('close','a1','Close wall','todo'),('design-task','a2','Mark proposed opening','todo'),('private','b1','Private task','todo')")
  await pg.query("insert into bob.task_steps(id,project_id,task_id,title,position,is_checkpoint,required,created_by) values($1,'A','frame','Opening checked',1,true,true,$2)", [uuid(1), ownerA])
})

after(() => pg.close())

test('a blocker-free task stays unreviewed until a person confirms readiness', async () => {
  let row = await readiness('prep')
  assert.equal(row.readiness_state, 'unreviewed')
  assert.equal(row.blocker_count, 0)
  await work('prep', 'confirm_readiness', null, 0, {})
  row = await readiness('prep')
  assert.equal(row.readiness_state, 'ready')
  assert.ok(row.reviewed_at)

  const design = await readiness('design-task')
  assert.equal(design.readiness_state, 'blocked')
  assert.match(JSON.stringify(design.blockers), /Area is in Design/)
  await assert.rejects(work('design-task', 'confirm_readiness', null, 0, {}), /Resolve named blockers/)
})

test('tools and required information are named blockers and edits invalidate confirmation', async () => {
  await work('frame', 'add_need', uuid(10), 0, { kind: 'tool', label: 'Circular saw', notes: 'Charged battery' })
  let row = await readiness('frame')
  assert.equal(row.readiness_state, 'blocked')
  assert.match(JSON.stringify(row.blockers), /Tool needed: Circular saw/)

  await work('frame', 'set_need_ready', uuid(10), 1, { ready: true })
  row = await readiness('frame')
  assert.equal(row.readiness_state, 'unreviewed')
  await work('frame', 'confirm_readiness', null, 0, {})
  assert.equal((await readiness('frame')).readiness_state, 'ready')

  await work('frame', 'add_need', uuid(11), 0, { kind: 'information', label: 'Opening width', notes: 'Verify before cutting' })
  row = await readiness('frame')
  assert.equal(row.readiness_state, 'blocked')
  assert.match(JSON.stringify(row.blockers), /Confirm: Opening width/)
  await work('frame', 'remove_need', uuid(11), 1, {})
  assert.equal((await readiness('frame')).readiness_state, 'unreviewed')
})

test('task and checkpoint dependencies unblock deterministically and cycles/cross-project links fail', async () => {
  await work('frame', 'add_dependency', uuid(20), 0, { prerequisite_task_id: 'prep', prerequisite_step_id: null, note: 'Prepare before framing' })
  let row = await readiness('frame')
  assert.equal(row.readiness_state, 'blocked')
  assert.match(JSON.stringify(row.blockers), /Finish Prepare opening/)

  await assert.rejects(work('prep', 'add_dependency', uuid(21), 0, { prerequisite_task_id: 'frame', prerequisite_step_id: null }), /cannot form a cycle/)
  await assert.rejects(work('frame', 'add_dependency', uuid(22), 0, { prerequisite_task_id: 'private', prerequisite_step_id: null }), /same Project|inside one Project|project_denied/)

  await as(ownerA, "update bob.tasks set status='done' where id='prep'")
  row = await readiness('frame')
  assert.equal(row.readiness_state, 'unreviewed')

  await work('close', 'add_dependency', uuid(23), 0, { prerequisite_task_id: 'frame', prerequisite_step_id: uuid(1), note: 'Checkpoint is enough' })
  row = await readiness('close')
  assert.equal(row.readiness_state, 'blocked')
  assert.match(JSON.stringify(row.blockers), /Opening checked/)
  await pg.query("update bob.task_steps set completed_at=now(),completed_by=$1 where id=$2", [ownerA, uuid(1)])
  assert.equal((await readiness('close')).readiness_state, 'unreviewed')
})

test('canonical material requirements block the task until Shopping is delivered', async () => {
  await solution('create', uuid(30), 0, {
    title: 'Selected build', description: 'Work-plan material fixture', assumptions: '', tradeoffs: '',
  })
  const selected = await solution('select', uuid(30), 0, { solution_revision: 1, reason: 'Use this build' })
  await requirement('create', uuid(31), 0, {
    name: 'Studs 45×95', category: 'Timber', area_id: 'a1', task_id: 'close', unit: 'pcs', required_quantity: '4',
    waste_percent: '0', purchase_increment: '1', basis: 'Four studs for this fixture.', assumptions: '',
    artifact_id: null, artifact_revision: null, target_revision: selected.revision,
    stock_allocations: [], component_allocations: [],
  })
  let material = (await as(ownerA, 'select * from bob.task_material_readiness where task_id=$1', ['close'])).rows[0] as any
  assert.equal(material.ready, false)
  assert.match(material.reason, /Send .* to Shopping/)
  let row = await readiness('close')
  assert.equal(row.readiness_state, 'blocked')
  assert.match(JSON.stringify(row.blockers), /Send Studs 45×95 to Shopping/)

  await requirement('publish', uuid(31), 1, {})
  material = (await as(ownerA, 'select * from bob.task_material_readiness where task_id=$1', ['close'])).rows[0] as any
  assert.equal(material.ready, false)
  assert.match(material.reason, /still needs buying/)
  const linked = (await as(ownerA, 'select material_id from bob.material_requirement_shopping where requirement_id=$1', [uuid(31)])).rows[0] as any
  await as(ownerA, "update bob.materials set status='delivered' where id=$1", [linked.material_id])
  material = (await as(ownerA, 'select * from bob.task_material_readiness where task_id=$1', ['close'])).rows[0] as any
  assert.equal(material.ready, true)
  assert.equal(material.reason, 'Delivered')
  assert.equal((await readiness('close')).readiness_state, 'unreviewed')
  await work('close', 'confirm_readiness', null, 0, {})
  assert.equal((await readiness('close')).readiness_state, 'ready')
})

test('manual Blocked stays visible in Today and project RLS protects planning details', async () => {
  await as(ownerA, "update bob.tasks set status='blocked' where id='frame'")
  const row = await readiness('frame')
  assert.equal(row.readiness_state, 'blocked')
  assert.match(JSON.stringify(row.blockers), /manually marked Blocked/)
  const today = (await as(ownerA, "select id,status from bob.today_tasks where project_id='A' order by id")).rows as any[]
  assert(today.some(item => item.id === 'frame' && item.status === 'blocked'))
  assert.equal((await as(outsider, 'select * from bob.task_needs')).rows.length, 0)
  assert.equal((await as(outsider, 'select * from bob.current_task_readiness')).rows.length, 0)
  await assert.rejects(as(null, 'select * from bob.current_task_readiness', [], 'anon'), /permission denied/)
})
