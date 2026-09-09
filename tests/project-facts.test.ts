import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { parseLength, createProjectFacts } from '../src/data/projectFacts'

const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const outsider = '00000000-0000-0000-0000-000000000004'
const id = (n: number) => '20000000-0000-0000-0000-' + String(n).padStart(12, '0')
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function command(kind: string, action: string, record: string, expected: number | null, data = {}, uid: string | null = one, project = 'A') {
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



test('manual length parsing preserves decimal input without converting uncertainty', () => {
  assert.equal(parseLength(' 1,254 '), '1.254')
  assert.equal(parseLength('0'), '0')
  for (const invalid of ['', '-1', '1,2.3', '1.0001', 'NaN', 'Infinity', '1e3', '1000001']) assert.throws(() => parseLength(invalid))
})

test('unknown → estimate → measured preserves numeric units, source history and actor; stale edits cannot win', async () => {
  await command('measurement', 'create', id(1), 0, length({ area_id: 'areaA' }))
  assert.equal((await current('measurement', id(1))).value, null)
  await command('measurement', 'revise', id(1), 1, length({
    value: '1.250', unit: 'm', truth: 'estimated', source: 'Rough site estimate', change_note: 'Initial estimate',
  }))
  assert.equal((await current('measurement', id(1))).millimetres, '1250.000')
  await command('measurement', 'revise', id(1), 2, length({
    value: '1254', truth: 'measured', source: 'Tape measured between opening faces', change_note: 'Measured on site',
  }))
  const head = await current('measurement', id(1))
  assert.equal(head.value, '1254'); assert.equal(head.truth, 'measured'); assert.equal(head.revision, 3)
  assert.equal(head.recorded_by, one); assert.equal(head.actor_label, 'One')
  const history = (await as(one, 'select truth,value,unit,source,revision from bob.measurement_revisions where measurement_id=$1 order by revision', [id(1)])).rows
  assert.deepEqual(history.map(r => r.truth), ['unknown', 'estimated', 'measured'])
  assert.equal(history[1].source, 'Rough site estimate'); assert.equal(history[1].unit, 'm')
  await assert.rejects(command('measurement', 'revise', id(1), 2, length({ change_note: 'Stale' })), /Record changed/)
  assert.equal((await current('measurement', id(1))).revision, 3)
  await assert.rejects(command('measurement', 'revise', id(1), null, length()), /Record changed/)
  await assert.rejects(command('measurement', 'create', id(1), 0, length()), /already exists/)
})

test('current views and history enforce membership; raw history and actor/parent edits are denied', async () => {
  for (const uid of [two, outsider]) {
    assert.equal((await as(uid, 'select * from bob.current_measurements')).rows.length, 0)
    assert.equal((await as(uid, 'select * from bob.measurement_revisions')).rows.length, 0)
    await assert.rejects(command('measurement', 'create', id(9), 0, length(), uid), /project_denied/)
  }
  await assert.rejects(as(null, 'select * from bob.current_measurements', [], 'anon'), /permission denied/)
  await assert.rejects(command('measurement', 'create', id(9), 0, length(), null), /project_denied/)
  assert.equal((await as(both, 'select * from bob.current_measurements')).rows.length, 1)
  for (const sql of [
    'delete from bob.measurement_revisions', 'update bob.measurements set current_revision=1',
    "update bob.measurement_revisions set truth='measured'", 'delete from bob.measurements',
    "update bob.current_measurements set truth='measured'",
  ]) await assert.rejects(as(one, sql), /permission denied|cannot update view/)
  for (const extra of [{ recorded_by: two }, { actor_label: 'Fake verifier' }, { area_id: 'areaB' }, { project_id: 'B' }]) {
    await assert.rejects(command('measurement', 'revise', id(1), 3, length({ ...extra, change_note: 'Spoof' })), /Unsupported fields/)
  }
})

test('same-project area/component/image relations hold even for a member of both projects', async () => {
  await command('component', 'create', id(20), 0, part({ area_id: 'areaA', quantity: '2' }))
  await command('component', 'create', id(21), 0, part({ area_id: 'areaB' }), two, 'B')
  await assert.rejects(command('measurement', 'create', id(2), 0, length({ area_id: 'areaB' }), both), /project_denied/)
  await assert.rejects(command('measurement', 'create', id(2), 0, length({ component_id: id(21) }), both), /project_denied/)
  await assert.rejects(command('measurement', 'create', id(2), 0, length({ component_id: id(20), area_id: null })), /component area/)
  await pg.query("insert into bob.media_assets(id,project_id,original_name,title,purpose,content_type,byte_size,width,height,created_by,state) values($1,'A','source.png','Opening source','reference','image/png',70,1,1,$3,'ready'),($2,'B','other.png','Private source','reference','image/png',70,1,1,$3,'ready')", [id(50), id(51), both])
  await assert.rejects(command('measurement', 'create', id(2), 0, length({ source_media_id: id(51) }), both), /Source image unavailable/)
  await assert.rejects(command('component', 'create', id(22), 0, part({ source_media_id: id(51) }), both), /Source image unavailable/)
  await command('measurement', 'create', id(2), 0, length({
    component_id: id(20), source_media_id: id(50), value: '120', unit: 'cm', truth: 'provided_spec', source: 'Window label',
  }))
  const measurement = await current('measurement', id(2))
  assert.equal(measurement.area_id, 'areaA'); assert.equal(measurement.component_id, id(20))
  assert.equal(measurement.source_media_title, 'Opening source'); assert.equal(measurement.millimetres, '1200')
  assert.equal((await as(two, 'select * from bob.current_components')).rows.length, 1)
})

test('numeric, uncertainty and full-snapshot validation rejects invalid records atomically', async () => {
  for (const bad of [
    { value: 0 }, { truth: 'measured' }, { value: 1, truth: 'measured', source: ' ' },
    { value: -1, truth: 'estimated', source: 'Estimate' }, { value: 'NaN', truth: 'estimated', source: 'Estimate' },
    { value: '1.0001', truth: 'measured', source: 'Tape' }, { unit: 'ft' },
    { truth: 'ai_assessment' }, { subject: '' },
  ]) await assert.rejects(command('measurement', 'create', id(8), 0, length(bad)), /check constraint|not-null constraint/)
  assert.equal((await as(one, 'select * from bob.measurements where id=$1', [id(8)])).rows.length, 0)
  for (const bad of [{ quantity: 0 }, { quantity: '1.5' }, { quantity: 100001 }, { intent: 'certified' }]) {
    await assert.rejects(command('component', 'create', id(23), 0, part(bad)), /check constraint|invalid input/)
  }
  await assert.rejects(command('measurement', 'revise', id(1), 3, length()), /not-null constraint/)
  assert.equal((await current('measurement', id(1))).revision, 3)
  await assert.rejects(command('component', 'create', id(23), 0, [] as any), /Invalid project fact command/)
  await assert.rejects(command('other', 'create', id(23), 0, {}), /Invalid project fact command/)
})

test('component observations and archive/restore have history; dimensions retain independent state', async () => {
  await command('component', 'revise', id(20), 1, part({
    quantity: '2', condition: 'Paint worn; joints not inspected', specification: 'Manufacturer label recorded separately',
    intent: 'reuse', notes: 'Store indoors', source_media_id: id(50), change_note: 'Recorded current observations',
  }))
  assert.equal((await current('component', id(20))).intent, 'reuse')
  await command('component', 'archive', id(20), 2)
  assert.equal((await current('component', id(20))).archived, true)
  assert.equal((await current('measurement', id(2))).archived, false)
  await assert.rejects(command('measurement', 'create', id(3), 0, length({ component_id: id(20) })), /Restore the component/)
  await assert.rejects(command('component', 'revise', id(20), 3, part({ change_note: 'Archived edit' })), /Restore this record/)
  await command('component', 'restore', id(20), 3)
  const restored = await current('component', id(20))
  assert.equal(restored.quantity, 2); assert.equal(restored.archived, false)
  assert.equal(restored.condition, 'Paint worn; joints not inspected'); assert.equal(restored.notes, 'Store indoors')
  const revisions = (await as(one, 'select archived,change_note from bob.component_revisions where component_id=$1 order by revision', [id(20)])).rows
  assert.deepEqual(revisions.map(r => r.archived), [false, false, true, false])
  await command('measurement', 'archive', id(2), 1)
  await command('measurement', 'restore', id(2), 2)
  assert.equal((await current('measurement', id(2))).truth, 'provided_spec')
})

test('source deletion preserves provenance; area deletion preserves facts; revocation and project cleanup apply', async () => {
  await as(one, "select bob.media_command('A','begin_delete',$1,'{}')", [id(50)])
  await as(one, "select bob.media_command('A','finish_delete',$1,'{}')", [id(50)])
  const row = await current('measurement', id(2))
  assert.equal(row.source_media_id, null); assert.equal(row.source_media_title, 'Opening source')
  assert.equal(row.source, 'Window label'); assert.equal(row.value, '120')
  assert.equal((await current('component', id(20))).source_media_id, null)
  await pg.exec("delete from bob.areas where id='areaA'")
  assert.equal((await current('measurement', id(2))).area_id, null)
  assert.equal((await current('component', id(20))).area_id, null)
  await pg.exec("delete from bob.people where id='oneA'")
  assert.equal((await as(one, 'select * from bob.current_measurements')).rows.length, 0)
  assert.equal((await as(one, 'select * from bob.component_revisions')).rows.length, 0)
  await assert.rejects(command('measurement', 'restore', id(2), 3), /project_denied/)
  await pg.exec("delete from bob.projects where id='A'")
  assert.equal((await pg.query("select * from bob.measurement_revisions where project_id='A'")).rows.length, 0)
  assert.equal((await pg.query("select * from bob.component_revisions where project_id='A'")).rows.length, 0)
  assert.equal((await pg.query("select * from bob.current_components where project_id='B'")).rows.length, 1)
})

test('a project switch during a fact write rejects its delayed result before reading into the new project', async () => {
  let version = 1, resolve!: (value: any) => void, reads = 0
  const pending = new Promise(r => { resolve = r })
  const client = { rpc: () => pending, from: () => { reads++; throw new Error('Must not read after switch') } } as any
  const facts = createProjectFacts(client, () => { const captured = version; return () => {
    if (captured !== version) throw new Error('Project changed')
  } })
  const writing = facts.command('A', 'measurement', 'create', id(70), 0, length())
  version++
  resolve({ data: { id: id(70), revision: 1 }, error: null })
  await assert.rejects(writing, /Project changed/)
  assert.equal(reads, 0)
})
