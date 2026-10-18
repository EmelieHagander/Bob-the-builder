import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

// Owner decision 2026-10-18: drawing work has no application budget.
let pg: PGlite
const invoke = async (name: string, args: unknown[], role = 'service_role', user: string | null = null): Promise<any> =>
  (await asProjectUser(pg, user, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
const one = async (sql: string, args: unknown[] = []) => (await pg.query<any>(sql, args)).rows[0]
const scope = { area_id: null, component_id: null, step_id: null, artifact_id: null }
before(async () => { pg = await projectSchema() })
after(() => pg.close())

async function oldOwnerTask() {
  const owner = randomUUID(), turn = randomUUID(), request = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now())', [owner, owner + '@example.test'])
  const project = (await invoke('bob.create_project', [{ name: 'No budget fixture' }], 'authenticated', owner)).id
  const c = await invoke('bob.bob_claim_turn', [project, owner, turn, 'Draw the bed'])
  await invoke('bob.create_drawing_request', [project, c.thread_id, turn, c.generation, request, scope], 'authenticated', owner)
  await invoke('bob.bob_drawing_request', [project, owner, c.thread_id, turn, c.generation, 'save', request, 0, 'draft',
    { brief: scope, owner_request: 'Draw the bed', reference_refs: [] }, randomUUID()])
  return { owner, project, thread: c.thread_id as string, turn, request, generation: c.generation as number }
}

test('the owner budget grant no longer exists', async () => {
  assert.equal((await one("select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='bob' and p.proname='grant_drawing_budget'")).n, 0)
})

test('an exhausted older allocation no longer limits the owner task or its projection', async () => {
  const f = await oldOwnerTask()
  // Allocation of an owner message from before unlimited work, fully spent.
  await pg.query('update bob_private.drawing_budgets set calls=call_limit,spent_usd=usd_limit where request_id=$1', [f.request])
  assert.equal((await one('select bob_private.bob_task_unlimited_work($1,$2,$3,$4) v', [f.project, f.owner, f.thread, f.turn])).v, true)
  const page = await invoke('bob.drawing_work_list', [f.project, null, null], 'authenticated', f.owner)
  const work = page.items.find((item: any) => item.request.id === f.request)
  assert.equal(work.budget.unlimited_work, true, 'the UI shows a cost log, not a stopped limit')
})

test('an automatic drawing job for an older owner message runs without allotments under the active catalog', async () => {
  const f = await oldOwnerTask()
  const job = randomUUID()
  await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,credential,worker_url,expires_at,drawing_request_id,drawing_event_revision)
    values($1,$2,$3,$4,$5,$6,'{}','https://fixture.supabase.co/functions/v1/bob-worker',now()+interval '20 minutes',$7,0)`,
    [job, f.project, f.owner, f.thread, f.turn, f.generation + 1, f.request])
  const row = await one('select work_allowance_version,ai_catalog_manifest_id from bob_private.bob_jobs where id=$1', [job])
  assert.equal(row.work_allowance_version, 1)
  assert.equal(row.ai_catalog_manifest_id, (await one("select shared.resolve_ai_catalog('bob')->>'manifest_id' id")).id)
  assert.equal((await one('select bob_private.bob_job_unlimited_work($1) v', [job])).v, true)
})
