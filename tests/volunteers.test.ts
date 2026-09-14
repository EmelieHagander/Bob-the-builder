import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'

const pg = new PGlite()
const owner = '92000000-0000-0000-0000-000000000001'
const outsider = '92000000-0000-0000-0000-000000000002'
const secret = () => randomBytes(32).toString('hex')
async function as(uid: string | null, sql: string, args: unknown[] = []) {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + (uid ? 'authenticated' : 'anon'))
    return tx.query(sql, args)
  })
}
async function rpc(uid: string | null, name: string, args: unknown[] = []): Promise<any> {
  return (await as(uid, `select bob.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) result`, args)).rows[0].result
}
async function fixture(food = false) {
  const project = (await rpc(owner, 'create_project', [JSON.stringify({ name: 'Volunteer project' })])).id
  const invite = secret(), session = secret(), area = 'a_' + randomUUID(), task = 't_' + randomUUID(), event = 'e_' + randomUUID()
  await as(owner, 'insert into bob.areas(id,project_id,slug,name) values($1,$2,$1,$3)', [area, project, 'Garden'])
  await as(owner, 'insert into bob.tasks(id,area_id,name) values($1,$2,$3)', [task, area, 'Paint the bench'])
  await as(owner, 'insert into bob.events(id,project_id,slug,title,food) values($1,$2,$1,$3,$4)', [event, project, 'Build day', food ? 'Lunch together' : ''])
  const link = await rpc(owner, 'create_volunteer_link', [project, 'Weekend crew', invite, 30])
  return { project, invite, session, area, task, event, link }
}

