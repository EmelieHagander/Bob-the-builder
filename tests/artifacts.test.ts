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

async function fact(project: string, uid: string, action: string, record: string, expected: number, data: Record<string, unknown>) {
  return (await as(uid, 'select bob.evidence_command($1,$2,$3,$4,$5,$6) as data',
    [project, 'measurement', action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
async function solution(project: string, uid: string, action: string, record: string | null, expected: number, data: Record<string, unknown>) {
  return (await as(uid, 'select bob.solution_command($1,$2,$3,$4,$5) as data',
    [project, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
async function artifact(project: string, uid: string, action: string, record: string, expected: number, data: Record<string, unknown> = {}) {
  return (await as(uid, 'select bob.artifact_command($1,$2,$3,$4,$5) as data',
    [project, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}

const measurement = (extra: Record<string, unknown> = {}) => ({
  subject: 'Opening width', unit: 'mm', value: '1250', truth: 'measured', source: 'Tape measure', required: true, ...extra,
})
const proposal = (extra: Record<string, unknown> = {}) => ({
  title: 'Keep the porch', description: 'Reuse the footprint.', assumptions: 'Foundation still to inspect', tradeoffs: 'Less floor area', ...extra,
})
const drawing = (targetRevision: number, extra: Record<string, unknown> = {}) => ({
  title: 'Entrance section', description: 'Section through the new insulated entrance floor.', kind: 'section', status: 'measured',
  assumptions: 'Ground moisture condition still to inspect.', source_media_id: null, measurements: [], target_revision: targetRevision, ...extra,
})

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
  for (const [i, uid] of [one, two, both, outsider].entries()) {
    await pg.query('insert into auth.users values($1,$2,now())', [uid, 'artifact' + i + '@example.test'])
  }
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  }
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Porch A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)", [one, two])
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, dir), 'utf8'))
  }
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1)", [both])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','entry','Entry'),('areaB','B','private','Private')")
})
after(() => pg.close())

test('drawing pins exact target and measurement revisions while later project truth changes', async () => {
  await fact('A', one, 'create', id(90), 0, measurement())
  await solution('A', one, 'create', id(1), 0, proposal({ area_id: 'areaA' }))
  await solution('A', one, 'select', id(1), 0, { solution_revision: 1, reason: 'Chosen footprint' })
  await artifact('A', one, 'create', id(10), 0, drawing(1, { area_id: 'areaA', measurements: [{ id: id(90), revision: 1 }] }))

  await fact('A', one, 'revise', id(90), 1, measurement({ value: '1260', change_note: 'Measured again' }))
  await solution('A', one, 'revise', id(1), 1, proposal({ description: 'Newer candidate', change_note: 'Explore changed sill' }))

  const current = (await as(one, 'select * from bob.current_artifacts where id=$1', [id(10)])).rows[0] as any
  assert.equal(current.target_revision, 1)
  assert.equal(current.solution_revision, 1)
  assert.equal(current.solution_title, 'Keep the porch')
  const refs = (await as(one, 'select * from bob.artifact_measurement_details where artifact_id=$1', [id(10)])).rows as any[]
  assert.equal(refs[0].value, '1250')
  assert.equal(refs[0].measurement_revision, 1)
  assert.equal(refs[0].latest_revision, 2)
})

test('target changes reject an open editor and the next revision pins the newly selected exact solution version', async () => {
  await solution('A', one, 'select', id(1), 1, { solution_revision: 2, reason: 'Use the revised sill' })
  await assert.rejects(
    artifact('A', one, 'revise', id(10), 1, { ...drawing(1), change_note: 'Stale target save' }),
    /Project target changed/,
  )
  await artifact('A', one, 'revise', id(10), 1, { ...drawing(2, { description: 'Section updated for revised sill.', measurements: [{ id: id(90), revision: 2 }] }), change_note: 'Align with selected target' })
  const rows = (await as(one, 'select target_revision,solution_revision,description from bob.artifact_revisions where artifact_id=$1 order by revision', [id(10)])).rows as any[]
  assert.deepEqual(rows.map(row => row.target_revision), [1, 2])
  assert.deepEqual(rows.map(row => row.solution_revision), [1, 2])
  assert.equal(rows[0].description, 'Section through the new insulated entrance floor.')
})

test('membership and guarded relations prevent cross-project reads, writes and evidence links', async () => {
  for (const table of ['artifacts','artifact_revisions','artifact_measurements','current_artifacts','artifact_measurement_details']) {
    assert.equal((await as(outsider, 'select * from bob.' + table)).rows.length, 0)
    await assert.rejects(as(null, 'select * from bob.' + table, [], 'anon'), /permission denied/)
  }
  await assert.rejects(artifact('A', outsider, 'create', id(11), 0, drawing(2)), /project_denied/)
  await fact('B', two, 'create', id(91), 0, measurement({ subject: 'Private width' }))
  await solution('B', two, 'create', id(2), 0, proposal({ title: 'Private target', area_id: 'areaB' }))
  await solution('B', two, 'select', id(2), 0, { solution_revision: 1, reason: 'Private choice' })
  await assert.rejects(artifact('A', both, 'create', id(12), 0, drawing(2, { area_id: 'areaB' })), /project_denied/)
  await assert.rejects(artifact('A', both, 'create', id(12), 0, drawing(2, { measurements: [{ id: id(91), revision: 1 }] })), /unavailable in this project/)
  await artifact('B', two, 'create', id(13), 0, drawing(1))
  assert.equal((await as(both, 'select * from bob.current_artifacts')).rows.length, 2)
})

test('raw mutation, stale edits and forged lineage fail; archive and restore keep exact evidence', async () => {
  for (const table of ['artifacts','artifact_revisions','artifact_measurements']) {
    await assert.rejects(as(one, 'delete from bob.' + table), /permission denied/)
  }
  await assert.rejects(artifact('A', one, 'revise', id(10), 1, { ...drawing(2), change_note: 'Old revision' }), /Drawing changed/)
  await assert.rejects(artifact('A', one, 'revise', id(10), 2, { ...drawing(2), solution_id: id(1), change_note: 'Forged parent' }), /Unsupported fields/)

  await artifact('A', one, 'archive', id(10), 2)
  await artifact('A', one, 'restore', id(10), 3)
  const history = (await as(one, 'select revision,target_revision,solution_revision,archived from bob.artifact_revisions where artifact_id=$1 order by revision', [id(10)])).rows as any[]
  assert.deepEqual(history.map(row => row.archived), [false, false, true, false])
  assert.deepEqual(history.map(row => row.target_revision), [1, 2, 2, 2])
  const refs = (await as(one, 'select artifact_revision,measurement_revision from bob.artifact_measurements where artifact_id=$1 order by artifact_revision', [id(10)])).rows as any[]
  assert.deepEqual(refs.map(row => row.measurement_revision), [1, 2, 2, 2])
})

test('area deletion keeps project drawings, project deletion cascades, and data adapter rejects delayed project change', async () => {
  await pg.exec("delete from bob.areas where id='areaA'")
  assert.equal((await as(one, 'select area_id from bob.current_artifacts where id=$1', [id(10)])).rows[0].area_id, null)

  let generation = 0
  let queryResolve: ((value: any) => void) | undefined
  const fake = {
    from() {
      const chain: any = {
        select: () => chain, eq: () => chain, order: () => chain,
        range: () => new Promise(resolve => { queryResolve = resolve }),
      }
      return chain
    },
  }
  const adapter = createArtifacts(fake as any, () => {
    const captured = generation
    return () => { if (captured !== generation) throw new Error('Project or sign-in changed. Reopen the project before continuing.') }
  })
  const delayed = adapter.list('A')
  generation++
  queryResolve?.({ data: [], error: null })
  await assert.rejects(delayed, /Project or sign-in changed/)

  await pg.exec("delete from bob.projects where id='A'")
  for (const table of ['artifacts','artifact_revisions','artifact_measurements']) {
    assert.equal((await pg.query('select * from bob.' + table + " where project_id='A'")).rows.length, 0)
  }
  assert.equal((await as(two, 'select * from bob.current_artifacts')).rows.length, 1)
})
