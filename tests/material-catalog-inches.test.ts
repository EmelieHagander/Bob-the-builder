import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'
import { parseCatalogWrite, parseCatalogRead } from '../supabase/functions/_shared/material-catalog.ts'

// Actual migrated commands, including the same parser used by loaded Bob tools.
// No production credentials, no user project data, no mocked normalization.
const pg = new PGlite()
const user = '00000000-0000-4000-8000-000000000001'
const request = 'Spara mitt designval med ¾ tum. Rätta samma definition vid behov.'
let seq = 0
async function as(sql: string, params: unknown[] = [], role = 'authenticated', uid: string | null = user): Promise<any> {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
type Claim = { turn: string; thread: string; generation: number }
async function claim(): Promise<Claim> {
  const turn = `40000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`
  const r = (await as('select bob.bob_claim_turn($1,$2,$3,$4) result', ['A',user,turn,request], 'service_role', null)).rows[0].result
  assert.equal(r.status,'claimed')
  return { turn, thread:r.thread_id, generation:r.generation }
}
async function release(c: Claim) {
  await as('select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', ['A',user,c.thread,c.turn,c.generation], 'service_role', null)
}
const value = (v: string | null, unit: string | null = 'mm', truth = 'provided_spec', parameter: string | null = null, note = '') =>
  ({ value:v, unit, truth, parameter, note })
const definition = (key: string, changes: Record<string,unknown> = {}) => ({
  action:'ensure', key, kind:'material', name:'Inch fixture', aliases:[], profile_code:'sheet_stock', profile_revision:1,
  categories:['wood.plywood','sheet'], properties:{ thickness:value('3/4','in') }, material_id:null, material_revision:null,
  notes:'', source_kind:'design_choice', source_quote:'mitt designval', source_seq:null, ...changes,
})
async function write(c: Claim, data: Record<string,unknown>, id: string | null = null, revision = 0): Promise<any> {
  const payload = parseCatalogWrite({ ...data, record_id:id, expected_revision:revision, request_quote:'Spara' })
  assert(payload, 'The real tool parser accepts the input; SQL validates its dimensional meaning')
  return (await as('select bob.bob_project_write_v7($1,$2,$3,$4,$5) result', ['A',c.thread,c.turn,c.generation,JSON.stringify(payload)])).rows[0].result
}
async function read(changes: Record<string,unknown>): Promise<any> {
  const input = { action:'search', kind:null, query:null, after:null, id:null, revision:null, profile_code:null, categories:[], properties:{}, ...changes }
  return (await as('select bob.catalog_read($1,$2) result', ['A',JSON.stringify(input)])).rows[0].result
}
async function normalize(v: string, unit = 'in'): Promise<any> {
  return (await as('select bob_private.catalog_normalize($1,1,$2,$3) result', ['sheet_stock',JSON.stringify({thickness:value(v,unit)}),'material'])).rows[0].result.properties.thickness
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
  await pg.query('insert into auth.users values($1,$2,now())', [user,'inch-fixture@example.test'])
  const legacy = new URL('../db/migrations/',import.meta.url)
  for (const file of (await readdir(legacy)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(file,legacy),'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Inches A')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','O',$1)",[user])
  await setupSharedSocial(pg)
  const migrations = new URL('../supabase/migrations/',import.meta.url)
  for (const file of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(file,migrations),'utf8'))
})
after(()=>pg.close())

test('catalog profile read exposes the exact international inch and separate nominal timber text', async () => {
  for (const profile of ['sheet_stock','rectangular_profile','panel','tube_stock']) {
    const r=await read({action:'profile',id:profile,revision:1})
    assert.equal(r.status,'ok')
    assert(r.record.units.some((u:any)=>u.code==='in'&&u.dimension==='length'&&Number(u.to_canonical)===25.4))
    const nominal=r.record.fields.find((f:any)=>f.property_key==='nominal_size')
    assert.equal(nominal.value_type,'text');assert.equal(nominal.canonical_unit,null)
    assert(r.record.fields.filter((f:any)=>f.value_type==='quantity').every((f:any)=>f.canonical_unit==='mm'))
  }
})

test('inch decimals, fractions, mixed numbers and common Unicode fractions normalize without whole-mm rounding', async () => {
  for (const [input,expected] of [['1','25.4'],['0.75','19.05'],['0,75','19.05'],['3/4','19.05'],['¾','19.05'],['3⁄4','19.05'],
    ['1 1/2','38.1'],['1½','38.1'],['1 ½','38.1'],['1 1/2','38.1'],['3/2','38.1'],['⅞','22.225'],['1/64','0.396875'],['1/127','0.2']]) {
    assert.deepEqual(await normalize(input),value(expected),input)
  }
})

