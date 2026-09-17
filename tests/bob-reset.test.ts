import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000011'
const two = '00000000-0000-0000-0000-000000000012'
const guest = '00000000-0000-0000-0000-000000000013'
const evidence = { kind: 'ai_assessment', sources: [], partial: false }
async function as(uid: string | null, role: string, sql: string, params: unknown[] = []) {
  assert(['authenticated', 'anon', 'service_role'].includes(role))
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec(`set local role ${role}`)
    return tx.query(sql, params)
  })
}
async function claim(project = 'A', user = one) {
  const turn = randomUUID()
  const result = await as(null, 'service_role', 'select bob.bob_claim_turn($1,$2,$3,$4) as data', [project, user, turn, 'Fixture question'])
  return { ...(result.rows[0] as any).data, turn, project, user }
}
async function commit(c: any) {
  return as(null, 'service_role', 'select bob.bob_commit_turn($1,$2,$3,$4,$5,$6,$7)', [c.project, c.user, c.thread_id, c.turn, 'Fixture answer', JSON.stringify(evidence), 'resp_fixture'])
}
async function snapshot(project = 'A', user = one) {
  const rows = (await as(user, 'authenticated', "select id,next_seq from bob.bob_threads where project_id=$1 and status='active'", [project])).rows
  return rows[0] as { id: string; next_seq: number } | undefined
}
async function reset(project = 'A', user = one, expected?: { id: string; next_seq: number }) {
  const s = expected ?? await snapshot(project, user)
  const result = await as(user, 'authenticated', 'select bob.bob_reset_conversation($1,$2,$3) as data', [project, s?.id ?? null, s?.next_seq ?? null])
  return (result.rows[0] as any).data
}
async function count(table: string, thread: string) {
  assert(['bob.bob_messages', 'bob_private.bob_thread_provider_state'].includes(table))
  return (await pg.query(`select count(*)::int as n from ${table} where thread_id=$1`, [thread])).rows[0].n
}

before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon,authenticated;
    insert into auth.users values ('${one}','one@example.test',now()),('${two}','two@example.test',now()),('${guest}','guest@bob.local',now());
  `)
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter(f => f.endsWith('_project_scope_and_bounded_lookup.sql') || f.includes('ask_bob_conversation_')).sort()) await pg.exec(await readFile(new URL(file, migrations), 'utf8'))
  await pg.exec(`
    insert into bob.projects(id,slug,name) values('A','a','Keep Project A'),('B','b','Keep Project B'),('C','c','No access');
    insert into bob.people(id,project_id,name,initials,auth_user_id) values
      ('oneA','A','One','ON','${one}'),('oneB','B','One','ON','${one}'),('twoA','A','Two','TW','${two}'),('guestA','A','Guest','GU','${guest}');
    insert into bob.materials(id,project_id,name,qty) values('keep','A','Keep these boards','12 pieces');
  `)
})
beforeEach(async () => { await pg.exec('truncate bob.bob_threads cascade') })
after(() => pg.close())

test('reset atomically removes own transcript and cursor, not project records or other conversations', async () => {
  const own = await claim(); await commit(own)
  const other = await claim('A', two); await commit(other)
  const anotherProject = await claim('B'); await commit(anotherProject)
  assert.deepEqual(await reset(), { status: 'cleared', mode: 'server', projectId: 'A' })
  assert.equal(await snapshot(), undefined)
  assert.equal(await count('bob.bob_messages', own.thread_id), 0)
  assert.equal(await count('bob_private.bob_thread_provider_state', own.thread_id), 0)
  assert.equal(await count('bob.bob_messages', other.thread_id), 2)
  assert.equal(await count('bob.bob_messages', anotherProject.thread_id), 2)
  assert.equal((await pg.query("select name from bob.projects where id='A'")).rows[0].name, 'Keep Project A')
  assert.equal((await pg.query("select qty from bob.materials where id='keep'")).rows[0].qty, '12 pieces')
  const fresh = await claim()
  assert.notEqual(fresh.thread_id, own.thread_id)
  assert.equal(fresh.previous_response_id, null, 'next real claim has no old provider context')
})

test('anonymous, revoked and nonmember callers cannot clear chats or use raw table writes', async () => {
  const c = await claim(); await commit(c)
  await assert.rejects(as(null, 'anon', 'select bob.bob_reset_conversation($1,$2,$3)', ['A', c.thread_id, 3]), /permission denied/)
  await assert.rejects(as(null, 'authenticated', 'select bob.bob_reset_conversation($1,$2,$3)', ['A', c.thread_id, 3]), /project_denied/)
  await assert.rejects(reset('C'), /project_denied/)
  await assert.rejects(as(one, 'authenticated', "delete from bob.bob_threads where project_id='A'"), /permission denied/)
  await assert.rejects(as(one, 'authenticated', 'select * from bob_private.bob_thread_provider_state'), /permission denied/)
  await pg.query("update bob.people set auth_user_id=null where id='oneA'")
  try { await assert.rejects(reset('A', one, { id: c.thread_id, next_seq: 3 }), /project_denied/) }
  finally { await pg.query("update bob.people set auth_user_id=$1 where id='oneA'", [one]) }
  assert.equal(await count('bob.bob_messages', c.thread_id), 2)
})

test('a forged thread cannot clear another member, and stale revisions cannot clear new work', async () => {
  const own = await claim(); await commit(own)
  const other = await claim('A', two); await commit(other)
  await assert.rejects(reset('A', one, { id: other.thread_id, next_seq: 3 }), /conversation_changed/)
  const old = (await snapshot())!
  const next = await claim(); await commit(next)
  await assert.rejects(reset('A', one, old), /conversation_changed/)
  assert.equal(await count('bob.bob_messages', own.thread_id), 4)
  assert.equal(await count('bob.bob_messages', other.thread_id), 2)
})

test('an active answer blocks reset without clearing anything; reset works after completion', async () => {
  const c = await claim()
  await assert.rejects(reset(), /turn_in_flight/)
  assert.equal(await count('bob.bob_messages', c.thread_id), 1)
  await commit(c)
  await reset()
  assert.equal(await snapshot(), undefined)
})

test('empty reset and same-thread retry are safe, but a retry cannot delete a newer thread', async () => {
  assert.equal((await reset()).status, 'cleared')
  const c = await claim(); await commit(c)
  const old = (await snapshot())!
  await reset('A', one, old)
  await reset('A', one, old)
  const next = await claim(); await commit(next)
  await assert.rejects(reset('A', one, old), /conversation_changed/)
  assert.equal((await snapshot())!.id, next.thread_id)
})

test('expired locks can be cleared and late provider commits cannot resurrect the old thread', async () => {
  const c = await claim()
  await pg.query("update bob_private.bob_thread_provider_state set lock_started_at=now()-interval '6 minutes' where thread_id=$1", [c.thread_id])
  await reset()
  const next = await claim()
  await assert.rejects(commit(c), /project_denied/)
  assert.equal(next.previous_response_id, null)
  assert.equal(await count('bob.bob_messages', next.thread_id), 1)
})

test('shared guest reset stays local and returns no provider state', async () => {
  const c = await claim(); await commit(c)
  assert.deepEqual(await reset('A', guest, { id: c.thread_id, next_seq: 3 }), { status: 'cleared', mode: 'local', projectId: 'A' })
  assert.equal(await count('bob.bob_messages', c.thread_id), 2)
  assert.equal(await snapshot('A', guest), undefined)
})
