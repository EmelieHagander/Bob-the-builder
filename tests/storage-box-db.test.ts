import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { storageBoxGeometry } from '../src/lib/storageBox.ts'

const pg = new PGlite()
const one = '00000000-0000-4000-8000-000000000001'
const two = '00000000-0000-4000-8000-000000000002'
const both = '00000000-0000-4000-8000-000000000003'
const guest = '00000000-0000-4000-8000-000000000004'
const id = (n: number) => '70000000-0000-4000-8000-' + String(n).padStart(12, '0')
const recipe = { generator: 'storage_box_v1', version: 1, width_mm: 800, height_mm: 350, depth_mm: 600, thickness_mm: 18 }
const drawing = (extra: Record<string, unknown> = {}) => ({ title: 'Storage box', description: 'Five-panel open-top storage box', assumptions: 'Design specification, not measured site fit.',
  target_revision: 1, area_id: 'areaA', recipe, measurements: [], ...extra })
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated'): Promise<any> {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function box(n: number, data = drawing(), action = 'create', expected = 0, uid = one, project = 'A'): Promise<any> {
  return (await as(uid, 'select bob.artifact_box_command($1,$2,$3,$4,$5) result', [project, action, id(n), expected, JSON.stringify(data)])).rows[0].result
}
async function saved(n: number, rev: number, uid = one): Promise<any> {
  return (await as(uid, 'select * from bob.artifact_parametric_recipes where artifact_id=$1 and artifact_revision=$2', [id(n), rev])).rows[0]
}
const json = (v: unknown) => JSON.stringify(v)
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
  for (const [i, uid] of [one,two,both,guest].entries()) await pg.query('insert into auth.users values($1,$2,now())', [uid,uid===guest?'guest@bob.local':`write${i}@example.test`])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Porch A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)", [one,two])
  await setupSharedSocial(pg)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, dir), 'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1),('guestA','A','Guest','G',$2)", [both,guest])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','entry','Entry'),('areaB','B','private','Private'); insert into bob.tasks(id,area_id,name,hours) values('taskA','areaA','Original','2h'),('taskB','areaB','Private work','')")
  for (const [n, area_id] of [[2, 'areaA']] as const) {
    await as(one, 'select bob.solution_command($1,$2,$3,$4,$5)', ['A','create',id(n),0,json({ title:'Storage proposal',description:'Open-top box',assumptions:'Material and fit to verify',tradeoffs:'Simple joinery',area_id })])
    await as(one, 'select bob.solution_command($1,$2,$3,$4,$5)', ['A','select',id(n),0,json({ solution_revision:1,reason:'Use this scope',area_id })])
  }
})
after(() => pg.close())

test('box command persists a Concept recipe on the exact canonical Area target and retains dimensional meaning', async () => {
  await box(10)
  const record = (await as(one, 'select * from bob.current_artifacts where id=$1', [id(10)])).rows[0]
  assert.equal(record.area_id, 'areaA'); assert.equal(record.solution_id, id(2)); assert.equal(record.target_revision, 1)
  assert.equal(record.kind, 'detail'); assert.equal(record.status, 'concept')
  assert.deepEqual((await saved(10, 1)).recipe, recipe)
  assert.equal(storageBoxGeometry((await saved(10, 1)).recipe).parts[2].lengthMm, 764)
  assert.equal((await as(one, 'select count(*)::int n from bob.current_measurements')).rows[0].n, 0, 'no proposed dimensions are written as site facts')
})

test('impossible, unknown-version and overprecise geometry and approval fields fail before any revision is created', async () => {
  for (const r of [null, [], { ...recipe, version: 2 }, { ...recipe, generator: 'unrestricted' }, { ...recipe, width_mm: 36 },
    { ...recipe, height_mm: 18 }, { ...recipe, depth_mm: 35 }, { ...recipe, thickness_mm: 100.01 }, { ...recipe, width_mm: 800.0001 },
    { ...recipe, width_mm: '800' }, { ...recipe, arbitrary: 'SVG' }]) await assert.rejects(box(11, drawing({ recipe: r })))
  for (const fields of [{ status: 'build_ready' }, { project_id: 'B' }, { actor_id: two }, { source_media_id: id(90) }]) {
    await assert.rejects(box(11, drawing(fields)), /Unsupported storage box fields/)
  }
  assert.equal(await saved(11, 1), undefined)
  await box(11, drawing({ recipe: { ...recipe, width_mm: 800.001, thickness_mm: 18.003 } }))
  assert.equal(storageBoxGeometry((await saved(11, 1)).recipe).innerWidthMm, 763.995)
})

