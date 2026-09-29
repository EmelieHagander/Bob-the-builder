import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import {createCadAssistant} from './support/cad-parameter-fixture.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'

// Actual SQL/RLS/claimed-write and production orchestration; only AI/CAD network
// calls and the deliberately injected read failure are fixtures. No live data.
test('P0: one request reaches SQL, Step and project readback; failed review cannot save or disturb that delivery', async t => {
  const pg = await projectSchema(); t.after(() => pg.close())
  const owner = randomUUID(), message = 'Gör konceptritningen och spara den i arbetssteget.'
  const query = (sql: string, args: unknown[] = []) => asProjectUser(pg, owner, sql, args)
  const call = async (uid: string | null, name: string, args: unknown[], role = 'authenticated'): Promise<any> =>
    (await asProjectUser(pg, uid, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'p0-delivery@example.test'])
  const project = (await call(owner, 'bob.create_project', [JSON.stringify({ name: 'P0 delivery fixture' })])).id
  const proposal = await call(owner, 'bob_private.project_plan_propose', [project, 0, JSON.stringify({ summary: 'Build a shelf', reason: 'Requested',
    steps: [{ step_id: null, title: 'Design', goal: 'A usable concept drawing', state: 'active', phase: 'planning', area_id: null, responsible_kind: 'bob', responsible_person_id: null, notes: '', requirements: [] }], task_links: [] })], 'postgres')
  const step = (await call(owner, 'bob_private.project_plan_decide', [project, 0, proposal.record.revision, 'approve', 'Proceed'], 'postgres')).record.steps[0].id
  const solution = randomUUID()
  await call(owner, 'bob.solution_command', [project, 'create', solution, 0, JSON.stringify({ area_id: null, title: 'Shelf concept', description: 'Synthetic geometry', assumptions: 'Site fit unverified', tradeoffs: 'Simple', measurements: [] })])
  await call(owner, 'bob.solution_command', [project, 'select', solution, 0, JSON.stringify({ solution_revision: 1, reason: 'Use this design' })])
  const recipe = { contract_version: 1 as const, units: 'mm' as const, assembly_id: 'p0-shelf',
    definitions: [{ id: 'panel', primitive: 'box' as const, material_ref: null, x_mm: 600, y_mm: 300, z_mm: 18 }],
    instances: [{ id: 'panel', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front' as const, 'top' as const] }
  const request = { request_id: null, brief: message, handoff, area_id: null, component_id: null, step_id: step, artifact_id: null }
  const privateStep = Buffer.from('PRIVATE_STEP_EXPORT').toString('base64')
  const reply = (data: string | null, name?: string, args: unknown = {}) => ({ success: true, data, responseId: randomUUID(), model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    ...(name ? { toolCalls: [{ id: randomUUID(), type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] } : {}) })

  async function scenario(broken: boolean) {
    const turn = randomUUID(), claim = await call(null, 'bob.bob_claim_turn', [project, owner, turn, message], 'service_role')
    assert.equal(claim.status, 'claimed')
    let writes = 0, renders = 0, reviews = 0, designerCalls = 0
    const receipts: any[] = [], errors: string[] = []
    const writer = createProjectWriter(project, message, async payload => {
      writes++
      try {
        const data = await call(owner, 'bob.bob_project_write_v11', [project, claim.thread_id, turn, claim.generation, JSON.stringify(payload)])
        receipts.push(data); return { data, error: null }
      } catch (e: any) { errors.push(e.message); return { data: null, error: { code: e.code, message: e.message } } }
    }, async () => ({ data: receipts.slice(-1), error: null }), async () => ({ data: { generation: claim.generation, receipts: receipts.slice(-1) }, error: null }))
    const makeLookup = () => createProjectLookup(project, async (pid, q) => {
      if (broken && renders > 0 && q.dataset === 'physical_elements') return { data: null, error: { code: 'backend_error' } }
      try { return { data: await call(owner, 'bob.search_bob_project_data_v8', [pid, q.dataset, q.query, q.status, q.area_id, q.record_id, q.after_id ?? null]), error: null } }
      catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
    }, 5000, 40)
    const cadAssistant = createCadAssistant({ projectId: project, userId: owner, ownerRequest: message, available: true, deadline: Date.now() + 300000,
      hasAccess: async () => true, makeLookup, readArtifact: async () => null,
      // Match the production packet contract; rendering itself is still mocked.
      render: async r => { renders++; return { recipe: r, manifest: { engine: { name: 'build123d' }, assembly_id: r.assembly_id, instances: r.instances },
        files: { front: 'PHN2Zz48L3N2Zz4=', top: 'PHN2Zz48L3N2Zz4=', step: privateStep }, previews: { front: 'Zml4dHVyZQ==', top: 'Zml4dHVyZQ==' } } },
      callModel: async o => {
        if (o.functionName === 'cad-research') return reply(null, 'finish_cad_research', { checks: [{ id: 'shape', status: 'known', blocking: false, source_refs: ['requirement:shape'], action: 'none', detail: 'Synthetic concept requirement' }], additional_needs: [] })
        if (o.functionName === 'cad-reviewer') { reviews++; return reviewReply() }
        return ++designerCalls === 1 ? reply(null, 'render_cad_candidate', { purpose: 'project', recipe, dimension_bindings: [], title: 'Shelf concept', description: 'Synthetic construction', assumptions: 'Not certified or measured site fit', target_revision: 1, measurements: [] }) : reply('Ready for review.')
      },
    })
    return { writer, cadAssistant, makeLookup, receipts, errors, get writes() { return writes }, get renders() { return renders }, get reviews() { return reviews },
      finish: () => call(null, 'bob.bob_fail_turn_v2', [project, owner, claim.thread_id, turn, claim.generation], 'service_role') }
  }

  const good = await scenario(false)
  try {
    let calls = 0
    await runProjectAnswer({ projectId: project, userId: owner, message, lookup: good.makeLookup(), writer: good.writer, cadAssistant: good.cadAssistant, hasAccess: async () => true,
      callModel: async o => {
        if (o.schemaName === 'bob_delivery_language') return { ...reply(null), success: false }
        const names = o.tools?.map(tool => tool.function.name) ?? []
        if (++calls === 1) { assert(names.includes('design_project_cad')); return reply(null, 'design_project_cad', request) }
        if (calls === 2 || calls === 3) {
          assert(names.includes('save_cad_design'), 'complete evidence must unlock saving without another owner prompt')
          // The third call retries the exact save inside the active claim.
          return reply(null, 'save_cad_design', {})
        }
        return reply('Konceptritningen är sparad och kopplad till arbetssteget.')
      },
    })
    assert.deepEqual(good.errors, [], 'the synthetic packet must satisfy the real SQL contract')
    assert.equal(good.writes, 2); assert.equal(good.renders, 1); assert.equal(good.reviews, 1)
    assert.equal(good.receipts.length, 2)
    assert.deepEqual(good.receipts[1], good.receipts[0], 'retry reuses the exact SQL receipt, not a second Artifact')
    const saved = good.receipts[0], id = saved.recordId
    assert.deepEqual(saved.record.step_ids, [step])
    const overview: any = (await query('select * from bob.current_drawing_overview where id=$1', [id])).rows[0]
    assert.equal(overview.revision, 1); assert.equal(overview.steps[0].id, step); assert.equal(overview.source_state, 'current')
    assert(!JSON.stringify(overview).includes(privateStep))
    const work: any = (await query('select * from bob.current_drawing_steps where artifact_id=$1', [id])).rows[0]
    assert.equal(work.step_id, step); assert.equal(work.artifact_revision, 1)
    assert.deepEqual((await query('select recipe from bob.artifact_cad_revisions where artifact_id=$1 and artifact_revision=1', [id])).rows[0].recipe, recipe)
    assert.equal((await query('select * from bob.current_drawing_steps where artifact_id=$1', [id])).rows.length, 1)
    assert.equal((await query('select * from bob.artifact_cad_revisions where project_id=$1', [project])).rows.length, 1)
  } finally { await good.finish() }

  const before = (await query('select * from bob.current_drawing_overview where project_id=$1 order by id', [project])).rows
  const bad = await scenario(true)
  try {
    const tools = createBobToolSession({ writer: bad.writer, cadAssistant: bad.cadAssistant, lookup: bad.makeLookup(), readPolicy: seedToolPolicy, message })
    await tools.prepare()
    const failed = await tools.execute('design_project_cad', request)
    assert.equal(failed.status, 'unavailable'); assert.equal(failed.stage, 'review')
    assert(!(await tools.prepare()).some(tool => tool.function.name === 'save_cad_design'))
    assert.notEqual((await tools.execute('save_cad_design', {})).status, 'saved', 'a guessed tool name is not authority')
    assert.equal(bad.writes, 0); assert.equal(bad.reviews, 0); assert.equal(bad.renders, 1)
    assert.deepEqual((await query('select * from bob.current_drawing_overview where project_id=$1 order by id', [project])).rows, before)
    assert.equal((await query('select * from bob.artifact_cad_revisions where project_id=$1', [project])).rows.length, 1)
  } finally { await bad.finish() }
})
