import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { constructionFormFixture as fixture } from './support/construction-form-fixture.ts'
import { parameterPacket } from './support/cad-parameter-fixture.ts'
import { manufacturePolicy } from './support/construction-instance-policy-fixture.ts'
import { constructionFormScope, constructionFormReadiness, constructionFormIssues, parseFormRefinement } from '../supabase/functions/_shared/construction-form.ts'
import { parseDesignReadiness } from '../supabase/functions/_shared/project-design-intent.ts'
import { createConstructionTools, checkedConstructionForDrawing } from '../supabase/functions/_shared/construction-draft.ts'
import { createProjectWriter, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { compileCadParameters } from '../supabase/functions/_shared/cad-parameters.ts'
import { createConstructionViews } from '../supabase/functions/_shared/construction-views.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { preWriteStateCatalogFixture } from './support/ai-catalog-fixture.ts'
import { FORM_REFINEMENT_SCHEMA } from '../supabase/functions/_shared/construction-form.ts'


test('FORM scope follows canonical component, feature, shared-input and transitive constraint links', () => {
  const { intent, recipe, refinement } = fixture()
  assert.deepEqual(constructionFormScope(intent,refinement), { component_ids:['frame'],pending_component_ids:['drawer'],pending_choice_ids:['drawer_finish'],verification:'unverified' })
  for (const mutate of [
    (i: typeof intent) => { i.model.components[1].choices=[] },
    (i: typeof intent) => { i.model.components[0].choices.push('drawer_finish') },
    (i: typeof intent) => { i.model.components[1].features.push('frame') },
    (i: typeof intent) => { i.model.components[1].position[1]='frame_p1' },
    (i: typeof intent) => { (i.model.nodes.find(n=>n.id==='drawer_p0') as any).value=600 },
    (i: typeof intent) => { i.model.nodes.push({id:'bridge',role:'derived',operation:'add_v1',operands:['frame_p0','frame_p1'],rounding:'exact'}); i.model.constraints.push({id:'connected',label:'Interface',relation:'equal',left:'bridge',right:'drawer_p1',feature:null}) },
  ]) {
    const changed=structuredClone(intent);mutate(changed)
    assert.deepEqual(constructionFormScope(changed,refinement).pending_choice_ids,[])
  }
  assert.deepEqual(constructionFormIssues(intent,recipe,new Set(),refinement,true),[])
  assert.deepEqual(constructionFormIssues(intent,recipe,new Set(),refinement).map(i=>i.code),['form_components_pending','form_refinement_unverified'])
  const moved=structuredClone(recipe);moved.instances[1].placement.x++
  assert(constructionFormIssues(intent,moved,new Set(),refinement,true).some(i=>i.code==='concept_geometry_changed'))
  assert(constructionFormIssues(intent,recipe,new Set(['left']),refinement,true).some(i=>i.code==='concept_geometry_changed'))
  assert.throws(()=>parseFormRefinement({version:1,mappings:[...refinement.mappings,...refinement.mappings]}),/invalid_form_refinement/)
  assert.throws(()=>constructionFormScope(intent,{version:1,mappings:[{component_id:'absent',instance_ids:['left','right']}]}),/invalid_form_refinement/)
})

test('FORM checkpoints save, reopen and resume on the same artifact; whole delivery stays closed at both boundaries', async t => {
  let priorManifest:any, formManifest:any
  const pg=await projectSchema(async(db,name)=>{if(name==='20261027091553_ai_form_refinement_catalog.sql')priorManifest=(await db.query("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result;if(name==='20261027101807_construction_observations.sql')formManifest=(await db.query("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result});t.after(()=>pg.close())
  const owner=randomUUID(),stranger=randomUUID(),turn=randomUUID(),solution=randomUUID(),message='Develop this frame and keep the later drawer choice open.'
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'form@example.test',stranger,'outsider@example.test'])
  const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any> => (await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
  const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Scoped FORM'})])).id
  const {intent,recipe,refinement}=fixture()
  const body={title:'Frame and later drawers',description:'Synthetic independent requirements',assumptions:'Design values only',tradeoffs:'Not fabrication ready',measurements:[],design_intent:intent}
  await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify(body)])
  let target=await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic choice'})])
  const claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
  const write=(payload:any,uid=owner)=>call(uid,'bob.bob_project_write_v17',[project,claim.thread_id,turn,claim.generation,JSON.stringify(payload)])
  const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
  const payload:any={kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'frame',title:'Frame checkpoint',description:'Two rails; later work remains',area_id:null,target_revision:target.revision,change_note:'First checkpoint',recipe,parameters:parameterPacket(project,recipe),materials:[{definition_id:'rail',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],instance_policy:manufacturePolicy(recipe),open_questions:['Joinery and functional fidelity remain unverified.'],form_refinement:refinement}}
  const read=(id:string,revision:number|null=null)=>call(owner,'bob.read_construction_draft',[project,id,revision,null])
  let saved:any
  await t.test('catalog publication advertises only the compatible schema and preserves older pinned manifests',async()=>{
    const manifest:any=formManifest
    const current=createAiCatalogSession({rpc:async()=>({data:null,error:null})} as any,{app:'bob',manifest})
    const before=createAiCatalogSession({rpc:async()=>({data:null,error:null})} as any,{app:'bob',manifest:priorManifest})
    assert.deepEqual(current.tool('save_construction_draft').function.parameters.properties.form_refinement,FORM_REFINEMENT_SCHEMA)
    assert.equal(before.tool('save_construction_draft').function.parameters.properties.form_refinement,undefined)
    const row=manifest.definitions.find((r:any)=>r.prompt_key==='tools.save_construction_draft')
    assert.equal(row.metadata.form_refinement_version,1)
    assert.deepEqual(preWriteStateCatalogFixture().definition(row.prompt_key,row.definition_kind).definition,row.definition)
    for(const previous of priorManifest.definitions.filter((r:any)=>r.prompt_key!=='tools.save_construction_draft')) assert.deepEqual(manifest.definitions.find((r:any)=>r.prompt_key===previous.prompt_key),previous)
  })
  await t.test('SQL and TypeScript scope/readiness agree without changing whole-purpose readiness',async()=>{
    const scoped=await call(owner,'bob.read_construction_readiness',[project,null,target.revision,JSON.stringify(refinement)])
    assert.equal(scoped.status,'ready');assert.equal(scoped.design_readiness.status,'needs_data');assert.equal(scoped.design_readiness.pin,null)
    assert.deepEqual(scoped,constructionFormReadiness(parseDesignReadiness(scoped.design_readiness)!,refinement))
    assert.equal((await call(owner,'bob.read_design_readiness',[project,null,target.revision,'construction'])).status,'needs_data')
    for(const mutate of [(i:any)=>i.model.components[0].choices.push('drawer_finish'),(i:any)=>i.model.components[1].position[0]='frame_p0',(i:any)=>i.model.constraints.push({id:'interface',label:'Shared interface',relation:'equal',left:'frame_p0',right:'drawer_p1',feature:null})]){
      const changed=structuredClone(intent);mutate(changed)
      assert.deepEqual(await call(owner,'bob_private.construction_form_scope',[JSON.stringify(changed),JSON.stringify(refinement)]),constructionFormScope(changed,refinement))
    }
  })
  await t.test('actual tool saves the refinement through the authoritative writer and reads it in a new session',async()=>{
    const committed:WritePayload[]=[]
    const writer=createProjectWriter(project,message,async p=>{committed.push(p);return{data:await write(p),error:null}},async()=>({data:[],error:null}),async()=>({data:{generation:claim.generation,receipts:[]},error:null}))
    const options={projectId:project,message,writer,formRefinement:true,hasAccess:async()=>true,read:async(id:string|null,rev:number|null)=>id?read(id,rev):{},readSources:async()=>({project:new Map(),physical:new Map()}),readConstructionReadiness:(rev:number,area:string|null,f:any)=>call(owner,'bob.read_construction_readiness',[project,area,rev,JSON.stringify(f)])}
    const tools=createConstructionTools(options)
    const graph=payload.data.parameters
    const plan={version:1,frames:[],nodes:graph.nodes.map(({normalized,sources,...n}:any)=>n),bindings:graph.bindings}
    const {parameters,...data}=payload.data
    const input={...data,record_id:null,expected_revision:0,parameter_plan:plan,request_quote:message}
    let fallbackReads=0
    const missing=createConstructionTools({...options,readConstructionReadiness:async()=>null,readDesignReadiness:async()=>{fallbackReads++;return {}}})
    assert.equal((await missing.execute('save_construction_draft',input)).status,'unavailable');assert.equal(fallbackReads,0);assert.equal(committed.length,0)
    const result=await tools.execute('save_construction_draft',input)
    assert.equal(result.status,'saved',JSON.stringify(result));saved={recordId:result.recordId??result.record_id,revision:result.revision}
    // Use the exact server receipt, independent of the presentation envelope.
    saved=await write(committed[0]);assert.deepEqual(await write(committed[0]),saved)
    const checkpoint=await read(saved.recordId)
    assert.deepEqual(checkpoint.form_refinement,refinement);assert.equal(checkpoint.solution_id,solution);assert.equal(checkpoint.solution_revision,1)
    const reopened=createConstructionViews(project)
    const q={artifact_id:saved.recordId,revision:1,after:null,view:'overview',ids:[],result_id:null,section:null}
    const overview=await reopened.read(checkpoint,q)
    assert.equal(overview.form.pending_components,1);assert.equal(overview.form.pending_choices,1);assert.equal(overview.form.verification,'unverified')
    const notes=await reopened.read(checkpoint,{...q,view:'notes'})
    assert(JSON.stringify(notes).includes('drawer_finish'));assert(JSON.stringify(notes).includes('instance_ids'))
    const checked=await checkedConstructionForDrawing({...options,readCatalog:(id,revision)=>call(owner,'bob.catalog_read',[project,JSON.stringify({action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})])},saved.recordId,1)
    assert.equal(checked.status,'needs_data');assert(checked.checked.issues.some((i:any)=>i.code==='form_refinement_unverified'))
    const fake={version:1,project_id:project,artifact_id:saved.recordId,revision:1,check:{status:'checked',checker_version:'orthogonal-butt-role-v1',artifact_id:saved.recordId,revision:1,concept_ready:true,fabrication_ready:false,issue_count:0,issues:[],instance_policy:payload.data.instance_policy}}
    await assert.rejects(pg.query('insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,$3,$4,$5)',[project,saved.recordId,JSON.stringify(recipe),JSON.stringify({bob_parameters:parameters,bob_construction:fake}),JSON.stringify({front:'PHN2Zy8+'})]),/form_refinement_unverified/)
    await assert.rejects(asProjectUser(pg,owner,'select bob_private.construction_build_instances(c) from bob.artifact_construction_revisions c where artifact_id=$1 and artifact_revision=1',[saved.recordId]),/form_refinement_unverified/)
    for(const quantity_mode of ['pieces','fasteners','glue']) await assert.rejects(call(owner,'bob_private.material_requirement_cad_command',[project,'create',randomUUID(),0,JSON.stringify({artifact_id:saved.recordId,artifact_revision:1,quantity_mode})]),/form_refinement_unverified/)
  })
  await t.test('direct writes cannot omit scope, corrupt mapping or cross project authority',async()=>{
    for(const [key,mutate,pattern] of [
      ['full',(p:any)=>{delete p.data.form_refinement},/design_readiness_required/],
      ['clear',(p:any)=>p.data.form_refinement=null,/design_readiness_required/],
      ['duplicate',(p:any)=>p.data.form_refinement.mappings[0].instance_ids.push('left'),/invalid_form_refinement/],
      ['missing',(p:any)=>p.data.form_refinement.mappings[0].instance_ids.pop(),/form_instance_unmapped/],
      ['moved',(p:any)=>{p.data.recipe.instances[1].placement.x++;p.data.parameters=parameterPacket(project,p.data.recipe)},/concept_geometry_changed/],
    ] as const){const p=structuredClone(payload);p.data.key=key;mutate(p);await assert.rejects(write(p),pattern)}
    await assert.rejects(write({...payload,data:{...payload.data,key:'intruder'}},stranger),/denied|claim/)
    await assert.rejects(call(stranger,'bob.read_construction_readiness',[project,null,target.revision,JSON.stringify(refinement)]),/project_denied/)
    assert.equal((await asProjectUser(pg,stranger,'select * from bob.artifact_construction_refinements where project_id=$1',[project])).rows.length,0)
    await assert.rejects(asProjectUser(pg,owner,'insert into bob.artifact_construction_refinements values($1,$2,2,$3)',[project,saved.recordId,JSON.stringify(refinement)]),/permission denied/)
  })
  await t.test('precise edits inherit mapping, preserve pending work and reject deletion of a mapped part',async()=>{
    const edit:any={kind:'construction_edit',record_id:saved.recordId,expected_revision:1,expected_updated_at:null,request_quote:message,data:{key:'frame_role',change_note:'Clarify the left rail role without replacing geometry',changes:{roles:{upsert:[{...payload.data.instance_policy.instances[0],reason:'This rail remains a proposed manufactured part of the frame.'}],remove:[]}},computed:null}}
    const prepared=await call(owner,'bob.prepare_construction_edit',[project,claim.thread_id,turn,claim.generation,JSON.stringify(edit)])
    assert.equal(prepared.status,'ready',JSON.stringify(prepared))
    const next=structuredClone(prepared.next.recipe)
    edit.data.computed={recipe:next,parameters:compileCadParameters(project,next,prepared.next.parameter_plan,new Map(),new Map())}
    const revised=await write(edit);assert.equal(revised.recordId,saved.recordId);assert.equal(revised.revision,2)
    assert.deepEqual(await write(edit),revised)
    assert.deepEqual((await read(saved.recordId)).form_refinement,refinement)
    const bad=structuredClone(payload);bad.record_id=saved.recordId;bad.expected_revision=2;bad.data.key='remove_mapped';delete bad.data.form_refinement;bad.data.recipe.instances.pop();bad.data.parameters=parameterPacket(project,bad.data.recipe);bad.data.instance_policy=manufacturePolicy(bad.data.recipe)
    await assert.rejects(write(bad),/form_instance_unmapped/)
    assert.equal((await read(saved.recordId)).revision,2)
  })
  await t.test('archive/restore preserve scope; a new selected Solution makes the old checkpoint stale',async()=>{
    await call(owner,'bob.artifact_command',[project,'archive',saved.recordId,2,'{}'])
    await call(owner,'bob.artifact_command',[project,'restore',saved.recordId,3,'{}'])
    assert.deepEqual((await read(saved.recordId)).form_refinement,refinement)
    const changed=structuredClone(body);changed.design_intent.model.nodes.find(n=>n.id==='frame_s0')!.value=620
    await call(owner,'bob.solution_command',[project,'revise',solution,1,JSON.stringify({...changed,change_note:'Wider frame'})])
    target=await call(owner,'bob.solution_command',[project,'select',solution,target.revision,JSON.stringify({solution_revision:2,reason:'Use wider frame'})])
    const old=await read(saved.recordId);assert.equal(old.source_state,'changed');assert.deepEqual(old.recipe,recipe);assert.deepEqual(old.form_refinement,refinement)
    const stale=structuredClone(payload);stale.record_id=saved.recordId;stale.expected_revision=4;stale.data.key='stale'
    await assert.rejects(write(stale),/design_readiness_required/)
  })
  await t.test('a controlling unknown and a choice linked to current geometry remain blockers',async()=>{
    const unknown=structuredClone(body)
    const ix=unknown.design_intent.model.nodes.findIndex(n=>n.id==='frame_s0')
    unknown.design_intent.model.nodes[ix]={id:'frame_s0',role:'unknown',unit:'mm',reason:'Required frame length is not known.'}
    await call(owner,'bob.solution_command',[project,'revise',solution,2,JSON.stringify({...unknown,change_note:'Keep the controlling unknown explicit'})])
    target=await call(owner,'bob.solution_command',[project,'select',solution,target.revision,JSON.stringify({solution_revision:3,reason:'Preserve uncertainty'})])
    const gap=await call(owner,'bob.read_construction_readiness',[project,null,target.revision,JSON.stringify(refinement)])
    assert.equal(gap.status,'needs_data');assert(gap.issues.some((i:any)=>i.code==='concept_reconciliation_required'))
    const blocked=structuredClone(payload);blocked.record_id=saved.recordId;blocked.expected_revision=4;blocked.data.target_revision=target.revision;blocked.data.key='unknown'
    await assert.rejects(write(blocked),/design_readiness_required/)
    const controlling=structuredClone(body);controlling.design_intent.model.components[0].choices.push('drawer_finish')
    await call(owner,'bob.solution_command',[project,'revise',solution,3,JSON.stringify({...controlling,change_note:'Choice also controls the frame'})])
    target=await call(owner,'bob.solution_command',[project,'select',solution,target.revision,JSON.stringify({solution_revision:4,reason:'Record current dependency'})])
    const choice=await call(owner,'bob.read_construction_readiness',[project,null,target.revision,JSON.stringify(refinement)])
    assert.equal(choice.status,'needs_data');assert(choice.issues.some((i:any)=>i.choice_id==='drawer_finish'))
    blocked.data.target_revision=target.revision;blocked.data.key='controlling'
    await assert.rejects(write(blocked),/design_readiness_required/)
    assert.equal((await read(saved.recordId)).revision,4)
  })
})
