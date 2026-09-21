import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'

// Real SQL, including storage-level guards. These are not model-response fixtures.
const pg = new PGlite()
const one = '00000000-0000-4000-8000-000000000001'
const two = '00000000-0000-4000-8000-000000000002'
const request = 'Spara mitt designval: 1,6 m och 1,8 cm. Rätta samma definition vid behov.'
let seq = 0
async function as(sql: string, params: unknown[] = [], role = 'authenticated', user: string | null = one): Promise<any> {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
type Claim = { turn: string; thread: string; generation: number }
async function claim(): Promise<Claim> {
  const turn = `40000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  const r = (await as('select bob.bob_claim_turn($1,$2,$3,$4) result', ['A', one, turn, request], 'service_role', null)).rows[0].result
  assert.equal(r.status, 'claimed')
  return { turn, thread: r.thread_id, generation: r.generation }
}
async function release(c: Claim) {
  await as('select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', ['A', one, c.thread, c.turn, c.generation], 'service_role', null)
}
const value = (v: string | null, unit = 'mm', truth = 'provided_spec', parameter: string | null = null, note = '') =>
  ({ value: v, unit, truth, parameter, note })
const definition = (key: string, changes: Record<string, unknown> = {}) => ({
  action: 'ensure', key, kind: 'material', name: 'Millimetre fixture', aliases: [],
  profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood.plywood', 'sheet'],
  properties: { thickness: value('18') }, material_id: null, material_revision: null,
  notes: '', source_kind: 'design_choice', source_quote: 'mitt designval', source_seq: null, ...changes,
})
async function write(c: Claim, data: Record<string, unknown>, recordId: string | null = null, revision = 0): Promise<any> {
  const payload = { kind: 'catalog', record_id: recordId, expected_revision: revision, expected_updated_at: null, request_quote: 'Spara', data }
  return (await as('select bob.bob_project_write_v7($1,$2,$3,$4,$5) result', ['A', c.thread, c.turn, c.generation, JSON.stringify(payload)])).rows[0].result
}
async function read(changes: Record<string, unknown>): Promise<any> {
  const input = { action: 'search', kind: null, query: null, after: null, id: null, revision: null, profile_code: null, categories: [], properties: {}, ...changes }
  return (await as('select bob.catalog_read($1,$2) result', ['A', JSON.stringify(input)])).rows[0].result
}
before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;`)
  for (const id of [one, two]) await pg.query('insert into auth.users values($1,$2,now())', [id, id + '@example.test'])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Millimetre A'),('B','b','Millimetre B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','O',$1),('twoB','B','Two','T',$2)", [one, two])
  await setupSharedSocial(pg)
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(file, migrations), 'utf8'))
})
after(() => pg.close())

test('all present and future length properties have mm as storage unit; dynamic input units remain allowed', async () => {
  const units: any[] = (await pg.query("select d.key,d.canonical_unit from bob.catalog_property_definitions d join bob.catalog_units u on u.code=d.canonical_unit where u.dimension='length'")).rows
  assert(units.length >= 6)
  assert(units.every(r => r.canonical_unit === 'mm'))
  await pg.exec("insert into bob.catalog_units values('inch','length',25.4)")
  for (const unit of ['cm', 'm', 'inch']) {
    await assert.rejects(pg.query("insert into bob.catalog_property_definitions(key,label,value_type,canonical_unit) values($1,'Bad canonical unit','quantity',$2)", ['bad_' + unit, unit]), /catalog_length_unit_must_be_mm/)
  }
  await pg.exec("insert into bob.catalog_property_definitions(key,label,value_type,canonical_unit) values('custom_span','New span','quantity','mm')")
  await pg.exec("insert into bob.catalog_profiles values('new_span','New span'); insert into bob.catalog_profile_revisions(profile_code,revision,form_code) values('new_span',1,'rectangular_profile'); insert into bob.catalog_profile_fields(profile_code,profile_revision,property_key,required,position) values('new_span',1,'custom_span',true,0); update bob.catalog_profile_revisions set published=true where profile_code='new_span'")
  const c = await claim()
  try {
    const r = await write(c, definition('new_span', { profile_code: 'new_span', categories: ['wood.softwood','rectangular_profile'], properties: { custom_span: value('2.5', 'inch') } }))
    assert.deepEqual(r.record.properties.custom_span, value('63.5'))
  } finally { await release(c) }
})

test('mixed input units normalize every stored part dimension; no stock or shopping row is manufactured', async () => {
  const counts = async () => (await pg.query('select (select count(*) from bob.materials) shopping,(select count(*) from bob.stock_items) stock')).rows[0]
  const before = await counts(), c = await claim()
  try {
    const m = await write(c, definition('panel_material', { properties: { thickness: value('1.8', 'cm') }, notes: 'panel material' }))
    const p = await write(c, definition('panel', { kind: 'part', profile_code: 'panel', material_id: m.recordId, material_revision: 1,
      properties: { thickness: value('0.018','m'), length: value('1.6','m'), width: value('70','cm') } }))
    const raw: any = (await pg.query('select properties from bob.catalog_item_revisions where item_id=$1 and revision=$2', [p.recordId,1])).rows[0]
    assert.deepEqual(raw.properties, { thickness: value('18'), length: value('1600'), width: value('700') })
    assert.deepEqual(p.record.properties, raw.properties)
    assert.deepEqual(await counts(), before)
  } finally { await release(c) }
})

