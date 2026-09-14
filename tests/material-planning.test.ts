import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createMaterialPlanning } from '../src/data/materialPlanning'
import { setupSharedSocial } from './support/shared-social'

const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const outsider = '00000000-0000-0000-0000-000000000004'
const id = (n: number) => '50000000-0000-0000-0000-' + String(n).padStart(12, '0')

async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}

async function evidence(project: string, uid: string, kind: 'measurement' | 'component', action: string, record: string, expected: number, data: Record<string, unknown>) {
  return (await as(uid, 'select bob.evidence_command($1,$2,$3,$4,$5,$6) as data',
    [project, kind, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
async function solution(project: string, uid: string, action: string, record: string | null, expected: number, data: Record<string, unknown>) {
  return (await as(uid, 'select bob.solution_command($1,$2,$3,$4,$5) as data',
    [project, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
async function artifact(project: string, uid: string, action: string, record: string, expected: number, data: Record<string, unknown> = {}) {
  return (await as(uid, 'select bob.artifact_command($1,$2,$3,$4,$5) as data',
    [project, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
async function stock(project: string, uid: string, action: string, record: string, expected: number, data: Record<string, unknown> = {}) {
  return (await as(uid, 'select bob.stock_command($1,$2,$3,$4,$5) as data',
    [project, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}
async function requirement(project: string, uid: string, action: string, record: string, expected: number, data: Record<string, unknown> = {}) {
  return (await as(uid, 'select bob.material_requirement_command($1,$2,$3,$4,$5) as data',
    [project, action, record, expected, JSON.stringify(data)])).rows[0].data as any
}

const proposal = (title = 'Keep the porch', extra: Record<string, unknown> = {}) => ({
  title, description: 'Manual material planning target.', assumptions: 'Foundation still to inspect', tradeoffs: 'Manual fixture', ...extra,
})
const drawing = (targetRevision: number, extra: Record<string, unknown> = {}) => ({
  title: 'Entrance section', description: 'Manual section used by the material plan.', kind: 'section', status: 'measured',
  assumptions: 'Ground condition still to inspect.', source_media_id: null, measurements: [], target_revision: targetRevision, ...extra,
})
const stockData = (extra: Record<string, unknown> = {}) => ({
  name: 'Saved boards', specification: 'Dry stored', quantity: '5', unit: 'pcs', status: 'available', area_id: 'areaA', notes: '', ...extra,
})
const componentData = (extra: Record<string, unknown> = {}) => ({
  name: 'Existing window', kind: 'Window', quantity: 2, condition: 'Not structurally assessed', specification: '1180×1700',
  intent: 'reuse', notes: '', source_media_id: null, ...extra,
})
const material = (targetRevision: number, extra: Record<string, unknown> = {}) => ({
  name: 'Studs 45×95', category: 'Timber', area_id: 'areaA', task_id: 'taskA', unit: 'pcs', required_quantity: '10',
  waste_percent: '10', purchase_increment: '1', basis: 'Manual count from the selected entrance section.', assumptions: 'One spare included through allowance.',
  artifact_id: id(20), artifact_revision: 1, target_revision: targetRevision, stock_allocations: [], component_allocations: [], ...extra,
})

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
  for (const [i, uid] of [one, two, both, outsider].entries()) {
    await pg.query('insert into auth.users values($1,$2,now())', [uid, 'materials' + i + '@example.test'])
  }
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  }
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Porch A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)", [one, two])
  const dir = new URL('../supabase/migrations/', import.meta.url)
  await setupSharedSocial(pg)
  for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, dir), 'utf8'))
  }
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1)", [both])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','entry','Entry'),('areaB','B','private','Private')")
  await pg.exec("insert into bob.tasks(id,area_id,name) values('taskA','areaA','Frame opening'),('taskB','areaB','Private task')")

  await solution('A', one, 'create', id(10), 0, proposal())
  await solution('A', one, 'select', id(10), 0, { solution_revision: 1, reason: 'Selected for materials' })
  await artifact('A', one, 'create', id(20), 0, drawing(1, { area_id: 'areaA' }))
  await evidence('A', one, 'component', 'create', id(30), 0, componentData())
  await solution('B', two, 'create', id(11), 0, proposal('Private target', { area_id: 'areaB' }))
  await solution('B', two, 'select', id(11), 0, { solution_revision: 1, reason: 'Private choice' })
  await artifact('B', two, 'create', id(21), 0, drawing(1, { area_id: 'areaB' }))
  await evidence('B', two, 'component', 'create', id(31), 0, componentData({ name: 'Private window', area_id: 'areaB' }))
})
after(() => pg.close())

test('manual requirement stores exact lineage and deterministic purchase arithmetic', async () => {
  await stock('A', one, 'create', id(40), 0, stockData())
  await requirement('A', one, 'create', id(50), 0, material(1, {
    stock_allocations: [{ id: id(40), revision: 1, quantity: '3' }],
    component_allocations: [{ id: id(30), revision: 1, quantity: 2 }],
  }))
  const current = (await as(one, 'select * from bob.current_material_requirements where id=$1', [id(50)])).rows[0] as any
  assert.equal(Number(current.required_quantity), 10)
  assert.equal(Number(current.required_with_waste), 11)
  assert.equal(Number(current.stock_quantity), 3)
  assert.equal(Number(current.component_quantity), 2)
  assert.equal(Number(current.purchase_quantity), 6)
  assert.equal(current.source_kind, 'manual')
  assert.equal(current.target_revision, 1)
  assert.equal(current.solution_revision, 1)
  assert.equal(current.artifact_id, id(20))
  assert.equal(current.artifact_revision, 1)
  assert.equal(current.area_title, 'Entry')
  assert.equal(current.task_title, 'Frame opening')
  assert.equal(current.target_changed, false)
  const stockRefs = (await as(one, 'select * from bob.material_requirement_stock_details where requirement_id=$1', [id(50)])).rows as any[]
  assert.equal(stockRefs[0].stock_revision, 1)
  assert.equal(Number(stockRefs[0].quantity), 3)
  const componentRefs = (await as(one, 'select * from bob.material_requirement_component_details where requirement_id=$1', [id(50)])).rows as any[]
  assert.equal(componentRefs[0].component_revision, 1)
  assert.equal(componentRefs[0].quantity, 2)
})

test('waste, full stock coverage and purchase increments stay deterministic and numeric', async () => {
  await stock('A', one, 'create', id(41), 0, stockData({ name: 'Insulation rolls', quantity: '12.5', unit: 'm2', area_id: null }))
  await requirement('A', one, 'create', id(51), 0, material(1, {
    name: 'Insulation', category: 'Insulation', task_id: '', artifact_id: '', artifact_revision: '',
    unit: 'm2', required_quantity: '10.25', waste_percent: '7.5', purchase_increment: '2.5',
    stock_allocations: [{ id: id(41), revision: 1, quantity: '4.5' }], component_allocations: [],
  }))
  let row = (await as(one, 'select * from bob.current_material_requirements where id=$1', [id(51)])).rows[0] as any
  assert.equal(Number(row.required_with_waste), 11.0188)
  assert.equal(Number(row.purchase_quantity), 7.5)

  await requirement('A', one, 'revise', id(51), 1, material(1, {
    name: 'Insulation', category: 'Insulation', task_id: '', artifact_id: '', artifact_revision: '',
    unit: 'm2', required_quantity: '10.25', waste_percent: '0', purchase_increment: '2.5', change_note: 'Use confirmed stock',
    stock_allocations: [{ id: id(41), revision: 1, quantity: '12.5' }], component_allocations: [],
  }))
  row = (await as(one, 'select * from bob.current_material_requirements where id=$1', [id(51)])).rows[0] as any
  assert.equal(Number(row.required_with_waste), 10.25)
  assert.equal(Number(row.purchase_quantity), 0)
})

test('current requirements cannot double reserve material stock or reusable components', async () => {
  await stock('A', one, 'create', id(42), 0, stockData({ name: 'Short stock', quantity: '4' }))
  await requirement('A', one, 'create', id(52), 0, material(1, {
    artifact_id: '', artifact_revision: '', stock_allocations: [{ id: id(42), revision: 1, quantity: '3' }], component_allocations: [],
  }))
  await assert.rejects(requirement('A', one, 'create', id(53), 0, material(1, {
    artifact_id: '', artifact_revision: '', stock_allocations: [{ id: id(42), revision: 1, quantity: '2' }], component_allocations: [],
  })), /already reserved/)
  await requirement('A', one, 'create', id(53), 0, material(1, {
    artifact_id: '', artifact_revision: '', stock_allocations: [{ id: id(42), revision: 1, quantity: '1' }], component_allocations: [],
  }))

  await evidence('A', one, 'component', 'create', id(32), 0, componentData({ name: 'Spare reusable window' }))
  await requirement('A', one, 'create', id(54), 0, material(1, {
    artifact_id: '', artifact_revision: '', stock_allocations: [], component_allocations: [{ id: id(32), revision: 1, quantity: 1 }],
  }))
  await assert.rejects(requirement('A', one, 'create', id(55), 0, material(1, {
    artifact_id: '', artifact_revision: '', stock_allocations: [], component_allocations: [{ id: id(32), revision: 1, quantity: 2 }],
  })), /already reserved/)
})

test('later target, drawing, stock and component truth make old requirements stale without rewriting history', async () => {
  await stock('A', one, 'revise', id(40), 1, stockData({ quantity: '6', change_note: 'Found one more board' }))
  await evidence('A', one, 'component', 'revise', id(30), 1, componentData({ condition: 'Rechecked paint only', change_note: 'Reinspect' }))
  await artifact('A', one, 'revise', id(20), 1, { ...drawing(1, { area_id: undefined }), description: 'Newer section details.', change_note: 'Clarify floor edge' })
  await solution('A', one, 'revise', id(10), 1, proposal('Keep the porch', { description: 'Revised material target.', change_note: 'Refine target' }))
  await solution('A', one, 'select', id(10), 1, { solution_revision: 2, reason: 'Use revised target' })

  const row = (await as(one, 'select * from bob.current_material_requirements where id=$1', [id(50)])).rows[0] as any
  assert.equal(row.target_changed, true)
  assert.equal(row.artifact_changed, true)
  assert.equal(row.stock_changed, true)
  assert.equal(row.component_changed, true)
  const old = (await as(one, 'select * from bob.material_requirement_revisions where requirement_id=$1 and revision=1', [id(50)])).rows[0] as any
  assert.equal(old.target_revision, 1)
  assert.equal(old.artifact_revision, 1)
  assert.equal(Number(old.purchase_quantity), 6)
  await assert.rejects(requirement('A', one, 'publish', id(50), 1), /target changed/i)
})

test('membership, same-project relations and raw-write boundaries hold', async () => {
  for (const table of ['stock_items','stock_revisions','material_requirements','material_requirement_revisions','material_requirement_stock','material_requirement_components','material_requirement_shopping','current_stock_items','current_material_requirements','material_requirement_stock_details','material_requirement_component_details','material_requirement_shopping_state']) {
    assert.equal((await as(outsider, 'select * from bob.' + table)).rows.length, 0)
    await assert.rejects(as(null, 'select * from bob.' + table, [], 'anon'), /permission denied/)
  }
  for (const table of ['stock_items','stock_revisions','material_requirements','material_requirement_revisions','material_requirement_stock','material_requirement_components','material_requirement_shopping']) {
    await assert.rejects(as(one, 'delete from bob.' + table), /permission denied/)
  }
  await assert.rejects(stock('A', outsider, 'create', id(60), 0, stockData()), /project_denied/)
  await stock('B', two, 'create', id(61), 0, stockData({ name: 'Private stock', area_id: 'areaB' }))
  await assert.rejects(requirement('A', both, 'create', id(62), 0, material(2, {
    area_id: 'areaB', task_id: '', artifact_id: '', artifact_revision: '', stock_allocations: [], component_allocations: [],
  })), /project_denied/)
  await assert.rejects(requirement('A', both, 'create', id(62), 0, material(2, {
    task_id: '', artifact_id: '', artifact_revision: '', stock_allocations: [{ id: id(61), revision: 1, quantity: 1 }], component_allocations: [],
  })), /unavailable|project/i)
  await assert.rejects(requirement('A', both, 'create', id(62), 0, material(2, {
    task_id: '', artifact_id: id(21), artifact_revision: 1, stock_allocations: [], component_allocations: [],
  })), /unavailable in this project/)
  await assert.rejects(requirement('A', one, 'create', id(62), 0, { ...material(2), purchase_quantity: 1 }), /Unsupported fields/)
})

test('shopping handoff is explicit, preserves shopping state and reports independent edits', async () => {
  await artifact('A', one, 'revise', id(20), 2, { ...drawing(2), description: 'Section reviewed for target decision two.', change_note: 'Align drawing with new target' })
  await requirement('A', one, 'revise', id(50), 1, material(2, {
    artifact_id: id(20), artifact_revision: 3, stock_allocations: [{ id: id(40), revision: 2, quantity: '3' }],
    component_allocations: [{ id: id(30), revision: 2, quantity: 2 }], change_note: 'Review against latest target and sources',
  }))
  const published = await requirement('A', one, 'publish', id(50), 2)
  const materialId = published.material_id as string
  let shopping = (await as(one, 'select * from bob.materials where id=$1', [materialId])).rows[0] as any
  assert.equal(shopping.name, 'Studs 45×95')
  assert.equal(shopping.qty, '6 pcs')
  assert.equal(shopping.status, 'needed')

  await as(one, "update bob.materials set supplier='Local yard',cost='900 kr',status='ordered',name='Edited shopping name' where id=$1", [materialId])
  let state = (await as(one, 'select * from bob.material_requirement_shopping_state where requirement_id=$1', [id(50)])).rows[0] as any
  assert.equal(state.shopping_edited, true)
  await requirement('A', one, 'publish', id(50), 2)
  shopping = (await as(one, 'select * from bob.materials where id=$1', [materialId])).rows[0] as any
  assert.equal(shopping.name, 'Studs 45×95')
  assert.equal(shopping.supplier, 'Local yard')
  assert.equal(shopping.cost, '900 kr')
  assert.equal(shopping.status, 'ordered')

  await requirement('A', one, 'revise', id(50), 2, material(2, {
    required_quantity: '12', artifact_id: id(20), artifact_revision: 3,
    stock_allocations: [{ id: id(40), revision: 2, quantity: '3' }], component_allocations: [{ id: id(30), revision: 2, quantity: 2 }],
    change_note: 'Need two more studs',
  }))
  state = (await as(one, 'select * from bob.material_requirement_shopping_state where requirement_id=$1', [id(50)])).rows[0] as any
  assert.equal(state.source_outdated, true)
  await requirement('A', one, 'publish', id(50), 3)
  shopping = (await as(one, 'select * from bob.materials where id=$1', [materialId])).rows[0] as any
  assert.equal(shopping.qty, '9 pcs')
  assert.equal(shopping.status, 'ordered')
})

test('archive/restore keeps history and Shopping while stale/raw writes fail', async () => {
  await assert.rejects(requirement('A', one, 'revise', id(50), 2, { ...material(2), change_note: 'Old write' }), /changed/)
  await requirement('A', one, 'archive', id(50), 3)
  const linkBefore = (await as(one, 'select material_id from bob.material_requirement_shopping where requirement_id=$1', [id(50)])).rows[0] as any
  assert(linkBefore.material_id)
  assert.equal((await as(one, 'select id from bob.materials where id=$1', [linkBefore.material_id])).rows.length, 1)
  await requirement('A', one, 'restore', id(50), 4)
  const history = (await as(one, 'select revision,archived,purchase_quantity from bob.material_requirement_revisions where requirement_id=$1 order by revision', [id(50)])).rows as any[]
  assert.deepEqual(history.slice(-2).map(row => row.archived), [true, false])
  assert.equal(Number(history.at(-1).purchase_quantity), Number(history[history.length - 3].purchase_quantity))
})

test('restore refuses stale or newly overbooked allocations', async () => {
  await stock('A', one, 'create', id(43), 0, stockData({ name: 'Restore stock', quantity: '4' }))
  await requirement('A', one, 'create', id(56), 0, material(2, {
    artifact_id: '', artifact_revision: '', stock_allocations: [{ id: id(43), revision: 1, quantity: '3' }], component_allocations: [],
  }))
  await requirement('A', one, 'archive', id(56), 1)
  await requirement('A', one, 'create', id(57), 0, material(2, {
    artifact_id: '', artifact_revision: '', stock_allocations: [{ id: id(43), revision: 1, quantity: '3' }], component_allocations: [],
  }))
  await assert.rejects(requirement('A', one, 'restore', id(56), 2), /already reserved/)
})

test('task/area deletion keeps recorded titles, project deletion cascades, and the data adapter rejects delayed project changes', async () => {
  await pg.exec("delete from bob.tasks where id='taskA'; delete from bob.areas where id='areaA';")
  const row = (await as(one, 'select area_id,area_title,task_id,task_title from bob.current_material_requirements where id=$1', [id(50)])).rows[0] as any
  assert.equal(row.area_id, null)
  assert.equal(row.task_id, null)
  assert.equal(row.area_title, 'Entry')
  assert.equal(row.task_title, 'Frame opening')

  let generation = 0
  let queryResolve: ((value: any) => void) | undefined
  const fake = {
    from() {
      const chain: any = {
        select: () => chain, eq: () => chain, order: () => chain,
        range: () => new Promise(resolve => { queryResolve = resolve }),
      }
      return chain
    },
  }
  const adapter = createMaterialPlanning(fake as any, () => {
    const captured = generation
    return () => { if (captured !== generation) throw new Error('Project or sign-in changed. Reopen the project before continuing.') }
  })
  const delayed = adapter.requirements('A')
  generation++
  queryResolve?.({ data: [], error: null })
  await assert.rejects(delayed, /Project or sign-in changed/)

  await pg.exec("delete from bob.projects where id='A'")
  for (const table of ['stock_items','stock_revisions','material_requirements','material_requirement_revisions','material_requirement_stock','material_requirement_components','material_requirement_shopping']) {
    assert.equal((await pg.query('select * from bob.' + table + " where project_id='A'")).rows.length, 0)
  }
  assert.equal((await as(two, 'select * from bob.current_stock_items')).rows.length, 1)
})
