import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
let pg: PGlite
const accounting = { user_id: null, module: 'test', ai_function: 'design', model: 'fixture', input_price_per_1m: 2, cached_price_per_1m: .5, output_price_per_1m: 10 }
const invoke = async (name: string, args: any[], role = 'service_role', user: string | null = null): Promise<any> =>
  (await asProjectUser(pg, user, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
const one = async (sql: string, args: any[] = []) => (await pg.query<any>(sql, args)).rows[0]
const expiry = () => new Date(Date.now() + 600000).toISOString()
async function reserve(app = 'fixture', key = randomUUID(), context: any = {}, expires = expiry()) {
  return invoke('shared.ai_job_reserve', [app, key, 'a'.repeat(64), 'main', JSON.stringify(context), expires, JSON.stringify(accounting)])
}
function response(id: string, status = 'completed', rid = 'resp_' + id.replaceAll('-', '')) {
  return { id: rid, status, metadata: { ai_job_id: id }, model: 'fixture', output_text: 'Ready', usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 100 } } }
}
before(async () => {
  pg = await projectSchema()
  await pg.exec(`create table shared_private.fixture_wakes(job uuid primary key,status text,context jsonb);
    create function shared_private.fixture_wake(p_job uuid,p_context jsonb,p_status text) returns void language sql as $$
      insert into shared_private.fixture_wakes values(p_job,p_status,p_context) $$;
    insert into shared_private.ai_receivers values('fixture','main','shared_private','fixture_wake',true),('other','main','shared_private','fixture_wake',true);
    update shared_private.ai_runtime set worker_url='https://fixtureproject.supabase.co/functions/v1/ai-background-worker';`)
})
after(() => pg.close())

test('service-only reservation is one submission per app/key, rejects changed routing and isolates apps', async () => {
  const key = randomUUID(), expires = expiry(), first = await reserve('fixture', key, { session: 's' }, expires)
  assert(first.submit)
  const again = await reserve('fixture', key, { session: 's' }, expires)
  assert(!again.submit); assert.equal(first.id, again.id)
  assert.notEqual((await reserve('other', key, {}, expires)).id, first.id)
  await assert.rejects(() => reserve('fixture', key, { session: 'other' }, expires), /ai_operation_changed/)
  await assert.rejects(() => invoke('shared.ai_job_reserve', ['fixture', key, 'a'.repeat(64), 'main', '{}', expires, JSON.stringify(accounting)], 'authenticated'), /permission denied/)
  await assert.rejects(() => asProjectUser(pg, null, 'select * from shared_private.ai_jobs'), /permission denied/)
  await assert.rejects(() => asProjectUser(pg, null, "update shared_private.ai_receivers set enabled=false", [], 'service_role'), /permission denied/)
})

test('duplicate/out-of-order completions bill and wake once, using the saved price snapshot', async () => {
  const job = await reserve(), value = response(job.id)
  await invoke('shared.ai_job_accept', [job.id, JSON.stringify(value)])
  await invoke('shared.ai_job_accept', [job.id, JSON.stringify(value)])
  await invoke('shared.ai_job_accept', [job.id, JSON.stringify(response(job.id, 'in_progress'))])
  await invoke('shared.ai_job_deliver', [job.id])
  await invoke('shared.ai_job_deliver', [job.id])
  assert.equal((await one('select count(*)::int n from shared.ai_usage_events where background_job_id=$1', [job.id])).n, 1)
  const usage = await one('select * from shared.ai_usage_events where background_job_id=$1', [job.id])
  assert.equal(Number(usage.cost_usd), .0034); assert.equal(usage.reasoning_tokens, 100)
  assert.equal((await one('select count(*)::int n from shared_private.fixture_wakes where job=$1', [job.id])).n, 1)
  assert.equal((await one('select status from shared_private.ai_jobs where id=$1', [job.id])).status, 'completed')
  await assert.rejects(() => invoke('shared.ai_job_accept', [job.id, JSON.stringify(response(job.id, 'completed', 'resp_other'))]), /ai_response_mismatch/)
})

