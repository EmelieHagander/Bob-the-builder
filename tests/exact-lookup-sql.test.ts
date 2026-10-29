import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from './support/pglite.ts'
import { setupSharedSocial } from './support/shared-social.ts'
import { makePlan } from './support/multifloor-fixture.ts'
import { makeStair } from './support/stair-fixture.ts'

// Search v10 must return exactly what v9 returns; only the artifact detail
// reads are keyed per record (2026-10-29).
const pg = new PGlite()
const one = '00000000-0000-4000-8000-000000000001'
const two = '00000000-0000-4000-8000-000000000002'
const both = '00000000-0000-4000-8000-000000000003'
const guest = '00000000-0000-4000-8000-000000000004'
const id = (n: number) => '70000000-0000-4000-8000-' + String(n).padStart(12, '0')
const json = (v: unknown) => JSON.stringify(v)
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
const command = async (uid: string, fn: string, args: unknown[]) => (await as(uid, `select bob.${fn}($1,$2,$3,$4,$5) result`, args)).rows[0].result
const box = (n: number, data = drawing(), project = 'A', uid = one) => command(uid, 'artifact_box_command', [project, 'create', id(n), 0, json(data)])

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
  for (const [i, uid] of [one, two, both, guest].entries()) await pg.query('insert into auth.users values($1,$2,now())', [uid, uid === guest ? 'guest@bob.local' : `write${i}@example.test`])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Porch A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)", [one, two])
  await setupSharedSocial(pg)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, dir), 'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1),('guestA','A','Guest','G',$2)", [both, guest])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','entry','Entry'),('areaB','B','private','Private'); insert into bob.tasks(id,area_id,name,hours) values('taskA','areaA','Original','2h'),('taskB','areaB','Private work','')")
  await as(one, 'select bob.solution_command($1,$2,$3,$4,$5)', ['A', 'create', id(2), 0, json({ title: 'Storage proposal', description: 'Open-top box', assumptions: 'Material and fit to verify', tradeoffs: 'Simple joinery', area_id: 'areaA' })])
  await as(one, 'select bob.solution_command($1,$2,$3,$4,$5)', ['A', 'select', id(2), 0, json({ solution_revision: 1, reason: 'Use this scope', area_id: 'areaA' })])
  await as(both, 'select bob.physical_building_command($1,$2,0,$3)', ['create', id(200), json({ name: 'House', notes: 'Persistent room fixture' })])
  await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200), 'level', 'create', id(201), json({ name: 'Ground floor', position: 0 })])
  for (const [n, name] of [[202, 'Children room'], [203, 'Office']] as const) {
    await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200), 'space', 'create', id(n), json({ name, kind: 'room', level_id: id(201), truth: 'unknown', measurements: [] })])
  }
  await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200), 'element', 'create', id(204), json({ name: 'Shared wall', kind: 'wall', space_id: id(202), truth: 'unknown', description: 'Existing identity, proposed placement' })])
  await as(both, 'select bob.physical_scope_command($1,$2,$3,$4,$5)', ['A', 'project', 'link', id(205), json({ target_kind: 'building', building_id: id(200) })])
  await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200), 'level', 'create', id(206), json({ name: 'Upper floor', position: 1 })])
  for (const [n, name] of [[207, 'Bedroom'], [208, 'Landing']] as const) await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200), 'space', 'create', id(n), json({ name, kind: 'room', level_id: id(206), truth: 'unknown', measurements: [] })])

  // One artifact of every detail kind v4/v6/v7 add: a plain box, a room layout,
  // a multifloor plan and a stair study that reads that plan.
  await box(300)
  await command(one, 'artifact_room_layout_command', ['A', 'create', id(310), 0, json({ title: 'Two-room plan', description: 'Linked proposal, not current physical geometry',
    assumptions: 'Working dimensions; actual openings and heights not checked.', area_id: 'areaA', target_revision: 1, change_note: 'Create requested plan',
    building_id: id(200), left_space_id: id(202), right_space_id: id(203), wall_element_id: id(204), furniture_artifact_id: id(300),
    left_space_revision: 1, right_space_revision: 1, wall_element_revision: 1, furniture_revision: 1, measurements: [],
    parameters: { generator: 'room_pair_v1', version: 1, span_mm: 6120, depth_mm: 4000, wall_thickness_mm: 120, left_width_mm: 3400,
      furniture_room: 'left', anchor: 'shared_wall', gap_mm: 50, offset_mm: 200, rotation: 0 } })])
  await command(one, 'artifact_multifloor_command', ['A', 'create', id(400), 0, json({ title: 'Shared floor coordinates', description: 'Two aligned floors',
    assumptions: 'Synthetic coordinate study, not observed site facts.', area_id: 'areaA', target_revision: 1, recipe: makePlan(), measurements: [], change_note: 'Requested study' })])
  await command(one, 'artifact_stair_command', ['A', 'create', id(500), 0, json({ plan_id: id(400), plan_revision: 1, recipe: makeStair(), title: 'Calculated stair',
    description: 'Synthetic quarter turn', assumptions: 'Test dimensions, not observed facts', change_note: 'Requested stair' })])
  // Large boxes push a page over the 30000-byte result limit.
  const long = 'Bulky detailed storage box text for paging. '.repeat(34)
  for (let n = 600; n < 624; n++) await box(n, drawing({ title: 'Bulk box ' + n, description: long }))
})
after(() => pg.close())