before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;
  `)
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'volunteer-owner@example.test', outsider, 'outsider@example.test'])
  for (const directory of ['../db/migrations/', '../supabase/migrations/']) {
    if (directory.includes('supabase')) await setupSharedSocial(pg)
    const root = new URL(directory, import.meta.url)
    for (const file of (await readdir(root)).filter(file => file.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(file, root), 'utf8'))
  }
})
after(() => pg.close())

test('name-only joining creates one project person and zero Auth accounts or shared-family records', async () => {
  const f = await fixture()
  const beforeUsers = (await pg.query('select count(*) n from auth.users')).rows[0].n
  assert.equal((await rpc(null, 'volunteer_preview', [f.invite])).hasFood, false)
  const state = await rpc(null, 'volunteer_join', [f.invite, f.session, '  Kim  ', null])
  assert.equal(state.person.name, 'Kim'); assert.equal(state.person.allergies, null)
  assert.equal(state.projectId, f.project)
  const retry = await rpc(null, 'volunteer_join', [f.invite, f.session, 'Should not overwrite', null])
  assert.equal(retry.person.id, state.person.id); assert.equal(retry.person.name, 'Kim')
  const person = (await pg.query('select * from bob.people where id=$1', [state.person.id])).rows[0]
  assert.equal(person.auth_user_id, null); assert.equal(person.access_origin, 'derived'); assert.equal(person.diet, '')
  assert.equal((await pg.query('select count(*) n from auth.users')).rows[0].n, beforeUsers)
  assert.equal((await pg.query('select count(*) n from shared.household_access')).rows[0].n, 0)
  const sameName = await rpc(null, 'volunteer_join', [f.invite, secret(), 'Kim', null])
  assert.notEqual(sameName.person.id, state.person.id, 'knowing a name cannot recover another participant')
  assert.equal((await rpc(null, 'volunteer_state', [f.session])).person.id, state.person.id)
  assert.equal((await rpc(owner, 'create_volunteer_link', [f.project, 'Weekend crew', f.invite, 30])).id, f.link.id, 'link creation retry is idempotent')
})

test('allergies are optional, project-local and accepted only when there is food', async () => {
  const f = await fixture()
  await assert.rejects(rpc(null, 'volunteer_join', [f.invite, f.session, 'Kim', 'Peanuts']), /only.*food planned/)
  assert.equal((await pg.query('select count(*) n from bob.volunteer_sessions where link_id=$1', [f.link.id])).rows[0].n, 0)
  await as(owner, 'insert into bob.meals(id,project_id,meal,dish) values($1,$2,$3,$4)', ['meal_' + f.project, f.project, 'Lunch', 'Soup'])
  assert.equal((await rpc(null, 'volunteer_preview', [f.invite])).hasFood, true)
  const a = await rpc(null, 'volunteer_join', [f.invite, f.session, 'Kim', 'Peanuts'])
  const bSecret = secret(), b = await rpc(null, 'volunteer_join', [f.invite, bSecret, 'Sam', null])
  assert.equal(b.person.allergies, null, 'blank is not a declaration of no allergies')
  assert.doesNotMatch(JSON.stringify(b), /Peanuts/)
  assert.equal((await as(owner, 'select diet from bob.people where id=$1', [a.person.id])).rows[0].diet, 'Peanuts')
  const updated = await rpc(null, 'volunteer_profile', [f.session, 'Kim K', 'Sesame', a.person.updatedAt])
  assert.equal(updated.person.allergies, 'Sesame')
  await assert.rejects(rpc(null, 'volunteer_profile', [f.session, 'Old name', 'Milk', a.person.updatedAt]), /profile changed/)
  await as(owner, 'delete from bob.meals where project_id=$1', [f.project])
  const withoutFood = await rpc(null, 'volunteer_state', [f.session])
  assert.equal(withoutFood.hasFood, false); assert.equal(withoutFood.person.allergies, null)
  await assert.rejects(rpc(null, 'volunteer_profile', [f.session, 'Kim K', 'Milk', updated.person.updatedAt]), /only.*food planned/)
  assert.equal((await rpc(null, 'volunteer_state', [bSecret])).person.id, b.person.id)
})

test('guest feeds and mutations cannot cross project or participant boundaries', async () => {
  const a = await fixture(true), b = await fixture()
  const self = await rpc(null, 'volunteer_join', [a.invite, a.session, 'Kim', null])
  const otherSession = secret(), other = await rpc(null, 'volunteer_join', [a.invite, otherSession, 'Sam', 'Shellfish'])
  const tasks = await rpc(null, 'volunteer_feed', [a.session, 'tasks', null, 30])
  assert.deepEqual(tasks.items.map((task: any) => task.id), [a.task])
  assert.doesNotMatch(JSON.stringify(tasks), /Shellfish/)
  await assert.rejects(rpc(null, 'volunteer_task', [a.session, b.task]), /Task unavailable/)
  await assert.rejects(rpc(null, 'volunteer_task_action', [a.session, b.task, 'claim', '{}']), /Task unavailable/)
  await assert.rejects(rpc(null, 'volunteer_rsvp', [a.session, b.event, true]), /Build day unavailable/)
  await assert.rejects(rpc(null, 'volunteer_join', [b.invite, a.session, 'Kim', null]), /unavailable/)
  await rpc(null, 'volunteer_rsvp', [a.session, a.event, true]); await rpc(null, 'volunteer_rsvp', [a.session, a.event, true])
  await rpc(null, 'volunteer_rsvp', [otherSession, a.event, true]); await rpc(null, 'volunteer_rsvp', [a.session, a.event, false])
  assert.deepEqual((await pg.query('select person_id from bob.event_attendees where event_id=$1', [a.event])).rows.map(row => row.person_id), [other.person.id])
  await rpc(null, 'volunteer_task_action', [a.session, a.task, 'claim', '{}'])
  await rpc(null, 'volunteer_task_action', [otherSession, a.task, 'claim', '{}'])
  await rpc(null, 'volunteer_task_action', [a.session, a.task, 'release', '{}'])
  assert.deepEqual((await pg.query('select person_id from bob.task_assignees where task_id=$1', [a.task])).rows.map(row => row.person_id), [other.person.id])
  await assert.rejects(rpc(null, 'volunteer_task_action', [a.session, a.task, 'claim', JSON.stringify({ personId: other.person.id })]), /Invalid task action/)
  assert.notEqual(self.person.id, other.person.id)
})

test('own-task progress keeps required checks, stale-write rejection and distinct volunteer provenance', async () => {
  const f = await fixture(), step = randomUUID()
  await pg.query("insert into bob.task_steps(id,project_id,task_id,title,position,is_checkpoint,required,created_by) values($1,$2,$3,'Check the surface',1,true,true,$4)", [step, f.project, f.task, owner])
  const self = await rpc(null, 'volunteer_join', [f.invite, f.session, 'Kim', null])
  let task = await rpc(null, 'volunteer_task', [f.session, f.task])
  await assert.rejects(rpc(null, 'volunteer_task_action', [f.session, f.task, 'status', JSON.stringify({ status: 'doing', expectedUpdatedAt: task.updatedAt })]), /Join this task/)
  await rpc(null, 'volunteer_task_action', [f.session, f.task, 'claim', '{}'])
  const firstUpdated = task.updatedAt
  task = await rpc(null, 'volunteer_task_action', [f.session, f.task, 'status', JSON.stringify({ status: 'doing', expectedUpdatedAt: firstUpdated })])
  await assert.rejects(rpc(null, 'volunteer_task_action', [f.session, f.task, 'status', JSON.stringify({ status: 'done', expectedUpdatedAt: firstUpdated })]), /Task changed/)
  await assert.rejects(rpc(null, 'volunteer_task_action', [f.session, f.task, 'status', JSON.stringify({ status: 'done', expectedUpdatedAt: task.updatedAt })]), /Complete required checks/)
  task = await rpc(null, 'volunteer_task_action', [f.session, f.task, 'check', JSON.stringify({ stepId: step, revision: 1, completed: true })])
  const audit = (await pg.query('select completed_by,completed_by_volunteer from bob.task_steps where id=$1', [step])).rows[0]
  assert.equal(audit.completed_by, null); assert.equal(audit.completed_by_volunteer, self.person.id)
  await assert.rejects(rpc(null, 'volunteer_task_action', [f.session, f.task, 'check', JSON.stringify({ stepId: step, revision: 1, completed: false })]), /Step changed/)
  task = await rpc(null, 'volunteer_task_action', [f.session, f.task, 'status', JSON.stringify({ status: 'done', expectedUpdatedAt: task.updatedAt })])
  await assert.rejects(rpc(null, 'volunteer_task_action', [f.session, f.task, 'check', JSON.stringify({ stepId: step, revision: 2, completed: false })]), /Reopen the task/)
  await as(owner, "update bob.tasks set status='doing' where id=$1", [f.task])
  await rpc(owner, 'task_steps_command', [f.project, f.task, 'complete', step, JSON.stringify({ revision: 2, completed: false })])
  assert.equal((await pg.query('select completed_by_volunteer from bob.task_steps where id=$1', [step])).rows[0].completed_by_volunteer, null)
  await rpc(owner, 'task_steps_command', [f.project, f.task, 'complete', step, JSON.stringify({ revision: 3, completed: true })])
  assert.equal((await pg.query('select completed_by from bob.task_steps where id=$1', [step])).rows[0].completed_by, owner)
})

test('expired, revoked and removed profiles lose access; one session revoke preserves other volunteers', async () => {
  const f = await fixture()
  const a = await rpc(null, 'volunteer_join', [f.invite, f.session, 'Kim', null]), second = secret()
  const b = await rpc(null, 'volunteer_join', [f.invite, second, 'Sam', null])
  const management = await rpc(owner, 'volunteer_links_state', [f.project])
  assert.doesNotMatch(JSON.stringify(management), /secret_hash|secret|email|allergies/)
  const participant = management.participants.find((p: any) => p.personId === a.person.id)
  await rpc(owner, 'revoke_volunteer_access', [f.project, null, participant.id])
  await assert.rejects(rpc(null, 'volunteer_state', [f.session]), /unavailable/)
  await assert.rejects(rpc(null, 'volunteer_join', [f.invite, f.session, 'Kim', null]), /unavailable/)
  assert.equal((await rpc(null, 'volunteer_state', [second])).person.id, b.person.id)
  await rpc(owner, 'revoke_volunteer_access', [f.project, f.link.id, null])
  await assert.rejects(rpc(null, 'volunteer_state', [second]), /unavailable/)
  await assert.rejects(rpc(null, 'volunteer_join', [f.invite, secret(), 'Next', null]), /unavailable/)
  await assert.rejects(rpc(null, 'volunteer_preview', [f.invite]), /unavailable/)
  const expiry = await fixture()
  await rpc(null, 'volunteer_join', [expiry.invite, expiry.session, 'Kim', null])
  await pg.query("update bob.volunteer_links set expires_at=now()-interval '1 second' where id=$1", [expiry.link.id])
  await assert.rejects(rpc(null, 'volunteer_state', [expiry.session]), /unavailable/)
  const deletion = await fixture(), profile = await rpc(null, 'volunteer_join', [deletion.invite, deletion.session, 'Kim', null])
  await as(owner, 'delete from bob.people where id=$1', [profile.person.id])
  await assert.rejects(rpc(null, 'volunteer_state', [deletion.session]), /unavailable/)
})

test('raw reads, Auth membership, management and internal helpers remain denied to unregistered volunteers', async () => {
  const f = await fixture()
  await rpc(null, 'volunteer_join', [f.invite, f.session, 'Kim', null])
  for (const table of ['projects', 'people', 'account', 'account_notes', 'volunteer_links', 'volunteer_sessions']) {
    await assert.rejects(as(null, 'select * from bob.' + table), /permission denied/)
  }
  await assert.rejects(as(owner, 'select * from bob.volunteer_sessions'), /permission denied/)
  await assert.rejects(as(null, 'select bob_volunteer_private.volunteer_session($1)', [f.session]), /permission denied/)
  await assert.rejects(as(null, 'select bob_private.project_access_for_user($1,$2)', [f.project, owner]), /permission denied/)
  await assert.rejects(rpc(null, 'create_volunteer_link', [f.project, 'Bad', secret(), 30]), /permission denied/)
  await assert.rejects(rpc(outsider, 'create_volunteer_link', [f.project, 'Bad', secret(), 30]), /project_denied/)
  await assert.rejects(rpc(outsider, 'volunteer_links_state', [f.project]), /project_denied/)
  await assert.rejects(rpc(outsider, 'revoke_volunteer_access', [f.project, f.link.id, null]), /project_denied/)
  await assert.rejects(rpc(null, 'join_project', [f.project]), /permission denied/)
  for (const value of ['', 'not-a-secret', secret(), f.invite]) await assert.rejects(rpc(null, 'volunteer_state', [value]), /unavailable/)
  await assert.rejects(rpc(null, 'volunteer_feed', [f.session, 'households', null, 30]), /Unknown volunteer section/)
  await assert.rejects(rpc(null, 'volunteer_feed', [f.session, 'tasks', null, 5000]), /Invalid page/)
})

test('guest pagination is bounded and media access requires a ready image linked to this task or area', async () => {
  const f = await fixture(), other = await fixture()
  for (const id of ['page-a', 'page-b', 'page-c']) await as(owner, 'insert into bob.tasks(id,area_id,name) values($1,$2,$1)', [id, f.area])
  await rpc(null, 'volunteer_join', [f.invite, f.session, 'Kim', null])
  const page1 = await rpc(null, 'volunteer_feed', [f.session, 'tasks', null, 2])
  const page2 = await rpc(null, 'volunteer_feed', [f.session, 'tasks', page1.nextCursor, 2])
  assert.equal(page1.items.length, 2); assert.equal(page2.items.length, 2); assert.equal(page2.nextCursor, null)
  assert.equal(new Set([...page1.items, ...page2.items].map((x: any) => x.id)).size, 4)
  const media = randomUUID()
  await pg.query("insert into bob.media_assets(id,project_id,original_name,title,purpose,content_type,byte_size,width,height,created_by,state) values($1,$2,'photo.png','Bench photo','instruction','image/png',100,10,10,$3,'ready')", [media, f.project, owner])
  await assert.rejects(rpc(null, 'volunteer_media', [f.session, f.task, media]), /Image unavailable/)
  await pg.query('insert into bob.media_links(project_id,media_id,task_id) values($1,$2,$3)', [f.project, media, f.task])
  assert.equal((await rpc(null, 'volunteer_media', [f.session, f.task, media])).path, f.project + '/' + media)
  assert.equal((await rpc(null, 'volunteer_task', [f.session, f.task])).images[0].id, media)
  await assert.rejects(rpc(null, 'volunteer_media', [f.session, other.task, media]), /Image unavailable/)
  await pg.query("update bob.media_assets set state='deleting' where id=$1", [media])
  await assert.rejects(rpc(null, 'volunteer_media', [f.session, f.task, media]), /Image unavailable/)
})
