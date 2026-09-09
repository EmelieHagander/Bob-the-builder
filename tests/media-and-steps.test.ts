import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Real migrations/RLS. Local Storage rows emulate API metadata writes, not S3.
const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const outsider = '00000000-0000-0000-0000-000000000004'
const imageId = (n: number) => '10000000-0000-0000-0000-' + String(n).padStart(12, '0')
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function media(uid: string | null, project: string, action: string, id: string, data = {}) {
  return (await as(uid, 'select bob.media_command($1,$2,$3,$4) as data', [project, action, id, JSON.stringify(data)])).rows[0].data
}
const reservation = (kind = 'area', target = 'areaA') => ({
  original_name: 'entry.png', title: 'Entry before work', purpose: 'current_state',
  content_type: 'image/png', byte_size: 123, width: 320, height: 480,
  target_kind: kind, target_id: target,
})
async function upload(uid: string, id: string, project = 'A', size = 123) {
  return as(uid, "insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,$2)",
    [project + '/' + id, JSON.stringify({ size, mimetype: 'image/png' })])
}
async function steps(uid: string, action: string, step: string | null = null, data = {}, project = 'A', task = 'taskA') {
  return as(uid, 'select bob.task_steps_command($1,$2,$3,$4,$5)', [project, task, action, step, JSON.stringify(data)])
}
async function stepRows() { return (await as(one, "select * from bob.task_steps where task_id='taskA' order by position")).rows as any[] }

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
    // Broader than production: Bob's restrictive guards must still win.
    'create policy unrelated_broad_objects on storage.objects for all to anon,authenticated using(true) with check(true);',
    'create policy unrelated_broad_buckets on storage.buckets for all to anon,authenticated using(true) with check(true);',
    "insert into storage.buckets(id,name) values('other-app','other-app');",
  ].join('\n'))
  for (const [i, uid] of [one, two, both, outsider].entries()) await pg.query('insert into auth.users values($1,$2,now())', [uid, 'person' + i + '@example.test'])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Porch A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)", [one, two])
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, dir), 'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1)", [both])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','entry','Entry'),('areaB','B','private','Private'); insert into bob.tasks(id,area_id,name) values('taskA','areaA','Prepare opening'),('taskB','areaB','Private work')")
})
after(() => pg.close())

test('media reservations protect identity and both ends of project relations', async () => {
  await media(one, 'A', 'reserve', imageId(1), reservation())
  const row = (await as(one, 'select * from bob.media_assets where id=$1', [imageId(1)])).rows[0]
  assert.equal(row.created_by, one)
  assert.equal(row.state, 'pending')
  assert.equal((await as(two, 'select * from bob.media_assets')).rows.length, 0)
  for (const uid of [two, outsider, null]) await assert.rejects(media(uid, 'A', 'reserve', imageId(2), reservation()), /project_denied/)
  await assert.rejects(as(null, 'select * from bob.media_assets', [], 'anon'), /permission denied/)
  await assert.rejects(media(both, 'A', 'reserve', imageId(2), reservation('task', 'taskB')), /project_denied/)
  assert.equal((await as(one, 'select id from bob.media_assets where id=$1', [imageId(2)])).rows.length, 0, 'bad attachment rolls reservation back')
  for (const sql of ["update bob.media_assets set project_id='B'", "update bob.media_assets set state='ready'",
    "update bob.media_assets set created_by='" + two + "'", 'delete from bob.media_assets',
    "insert into bob.media_links(project_id,media_id,task_id) values('B','" + imageId(1) + "','taskB')"]) {
    await assert.rejects(as(one, sql), /permission denied/)
  }
})

test('upload, read-back, overwrite denial and retryable removal enforce real storage RLS', async () => {
  const id = imageId(1)
  await assert.rejects(media(one, 'A', 'finalize', id), /Upload incomplete/)
  await assert.rejects(upload(both, id), /row-level security/)
  await assert.rejects(upload(two, id), /row-level security/)
  await assert.rejects(upload(one, imageId(99)), /row-level security/)
  await upload(one, id)
  await media(one, 'A', 'finalize', id)
  await media(one, 'A', 'finalize', id)
  assert.equal((await as(both, "select name from storage.objects where bucket_id='bob-project-media'")).rows.length, 1)
  assert.equal((await as(two, "select name from storage.objects where bucket_id='bob-project-media'")).rows.length, 0)
  assert.equal((await as(null, "select name from storage.objects where bucket_id='bob-project-media'", [], 'anon')).rows.length, 0)
  assert.equal((await as(one, "update storage.objects set metadata='{}' where name=$1 returning name", ['A/' + id])).rows.length, 0)
  assert.equal((await as(one, 'delete from storage.objects where name=$1 returning name', ['A/' + id])).rows.length, 0)
  await assert.rejects(media(one, 'A', 'finish_delete', id), /Begin image removal/)
  await media(one, 'A', 'begin_delete', id)
  await assert.rejects(media(one, 'A', 'finish_delete', id), /File removal incomplete/)
  await as(one, 'delete from storage.objects where name=$1', ['A/' + id])
  await assert.rejects(upload(one, id), /row-level security/)
  await media(one, 'A', 'finish_delete', id)
  assert.equal((await as(one, 'select * from bob.media_links')).rows.length, 0)
  assert.equal((await as(one, 'select * from bob.media_assets')).rows.length, 0)
})

