import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { isProjectWriteReceipt } from '../src/data/bobEvidence.ts'

/** Keeping the project tidy through the same claimed-turn writer as every other
 * change: quote, budget, before-state receipt, project scope and history rules. */
let pg: PGlite, project: string, other: string
const owner = randomUUID(), stranger = randomUUID(), message = 'Städa projektet: ta bort det som inte längre behövs.'
const query = (uid: string | null, sql: string, args: unknown[] = [], role = 'authenticated') => asProjectUser(pg, uid, sql, args, role)
const call = async (uid: string | null, name: string, args: unknown[], role = 'authenticated'): Promise<any> =>
  (await query(uid, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
const row = async (sql: string, args: unknown[] = []) => (await pg.query<any>(sql, args)).rows[0]

before(async () => {
  pg = await projectSchema()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'tidy-owner@example.test', stranger, 'tidy-stranger@example.test'])
  project = (await call(owner, 'bob.create_project', [JSON.stringify({ name: 'Tidy work' })])).id
  other = (await call(stranger, 'bob.create_project', [JSON.stringify({ name: 'Other' })])).id
  await pg.query(`insert into bob.areas(id,project_id,slug,name) values('areaOld',$1,'old','Old shed'),('areaKeep',$1,'keep','Kitchen'),('areaOther',$2,'x','Other area')`, [project, other])
  await pg.query(`insert into bob.tasks(id,project_id,area_id,name,status) values('taskGone',$1,'areaKeep','Obsolete prep','todo'),('taskDone',$1,'areaKeep','Finished wall','done'),('taskOther',$2,'areaOther','Not yours','todo')`, [project, other])
  await pg.query(`insert into bob.events(id,project_id,slug,title,day) values('dayGone',$1,'d1','Cancelled day','Sat')`, [project])
  await pg.query(`insert into bob.event_tasks values($1,'dayGone','taskDone')`, [project])
  await pg.query(`insert into bob.materials(id,project_id,name) values('mGone',$1,'Wrong screws')`, [project])
})
after(() => pg.close())

async function claimed() {
  const turn = randomUUID()
  const claim = await call(null, 'bob.bob_claim_turn', [project, owner, turn, message], 'service_role')
  assert.equal(claim.status, 'claimed')
  const payloads: any[] = []
  const writer = createProjectWriter(project, message, async payload => {
    payloads.push(payload)
    try { return { data: await call(owner, 'bob.bob_project_write_v13', [project, claim.thread_id, turn, claim.generation, JSON.stringify(payload)]), error: null } }
    catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
  }, async () => ({ data: [], error: null }), async () => ({ data: { generation: claim.generation, receipts: [] }, error: null }))
  const tools = createBobToolSession({ writer, lookup: createProjectLookup(project, async () => ({ data: { records: [], related: [], truncated: false }, error: null })), readPolicy: seedToolPolicy })
  await tools.prepare()
  return { writer, tools, turn, payloads, finish: () => call(null, 'bob.bob_fail_turn_v2', [project, owner, claim.thread_id, turn, claim.generation], 'service_role') }
}
const stamp = async (table: string, id: string) => (await row(`select updated_at from bob.${table} where id=$1`, [id])).updated_at.toISOString()

test('every lifecycle tool is on the bench for a claimed writer', async () => {
  const c = await claimed()
  try {
    const offered = (await c.tools.prepare()).map(t => t.function.name)
    for (const name of ['archive_project_area', 'delete_project_task', 'delete_project_build_day', 'delete_shopping_item', 'detach_project_image', 'set_project_phase', 'update_project_schedule'])
      assert(offered.includes(name), name)
  } finally { await c.finish() }
})

test('deletes keep a before-state receipt, respect history and never reach another project', async () => {
  const c = await claimed()
  try {
    const task = await c.tools.execute('delete_project_task', { task_id: 'taskGone', expected_updated_at: await stamp('tasks', 'taskGone'), request_quote: message })
    assert.equal(task.status, 'saved'); assert.equal(task.receipt.operation, 'deleted'); assert.equal(task.receipt.dataset, 'tasks')
    assert(isProjectWriteReceipt(task.receipt, project), 'the browser accepts a deleted receipt')
    assert.equal(await row('select id from bob.tasks where id=$1', ['taskGone']), undefined)
    const kept = await row('select before_record from bob_private.bob_write_receipts where turn_id=$1 and operation_key=$2', [c.turn, 'lifecycle:delete_task:taskGone'])
    assert.equal(kept.before_record.name, 'Obsolete prep', 'the removed Task is preserved in the ledger')
    const done = await c.tools.execute('delete_project_task', { task_id: 'taskDone', expected_updated_at: await stamp('tasks', 'taskDone'), request_quote: message })
    assert.equal(done.status, 'invalid'); assert.match(done.message, /Completed Tasks are project history and are kept/)
    const foreign = await c.tools.execute('delete_project_task', { task_id: 'taskOther', expected_updated_at: new Date().toISOString(), request_quote: message })
    assert.equal(foreign.status, 'denied'); assert.equal(foreign.reason, 'access')
    assert(await row('select id from bob.tasks where id=$1', ['taskOther']), 'another project is untouched')
    const day = await c.tools.execute('delete_project_build_day', { build_day_id: 'dayGone', expected_updated_at: await stamp('events', 'dayGone'), request_quote: message })
    assert.equal(day.status, 'saved'); assert.equal(day.receipt.dataset, 'events')
    assert(await row('select id from bob.tasks where id=$1', ['taskDone']), 'scheduled Tasks stay when their day goes')
    const item = await c.tools.execute('delete_shopping_item', { shopping_item_id: 'mGone', request_quote: message })
    assert.equal(item.status, 'saved'); assert.equal(item.receipt.dataset, 'materials')
    const stale = await c.tools.execute('delete_project_build_day', { build_day_id: 'dayGone', expected_updated_at: new Date().toISOString(), request_quote: message })
    assert.equal(stale.status, 'conflict', 'reusing the same operation with a changed payload is refused, never replayed')
    const forged = await c.writer.write('delete_shopping_item', { shopping_item_id: 'mGone', request_quote: 'fabricated approval' })
    assert.equal(forged.status, 'invalid')
  } finally { await c.finish() }
})

