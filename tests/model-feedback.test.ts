import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { conceptFixture } from './support/solution-concept-fixtures.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { MODEL_FEEDBACK_TOOLS } from '../supabase/functions/_shared/model-feedback.ts'
import { createProjectWriter, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { parseDesignReadiness } from '../supabase/functions/_shared/project-design-intent.ts'
import { parseSolutionPresentation } from '../src/domain/modelFeedback.ts'
import { parseBobScreen } from '../src/domain/bobScreen.ts'
import { createBobDraftBinding } from '../src/lib/bobDraftBinding.ts'
import { createSolutions } from '../src/data/solutions.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { catalogFixture, preBuildingScopeCatalogFixture } from './support/ai-catalog-fixture.ts'

const accepted = { outcome: 'accepted', authority: 'user', mandate_id: null, scope: 'whole_model', component_ids: [], has_corrections: false, has_uncertainty: false }
test('draft binds the shown version, including missing/late evidence, retries and project changes', () => {
  const first = { surface: 'solutions' as const, solutionId: randomUUID(), solutionRevision: 1, presentationId: randomUUID() }
  const next = { ...first, solutionRevision: 2, presentationId: randomUUID() }, binding = createBobDraftBinding()
  binding.start('A', first); first.solutionRevision = 9
  assert.equal(binding.read('A', next)?.solutionRevision, 1)
  assert.equal(binding.read('B', next), null)
  binding.clear(); binding.start('A', { surface: 'solutions' }); binding.start('A', next)
  assert.equal(binding.read('A', next)?.presentationId, undefined, 'late evidence cannot retarget an existing draft')
  binding.restore('A', first); assert.deepEqual(binding.read('A', next), first)
  binding.clear(); assert.deepEqual(binding.read('A', next), next)
  assert.deepEqual(parseBobScreen(next), next)
  for (const value of [{ surface: 'solutions', presentationId: next.presentationId }, { ...next, presentationId: 'bad' }, { surface: 'project', presentationId: next.presentationId }]) assert.throws(() => parseBobScreen(value), /invalid_screen/)
})

test('shown-model conversation, SQL authority, durable history and source reconciliation', async t => {
  let beforeCatalog: any
  const pg = await projectSchema(async(db, name) => {
    if (name === '20261027115812_ai_model_feedback_catalog.sql') beforeCatalog = (await db.query("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest
    if (name === '20260924120448_bob_background_jobs.sql') await db.exec(`create schema cron;create schema net;create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
  }); t.after(() => pg.close())
  const owner = randomUUID(), member = randomUUID(), stranger = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())', [owner,'model@example.test',member,'member@example.test',stranger,'stranger@example.test'])
  const call = async (uid: string | null, name: string, args: unknown[], role = 'authenticated'): Promise<any> => (await asProjectUser(pg, uid, `select bob.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
  const project = (await call(owner,'create_project',[{ name: 'Shown model' }])).id
  const foreign = (await call(stranger,'create_project',[{ name: 'Other model' }])).id
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('feedback-member',$1,'Member','M',$2)", [project,member])
  const solution = randomUUID(), intent = conceptFixture('bed')
  intent.alignment = { status: 'draft', basis: '' }
  const body = { title: 'Bed', description: 'Keep ladder and drawers', assumptions: 'Unmeasured', tradeoffs: '', measurements: [], design_intent: intent }
  await call(owner,'solution_command',[project,'create',solution,0,body])
  const target = await call(owner,'solution_command',[project,'select',solution,0,{ solution_revision: 1, reason: 'Explore this form' }])
  let shown: any
  const present = (user = owner, revision = 1, view = 'plan', area: string | null = null) => call(user,'record_solution_presentation',[project,solution,revision,view,area])
  const readiness = () => call(owner,'read_design_readiness',[project,null,null,'concept'])
  let active: any = null
  async function turn(message: string, presentation = shown, user = owner) {
    if (active) await call(null,'bob_fail_turn_v2',[project,active.user,active.thread_id,active.turn,active.generation],'service_role')
    const id = randomUUID(), c = await call(null,'bob_claim_turn',[project,user,id,message],'service_role')
    assert.equal(c.status,'claimed',JSON.stringify(c))
    active = { ...c, turn: id, user }
    const screen = presentation ? { surface: 'solutions', solutionId: presentation.solution_id, solutionRevision: presentation.solution_revision, presentationId: presentation.id } : { surface: 'solutions' }
    await call(null,'bob_capture_turn_screen',[project,user,c.thread_id,id,c.generation,screen],'service_role')
    const binding = [project,c.thread_id,id,c.generation], payloads: WritePayload[] = []
    const rpc = async (payload: WritePayload) => {
      payloads.push(structuredClone(payload))
      try { return { data: await call(user,'record_model_feedback',[...binding,payload]), error: null } }
      catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
    }
    const writer = createProjectWriter(project,message,rpc,async () => ({ data: [], error: null }),async () => ({ data: { generation: c.generation, receipts: [] }, error: null }))
    const setup = () => createSolutionActions({ projectId: project, writer, hasAccess: async () => true, read: async () => ({ data: [], error: null }),
      modelFeedback: { message, read: async before => ({ data: await call(user,'read_model_feedback',[...binding,before]), error: null }) } })
    return { actions: setup(), setup, writer, rpc, payloads, binding }
  }
  await t.test('catalog exposes both tools on demand and preserves old pins', async () => {
    const manifest: any = (await pg.query("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
    const catalog = createAiCatalogSession({ rpc: async () => ({ data: null, error: null }) } as any, { app: 'bob', manifest })
    for (const tool of MODEL_FEEDBACK_TOOLS) {
      assert.deepEqual(catalog.tool(tool.function.name).function.parameters, tool.function.parameters)
      assert.deepEqual(catalogFixture().tool(tool.function.name), catalog.tool(tool.function.name))
      assert.match(catalog.tool(tool.function.name,{ card:true }).function.description,/shown model/)
      assert.equal(preBuildingScopeCatalogFixture().manifest().definitions.some(r => r.prompt_key === 'tools.' + tool.function.name),false)
    }
    assert.deepEqual(manifest.models,beforeCatalog.models)
    assert.deepEqual((await pg.query("select shared.resolve_ai_catalog('bob',$1) manifest",[beforeCatalog.manifest_id])).rows[0].manifest,beforeCatalog)
    for (const prior of beforeCatalog.definitions) if (!['bob.tools','bob.workflows'].includes(prior.prompt_key)) assert.deepEqual(manifest.definitions.find((d: any) => d.prompt_key === prior.prompt_key),prior)
    assert.deepEqual(manifest.definitions.find((d: any) => d.prompt_key === 'bob.workflows').definition,catalogFixture().definition('bob.workflows').definition)
    const shelf = manifest.definitions.find((d: any) => d.prompt_key === 'bob.tools').definition
    assert(shelf.shelves.find((s: any) => s.label === 'Project records and memory').tools.includes('record_model_feedback'))
    assert(shelf.catalog.filter((x: any) => MODEL_FEEDBACK_TOOLS.some(t => t.function.name === x.name)).every((x: any) => !x.always_load))
  })
  await t.test('viewing is idempotent metadata, never acceptance; exact typed readback and ordinary RLS', async () => {
    shown = await present()
    assert(parseSolutionPresentation(shown,project)); assert.equal(shown.source_current,true); assert.deepEqual(shown.feedback,[])
    assert.equal((await present()).id,shown.id)
    assert.notEqual((await present(member)).id,shown.id,'presenter is server-owned')
    assert.equal((await call(member,'read_solution_presentation',[project,shown.id])).can_respond,false)
    assert.equal((await readiness()).status,'needs_data')
    await assert.rejects(present(owner,1,'made_up_view'),/presentation_unavailable/)
    await assert.rejects(present(stranger),/project_denied/)
    await assert.rejects(call(owner,'read_solution_presentation',[foreign,shown.id]),/project_denied/)
    assert.equal((await asProjectUser(pg,stranger,'select * from bob.solution_presentations where project_id=$1',[project])).rows.length,0)
    await assert.rejects(asProjectUser(pg,owner,'delete from bob.solution_presentations where id=$1',[shown.id]),/permission denied/)
    await assert.rejects(call(null,'record_solution_presentation',[project,solution,1,'plan',null],'service_role'),/permission denied/)
  })
  await t.test('ordinary yes with correction records a correction; inconsistent acceptance is refused in TS and SQL', async () => {
    const x = await turn('Ja, men flytta stegen. Behåll lådorna. Privat anteckning: fixture secret.')
    const lookup = createProjectLookup(project,async () => ({ data:{ records:[],related:[],truncated:false },error:null }))
    const session = createBobToolSession({ aiCatalog:catalogFixture(),message:'Ja, men flytta stegen. Behåll lådorna. Privat anteckning: fixture secret.',lookup,writer:x.writer,solutionActions:x.actions,readPolicy:seedToolPolicy })
    assert((await session.prepare()).some(t => t.function.name === 'read_model_feedback'))
    assert.equal((await session.execute('read_model_feedback',{ before_feedback_id:null })).presentation.id,shown.id)
    const old = createBobToolSession({ aiCatalog:preBuildingScopeCatalogFixture(),message:'Ja.',lookup,writer:x.writer,solutionActions:x.actions,readPolicy:seedToolPolicy })
    assert(!(await old.prepare()).some(t => t.function.name === 'record_model_feedback'))
    assert.equal((await x.actions.execute('read_model_feedback',{})).presentation.id,shown.id)
    assert.equal((await x.actions.execute('record_model_feedback',{ ...accepted, has_corrections: true })).status,'invalid')
    const args = { ...accepted, outcome: 'change_requested', has_corrections: true, scope: 'components', component_ids: ['ladder'] }
    const saved = await x.actions.execute('record_model_feedback',args)
    assert.equal(saved.status,'saved',JSON.stringify(saved)); assert.equal(saved.receipt.record.feedback.outcome,'change_requested')
    const packet = x.payloads.at(-1)!
    const direct = await x.rpc({ ...packet, data: { ...packet.data, outcome: 'accepted' } })
    assert.equal(direct.error?.code,'22023')
    assert.equal((await readiness()).status,'needs_data')
    const read = await present(); assert.equal(read.feedback[0].scope,'components'); assert.deepEqual(read.feedback[0].component_ids,['ladder'])
    assert(!JSON.stringify(read).includes('fixture secret')); assert(!JSON.stringify(read).includes('request_quote'))
    assert.equal((await x.rpc(packet)).data.record.feedback.id,saved.receipt.record.feedback.id,'exact retry is idempotent')
    const resumed = x.setup(); resumed.restoreState(x.actions.exportState())
    assert.equal((await resumed.execute('record_model_feedback',args)).receipt.record.feedback.id,saved.receipt.record.feedback.id)
    await assert.rejects(call(null,'bob_capture_turn_screen',[project,owner,active.thread_id,active.turn,active.generation,{ surface:'solutions',solutionId:solution,solutionRevision:2,presentationId:shown.id }],'service_role'),/turn_screen_changed/)
  })
  await t.test('uncertainty, partial acceptance and explicit delegation remain distinct', async () => {
    let x = await turn('Kanske, jag vet inte om det får plats.')
    assert.equal((await x.actions.execute('record_model_feedback',{ ...accepted, outcome:'unclear', has_uncertainty:true })).status,'saved')
    x = await turn('Lådan ser rätt ut.')
    assert.equal((await x.actions.execute('record_model_feedback',{ ...accepted, scope:'components', component_ids:['drawer'] })).status,'saved')
    assert.equal((await readiness()).status,'needs_data','partial feedback cannot settle the whole model')
    x = await turn('Du får bestämma hela den här modellens form inom förslaget.')
    const delegation = await x.actions.execute('record_model_feedback',{ ...accepted, outcome:'delegated' })
    assert.equal(delegation.status,'saved')
    assert.equal((await readiness()).status,'needs_data','delegation alone is not acceptance')
    // Bob can use the explicit mandate in the same turn: no second confirmation.
    const mandate = delegation.receipt.record.feedback.id
    assert.equal((await x.actions.execute('record_model_feedback',{ ...accepted, authority:'bob', mandate_id: randomUUID() })).status,'conflict')
    const saved = await x.actions.execute('record_model_feedback',{ ...accepted, authority:'bob', mandate_id: mandate })
    assert.equal(saved.status,'saved',JSON.stringify(saved))
    const ready = await readiness(); assert.equal(ready.status,'ready',JSON.stringify(ready)); assert(parseDesignReadiness(ready)); assert.equal(ready.model_feedback.authority,'bob')
    assert.equal(ready.design_intent.alignment.status,'draft','feedback does not rewrite the immutable design intent')
  })
  await t.test('whole user feedback cannot waive open technical/design issues', async () => {
    const x = await turn('Ja, den här formen och funktionerna stämmer.')
    const saved = await x.actions.execute('record_model_feedback',accepted); assert.equal(saved.status,'saved')
    const invalid = structuredClone(await readiness()); invalid.model_feedback.source_current = false
    assert.equal(parseDesignReadiness(invalid),null)
    const older = shown
    const body2 = structuredClone(body); body2.design_intent.choices[0].status = 'open'; body2.design_intent.choices[0].selected_direction = null
    await call(owner,'solution_command',[project,'revise',solution,1,{ ...body2, change_note:'Investigate material choice' }])
    await call(owner,'solution_command',[project,'select',solution,target.revision,{ solution_revision:2,reason:'Continue with the corrected source' }])
    const historical = await call(owner,'read_solution_presentation',[project,shown.id])
    assert.equal(historical.source_current,false); assert(historical.feedback.every((f: any) => !f.source_current))
    assert.equal((await x.rpc(x.payloads.at(-1)!)).data.record.feedback.id,saved.receipt.record.feedback.id,'lost response recovers the old receipt without authorizing the new head')
    const stale = await turn('Ja, det var den version jag såg.')
    assert.equal((await stale.actions.execute('record_model_feedback',accepted)).status,'conflict')
    shown = await present(owner,2)
    const current = await turn('Den uppdaterade formen stämmer.')
    assert.equal((await current.actions.execute('record_model_feedback',accepted)).status,'saved')
    const result = await readiness()
    assert.equal(result.status,'needs_data'); assert(result.issues.some((i: any) => i.code === 'design_geometry_choice_open' || i.code === 'design_choice_open'))
    assert(!result.issues.some((i: any) => i.code === 'design_alignment_required'))
    const late = await turn('Flytta stegen i modellen jag såg tidigare.',older)
    const correction = await late.actions.execute('record_model_feedback',{ ...accepted,outcome:'change_requested',has_corrections:true })
    assert.equal(correction.status,'saved'); assert.equal(correction.receipt.revision,1)
    assert((await readiness()).model_feedback,'a late historical correction cannot invalidate a later response to different exact sources')
  })
  await t.test('no shown model, forged presenter/source and revoked membership fail at the real writer', async () => {
    let x = await turn('Ja.',null)
    assert.equal((await x.actions.execute('read_model_feedback',{})).status,'not_shown')
    assert.equal((await x.actions.execute('record_model_feedback',accepted)).status,'invalid')
    x = await turn('Ja.',shown,member)
    assert.equal((await x.actions.execute('record_model_feedback',accepted)).status,'denied')
    const own = await present(member,2); x = await turn('Ja.',own,member)
    await pg.query("delete from bob.people where id='feedback-member'")
    assert.equal((await x.actions.execute('record_model_feedback',accepted)).status,'denied')
    assert.equal((await asProjectUser(pg,member,'select * from bob.solution_model_feedback where project_id=$1',[project])).rows.length,0)
    x = await turn('Ja.',{ ...shown, solution_revision:1 })
    assert.equal((await x.actions.execute('record_model_feedback',accepted)).status,'denied')
  })
  await t.test('private reset removes transcript/receipts while shared typed feedback remains readable', async () => {
    if (active) { await call(null,'bob_fail_turn_v2',[project,active.user,active.thread_id,active.turn,active.generation],'service_role'); active = null }
    const thread: any = (await asProjectUser(pg,owner,"select id,next_seq from bob.bob_threads where project_id=$1 and status='active'",[project])).rows[0]
    const before = await call(owner,'read_solution_presentation',[project,shown.id])
    const reset = await call(owner,'bob_reset_conversation',[project,thread.id,thread.next_seq])
    assert.equal(reset.status,'cleared')
    assert.equal((await pg.query('select count(*)::int n from bob.bob_messages where thread_id=$1',[thread.id])).rows[0].n,0)
    assert.deepEqual((await call(owner,'read_solution_presentation',[project,shown.id])).feedback,before.feedback)
    const x = await turn('Fortsätt med modellen.')
    assert.equal((await x.actions.execute('read_model_feedback',{})).presentation.feedback[0].outcome,'accepted')
  })
  await t.test('bounded history pages recover older scoped decisions without private chat', async () => {
    for (let i=0;i<12;i++) {
      const x = await turn('Lådans form stämmer, prov ' + i)
      assert.equal((await x.actions.execute('record_model_feedback',{ ...accepted,scope:'components',component_ids:['drawer'] })).status,'saved')
    }
    const x = await turn('Läs den tidigare återkopplingen.')
    const first = (await x.actions.execute('read_model_feedback',{ before_feedback_id:null })).presentation
    assert.equal(first.feedback.length,10); assert(first.next_feedback_id)
    const next = (await x.actions.execute('read_model_feedback',{ before_feedback_id:first.next_feedback_id })).presentation
    assert(next.feedback.length>0); assert(!next.feedback.some((f: any)=>first.feedback.some((a: any)=>a.id===f.id)))
    assert.equal(next.next_feedback_id,null)
    assert.equal((await x.actions.execute('read_model_feedback',{ before_feedback_id:randomUUID() })).status,'unavailable')
  })
  await t.test('area scope and changed measurement sources cannot borrow another visual decision', async () => {
    const measurement = randomUUID()
    const evidence = { subject:'Available space',value:'2000',unit:'mm',truth:'provided_spec',source:'Owner design constraint',notes:'Not measured',required:false }
    await call(owner,'evidence_command',[project,'measurement','create',measurement,0,evidence])
    const measured = { ...body, measurements:[{ id:measurement,revision:1 }] }
    await call(owner,'solution_command',[project,'revise',solution,2,{ ...measured,change_note:'Reconcile the choice with a source pin' }])
    let targetHead: any = (await asProjectUser(pg,owner,'select revision from bob.current_target where project_id=$1 and area_id is null',[project])).rows[0]
    await call(owner,'solution_command',[project,'select',solution,targetHead.revision,{ solution_revision:3,reason:'Use exact source' }])
    await pg.query("insert into bob.areas(id,project_id,slug,name) values('feedback-A',$1,'feedback-a','Area A'),('feedback-B',$1,'feedback-b','Area B')",[project])
    shown = await present(owner,3,'plan','feedback-A')
    const x = await turn('Det här är rätt form för Area A.')
    assert.equal((await x.actions.execute('record_model_feedback',accepted)).status,'saved')
    const scopeHistory = await call(owner,'read_solution_presentation',[project,shown.id])
    assert.equal(scopeHistory.feedback[0].area_id,'feedback-A'); assert.equal(scopeHistory.feedback[0].scope_label,'Area A')
    assert.equal((await call(owner,'read_design_readiness',[project,'feedback-A',null,'concept'])).status,'ready')
    assert.equal((await call(owner,'read_design_readiness',[project,'feedback-B',null,'concept'])).status,'needs_data')
    assert.equal((await readiness()).status,'needs_data')
    await call(owner,'evidence_command',[project,'measurement','revise',measurement,1,{ ...evidence,value:'1800',change_note:'Owner corrected available space' }])
    assert.equal((await call(owner,'read_solution_presentation',[project,shown.id])).source_current,false)
    assert.equal((await present(owner,3,'plan','feedback-A')).source_current,false,'a newly viewed stale pin is still stale')
    const stale = await turn('Ja.')
    assert.equal((await stale.actions.execute('record_model_feedback',accepted)).status,'conflict')
    await call(owner,'solution_command',[project,'revise',solution,3,{ ...measured,measurements:[{ id:measurement,revision:2 }],change_note:'Reconcile corrected source' }])
    targetHead = (await asProjectUser(pg,owner,'select revision from bob.current_target where project_id=$1 and area_id is null',[project])).rows[0]
    await call(owner,'solution_command',[project,'select',solution,targetHead.revision,{ solution_revision:4,reason:'Use reconciled source' }])
    const areaShown = await present(owner,4,'plan','feedback-A')
    await pg.query("update bob.areas set archived_at=now() where id='feedback-A'")
    assert.equal((await call(owner,'read_solution_presentation',[project,areaShown.id])).source_current,false)
    await pg.query("delete from bob.areas where id='feedback-A'")
    assert.equal((await call(owner,'read_solution_presentation',[project,areaShown.id])).area_id,'feedback-A','deleted Area identity remains historical metadata')
    shown = await present(owner,4)
    const oldTarget = shown.id
    targetHead = (await asProjectUser(pg,owner,'select revision from bob.current_target where project_id=$1 and area_id is null',[project])).rows[0]
    await call(owner,'solution_command',[project,'clear',null,targetHead.revision,{ reason:'Reconsider target' }])
    assert.equal((await call(owner,'read_solution_presentation',[project,oldTarget])).source_current,false)
    shown = await present(owner,4)
  })
  await t.test('background worker yield/reclaim keeps the presentation and exactly one saved response', async () => {
    if (active) { await call(null,'bob_fail_turn_v2',[project,active.user,active.thread_id,active.turn,active.generation],'service_role'); active = null }
    const id = randomUUID(), message = 'Ja, formen stämmer.', screen = { surface:'solutions',solutionId:solution,solutionRevision:4,presentationId:shown.id }
    const queued = await call(null,'bob_enqueue_job_v2',[project,owner,id,message,{ ciphertext:'fixture' },new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker',screen],'service_role')
    const job: any = (await pg.query('select capability from bob_private.bob_jobs where id=$1',[queued.jobId])).rows[0]
    const claimed = await call(null,'bob_claim_job',[queued.jobId,job.capability],'service_role')
    const payload = { kind:'form_feedback',record_id:null,expected_revision:null,expected_updated_at:null,request_quote:message,data:accepted }
    const first = await call(owner,'record_model_feedback',[project,claimed.threadId,id,claimed.generation,payload])
    await call(null,'bob_yield_job',[queued.jobId,claimed.claimToken],'service_role')
    const resumed = await call(null,'bob_claim_job',[queued.jobId,job.capability],'service_role')
    assert.deepEqual(resumed.screen,screen); assert(resumed.generation>claimed.generation)
    await assert.rejects(call(owner,'record_model_feedback',[project,claimed.threadId,id,claimed.generation,payload]),/turn_not_claimed/)
    assert.equal((await call(owner,'read_model_feedback',[project,resumed.threadId,id,resumed.generation])).presentation.id,shown.id)
    const replay = await call(owner,'record_model_feedback',[project,resumed.threadId,id,resumed.generation,payload])
    assert.equal(replay.record.feedback.id,first.record.feedback.id)
    assert.equal((await pg.query('select count(*)::int n from bob.solution_model_feedback where turn_id=$1',[id])).rows[0].n,1)
    await call(null,'bob_finish_job',[queued.jobId,resumed.claimToken,'fixture_done'],'service_role')
  })
  await t.test('frontend data seam rejects foreign/late callbacks', async () => {
    const p = await present(owner,4)
    let activeProject = true, response = p
    const client = { rpc: async () => ({ data: response, error: null }) } as any
    const data = createSolutions(client, () => () => { if (!activeProject) throw Error('project_changed') })
    assert.equal((await data.present(project,solution,4,'plan',null)).id,p.id)
    response = { ...p, project_id:foreign }; await assert.rejects(data.present(project,solution,4,'plan',null),/could not be linked/)
    const late = createSolutions({ rpc: async () => { activeProject = false; return { data:p, error:null } } } as any, () => () => { if (!activeProject) throw Error('project_changed') })
    await assert.rejects(late.present(project,solution,4,'plan',null),/project_changed/)
  })
  await t.test('project deletion removes only its subordinate presentation/decision metadata', async () => {
    await pg.query('delete from bob.projects where id=$1',[project])
    assert.equal((await pg.query('select count(*)::int n from bob.solution_presentations where project_id=$1',[project])).rows[0].n,0)
    assert.equal((await pg.query('select count(*)::int n from bob.solution_model_feedback where project_id=$1',[project])).rows[0].n,0)
  })
})
