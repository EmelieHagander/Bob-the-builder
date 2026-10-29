// Database load relief (20261029190000). The set-based journal pages must
// return exactly the pages of the loop they replace, and the renamed source
// assessments must keep their callers' signature, settings and grants.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import type { PGlite } from './support/pglite.ts'
import { PRE_RELIEF_DRAWINGS, preReliefConstructionDrawingsSql } from './support/source-assessment-equivalence.ts'

const RELIEF = '20261029190000_bob_db_load_relief.sql'
let pg: PGlite
let preReliefDrawings = ''
const owner = '00000000-0000-4000-8000-000000000001'
const worker = 'https://fixture.supabase.co/functions/v1/bob-worker'
const service = async (name: string, args: unknown[] = []) => (await asProjectUser(pg, null, `select bob.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, 'service_role')).rows[0].result as any
const cursor = (positions: Record<string, number> = {}) => ({ version: 1, positions, reusedModelCalls: 0, uncertainResends: 0 })

before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name === '20260924120448_bob_background_jobs.sql') await db.exec(`create schema cron; create schema net; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint'; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
    if (name !== RELIEF) return
    // Keep the installed loop versions, exactly as they are, under test names.
    for (const fn of ['bob_checkpoint_steps_page', 'bob_job_steps_page']) {
      const def = (await db.query<{ d: string }>('select pg_get_functiondef($1::regprocedure) d', [`bob.${fn}(uuid,uuid,text)`])).rows[0].d
      await db.exec(def.replace(`FUNCTION bob.${fn}(`, `FUNCTION bob.pre_relief_${fn.slice(4)}(`))
    }
    preReliefDrawings = (await db.query<{ s: string }>("select prosrc s from pg_proc where oid='bob_private.artifact_source_assessment_before_construction_drawings(text,uuid,integer)'::regprocedure")).rows[0].s
  })
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'owner@test.invalid'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Build'); insert into bob.areas(id,project_id,slug,name) values('areaA','A','work','Work');")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('one','A','Owner','O',$1)", [owner])
  const current = (await pg.query<any>("select active_version_id from shared.ai_prompts where app='bob' and prompt_key='agent-contract.ask-bob'")).rows[0].active_version_id
  const version = (await pg.query<any>(`insert into shared.ai_prompt_versions(prompt_id,version,content,metadata,available_variables,flow,definition_kind,definition_format_version,definition)
    select prompt_id,(select max(version)+1 from shared.ai_prompt_versions where prompt_id=v.prompt_id),content,metadata||'{"work_allowance_version":1}',available_variables,flow,definition_kind,definition_format_version,definition
    from shared.ai_prompt_versions v where id=$1 returning id`, [current])).rows[0].id
  await pg.query("update shared.ai_prompts set active_version_id=$1 where app='bob' and prompt_key='agent-contract.ask-bob'", [version])
})
after(() => pg.close())

/** A stored operation whose value is exactly `bytes` long as text. */
const put = (job: string, key: string, bytes: number) => pg.query('insert into bob_private.bob_job_steps(job_id,key,fingerprint,value) values($1,$2,$3,$4::jsonb)',
  [job, key, 'f'.repeat(64), bytes === 1 ? '1' : JSON.stringify('x'.repeat(bytes - 2))])

type Page = { same: boolean; entries: number; bytes: number; next: string | null }
/** Old and new page for every cursor: none, empty, each stored key, just after each key, and past the end. */
async function comparePages(job: string, claim: string, phase: string) {
  const keys = (await pg.query<{ key: string }>('select key from bob_private.bob_job_steps where job_id=$1 order by key', [job])).rows.map(r => r.key)
  const cursors: (string | null)[] = [null, '', ...keys, ...keys.map(k => k + '~'), '~~~~']
  const pages: Page[] = []
  for (const fn of ['checkpoint_steps_page', 'job_steps_page']) for (const at of cursors) {
    const page = (await asProjectUser(pg, null, `select o::text=n::text same,jsonb_array_length(n->'entries')::int entries,n->>'next' next,
      (select coalesce(sum(octet_length((e->'value')::text)),0)::int from jsonb_array_elements(n->'entries') e) bytes
      from (select bob.pre_relief_${fn}($1,$2,$3) o,bob.bob_${fn}($1,$2,$3) n) x`, [job, claim, at], 'service_role')).rows[0] as Page
    assert.equal(page.same, true, `${phase}: ${fn} after ${JSON.stringify(at)}`)
    pages.push(page)
  }
  return pages
}

