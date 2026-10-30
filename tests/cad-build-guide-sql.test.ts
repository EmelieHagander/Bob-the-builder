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
})
