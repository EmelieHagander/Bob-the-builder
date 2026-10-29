import {catalogFixture,catalogCall} from './support/ai-catalog-fixture.ts'
import {createBobContextContinuation,estimateBobRequestInput} from '../supabase/functions/_shared/bob-context-continuation.ts'
import {BobContinuation} from '../supabase/functions/_shared/bob-job-journal.ts'
import {createProjectContext} from '../supabase/functions/_shared/project-context/dispatcher.ts'
import {prepareChatImages} from '../supabase/functions/_shared/project-context/chat-images.ts'
import {parameterPlan,parameterPacket} from './support/cad-parameter-fixture.ts'
import {createConstructionTools,checkedConstructionForDrawing} from '../supabase/functions/_shared/construction-draft.ts'
import {manufacturePolicy} from './support/construction-instance-policy-fixture.ts'
import { designIntent } from './support/design-intent-fixture.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { runProjectAnswer, seedToolPolicy } from './support/main-catalog-fixture.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'

// Actual SQL/RLS/claimed-write and production orchestration; only AI/CAD network
// calls and the deliberately injected read failure are fixtures. No live data.
test('release integration resumes selective construction editing, checking and drawing delivery across every boundary', async t => {
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

  const aiCatalog=catalogFixture(), turn=randomUUID()
  const claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
  const binding=[project,claim.thread_id,turn,claim.generation]
  const receipts:any[]=[],errors:string[]=[],requests:any[]=[]
  let capsule:any,final:any,modelCalls=0,renders=0,reviews=0,writes=0,opens=0,leases=0,maxInput=0
  const imageId=randomUUID(),timestamp='2026-10-19T10:00:00.000Z'
  const added={id:'referencePanel',definition_id:'panel',placement:{x:900,y:0,z:0,rx:0,ry:0,rz:0}}
  const extraPlan=parameterPlan({...recipe,definitions:[],instances:[added]})
  const delta=(upsert:any[])=>({upsert,remove:[]})
  const edit={key:'reference-panel',record_id:source.recordId,expected_revision:1,change_note:'Add an explicitly excluded contextual reference',changes:{
    instances:delta([added]),nodes:delta(extraPlan.nodes),bindings:delta(extraPlan.bindings),
    roles:delta([{instance_id:added.id,role:'reference',quantity_policy:'exclude',reason:'Context only, not another manufactured panel'}]),
  }}
  const read=(view:string,revision=2)=>({artifact_id:source.recordId,revision,after:null,view,ids:[],result_id:null,section:null})
  // Deterministic choices exercise production handlers, not model judgement.
  const actions: (()=>[string,any]|null)[]=[
    ()=>['describe_tool',{name:'workflow_construction_drawing'}],
    ()=>['describe_tool',{name:'read_construction_draft'}],
    ()=>['read_construction_draft',read('overview',1)],
    ()=>['describe_tool',{name:'edit_construction_parts'}],
    ()=>['edit_construction_parts',edit],
    ()=>['read_construction_draft',read('parts')],
    ()=>['describe_tool',{name:'check_construction_draft'}],
    ()=>['check_construction_draft',{artifact_id:source.recordId,revision:2}],
    ()=>['read_construction_draft',{...read('result'),result_id:capsule.construction.observations[0].id}],
    ()=>['get_work_history',{call_id:'action-3',after:null}],
    ()=>['describe_tool',{name:'design_project_cad'}],
    ()=>['design_project_cad',{...request,construction_revision:2}],
    ()=>['describe_tool',{name:'save_cad_design'}],
    ()=>['save_cad_design',{}],
    // v3 (2026-10-29): the completion gate confirms the saved receipt, so the
    // first final answer is delivered without a second full Bob round.
    ()=>null,
  ]
  try {
    for(;leases<150&&!final;leases++){
      const hasAccess=async()=>true
      const lookup=createProjectLookup(project,async(pid,q)=>({data:await call(owner,'bob.search_bob_project_data_v8',[pid,q.dataset,q.query,q.status,q.area_id,q.record_id,q.after_id??null]),error:null}),undefined,undefined,undefined,{unlimitedWork:true})
      const writer=createProjectWriter(project,message,async payload=>{
        writes++
        try {const data=await call(owner,'bob.bob_project_write_v16',[...binding,JSON.stringify(payload)]);receipts.push(data);return {data,error:null}}
        catch(e:any){errors.push(e.message);return {data:null,error:{code:e.code,message:e.message}}}
      },async()=>({data:receipts,error:null}),async()=>({data:{generation:claim.generation,receipts},error:null}),{unlimitedWork:true})
      const construction=createConstructionTools({...constructionOptions,writer,constructionViews:true,constructionRepeats:true,unlimitedWork:true,
        prepareEdit:payload=>call(owner,'bob.prepare_construction_edit',[...binding,JSON.stringify(payload)])})
      const context=createProjectContext({hasAccess,sources:lookup.sources,unlimitedWork:true,imageEvidenceInstruction:'Image evidence',adapters:[{
        category:'images',prefix:'image',checkpointed:true,count:async()=>1,list:async()=>({items:[],next_cursor:null}),current:async()=>true,
        open:async ref=>{opens++;return {item:{ref,title:'Synthetic original photo',project_id:project},version:'v1',bytes:4000000,
          source:{projectId:project,dataset:'image_pixels',recordId:imageId,label:'Synthetic original photo',retrievedAt:timestamp,updatedAt:timestamp,truth:'unknown'},
          image:{type:'image_url',image_url:'private-image:'+imageId+'/original'}}},
      }]})
      const cad=createCadAssistant({aiCatalog,projectId:project,userId:owner,ownerRequest:message,available:true,deadline:Infinity,unlimitedWork:true,hasAccess,
        makeLookup:()=>createProjectLookup(project,async(pid,q)=>({data:await call(owner,'bob.search_bob_project_data_v8',[pid,q.dataset,q.query,q.status,q.area_id,q.record_id,q.after_id??null]),error:null}),5000,40),
        readArtifact:async(id,revision)=>({...await constructionOptions.read(id,revision),source_kind:'construction'}),
        checkConstruction:(id,revision)=>checkedConstructionForDrawing(constructionOptions,id,revision),
        readDesignReadiness:(targetRevision,purpose,areaId)=>call(owner,'bob.read_design_readiness',[project,areaId??null,targetRevision,purpose]),
        render:async(r,drawingSource)=>{renders++;return {recipe:r,manifest:{engine:{name:'build123d'},assembly_id:r.assembly_id,drawing_source:drawingSource,instances:r.instances,
          bounding_box_mm:{min:[0,0,0],max:[1500,300,18],size:[1500,300,18]},checks:{collisions:{status:'complete',overlaps:[]}},annotations:{version:1,coverage:'complete'}},
          files:{front:'PHN2Zz48L3N2Zz4=',top:'PHN2Zz48L3N2Zz4=',step:privateStep},previews:{front:'Zml4dHVyZQ==',top:'Zml4dHVyZQ=='}}},
        callModel:async o=>{assert.equal(o.functionName,'cad-reviewer');reviews++;return reviewReply()},
      })
      const continuation=createBobContextContinuation({version:1,aiCatalog,mainResultReferences:1,callModel:catalogCall(async o=>{
        if(o.functionName==='completion-gate')return reply(JSON.stringify({work_remaining:false,reason:'The drawing receipt is verified.'}))
        assert.equal(o.functionName,'ask-bob');assert.equal(o.previousResponseId,undefined)
        assert(JSON.stringify(o.messages).includes('private-image:'+imageId))
        assert(!JSON.stringify(o.messages).includes(privateStep),'CAD file bytes are private runtime data')
        requests.push(structuredClone(o));maxInput=Math.max(maxInput,estimateBobRequestInput(o).total)
        const action=actions[modelCalls++]?.();assert(modelCalls<=actions.length,'No unplanned retry or extra model work')
        if(action)assert(o.tools?.some(t=>t.function.name===action[0]),action[0]+' must be callable')
        const id='action-'+modelCalls,tools=action?[{id,type:'function' as const,function:{name:action[0],arguments:JSON.stringify(action[1])}}]:undefined
        return {success:true,model:'fixture',responseId:'response-'+modelCalls,data:action?null:'Konceptritningen är sparad och kopplad till arbetssteget. Bärighet är inte verifierad.',
          usage:{input_tokens:1,output_tokens:101,total_tokens:102,reasoning_tokens:100},outputPhase:action?'tool_calls':'final_answer',toolCalls:tools,
          outputItems:[{type:'reasoning',id:'rs_'+id,summary:[],encrypted_content:'opaque-fixture-'+id},...(tools?.map(t=>({type:'function_call',id:'fc_'+id,call_id:id,name:t.function.name,arguments:t.function.arguments,status:'completed'}))??
            [{type:'message',id:'msg_'+id,role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Konceptritningen är sparad och kopplad till arbetssteget. Bärighet är inte verifierad.',annotations:[]}]}])],
        }
      },aiCatalog)})
      if(capsule){lookup.restoreState(capsule.lookup);writer.restoreState(capsule.writer);context.restoreState(capsule.context);cad.restoreState(capsule.cad);construction.restoreState(capsule.construction);continuation.restoreState(capsule.continuation)}
      else await prepareChatImages(context,[imageId])
      await writer.recover()
      try {
        final=await runProjectAnswer({aiCatalog,projectId:project,userId:owner,message,lookup,writer,cadAssistant:cad,constructionTools:construction,projectContext:context,hasAccess,
          completeRequest:true,resultReferences:true,carryLoadedTools:true,unlimitedWork:true,deadline:Infinity,readToolPolicy:seedToolPolicy,callModel:o=>continuation.call(o),
          checkpoint:{state:capsule?.answer,save:async answer=>{
            capsule=JSON.parse(JSON.stringify({answer,lookup:lookup.exportState(),writer:writer.exportState(),context:context.exportState(),cad:cad.exportState(),construction:construction.exportState(),continuation:continuation.exportState()}))
            throw new BobContinuation('yield','simulated_lost_checkpoint_ack')
          }},
        })
      }catch(e){if(!(e instanceof BobContinuation))throw e}
    }
    assert(final?.ok,JSON.stringify({final,errors,modelCalls,leases}));assert.deepEqual(errors,[])
    assert.equal(modelCalls,actions.length);assert.equal(renders,1);assert.equal(reviews,1);assert.equal(writes,2);assert.equal(opens,1)
    assert(leases>40,'every state boundary reconstructs all runtime objects');assert(maxInput<64000)
    assert.equal(capsule.construction.observations.length,1,'historical result read does not rerun checks')
    const id=receipts.at(-1).recordId
    assert.notEqual(id,source.recordId,'drawing delivery has its own artifact receipt')
    const overview:any=(await query('select * from bob.current_drawing_overview where id=$1',[id])).rows[0]
    assert.equal(overview.source_state,'current');assert.equal(overview.steps[0].id,step)
    const exact:any=await call(owner,'bob.read_construction_draft',[project,source.recordId,2,null])
    assert.equal(exact.recipe.instances.length,2);assert.deepEqual(exact.recipe.instances[0],recipe.instances[0]);assert.equal(exact.instance_policy.instances.find((i:any)=>i.instance_id===added.id).quantity_policy,'exclude')
    const drawn:any=(await query('select recipe,manifest from bob.artifact_cad_revisions where artifact_id=$1',[id])).rows[0]
    assert.deepEqual(drawn.recipe,exact.recipe);assert.equal(drawn.manifest.bob_construction.revision,2)
    assert.equal((await query('select * from bob.current_drawing_steps where artifact_id=$1',[id])).rows.length,1)
    assert.match(final.answer,/inte verifierad/)
    assert(requests.at(-1).tools.some((t:any)=>t.function.name==='edit_construction_parts'),'loaded manuals survive every lease')
    t.diagnostic(JSON.stringify({leases,modelCalls,renders,reviews,writes,maxInputEstimate:maxInput,liveProviderCalls:0}))
  }finally{await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')}
})