test('raw writes and anonymous access are denied; cross-project and foreign Area attachments cannot broaden authority', async () => {
  await assert.rejects(as(one, 'update bob.artifact_parametric_recipes set recipe=$1', [json(recipe)]), /permission denied/)
  await assert.rejects(as(one, 'delete from bob.artifact_parametric_recipes'), /permission denied/)
  await assert.rejects(as(null, 'select * from bob.artifact_parametric_recipes', [], 'anon'), /permission denied/)
  assert.equal((await as(two, 'select * from bob.artifact_parametric_recipes')).rows.length, 0)
  await assert.rejects(box(12, drawing(), 'create', 0, two), /project_denied/)
  await assert.rejects(box(12, drawing({ area_id: 'areaB' }), 'create', 0, both), /Area|area|project/)
  await assert.rejects(box(10, drawing({ area_id: undefined, change_note: 'wrong project' }), 'regenerate', 1, both, 'B'), /unavailable/)
})

test('revision edits change dependent dimensions without altering old versions and reject lost updates', async () => {
  const old = await saved(10, 1)
  await box(10, drawing({ area_id: undefined, change_note: 'Lower box only', recipe: { ...recipe, height_mm: 300 } }), 'regenerate', 1)
  assert.deepEqual(await saved(10, 1), old)
  assert.equal(storageBoxGeometry((await saved(10, 2)).recipe).parts[1].widthMm, 282)
  await assert.rejects(box(10, drawing({ area_id: undefined, change_note: 'Stale edit' }), 'regenerate', 1), /Drawing changed/)
  assert.equal(await saved(10, 3), undefined)
})

test('archive and restore carry exact geometry and history while keeping current recipe reads coherent', async () => {
  const previous = await saved(10, 2)
  for (const [action, expected] of [['archive', 2], ['restore', 3]] as const) {
    await as(one, 'select bob.artifact_command($1,$2,$3,$4,$5)', ['A', action, id(10), expected, '{}'])
    assert.deepEqual((await saved(10, expected + 1)).recipe, previous.recipe)
  }
  const current = (await as(one, 'select * from bob.current_parametric_recipes where artifact_id=$1', [id(10)])).rows[0]
  assert.equal(current.artifact_revision, 4)
  assert.deepEqual(current.recipe, previous.recipe)
})

test('evidence revisions stay pinned after remeasurement; cross-project evidence is denied even for a dual member', async () => {
  const measurement = { subject: 'Available width', value: '820', unit: 'mm', truth: 'measured', source: 'User tape measurement', required: true }
  await as(one, "select bob.evidence_command('A','measurement','create',$1,0,$2)", [id(50), json(measurement)])
  await box(13, drawing({ measurements: [{ id: id(50), revision: 1 }] }))
  await as(one, "select bob.evidence_command('A','measurement','revise',$1,1,$2)", [id(50), json({ ...measurement, value: '830', change_note: 'Measured again' })])
  const pinned = (await as(one, 'select * from bob.artifact_measurement_details where artifact_id=$1', [id(13)])).rows[0]
  assert.equal(pinned.measurement_revision, 1); assert.equal(pinned.latest_revision, 2); assert.equal(Number(pinned.value), 820)
  assert.equal((await saved(13, 1)).recipe.width_mm, 800)
  await as(two, "select bob.evidence_command('B','measurement','create',$1,0,$2)", [id(51), json(measurement)])
  await assert.rejects(box(14, drawing({ measurements: [{ id: id(51), revision: 1 }] }), 'create', 0, both), /Measurement|measurement/)
})

test('research v3 returns the exact current recipe through caller RLS; v2 remains compatible', async () => {
  const result = (await as(one, "select bob.search_bob_project_data_v3('A','artifacts',null,null,null,$1,null) result", [id(10)])).rows[0].result
  assert.equal(result.records[0].revision, 4)
  assert.deepEqual(result.records[0].parametric_recipe, (await saved(10, 4)).recipe)
  const legacy = (await as(one, "select bob.search_bob_project_data_v2('A','artifacts',null,null,null,$1,null) result", [id(10)])).rows[0].result
  assert.equal(legacy.records[0].parametric_recipe, undefined)
  await assert.rejects(as(two, "select bob.search_bob_project_data_v3('A','artifacts')"), /project_denied/)
  const foreign = (await as(both, "select bob.search_bob_project_data_v3('B','artifacts',null,null,null,$1,null) result", [id(10)])).rows[0].result
  assert.equal(foreign.records.length, 0)
})

