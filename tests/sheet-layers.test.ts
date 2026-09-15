import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'
import { readSheetLayer, sheetLayerForm, sheetLayerInput, sheetPurchaseCount, SHEET_LAYER_METHOD } from '../src/data/sheetLayers.ts'

const pg = new PGlite()
const owner = '00000000-0000-0000-0000-000000000801'
const other = '00000000-0000-0000-0000-000000000802'
const both = '00000000-0000-0000-0000-000000000803'
const outsider = '00000000-0000-0000-0000-000000000804'
const id = (n: number) => '98000000-0000-0000-0000-' + String(n).padStart(12, '0')
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function rpc(name: string, params: unknown[], uid = owner) {
  return (await as(uid, `select bob.${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) data`, params)).rows[0].data as any
}
const json = (data: unknown) => JSON.stringify(data)
const sheet = { layer_count: '2', coverage_kind: 'sheet_dimensions', coverage_truth: 'provided_spec', coverage_source: 'Fixture packaging, not a product recommendation', sheet_width_mm: '1200', sheet_height_mm: '2400' }
const data = (extra: Record<string, unknown> = {}) => ({
  name: 'Chosen fixture board', category: 'Sheet material', area_id: 'areaA', task_id: null,
  waste_percent: '10', assumptions: 'Verify actual layout before purchasing.',
  artifact_id: id(30), artifact_revision: 1, target_revision: 1, stock_allocations: [], sheet_layer: sheet, ...extra,
})
const calculate = (n: number, extra: Record<string, unknown> = {}, uid = owner, action = 'create', expected = 0) =>
  rpc('material_requirement_geometry_command', ['A', action, id(n), expected, json(data(extra))], uid)
const requirement = (action: string, n: number, expected: number) => rpc('material_requirement_command', ['A', action, id(n), expected, '{}'])
async function current(n: number) {
  return (await as(owner, 'select * from bob.current_material_requirements where id=$1', [id(n)])).rows[0] as any
}
async function readiness() {
  return (await as(owner, "select * from bob.current_task_readiness where task_id='sheet-task'")).rows[0] as any
}
const confirm = () => rpc('work_plan_command', ['A', 'sheet-task', 'confirm_readiness', null, 0, '{}'])
let shoppingId: string

