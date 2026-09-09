import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createProjectLookup, LIMITS, parseLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createBobHandler } from '../supabase/functions/_shared/bob-request.ts'

const pg = new PGlite()
const u1 = '00000000-0000-0000-0000-000000000001'
const u2 = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const invited = '00000000-0000-0000-0000-000000000004'
const stranger = '00000000-0000-0000-0000-000000000005'
const input = (dataset = 'tasks', extra = {}) => ({ dataset, query: null, status: null, area_id: null, record_id: null, ...extra })
const migrations = new URL('../supabase/migrations/', import.meta.url)

async function queryAs(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })])
    await tx.exec(`set local role ${role}`)
    return tx.query(sql, params)
  })
}
function lookupFor(uid: string, projectId: string) {
  return createProjectLookup(projectId, async (pid, args) => {
    try {
      const r = await queryAs(uid, 'select bob.search_project_data($1,$2,$3,$4,$5,$6) as result', [pid, args.dataset, args.query, args.status, args.area_id, args.record_id])
      return { data: r.rows[0].result, error: null }
    } catch (e) { return { data: null, error: { code: (e as { code: string }).code } } }
  })
}
async function access(uid: string, pid: string) {
  const r = await queryAs(uid, 'select id from bob.projects where id = $1', [pid])
  return r.rows.length === 1
}

