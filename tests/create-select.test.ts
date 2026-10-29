import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectEdits } from '../supabase/functions/_shared/project-edits.ts'
import { createSolutionActions, CREATE_SELECT_PARAMETERS, SOLUTION_ACTION_TOOLS } from '../supabase/functions/_shared/project-solution-actions.ts'
import { parseDesignReadiness } from '../supabase/functions/_shared/project-design-intent.ts'
import type { ToolFollowup } from '../supabase/functions/_shared/project-tools/session.ts'
import { catalogFixture, preCreateSelectCatalogFixture, prePhaseToolsCatalogFixture } from './support/ai-catalog-fixture.ts'
import { CREATE_SELECT_MANUAL } from '../scripts/build-bob-create-select-catalog.ts'

// Paid box run 2026-10-29: an explicit box request took create → read → select
// → read → design-intent edit (rejected) → edit → read → alignment edit before
// any geometry. Owner decision: one call creates, aligns and selects.
const publication = '20261029180000_bob_create_select_catalog.sql'
const set = (path: string, value: unknown) => ({ op: 'set', path, value_json: JSON.stringify(value) })
const explicitBox = (alignment: 'aligned' | 'draft') => [
  set('/title', 'Plywood box'), set('/description', 'Open box in 12 mm plywood, 400 × 300 × 250 mm outside, five panels.'),
  set('/design_intent/summary', 'Open 12 mm plywood box, 400 × 300 × 250 mm outside, five panels.'),
  set('/design_intent/purpose', 'construction'),
  ...(alignment === 'aligned' ? [set('/design_intent/alignment', { status: 'aligned', basis: 'The request states material, outside size, open top and the five panels.' })] : []),
]

