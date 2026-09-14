import { setupSharedSocial } from './support/shared-social.ts'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const pg = new PGlite()
const ownerA = '00000000-0000-0000-0000-000000000101'
const ownerB = '00000000-0000-0000-0000-000000000102'
const outsider = '00000000-0000-0000-0000-000000000103'
const solutionId = (n: number) => `91000000-0000-0000-0000-${String(n).padStart(12, '0')}`

async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}

async function phase(uid: string, project: string, scope: 'project' | 'area', area: string | null, next: string, reason: string) {
  return (await as(uid, 'select bob.phase_command($1,$2,$3,$4,$5) data', [project, scope, area, next, reason])).rows[0].data as any
}

async function solution(uid: string, project: string, action: string, id: string | null, expected: number, data: Record<string, unknown>) {
  return (await as(uid, 'select bob.solution_command($1,$2,$3,$4,$5) data', [project, action, id, expected, JSON.stringify(data)])).rows[0].data as any
}

const proposal = (title: string, areaId?: string) => ({
  title,
  description: `${title} description`,
  assumptions: '',
  tradeoffs: '',
  ...(areaId ? { area_id: areaId } : {}),
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
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())', [
    ownerA, 'a@example.test', ownerB, 'b@example.test', outsider, 'x@example.test',
  ])

  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  }
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Project A'),('B','b','Project B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('a-owner','A','Alice','AL',$1),('b-owner','B','Bob','BO',$2)", [ownerA, ownerB])
  await setupSharedSocial(pg)

  const supabase = new URL('../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(supabase)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, supabase), 'utf8'))
  }
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('a1','A','bedroom','Bedroom'),('a2','A','guestroom','Guestroom'),('b1','B','private','Private')")
})

after(() => pg.close())

test('legacy work stays unclassified while new projects start in Concept', async () => {
  assert.equal((await as(ownerA, "select phase from bob.projects where id='A'")).rows[0].phase, null)
  assert.equal((await as(ownerA, "select phase from bob.areas where id='a1'")).rows[0].phase, null)

  const created = (await as(ownerA, "select bob.create_project('{\"name\":\"Fresh project\"}'::jsonb) data")).rows[0].data as any
  assert.equal(created.phase, 'concept')
  const history = (await as(ownerA, 'select scope_kind,to_phase,reason from bob.phase_history where project_id=$1', [created.id])).rows as any[]
  assert.deepEqual(history.map(row => [row.scope_kind, row.to_phase, row.reason]), [['project', 'concept', 'Project created']])
})

test('Project and Area phases are explicit, reversible and isolated', async () => {
  await phase(ownerA, 'A', 'project', null, 'build', 'Existing project is already underway')
  await phase(ownerA, 'A', 'area', 'a1', 'complete', 'Bedroom finished and checked')
  await phase(ownerA, 'A', 'area', 'a2', 'design', 'Guestroom still needs a design decision')

  const rows = (await as(ownerA, "select id,phase from bob.areas where project_id='A' order by id")).rows as any[]
  assert.deepEqual(rows.map(row => [row.id, row.phase]), [['a1', 'complete'], ['a2', 'design']])
  assert.equal((await as(ownerA, "select phase from bob.projects where id='A'")).rows[0].phase, 'build')

  await phase(ownerA, 'A', 'area', 'a2', 'planning', 'Design selected; planning can start')
  await phase(ownerA, 'A', 'area', 'a2', 'design', 'New evidence requires design review')
  assert.equal((await as(ownerA, "select phase from bob.areas where id='a2'")).rows[0].phase, 'design')

  await assert.rejects(phase(ownerB, 'A', 'area', 'a1', 'build', 'Cross-project attempt'), /project_denied/)
  await assert.rejects(phase(outsider, 'A', 'project', null, 'planning', 'No membership'), /project_denied/)
})

test('Project completion refuses unfinished or unclassified Areas', async () => {
  await assert.rejects(phase(ownerA, 'A', 'project', null, 'complete', 'Close project'), /Complete or explicitly defer every Area/)
  await phase(ownerA, 'A', 'area', 'a2', 'complete', 'Guestroom scope completed')
  await phase(ownerA, 'A', 'project', null, 'complete', 'All active Areas are complete')
  assert.equal((await as(ownerA, "select phase from bob.projects where id='A'")).rows[0].phase, 'complete')
})

test('Area targets override Project target without changing sibling effective target', async () => {
  await solution(ownerA, 'A', 'create', solutionId(1), 0, proposal('Project direction'))
  await solution(ownerA, 'A', 'create', solutionId(2), 0, proposal('Bedroom option', 'a1'))
  await solution(ownerA, 'A', 'create', solutionId(3), 0, proposal('Bedroom option B', 'a1'))
  await solution(ownerA, 'A', 'create', solutionId(4), 0, proposal('Guestroom option', 'a2'))

  const projectTarget = await solution(ownerA, 'A', 'select', solutionId(1), 0, {
    solution_revision: 1, reason: 'Shared project direction', area_id: null,
  })
  const bedroomTarget = await solution(ownerA, 'A', 'select', solutionId(2), 0, {
    solution_revision: 1, reason: 'Bedroom selected option', area_id: 'a1',
  })
  assert.notEqual(projectTarget.revision, bedroomTarget.revision)

  const effectiveBedroom = (await as(ownerA, "select bob_private.effective_target_revision('A','a1') revision")).rows[0].revision
  const effectiveGuestroom = (await as(ownerA, "select bob_private.effective_target_revision('A','a2') revision")).rows[0].revision
  assert.equal(effectiveBedroom, bedroomTarget.revision)
  assert.equal(effectiveGuestroom, projectTarget.revision)

  const bedroomTarget2 = await solution(ownerA, 'A', 'select', solutionId(3), bedroomTarget.revision, {
    solution_revision: 1, reason: 'Bedroom design changed', area_id: 'a1',
  })
  assert.equal((await as(ownerA, "select bob_private.effective_target_revision('A','a1') revision")).rows[0].revision, bedroomTarget2.revision)
  assert.equal((await as(ownerA, "select bob_private.effective_target_revision('A','a2') revision")).rows[0].revision, projectTarget.revision)

  await assert.rejects(solution(ownerA, 'A', 'select', solutionId(4), bedroomTarget2.revision, {
    solution_revision: 1, reason: 'Wrong Area', area_id: 'a1',
  }), /same Project\/Area scope/)

  const pointers = (await as(ownerA, "select scope_key,current_revision from bob.project_targets where project_id='A' order by scope_key")).rows as any[]
  assert.deepEqual(pointers.map(row => row.scope_key), ['area:a1', 'project'])
})
