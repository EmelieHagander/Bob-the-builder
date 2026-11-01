import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { constructionFormFixture } from './support/construction-form-fixture.ts'
import { parameterPacket } from './support/cad-parameter-fixture.ts'
import { manufacturePolicy } from './support/construction-instance-policy-fixture.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectEdits } from '../supabase/functions/_shared/project-edits.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createConstructionViews } from '../supabase/functions/_shared/construction-views.ts'
import { readTaskSources } from '../supabase/functions/_shared/task-sources.ts'
import { parseDesignReadiness } from '../supabase/functions/_shared/project-design-intent.ts'
import { compactConstructionCheck } from '../supabase/functions/_shared/write-state.ts'
import { catalogCoreTools } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import type { ToolFollowup } from '../supabase/functions/_shared/project-tools/session.ts'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { catalogFixture, preWriteStateCatalogFixture, preTextHygieneCatalogFixture, prePhaseToolsCatalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'

const publication = '20261029113000_bob_write_state_catalog.sql'
const changedKeys = ['tools.save_construction_draft', 'tools.edit_construction_parts', 'tools.change_construction_parameters', 'tools.check_construction_draft',
  'tools.create_solution_alternative', 'tools.select_solution_alternative', 'tools.edit_project_record', 'bob.tools']

test('writes return the state they produced on new manifests; pinned manifests keep receipts only', async t => {
  let beforeCatalog: any
  const pg = await projectSchema(async (db, name) => {
    if (name === publication) beforeCatalog = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  }, publication)
  t.after(() => pg.close())
  const rpc = async (uid: string | null, name: string, args: any[], role = 'authenticated'): Promise<any> =>
    ((await asProjectUser(pg, uid, `select ${name}(${args.map((_, n) => '$' + (n + 1)).join(',')}) result`, args, role)).rows[0] as any).result
  const writeRpc = (kind: string) => kind === 'construction_work' ? 'bob.commit_construction_work'
    : ['bound_solution_create', 'bound_solution_target', 'bound_solution_evidence'].includes(kind) ? 'bob.bob_project_write_v18' : 'bob.bob_project_write_v17'
  const owner = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'state@example.test'])

  /** One claimed owner turn with the ordinary service-owned job row and writer. */
  async function turn(projectName: string, message: string) {
    const project = (await rpc(owner, 'bob.create_project', [JSON.stringify({ name: projectName })])).id, turnId = randomUUID()
    return { project, message, async claim() {
      const claim = await rpc(null, 'bob.bob_claim_turn', [project, owner, turnId, message], 'service_role')
      const binding = [project, claim.thread_id, turnId, claim.generation]
      const manifest = (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
      await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,status,
        claim_token,lease_until,credential,worker_url,expires_at,work_allowance_version,ai_catalog_manifest_id)
        values($1,$2,$3,$4,$5,$6,'running',$7,clock_timestamp()+interval '4 minutes','{"fixture":true}',
        'https://fixture.supabase.co/functions/v1/bob-worker',clock_timestamp()+interval '30 minutes',1,$8)`,
        [randomUUID(), project, owner, claim.thread_id, turnId, claim.generation, randomUUID(), manifest.manifest_id])
      const write = (payload: any) => rpc(owner, writeRpc(payload.kind), [...binding, JSON.stringify(payload)])
      const sqlErrors: string[] = []
      const writer = createProjectWriter(project, message, async (payload: any) => {
        try { return { data: await write(payload), error: null } } catch (e: any) { sqlErrors.push(e.message); return { data: null, error: { code: e.code, message: e.message } } }
      }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }), { unlimitedWork: true })
      const readiness = async (targetRevision: number, areaId: string | null) =>
        parseDesignReadiness(await rpc(owner, 'bob.read_design_readiness', [project, areaId, targetRevision, 'construction']))!
      return { binding, write, writer, sqlErrors, readiness }
    } }
  }

  await t.test('publication versions only the eight write interfaces/continuations, retains pinned manifests and is idempotent', async () => {
    // The 2026-10-29 text-hygiene publication later adds text to two of these tools.
    const current = (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result, latest = preTextHygieneCatalogFixture()
    for (const prior of beforeCatalog.definitions) {
      const row = current.definitions.find((r: any) => r.prompt_key === prior.prompt_key)
      if (!changedKeys.includes(prior.prompt_key)) assert.deepEqual(row, prior, prior.prompt_key)
      else {
        assert.equal(row.version, prior.version + 1, prior.prompt_key); assert.equal(row.content, prior.content)
        assert.equal(row.metadata.write_state_version, 1)
        assert.deepEqual(row.definition, latest.definition(row.prompt_key, row.definition_kind).definition, prior.prompt_key)
      }
    }
    assert.deepEqual(catalogCoreTools(latest), ['describe_tool', 'open_project_item', 'read_solution_context', 'read_construction_draft', 'change_construction_parameters'])
    assert(catalogCoreTools(preWriteStateCatalogFixture())!.includes('search_project_data'), 'pinned manifests keep their bench')
    const followups = latest.definition('bob.tools', 'tool_contract').definition.operation_followups as ToolFollowup[]
    for (const name of ['save_construction_draft', 'edit_construction_parts', 'change_construction_parameters']) {
      assert(!followups.some(f => f.after_tool === name && f.tools.includes('check_construction_draft')), name)
      assert(followups.some(f => f.after_tool === name && f.when?.field === 'checked_concept_ready' && f.when.equals === true && f.tools.includes('design_project_cad')))
    }
    assert(followups.some(f => f.after_tool === 'select_solution_alternative' && f.when?.equals === 'ready' && f.tools.includes('save_construction_draft')))
    assert.match(latest.tool('save_construction_draft', { include_manual: true }).function.description, /saved result includes the whole-model check/)
    assert.doesNotMatch(latest.tool('save_construction_draft', { include_manual: true }).function.description, /Then check_construction_draft and correct/)
    assert.match(preWriteStateCatalogFixture().tool('save_construction_draft', { include_manual: true }).function.description, /Then check_construction_draft and correct/)
    const versions = (await pg.query<any>('select count(*) n from shared.ai_prompt_versions')).rows[0].n
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + publication, import.meta.url), 'utf8'))
    assert.equal((await pg.query<any>('select count(*) n from shared.ai_prompt_versions')).rows[0].n, versions)
  })

  await t.test('create returns a usable ref; select returns readiness and an edit entry; an edit returns a fresh ref', async () => {
    const message = 'Make a simple construction for a box; choose the alternative and record it for construction.'
    const fixture = await turn('Solution state fixture', message), { writer, readiness, sqlErrors } = await fixture.claim()
    const edits = createProjectEdits({ projectId: fixture.project, writer, hasAccess: async () => true, unlimitedWork: true, writeState: { readiness },
      read: async q => ({ data: await rpc(owner, 'bob.read_bob_edit_context', [fixture.project, q.resource, q.query, q.after]), error: null }),
      readSelected: async area => ({ data: await rpc(owner, 'bob.read_bob_selected_edit_context', [fixture.project, area]), error: null }) })
    let solutionReads = 0
    const options = { projectId: fixture.project, writer, hasAccess: async () => true, unlimitedWork: true,
      read: async (q: any) => { solutionReads++; return { data: await rpc(owner, 'bob.read_bob_solution_context', [fixture.project, q.resource, q.query, q.after]), error: null } } }
    const actions = createSolutionActions({ ...options, writeState: { readiness, selectedEdit: area => edits.readSelected(area) } })
    const scopes: any = await actions.execute('read_solution_context', { resource: 'scopes', query: null, next_ref: null })
    assert.equal(scopes.status, 'ok'); assert.equal(scopes.located, undefined, 'identities stay server-side')
    const scopeRef = scopes.entries[0].ref
    const created: any = await actions.execute('create_solution_alternative', { scope_ref: scopeRef, base_ref: null, reason: 'Requested box alternative', request_quote: message,
      changes: [{ op: 'set', path: '/title', value_json: '"Plywood box"' }, { op: 'set', path: '/description', value_json: '"Open box with five panels."' }] })
    assert.equal(created.status, 'saved', JSON.stringify({ created, sqlErrors })); assert.match(created.solution_ref, /^choice_/); assert.equal(created.selected, false)
    const readsBeforeSelect = solutionReads
    const selected: any = await actions.execute('select_solution_alternative', { solution_ref: created.solution_ref, scope_ref: scopeRef, reason: 'Use the requested box', request_quote: message })
    assert.equal(selected.status, 'saved', JSON.stringify({ selected, sqlErrors })); assert.equal(solutionReads, readsBeforeSelect, 'no model read between create and select')
    assert.match(selected.edit.edit_ref, /^edit_/); assert.equal(selected.construction_readiness, undefined, 'concept purpose has no construction gate')
    const first: any = await edits.execute('edit_project_record', { edit_ref: selected.edit.edit_ref, reason: 'Record the construction purpose', request_quote: message, changes: [
      { op: 'set', path: '/design_intent/summary', value_json: '"Open plywood box"' }, { op: 'set', path: '/design_intent/purpose', value_json: '"construction"' }] })
    assert.equal(first.status, 'saved', JSON.stringify({ first, sqlErrors })); assert.match(first.edit_ref, /^edit_/); assert.notEqual(first.edit_ref, selected.edit.edit_ref)
    assert.equal(first.construction_readiness.purpose, 'construction'); assert.equal(first.creation_state, first.construction_readiness.status)
    assert.equal(first.construction_readiness.target_revision, 2)
    const second: any = await edits.execute('edit_project_record', { edit_ref: first.edit_ref, reason: 'Delegated alignment', request_quote: message, changes: [
      { op: 'set', path: '/design_intent/alignment', value_json: JSON.stringify({ status: 'aligned', basis: 'Matches the requested open box.' }) }] })
    assert.equal(second.status, 'saved', 'the returned edit_ref binds the saved revision without another read'); assert.equal(second.construction_readiness.target_revision, 3)
    const legacy: any = await createSolutionActions(options).execute('create_solution_alternative', { scope_ref: scopeRef, base_ref: null, reason: 'Legacy pin', request_quote: message,
      changes: [{ op: 'set', path: '/title', value_json: '"Legacy box"' }, { op: 'set', path: '/description', value_json: '"Unchanged receipt."' }] })
    assert.equal(legacy.status, 'invalid', 'refs belong to the session that read them')
    const legacyActions = createSolutionActions(options), legacyScope = ((await legacyActions.execute('read_solution_context', { resource: 'scopes', query: null, next_ref: null })) as any).entries[0].ref
    const old: any = await legacyActions.execute('create_solution_alternative', { scope_ref: legacyScope, base_ref: null, reason: 'Legacy pin', request_quote: message,
      changes: [{ op: 'set', path: '/title', value_json: '"Legacy box"' }, { op: 'set', path: '/description', value_json: '"Unchanged receipt."' }] })
    assert.deepEqual(old, { status: 'saved', message: 'Saved. Read the same solution before further changes.', selected_updated: false })
  })

  await t.test('construction writes carry the same persisted check Bob would request; orphan nodes are named', async () => {
    const message = 'Make this same frame wider and deeper; preserve the other requirements and check the result.'
    const fixture = await turn('Construction state fixture', message), solution = randomUUID()
    const { intent, recipe, refinement } = constructionFormFixture()
    const body = { title: 'Frame and future drawer', description: 'Preserve the later drawer requirement.', assumptions: 'Strength unknown', tradeoffs: 'Partial concept', measurements: [], design_intent: intent }
    await rpc(owner, 'bob.solution_command', [fixture.project, 'create', solution, 0, JSON.stringify(body)])
    await rpc(owner, 'bob.solution_command', [fixture.project, 'select', solution, 0, JSON.stringify({ solution_revision: 1, reason: message })])
    const { binding, write, writer, sqlErrors } = await fixture.claim(), project = fixture.project
    const material = await write({ kind: 'catalog', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: message,
      data: { action: 'ensure', key: 'material', kind: 'material', name: 'Fixture plywood', aliases: [], profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood.plywood', 'sheet'], properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } }, material_id: null, material_revision: null, notes: '', source_kind: 'design_choice', source_quote: message, source_seq: null } })
    const initial = await write({ kind: 'construction', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: message,
      data: { key: 'initial', title: 'Frame', description: body.description, area_id: null, target_revision: 1, change_note: 'Initial', recipe, parameters: parameterPacket(project, recipe),
        materials: [{ definition_id: 'rail', material_id: material.recordId, material_revision: 1, part_id: null, part_revision: null }], joints: [], instance_policy: manufacturePolicy(recipe), open_questions: ['Joinery unverified'], form_refinement: refinement } })
    const id = initial.recordId, read = (revision: number | null = null) => rpc(owner, 'bob.read_construction_draft', [project, id, revision, null])
    const first = await read(), right = first.parameters.bindings.find((b: any) => b.path === 'instances/right/placement/x').node
    const depth = first.parameters.bindings.find((b: any) => b.path === 'definitions/rail/y_mm').node
    const edits = createProjectEdits({ projectId: project, writer, hasAccess: async () => true, unlimitedWork: true,
      read: async q => ({ data: await rpc(owner, 'bob.read_bob_edit_context', [project, q.resource, q.query, q.after]), error: null }),
      readSelected: async area => ({ data: await rpc(owner, 'bob.read_bob_selected_edit_context', [project, area]), error: null }) })
    const preparation = (name: string) => async (payload: any) => {
      try { return await rpc(owner, name, [...binding, JSON.stringify(payload)]) }
      catch (e: any) { return { status: e.code === '42501' ? 'denied' : ['PT409', '40001'].includes(e.code) ? 'conflict' : e.code === '22023' ? 'invalid' : 'unavailable', reason: e.message } }
    }
    let storedReads = 0
    const options: any = { projectId: project, message, writer, hasAccess: async () => true, unlimitedWork: true, constructionViews: true, formEvidence: true, constructionSourceRefresh: true, coherentWork: true,
      now: () => new Date('2026-10-29T11:00:00Z'), read: (_id: string | null, revision: number | null) => read(revision), readCurrent: () => read(),
      readSources: async () => ({ project: new Map(), physical: new Map() }),
      prepareEdit: preparation('bob.prepare_construction_edit'), prepareParameterChange: preparation('bob.prepare_construction_parameter_change'), prepareWork: preparation('bob.prepare_construction_work'), prepareSolutionEdit: edits.prepare,
      readCatalog: async (mid: string, revision: number) => ({ projectId: project, status: 'ok', record: { id: mid, revision, current_revision: revision, kind: 'material', source_kind: 'design_choice', profile_code: 'sheet_stock', categories: ['wood.plywood', 'sheet'], properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null } } } }),
      saveObservation: async (o: any) => rpc(null, 'bob.bob_record_construction_observation', [binding[0], owner, binding[1], binding[2], binding[3], JSON.stringify(o)], 'service_role'),
      readObservations: async (aid: string, revision: number, result: string | null, after: string | null) => { storedReads++; return rpc(owner, 'bob.read_construction_results', [project, aid, revision, result, after]) },
      readWorkSources: async (draft: any, stepId: string | null) => {
        const s = (await rpc(owner, 'bob.read_bob_selected_edit_context', [project, null]))[0]
        const packet = await readTaskSources({ area_id: draft?.area_id ?? null, step_id: stepId, construction: draft ? { artifact_id: id, revision: draft.revision } : null }, { projectId: project,
          search: async q => q.dataset === 'target' ? { status: 'ok', records: [{ id: 'project', revision: s.target.revision, solution_id: s.record.id, solution_revision: s.record.revision, design_intent: s.record.design_intent }] } : { status: 'empty', records: [] },
          construction: draft ? q => createConstructionViews(project).read(draft, q as any) : undefined })
        return { packet, solutionEdit: await edits.readSelected(null) }
      } }
    const stateTools = createConstructionTools({ ...options, writeState: true }), pinnedTools = createConstructionTools(options)
    const work: any = await stateTools.execute('read_construction_draft', { artifact_id: id, revision: 1, after: null, view: 'work', ids: [], result_id: null, section: null, step_id: null, work_kind: 'parameters' })
    const editRef = work.items.find((r: any) => r.collection === 'solution_edit').value.entry.edit_ref
    const changes = (width: number, deep: number) => [
      { op: 'set', path: `/design_intent/model/nodes/${intent.model.nodes.findIndex(n => n.id === 'frame_s0')}/value`, value_json: JSON.stringify(width) },
      { op: 'set', path: `/design_intent/model/nodes/${intent.model.nodes.findIndex(n => n.id === 'frame_s1')}/value`, value_json: JSON.stringify(deep) },
      { op: 'set', path: '/design_intent/alignment', value_json: JSON.stringify({ status: 'aligned', basis: 'Requested dimensions preserve the frame requirements and later drawer.' }) }]
    const saved: any = await stateTools.execute('change_construction_parameters', { key: 'wider', record_id: id, expected_revision: 1, target_revision: null, request_quote: message, change_note: 'Change both frame dimensions together',
      solution_edit: { edit_ref: editRef, changes: changes(620, 450), reason: 'Requested wider and deeper frame' },
      changes: [{ id: right, role: 'decision', value: 602, unit: 'mm', reason: 'Requested frame width' }, { id: depth, role: 'decision', value: 450, unit: 'mm', reason: 'Requested frame depth' }] })
    assert.equal(saved.status, 'saved', JSON.stringify({ saved, sqlErrors })); assert.equal(saved.receipt.revision, 2)
    assert.equal(saved.check.status, 'checked', JSON.stringify(saved.check)); assert.equal(typeof saved.check.concept_ready, 'boolean')
    assert.equal(saved.checked_concept_ready, saved.check.concept_ready); assert.equal(saved.check.fabrication_ready, false)
    assert.deepEqual(saved.check.bounds_mm.size, [620, 450, 18]); assert.equal(saved.check.part_count, 2); assert.match(saved.check.result_id, /^cs_/)
    assert.equal(saved.check.details_read.result_id, saved.check.result_id); assert.equal(saved.diagnostics.operation, 'work_change')
    // The attached check is the persisted, reusable result of the ordinary check tool.
    const reads = storedReads
    const explicit: any = await stateTools.execute('check_construction_draft', { artifact_id: id, revision: 2, component_ids: [], requirement_checks: [], outputs: [] })
    assert.equal(explicit.diagnostics.reused, true); assert.equal(explicit.result.result_id, saved.check.result_id); assert.equal(storedReads, reads)
    const saved2 = await rpc(owner, 'bob.read_construction_results', [project, id, 2, null, null])
    assert(saved2.results.some((r: any) => r.result_id === saved.check.result_id), 'the attached check was persisted like an explicit check')
    // A pinned manifest keeps the receipt-only result and its original sequence.
    const draft = await read(), old = draft.parameters.nodes.find((n: any) => n.id === depth), { normalized, sources, ...node } = old
    const pinned: any = await pinnedTools.execute('edit_construction_parts', { key: 'pinned-depth', record_id: id, expected_revision: 2, target_revision: null, request_quote: message,
      change_note: 'Pinned manifest edit', solution_edit: null, changes: { nodes: { upsert: [{ ...node, value: 450 }], remove: [] } } })
    assert(['saved', 'invalid', 'conflict'].includes(pinned.status), JSON.stringify(pinned)); assert.equal(pinned.check, undefined); assert.equal(pinned.checked_concept_ready, undefined)
    const head = (await read()).revision
    const orphan = { key: 'orphan-node', record_id: id, expected_revision: head, target_revision: null, request_quote: message, change_note: 'Add an unused helper', solution_edit: null,
      changes: { nodes: { upsert: [{ id: 'unused_gap', role: 'decision', value: 5, unit: 'mm', reason: 'Spare gap' }], remove: [] } } }
    const named: any = await stateTools.execute('edit_construction_parts', orphan)
    assert.equal(named.status, 'invalid', JSON.stringify(named)); assert.deepEqual(named.unused_nodes, ['unused_gap']); assert.match(named.message, /unused_gap/)
    const legacy: any = await pinnedTools.execute('edit_construction_parts', { ...orphan, key: 'orphan-node-pinned' })
    assert.deepEqual(legacy, { status: 'invalid', message: 'parameter_unused_node' }, 'pinned manifests keep their original rejection text')
    assert.equal((await read()).revision, head)
  })
})

test('a check that cannot complete is reported inside the saved result, never as a pass', () => {
  assert.deepEqual(compactConstructionCheck({ status: 'conflict', reason: 'construction_revision_changed', current_revision: 4 }),
    { status: 'conflict', reason: 'construction_revision_changed', current_revision: 4,
      message: 'The write is saved, but its check did not complete. Call check_construction_draft for this exact revision before relying on it.' })
  assert.equal(compactConstructionCheck(undefined).status, 'unavailable')
  const issues = Array.from({ length: 80 }, (_, n) => ({ code: 'collision', ids: ['a' + n, 'b' + n], message: 'Parts overlap by a measured amount that needs correction ' + n }))
  const compact = compactConstructionCheck({ status: 'checked', concept_ready: false, issue_count: 80, issues, fabrication_gaps: [], fabrication_gap_count: 0, coverage: { complete: true },
    result: { result_id: 'cs_x', read: { view: 'result', result_id: 'cs_x' } } })
  assert(compact.issues.length > 0 && compact.issues.length < 80); assert.equal(compact.findings_omitted, 80 - compact.issues.length)
  assert.equal(compact.coverage_complete, false); assert.equal(compact.concept_ready, false); assert.equal(compact.details_read.result_id, 'cs_x')
  // Chosen joint fasteners (2026-11-01): facts follow the findings inside the same budget.
  const rows = Array.from({ length: 80 }, (_, n) => ({ joint_id: 'j' + n, kind: 'screw', diameter_mm: 4, length_mm: 45, count: 3, gaps: ['narrow_contact'] }))
  const few = issues.slice(0, 3), withFacts = compactConstructionCheck({ status: 'checked', concept_ready: false, issue_count: 3, issues: few, fabrication_gaps: [], fabrication_gap_count: 0,
    coverage: { complete: true }, fastener_facts: { status: 'ok', complete: true, glue_packages: 1, rows } })
  assert.deepEqual(withFacts.issues, few, 'facts never push findings out')
  assert(withFacts.fastener_facts.rows.length > 0 && withFacts.fastener_facts.rows.length < 80)
  assert.equal(withFacts.fastener_facts.rows_omitted, 80 - withFacts.fastener_facts.rows.length); assert.equal(withFacts.fastener_facts.glue_packages, 1)
})

test('manifests pinned before the phase tools offer the five-tool bench; project search stays loadable, not preloaded', async () => {
  // The 2026-10-29 phase-tools publication returns search_project_data to the bench (tests/bob-phase-tools.test.ts).
  const catalog = prePhaseToolsCatalogFixture(), core = catalogCoreTools(catalog)!
  assert(!core.includes('search_project_data'))
  const projectId = 'p', message = 'Read the saved project', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_project, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Fixture', description: 'Saved project' }] : [], related: [], truncated: false }, error: null }), undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const constructionTools = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }) })
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  let offered: string[] = []
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, aiCatalog: catalog, corePreload: true,
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, data: JSON.stringify({ work_remaining: false }) }
      offered = options.tools!.map(t => t.function.name)
      return { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, responseId: 'only', data: 'The saved project is open.' }
    }, catalog) })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(offered.sort(), [...core].sort())
})