test('one call creates, aligns and selects an explicitly requested Solution on new manifests only', async t => {
  let beforeCatalog: any
  const pg = await projectSchema(async (db, name) => {
    if (name === publication) beforeCatalog = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  }, publication)
  t.after(() => pg.close())
  const rpc = async (uid: string | null, name: string, args: any[], role = 'authenticated'): Promise<any> =>
    ((await asProjectUser(pg, uid, `select ${name}(${args.map((_, n) => '$' + (n + 1)).join(',')}) result`, args, role)).rows[0] as any).result
  const owner = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'select@example.test'])

  /** One claimed owner turn with the ordinary service-owned job row and v18 writer. */
  async function turn(projectName: string, message: string) {
    const project = (await rpc(owner, 'bob.create_project', [JSON.stringify({ name: projectName })])).id, turnId = randomUUID()
    const claim = await rpc(null, 'bob.bob_claim_turn', [project, owner, turnId, message], 'service_role')
    const binding = [project, claim.thread_id, turnId, claim.generation]
    let writes = 0
    const writer = createProjectWriter(project, message, async (payload: any) => {
      writes++
      try { return { data: await rpc(owner, 'bob.bob_project_write_v18', [...binding, JSON.stringify(payload)]), error: null } }
      catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
    }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }), { unlimitedWork: true })
    const readiness = async (targetRevision: number, areaId: string | null) =>
      parseDesignReadiness(await rpc(owner, 'bob.read_design_readiness', [project, areaId, targetRevision, 'construction']))!
    const edits = createProjectEdits({ projectId: project, writer, hasAccess: async () => true, unlimitedWork: true, writeState: { readiness },
      read: async q => ({ data: await rpc(owner, 'bob.read_bob_edit_context', [project, q.resource, q.query, q.after]), error: null }),
      readSelected: async area => ({ data: await rpc(owner, 'bob.read_bob_selected_edit_context', [project, area]), error: null }) })
    let reads = 0
    const options = { projectId: project, writer, hasAccess: async () => true, unlimitedWork: true,
      read: async (q: any) => { reads++; return { data: await rpc(owner, 'bob.read_bob_solution_context', [project, q.resource, q.query, q.after]), error: null } } }
    const actions = (createSelect: boolean) => createSolutionActions({ ...options, writeState: { readiness, selectedEdit: area => edits.readSelected(area) }, createSelect })
    const target = async () => (await pg.query<any>('select solution_id,solution_revision,revision from bob.current_target where project_id=$1 and area_id is null', [project])).rows[0]
    return { project, message, writer, actions, target, get reads() { return reads }, get writes() { return writes } }
  }
  const scopeRef = async (actions: ReturnType<typeof createSolutionActions>) =>
    ((await actions.execute('read_solution_context', { resource: 'scopes', query: null, next_ref: null })) as any).entries[0].ref

  await t.test('publication versions only the create interface and its continuations, keeps pinned manifests and is idempotent', async () => {
    const current = (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result, latest = catalogFixture()
    for (const prior of beforeCatalog.definitions) {
      const row = current.definitions.find((r: any) => r.prompt_key === prior.prompt_key)
      if (!['tools.create_solution_alternative', 'bob.tools'].includes(prior.prompt_key)) { assert.deepEqual(row, prior, prior.prompt_key); continue }
      assert.equal(row.version, prior.version + 1, prior.prompt_key); assert.equal(row.content, prior.content)
      assert.equal(row.metadata.create_select_version, 1); assert.equal(row.metadata.write_state_version, 1)
      // Compared at the boundary before the 2026-10-29 phase-tools publication, which later revised the bench and cards.
      assert.deepEqual(row.definition, prePhaseToolsCatalogFixture().definition(row.prompt_key, row.definition_kind).definition, prior.prompt_key)
    }
    const create = current.definitions.find((r: any) => r.prompt_key === 'tools.create_solution_alternative').definition
    assert.deepEqual(create.parameters, CREATE_SELECT_PARAMETERS); assert.deepEqual(create.required_parameters, CREATE_SELECT_PARAMETERS.required)
    assert(create.description.includes(CREATE_SELECT_MANUAL)); assert.doesNotMatch(create.additional_description, /Selection is separate/)
    const model = latest.tool('create_solution_alternative', { server_quote: true, include_manual: true }).function
    assert.equal((model.parameters.properties as any).select.type, 'boolean'); assert(!JSON.stringify(model.parameters).includes('"request_quote"'))
    const pinned = preCreateSelectCatalogFixture().tool('create_solution_alternative', { server_quote: true }).function.parameters
    assert.equal((pinned.properties as any).select, undefined, 'pinned manifests keep the original interface')
    assert.deepEqual(preCreateSelectCatalogFixture().definition('tools.create_solution_alternative').definition.parameters, SOLUTION_ACTION_TOOLS[1].function.parameters)
    const followups = latest.definition('bob.tools', 'tool_contract').definition.operation_followups as ToolFollowup[]
    assert(followups.some(f => f.after_tool === 'create_solution_alternative' && f.when?.field === 'creation_state' && f.when.equals === 'ready' && f.tools.includes('save_construction_draft')))
    assert(followups.some(f => f.after_tool === 'create_solution_alternative' && f.when?.equals === 'needs_data' && f.tools.includes('edit_project_record')))
    const versions = (await pg.query<any>('select count(*) n from shared.ai_prompt_versions')).rows[0].n
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + publication, import.meta.url), 'utf8'))
    assert.equal((await pg.query<any>('select count(*) n from shared.ai_prompt_versions')).rows[0].n, versions)
  })

  await t.test('an explicit construction request is created, aligned and selected in one call and is ready for geometry', async () => {
    const fixture = await turn('Explicit box', 'Make a simple storage box in 12 mm plywood: 400 mm wide, 300 mm deep and 250 mm high outside, open at the top, five panels.')
    const actions = fixture.actions(true), scope = await scopeRef(actions)
    const result: any = await actions.execute('create_solution_alternative', { scope_ref: scope, base_ref: null, changes: explicitBox('aligned'),
      reason: 'The owner specified this box.', request_quote: fixture.message, select: true })
    assert.equal(result.status, 'saved', JSON.stringify(result)); assert.equal(result.created, true); assert.equal(result.selected, true)
    assert.equal(result.creation_state, 'ready'); assert.equal(result.construction_readiness.status, 'ready')
    assert.equal(result.construction_readiness.target_revision, 1); assert.equal(result.construction_readiness.solution_revision, 1)
    assert.match(result.solution_ref, /^choice_/); assert.match(result.edit.edit_ref, /^edit_/)
    assert.equal(fixture.writes, 2, 'creation and selection keep their own receipts'); assert.equal(fixture.reads, 2, 'the scope read and one bounded ref lookup')
    assert.equal((await fixture.target()).solution_revision, 1)
    assert.deepEqual(fixture.writer.unresolvedTools, [])
    // An exact retry of the same call replays both receipts without new writes.
    const again: any = await actions.execute('create_solution_alternative', { scope_ref: scope, base_ref: null, changes: explicitBox('aligned'),
      reason: 'The owner specified this box.', request_quote: fixture.message, select: true })
    assert.equal(again.selected, true); assert.equal(again.creation_state, 'ready'); assert.equal((await fixture.target()).revision, 1)
  })

  await t.test('a request without its needed choices stays draft: selected, but not ready, never approved by the server', async () => {
    const fixture = await turn('Open choices', 'Make a storage box for the hall; pick a sensible design and select it.')
    const actions = fixture.actions(true), scope = await scopeRef(actions)
    const result: any = await actions.execute('create_solution_alternative', { scope_ref: scope, base_ref: null, changes: explicitBox('draft'),
      reason: 'Proposed box for the hall.', request_quote: fixture.message, select: true })
    assert.equal(result.status, 'saved', JSON.stringify(result)); assert.equal(result.selected, true)
    assert.notEqual(result.creation_state, 'ready'); assert.equal(result.creation_state, result.construction_readiness.status)
    assert(result.construction_readiness.issues.length > 0)
  })

  await t.test('a selection that changed after the scope read leaves the new alternative saved, unselected and reported', async () => {
    const fixture = await turn('Concurrent selection', 'Create this plywood box alternative and select it.')
    const actions = fixture.actions(true), scope = await scopeRef(actions)
    const other = randomUUID()
    await rpc(owner, 'bob.solution_command', [fixture.project, 'create', other, 0, JSON.stringify({ title: 'Other', description: 'Chosen elsewhere', assumptions: '', tradeoffs: '', measurements: [], design_intent: null })])
    await rpc(owner, 'bob.solution_command', [fixture.project, 'select', other, 0, JSON.stringify({ solution_revision: 1, reason: 'Chosen in the app' })])
    const result: any = await actions.execute('create_solution_alternative', { scope_ref: scope, base_ref: null, changes: explicitBox('aligned'),
      reason: 'The owner specified this box.', request_quote: fixture.message, select: true })
    assert.equal(result.status, 'saved'); assert.equal(result.created, true); assert.equal(result.selected, false)
    assert.equal(result.selection.status, 'conflict'); assert.match(result.message, /not selected/); assert.match(result.solution_ref, /^choice_/)
    assert.equal(result.creation_state, undefined, 'no readiness is claimed for an unselected alternative')
    assert.equal((await fixture.target()).solution_id, other, 'the newer selection is preserved')
    assert.deepEqual(fixture.writer.unresolvedTools, ['select_solution_alternative'], 'the failed selection stays a known gap')
  })

  await t.test('select=false keeps the selection; the field is required on new pins and unknown on pinned manifests', async () => {
    const fixture = await turn('Keep selection', 'Make an extra plywood box alternative to compare, without choosing it.')
    const actions = fixture.actions(true), scope = await scopeRef(actions)
    const missing: any = await actions.execute('create_solution_alternative', { scope_ref: scope, base_ref: null, changes: explicitBox('draft'), reason: 'Compare', request_quote: fixture.message })
    assert.equal(missing.status, 'invalid'); assert.match(missing.message, /Set select to true/)
    const kept: any = await actions.execute('create_solution_alternative', { scope_ref: scope, base_ref: null, changes: explicitBox('draft'), reason: 'Compare', request_quote: fixture.message, select: false })
    assert.equal(kept.status, 'saved'); assert.equal(kept.selected, false); assert.equal(kept.created, undefined); assert.match(kept.solution_ref, /^choice_/)
    assert.equal(await fixture.target(), undefined)
    const legacy = fixture.actions(false), legacyScope = await scopeRef(legacy)
    const extra: any = await legacy.execute('create_solution_alternative', { scope_ref: legacyScope, base_ref: null, changes: [set('/title', 'Legacy'), set('/description', 'Old interface.')],
      reason: 'Legacy pin', request_quote: fixture.message, select: true })
    assert.equal(extra.status, 'invalid', 'pinned manifests keep the original interface')
    const old: any = await legacy.execute('create_solution_alternative', { scope_ref: legacyScope, base_ref: null, changes: [set('/title', 'Legacy'), set('/description', 'Old interface.')],
      reason: 'Legacy pin', request_quote: fixture.message })
    assert.equal(old.status, 'saved'); assert.equal(old.selected, false)
  })
})