test('Areas archive and restore with their guards; phases and the build window change with history', async () => {
  await pg.query(`insert into bob.tasks(id,project_id,area_id,name,status) values('taskOpen',$1,'areaKeep','Still open','todo')`, [project])
  const c = await claimed()
  try {
    const archived = await c.tools.execute('archive_project_area', { area_id: 'areaOld', action: 'archive', expected_updated_at: await stamp('areas', 'areaOld'), request_quote: message })
    assert.equal(archived.status, 'saved'); assert(archived.receipt.record.archived_at)
    const busy = await c.tools.execute('archive_project_area', { area_id: 'areaKeep', action: 'archive', expected_updated_at: await stamp('areas', 'areaKeep'), request_quote: message })
    assert.equal(busy.status, 'invalid', 'an Area with unfinished work is refused'); assert.match(busy.message, /Move or finish/)
    const restored = await c.tools.execute('archive_project_area', { area_id: 'areaOld', action: 'restore', expected_updated_at: await stamp('areas', 'areaOld'), request_quote: message })
    assert.equal(restored.status, 'saved'); assert.equal(restored.receipt.record.archived_at, null)
    const phase = await c.tools.execute('set_project_phase', { scope: 'project', area_id: null, phase: 'build', reason: 'Materials are ordered', request_quote: message })
    assert.equal(phase.status, 'saved'); assert.equal(phase.receipt.record.phase, 'build')
    assert.equal((await row("select to_phase,reason from bob.phase_history where project_id=$1 and scope_kind='project' order by recorded_at desc limit 1", [project])).reason, 'Materials are ordered')
    const areaPhase = await c.tools.execute('set_project_phase', { scope: 'area', area_id: 'areaKeep', phase: 'design', reason: 'Layout first', request_quote: message })
    assert.equal(areaPhase.status, 'saved'); assert.equal(areaPhase.receipt.dataset, 'areas')
    const window = await c.tools.execute('update_project_schedule', { start_date: '2026-10-03', end_date: '2026-10-05', expected_updated_at: await stamp('projects', project), request_quote: message })
    assert.equal(window.status, 'saved'); assert.equal(window.receipt.record.start_date, '2026-10-03')
    assert.equal(c.writer.receipts.length, 3, 'receipts keep the latest state per record: the Area, the project and the second Area')
    const backwards = await c.writer.write('update_project_schedule', { start_date: '2026-10-05', end_date: '2026-10-03', expected_updated_at: await stamp('projects', project), request_quote: message })
    assert.equal(backwards.status, 'invalid')
    const cleared = await c.tools.execute('update_project_schedule', { start_date: null, end_date: null, expected_updated_at: await stamp('projects', project), request_quote: message })
    assert.equal(cleared.status, 'saved'); assert.equal(cleared.receipt.record.end_date, null)
  } finally { await c.finish() }
})

test('an image is detached from one target and stays in the library', async () => {
  await pg.exec(`insert into storage.buckets(id,name) values('bob-project-media','bob-project-media') on conflict do nothing`)
  await pg.query(`insert into bob.tasks(id,project_id,area_id,name,status) values('taskPhoto',$1,'areaKeep','Photo task','todo')`, [project])
  const media = randomUUID()
  await call(owner, 'bob.media_command', [project, 'reserve', media, JSON.stringify({ original_name: 'a.png', title: 'Wall photo', purpose: 'proposal', content_type: 'image/png', byte_size: 10, width: 1, height: 1, target_kind: 'task', target_id: 'taskPhoto' })])
  const c = await claimed()
  try {
    const detached = await c.tools.execute('detach_project_image', { image_id: media, target_kind: 'task', target_id: 'taskPhoto', request_quote: message })
    assert.equal(detached.status, 'saved'); assert.equal(detached.receipt.dataset, 'media')
    assert.equal(await row('select id from bob.media_links where media_id=$1', [media]), undefined)
    assert(await row('select id from bob.media_assets where id=$1', [media]), 'the image stays in the library')
    const again = await c.tools.execute('detach_project_image', { image_id: media, target_kind: 'area', target_id: 'areaKeep', request_quote: message })
    assert.equal(again.status, 'invalid'); assert.match(again.message, /Image attachment unavailable/)
  } finally { await c.finish() }
})
