import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { createPlanLinks, PLAN_LINK_TOOLS, type PlanLinkResource } from '../supabase/functions/_shared/project-plan-links.ts'
import { createProjectWriter, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'

const uid = '00000000-0000-4000-8000-000000000001', outsider = '00000000-0000-4000-8000-000000000002'
const stepA = randomUUID(), stepB = randomUUID(), stepDone = randomUUID()
const quote = 'Organise existing Tasks and choose the current focus.'
let pg: Awaited<ReturnType<typeof projectSchema>>, thread: string, turn: string, generation: number, priorManifest: any, publishedManifest: any
before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name.endsWith('_ai_plan_links_catalog.sql')) priorManifest = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
    else if (priorManifest && !publishedManifest) publishedManifest = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
  })
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [uid, 'member@example.test', outsider, 'outsider@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Shared build'),('B','b','Other build'); insert into bob.areas(id,project_id,slug,name) values('areaA','A','a','Assembly'); insert into bob.tasks(id,project_id,area_id,name,instructions) values('taskA','A','areaA','Cut panel','Preserve these instructions'),('taskB','B',null,'Private task','Private'); insert into bob.project_plans(project_id,current_revision,next_revision) values('A',null,2)")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('memberA','A','Member','M',$1),('outsiderB','B','Outsider','O',$2)", [uid, outsider])
  await pg.exec("insert into bob.task_assignees values('taskA','memberA')")
  await pg.query("insert into bob.project_plan_revisions(project_id,revision,status,summary,reason,proposed_by,approved_by,decided_at) values('A',1,'approved','Assemble panels','Fixture',$1,$1,now())", [uid])
  for (const [i, id] of [stepA, stepB, stepDone].entries()) await pg.query("insert into bob.project_plan_steps(project_id,plan_revision,step_id,position,title,goal,state,area_id,responsible_kind) values('A',1,$1,$2,$3,'Build together',$4,'areaA','unassigned')", [id, i + 1, ['Cut', 'Assemble', 'Finished'][i], i === 2 ? 'completed' : 'active'])
  await pg.exec("update bob.project_plans set current_revision=1 where project_id='A'")
})
after(async () => { await pg?.close() })
async function claim() {
  if (turn) await asProjectUser(pg, null, 'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', ['A', uid, thread, turn, generation], 'service_role')
  turn = randomUUID()
  const r: any = (await asProjectUser(pg, null, "select bob.bob_claim_turn('A',$1,$2,$3) r", [uid, turn, quote], 'service_role')).rows[0].r
  assert.equal(r.status, 'claimed'); thread = r.thread_id; generation = r.generation
}
const read = async (i: { resource: PlanLinkResource; query: string | null; after: string | null }) => ({ data: (await asProjectUser(pg, uid, 'select bob.read_bob_plan_link_context($1,$2,$3,$4) r', ['A', i.resource, i.query, i.after])).rows[0].r, error: null })
async function rpc(p: WritePayload, user = uid) {
  try { return { data: (await asProjectUser(pg, user, 'select bob.bob_project_write_v20($1,$2,$3,$4,$5::jsonb) r', ['A', thread, turn, generation, JSON.stringify(p)])).rows[0].r, error: null } }
  catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
}
function setup() {
  const payloads: WritePayload[] = []
  const writer = createProjectWriter('A', quote, p => { payloads.push(structuredClone(p)); return rpc(p) }, async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
  return { writer, payloads, tools: createPlanLinks({ projectId: 'A', writer, hasAccess: async () => true, read }) }
}
const choose = async (tools: ReturnType<typeof createPlanLinks>, resource: PlanLinkResource, query: string | null = null) => {
  const r = await tools.execute('read_plan_link_context', { resource, query, next_ref: null }); assert.equal(r.status, 'ok', JSON.stringify(r)); return r.entries[0]
}
const focus = (ref: string, action = 'set') => ({ ref, action, reason: 'Requested focus', request_quote: quote })
const link = (step_ref: string, task_ref: string, action = 'link') => ({ step_ref, task_ref, action, reason: 'Requested organisation', request_quote: quote })

test('focus is bound to a read; successive changes and exact replay preserve parallel states', async () => {
  await claim(); const { tools, payloads } = setup()
  const a = await choose(tools, 'steps', 'Cut'); assert.ok(!JSON.stringify(a).includes(stepA))
  const first = focus(a.ref); assert.equal((await tools.execute('change_plan_focus', first)).status, 'saved')
  const original = payloads[0]
  const b = await choose(tools, 'steps', 'Assemble'); assert.equal((await tools.execute('change_plan_focus', focus(b.ref))).status, 'saved')
  assert.equal((await rpc(original)).error, null)
  assert.equal((await pg.query("select focus_step_id from bob.project_plans where project_id='A'")).rows[0].focus_step_id, stepB)
  assert.equal((await tools.execute('change_plan_focus', first)).status, 'saved', 'replay returns old receipt without moving focus back')
  assert.equal((await tools.execute('change_plan_focus', focus((await choose(tools, 'plan')).ref, 'clear'))).status, 'saved')
  assert.equal((await pg.query("select focus_step_id from bob.project_plans where project_id='A'")).rows[0].focus_step_id, null)
  assert.deepEqual((await pg.query("select state from bob.project_plan_steps where project_id='A' order by position")).rows.map(r => r.state), ['active', 'active', 'completed'])
  assert.equal((await tools.execute('change_plan_focus', focus((await choose(tools, 'steps', 'Finished')).ref))).status, 'invalid')
})
test('link, move and unlink preserve content, status, people and unrelated references', async () => {
  await claim(); const { tools } = setup()
  let a = await choose(tools, 'steps', 'Cut'), t = await choose(tools, 'tasks', 'Cut panel')
  assert.equal((await tools.execute('change_plan_task_link', link(a.ref, t.ref))).status, 'saved')
  let b = await choose(tools, 'steps', 'Assemble'); t = await choose(tools, 'tasks', 'Cut panel')
  assert.equal((await tools.execute('change_plan_task_link', link(b.ref, t.ref))).status, 'saved')
  t = await choose(tools, 'tasks', 'Cut panel'); assert.equal(t.content.links.length, 2); assert.equal(t.content.primary_step_title, 'Cut')
  b = await choose(tools, 'steps', 'Assemble')
  assert.equal((await tools.execute('change_plan_task_link', link(b.ref, t.ref, 'move'))).status, 'saved')
  let row: any = (await pg.query("select * from bob.tasks where id='taskA'")).rows[0]
  assert.equal(row.primary_step_id, stepB); assert.equal(row.instructions, 'Preserve these instructions'); assert.equal(row.status, 'todo')
  assert.equal((await pg.query("select count(*) n from bob.task_assignees where task_id='taskA'")).rows[0].n, 1)
  a = await choose(tools, 'steps', 'Cut'); t = await choose(tools, 'tasks', 'Cut panel')
  assert.equal((await tools.execute('change_plan_task_link', link(a.ref, t.ref))).status, 'saved')
  a = await choose(tools, 'steps', 'Cut'); t = await choose(tools, 'tasks', 'Cut panel')
  const remove = link(a.ref, t.ref, 'unlink'); assert.equal((await tools.execute('change_plan_task_link', remove)).status, 'saved')
  assert.equal((await tools.execute('change_plan_task_link', remove)).status, 'saved')
  assert.deepEqual((await pg.query("select step_id from bob.project_plan_step_tasks where task_id='taskA'")).rows.map(r => r.step_id), [stepB])
})
test('concurrent focus, Task and relation-only changes reject stale selections', async () => {
  await claim(); const { tools } = setup()
  let s = await choose(tools, 'steps', 'Cut'), t = await choose(tools, 'tasks', 'Cut panel')
  await pg.exec("update bob.tasks set instructions='Concurrent correction' where id='taskA'")
  assert.equal((await tools.execute('change_plan_task_link', link(s.ref, t.ref))).status, 'conflict')
  t = await choose(tools, 'tasks', 'Cut panel'); s = await choose(tools, 'steps', 'Cut')
  await pg.query("delete from bob.project_plan_step_tasks where project_id='A' and task_id='taskA' and step_id=$1", [stepB])
  assert.equal((await tools.execute('change_plan_task_link', link(s.ref, t.ref))).status, 'conflict')
  s = await choose(tools, 'steps', 'Cut')
  await pg.query("update bob.project_plans set focus_step_id=$1,updated_at=clock_timestamp() where project_id='A'", [stepB])
  assert.equal((await tools.execute('change_plan_focus', focus(s.ref))).status, 'conflict')
  assert.equal((await pg.query("select instructions from bob.tasks where id='taskA'")).rows[0].instructions, 'Concurrent correction')
})
test('foreign scope, forged target, missing claim and raw IDs cannot write', async () => {
  await claim(); const { tools, payloads } = setup()
  const s = await choose(tools, 'steps', 'Cut'); await tools.execute('change_plan_focus', focus(s.ref))
  await assert.rejects(asProjectUser(pg, outsider, "select bob.read_bob_plan_link_context('A','steps',null,null)"), /project_denied/)
  await assert.rejects(asProjectUser(pg, null, "select bob.read_bob_plan_link_context('A','steps',null,null)", [], 'anon'), /permission denied/)
  assert.equal((await tools.execute('change_plan_focus', focus(stepA))).status, 'invalid')
  assert.equal((await tools.execute('change_plan_focus', { ...focus(s.ref), step_id: stepA })).status, 'invalid')
  const forged = structuredClone(payloads[0]); (forged.data.domain as WritePayload).data.step_id = stepB
  assert.ok((await rpc(forged)).error)
  assert.ok((await rpc(payloads[0], outsider)).error)
  await asProjectUser(pg, null, 'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', ['A', uid, thread, turn, generation], 'service_role')
  assert.ok((await rpc(payloads[0])).error)
})
test('paged reads are complete and cursor-bound without exposing database fields', async () => {
  const { tools } = setup()
  const first = await tools.execute('read_plan_link_context', { resource: 'steps', query: null, next_ref: null })
  assert.equal(first.entries.length, 2); assert.ok(first.next_ref)
  const next = await tools.execute('read_plan_link_context', { resource: 'steps', query: null, next_ref: first.next_ref })
  assert.equal(next.entries.length, 1); assert.equal(next.next_ref, null)
  assert.equal((await tools.execute('read_plan_link_context', { resource: 'tasks', query: null, next_ref: first.next_ref })).status, 'invalid')
  assert.ok(!/current_revision|updated_at|step_id|project_id/.test(JSON.stringify(first)))
})
test('published contracts replace only fresh plan link tools and preserve old manifests', async () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-ai-plan-links-catalog.ts', 'supabase/migrations/20261015102328_ai_plan_links_catalog.sql', '--check'])
  const manifest: any = (await pg.query("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
  assert.deepEqual((await pg.query("select shared.resolve_ai_catalog('bob',$1) m", [priorManifest.manifest_id])).rows[0].m, priorManifest)
  // This publication preserves model settings; later independent releases can add a tier.
  assert.ok(publishedManifest)
  assert.deepEqual(publishedManifest.models, priorManifest.models)
  assert.deepEqual((await pg.query("select shared.resolve_ai_catalog('bob',$1) m", [publishedManifest.manifest_id])).rows[0].m, publishedManifest)
  const catalog = (m: any) => createAiCatalogSession({ rpc: async () => { throw Error('Pinned') } }, { app: 'bob', manifest: m })
  const current = catalog(manifest)
  for (const spec of PLAN_LINK_TOOLS) {
    assert.deepEqual(manifest.definitions.find((d: any) => d.prompt_key === 'tools.' + spec.function.name).definition.parameters, spec.function.parameters)
    assert.ok(!current.tool(spec.function.name, { server_quote: true }).function.parameters.required.includes('request_quote'))
  }
  const { tools, writer } = setup(), lookup = createProjectLookup('A', async () => ({ data: { records: [], related: [], truncated: false }, error: null }))
  const options = { message: quote, lookup, writer, planLinks: tools, readPolicy: seedToolPolicy }
  const fresh = (await createBobToolSession({ ...options, aiCatalog: current }).prepare()).map(t => t.function.name)
  assert.ok(fresh.includes('change_plan_task_link')); assert.ok(!fresh.includes('link_project_plan_task')); assert.ok(!fresh.includes('set_project_plan_focus')); assert.ok(fresh.includes('decide_project_plan'))
  const old = (await createBobToolSession({ ...options, aiCatalog: catalog(priorManifest) }).prepare()).map(t => t.function.name)
  assert.ok(old.includes('link_project_plan_task')); assert.ok(!old.includes('change_plan_task_link'))
})
test('restart reconstructs refs and reuses exact transport receipts, with live access checks', async () => {
  await claim(); const entries: JournalEntry[] = []; let reads = 0, writes = 0, allowed = true
  const run = async () => {
    const journal = createBobJournal({ entries, save: async e => { entries.push(structuredClone(e)) } }, Infinity)
    const writer = createProjectWriter('A', quote, p => journal.run('write', p, async () => { writes++; return rpc(p) }), async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
    const tools = createPlanLinks({ projectId: 'A', writer, hasAccess: async () => allowed, read: i => journal.run('read', i, async () => { reads++; return read(i) }) })
    const r = await tools.execute('read_plan_link_context', { resource: 'steps', query: 'Assemble', next_ref: null })
    return r.status === 'ok' ? tools.execute('change_plan_focus', focus(r.entries[0].ref)) : r
  }
  assert.equal((await run()).status, 'saved'); assert.equal((await run()).status, 'saved'); assert.equal(reads, 1); assert.equal(writes, 1)
  allowed = false; assert.equal((await run()).status, 'denied'); assert.equal(writes, 1)
})