test('a completion reconciles an ambiguous POST; expired jobs receive no late result', async () => {
  const job = await reserve()
  assert.equal((await one('select response_id from shared_private.ai_jobs where id=$1', [job.id])).response_id, null)
  await invoke('shared.ai_job_accept', [job.id, JSON.stringify(response(job.id))])
  assert((await one('select response_id from shared_private.ai_jobs where id=$1', [job.id])).response_id)
  const late = await reserve()
  await pg.query("update shared_private.ai_jobs set expires_at=now()-interval '1 second' where id=$1", [late.id])
  await invoke('shared.ai_job_accept', [late.id, JSON.stringify(response(late.id))])
  assert.deepEqual(await one('select status,response from shared_private.ai_jobs where id=$1', [late.id]), { status: 'expired', response: null })
  await invoke('shared.ai_job_deliver', [late.id])
  assert.equal((await one('select status from shared_private.fixture_wakes where job=$1', [late.id])).status, 'expired')
  await invoke('shared.ai_event_receive', ['wh_duplicate', 'resp_one'])
  await invoke('shared.ai_event_receive', ['wh_duplicate', 'resp_one'])
  assert.equal((await one("select count(*)::int n from shared_private.ai_events where event_id='wh_duplicate'")).n, 1)
})

test('Bob waits without consuming retries; accepted delegation is durable; wake handles either ordering', async () => {
  const owner = randomUUID(), turn = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'async@example.test'])
  const project = (await invoke('bob.create_project', [JSON.stringify({ name: 'Async fixture' })], 'authenticated', owner)).id
  const claim = await invoke('bob.bob_claim_turn', [project, owner, turn, 'Rita sängen'])
  await pg.exec("update shared_private.ai_receivers set enabled=true where app='bob'")
  const job = await one(`insert into bob_private.bob_jobs(project_id,actor_id,thread_id,turn_id,generation,credential,worker_url,expires_at,status,claim_token)
    values($1,$2,$3,$4,$5,'{}','https://fixture.supabase.co/functions/v1/bob-worker',now()+interval '20 minutes','running',gen_random_uuid()) returning *`, [project, owner, claim.thread_id, turn, claim.generation])
  const ai = await invoke('shared.ai_job_reserve', ['bob', job.id + '/model:cad:0', 'b'.repeat(64), 'bob', JSON.stringify({ jobId: job.id, role: 'cad-designer' }), expiry(), JSON.stringify(accounting)])
  await invoke('shared.ai_job_accept', [ai.id, JSON.stringify(response(ai.id, 'queued'))])
  await invoke('bob.bob_wait_for_ai', [job.id, job.claim_token, ai.id])
  const waiting = await one('select status,waiting_ai_job,attempts from bob_private.bob_jobs where id=$1', [job.id])
  assert.equal(waiting.waiting_ai_job, ai.id); assert.equal(waiting.attempts, 0)
  assert.equal((await invoke('bob.bob_claim_job', [job.id, job.capability])).status, 'inactive')
  const notice = await one('select text from bob.bob_delegation_notices where turn_id=$1', [turn]); assert.match(notice.text, /skickat ritningen/)
  // Test DB has no pg_net: the callback must still record readiness without it.
  await pg.exec('create or replace function bob_private.bob_dispatch_jobs() returns integer language sql as $$ select 0 $$')
  await invoke('shared.ai_job_accept', [ai.id, JSON.stringify(response(ai.id))])
  await invoke('shared.ai_job_deliver', [ai.id])
  assert.equal((await one('select waiting_ai_job from bob_private.bob_jobs where id=$1', [job.id])).waiting_ai_job, null)
  const claimed = await invoke('bob.bob_claim_job', [job.id, job.capability]); assert(claimed.asyncModels)
  await invoke('bob.bob_wait_for_ai', [job.id, claimed.claimToken, ai.id])
  assert.equal((await one('select waiting_ai_job from bob_private.bob_jobs where id=$1', [job.id])).waiting_ai_job, null, 'completion before wait cannot lose the wake')
  assert.equal((await one('select count(*)::int n from bob.bob_delegation_notices where turn_id=$1', [turn])).n, 1)
})

