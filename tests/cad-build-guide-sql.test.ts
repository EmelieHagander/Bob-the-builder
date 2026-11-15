// Build guides saved with the drawing revision (2026-10-30): the switch is off
// by default, guide pages are bound to their notes and the drawing's construction
// pin, and volunteers get them only where they already get the drawing.
import { designIntent } from './support/design-intent-fixture.ts'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

let pg: PGlite
const owner = randomUUID(), json = JSON.stringify
const query = (sql: string, args: unknown[] = [], uid: string | null = owner, role = 'authenticated') => asProjectUser(pg, uid, sql, args, role)
async function call(name: string, args: unknown[], role = 'authenticated'): Promise<any> {
  return (await query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role === 'anon' ? null : owner, role)).rows[0].result
}
before(async () => { pg = await projectSchema(); await pg.query('insert into auth.users values($1,$2,now())', [owner, 'guide-reader@example.test']) })
after(() => pg.close())

const svg = (n: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><text>page ${n}</text></svg>`).toString('base64')
const sha = (b64: string) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')
const pin = { version: 1, project_id: 'p', artifact_id: '11111111-1111-4111-8111-111111111111', revision: 4, check: {} }
function guided(pages = 2, change: (g: any, files: any) => void = () => {}) {
  const files: any = { front: svg(90), step: 'U1RFUA==' }
  const guide: any = { version: 1, status: 'generated', basis: 'proposed_order', construction: { artifact_id: pin.artifact_id, revision: pin.revision }, pages: [] }
  for (let n = 0; n < pages; n++) { files[`guide-${n}`] = svg(n); guide.pages.push({ key: `guide-${n}`, kind: n ? 'step' : 'parts', sha256: sha(files[`guide-${n}`]) }) }
  change(guide, files)
  return { manifest: { bob_construction: pin, build_guide: guide }, files }
}

test('the build-guide switch exists only as off', async () => {
  const rows = (await pg.query(`select is_enabled from shared.ai_settings where app='bob' and function_name='cad-build-guide'`)).rows
  assert.ok(rows.every((r: any) => r.is_enabled === false), 'a missing row or a false row: the guide is off')
})

test('guide pages must match their notes and the drawing construction pin', async () => {
  await pg.exec(`create temp table guide_rows (like bob.artifact_cad_revisions including defaults);
    create trigger validate_cad_build_guide before insert on guide_rows for each row execute function bob_private.validate_cad_build_guide();`)
  const insert = (manifest: unknown, files: unknown) => pg.query(`insert into guide_rows(project_id,artifact_id,artifact_revision,recipe,manifest,files)
    values('p',$1,1,'{"units":"mm","contract_version":1}',$2,$3)`, [randomUUID(), json(manifest), json(files)])
  // Drawings without a guide are unaffected.
  await insert({ bob_construction: pin }, { front: svg(9), step: 'U1RFUA==' })
  const ok = guided(); await insert(ok.manifest, ok.files)
  await insert({ bob_construction: pin, build_guide: { version: 1, status: 'not_generated', reason: 'no_assembly_order', construction: { artifact_id: pin.artifact_id, revision: 4 }, pages: [] } }, { front: svg(9) })
  await insert({ bob_construction: pin, build_guide: { version: 1, status: 'failed', reason: 'guide_unavailable', construction: { artifact_id: pin.artifact_id, revision: 4 } } }, { front: svg(9) })
  const refused: [string, ReturnType<typeof guided> | { manifest: unknown; files: unknown }][] = [
    ['guide file without notes', { manifest: { bob_construction: pin }, files: { front: svg(9), 'guide-0': svg(0) } }],
    ['hash mismatch', guided(2, g => { g.pages[1].sha256 = 'f'.repeat(64) })],
    ['other construction revision', guided(2, g => { g.construction.revision = 3 })],
    ['other construction', guided(2, g => { g.construction.artifact_id = randomUUID() })],
    ['unnoted extra page', guided(2, (_g, files) => { files['guide-2'] = svg(2) })],
    ['noted page missing', guided(2, (_g, files) => { delete files['guide-1'] })],
    ['duplicate page', guided(2, g => { g.pages.push({ ...g.pages[0] }) })],
    ['not generated but has pages', guided(2, g => { g.status = 'not_generated' })],
    ['unknown status', guided(1, g => { g.status = 'maybe' })],
    ['unknown version', guided(1, g => { g.version = 2 })],
  ]
  for (const [name, row] of refused) await assert.rejects(insert(row.manifest, row.files), /cad_build_guide_invalid/, name)
  await assert.rejects(insert({ build_guide: ok.manifest.build_guide }, ok.files), /cad_build_guide_invalid/, 'a guide needs the drawing pin')
})

test('volunteers get guide pages only on drawings they can already read', async () => {
  const project = (await call('bob.create_project', [json({ name: 'Guide reader proof' })])).id
  const draft = await call('bob_private.project_plan_propose', [project, 0, json({ summary: 'Work', reason: 'Fixture', steps: ['Assembly', 'Finishing'].map(title => ({ step_id: null, title, goal: title, state: 'active', phase: 'design', area_id: null, responsible_kind: 'bob', responsible_person_id: null, notes: '', requirements: [] })), task_links: [] })], 'postgres')
  const plan = await call('bob_private.project_plan_decide', [project, 0, draft.record.revision, 'approve', 'Fixture'], 'postgres')
  const steps = plan.record.steps.map((s: any) => s.id)
  const task = (await call('bob.create_work_task', [project, steps[0], null, 'Build bench', 'novice', '1h'])).id
  const solution = randomUUID()
  await call('bob.solution_command', [project, 'create', solution, 0, json({ area_id: null, title: 'Bench', description: 'Design', assumptions: 'Unverified', tradeoffs: '', measurements: [], design_intent: designIntent() })])
  await call('bob.solution_command', [project, 'select', solution, 0, json({ solution_revision: 1, reason: 'Fixture' })])
  const invite = randomBytes(32).toString('hex'), secret = randomBytes(32).toString('hex')
  await call('bob.create_volunteer_link', [project, 'Test participants', invite, 30])
  await call('bob.volunteer_join', [invite, secret, 'Test participant', null], 'anon')
  const drawing = async (step: string | null, pinned: boolean) => {
    const id = randomUUID()
    await call('bob.artifact_command', [project, 'create', id, 0, json({ area_id: null, title: 'Bench drawing', kind: 'detail', description: 'Saved description', status: 'concept', assumptions: 'Fit must be checked', target_revision: 1, measurements: [], source_media_id: null })])
    if (step) await pg.query('insert into bob.artifact_step_links values($1,$2,$3)', [project, id, step])
    // Admin-only synthetic rows, validators off: they are covered above and in the
    // construction tests. This test is only about what the volunteer reader passes on.
    const row = guided(2)
    const manifest: any = { ...row.manifest, internal: 'NOT_SHARED' }
    if (!pinned) delete manifest.bob_construction
    await pg.exec('alter table bob.artifact_cad_revisions disable trigger user;')
    try {
      await pg.query('insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,$3,$4,$5)', [project, id,
        json({ contract_version: 1, units: 'mm', definitions: [] }), json(manifest), json({ ...row.files, log: 'NOT_SHARED' })])
    } finally { await pg.exec('alter table bob.artifact_cad_revisions enable trigger user;') }
    return { id, row }
  }
  const visible = await drawing(steps[0], false), elsewhere = await drawing(steps[1], false), unverifiable = await drawing(steps[0], true)
  const read = (id: string) => call('bob.volunteer_drawing', [secret, task, id, 1], 'anon')
  const cad = (await read(visible.id)).content.cad
  assert.deepEqual(cad.build_guide, visible.row.manifest.build_guide)
  assert.deepEqual(Object.keys(cad.files).sort(), ['front', 'guide-0', 'guide-1'])
  assert.doesNotMatch(json(cad), /NOT_SHARED/)
  await assert.rejects(read(elsewhere.id), /Drawing unavailable/)
  // A construction that cannot be checked hides the drawing and its guide alike.
  const hidden = await read(unverifiable.id)
  assert.equal(hidden.sourceState, 'unavailable'); assert.equal(hidden.content, null)
  // Stored pages (2026-11-09): the same scope, through their own reader.
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><text>stored</text></svg>', hash = createHash('sha256').update(text).digest('hex'), gid = 'e'.repeat(64)
  await query('select bob.store_cad_guide_pages($1,$2,$3)', [project, gid, json([{ key: 'guide-0', sha256: hash, svg: text }])], null, 'service_role')
  const stored = async (step: string) => {
    const id = randomUUID()
    await call('bob.artifact_command', [project, 'create', id, 0, json({ area_id: null, title: 'Stored guide drawing', kind: 'detail', description: 'Saved', status: 'concept', assumptions: 'Check', target_revision: 1, measurements: [], source_media_id: null })])
    await pg.query('insert into bob.artifact_step_links values($1,$2,$3)', [project, id, step])
    const guide = { version: 1, status: 'generated', basis: 'proposed_order', store: 'pages', guide_id: gid, construction: { artifact_id: pin.artifact_id, revision: pin.revision }, pages: [{ key: 'guide-0', kind: 'parts', sha256: hash }] }
    await pg.exec('alter table bob.artifact_cad_revisions disable trigger user;')
    try {
      await pg.query('insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,$3,$4,$5)', [project, id,
        json({ contract_version: 1, units: 'mm', definitions: [] }), json({ build_guide: guide }), json({ front: svg(9) })])
    } finally { await pg.exec('alter table bob.artifact_cad_revisions enable trigger user;') }
    return id
  }
  const mine = await stored(steps[0]), theirs = await stored(steps[1])
  const pages = (id: string, keys: string[]) => call('bob.volunteer_guide_pages', [secret, task, id, 1, keys], 'anon')
  assert.deepEqual((await pages(mine, ['guide-0', 'guide-9'])).pages, { 'guide-0': text })
  await assert.rejects(pages(theirs, ['guide-0']), /Drawing unavailable/, 'another step\'s drawing stays hidden')
  await assert.rejects(pages(visible.id, ['guide-0']), /Drawing unavailable/, 'a guide kept in its row has no stored pages')
  await assert.rejects(call('bob.volunteer_guide_pages', ['f'.repeat(64), task, mine, 1, ['guide-0']], 'anon'), /./, 'a wrong session reads nothing')
})

// 2026-11-09: pages in their own store, any length, read through project access.
test('stored guide pages: written once by the service, required before save, read by members and task volunteers only', async () => {
  const project = (await call('bob.create_project', [json({ name: 'Stored guide proof' })])).id
  const text = (n: number) => `<svg xmlns="http://www.w3.org/2000/svg"><text>stored ${n}</text></svg>`
  const page = (n: number) => ({ key: `guide-${n}`, sha256: createHash('sha256').update(text(n)).digest('hex'), svg: text(n) })
  const guideId = 'c'.repeat(64)
  const store = (pages: unknown[], role = 'service_role') => query('select bob.store_cad_guide_pages($1,$2,$3) result', [project, guideId, json(pages)], role === 'service_role' ? null : owner, role)
  await assert.rejects(store([page(0)], 'authenticated'), /permission denied/, 'clients cannot write pages')
  assert.equal((await store([page(0), page(1)])).rows[0].result, 2)
  assert.equal((await store([page(0)])).rows[0].result, 0, 'same bytes again is a no-op')
  await assert.rejects(store([{ ...page(5), key: 'guide-0' }]), /cad_guide_pages_conflict/, 'a key never changes its body')
  await assert.rejects(store([{ ...page(2), sha256: 'f'.repeat(64) }]), /cad_guide_pages_invalid/, 'the hash is checked')
  await store(Array.from({ length: 30 }, (_, i) => page(i + 100)))
  // The save trigger: notes with store 'pages' need every page stored, and no page in the row.
  await pg.exec(`create temp table stored_rows (like bob.artifact_cad_revisions including defaults);
    create trigger validate_cad_build_guide before insert on stored_rows for each row execute function bob_private.validate_cad_build_guide();`)
  const notes = (keys: number[], change: (g: any) => void = () => {}) => {
    const g: any = { version: 1, status: 'generated', basis: 'proposed_order', store: 'pages', guide_id: guideId, construction: { artifact_id: pin.artifact_id, revision: pin.revision },
      pages: keys.map(n => ({ key: `guide-${n}`, kind: 'step', sha256: page(n).sha256 })) }
    change(g); return { bob_construction: pin, build_guide: g }
  }
  const insert = (manifest: unknown, files: unknown = { front: svg(9) }) => pg.query(`insert into stored_rows(project_id,artifact_id,artifact_revision,recipe,manifest,files)
    values($1,$2,1,'{"units":"mm","contract_version":1}',$3,$4)`, [project, randomUUID(), json(manifest), json(files)])
  await insert(notes([0, 1, ...Array.from({ length: 30 }, (_, i) => i + 100)]))
  for (const [name, manifest, files] of [
    ['page not stored', notes([0, 7])], ['other hash', notes([0], g => { g.pages[0].sha256 = page(1).sha256 })],
    ['other guide', notes([0], g => { g.guide_id = 'd'.repeat(64) })], ['bad id', notes([0], g => { g.guide_id = 'x' })],
    ['unknown store', notes([0], g => { g.store = 'bucket' })], ['page in the row too', notes([0]), { front: svg(9), 'guide-0': svg(0) }],
  ] as [string, unknown, unknown?][]) await assert.rejects(insert(manifest, files), /cad_build_guide_invalid/, name)
  // Members read through RLS; another account reads nothing.
  const member = (await query('select page_key from bob.cad_guide_pages where project_id=$1 and guide_id=$2', [project, guideId])).rows.length
  assert.equal(member, 32)
  const stranger = randomUUID(); await pg.query('insert into auth.users values($1,$2,now())', [stranger, 'stranger@example.test'])
  assert.equal((await asProjectUser(pg, stranger, 'select page_key from bob.cad_guide_pages where project_id=$1', [project], 'authenticated')).rows.length, 0)
})

test('a catalogue revision has one leased illustration and one accepted thumbnail', async()=>{
  const {rows:[item]} = await pg.query<{id:string;revision:number}>('select r.item_id id,r.revision from bob.catalog_item_revisions r join bob.catalog_items i on i.id=r.item_id where i.project_id is null limit 1')
  const a=randomUUID(), b=randomUUID()
  const claim=(token:string,builtin=false,role='service_role')=>call('bob.claim_guide_item_art',['p',item.id,item.revision,token,builtin],role)
  await assert.rejects(claim(a,false,'authenticated'),/permission denied/)
  assert.equal((await claim(a,true)).status,'builtin')
  assert.equal((await claim(a)).token,a)
  assert.equal((await claim(b)).status,'unavailable')
  await pg.query('update bob.guide_item_illustrations set retry_after=now() where item_id=$1',[item.id])
  assert.equal((await claim(b)).token,b)
  const png='iVBORw0KGgo='
  const finish=(token:string)=>query('update bob.guide_item_illustrations set png=$1,claim_token=null where item_id=$2 and claim_token=$3 returning png',[png,item.id,token],owner,'service_role')
  assert.equal((await finish(a)).rows.length,0)
  assert.equal((await finish(b)).rows.length,1)
  assert.deepEqual(await claim(a),{status:'ready',png})
  assert.equal((await call('bob.claim_guide_item_art',['p',item.id,item.revision+999,a,false],'service_role')).status,'unavailable')
})
