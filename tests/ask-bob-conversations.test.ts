import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { BOB_SYSTEM_SECTIONS, BOB_TRUTH_RULES, runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createBobHandler } from '../supabase/functions/_shared/bob-request.ts'

const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const guest = '00000000-0000-0000-0000-000000000003'
const turn1 = '11111111-1111-4111-8111-111111111111'
const turn2 = '22222222-2222-4222-8222-222222222222'
const evidence = { kind: 'ai_assessment', sources: [], partial: false }

async function as(uid: string | null, role: 'authenticated' | 'anon' | 'service_role', sql: string, params: unknown[] = []) {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec(`set local role ${role}`)
    return tx.query(sql, params)
  })
}

async function serviceClaim(project: string, user: string, turn: string, message: string) {
  return (await as(null, 'service_role', 'select bob.bob_claim_turn($1,$2,$3,$4) as data', [project,user,turn,message])).rows[0].data as any
}
async function serviceCommit(project: string, user: string, thread: string, turn: string, answer: string, responseId: string) {
  return (await as(null, 'service_role', 'select bob.bob_commit_turn($1,$2,$3,$4,$5,$6,$7) as data', [project,user,thread,turn,answer,JSON.stringify(evidence),responseId])).rows[0].data as any
}
async function serviceFail(project: string, user: string, thread: string, turn: string) {
  return (await as(null, 'service_role', 'select bob.bob_fail_turn($1,$2,$3,$4) as data', [project,user,thread,turn])).rows[0].data as any
}