let turn = 100
async function claim() {
  const turnId = id(turn++)
  const c = (await as(null, 'select bob.bob_claim_turn($1,$2,$3,$4) result', ['A', one, turnId, 'Rita lådan enligt mitt val.'], 'service_role')).rows[0].result
  assert.equal(c.status, 'claimed')
  return { p: ['A', c.thread_id, turnId, c.generation], generation: c.generation }
}
const payload = (extra = {}) => ({ kind: 'drawing', record_id: null, expected_updated_at: null, expected_revision: 0,
  request_quote: 'Rita lådan', data: drawing(), ...extra })
async function write(c: Awaited<ReturnType<typeof claim>>, value = payload(), uid = one) {
  return (await as(uid, 'select bob.bob_project_write_v2($1,$2,$3,$4,$5) result', [...c.p, json(value)])).rows[0].result
}
async function finish(c: Awaited<ReturnType<typeof claim>>) {
  await as(null, 'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', ['A', one, c.p[1], c.p[2], c.p[3]], 'service_role')
}

test('Bob drawing writes use the claimed turn, one atomic receipt and idempotent retry, never duplicate drawings', async t => {
  const c = await claim(); t.after(() => finish(c))
  const receipt = await write(c)
  assert.equal(receipt.dataset, 'artifacts'); assert.equal(receipt.revision, 1); assert.equal(receipt.areaId, 'areaA')
  assert.equal(receipt.record.recipe.height_mm, 350); assert.equal(receipt.record.status, 'concept')
  assert.deepEqual(await write(c), receipt)
  await assert.rejects(write(c, payload({ data: drawing({ recipe: { ...recipe, height_mm: 300 } }) })), /operation_reused/)
  const receipts = (await as(one, 'select bob.bob_read_write_receipts($1,$2,$3,$4) result', c.p)).rows[0].result
  assert.equal(receipts.length, 1); assert.equal(receipts[0].recordId, receipt.recordId)
})

test('Bob cannot change another user turn, forge an approval quote, set readiness or write after settlement', async t => {
  const c = await claim(); t.after(() => finish(c))
  await assert.rejects(write(c, payload(), both), /project_denied|turn_not_claimed/)
  await assert.rejects(write(c, payload({ request_quote: 'Spara något annat' })), /request_quote_required/)
  await assert.rejects(write(c, payload({ data: drawing({ status: 'build_ready' }) })), /Unsupported storage box fields/)
  const settled = (await as(one, 'select bob.bob_settle_project_writes($1,$2,$3,$4) result', c.p)).rows[0].result
  await assert.rejects(write(c), /turn_not_claimed/)
  c.p[3] = settled.generation
})

test('Bob can revise the same drawing in another turn and the old saved recipe remains reproducible', async t => {
  const c = await claim(); t.after(() => finish(c))
  const receipt = await write(c, payload({ record_id: id(10), expected_revision: 4,
    data: drawing({ area_id: undefined, change_note: 'Reduce depth', recipe: { ...recipe, height_mm: 300, depth_mm: 550 } }) }))
  assert.equal(receipt.revision, 5); assert.equal(receipt.operation, 'updated')
  assert.equal(receipt.record.recipe.depth_mm, 550)
  assert.equal((await saved(10, 4)).recipe.depth_mm, 600)
})

test('target changes are explicit: old lineage survives, stale saves fail and regeneration pins the new decision', async () => {
  await as(one, "select bob.solution_command('A','select',$1,1,$2)", [id(2), json({ solution_revision: 1, reason: 'Confirm changed design scope', area_id: 'areaA' })])
  await assert.rejects(box(15), /target changed|Target changed/)
  assert.equal(await saved(15, 1), undefined)
  await box(15, drawing({ target_revision: 2 }))
  const old = (await as(one, 'select target_revision from bob.current_artifacts where id=$1', [id(10)])).rows[0]
  assert.equal(old.target_revision, 1)
  assert.equal((await as(one, 'select target_revision from bob.current_artifacts where id=$1', [id(15)])).rows[0].target_revision, 2)
})
