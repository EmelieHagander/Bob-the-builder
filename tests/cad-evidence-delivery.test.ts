import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {checkedConstructionForDrawing} from '../supabase/functions/_shared/construction-draft.ts'
import {manufacturePolicy} from './support/construction-instance-policy-fixture.ts'
import { designIntent } from './support/design-intent-fixture.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy } from './support/main-catalog-fixture.ts'
import { shapeId, handoff, reviewReply } from './support/cad-review-fixture.ts'

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
  await call(owner, 'bob.solution_command', [project, 'create', solution, 0, JSON.stringify({ area_id: null, title: 'Shelf concept', description: 'Synthetic geometry', assumptions: 'Site fit unverified', tradeoffs: 'Simple', measurements: [], design_intent: { ...designIntent(), features: [] } })])
  await call(owner, 'bob.solution_command', [project, 'select', solution, 0, JSON.stringify({ solution_revision: 1, reason: 'Use this design' })])
  const recipe = { contract_version: 1 as const, units: 'mm' as const, assembly_id: 'p0-shelf',
    definitions: [{ id: 'panel', primitive: 'box' as const, material_ref: null, x_mm: 600, y_mm: 300, z_mm: 18 }],
    instances: [{ id: 'panel', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front' as const, 'top' as const] }
  const sourceTurn=randomUUID(),sourceClaim=await call(null,'bob.bob_claim_turn',[project,owner,sourceTurn,message],'service_role')
  const writeSource=(payload:any)=>call(owner,'bob.bob_project_write_v16',[project,sourceClaim.thread_id,sourceTurn,sourceClaim.generation,JSON.stringify(payload)])
  const mat=await writeSource({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'mat',kind:'material',name:'Plywood concept',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
  const source=await writeSource({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'checkpoint',title:'Shelf construction',description:'Synthetic single physical part',area_id:null,target_revision:1,change_note:'Initial',recipe,parameters:parameterPacket(project,recipe),materials:[{definition_id:'panel',material_id:mat.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],open_questions:['Strength remains unverified'],instance_policy:manufacturePolicy(recipe)}})
  await call(null,'bob.bob_fail_turn_v2',[project,owner,sourceClaim.thread_id,sourceTurn,sourceClaim.generation],'service_role')
  const constructionOptions={projectId:project,message,hasAccess:async()=>true,read:(id:string,revision:number|null)=>call(owner,'bob.read_construction_draft',[project,id,revision,null]),readCatalog:(id:string,revision:number)=>call(owner,'bob.catalog_read',[project,JSON.stringify({action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})]),readSources:async()=>({project:new Map(),physical:new Map()})}
  const request = { request_id: null, brief: message, handoff, area_id: null, component_id: null, step_id: step, artifact_id: source.recordId, construction_revision:1 }
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
      hasAccess: async () => true, makeLookup, readArtifact: async (id,revision) => ({...await call(owner,'bob.read_construction_draft',[project,id,revision,null]),source_kind:'construction'}),checkConstruction:(id,revision)=>checkedConstructionForDrawing(constructionOptions,id,revision),
      readDesignReadiness: (targetRevision, purpose, areaId) => call(owner, 'bob.read_design_readiness', [project, areaId ?? null, targetRevision, purpose]),
      // Match the production packet contract; rendering itself is still mocked.
      render: async (r,drawingSource) => { renders++; return { recipe: r, manifest: { engine: { name: 'build123d' }, assembly_id: r.assembly_id,drawing_source:drawingSource, instances: r.instances,bounding_box_mm:{min:[0,0,0],max:[600,300,18],size:[600,300,18]},checks:{collisions:{status:'complete',overlaps:[]}},annotations:{version:1,coverage:'complete'} },
        files: { front: 'PHN2Zz48L3N2Zz4=', top: 'PHN2Zz48L3N2Zz4=', step: privateStep }, previews: { front: 'Zml4dHVyZQ==', top: 'Zml4dHVyZQ==' } } },
      callModel: async o => { assert.equal(o.functionName,'cad-reviewer'); reviews++; return reviewReply() },
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
        if (calls === 2) {
          assert(names.includes('save_cad_design'), 'complete evidence must unlock saving without another owner prompt')
          return reply(null, 'save_cad_design', {})
        }
        // A saved receipt releases the candidate: no second save is offered.
        if (calls === 3) assert(!names.includes('save_cad_design'), 'a saved drawing is not offered for saving again')
        return reply('Konceptritningen är sparad och kopplad till arbetssteget.')
      },
    })
    assert.deepEqual(good.errors, [], 'the synthetic packet must satisfy the real SQL contract')
    assert.equal(good.writes, 1); assert.equal(good.renders, 1); assert.equal(good.reviews, 1)
    assert.equal(good.receipts.length, 1)
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