before(async () => {
  await pg.exec([
    'create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;',
    'create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);',
    "create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;",
    "create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;",
    'grant usage on schema auth to anon,authenticated;',
    'create schema storage;',
    'create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);',
    'create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));',
    'alter table storage.buckets enable row level security; alter table storage.objects enable row level security;',
    'grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;',
    'create policy unrelated_broad_objects on storage.objects for all to anon,authenticated using(true) with check(true);',
    'create policy unrelated_broad_buckets on storage.buckets for all to anon,authenticated using(true) with check(true);',
    "insert into storage.buckets(id,name) values('other-app','other-app');",
  ].join('\n'))
  for (const [n, uid] of [owner, other, both, outsider].entries()) {
    await pg.query('insert into auth.users values($1,$2,now())', [uid, 'sheet-' + n + '@example.test'])
  }
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const name of (await readdir(legacy)).filter(name => name.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(name, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Wall A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('ownerA','A','Owner','OA',$1),('otherB','B','Other','OB',$2)", [owner, other])
  await setupSharedSocial(pg)
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(name, migrations), 'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1)", [both])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','wall','Wall work'),('siblingA','A','other','Other work'),('areaB','B','private','Private')")
  await pg.exec("insert into bob.tasks(id,area_id,name) values('sheet-task','areaA','Fit chosen board'),('other-task','areaB','Other task')")
  await rpc('phase_command', ['A', 'area', 'areaA', 'build', 'Fixture ready for material checks'])
  await rpc('physical_site_command', ['create', id(1), 0, json({ name: 'Home' })])
  await rpc('physical_building_command', ['create', id(2), 0, json({ name: 'Main house', site_id: id(1) })])
  await rpc('physical_node_command', [id(2), 'space', 'create', id(3), 0, json({ name: 'Room', kind: 'bedroom', truth: 'unknown', measurements: [] })])
  await rpc('physical_scope_command', ['A', 'project', 'link', id(4), json({ target_kind: 'building', building_id: id(2) })])
  const roles = ['wall_width', 'wall_height', 'opening_left', 'opening_sill_height', 'opening_width', 'opening_height']
  const values = ['4200', '2400', '900', '850', '1210', '1200']
  const inputs: Record<string, unknown> = {}
  for (let n = 0; n < roles.length; n++) {
    await rpc('evidence_command', ['A', 'measurement', 'create', id(20 + n), 0, json({ subject: roles[n], value: values[n], unit: 'mm', truth: 'measured', source: 'Tape measured fixture', required: true })])
    inputs[roles[n]] = { id: id(20 + n), revision: 1 }
  }
  await rpc('solution_command', ['A', 'create', id(10), 0, json({ title: 'Chosen wall', description: 'Fixture only', assumptions: '', tradeoffs: '', area_id: 'areaA' })])
  await rpc('solution_command', ['A', 'select', id(10), 0, json({ solution_revision: 1, reason: 'Fixture target' })])
  await rpc('artifact_geometry_command', ['A', 'create', id(30), 0, json({
    title: 'Wall elevation', description: 'Fixture only', status: 'measured', assumptions: '', source_media_id: null,
    target_revision: 1, area_id: 'areaA', building_id: id(2), space_id: id(3), space_revision: 1, stud_spacing_mm: 600, inputs,
  })])
  await rpc('stock_command', ['A', 'create', id(50), 0, json({ name: 'Compatible board offcuts', specification: 'Area explicitly measured; layout suitability separately checked', quantity: '2', unit: 'm2', status: 'available', area_id: 'areaA', notes: '' })])
})
after(() => pg.close())

test('sheet layers multiply exact wall area before a single allowance, stock subtraction and whole-sheet rounding', async () => {
  await calculate(100, { task_id: 'sheet-task', stock_allocations: [{ id: id(50), revision: 1, quantity: '2' }] })
  const row = await current(100)
  assert.equal(row.method_key, SHEET_LAYER_METHOD)
  assert.equal(row.method_version, '1')
  assert.equal(row.source_kind, 'deterministic')
  assert.equal(row.unit, 'm2')
  assert.equal(Number(row.required_quantity), 17.256)
  assert.equal(Number(row.required_with_waste), 18.9816)
  assert.equal(Number(row.stock_quantity), 2)
  assert.equal(Number(row.purchase_increment), 2.88)
  assert.equal(Number(row.purchase_quantity), 17.28)
  assert.equal(sheetPurchaseCount(String(row.purchase_quantity), String(row.purchase_increment)), '6')
  assert.equal(row.sheet_layer.layer_count, 2)
  assert.equal(row.sheet_layer.net_wall_area_m2, '8.628')
  assert.equal(row.sheet_layer.unit_coverage_m2, '2.88')
  assert.equal(row.sheet_layer.sheet_width_mm, '1200')
  assert.equal(row.sheet_layer.pack_coverage_m2, null)
  assert.equal(row.recorded_by, owner)
  assert.match(row.basis, /AREA-BASED ONLY.*not a cut\/layout plan/)
  assert.equal((await as(owner, 'select * from bob.material_requirement_shopping where requirement_id=$1', [id(100)])).rows.length, 0)
  await assert.rejects(calculate(101, { stock_allocations: [{ id: id(50), revision: 1, quantity: '1' }] }), /already reserved/)
})

test('explicit sheet Shopping publish synchronizes whole units without changing canonical readiness or delivery state', async () => {
  assert.equal((await readiness()).readiness_state, 'blocked')
  const published = await requirement('publish', 100, 1)
  shoppingId = published.material_id
  let row = (await as(owner, 'select * from bob.materials where id=$1', [shoppingId])).rows[0] as any
  assert.equal(row.qty, '6 sheets (17.28 m²)')
  assert.equal(row.status, 'needed')
  assert.equal((await as(owner, 'select shopping_edited from bob.material_requirement_shopping_state where requirement_id=$1', [id(100)])).rows[0].shopping_edited, false)
  await as(owner, "update bob.materials set status='ordered',supplier='Fixture supplier',cost='456 kr' where id=$1", [shoppingId])
  assert.equal((await readiness()).readiness_state, 'blocked')
  await as(owner, "update bob.materials set status='delivered' where id=$1", [shoppingId])
  assert.equal((await readiness()).readiness_state, 'unreviewed')
  await confirm()
  assert.equal((await readiness()).readiness_state, 'ready')
  await calculate(100, { task_id: 'sheet-task', sheet_layer: { ...sheet, layer_count: '1' }, stock_allocations: [{ id: id(50), revision: 1, quantity: '2' }], change_note: 'One layer is the new chosen plan' }, owner, 'revise', 1)
  assert.equal((await readiness()).readiness_state, 'blocked')
  row = (await as(owner, 'select * from bob.materials where id=$1', [shoppingId])).rows[0] as any
  assert.equal(row.qty, '6 sheets (17.28 m²)', 'Saving a material revision must not write Shopping')
  await requirement('publish', 100, 2)
  row = (await as(owner, 'select * from bob.materials where id=$1', [shoppingId])).rows[0] as any
  assert.equal(row.qty, '3 sheets (8.64 m²)')
  assert.equal(row.status, 'delivered'); assert.equal(row.supplier, 'Fixture supplier'); assert.equal(row.cost, '456 kr')
  assert.equal((await readiness()).readiness_state, 'unreviewed', 'Changed material truth requires another human review')
  await confirm()
  assert.equal((await readiness()).readiness_state, 'ready')
  await as(owner, "update bob.materials set qty='User edited quantity' where id=$1", [shoppingId])
  assert.equal((await readiness()).readiness_state, 'blocked')
  await requirement('publish', 100, 2)
  assert.equal((await as(owner, 'select shopping_edited from bob.material_requirement_shopping_state where requirement_id=$1', [id(100)])).rows[0].shopping_edited, false)
})

test('recipe versions survive archive and restore without rewriting old layers or Shopping', async () => {
  await requirement('archive', 100, 2)
  assert.equal((await current(100)).sheet_layer.layer_count, 1)
  await requirement('restore', 100, 3)
  const row = await current(100)
  assert.equal(row.revision, 4); assert.equal(row.sheet_layer.layer_count, 1)
  const history = (await as(owner, 'select revision,sheet_layer from bob.material_requirement_revisions where requirement_id=$1 order by revision', [id(100)])).rows as any[]
  assert.deepEqual(history.map(r => r.sheet_layer.layer_count), [2, 1, 1, 1])
  assert.equal((await as(owner, 'select qty from bob.materials where id=$1', [shoppingId])).rows[0].qty, '3 sheets (8.64 m²)')
  await assert.rejects(calculate(100, { change_note: 'Stale writer' }, owner, 'revise', 1), /changed/)
})

test('pack coverage, exact boundaries and fully stocked zero quantities share the same arithmetic', async () => {
  await calculate(110, { waste_percent: '0', sheet_layer: { layer_count: '1', coverage_kind: 'pack_coverage', coverage_truth: 'estimated', coverage_source: 'Fixture estimate', pack_coverage_m2: '4.314' } })
  let row = await current(110)
  assert.equal(Number(row.purchase_quantity), 8.628)
  assert.equal(row.sheet_layer.sheet_width_mm, null)
  assert.equal(row.sheet_layer.pack_coverage_m2, '4.314')
  assert.match(row.basis, /contains explicit estimate/)
  let published = await requirement('publish', 110, 1)
  assert.equal((await as(owner, 'select qty from bob.materials where id=$1', [published.material_id])).rows[0].qty, '2 packs (8.628 m²)')
  await rpc('stock_command', ['A', 'create', id(51), 0, json({ name: 'Fully covering compatible stock', quantity: '20', unit: 'm2', status: 'available' })])
  await calculate(111, { waste_percent: '0', stock_allocations: [{ id: id(51), revision: 1, quantity: '17.256' }] })
  row = await current(111)
  assert.equal(Number(row.purchase_quantity), 0)
  published = await requirement('publish', 111, 1)
  assert.equal((await as(owner, 'select qty from bob.materials where id=$1', [published.material_id])).rows[0].qty, '0 sheets (0 m²)')
  await calculate(112, { sheet_layer: { ...sheet, sheet_width_mm: '1220', sheet_height_mm: '2440' } })
  assert.equal(Number((await current(112)).purchase_increment), 2.9768)
})

test('invalid or forged sheet inputs fail atomically rather than being silently rounded or promoted', async () => {
  const badLayers = [null, { ...sheet, layer_count: '0' }, { ...sheet, layer_count: '21' }, { ...sheet, layer_count: '1.5' },
    { ...sheet, coverage_source: '' }, { ...sheet, coverage_truth: 'verified_by_ai' },
    { ...sheet, sheet_width_mm: '0' }, { ...sheet, sheet_height_mm: 'NaN' }, { ...sheet, sheet_width_mm: '1200.1' },
    { ...sheet, sheet_width_mm: '1221', sheet_height_mm: '2441' }, { ...sheet, pack_coverage_m2: '5' },
    { ...sheet, unit_coverage_m2: '999' }, { ...sheet, layer_count: undefined },
    { layer_count: 1, coverage_kind: 'pack_coverage', coverage_truth: 'provided_spec', coverage_source: 'Package', pack_coverage_m2: '0.12345' },
    { layer_count: 1, coverage_kind: 'pack_coverage', coverage_truth: 'provided_spec', coverage_source: 'Package', pack_coverage_m2: 'Infinity' }]
  let n = 200
  for (const layer of badLayers) {
    await assert.rejects(calculate(n, { sheet_layer: layer }))
    assert.equal((await as(owner, 'select id from bob.material_requirements where id=$1', [id(n++)])).rows.length, 0)
  }
  for (const key of ['required_quantity', 'unit', 'basis', 'source_kind', 'method_key', 'purchase_increment']) {
    await assert.rejects(calculate(n++, { [key]: '999' }), /Unsupported deterministic/)
  }
})

test('project/Area scope, raw-write and anonymous boundaries also protect sheet recipes', async () => {
  await assert.rejects(calculate(300, {}, outsider), /project_denied/)
  await assert.rejects(calculate(301, { area_id: 'siblingA' }, both), /same Project\/Area scope/)
  await assert.rejects(calculate(302, { task_id: 'other-task' }, both), /project_denied/)
  await assert.rejects(rpc('material_requirement_geometry_command', ['B', 'create', id(303), 0, json(data())], both), /current stud_wall_opening_v1/)
  assert.equal((await as(outsider, 'select sheet_layer from bob.current_material_requirements')).rows.length, 0)
  await assert.rejects(as(null, 'select sheet_layer from bob.current_material_requirements', [], 'anon'), /permission denied/)
  await assert.rejects(as(null, 'select bob.material_requirement_geometry_command($1,$2,$3,$4,$5)', ['A', 'create', id(304), 0, json(data())], 'anon'), /permission denied|project_denied/)
  await assert.rejects(as(owner, "update bob.material_requirement_revisions set sheet_layer='{}' where requirement_id=$1", [id(100)]), /permission denied/)
  await assert.rejects(as(owner, "update bob.material_requirement_shopping set synced_qty='forged' where requirement_id=$1", [id(100)]), /permission denied/)
  assert.equal((await current(100)).sheet_layer.layer_count, 1)
})

test('newer drawing revisions make saved sheet plans stale until recalculated against exact current lineage', async () => {
  await rpc('artifact_command', ['A', 'archive', id(30), 1, '{}'])
  await rpc('artifact_command', ['A', 'restore', id(30), 2, '{}'])
  assert.equal((await current(100)).artifact_changed, true)
  await assert.rejects(requirement('publish', 100, 4), /Drawing changed/)
  await assert.rejects(calculate(100, { change_note: 'Old drawing' }, owner, 'revise', 4), /current stud_wall_opening_v1/)
  await calculate(100, { artifact_revision: 3, task_id: 'sheet-task', change_note: 'Recalculate current drawing' }, owner, 'revise', 4)
  const row = await current(100)
  assert.equal(row.revision, 5); assert.equal(row.artifact_revision, 3); assert.equal(row.artifact_changed, false)
  assert.equal(row.sheet_layer.layer_count, 2)
  assert.equal((await as(owner, 'select sheet_layer from bob.material_requirement_revisions where requirement_id=$1 and revision=1', [id(100)])).rows.length, 1)
})

test('purchase-count presentation is exact and incomplete recipes fail closed', () => {
  assert.equal(sheetPurchaseCount('17.2800', '2.8800'), '6')
  assert.equal(sheetPurchaseCount('0.0000', '2.88'), '0')
  assert.equal(sheetPurchaseCount('0.3', '0.1'), '3')
  assert.throws(() => sheetPurchaseCount('8.64', '0'))
  assert.throws(() => sheetPurchaseCount('8.6401', '2.88'))
  assert.throws(() => readSheetLayer(null, SHEET_LAYER_METHOD), /unavailable/)
  assert.equal(readSheetLayer(undefined, 'stud_wall_net_area'), null)
  const form = sheetLayerForm()
  assert.equal(form.coverageTruth, '', 'Certainty must be explicitly chosen')
  assert.equal(sheetLayerInput({ ...form, coverageKind: 'pack_coverage', packCoverage: '4,32' }).pack_coverage_m2, '4.32')
})