before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values
      ('${u1}','one@example.test',now()), ('${u2}','two@example.test',now()),
      ('${both}','both@example.test',now()), ('${invited}','invited@example.test',now()),
      ('${stranger}','stranger@example.test',null);
  `)
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  }
  await pg.exec(`
    insert into bob.projects(id,slug,name) values ('A','a','Porch A'),('B','b','Private B'),('orphan','orphan','Unmapped');
    insert into bob.people(id,project_id,name,initials,auth_user_id,diet) values
      ('p1','A','Alice','AL','${u1}','DO_NOT_SEND_DIET'), ('p2','B','Bert','BE','${u2}','SECRET_B_DIET');
    -- Reproduce a live policy absent from the legacy migration history.
    create policy authenticated_insert_projects on bob.projects for insert to authenticated with check(true);
  `)
  const migration = await readFile(new URL((await readdir(migrations)).find(f => f.endsWith('.sql'))!, migrations), 'utf8')
  await assert.rejects(pg.exec(migration), /reviewed member mapping/)
  await pg.exec('rollback')
  const reviewed = (project_id: string, email: string) => migration.replace('begin;',
    `begin; select set_config('bob.reviewed_member_mapping', '${JSON.stringify([{project_id,email,name:'Reviewed member'}])}', true);`)
  for (const [project,email,error] of [
    ['orphan','missing@example.test',/exactly one Auth account/],
    ['orphan','stranger@example.test',/not confirmed/],
    ['A','two@example.test',/existing crew/],
  ] as const) {
    await assert.rejects(pg.exec(reviewed(project,email)), error)
    await pg.exec('rollback')
    assert.equal((await pg.query("select to_regclass('bob.people_auth_user_idx') is not null as intact")).rows[0].intact, true, 'failed mapping restores legacy uniqueness')
  }
  await pg.exec(reviewed('orphan','one@example.test'))
  assert.deepEqual((await pg.query('select project_id from bob.people where auth_user_id=$1 order by project_id',[u1])).rows,
    [{project_id:'A'},{project_id:'orphan'}], 'reviewed bootstrap keeps the existing membership')
  assert.equal(await access(u1,'orphan'), true, 'new reviewed member has access under the real RLS policy')
  assert.equal(await access(u2,'orphan'), false, 'other existing member does not acquire access')
  // Remove only this local bootstrap fixture; retain A/B for the independent tests.
  await pg.exec("delete from bob.projects where id='orphan'")
  await pg.exec(`
    insert into bob.people(id,project_id,name,initials,auth_user_id) values
      ('bothA','A','Shared member','SM','${both}'),('bothB','B','Shared member','SM','${both}');
    insert into bob.areas(id,project_id,slug,name,lead_id) values ('areaA','A','porch','Porch','p1'),('areaB','B','secret','SECRET_B_AREA','p2');
    insert into bob.tasks(id,area_id,name,hours,materials) values ('taskA','areaA','Fit 100% board','6h','1 / 2'),('taskB','areaB','SECRET_B_TASK','99h','9 / 9');
    insert into bob.task_assignees values ('taskA','p1'),('taskB','p2');
    insert into bob.person_skills values ('p1','Carpentry','expert');
    insert into bob.materials(id,project_id,name,qty,cost,area_label) values ('matA','A','Boards','48 st','1 920 kr','Porch');
    insert into bob.events(id,project_id,slug,title) values ('eventA','A','day','Build day'),('eventB','B','secret','SECRET_B_EVENT');
    insert into bob.event_attendees values ('eventA','p1');
    insert into bob.announcements(id,project_id,author_id,text) values ('newsA','A','p1','Bring tools');
    insert into bob.food_groups(id,project_id,category) values ('foodA','A','Lunch'),('foodB','B','Secret');
    insert into bob.food_items(group_id,name) values ('foodA','Bread'),('foodB','SECRET_B_FOOD');
    insert into bob.diet_columns(id,project_id,name) values ('dietA','A','Vegetarian'),('dietB','B','Private');
    insert into bob.meals(id,project_id,event_id,meal) values ('mealA','A','eventA','Lunch');
  `)
})
after(() => pg.close())

test('RLS allows own project, denies other project, and today view obeys caller RLS', async () => {
  assert.deepEqual((await queryAs(u1, 'select id from bob.projects')).rows, [{ id: 'A' }])
  assert.deepEqual((await queryAs(u1, 'select id from bob.tasks')).rows, [{ id: 'taskA' }])
  assert.deepEqual((await queryAs(u1, 'select id from bob.today_tasks')).rows, [{ id: 'taskA' }])
  assert.equal((await lookupFor(u1, 'A').search(input())).status, 'ok')
  assert.equal((await lookupFor(u1, 'B').search(input())).status, 'denied')
  assert.equal((await lookupFor(stranger, 'A').search(input())).status, 'denied')
  await assert.rejects(queryAs(null, 'select * from bob.projects', [], 'anon'), /permission denied/)
  assert.equal((await queryAs(null, 'select * from bob.projects')).rows.length, 0)
})

test('all seven projections exclude private fields and preserve authored display values', async () => {
  for (const dataset of ['project','areas','tasks','materials','crew','events','announcements']) {
    const result = await lookupFor(u1, 'A').search(input(dataset))
    assert.equal(result.status, 'ok', dataset)
    assert.doesNotMatch(JSON.stringify(result), /SECRET_B|DO_NOT_SEND|auth_user_id|person_emails|diet|assigned_pct/)
    assert.equal(result.truth, 'unknown')
  }
  const materials = await lookupFor(u1, 'A').search(input('materials'))
  assert.equal(materials.records[0].cost, '1 920 kr')
  const tasks = await lookupFor(u1, 'A').search(input('tasks', { query: '100%' }))
  assert.equal(tasks.records[0].hours, '6h')
  assert.equal(tasks.related[0].name, 'Alice')
  assert.equal((await lookupFor(u1, 'A').search(input('tasks', { query: '% OR true --' }))).status, 'empty')
})

test('a member of two projects gets separate results; a foreign child id cannot broaden the filter', async () => {
  const a = await lookupFor(both, 'A').search(input())
  const b = await lookupFor(both, 'B').search(input())
  assert.equal(a.records[0].id, 'taskA')
  assert.equal(b.records[0].id, 'taskB')
  assert.doesNotMatch(JSON.stringify(a), /SECRET_B/)
  assert.equal((await lookupFor(u1, 'A').search(input('tasks', { record_id: 'taskB' }))).status, 'empty')
  for (const table of ['projects','people','person_skills','areas','area_crew','area_reference_images','tasks',
    'task_assignees','materials','events','event_attendees','meals','diet_columns','diet_flags','food_groups','food_items','announcements']) {
    const rows = await queryAs(u1, `select * from bob.${table}`)
    assert.doesNotMatch(JSON.stringify(rows.rows), /SECRET_B|"B"|"areaB"|"taskB"|"p2"|"bothB"/, table)
  }
})

test('cross-project writes and both-end relations fail even for a member of BOTH projects', async () => {
  for (const sql of [
    "insert into bob.task_assignees values ('taskA','p2')",
    "insert into bob.area_crew values ('areaA','p2')",
    "insert into bob.event_attendees values ('eventA','p2')",
    "insert into bob.diet_flags values ('p1','dietB')",
    "update bob.areas set lead_id='p2' where id='areaA'",
    "update bob.announcements set author_id='p2' where id='newsA'",
    "update bob.meals set event_id='eventB' where id='mealA'",
    "update bob.people set project_id='B' where id='p1'",
    `update bob.people set auth_user_id='${both}' where id='p1'`,
    "update bob.tasks set area_id='areaB' where id='taskA'",
    "update bob.food_items set group_id='foodB' where group_id='foodA'",
  ]) await assert.rejects(queryAs(both, sql), /policy|permission denied/, sql)
  assert.equal((await queryAs(u1, "update bob.tasks set name='HACK' where id='taskB' returning id")).rows.length, 0)
  assert.equal((await queryAs(u1, "delete from bob.tasks where id='taskB' returning id")).rows.length, 0)
  await queryAs(u1, "update bob.tasks set status='doing' where id='taskA'")
  await queryAs(u1, "update bob.people set role='Site lead', diet='Updated dietary preference' where id='p1'")
  await queryAs(u1, "update bob.food_items set checked=true where group_id='foodA'")
})

test('creation is atomic and invitations grant only their intended project to verified accounts', async () => {
  await assert.rejects(queryAs(stranger, "insert into bob.projects(id,slug,name) values('bad','bad','Bad')"), /permission denied/)
  await assert.rejects(queryAs(stranger, "select bob.join_project('A')"), /project_denied/)
  await assert.rejects(queryAs(u1, "select bob.invite_person('B','Someone','some@example.test')"), /project_denied/)
  await queryAs(u1, "select bob.invite_person('A','Invited','invited@example.test')")
  await queryAs(u2, "select bob.invite_person('B','Invited','invited@example.test')")
  await queryAs(invited, 'select bob.claim_project_invites()')
  assert.equal((await queryAs(invited, 'select id from bob.projects')).rows.length, 2)
  await queryAs(u1, "select bob.invite_person('A','Not verified','stranger@example.test')")
  await queryAs(stranger, 'select bob.claim_project_invites()')
  assert.equal((await queryAs(stranger, 'select id from bob.projects')).rows.length, 0)
  await assert.rejects(queryAs(invited, 'select * from bob.person_emails'), /permission denied/)
  const created = await queryAs(stranger, `select bob.create_project(' {"name":"My build","theme":"birch"}'::jsonb) as p`)
  const pid = (created.rows[0].p as { id: string }).id
  assert.equal(await access(stranger, pid), true)
  const me = await queryAs(stranger, 'select bob.join_project($1) as person', [pid])
  assert.equal((me.rows[0].person as { project_id: string }).project_id, pid)
  await assert.rejects(queryAs(stranger, 'delete from bob.people where project_id=$1', [pid]), /last_project_member/)
})

test('lookup validation, row/join/byte budgets and timeout are enforced', async () => {
  assert.equal(parseLookup({ ...input(), project_id: 'B' }), null)
  assert.equal(parseLookup(input('account_notes')), null)
  assert.equal(parseLookup(input('crew', { status: 'doing' })), null)
  assert.equal(parseLookup(input('tasks', { query: 'x'.repeat(201) })), null)
  await pg.exec(`insert into bob.tasks(id,area_id,name) select 'bulk'||i,'areaA','Bulk '||i from generate_series(1,30) i;
    insert into bob.people(id,project_id,name,initials) select 'worker'||i,'A','Worker '||i,'WW' from generate_series(1,30) i;
    insert into bob.task_assignees select 'taskA','worker'||i from generate_series(1,30) i;`)
  const many = await lookupFor(u1, 'A').search(input())
  assert.equal(many.records.length, LIMITS.rows)
  assert.equal(many.truncated, true)
  const joined = await lookupFor(u1, 'A').search(input('tasks', { record_id: 'taskA' }))
  assert.equal(joined.related.length, LIMITS.joinedRows)
  assert.equal(joined.truncated, true)
  await pg.query("update bob.tasks set name=$1 where id='taskA'", ['🌲'.repeat(20000)])
  const huge = await lookupFor(u1, 'A').search(input('tasks', { record_id: 'taskA' }))
  assert.equal(huge.truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(huge)) <= LIMITS.bytes)
  await pg.exec("update bob.tasks set name='Fit 100% board' where id='taskA'")
  const budget = lookupFor(u1, 'A')
  for (let i=0; i<3; i++) await budget.search(input('project'))
  assert.equal((await budget.search(input())).status, 'budget_exhausted')
  let aborted = false
  const timeout = createProjectLookup('A', (_p,_i,signal) => {
    signal.addEventListener('abort', () => { aborted = true })
    return new Promise(() => {})
  }, 5)
  assert.equal((await timeout.search(input())).status, 'unavailable')
  assert.equal(aborted, true)
})

test('HTTP + model tool continuation uses real authorised SQL and server-only response ids', async () => {
  let modelCalls = 0
  const handler = createBobHandler({ authenticate: async header => header === 'Bearer fixture-user' ? u1 : null,
    answer: async opts => runProjectAnswer({ ...opts, lookup: lookupFor(opts.userId, opts.projectId), hasAccess: () => access(opts.userId, opts.projectId),
      callModel: async options => {
        modelCalls++
        if (!options.previousResponseId) {
          assert.equal(options.tools?.[0].function.name, 'search_project_data')
          return { success: true, data: null, model: 'fixture', usage: { input_tokens:0,output_tokens:0,total_tokens:0 }, responseId: 'server-response-A', toolCalls: [{ id:'call-A',type:'function',function:{name:'search_project_data',arguments:JSON.stringify(input('tasks',{record_id:'taskA'}))} }] }
        }
        assert.equal(options.previousResponseId, 'server-response-A')
        const tool = JSON.parse(options.messages![0].content!)
        assert.equal(tool.projectId, 'A')
        assert.equal(tool.records[0].id, 'taskA')
        assert.doesNotMatch(JSON.stringify(tool), /SECRET_B|diet|auth_user_id/)
        return { success:true,data:'Fit 100% board is recorded as doing; 6h is unverified display text.',model:'fixture',usage:{input_tokens:0,output_tokens:0,total_tokens:0} }
      },
    }),
  })
  const post = (body: unknown, auth = 'Bearer fixture-user') => handler(new Request('http://bob.test/ask-bob', { method:'POST',headers:{ Authorization:auth },body:JSON.stringify(body) }))
  const success = await post({action:'send',projectId:'A',message:'Which task?'})
  assert.equal(success.status, 200)
  const answer = await success.json()
  assert.equal(answer.projectId, 'A')
  assert.equal(answer.evidence.kind, 'ai_assessment')
  assert.ok(answer.evidence.sources.some((s: { recordId: string }) => s.recordId === 'taskA'))
  assert.equal((await post({action:'send',projectId:'B',message:'Secret?'})).status, 403)
  assert.equal(modelCalls, 2, 'denied project never reaches model')
  assert.equal((await post({action:'send',message:'No project'})).status, 400)
  assert.equal((await post({action:'send',projectId:'A',message:'Hi',previousResponseId:'forged'})).status, 400)
  assert.equal((await post({action:'send',projectId:'A',message:'Hi'},'Bearer invalid')).status, 401)
  for (const action of ['status','reply','artifact']) assert.equal((await post({action,projectId:'B',taskId:'forged',artifactId:'forged'})).status, 409)
})

test('revoked access during a slow answer discards the response', async () => {
  let checks = 0
  const result = await runProjectAnswer({ projectId:'A',userId:u1,message:'Hi',lookup:lookupFor(u1,'A'),
    hasAccess: async () => ++checks < 3,
    callModel: async () => ({success:true,data:'Sensitive old answer',model:'fixture',usage:{input_tokens:0,output_tokens:0,total_tokens:0}}),
  })
  assert.deepEqual(result, {ok:false,error:'project_denied'})
})