const search = async (version: 'v9' | 'v10', args: (string | null)[], uid = one) =>
  (await as(uid, `select bob.search_bob_project_data_${version}($1,$2,$3,$4,$5,$6,$7) result`, args)).rows[0].result
const failure = async (version: 'v9' | 'v10', args: (string | null)[], uid: string | null, role = 'authenticated') => {
  try { await as(uid, `select bob.search_bob_project_data_${version}($1,$2,$3,$4,$5,$6,$7) result`, args, role); return 'ok' }
  catch (error: any) { return String(error?.code ?? '') + ':' + String(error?.message ?? '') }
}
const lookup = (dataset: string, extra: { query?: string | null; status?: string | null; area?: string | null; record?: string | null; after?: string | null; project?: string } = {}) =>
  [extra.project ?? 'A', dataset, extra.query ?? null, extra.status ?? null, extra.area ?? null, extra.record ?? null, extra.after ?? null]

test('fixture covers every artifact detail kind and the size-trimming path', async () => {
  const listing = await search('v9', lookup('artifacts'))
  assert.equal(listing.truncated, true, 'the large boxes exceed one result page')
  const exact = async (n: number) => (await search('v9', lookup('artifacts', { record: id(n) }))).records[0]
  const [plain, room, plan, stair] = [await exact(300), await exact(310), await exact(400), await exact(500)]
  assert.equal(plain.has_room_layout, false); assert.equal(plain.room_layout, null); assert.equal(plain.multifloor_plan, null); assert.equal(plain.stair_study, null)
  assert.equal(room.has_room_layout, true); assert.equal(room.room_layout.left_space_id, id(202))
  assert.equal(plan.has_multifloor_plan, true); assert.equal(plan.multifloor_plan.artifact_id, id(400))
  assert.equal(stair.has_stair_study, true); assert.equal(stair.stair_study.plan_id, id(400))
  assert.ok(plain.parametric_recipe, 'v3 recipe enrichment is present')
})

test('v10 equals v9 for exact reads, listings, paging, query and area filters', async () => {
  const cases = [
    ...[300, 310, 400, 500, 600, 623].map(n => lookup('artifacts', { record: id(n) })),
    lookup('artifacts'),
    lookup('artifacts', { query: 'stair' }),
    lookup('artifacts', { query: 'bulk' }),
    lookup('artifacts', { query: 'no such text' }),
    lookup('artifacts', { area: 'areaA' }),
    lookup('artifacts', { after: id(400) }),
    lookup('artifacts', { record: 'not-a-uuid' }),
    lookup('artifacts', { record: id(300).toUpperCase() }),
    lookup('artifacts', { record: id(999) }),
    lookup('artifacts', { record: id(700) }),
  ]
  // Follow the cursor through every page as both versions report it.
  let after: string | null = null
  for (let page = 0; page < 6; page++) {
    const args = lookup('artifacts', { after })
    cases.push(args)
    const r = await search('v9', args)
    if (!r.next_cursor) break
    after = r.next_cursor
  }
  for (const args of cases) {
    for (const uid of [one, both]) assert.deepEqual(await search('v10', args, uid), await search('v9', args, uid), JSON.stringify(args))
  }
})

test('other datasets go through v9 unchanged', async () => {
  for (const dataset of ['project', 'solutions', 'target', 'tasks', 'physical_spaces', 'room_dimensions', 'plan']) {
    assert.deepEqual(await search('v10', lookup(dataset)), await search('v9', lookup(dataset)), dataset)
  }
})

test('denied and invalid calls fail exactly like v9', async () => {
  const cases: [(string | null)[], string | null, string?][] = [
    [lookup('artifacts'), two],
    [lookup('artifacts', { record: id(300) }), two],
    [lookup('artifacts', { record: id(700), project: 'B' }), one],
    [lookup('artifacts'), null],
    [lookup('artifacts'), null, 'anon'],
    [lookup('artifacts', { query: 'x'.repeat(201) }), one],
    [lookup('artifacts', { status: 'done' }), one],
    [lookup('nonsense'), one],
    [lookup('artifacts', { area: 'areaB' }), one],
  ]
  for (const [args, uid, role] of cases) {
    const expected = await failure('v9', args, uid, role)
    assert.equal(await failure('v10', args, uid, role), expected.replaceAll('search_bob_project_data_v9', 'search_bob_project_data_v10'), JSON.stringify([args, uid, role]))
  }
  assert.match(await failure('v10', lookup('artifacts'), two), /^42501:/)
})