test('mm/cm/m equivalents reuse one identity and normalized typed searches find it', async () => {
  const c = await claim()
  try {
    const ids: string[] = []
    for (const [n,u] of [['18','mm'],['1.8','cm'],['0.018','m']]) {
      const r = await write(c, definition('equivalent_' + u, { name: 'Title ' + u, notes: 'equivalence', properties: { thickness: value(n,u) } }))
      ids.push(r.recordId)
      assert.equal(r.operation, ids.length === 1 ? 'created' : 'reused')
      const result = await read({ kind: 'material', profile_code: 'sheet_stock', revision: 1, categories: ['wood'], properties: { thickness: value(n,u) } })
      assert(result.items.some((row: any) => row.id === r.recordId))
    }
    assert.equal(new Set(ids).size, 1)
    assert.equal((await pg.query('select count(*) n from bob.catalog_item_revisions where item_id=$1', [ids[0]])).rows[0].n, 1)
  } finally { await release(c) }
})

test('unknown and unbound parameter slots store mm without becoming zero or measured facts', async () => {
  const c = await claim()
  try {
    const unknown = await write(c, definition('unknown', { properties: { thickness: value(null,'cm','unknown',null,'Not known') } }))
    assert.deepEqual(unknown.record.properties.thickness, value(null,'mm','unknown',null,'Not known'))
    const m = await write(c, definition('parameter_material', { notes: 'parameter material' }))
    const p = await write(c, definition('parameter', { kind: 'part', profile_code: 'panel', material_id: m.recordId, material_revision: 1,
      properties: { thickness: value('1.8','cm'), length: value(null,'m','provided_spec','span'), width: value('70','cm','estimated',null,'Design estimate') } }))
    assert.deepEqual(p.record.properties.length, value(null,'mm','provided_spec','span'))
    assert.deepEqual(p.record.properties.width, value('700','mm','estimated',null,'Design estimate'))
    assert.deepEqual(p.record.parameter_keys, ['span'])
    assert.equal(p.record.source_kind, 'design_choice')
  } finally { await release(c) }
})

test('millimetres retain fractions exactly; excess precision/range and incompatible units fail without a save', async () => {
  const c = await claim()
  try {
    const r = await write(c, definition('fraction', { properties: { thickness: value('0.000001','m') } }))
    assert.deepEqual(r.record.properties.thickness, value('0.001'))
    const before = (await pg.query('select count(*) n from bob.catalog_item_revisions')).rows[0].n
    for (const [n,u] of [['0.0000001','mm'],['1000001','mm'],['2','l'],['NaN','mm']]) {
      await assert.rejects(write(c, definition('invalid_' + u + '_' + n.replace(/\W/g,''), { properties: { thickness: value(n,u) } })), /catalog_/)
    }
    assert.equal((await pg.query('select count(*) n from bob.catalog_item_revisions')).rows[0].n, before)
  } finally { await release(c) }
})

test('storage-level guard rejects non-mm length rows even outside the normal command', async () => {
  const c = await claim()
  try {
    const r = await write(c, definition('raw_guard', { notes: 'storage guard' }))
    for (const unit of ['cm','m','inch']) {
      await assert.rejects(pg.query("update bob.catalog_item_revisions set properties=jsonb_set(properties,'{thickness,unit}',to_jsonb($2::text)) where item_id=$1", [r.recordId,unit]), /catalog_length_storage_must_be_mm/)
    }
    const raw: any = (await pg.query('select properties from bob.catalog_item_revisions where item_id=$1', [r.recordId])).rows[0]
    assert.equal(raw.properties.thickness.unit, 'mm')
    await assert.rejects(as("update bob.catalog_item_revisions set name='Unauthorized' where item_id=$1", [r.recordId]), /permission denied/)
  } finally { await release(c) }
})

test('volume and count are not converted to mm; source wording remains independent from working properties', async () => {
  const c = await claim()
  try {
    const liquid = await write(c, definition('liquid', { profile_code: 'liquid', categories: ['coating','liquid'], properties: { volume: value('2500','ml') } }))
    assert.deepEqual(liquid.record.properties.volume, value('2.5','l'))
    await pg.exec("insert into bob.catalog_property_definitions(key,label,value_type,canonical_unit) values('pack_count','Pack count','quantity','pcs')")
    const m = await write(c, definition('source_original', { source_kind: 'user_statement', source_quote: '1,8 cm', notes: 'source fixture', properties: { thickness: value('1.8','cm') } }))
    assert.deepEqual(m.record.properties.thickness, value('18'))
    const source: any = (await pg.query('select source_quote from bob_private.catalog_item_provenance where item_id=$1', [m.recordId])).rows[0]
    assert.equal(source.source_quote, '1,8 cm')
    const receipt: any = (await pg.query("select payload from bob_private.bob_write_receipts where operation_key='catalog:source_original' and turn_id=$1", [c.turn])).rows[0]
    assert.equal(receipt.payload.data.properties.thickness.unit, 'cm', 'Exact request is audit data, not another working specification')
    assert.doesNotMatch(JSON.stringify(await read({ action:'read', id:m.recordId, revision:1 })), /source_quote|source_thread/)
  } finally { await release(c) }
})

test('revising in another input unit keeps historical mm values and exact material identity', async () => {
  const c = await claim()
  let first: any
  try { first = await write(c, definition('revision_first', { notes: 'revision fixture' })) } finally { await release(c) }
  const next = await claim()
  try {
    const revision = await write(next, definition('revision_next', { action:'revise', notes:'revision fixture', properties:{ thickness:value('2.1','cm') } }), first.recordId, 1)
    assert.equal(revision.recordId, first.recordId)
    assert.equal(revision.revision, 2)
    assert.deepEqual((await read({ action:'read', id:first.recordId, revision:1 })).record.properties.thickness, value('18'))
    assert.deepEqual((await read({ action:'read', id:first.recordId, revision:2 })).record.properties.thickness, value('21'))
  } finally { await release(next) }
})
