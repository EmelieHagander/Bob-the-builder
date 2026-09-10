import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createArtifacts } from '../src/data/artifacts'

const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const outsider = '00000000-0000-0000-0000-000000000004'
const id = (n: number) => '40000000-0000-0000-0000-' + String(n).padStart(12, '0')
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function fact(kind: string, action: string, record: string, expected: number | null, data = {}, uid: string | null = one, project = 'A') {
  return (await as(uid, 'select bob.evidence_command($1,$2,$3,$4,$5,$6) as data',
    [project, kind, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
const length = (data = {}) => ({ subject: 'Opening width', unit: 'mm', value: null, truth: 'unknown', source: '', required: true, ...data })
const part = (data = {}) => ({ name: 'Existing window', kind: 'Window', quantity: null, intent: 'inspect', ...data })
async function current(kind: 'measurement' | 'component', record: string, uid = one) {
  return (await as(uid, 'select * from bob.current_' + (kind === 'measurement' ? 'measurements' : 'components') + ' where id=$1', [record])).rows[0] as any
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

async function command(action: string, record: string, expected: number | null, data = {}, uid: string | null = one, project = 'A') {
  return (await as(uid, 'select bob.artifact_command($1,$2,$3,$4,$5) as data', [project, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
const draft = (extra = {}) => ({ title: 'Porch plan', kind: 'plan', notes: 'Manual sketch', source: 'Drawn from site notes', unresolved: 'Check foundations', source_media_id: id(90), expected_target_revision: 1, reviewed: true, ...extra })
const solution = (action: string, record: string | null, expected: number, data: any, uid = one, project = 'A') => as(uid, 'select bob.solution_command($1,$2,$3,$4,$5)', [project, action, record, expected, JSON.stringify(data)])
const target = (record: string, expected: number) => solution('select', record, expected, { solution_revision: 1, reason: 'Select reviewed layout' })
const version = async (record: string, revision = 1) => (await as(one, 'select * from bob.artifact_versions where id=$1 and revision=$2', [record, revision])).rows[0] as any
const reserve = (project: string, image: string, uid: string) => as(uid, 'select bob.media_command($1,$2,$3,$4)', [project, 'reserve', image, JSON.stringify({ original_name: 'x.png', title: 'Recorded plan image', purpose: 'proposal', content_type: 'image/png', byte_size: 20, width: 1, height: 1, target_kind: 'project', target_id: project })])
const link = (action: string, record: string, expected: number, previous: number, task = 'taskA', uid = one, project = 'A') => command(action, record, expected, { task_id: task, expected_link_revision: previous }, uid, project)

test('references require selected target, ready same-project image and explicit review; invalid creates are atomic', async () => {
  await reserve('A', id(90), one)
  await assert.rejects(command('create', id(1), 0, draft()), /Select a project target/)
  await fact('measurement', 'create', id(91), 0, length({ value: '1.250', unit: 'm', truth: 'estimated', source: 'Estimate' }))
  await solution('create', id(80), 0, { title: 'Retain porch', description: 'Original footprint', measurements: [{ id: id(91), revision: 1 }] })
  await solution('create', id(81), 0, { title: 'Extend porch', description: 'Larger footprint' })
  await target(id(80), 0)
  await assert.rejects(command('create', id(1), 0, draft()), /ready image/)
  await pg.query("insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,'{\"size\":20,\"mimetype\":\"image/png\"}')", ['A/' + id(90)])
  await as(one, "select bob.media_command('A','finalize',$1,'{}')", [id(90)])
  for (const extra of [{ reviewed: false }, { reviewed: 'true' }, { expected_target_revision: 0 }, { title: '' }, { kind: 'build_ready' }, { source: '' }, { source_media_id: null }, { recorded_by: two }, { target_revision: 10 }]) {
    await assert.rejects(command('create', id(1), 0, draft(extra)))
    assert.equal((await as(one, 'select * from bob.artifacts')).rows.length, 0)
  }
  await command('create', id(1), 0, draft({ area_id: 'areaA' }))
  const v = await version(id(1)); assert.equal(v.solution_id, id(80)); assert.equal(v.recorded_by, one)
  assert.equal(v.target_changed, false); assert.equal(v.evidence_changed, false); assert.equal(v.image_ready, true)
})

test('task pins and old artifact basis survive changed evidence, target and new versions; same target reselection stays current', async () => {
  await link('attach', id(1), 1, 0)
  await target(id(80), 1)
  assert.equal((await version(id(1))).target_changed, false)
  await fact('measurement', 'revise', id(91), 1, length({ value: '1280', truth: 'measured', source: 'Tape', change_note: 'Measured on site' }))
  assert.equal((await version(id(1))).evidence_changed, true)
  await target(id(81), 2)
  await command('revise', id(1), 1, draft({ expected_target_revision: 3, change_note: 'Reviewed for extension' }))
  const old = await version(id(1)), latest = await version(id(1), 2)
  assert.equal(old.target_changed, true); assert.equal(old.solution_id, id(80)); assert.equal(old.latest_revision, 2)
  assert.equal(latest.solution_id, id(81)); assert.equal(latest.target_changed, false); assert.equal(latest.evidence_changed, false)
  const pinned = (await as(one, 'select * from bob.task_artifacts')).rows[0] as any
  assert.equal(pinned.revision, 1); assert.equal(pinned.target_revision, 1); assert.equal(pinned.latest_revision, 2)
  const evidence = (await as(one, 'select * from bob.solution_measurement_details where solution_id=$1', [old.solution_id])).rows[0] as any
  assert.equal(evidence.value, '1.250'); assert.equal(evidence.truth, 'estimated'); assert.equal(evidence.latest_revision, 2)
})

test('stale artifact, target and task-link changes fail; task updates and detach are explicit', async () => {
  await assert.rejects(command('revise', id(1), 1, draft({ expected_target_revision: 3, change_note: 'Old revision' })), /changed/)
  await assert.rejects(command('revise', id(1), 2, draft({ change_note: 'Old target' })), /Target changed/)
  await assert.rejects(link('attach', id(1), 1, 1), /changed/)
  await assert.rejects(link('attach', id(1), 2, 0), /Task reference changed/)
  await link('attach', id(1), 2, 1)
  await assert.rejects(link('detach', id(1), 2, 1), /Task reference changed/)
  assert.equal((await as(one, 'select revision from bob.task_artifacts')).rows[0].revision, 2)
  await link('detach', id(1), 2, 2)
  assert.equal((await as(one, 'select * from bob.task_artifacts')).rows.length, 0)
  assert.equal((await as(one, 'select * from bob.artifact_revisions')).rows.length, 2)
  await link('attach', id(1), 2, 0)
})

test('RLS hides every artifact surface; same-project guards hold even with dual membership', async () => {
  for (const table of ['artifacts','artifact_revisions','artifact_task_links','artifact_versions','current_artifacts','task_artifacts']) {
    assert.equal((await as(outsider, 'select * from bob.' + table)).rows.length, 0)
    await assert.rejects(as(null, 'select * from bob.' + table, [], 'anon'), /permission denied/)
  }
  await assert.rejects(command('create', id(2), 0, draft(), outsider), /project_denied/)
  await assert.rejects(command('create', id(2), 0, draft(), null), /project_denied/)
  await reserve('B', id(92), two)
  await assert.rejects(command('create', id(2), 0, draft({ expected_target_revision: 3, source_media_id: id(92) }), both), /ready image/)
  await assert.rejects(command('create', id(2), 0, draft({ area_id: 'areaB' }), both), /Area unavailable/)
  await assert.rejects(link('attach', id(1), 2, 0, 'taskB', both), /Task unavailable/)
  await assert.rejects(link('attach', id(1), 2, 0, 'taskB', both, 'B'), /unavailable/)
  for (const table of ['artifacts','artifact_revisions','artifact_task_links']) {
    await assert.rejects(as(one, 'delete from bob.' + table), /permission denied/)
    await assert.rejects(as(one, 'update bob.' + table + " set project_id='B'"), /permission denied/)
  }
  await assert.rejects(command('revise', id(1), 2, draft({ area_id: 'areaB', change_note: 'Move' })), /Unsupported fields/)
})

test('archive/restore keep basis and task pins; clear prevents revision but preserves readable references', async () => {
  await command('archive', id(1), 2)
  const old = await version(id(1)); assert.equal(old.currently_archived, true)
  await assert.rejects(link('attach', id(1), 3, 2), /Restore/)
  await solution('clear', null, 3, { reason: 'Wait for review' })
  await command('restore', id(1), 3)
  const restored = await version(id(1), 4); assert.equal(restored.target_revision, 3); assert.equal(restored.target_changed, true)
  await assert.rejects(command('revise', id(1), 4, draft({ expected_target_revision: 4, change_note: 'No target' })), /Select a project target/)
  assert.equal((await as(one, 'select revision from bob.task_artifacts')).rows[0].revision, 2)
})

test('file removal keeps titles, versions and task pins; unavailable images cannot be attached', async () => {
  await as(one, "select bob.media_command('A','begin_delete',$1,'{}')", [id(90)])
  assert.equal((await version(id(1))).image_ready, false)
  await assert.rejects(link('attach', id(1), 4, 2), /Image unavailable/)
  await as(one, "delete from storage.objects where name=$1", ['A/' + id(90)])
  await as(one, "select bob.media_command('A','finish_delete',$1,'{}')", [id(90)])
  const rows = (await as(one, 'select * from bob.artifact_versions')).rows as any[]
  assert.equal(rows.length, 4)
  assert(rows.every(r => r.source_media_id === null && r.source_media_title === 'Recorded plan image' && !r.image_ready))
  assert.equal((await as(one, 'select revision from bob.task_artifacts')).rows[0].revision, 2)
})

test('task/area deletion preserves artifacts, access revocation applies, project cascade removes complete history', async () => {
  await pg.exec("delete from bob.tasks where id='taskA'")
  assert.equal((await as(one, 'select * from bob.artifact_task_links')).rows.length, 0)
  assert.equal((await as(one, 'select * from bob.artifact_revisions')).rows.length, 4)
  await pg.exec("delete from bob.areas where id='areaA'")
  assert.equal((await version(id(1))).area_id, null)
  await pg.exec("delete from bob.people where id='bothA'")
  await assert.rejects(command('archive', id(1), 4, {}, both), /project_denied/)
  await pg.exec("delete from bob.projects where id='A'")
  for (const table of ['artifacts','artifact_revisions','artifact_task_links','solutions','target_revisions'])
    assert.equal((await pg.query('select * from bob.' + table + " where project_id='A'")).rows.length, 0)
})

test('project/auth generation changes reject delayed artifact writes before read-back and reject delayed link acknowledgements', async () => {
  for (const action of ['edit','link']) {
    let resolve: (v: any) => void = () => {}, generation = 0, reads = 0
    const wait = new Promise<any>(r => { resolve = r })
    const client = { rpc: () => wait, from: () => { reads++; throw new Error('Must not read into the new project') } } as any
    const api = createArtifacts(client, () => { const g = generation; return () => { if (g !== generation) throw new Error('Context changed') } })
    const pending = action === 'edit' ? api.edit('A', 'create', id(1), 0, {}) : api.link('A', 'taskA', { projectId: 'A', id: id(1), latestRevision: 1 } as any, 'attach', 0)
    generation++; resolve({ data: { revision: 1 }, error: null })
    await assert.rejects(pending, /Context changed/); assert.equal(reads, 0)
  }
})