test('unread receipts are owner scoped, monotonic, and cannot mark a future answer read', async () => {
  const owner = randomUUID(), stranger = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'reader@example.test', stranger, 'other@example.test'])
  const project = (await invoke('bob.create_project', [JSON.stringify({ name: 'Inbox fixture' })], 'authenticated', owner)).id
  const thread = await one('insert into bob.bob_threads(project_id,owner_user_id) values($1,$2) returning id', [project, owner])
  await pg.query("insert into bob.bob_messages(thread_id,seq,turn_id,role,text) values($1,1,$2,'assistant','Answer')", [thread.id, randomUUID()])
  assert((await invoke('bob.bob_chat_inbox', [project], 'authenticated', owner)).unread)
  await assert.rejects(() => invoke('bob.bob_mark_chat_read', [project, thread.id, 2], 'authenticated', owner), /invalid_read_receipt/)
  await assert.rejects(() => invoke('bob.bob_chat_inbox', [project], 'authenticated', stranger), /project_denied/)
  await invoke('bob.bob_mark_chat_read', [project, thread.id, 1], 'authenticated', owner)
  await invoke('bob.bob_mark_chat_read', [project, thread.id, 0], 'authenticated', owner)
  assert(!(await invoke('bob.bob_chat_inbox', [project], 'authenticated', owner)).unread)
  await pg.query("insert into bob.bob_messages(thread_id,seq,turn_id,role,text) values($1,2,$2,'assistant','New answer')", [thread.id, randomUUID()])
  assert((await invoke('bob.bob_chat_inbox', [project], 'authenticated', owner)).unread)
})

test('callback failure retains result and accounting; recovery delivers once even after opt-in is disabled', async () => {
 const job=await reserve(), value=response(job.id)
 await pg.exec(`create function shared_private.fixture_broken(p_job uuid,p_context jsonb,p_status text) returns void language plpgsql as $$ begin raise exception 'fixture_callback_down'; end $$;
   update shared_private.ai_receivers set handler_name='fixture_broken' where app='fixture';`)
 await invoke('shared.ai_job_accept',[job.id,JSON.stringify(value)])
 await assert.rejects(()=>invoke('shared.ai_job_deliver',[job.id]),/fixture_callback_down/)
 assert.equal((await one('select status from shared_private.ai_jobs where id=$1',[job.id])).status,'completed')
 assert.equal((await one('select count(*)::int n from shared.ai_usage_events where background_job_id=$1',[job.id])).n,1)
 await pg.exec("update shared_private.ai_receivers set enabled=false,handler_name='fixture_wake' where app='fixture'")
 await invoke('shared.ai_job_deliver',[job.id]);await invoke('shared.ai_job_deliver',[job.id])
 assert.equal((await one('select count(*)::int n from shared_private.fixture_wakes where job=$1',[job.id])).n,1)
 await assert.rejects(()=>reserve(),/ai_background_not_configured/)
 await pg.exec("update shared_private.ai_receivers set enabled=true where app='fixture'")
})

test('cancel and late completion cannot revive the app operation; work capabilities cannot be forged', async () => {
 const key=randomUUID(),job=await reserve('fixture',key)
 await invoke('shared.ai_job_accept',[job.id,JSON.stringify(response(job.id,'queued'))])
 const row=await one('select capability from shared_private.ai_jobs where id=$1',[job.id])
 await assert.rejects(()=>invoke('shared.ai_work_claim',['job',job.id,randomUUID()]),/ai_work_denied/)
 await invoke('shared.ai_job_cancel',['fixture',key])
 const work=await invoke('shared.ai_work_claim',['job',job.id,row.capability]);assert(work.cancel);assert(work.response_id)
 await invoke('shared.ai_job_accept',[job.id,JSON.stringify(response(job.id))])
 await invoke('shared.ai_job_deliver',[job.id])
 assert.deepEqual(await one('select status,response,cancel_pending from shared_private.ai_jobs where id=$1',[job.id]),{status:'cancelled',response:null,cancel_pending:false})
 assert.equal((await one('select status from shared_private.fixture_wakes where job=$1',[job.id])).status,'cancelled')
 assert.equal((await one('select count(*)::int n from shared.ai_usage_events where background_job_id=$1',[job.id])).n,1)
})

test('payload retention runs with dispatch disabled and preserves delayed callback routing', async () => {
 const context={sessionId:'retained-routing'},job=await reserve('fixture',randomUUID(),context)
 await invoke('shared.ai_job_accept',[job.id,JSON.stringify(response(job.id))])
 await pg.query("update shared_private.ai_jobs set finished_at=now()-interval '2 days',next_check_at=now()+interval '1 hour' where id=$1",[job.id])
 await pg.exec('update shared_private.ai_runtime set worker_url=null')
 await invoke('shared_private.ai_dispatch',[])
 const row=await one('select response,context,accounting from shared_private.ai_jobs where id=$1',[job.id])
 assert.equal(row.response,null);assert.deepEqual(row.context,context);assert.deepEqual(row.accounting,accounting)
 await invoke('shared.ai_job_deliver',[job.id])
 assert.deepEqual((await one('select context from shared_private.fixture_wakes where job=$1',[job.id])).context,context)
})