before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon,authenticated;
    insert into auth.users values
      ('${one}','one@example.test',now()),
      ('${two}','two@example.test',now()),
      ('${guest}','guest@bob.local',now());
  `)
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  }
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  const projectScope = (await readdir(migrations)).find(file => file.endsWith('_project_scope_and_bounded_lookup.sql'))!
  await pg.exec(await readFile(new URL(projectScope, migrations), 'utf8'))
  await pg.exec(`
    insert into bob.projects(id,slug,name) values('A','a','Project A'),('B','b','Project B');
    insert into bob.people(id,project_id,name,initials,auth_user_id) values
      ('oneA','A','One','ON','${one}'),
      ('twoA','A','Two','TW','${two}'),
      ('twoB','B','Two','TW','${two}'),
      ('guestA','A','Guest','GU','${guest}');
  `)
  for (const file of (await readdir(migrations)).filter(file => file.includes('ask_bob_conversation_')).sort()) {
    await pg.exec(await readFile(new URL(file, migrations), 'utf8'))
  }
})
after(() => pg.close())

test('server transcript is private, idempotent and carries only a private provider cursor', async () => {
  const claimed = await serviceClaim('A', one, turn1, 'Remember that we chose the left option.')
  assert.equal(claimed.mode, 'server')
  assert.equal(claimed.status, 'claimed')
  assert.equal(claimed.previous_response_id ?? null, null)
  const thread = claimed.thread_id as string

  const inFlight = await serviceClaim('A', one, turn1, 'Remember that we chose the left option.')
  assert.equal(inFlight.status, 'in_flight')
  await serviceCommit('A', one, thread, turn1, 'I will keep that conversational context.', 'resp_first')

  const own = (await as(one, 'authenticated', 'select role,text,delivery_state from bob.bob_messages order by seq')).rows as any[]
  assert.deepEqual(own.map(row => row.role), ['user','assistant'])
  assert(own.every(row => row.delivery_state === 'completed'))
  assert.equal((await as(two, 'authenticated', 'select id from bob.bob_threads')).rows.length, 0, 'same-project member cannot read another personal thread')
  await assert.rejects(as(one, 'authenticated', 'select * from bob_private.bob_thread_provider_state'), /permission denied/)

  const duplicate = await serviceClaim('A', one, turn1, 'Remember that we chose the left option.')
  assert.equal(duplicate.status, 'completed')
  assert.equal(duplicate.answer, 'I will keep that conversational context.')
  assert.equal((await as(one, 'authenticated', 'select count(*)::int as n from bob.bob_messages')).rows[0].n, 2)

  const second = await serviceClaim('A', one, turn2, 'What did I say we chose?')
  assert.equal(second.previous_response_id, 'resp_first', 'next user turn receives server-private continuation state')
  await serviceCommit('A', one, thread, turn2, 'You said the left option.', 'resp_second')
  assert.equal((await as(one, 'authenticated', 'select count(*)::int as n from bob.bob_messages')).rows[0].n, 4)
})

test('conversation commands are service-only, project-fenced, and shared guest stays local-only', async () => {
  await assert.rejects(as(one, 'authenticated', 'select bob.bob_claim_turn($1,$2,$3,$4)', ['A',one,'33333333-3333-4333-8333-333333333333','No']), /permission denied/)
  await assert.rejects(as(null, 'anon', 'select bob.bob_claim_turn($1,$2,$3,$4)', ['A',one,'33333333-3333-4333-8333-333333333333','No']), /permission denied/)
  await assert.rejects(serviceClaim('B', one, '33333333-3333-4333-8333-333333333333', 'Cross project'), /project_denied/)

  const local = await serviceClaim('A', guest, '44444444-4444-4444-8444-444444444444', 'Guest question')
  assert.deepEqual(local, { mode: 'local_only', status: 'claimed' })
  assert.equal((await as(guest, 'authenticated', 'select count(*)::int as n from bob.bob_threads')).rows[0].n, 0)
})

test('revocation blocks commit but service cleanup can release the exact private turn lock', async () => {
  const turn = '55555555-5555-4555-8555-555555555555'
  const claim = await serviceClaim('A', two, turn, 'Slow question')
  await pg.query("update bob.people set auth_user_id=null where id='twoA'")
  await assert.rejects(serviceCommit('A', two, claim.thread_id, turn, 'Late answer', 'resp_late'), /project_denied/)
  await serviceFail('A', two, claim.thread_id, turn)
  const state = (await pg.query('select previous_response_id,in_flight_turn_id from bob_private.bob_thread_provider_state where thread_id=$1',[claim.thread_id])).rows[0] as any
  assert.equal(state.previous_response_id, null)
  assert.equal(state.in_flight_turn_id, null)
  await pg.query("update bob.people set auth_user_id=$1 where id='twoA'", [two])
})

test('prompt assembly keeps durable persona separate from fresh turn context and continues server cursor', async () => {
  const calls: any[] = []
  const lookup = createProjectLookup('A', async (_projectId, input) => ({
    data: { records: input.dataset === 'project' ? [{ id: 'A', name: 'Project A' }] : [], related: [], truncated: false },
    error: null,
  }))
  const result = await runProjectAnswer({
    projectId: 'A', userId: one, message: 'What did we decide?', lookup,
    previousResponseId: 'resp_previous', hasAccess: async () => true,
    callModel: async options => {
      calls.push(options)
      if (calls.length === 1) return {
        success: true, data: null, model: 'fixture', responseId: 'resp_tool',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'search_project_data', arguments: JSON.stringify({ dataset: 'tasks', query: null, status: null, area_id: null, record_id: null }) } }],
      }
      return { success: true, data: 'Current answer', model: 'fixture', responseId: 'resp_final', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.providerResponseId, 'resp_final')
  assert.equal(calls[0].previousResponseId, 'resp_previous')
  assert.equal(calls[1].previousResponseId, 'resp_tool')
  assert.equal(calls[0].systemMessage, BOB_TRUTH_RULES)
  assert.equal(calls[1].systemMessage, BOB_TRUTH_RULES, 'truth/persona rules are sent fresh on every provider call')
  for (const value of Object.values(BOB_SYSTEM_SECTIONS)) assert(BOB_TRUTH_RULES.includes(value))
  assert.match(calls[0].messages[0].content, /Current turn frame/)
  assert.match(calls[0].messages[0].content, /fetched for THIS turn/)
  assert.equal(calls[0].messages[1].content, 'What did we decide?')
})

test('HTTP boundary accepts only an idempotency key, never browser provider/history state', async () => {
  let receivedTurn = ''
  const handler = createBobHandler({
    authenticate: async header => header === 'Bearer ok' ? one : null,
    answer: async opts => {
      receivedTurn = opts.clientTurnId
      return { ok: true, answer: 'ok', projectId: opts.projectId, evidence: evidence as any }
    },
  })
  const send = (body: Record<string, unknown>) => handler(new Request('https://example.test', {
    method: 'POST', headers: { Authorization: 'Bearer ok' }, body: JSON.stringify(body),
  }))
  const turn = '66666666-6666-4666-8666-666666666666'
  assert.equal((await send({ action:'send', projectId:'A', message:'Hi', clientTurnId:turn })).status, 200)
  assert.equal(receivedTurn, turn)
  assert.equal((await send({ action:'send', projectId:'A', message:'Hi', clientTurnId:'not-a-uuid' })).status, 400)
  assert.equal((await send({ action:'send', projectId:'A', message:'Hi', previousResponseId:'resp_forged' })).status, 400)
  assert.equal((await send({ action:'send', projectId:'A', message:'Hi', history:[{role:'user',content:'secret'}] })).status, 400)
})
