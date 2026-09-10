import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createSolutions } from '../src/data/solutions'

const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const outsider = '00000000-0000-0000-0000-000000000004'
const id = (n: number) => '30000000-0000-0000-0000-' + String(n).padStart(12, '0')
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

async function command(action: string, record: string | null, expected: number | null, data = {}, uid: string | null = one, project = 'A') {
  return (await as(uid, 'select bob.solution_command($1,$2,$3,$4,$5) as data', [project, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
const proposal = (extra = {}) => ({ title: 'Keep the porch', description: 'Reuse the existing footprint.', assumptions: 'Foundation condition unknown', tradeoffs: 'Less space', ...extra })
const select = (s: number, version: number, expected: number) => command('select', id(s), expected, { solution_revision: version, reason: 'Deliberate project choice' })

test('alternatives coexist; target and measurement evidence pin exact revisions after later edits', async () => {
  await fact('measurement', 'create', id(90), 0, length({ value: '1.250', unit: 'm', truth: 'estimated', source: 'Rough estimate' }))
  await command('create', id(1), 0, proposal({ area_id: 'areaA', measurements: [{ id: id(90), revision: 1 }] }))
  await command('create', id(2), 0, proposal({ title: 'Extend the porch' }))
  await select(1, 1, 0)
  await command('revise', id(1), 1, proposal({ description: 'A newer idea', measurements: [{ id: id(90), revision: 1 }], change_note: 'Review the layout' }))
  await fact('measurement', 'revise', id(90), 1, length({ value: '1254', truth: 'measured', source: 'Tape', change_note: 'Site measurement' }))
  const target = (await as(one, 'select * from bob.current_target')).rows[0] as any
  assert.equal(target.solution_revision, 1); assert.equal(target.solution_id, id(1)); assert.equal(target.recorded_by, one)
  assert.equal((await as(one, 'select * from bob.current_solutions')).rows.length, 2)
  const refs = (await as(one, 'select * from bob.solution_measurement_details where solution_revision=1')).rows as any[]
  assert.equal(refs[0].value, '1.250'); assert.equal(refs[0].truth, 'estimated'); assert.equal(refs[0].latest_revision, 2)
  assert.equal((await as(one, 'select description from bob.solution_revisions where solution_id=$1 and revision=1', [id(1)])).rows[0].description, 'Reuse the existing footprint.')
})

test('stale alternative/target decisions fail atomically; clear and replacement keep the decision trail', async () => {
  await assert.rejects(select(1, 1, 1), /Solution changed/)
  await assert.rejects(select(2, 1, 0), /Target changed/)
  await assert.rejects(command('revise', id(1), 1, proposal({ change_note: 'Old edit' })), /Solution changed/)
  await select(2, 1, 1)
  await command('clear', null, 2, { reason: 'Need more evidence' })
  assert.equal((await as(one, 'select solution_id from bob.current_target')).rows[0].solution_id, null)
  const trail = (await as(one, 'select solution_id,solution_revision from bob.target_revisions order by revision')).rows
  assert.deepEqual(trail.map(r => r.solution_id), [id(1), id(2), null])
  await assert.rejects(command('clear', null, 3, { reason: 'Again' }), /no selected/)
  await assert.rejects(command('select', id(2), null, { solution_revision: 1, reason: 'Unknown version' }), /Target changed/)
})

test('membership governs every view and history; dual membership cannot connect foreign evidence', async () => {
  for (const table of ['solutions','solution_revisions','solution_measurements','project_targets','target_revisions','current_solutions','current_target','solution_measurement_details']) {
    assert.equal((await as(outsider, 'select * from bob.' + table)).rows.length, 0)
    await assert.rejects(as(null, 'select * from bob.' + table, [], 'anon'), /permission denied/)
  }
  await assert.rejects(command('create', id(3), 0, proposal(), outsider), /project_denied/)
  await assert.rejects(command('create', id(3), 0, proposal(), null), /project_denied/)
  await fact('measurement', 'create', id(91), 0, length(), two, 'B')
  await assert.rejects(command('create', id(3), 0, proposal({ area_id: 'areaB' }), both), /project_denied/)
  await assert.rejects(command('create', id(3), 0, proposal({ measurements: [{ id: id(91), revision: 1 }] }), both), /unavailable in this project/)
  await command('create', id(4), 0, proposal(), two, 'B')
  await assert.rejects(command('select', id(4), 3, { solution_revision: 1, reason: 'Foreign alternative' }, both), /unavailable/)
  assert.equal((await as(both, 'select * from bob.current_solutions')).rows.length, 3)
})

test('raw mutation and forged attribution/parents are denied; invalid snapshots roll back without orphan heads', async () => {
  for (const table of ['solutions','solution_revisions','solution_measurements','project_targets','target_revisions']) {
    await assert.rejects(as(one, 'delete from bob.' + table), /permission denied/)
  }
  for (const extra of [{ recorded_by: two }, { area_id: 'areaB' }, { project_id: 'B' }, { revision: 8 }])
    await assert.rejects(command('revise', id(1), 2, proposal({ ...extra, change_note: 'Spoof' })), /Unsupported fields/)
  for (const extra of [{ title: '' }, { measurements: null }, { measurements: [{ id: id(90), revision: 99 }] },
    { measurements: [{ id: id(90), revision: 1 }, { id: id(90), revision: 1 }] }, { measurements: Array(21).fill({ id: id(90), revision: 1 }) }]) {
    await assert.rejects(command('create', id(5), 0, proposal(extra)))
    assert.equal((await as(one, 'select * from bob.solutions where id=$1', [id(5)])).rows.length, 0)
  }
  await assert.rejects(command('create', id(1), 0, proposal()), /already exists/)
  await assert.rejects(command('select', id(2), 3, { solution_revision: 1, reason: '' }))
  assert.equal((await as(one, 'select revision from bob.current_target')).rows[0].revision, 3)
})

test('selected alternatives cannot be archived; archive/restore preserves evidence without changing targets', async () => {
  await select(1, 2, 3)
  await assert.rejects(command('archive', id(1), 2), /clear it before archiving/)
  await select(2, 1, 4)
  await command('archive', id(1), 2)
  await assert.rejects(select(1, 3, 5), /Restore/)
  await command('restore', id(1), 3)
  const refs = (await as(one, 'select measurement_revision from bob.solution_measurements where solution_id=$1 order by solution_revision', [id(1)])).rows
  assert.deepEqual(refs.map(r => r.measurement_revision), [1, 1, 1, 1])
  assert.equal((await as(one, 'select solution_id from bob.current_target')).rows[0].solution_id, id(2))
})

test('reference images require the same project and readiness; file deletion keeps solution and decision history', async () => {
  const reserve = async (project: string, image: string, uid: string) => as(uid, 'select bob.media_command($1,$2,$3,$4)', [project, 'reserve', image, JSON.stringify({ original_name: 'x.png', title: 'Recorded image', purpose: 'proposal', content_type: 'image/png', byte_size: 20, width: 1, height: 1, target_kind: 'project', target_id: project })])
  await reserve('B', id(92), two)
  await assert.rejects(command('create', id(5), 0, proposal({ source_media_id: id(92) }), both), /image unavailable/)
  await reserve('A', id(93), one)
  await assert.rejects(command('create', id(5), 0, proposal({ source_media_id: id(93) })), /image unavailable/)
  await pg.query("insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,'{\"size\":20,\"mimetype\":\"image/png\"}')", ['A/' + id(93)])
  await as(one, "select bob.media_command('A','finalize',$1,'{}')", [id(93)])
  await command('create', id(5), 0, proposal({ source_media_id: id(93) }))
  await select(5, 1, 5)
  await as(one, "select bob.media_command('A','begin_delete',$1,'{}')", [id(93)])
  await as(one, "delete from storage.objects where name=$1", ['A/' + id(93)])
  await as(one, "select bob.media_command('A','finish_delete',$1,'{}')", [id(93)])
  const row = (await as(one, 'select source_media_id,source_media_title from bob.solution_revisions where solution_id=$1', [id(5)])).rows[0]
  assert.equal(row.source_media_id, null); assert.equal(row.source_media_title, 'Recorded image')
  assert.equal((await as(one, 'select count(*)::int n from bob.target_revisions')).rows[0].n, 6)
})

test('area deletion retains project solutions; revoked access and project cascade include selected history', async () => {
  await pg.exec("delete from bob.areas where id='areaA'")
  assert.equal((await as(one, 'select area_id from bob.current_solutions where id=$1', [id(1)])).rows[0].area_id, null)
  await pg.exec("delete from bob.people where id='bothA'")
  await assert.rejects(command('select', id(1), 6, { solution_revision: 4, reason: 'Revoked' }, both), /project_denied/)
  await pg.exec("delete from bob.projects where id='A'")
  for (const table of ['solutions','solution_revisions','solution_measurements','project_targets','target_revisions'])
    assert.equal((await pg.query('select * from bob.' + table + " where project_id='A'")).rows.length, 0)
  assert.equal((await as(two, 'select * from bob.current_solutions')).rows.length, 1)
})

test('project change during a decision rejects its delayed result before any read-back', async () => {
  let resolve: (v: any) => void = () => {}, generation = 0, reads = 0
  const wait = new Promise<any>(r => { resolve = r })
  const client = { rpc: () => wait, from: () => { reads++; throw new Error('Must not read into the new project') } } as any
  const data = createSolutions(client, () => { const g = generation; return () => { if (g !== generation) throw new Error('Project changed') } })
  const pending = data.choose('A', null, 1, 'Clear target')
  generation++; resolve({ data: { revision: 2 }, error: null })
  await assert.rejects(pending, /Project changed/); assert.equal(reads, 0)
})