test('384 fractional cases agree with an independent integer-rational mm oracle', async () => {
  for (const denominator of [2,4,8,16,32,64]) {
    const rows:any[]=(await as(`select n, (bob_private.catalog_normalize('sheet_stock',1,
      jsonb_build_object('thickness',jsonb_build_object('value',n::text||'/'||$1::text,'unit','in','truth','provided_spec','parameter',null,'note','')),
      'material')->'properties'->'thickness'->>'value') as mm from generate_series(1,64) n`,[denominator])).rows
    for (const row of rows) {
      const micro=BigInt(row.n)*25400000n/BigInt(denominator)
      const expected=`${micro/1000000n}.${(micro%1000000n).toString().padStart(6,'0')}`.replace(/\.?0+$/,'')
      assert.equal(row.mm,expected)
    }
  }
})

test('inch and metric equivalents share one definition and exact typed search; retries do not add rows', async () => {
  const c=await claim()
  try {
    const ids:string[]=[]
    for (const [i,[n,u]] of [['3/4','in'],['¾','in'],['19.05','mm'],['1.905','cm'],['0.01905','m']].entries()) {
      const d=definition('same_'+i,{name:'Title '+i,notes:'equivalence',properties:{thickness:value(n,u)}})
      const r=await write(c,d);ids.push(r.recordId)
      assert.equal(r.operation,i===0?'created':'reused')
      assert.deepEqual(await write(c,d),r,'Same-turn exact retry returns the identical receipt')
      const parsed=parseCatalogRead('search_material_catalog',{entity:'materials',query:null,categories:['wood'],profile_code:'sheet_stock',profile_revision:1,properties:{thickness:value(n,u)},after:null})
      assert(parsed)
      const search=(await as('select bob.catalog_read($1,$2) result',['A',JSON.stringify(parsed)])).rows[0].result
      assert(search.items.some((item:any)=>item.id===r.recordId))
    }
    assert.equal(new Set(ids).size,1)
    assert.equal((await pg.query('select count(*) n from bob.catalog_item_revisions where item_id=$1',[ids[0]])).rows[0].n,1)
  } finally {await release(c)}
})

test('material and part use the same mm normalization while unbound, estimated and unknown remain distinct', async () => {
  const c=await claim()
  try {
    const m=await write(c,definition('part_material',{notes:'part fixture'}))
    const p=await write(c,definition('panel',{kind:'part',profile_code:'panel',material_id:m.recordId,material_revision:1,
      properties:{thickness:value('19.05'),length:value(null,'in','provided_spec','span'),width:value('1 1/2','in','estimated',null,'Design estimate')}}))
    assert.deepEqual(p.record.properties.length,value(null,'mm','provided_spec','span'))
    assert.deepEqual(p.record.properties.width,value('38.1','mm','estimated',null,'Design estimate'))
    assert.equal(p.record.material_id,m.recordId);assert.equal(p.record.material_revision,1)
    const unknown=await write(c,definition('unknown',{properties:{thickness:value(null,'in','unknown',null,'Needs a measurement')}}))
    assert.deepEqual(unknown.record.properties.thickness,value(null,'mm','unknown',null,'Needs a measurement'))
    assert.equal(unknown.record.has_unknown,true)
  } finally {await release(c)}
})

test('nominal 2x4 is never converted to geometry or assumed equivalent to a different explicit section', async () => {
  const c=await claim()
  try {
    const timber=(key:string,thickness:ReturnType<typeof value>,width:ReturnType<typeof value>)=>definition(key,{
      profile_code:'rectangular_profile',categories:['wood.softwood','rectangular_profile'],name:'Timber fixture',aliases:['tvåtumfyra','2x4'],
      properties:{nominal_size:value('2x4',null),thickness,width},notes:'Synthetic specifications, not a product claim'})
    const a=await write(c,timber('specified_metric',value('45'),value('95')))
    const b=await write(c,timber('literal_inches',value('2','in'),value('4','in')))
    const u=await write(c,timber('nominal_only',value(null,'in','unknown',null,'Section not specified'),value(null,'in','unknown',null,'Section not specified')))
    assert.notEqual(a.recordId,b.recordId)
    assert.deepEqual(a.record.properties.thickness,value('45'))
    assert.deepEqual(b.record.properties.thickness,value('50.8'))
    assert.deepEqual(b.record.properties.width,value('101.6'))
    assert.equal(u.record.properties.thickness.value,null);assert.equal(u.record.properties.width.value,null)
    assert.equal(u.record.properties.nominal_size.value,'2x4');assert.equal(u.record.properties.nominal_size.unit,null)
    assert.equal(u.record.has_unknown,true)
    assert.equal((await read({query:'tvåtumfyra',categories:['wood']})).items.length,3)
    const exact=await read({profile_code:'rectangular_profile',revision:1,properties:{nominal_size:value('2x4',null),thickness:value('45')}})
    assert.deepEqual(exact.items.map((r:any)=>r.id),[a.recordId])
  } finally {await release(c)}
})