test('journal pages: the set-based page equals the loop for every cursor, size cut, bootstrap and archived epoch', async () => {
  const q = await service('bob_enqueue_job_v4', ['A', owner, randomUUID(), 'Spara uppgiften.', { ciphertext: 'fixture' }, new Date(Date.now() + 3600000).toISOString(), worker, null, null])
  const job = await service('bob_claim_job_v2', [q.jobId, (await pg.query<any>('select capability from bob_private.bob_jobs where id=$1', [q.jobId])).rows[0].capability])
  assert.equal(job.checkpointVersion, 1)
  await pg.query("update bob_private.bob_jobs set lease_until=clock_timestamp()+interval '1 hour' where id=$1", [job.id])
  const save = (revision: number, positions: Record<string, number>) => service('bob_save_turn_checkpoint', [job.id, job.claimToken, revision, {}, cursor(positions)])

  // Startup results become the bootstrap, one of them larger than a page.
  await put(job.id, 'startup:0', 1_100_000); await put(job.id, 'startup:1', 1_100_000); await put(job.id, 'startup:2', 2_500_000)
  await save(0, { startup: 3 })
  // Two entries filling a page exactly, a one-byte entry after them, more
  // than 100 small reads, and a pair that reaches 2,000,000 bytes again.
  await put(job.id, 'm:0', 1_000_000); await put(job.id, 'm:1', 1_000_000); await put(job.id, 'm:2', 1)
  for (let i = 0; i < 105; i++) await put(job.id, `read:${String(i).padStart(3, '0')}`, 3 + (i * 37) % 200)
  await put(job.id, 'w:0', 1_999_999); await put(job.id, 'w:1', 1); await put(job.id, 'x:0', 2_000_001)
  const bootstrap = await comparePages(job.id, job.claimToken, 'bootstrap')

  // A later checkpoint archives earlier reads; new operations join its epoch.
  await save(1, { startup: 3, m: 3, read: 50 })
  const archived = await comparePages(job.id, job.claimToken, 'archived')
  for (let i = 105; i < 111; i++) await put(job.id, `read:${i}`, 50)
  await put(job.id, 'z:0', 1_500_000)
  const tail = await comparePages(job.id, job.claimToken, 'tail')

  const all = [...bootstrap, ...archived, ...tail]
  assert(all.some(p => p.entries > 1 && p.bytes === 2_000_000), 'a page filled to exactly 2,000,000 bytes')
  assert(all.some(p => p.entries === 1 && p.bytes > 2_000_000), 'a single entry larger than a page')
  assert(all.some(p => p.entries === 100 && p.next !== null), 'the 100-row cut')
  assert(all.some(p => p.entries === 0 && p.next === null), 'an empty last page')
  assert.notDeepEqual(archived, bootstrap, 'archiving changed the checkpoint pages')

  // Fences are unchanged: a stale claim fails the same way in both.
  for (const fn of ['pre_relief_checkpoint_steps_page', 'bob_checkpoint_steps_page', 'pre_relief_job_steps_page', 'bob_job_steps_page'])
    await assert.rejects(service(fn, [job.id, randomUUID(), null]), (e: any) => e.code === 'PT409' && /job_not_claimed/.test(e.message), fn)
})

test('source assessments: the slim dispatchers keep signature, settings and grants; the drawings fixture copy is the installed original', async () => {
  const attrs = async (fn: string) => (await pg.query<any>(`select pg_get_function_arguments(oid) args,pg_get_function_result(oid) result,provolatile,prosecdef,proconfig,
    proacl::text acl,pg_get_userbyid(proowner) owner from pg_proc where oid=$1::regprocedure`, [`bob_private.${fn}(text,uuid,integer)`])).rows[0]
  for (const fn of ['artifact_source_assessment_before_physical', 'artifact_source_assessment_before_parameters'])
    assert.deepEqual(await attrs(fn), await attrs(fn + '_full'), fn)
  assert.ok(preReliefDrawings.length > 1000)
  await pg.exec(await preReliefConstructionDrawingsSql())
  const copy = (await pg.query<{ s: string }>(`select prosrc s from pg_proc where oid='bob_private.${PRE_RELIEF_DRAWINGS}(text,uuid,integer)'::regprocedure`)).rows[0].s
  assert.equal(copy, preReliefDrawings, 'equivalence tests compare against what was installed before the relief')
})