test('bucket configuration is protected without changing other app rights; incomplete metadata cannot become ready', async () => {
  assert.equal((await as(one, "update storage.buckets set public=true where id='bob-project-media' returning id")).rows.length, 0)
  assert.equal((await as(one, "delete from storage.buckets where id='bob-project-media' returning id")).rows.length, 0)
  assert.equal((await as(one, "update storage.buckets set public=true where id='other-app' returning id")).rows.length, 1)
  await media(one, 'A', 'reserve', imageId(3), reservation())
  await upload(one, imageId(3), 'A', 999)
  await assert.rejects(media(one, 'A', 'finalize', imageId(3)), /Upload incomplete/)
  assert.equal((await as(one, 'select state from bob.media_assets where id=$1', [imageId(3)])).rows[0].state, 'pending')
  await media(one, 'A', 'begin_delete', imageId(3))
  await as(one, 'delete from storage.objects where name=$1', ['A/' + imageId(3)])
  await media(one, 'A', 'finish_delete', imageId(3))
})

test('instructions and step order persist; stale edits and required checks are enforced', async () => {
  const task = (await as(one, "select updated_at from bob.tasks where id='taskA'")).rows[0]
  await steps(one, 'instructions', null, { instructions: 'Prepare the existing opening.', expected_updated_at: task.updated_at })
  assert.equal((await as(one, "select instructions from bob.tasks where id='taskA'")).rows[0].instructions, 'Prepare the existing opening.')
  await assert.rejects(steps(one, 'instructions', null, { instructions: 'Stale', expected_updated_at: '2000-01-01T00:00:00Z' }), /Task changed/)
  await steps(one, 'create', null, { title: 'Remove trim', instructions: 'Keep reusable pieces.' })
  await steps(one, 'create', null, { title: 'Check opening', is_checkpoint: true, required: true })
  let [first, check] = await stepRows()
  await steps(one, 'move', check.id, { revision: check.revision, direction: 'up' })
  assert.deepEqual((await stepRows()).map(s => s.title), ['Check opening', 'Remove trim'])
  await assert.rejects(steps(one, 'edit', first.id, { revision: first.revision, title: 'Stale' }), /Step changed/)
  ;[check, first] = await stepRows()
  await steps(one, 'edit', first.id, { revision: first.revision, title: 'Remove old trim', instructions: 'Keep reusable pieces.' })
  await assert.rejects(as(one, "update bob.tasks set status='done' where id='taskA'"), /Complete required checks/)
  await steps(one, 'complete', check.id, { revision: check.revision, completed: true })
  await as(one, "update bob.tasks set status='done' where id='taskA'")
  check = (await stepRows())[0]
  await assert.rejects(steps(one, 'complete', check.id, { revision: check.revision, completed: false }), /Reopen the task/)
  await assert.rejects(steps(one, 'create', null, { title: 'New check', is_checkpoint: true, required: true }), /Reopen the task/)
  await assert.rejects(steps(two, 'create', null, { title: 'Foreign' }), /project_denied/)
  await assert.rejects(steps(both, 'create', null, { title: 'Wrong parent' }, 'A', 'taskB'), /project_denied/)
  await assert.rejects(as(one, 'update bob.task_steps set required=false'), /permission denied/)
  assert.equal((await as(two, 'select * from bob.task_steps')).rows.length, 0)
})

test('step/link removal preserves originals; project deletion requires file cleanup; revoked members lose byte access', async () => {
  const s = (await stepRows())[1], id = imageId(4)
  await media(one, 'A', 'reserve', id, reservation('step', s.id))
  await upload(one, id)
  await media(one, 'A', 'finalize', id)
  await media(one, 'A', 'link', id, { target_kind: 'task', target_id: 'taskA' })
  await assert.rejects(media(both, 'A', 'link', id, { target_kind: 'task', target_id: 'taskB' }), /project_denied/)
  await steps(one, 'delete', s.id, { revision: s.revision })
  assert.equal((await as(one, 'select * from bob.media_links where step_id=$1', [s.id])).rows.length, 0)
  assert.equal((await as(one, 'select * from bob.media_assets where id=$1', [id])).rows.length, 1)
  await assert.rejects(pg.exec("delete from bob.projects where id='A'"), /foreign key constraint/)
  const link = (await as(one, 'select id from bob.media_links where media_id=$1', [id])).rows[0]
  await media(one, 'A', 'unlink', id, { link_id: link.id })
  assert.equal((await as(one, 'select * from bob.media_links where media_id=$1', [id])).rows.length, 0)
  assert.equal((await as(one, 'select * from storage.objects where name=$1', ['A/' + id])).rows.length, 1)
  await pg.exec("delete from bob.people where id='oneA'")
  assert.equal((await as(one, 'select * from bob.media_assets')).rows.length, 0)
  assert.equal((await as(one, 'select * from storage.objects where name=$1', ['A/' + id])).rows.length, 0)
  await assert.rejects(media(one, 'A', 'begin_delete', id), /project_denied/)
})
