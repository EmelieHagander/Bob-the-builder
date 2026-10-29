import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import type { PGlite } from './support/pglite.ts'
import { standardMaterialsSeedSql, validateStandardMaterials, type StandardMaterials } from '../scripts/build-standard-materials-seed.ts'
import { createMaterialCatalogReader } from '../supabase/functions/_shared/material-catalog.ts'
import { catalogFixture, preMaterialLookupCatalogFixture } from './support/ai-catalog-fixture.ts'
import { MATERIAL_LOOKUP_NOTE } from '../scripts/build-material-lookup-catalog.ts'

// Owner decisions 2026-10-29: normalized materials, sizes, aliases, household
// stock, shared stores with price history, and one combined lookup per
// combination and purchase place.
const SEED = 'supabase/migrations/20261029160100_standard_materials_seed.sql'
const data = JSON.parse(readFileSync(new URL('../scripts/data/standard-materials.json', import.meta.url), 'utf8')) as StandardMaterials
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002'
const invited = '00000000-0000-4000-8000-000000000003', outsider = '00000000-0000-4000-8000-000000000004'
const homeA = '10000000-0000-4000-8000-000000000001', homeB = '10000000-0000-4000-8000-000000000002'
let pg: PGlite
const as = async (uid: string | null, sql: string, values: unknown[] = [], role = 'authenticated') => (await asProjectUser(pg, uid, sql, values, role)).rows as any[]
const call = async (uid: string, fn: string, ...args: unknown[]) =>
  (await as(uid, `select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args.map(a => typeof a === 'object' && a !== null ? JSON.stringify(a) : a)))[0].r
const rejects = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, (e: any) => e.code === code || String(e.message).includes(code))
const lookup = (uid: string, input: Record<string, unknown>, project = 'A') =>
  call(uid, 'bob.material_lookup', project, { query: null, categories: [], after: null, id: null, ...input })
const shared = async (material: string, size: string | null) => (await pg.query<any>(`select i.id from bob.catalog_items i join bob.material_types t on t.id=i.material_type_id
  left join bob.material_sizes s on s.id=i.material_size_id where i.project_id is null and t.seed_key=$1 and s.seed_key is not distinct from $2`, [material, size])).rows[0].id as string

before(async () => {
  pg = await projectSchema()
  for (const uid of [one, two, invited, outsider]) await pg.query('insert into auth.users values($1,$2,now())', [uid, uid + '@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Material A'),('B','b','Material B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','O',$1),('twoB','B','Two','T',$2)", [one, two])
  await pg.query("insert into shared.households(id,name) values($1,'Hemma A'),($2,'Hemma B')", [homeA, homeB])
  await pg.query(`insert into shared.household_access(household_id,user_id,status) values($1,$3,'active'),($2,$4,'active'),($1,$5,'invited')`, [homeA, homeB, one, two, invited])
})
after(() => pg.close())

test('the seed holds the reviewed starting list once, through the catalog identity rules, and re-applies without changes', async () => {
  const counts = async () => (await pg.query<any>(`select (select count(*)::int from bob.material_types where review_status='reviewed') t,
    (select count(*)::int from bob.material_sizes where review_status='reviewed') s,(select count(*)::int from bob.material_aliases) a,
    (select count(*)::int from bob.catalog_items where project_id is null and material_type_id is not null and review_status='reviewed') c`)).rows[0]
  const aliases = data.materials.reduce((n, m) => n + m.aliases.length, 0) + data.sizes.reduce((n, s) => n + s.aliases.length, 0)
  const expected = { t: data.materials.length, s: data.sizes.length, a: aliases, c: data.combinations.length }
  assert.deepEqual(await counts(), expected)
  await pg.exec(readFileSync(SEED, 'utf8'))
  assert.deepEqual(await counts(), expected)
  assert.equal(readFileSync(SEED, 'utf8'), standardMaterialsSeedSql(data))
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-standard-materials-seed.ts', SEED, '--check'])
  // Every combination is an ordinary catalog material definition Bob can pin.
  const items = (await pg.query<any>(`select r.name,r.profile_code,r.properties,r.source_kind,i.unit_code,i.weight_kg,i.identity_hash,r.has_unknown,
    (select array_agg(category_code order by category_code) from bob.catalog_item_categories c where c.item_id=i.id and c.item_revision=i.current_revision) cats
    from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision where i.project_id is null`)).rows
  assert(items.every(i => i.source_kind === 'seed' && i.weight_kg === null && i.cats.length === 2))
  assert(items.every(i => (i.identity_hash === null) === i.has_unknown), 'unknown specifications never get an identity')
})

test('dimensions map onto existing profiles; unstated optional values stay absent and size-less combinations are valid', async () => {
  const props = async (material: string, size: string | null) => (await pg.query<any>(`select r.profile_code,r.properties,i.material_size_id,i.unit_code
    from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision where i.id=$1`, [await shared(material, size)])).rows[0]
  const sheet = await props('plywood_birch', 's12')
  assert.equal(sheet.profile_code, 'sheet_stock'); assert.equal(sheet.properties.thickness.value, '12'); assert.equal(sheet.properties.nominal_size.value, '12 × 1220 × 2440')
  const stud = await props('c24', 'p45x95')
  assert.equal(stud.profile_code, 'rectangular_profile'); assert.equal(stud.properties.thickness.value, '45'); assert.equal(stud.properties.width.value, '95'); assert.equal(stud.unit_code, 'm')
  const screw = await props('wood_screw_zinc', 'f50x80')
  assert.equal(screw.profile_code, 'fastener'); assert.equal(screw.properties.diameter.value, '5'); assert.equal(screw.properties.length.value, '80')
  const gypsum = await props('gypsum_standard', 'g125')
  assert.equal(gypsum.properties.thickness.value, '12.5')
  const felt = await props('underlay_felt', null)
  assert.equal(felt.material_size_id, null); assert.equal(felt.profile_code, 'roll_stock'); assert.deepEqual(felt.properties, {}); assert.equal(felt.unit_code, 'm2')
  const roofSteel = await props('roof_steel', null)
  // Owner decision 2026-10-29: thickness is optional, so the unstated value is absent, not an "unknown" placeholder.
  assert.deepEqual(roofSteel.properties, {})
  const roofHistory = (await pg.query<any>(`select r.revision,r.has_unknown,r.properties ? 'thickness' as had_thickness,i.identity_hash is not null as identified
    from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id where i.id=$1 order by r.revision`, [await shared('roof_steel', null)])).rows
  assert.deepEqual(roofHistory.map(r => [r.revision, r.has_unknown, r.had_thickness, r.identified]), [[1, true, true, true], [2, false, false, true]])
  assert.equal((await props('concrete_tile', null)).profile_code, 'piece')
  const fastener = (await pg.query<any>("select width_mm,length_mm,depth_mm from bob.material_sizes where seed_key='f50x80'")).rows[0]
  assert.equal(Number(fastener.width_mm), 5); assert.equal(Number(fastener.length_mm), 80); assert.equal(fastener.depth_mm, null)
})

test('the source list is validated before any SQL is generated', () => {
  const broken = structuredClone(data); broken.combinations.push({ material: 'missing', size: null, unit: 'pcs', form: 'piece' })
  assert.throws(() => validateStandardMaterials(broken), /unknown material/)
  const noForm = structuredClone(data); delete noForm.combinations.find(c => c.size === null)!.form
  assert.throws(() => validateStandardMaterials(noForm), /form of/)
})

test('participants add nullable shared entries as unreviewed; only the service role reviews; others are denied', async () => {
  const type = await call(one, 'bob.add_material_type', { name: 'Furu, kärnvirke', category_code: 'wood.softwood', description: null })
  assert.equal(type.operation, 'created'); assert.equal(type.record.review_status, 'unreviewed'); assert.equal(type.record.created_by, one)
  assert.equal((await call(two, 'bob.add_material_type', { name: ' furu, KÄRNVIRKE ' })).operation, 'reused')
  const size = await call(one, 'bob.add_material_size', { label: '70 × 70', form_code: 'rectangular_profile', width_mm: 70, depth_mm: '70', length_mm: null })
  assert.equal(size.record.length_mm, null); assert.equal(size.record.review_status, 'unreviewed')
  assert.equal((await call(one, 'bob.add_material_size', { label: '45 × 95', form_code: 'rectangular_profile', width_mm: 95, depth_mm: 45 })).record.review_status, 'reviewed', 'an equal reviewed size is reused')
  await rejects(call(one, 'bob.add_material_size', { form_code: 'wood' }), '22023')
  await rejects(call(one, 'bob.add_material_type', { name: 'X', category_code: 'sheet' }), '22023')
  const alias = await call(one, 'bob.add_material_alias', { alias: 'kärnfuru', material_type_id: type.record.id })
  assert.equal(alias.record.review_status, 'unreviewed')
  await rejects(call(one, 'bob.add_material_alias', { alias: 'x', material_type_id: type.record.id, material_size_id: size.record.id }), '22023')
  await rejects(call(outsider, 'bob.add_material_type', { name: 'Utomstående' }), '42501')
  await rejects(as(one, "insert into bob.material_types(name,review_status) values('Direkt','reviewed')"), '42501')
  await rejects(as(one, "update bob.material_types set review_status='reviewed'"), '42501')
  await rejects(as(null, 'select bob.add_material_type($1)', [JSON.stringify({ name: 'Anon' })], 'anon'), '42501')
  await as(null, "update bob.material_types set review_status='reviewed' where id=$1", [type.record.id], 'service_role')
  assert.equal((await pg.query<any>('select review_status from bob.material_types where id=$1', [type.record.id])).rows[0].review_status, 'reviewed')
})

test('household stock is visible and writable only with active household access, with revision checks and nullable fields', async () => {
  const plywood = await shared('plywood_birch', 's12')
  const saved = await call(one, 'bob.save_household_stock', homeA, null, 0, { catalog_item_id: plywood, quantity: 3, unit_code: 'pcs', location: 'Förrådet' })
  assert.equal(saved.operation, 'created'); assert.equal(saved.record.revision, 1)
  const loose = await call(one, 'bob.save_household_stock', homeA, null, 0, { name: 'Gamla brädor' })
  assert.equal(loose.record.quantity, null); assert.equal(loose.record.catalog_item_id, null)
  await rejects(call(one, 'bob.save_household_stock', homeA, null, 0, {}), '22023')
  assert.equal((await as(two, 'select * from bob.household_stock')).length, 0)
  assert.equal((await as(invited, 'select * from bob.household_stock')).length, 0)
  assert.equal((await as(one, 'select * from bob.household_stock')).length, 2)
  await rejects(call(two, 'bob.save_household_stock', homeA, null, 0, { name: 'Intrång' }), '42501')
  await rejects(call(invited, 'bob.save_household_stock', homeA, null, 0, { name: 'Inbjuden' }), '42501')
  await rejects(call(two, 'bob.save_household_stock', homeB, saved.record.id, 1, { name: 'Fel hushåll' }), '42501')
  await rejects(call(one, 'bob.save_household_stock', homeA, saved.record.id, 7, { catalog_item_id: plywood, quantity: 2 }), '40001')
  const revised = await call(one, 'bob.save_household_stock', homeA, saved.record.id, 1, { catalog_item_id: plywood, quantity: 2, unit_code: 'pcs', location: 'Garaget' })
  assert.equal(revised.record.revision, 2); assert.equal(Number(revised.record.quantity), 2)
  await rejects(as(one, "update bob.household_stock set quantity=99"), '42501')
  assert.equal((await call(one, 'bob.remove_household_stock', homeA, loose.record.id, 1)).operation, 'deleted')
})

test('prices are appended with history and the current view shows the latest price and when it changed', async () => {
  const stud = await shared('c24', 'p45x95')
  const store = await call(one, 'bob.add_store', { name: 'Bygghandeln', city: 'Uppsala', chain: null })
  const article = await call(one, 'bob.add_store_article', { store_id: store.record.id, catalog_item_id: stud, title: 'Regel 45x95 C24', article_number: 'R4595', pack_unit_code: 'm', pack_quantity: null })
  const first = await call(one, 'bob.record_store_price', { store_article_id: article.record.id, price: 29.9, currency: 'sek', price_unit_code: 'm', vat_included: true, source_kind: 'website', source_url: 'https://example.test/r4595', observed_on: '2026-10-29' })
  const second = await call(two, 'bob.record_store_price', { store_article_id: article.record.id, price: '27,5', currency: 'SEK', price_unit_code: 'm', source_kind: 'receipt' })
  assert.equal(first.record.currency, 'SEK')
  const current = (await as(one, 'select * from bob.current_store_prices where store_article_id=$1', [article.record.id]))
  assert.equal(current.length, 1); assert.equal(Number(current[0].price), 27.5); assert.equal(current[0].price_id, second.record.id)
  assert.equal(new Date(current[0].last_changed_at).getTime(), new Date(second.record.recorded_at).getTime())
  assert.equal((await as(one, 'select count(*)::int n from bob.store_article_prices where store_article_id=$1', [article.record.id]))[0].n, 2)
  await rejects(as(one, 'update bob.store_article_prices set price=0'), '42501')
  await rejects(as(one, 'delete from bob.store_article_prices'), '42501')
  await rejects(call(one, 'bob.record_store_price', { store_article_id: article.record.id, price: -1 }), '22023')
})

test('the combined lookup returns one row per purchase place, null when unknown, with household stock and paging at that grain', async () => {
  // 0 stores: one row with null store and price fields.
  const felt = await shared('underlay_felt', null)
  const none = await lookup(one, { id: felt })
  assert.equal(none.items.length, 1); assert.equal(none.grain, 'combination_store_article')
  for (const key of ['store_article_id', 'store', 'price', 'currency', 'price_last_changed_at']) assert.equal(none.items[0][key], null, key)
  assert.equal(none.items[0].size, null); assert.equal(none.items[0].unit, 'm2'); assert.equal(none.items[0].weight_kg, null)
  // 1 store with a price, plus household stock for the caller only.
  const stud = await shared('c24', 'p45x95')
  const onePlace = await lookup(one, { id: stud })
  assert.equal(onePlace.items.length, 1); assert.equal(onePlace.items[0].store, 'Bygghandeln'); assert.equal(onePlace.items[0].price, 27.5)
  assert.deepEqual(onePlace.items[0].size, { label: '45 × 95', length_mm: null, width_mm: 95, depth_mm: 45, review_status: 'reviewed' })
  assert(onePlace.items[0].aliases.includes('2tum4')); assert.equal(onePlace.items[0].unreviewed, false)
  const plywood = await shared('plywood_birch', 's12')
  const home = (await lookup(one, { id: plywood })).items[0]
  assert.deepEqual(home.stock_at_home.map((s: any) => [s.household, s.quantity, s.location]), [['Hemma A', 2, 'Garaget']])
  assert.deepEqual((await lookup(two, { id: plywood }, 'B')).items[0].stock_at_home, [], 'another household never sees it')
  // Several stores: one row each; a store article without a price keeps price null, never zero.
  const second = await call(one, 'bob.add_store', { name: 'Brädgården', city: null })
  const third = await call(one, 'bob.add_store', { name: 'Järnhandeln', city: 'Uppsala' })
  const priced = await call(one, 'bob.add_store_article', { store_id: second.record.id, catalog_item_id: plywood, article_number: 'P12' })
  await call(one, 'bob.record_store_price', { store_article_id: priced.record.id, price: 449, currency: 'SEK', price_unit_code: 'pcs', source_kind: 'manual' })
  await call(one, 'bob.add_store_article', { store_id: third.record.id, catalog_item_id: plywood, article_number: 'BJ12' })
  const many = (await lookup(one, { id: plywood })).items
  assert.equal(many.length, 2)
  assert.deepEqual(many.map((r: any) => r.store).sort(), ['Brädgården', 'Järnhandeln'])
  const unpriced = many.find((r: any) => r.store === 'Järnhandeln')
  assert.equal(unpriced.price, null); assert.equal(unpriced.price_last_changed_at, null); assert.equal(unpriced.store_unreviewed, true)
  assert(many.every((r: any) => r.id === plywood && r.stock_at_home.length === 1), 'combination fields repeat on every row')
  // Alias search, then paging at the row grain.
  const byAlias = await lookup(one, { query: '2tum4' })
  assert.deepEqual(byAlias.items.map((r: any) => r.name).sort(), ['Konstruktionsvirke C24, gran/furu 45 × 95', 'Tryckimpregnerat virke, NTR/AB 45 × 95'])
  const rows: any[] = []; let after: string | null = null, pages = 0
  do { const page: any = await lookup(one, { after }); rows.push(...page.items); after = page.next_cursor; pages++ } while (after && pages < 20)
  assert.equal(rows.length, data.combinations.length + 1, 'one extra row for the second plywood store')
  assert.equal(new Set(rows.map(r => r.id + ':' + r.store_article_id)).size, rows.length)
  assert(pages >= 4)
  await rejects(lookup(one, { after: 'not-a-cursor' }), '22023')
  await rejects(lookup(outsider, {}), '42501')
})

test('the lookup stays a single indexed read: alias lookups use their index and a page takes milliseconds', async () => {
  const plan = await pg.transaction(async tx => {
    await tx.exec('set local enable_seqscan=off')
    return (await tx.query<any>("explain select id from bob.material_aliases where lower(btrim(alias))='2tum4'")).rows.map(r => r['QUERY PLAN']).join('\n')
  })
  assert.match(plan, /material_aliases_(alias|target)_idx/)
  const stockPlan = await pg.transaction(async tx => {
    await tx.exec('set local enable_seqscan=off')
    return (await tx.query<any>("explain select * from bob.store_article_prices where store_article_id='20000000-0000-4000-8000-000000000009' order by recorded_at desc,id desc limit 1")).rows.map(r => r['QUERY PLAN']).join('\n')
  })
  assert.match(stockPlan, /store_article_prices_article_idx/)
  const times: number[] = []
  for (let i = 0; i < 5; i++) { const t = performance.now(); await lookup(one, { query: 'plywood' }); times.push(performance.now() - t) }
  times.sort((a, b) => a - b)
  assert(times[2] < 250, `median ${times[2].toFixed(1)} ms`)
})

test('project definitions read unchanged; Bob\'s reads show the combination and its review status', async () => {
  const stud = await shared('c24', 'p45x95')
  const read = await call(one, 'bob.catalog_read', 'A', { action: 'read', kind: null, query: null, after: null, id: stud, revision: null, profile_code: null, categories: [], properties: {} })
  assert.equal(read.record.scope, 'shared'); assert.equal(read.record.spec.review_status, 'reviewed'); assert.equal(read.record.spec.size.depth_mm, 45)
  const search = await call(one, 'bob.catalog_read', 'A', { action: 'search', kind: 'material', query: '2x4', after: null, id: null, revision: null, profile_code: null, categories: [], properties: {} })
  assert.equal(search.items.length, 2); assert(search.items.every((i: any) => i.spec.size.label === '45 × 95'))
  const project = (await pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: one })])
    return tx.query<any>(`select bob_private.catalog_save('A',null,0,$1,$2) r`, [JSON.stringify({ action: 'ensure', key: 'k', kind: 'material', name: 'Egen skiva', aliases: [],
      profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood', 'sheet'], properties: { thickness: { value: '22', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } },
      material_id: null, material_revision: null, notes: '', source_kind: 'design_choice', source_quote: 'x', source_seq: null }),
      JSON.stringify({ kind: 'design_choice', quote: 'x', seq: null, thread: '20000000-0000-4000-8000-000000000001' })])
  })).rows[0].r
  assert.equal(Object.hasOwn(project.record, 'spec'), false, 'definitions without links keep their exact record shape')
  const linked = await call(one, 'bob.set_catalog_item_spec', project.record.id, { material_type_id: null, material_size_id: null, unit_code: 'pcs', weight_kg: '7,5' })
  assert.equal(linked.record.spec.unit, 'pcs'); assert.equal(linked.record.spec.weight_kg, 7.5)
  await rejects(call(two, 'bob.set_catalog_item_spec', project.record.id, { unit_code: 'pcs' }), '42501')
  await rejects(call(one, 'bob.set_catalog_item_spec', stud, { unit_code: 'pcs' }), '42501')
})

test('Bob\'s material search reads the combined lookup only for manifests pinned to it', async () => {
  const fresh = catalogFixture(), pinned = preMaterialLookupCatalogFixture()
  assert.equal(fresh.definition('tools.search_material_catalog').metadata.material_lookup_version, 1)
  assert(String(fresh.definition('tools.search_material_catalog').definition.description).endsWith(MATERIAL_LOOKUP_NOTE))
  assert.equal(pinned.definition('tools.search_material_catalog').metadata.material_lookup_version, undefined)
  const calls: string[] = []
  const transport = Object.assign(async (input: Record<string, unknown>) => { calls.push('catalog_read:' + input.action); return { data: { status: 'empty', projectId: 'A', items: [], next_cursor: null, truncated: false }, error: null } })
  const combined = Object.assign(async (input: Record<string, unknown>) => {
    calls.push('material_lookup'); assert.deepEqual(input, { query: '2tum4', categories: ['wood'], after: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:-', id: null })
    return { data: { status: 'empty', projectId: 'A', grain: 'combination_store_article', items: [], next_cursor: null, truncated: false }, error: null }
  })
  const search = { entity: 'materials', query: '2tum4', categories: ['wood'], profile_code: null, profile_revision: null, properties: {}, after: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:-' }
  const reader = createMaterialCatalogReader('A', transport, async () => true, [], 10000, { lookup: combined })
  assert.equal((await reader.read('search_material_catalog', search)).status, 'empty')
  assert.equal((await reader.read('search_material_catalog', { ...search, entity: 'parts', after: null })).status, 'empty')
  const legacy = createMaterialCatalogReader('A', transport, async () => true, [])
  assert.equal((await legacy.read('search_material_catalog', search)).status, 'invalid', 'older readers keep plain UUID cursors')
  assert.deepEqual(calls, ['material_lookup', 'catalog_read:search'])
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-material-lookup-catalog.ts', 'supabase/migrations/20261029160200_material_lookup_catalog.sql', '--check'])
})
