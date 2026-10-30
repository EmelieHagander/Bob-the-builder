import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import type { PGlite } from './support/pglite.ts'

// Owner decisions 2026-10-29 after the independent review of the material tables
// (Docs/archive/material-tables-review-2026-10-29.md), and follow-up 1: Bob's new
// materials become shared and unreviewed, sharing only the specification.
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002'
const both = '00000000-0000-4000-8000-000000000005', homeOnly = '00000000-0000-4000-8000-000000000006'
const homeA = '10000000-0000-4000-8000-000000000001'
let pg: PGlite
const as = async (uid: string | null, sql: string, values: unknown[] = [], role = 'authenticated') => (await asProjectUser(pg, uid, sql, values, role)).rows as any[]
const call = async (uid: string, fn: string, ...args: unknown[]) =>
  (await as(uid, `select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args.map(a => typeof a === 'object' && a !== null ? JSON.stringify(a) : a)))[0].r
const rejects = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, (e: any) => e.code === code || String(e.message).includes(code))
const lookup = (uid: string, query: string | null, project = 'A') => call(uid, 'bob.material_lookup', project, { query, categories: [], after: null, id: null })
const len = (value: string | null) => ({ value, unit: 'mm', truth: value === null ? 'unknown' : 'provided_spec', parameter: null, note: value === null ? 'Inte mätt' : '' })
const material = (name: string, properties: Record<string, unknown>, categories = ['wood.plywood', 'sheet'], profile = 'sheet_stock') => ({ action: 'ensure', key: name, kind: 'material', name, aliases: [],
  profile_code: profile, profile_revision: 1, categories, properties, material_id: null, material_revision: null, notes: 'Bobs egna ord om ' + name, source_kind: 'design_choice', source_quote: 'x', source_seq: null })
// Bob's catalog writer calls this private command inside a claimed turn.
const save = async (uid: string, project: string, data: unknown, id: string | null = null, expected = 0) => (await pg.transaction(async tx => {
  await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
  return tx.query<any>('select bob_private.catalog_save($1,$2,$3,$4,$5) r', [project, id, expected, JSON.stringify(data),
    JSON.stringify({ kind: 'design_choice', quote: 'x', seq: null, thread: '20000000-0000-4000-8000-000000000001' })])
})).rows[0].r
const sharedItem = async (seedMaterial: string, seedSize: string) => (await pg.query<any>(`select i.id from bob.catalog_items i join bob.material_types t on t.id=i.material_type_id
  join bob.material_sizes s on s.id=i.material_size_id where i.project_id is null and t.seed_key=$1 and s.seed_key=$2`, [seedMaterial, seedSize])).rows[0].id as string
const stock = (uid: string, project: string, id: string, action: string, expected: number, data: Record<string, unknown> = {}) =>
  call(uid, 'bob.stock_command', project, action, id, expected, data)
const plank = (quantity: number, extra: Record<string, unknown> = {}) => ({ name: 'Plywood från hemma', specification: '', quantity, unit: 'pcs', status: 'available', area_id: null, notes: '', change_note: '', ...extra })

before(async () => {
  pg = await projectSchema()
  for (const uid of [one, two, both, homeOnly]) await pg.query('insert into auth.users values($1,$2,now())', [uid, uid + '@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Material A'),('B','b','Material B')")
  await pg.query(`insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','O',$1),('twoB','B','Two','T',$2),
    ('bothA','A','Both','B',$3),('bothB','B','Both','B',$3)`, [one, two, both])
  await pg.query("insert into shared.households(id,name) values($1,'Hemma A')", [homeA])
  await pg.query(`insert into shared.household_access(household_id,user_id,status) values($1,$2,'active'),($1,$3,'active'),($1,$4,'active')`, [homeA, one, both, homeOnly])
})
after(() => pg.close())

test('only Bob project participants write shared rows; a household member from another app cannot', async () => {
  await rejects(call(homeOnly, 'bob.add_material_type', { name: 'Intrång', category_code: 'wood', description: null }), '42501')
  await rejects(call(homeOnly, 'bob.add_store', { name: 'Butiken', chain: null, city: null, address: null, url: null }), '42501')
  assert.equal((await call(one, 'bob.add_material_type', { name: 'Masonit', category_code: 'wood', description: null })).operation, 'created')
})

test('shared aliases, store articles and household stock may name shared definitions only', async () => {
  const privateItem = (await save(one, 'A', material('Hemliga köksbänken', { thickness: len(null) }))).record.id
  await rejects(call(one, 'bob.add_material_alias', { alias: 'köksbänk', material_type_id: null, material_size_id: null, catalog_item_id: privateItem }), 'material_alias_target')
  await rejects(call(one, 'bob.add_store_article', { store_id: null, catalog_item_id: privateItem, title: 'Bänk', article_number: null, url: null, pack_quantity: null, pack_unit_code: null }), 'material_invalid_field')
  await rejects(call(one, 'bob.save_household_stock', homeA, null, 0, { catalog_item_id: privateItem, name: null, quantity: 1, unit_code: 'pcs', location: null, notes: null }), 'material_invalid_field')
  const shared = await sharedItem('plywood_birch', 's12')
  assert.equal((await call(one, 'bob.add_material_alias', { alias: 'björkskiva tolv', material_type_id: null, material_size_id: null, catalog_item_id: shared })).operation, 'created')
  assert.equal((await as(two, "select count(*)::int n from bob.material_aliases where alias ilike '%köksbänk%'"))[0].n, 0)
})

test('an unreviewed alias still finds a definition, but after reviewed matches and marked as unreviewed', async () => {
  const drywall = (await pg.query<any>("select id from bob.material_types where seed_key='drywall_screw'")).rows[0].id
  await call(one, 'bob.add_material_alias', { alias: 'gips', material_type_id: drywall, material_size_id: null, catalog_item_id: null })
  const rows = (await lookup(one, 'gips')).items
  assert.equal(rows[0].name, 'Gipsskiva, standard 12,5 × 1200 × 2400')
  assert(rows.slice(1).every((r: any) => r.name.startsWith('Gipsskruv')) && rows.length === 3, JSON.stringify(rows.map((r: any) => r.name)))
  assert(rows[1].unreviewed_aliases.includes('gips') && !rows[1].aliases.includes('gips'))
})

test('a reviewed price wins over a newer unreviewed one, an empty price is never current, and a pack price needs pack content', async () => {
  const shared = await sharedItem('plywood_birch', 's15')
  const store = (await call(one, 'bob.add_store', { name: 'Brädgården', chain: null, city: null, address: null, url: null })).record.id
  const article = (await call(one, 'bob.add_store_article', { store_id: store, catalog_item_id: shared, title: null, article_number: 'P15', url: null, pack_quantity: null, pack_unit_code: null })).record.id
  const price = (value: number | null, basis: string | null = 'unit') => call(one, 'bob.record_store_price', { store_article_id: article, price: value, currency: 'SEK',
    price_unit_code: 'pcs', price_basis: basis, vat_included: true, source_kind: 'manual', source_url: null, note: null, observed_on: null })
  const first = await price(499)
  await pg.query("update bob.store_article_prices set review_status='reviewed' where id=$1", [first.record.id])
  await price(1); await price(null)
  const row = (await call(one, 'bob.material_lookup', 'A', { query: null, categories: [], after: null, id: shared })).items[0]
  assert.equal(row.price, 499); assert.equal(row.price_unreviewed, false); assert.equal(row.price_basis, 'unit')
  await rejects(price(129, 'pack'), 'material_price_pack_unknown')
  const view = (await as(one, 'select price,review_status from bob.current_store_prices where store_article_id=$1', [article]))[0]
  assert.deepEqual([Number(view.price), view.review_status], [499, 'reviewed'])
})

test('spec links change only against the current revision and must fit the definition; older revisions read without them', async () => {
  const saved = await save(one, 'A', material('Skiva till hyllan', { thickness: len('17') }))
  const id = saved.record.id
  const sizeOf = async (key: string) => (await pg.query<any>('select id from bob.material_sizes where seed_key=$1', [key])).rows[0].id
  const typeOf = async (key: string) => (await pg.query<any>('select id from bob.material_types where seed_key=$1', [key])).rows[0].id
  const set = (data: Record<string, unknown>, revision = 1) => call(one, 'bob.set_catalog_item_spec', id, { revision, ...data })
  await rejects(set({ unit_code: 'pcs' }, 2), '40001')
  await rejects(set({ material_size_id: await sizeOf('s12') }), 'material_spec_size_mismatch')
  await rejects(set({ material_size_id: await sizeOf('f40x40') }), 'material_spec_form_mismatch')
  await rejects(set({ material_type_id: await typeOf('drywall_screw') }), 'material_spec_category_mismatch')
  await rejects(set({ unit_code: 'm' }), 'material_spec_unit_mismatch')
  await rejects(set({ weight_kg: 9 }), 'material_spec_weight_needs_unit')
  const before = await set({ unit_code: 'pcs' })
  assert.equal(before.record.spec.unit, 'pcs'); assert(before.record.spec.size, 'the automatic share link is kept when only the unit changes')
  const revised = await save(one, 'A', { ...material('Skiva till hyllan', { thickness: len('21') }), action: 'revise' }, id, 1)
  assert.equal(revised.record.revision, 2)
  const old = await call(one, 'bob.catalog_read', 'A', { action: 'read', kind: null, query: null, after: null, id, revision: 1, profile_code: null, categories: [], properties: {} })
  assert.equal(Object.hasOwn(old.record, 'spec'), false, 'an older revision carries no current links')
})

test('household stock keeps history and a name, needs a unit with a quantity, and is never promised twice', async () => {
  const shared = await sharedItem('plywood_birch', 's18')
  await rejects(call(one, 'bob.save_household_stock', homeA, null, 0, { catalog_item_id: shared, name: null, quantity: 10, unit_code: null, location: null, notes: null }), 'household_stock_unit_required')
  const home = (await call(one, 'bob.save_household_stock', homeA, null, 0, { catalog_item_id: shared, name: null, quantity: 10, unit_code: 'pcs', location: 'Garaget', notes: null })).record
  assert.equal(home.name, 'Plywood, björk 18 × 1220 × 2440', 'the definition name is kept on the row')
  const [a1, b1, b2] = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003']
  await stock(both, 'A', a1, 'create', 0, plank(6, { household_stock_id: home.id }))
  await rejects(stock(both, 'B', b1, 'create', 0, plank(5, { household_stock_id: home.id })), 'household_stock_overpromised')
  await rejects(stock(both, 'B', b1, 'create', 0, { ...plank(4, { household_stock_id: home.id }), unit: 'm' }), 'household_stock_unit_mismatch')
  await stock(both, 'B', b2, 'create', 0, plank(4, { household_stock_id: home.id }))
  await rejects(stock(two, 'B', '30000000-0000-4000-8000-000000000004', 'create', 0, plank(1, { household_stock_id: home.id })), '42501')
  await rejects(call(one, 'bob.save_household_stock', homeA, home.id, 1, { catalog_item_id: shared, name: null, quantity: 9, unit_code: 'pcs', location: 'Garaget', notes: null }), 'household_stock_promised')
  await rejects(call(one, 'bob.remove_household_stock', homeA, home.id, 1), 'household_stock_in_use')
  // A revision keeps its link; archiving releases the promise and restoring checks it again.
  const kept = await stock(both, 'A', a1, 'revise', 1, plank(6, { change_note: 'Räknat om' }))
  assert.equal((await pg.query<any>('select household_stock_id from bob.stock_revisions where stock_id=$1 and revision=$2', [a1, kept.revision])).rows[0].household_stock_id, home.id)
  await stock(both, 'A', a1, 'archive', 2)
  const reduced = await call(one, 'bob.save_household_stock', homeA, home.id, 1, { catalog_item_id: shared, name: null, quantity: 5, unit_code: 'pcs', location: 'Garaget', notes: null })
  await rejects(stock(both, 'A', a1, 'restore', 3), 'household_stock_overpromised')
  const history = (await as(one, 'select revision,quantity,removed from bob.household_stock_revisions where household_stock_id=$1 order by revision', [home.id]))
  assert.deepEqual(history.map(r => [r.revision, Number(r.quantity), r.removed]), [[1, 10, false], [2, 5, false]])
  assert.equal(reduced.record.revision, 2)
})

test('empty or mislabelled shared rows are refused, and linked materials cannot be deleted', async () => {
  await rejects(call(one, 'bob.add_material_type', { name: null, category_code: 'wood', description: null }), 'material_invalid_field:name')
  await rejects(call(one, 'bob.add_material_type', { name: 'OSB/3', category_code: 'plastic', description: null }), 'material_type_category_conflict')
  await rejects(call(one, 'bob.add_material_size', { label: null, form_code: 'sheet', length_mm: null, width_mm: null, depth_mm: 9 }), 'material_invalid_field:label')
  const tenMetre = await call(one, 'bob.add_material_size', { label: 'Rulle 1 × 10 m', form_code: 'roll', length_mm: 10000, width_mm: 1000, depth_mm: null })
  const fifteen = await call(one, 'bob.add_material_size', { label: 'Rulle 1 × 15 m', form_code: 'roll', length_mm: 10000, width_mm: 1000, depth_mm: null })
  assert.notEqual(fifteen.record.id, tenMetre.record.id, 'a different label is a different size')
  await rejects(call(one, 'bob.add_store_article', { store_id: null, catalog_item_id: null, title: null, article_number: null, url: null, pack_quantity: null, pack_unit_code: null }), 'material_invalid_field:article')
  await rejects(pg.query("delete from bob.material_types where seed_key='c24'"), '23001')
})

test('a new project material is shared as a dimension-only, unreviewed standard material and reused across projects', async () => {
  const mine = await save(one, 'A', material('Plywood till sängen', { thickness: len('18') }))
  const link = (await pg.query<any>('select material_type_id,material_size_id from bob.catalog_items where id=$1', [mine.record.id])).rows[0]
  const shared = (await pg.query<any>(`select i.id,i.review_status,r.name,r.notes,r.properties,t.name type_name,t.review_status type_status,s.label,s.review_status size_status
    from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision join bob.material_types t on t.id=i.material_type_id
    join bob.material_sizes s on s.id=i.material_size_id where i.project_id is null and i.material_type_id=$1 and i.material_size_id=$2`, [link.material_type_id, link.material_size_id])).rows
  assert.equal(shared.length, 1)
  const [row] = shared
  assert.deepEqual([row.name, row.type_name, row.label, row.review_status, row.type_status, row.size_status],
    ['Plywood 18 mm', 'Plywood', '18 mm', 'unreviewed', 'unreviewed', 'unreviewed'])
  assert.deepEqual(Object.keys(row.properties), ['thickness'])
  assert.doesNotMatch(JSON.stringify(row), /sängen|Bobs egna ord/, 'only the specification is shared')
  // Another project's equal specification reuses the same shared entry.
  const theirs = await save(two, 'B', material('Plywood till bänken', { thickness: len('18') }))
  assert.deepEqual((await pg.query<any>('select material_type_id,material_size_id from bob.catalog_items where id=$1', [theirs.record.id])).rows[0], link)
  assert.equal((await pg.query<any>("select count(*)::int n from bob.catalog_items where project_id is null and material_type_id=$1 and material_size_id=$2", [link.material_type_id, link.material_size_id])).rows[0].n, 1)
  // An existing reviewed size with the same dimensions is reused for timber.
  const stud = await save(one, 'A', material('Reglar till väggen', { thickness: len('45'), width: len('95') }, ['wood.softwood', 'rectangular_profile'], 'rectangular_profile'))
  assert.equal((await pg.query<any>('select s.seed_key from bob.catalog_items i join bob.material_sizes s on s.id=i.material_size_id where i.id=$1', [stud.record.id])).rows[0].seed_key, 'p45x95')
  // Incomplete definitions are not shared.
  const unknown = await save(one, 'A', material('Okänd skiva', { thickness: len(null) }))
  assert.deepEqual((await pg.query<any>('select material_type_id,material_size_id from bob.catalog_items where id=$1', [unknown.record.id])).rows[0], { material_type_id: null, material_size_id: null })
  // A tube's size is its outside diameter and wall (owner decision 2026-10-30); different walls get different sizes.
  const tube = await save(one, 'A', material('Rör till räcket', { outside_diameter: len('32'), wall_thickness: len('2') }, ['plastic.pvc', 'tube'], 'tube_stock'))
  const thick = await save(two, 'B', material('Tjockt rör', { outside_diameter: len('32'), wall_thickness: len('3') }, ['plastic.pvc', 'tube'], 'tube_stock'))
  const tubeSize = async (id: string) => (await pg.query<any>(`select s.label,s.diameter_mm::float8 dia,s.depth_mm::float8 wall,s.width_mm,s.review_status
    from bob.catalog_items i join bob.material_sizes s on s.id=i.material_size_id where i.id=$1`, [id])).rows[0]
  assert.deepEqual(await tubeSize(tube.record.id), { label: 'Ø 32 × 2', dia: 32, wall: 2, width_mm: null, review_status: 'unreviewed' })
  assert.deepEqual(await tubeSize(thick.record.id), { label: 'Ø 32 × 3', dia: 32, wall: 3, width_mm: null, review_status: 'unreviewed' })
  // Shared entries rank after reviewed ones in the lookup.
  // Rows within one rank follow their ids, so only the order of reviewed before unreviewed is fixed.
  const plywood18 = (await lookup(one, 'plywood 18')).items.map((r: any) => [r.name, r.unreviewed])
  const firstUnreviewed = plywood18.findIndex((r: any) => r[1] === true)
  assert(firstUnreviewed > 0 && plywood18.slice(firstUnreviewed).every((r: any) => r[1] === true), JSON.stringify(plywood18))
  assert(plywood18.some((r: any) => r[0] === 'Plywood 18 mm' && r[1] === true), JSON.stringify(plywood18))
})

// Owner decision 2026-10-30: the remaining small findings (review M2, M3, M6, M8, M9).
test('sizes carry a diameter and six decimals; fasteners use the diameter and nails read diameter first', async () => {
  const sizes = (await pg.query<any>(`select seed_key,label,diameter_mm::float8 dia,width_mm,length_mm::float8 len from bob.material_sizes where form_code='fastener' order by seed_key`)).rows
  assert(sizes.every(s => s.dia > 0 && s.width_mm === null), JSON.stringify(sizes))
  assert.deepEqual(sizes.filter(s => s.seed_key.startsWith('n')).map(s => s.label), ['3,4 × 100', '2,8 × 75'])
  assert(sizes.every(s => Number(s.label.split(' × ')[0].replace(',', '.')) === s.dia), 'every fastener label puts the diameter first')
  const sixty4th = await call(one, 'bob.add_material_size', { label: '1/64 tum', form_code: 'sheet', depth_mm: '0.396875' })
  assert.equal(Number(sixty4th.record.depth_mm), 0.396875)
  const rod = await call(one, 'bob.add_material_size', { label: 'Ø 8', form_code: 'tube', diameter_mm: 8, depth_mm: 1 })
  assert.equal((await call(two, 'bob.add_material_size', { label: 'Ø 8', form_code: 'tube', diameter_mm: '8', depth_mm: 1 })).record.id, rod.record.id)
  assert.equal((await call(two, 'bob.add_material_size', { label: 'Ø 8', form_code: 'tube', diameter_mm: 10, depth_mm: 1 })).operation, 'created', 'the diameter is part of a size')
})

test('C4 and stainless outdoor screws are separate reviewed materials; renamed definitions keep their history', async () => {
  const rows = (await pg.query<any>(`select t.seed_key,t.name type_name,s.label,i.current_revision,i.review_status,r.name,r.notes,i.identity_hash,md5(r.identity_document::text) doc_hash,
    (select array_agg(category_code order by category_code) from bob.catalog_item_categories c where c.item_id=i.id and c.item_revision=i.current_revision) cats
    from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision join bob.material_types t on t.id=i.material_type_id
    join bob.material_sizes s on s.id=i.material_size_id where i.project_id is null and t.seed_key in ('outdoor_screw','stainless_screw','wire_nail_zinc') order by t.seed_key,s.label`)).rows
  assert.deepEqual(rows.map(r => [r.seed_key, r.name, r.current_revision, r.review_status]), [
    ['outdoor_screw', 'Utomhusskruv C4 4,2 × 55', 2, 'reviewed'], ['outdoor_screw', 'Utomhusskruv C4 5,0 × 60', 2, 'reviewed'],
    ['stainless_screw', 'Rostfri skruv 4,2 × 55', 1, 'reviewed'], ['stainless_screw', 'Rostfri skruv 5,0 × 60', 1, 'reviewed'],
    ['wire_nail_zinc', 'Trådspik, förzinkad 2,8 × 75', 2, 'reviewed'], ['wire_nail_zinc', 'Trådspik, förzinkad 3,4 × 100', 2, 'reviewed']])
  assert(rows.every(r => r.identity_hash === r.doc_hash && r.notes.includes(r.type_name) && r.cats.join() === 'fastener,metal'), JSON.stringify(rows))
  const first = (await pg.query<any>(`select r.name from bob.catalog_item_revisions r join bob.catalog_items i on i.id=r.item_id join bob.material_types t on t.id=i.material_type_id
    where t.seed_key='outdoor_screw' and r.revision=1 order by r.name`)).rows.map(r => r.name)
  assert.deepEqual(first, ['Utomhusskruv, C4/rostfri 4,2 × 55', 'Utomhusskruv, C4/rostfri 5,0 × 60'])
  const aliases = (await pg.query<any>(`select t.seed_key,array_agg(a.alias order by a.alias) aliases from bob.material_aliases a join bob.material_types t on t.id=a.material_type_id
    where t.seed_key in ('outdoor_screw','stainless_screw') group by 1 order by 1`)).rows
  assert.deepEqual(aliases, [{ seed_key: 'outdoor_screw', aliases: ['trallskruv', 'utomhusskruv'] }, { seed_key: 'stainless_screw', aliases: ['rostfri skruv'] }])
})

test('household stock can say six pieces of 3.0 m, keeps it in history and shows it in the lookup', async () => {
  const stud = await sharedItem('c24', 'p45x95')
  await rejects(call(one, 'bob.save_household_stock', homeA, null, 0, { catalog_item_id: stud, quantity: 18, unit_code: 'm', piece_length_mm: 3000 }), 'household_stock_piece_length_needs_pieces')
  const saved = await call(one, 'bob.save_household_stock', homeA, null, 0, { catalog_item_id: stud, quantity: 6, unit_code: 'pcs', piece_length_mm: '3000', location: 'Garaget' })
  assert.equal(Number(saved.record.piece_length_mm), 3000)
  const history = (await pg.query<any>('select piece_length_mm::float8 p from bob.household_stock_revisions where household_stock_id=$1', [saved.record.id])).rows
  assert.deepEqual(history, [{ p: 3000 }])
  const row = (await lookup(one, 'c24 45x95')).items.find((r: any) => r.id === stud)
  assert.deepEqual(row.stock_at_home.map((s: any) => [s.quantity, s.unit, s.piece_length_mm]), [[6, 'pcs', 3000]])
  await rejects(as(one, 'update bob.household_stock set unit_code=$2 where id=$1', [saved.record.id, 'm']), '42501')
})

test('store articles are indexed by store, the unused supplier link is gone and the lookup price is the current-price view', async () => {
  const indexes = (await pg.query<any>("select indexdef from pg_indexes where schemaname='bob' and tablename='store_articles'")).rows.map(r => r.indexdef)
  assert(indexes.some(d => /store_articles_store_idx ON bob\.store_articles USING btree \(store_id\)$/.test(d)), JSON.stringify(indexes))
  assert.equal((await pg.query<any>("select count(*)::int n from information_schema.columns where table_schema='bob' and table_name='supplier_articles' and column_name='store_article_id'")).rows[0].n, 0)
  const source = (await pg.query<any>("select pg_get_functiondef('bob_private.material_lookup_row(uuid,uuid,uuid[])'::regprocedure) d")).rows[0].d
  assert.match(source, /bob\.current_store_prices/); assert.doesNotMatch(source, /from bob\.store_article_prices/)
})