test('nominal pipe notation remains text and cannot stand in for outside diameter', async () => {
  const c=await claim()
  try {
    const r=await write(c,definition('pipe',{profile_code:'tube_stock',categories:['plastic.pvc','tube'],
      properties:{nominal_size:value('R 1/2',null),outside_diameter:value(null,'mm','unknown',null,'Read product specification'),wall_thickness:value(null,'mm','unknown',null,'Read product specification')}}))
    assert.equal(r.record.properties.nominal_size.value,'R 1/2')
    assert.equal(r.record.properties.outside_diameter.value,null)
    assert.equal(r.record.properties.wall_thickness.value,null)
    await assert.rejects(normalize('R 1/2'),/catalog_invalid_fraction/)
  } finally {await release(c)}
})

test('malformed, ambiguous, non-terminating and overprecise inch inputs fail atomically', async () => {
  const c=await claim()
  try {
    const before=(await pg.query('select count(*) n from bob.catalog_item_revisions')).rows[0].n
    for (const [i,input] of ['1/0','1 3/2','1/3','1/128','2x4','2×4','1-1/2','3/4 tum','3/4"','NaN','1e2','0.0000001','0','-1','1/2; SELECT 1'].entries()) {
      await assert.rejects(write(c,definition('bad_'+i,{properties:{thickness:value(input,'in')}})),/catalog_/)
    }
    await assert.rejects(write(c,definition('bad_volume',{profile_code:'liquid',categories:['coating','liquid'],properties:{volume:value('1','in')}})),/catalog_wrong_unit_dimension/)
    assert.equal((await pg.query('select count(*) n from bob.catalog_item_revisions')).rows[0].n,before)
    assert.equal((await pg.query('select count(*) n from bob_private.bob_write_receipts where turn_id=$1',[c.turn])).rows[0].n,0)
  } finally {await release(c)}
})

test('mm storage and dictionary authority stay enforced for inch input', async () => {
  await assert.rejects(pg.exec("insert into bob.catalog_property_definitions(key,label,value_type,canonical_unit) values('inch_native','Wrong','quantity','in')"),/catalog_length_unit_must_be_mm/)
  await assert.rejects(as("update bob.catalog_units set to_canonical=1 where code='in'"),/permission denied/)
  await assert.rejects(as("select bob_private.catalog_input_quantity('1','in',25.4,1)",[],'anon',null),/permission denied/)
  const c=await claim()
  try {
    const r=await write(c,definition('storage',{notes:'storage fixture'}))
    await assert.rejects(pg.query("update bob.catalog_item_revisions set properties=jsonb_set(properties,'{thickness,unit}','\"in\"') where item_id=$1",[r.recordId]),/catalog_length_storage_must_be_mm/)
    assert.deepEqual((await read({action:'read',id:r.recordId,revision:1})).record.properties.thickness,value('19.05'))
  } finally {await release(c)}
})

test('original inch wording and retry payload survive but working readback contains canonical mm only', async () => {
  const c=await claim()
  try {
    const r=await write(c,definition('source',{source_kind:'user_statement',source_quote:'¾ tum',notes:'source fixture',properties:{thickness:value('¾','in')}}))
    assert.deepEqual(r.record.properties.thickness,value('19.05'))
    assert.equal((await pg.query('select source_quote from bob_private.catalog_item_provenance where item_id=$1',[r.recordId])).rows[0].source_quote,'¾ tum')
    const original:any=(await pg.query("select payload from bob_private.bob_write_receipts where turn_id=$1 and operation_key='catalog:source'",[c.turn])).rows[0]
    assert.deepEqual(original.payload.data.properties.thickness,value('¾','in'))
    assert.doesNotMatch(JSON.stringify(await read({action:'read',id:r.recordId,revision:1})),/source_quote|source_thread/)
    assert.equal((await pg.query('select count(*) n from bob.stock_items')).rows[0].n,0)
    assert.equal((await pg.query('select count(*) n from bob.materials')).rows[0].n,0)
  } finally {await release(c)}
})

test('inch revision updates the same definition without changing historical dimensions', async () => {
  const firstClaim=await claim();let first:any
  try {first=await write(firstClaim,definition('first',{notes:'history fixture'}))} finally {await release(firstClaim)}
  const next=await claim()
  try {
    const r=await write(next,definition('second',{action:'revise',notes:'history fixture',properties:{thickness:value('1½','in')}}),first.recordId,1)
    assert.equal(r.recordId,first.recordId);assert.equal(r.revision,2)
    assert.deepEqual((await read({action:'read',id:first.recordId,revision:1})).record.properties.thickness,value('19.05'))
    assert.deepEqual((await read({action:'read',id:first.recordId,revision:2})).record.properties.thickness,value('38.1'))
  } finally {await release(next)}
})
