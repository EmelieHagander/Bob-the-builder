import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { constructionFormFixture } from './support/construction-form-fixture.ts'
import { parameterPacket } from './support/cad-parameter-fixture.ts'
import { manufacturePolicy } from './support/construction-instance-policy-fixture.ts'
import { parseSolutionPresentation } from '../src/domain/modelFeedback.ts'
import { createSolutions } from '../src/data/solutions.ts'

test('construction presentation and feedback retain exact source, component scope and ordinary caller authority', async t => {
  const pg=await projectSchema(async(db,name)=>{
    if(name==='20260924120448_bob_background_jobs.sql') await db.exec(`create schema cron;create schema net;create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
  });t.after(()=>pg.close())
  const owner=randomUUID(),other=randomUUID(),solution=randomUUID()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'model-owner@example.test',other,'other@example.test'])
  const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any> => (await asProjectUser(pg,uid,`select bob.${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
  const project=(await call(owner,'create_project',[{name:'Construction view'}])).id
  const {intent,recipe,refinement}=constructionFormFixture()
  await call(owner,'solution_command',[project,'create',solution,0,{title:'Frame and later drawer',description:'Synthetic',assumptions:'Not built',tradeoffs:'',measurements:[],design_intent:intent}])
  const target=await call(owner,'solution_command',[project,'select',solution,0,{solution_revision:1,reason:'Develop the frame'}])
  let active:any
  async function turn(message:string,screen:any=null) {
    if(active) await call(null,'bob_fail_turn_v2',[project,owner,active.thread_id,active.id,active.generation],'service_role')
    const id=randomUUID(),claim=await call(null,'bob_claim_turn',[project,owner,id,message],'service_role')
    active={...claim,id};assert.equal(claim.status,'claimed')
    if(screen) await call(null,'bob_capture_turn_screen',[project,owner,claim.thread_id,id,claim.generation,screen],'service_role')
    const binding=[project,claim.thread_id,id,claim.generation]
    return { write:(payload:any)=>call(owner,'bob_project_write_v17',[...binding,payload]),
      feedback:(data:any)=>call(owner,'record_model_feedback',[...binding,{kind:'form_feedback',record_id:null,expected_revision:null,expected_updated_at:null,request_quote:message,data}]) }
  }
  const message='Develop this frame; leave the later drawer choice open.', draftTurn=await turn(message)
  const material=await draftTurn.write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,
    data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
  const payload={kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,
    data:{key:'frame',title:'Frame checkpoint',description:'Two rails, later drawer pending',area_id:null,target_revision:target.revision,change_note:'First checkpoint',recipe,parameters:parameterPacket(project,recipe),materials:[{definition_id:'rail',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],instance_policy:manufacturePolicy(recipe),open_questions:['Joinery remains unverified.'],form_refinement:refinement}}
  const saved=await draftTurn.write(payload), second=await draftTurn.write({...payload,data:{...payload.data,key:'second-frame',title:'Another frame checkpoint'}})
  const present=(id=saved.recordId,revision=1,view='overview',uid=owner)=>call(uid,'record_construction_presentation',[project,id,revision,view])
  let shown:any
  const positive={outcome:'accepted',authority:'user',mandate_id:null,scope:'whole_model',component_ids:[],has_corrections:false,has_uncertainty:false}
  const screen=(p:any)=>({surface:'drawings',artifactId:p.artifact_id,artifactRevision:p.artifact_revision,presentationId:p.id})
  await t.test('visible metadata is idempotent and has only realized components, never the pending drawer',async()=>{
    shown=await present();assert.deepEqual(shown,await present())
    assert.equal(shown.representation,'construction_3d');assert.equal(shown.artifact_id,saved.recordId);assert.equal(shown.source_current,true)
    assert.deepEqual(shown.components,[{id:'frame',label:'frame'}]);assert.deepEqual(shown.feedback,[])
    assert.deepEqual(parseSolutionPresentation(shown,project),shown)
    await assert.rejects(present(saved.recordId,1,'invented'),{code:'22023'})
    await assert.rejects(present(saved.recordId,1,'overview',other),{code:'42501'})
    await assert.rejects(asProjectUser(pg,owner,'update bob.solution_presentations set component_snapshot=$1 where id=$2',[JSON.stringify([{id:'drawer',label:'drawer'}]),shown.id]),{code:'42501'})
  })
  await t.test('whole shown-model answer covers only the frame; positive 3D feedback cannot open full delivery or block independent work',async()=>{
    const before=await call(owner,'read_construction_readiness',[project,null,target.revision,refinement])
    const reply=await turn('This frame looks right.',screen(shown)),receipt=await reply.feedback(positive)
    assert.deepEqual(receipt,await reply.feedback(positive));assert.equal(receipt.dataset,'artifacts');assert.equal(receipt.recordId,saved.recordId)
    assert.deepEqual(receipt.record.feedback.component_ids,['frame'])
    assert.deepEqual(await call(owner,'read_construction_readiness',[project,null,target.revision,refinement]),before)
    assert.equal((await call(owner,'read_design_readiness',[project,null,target.revision,'construction'])).status,'needs_data')
    const read=await call(owner,'read_solution_presentation',[project,shown.id,null]);assert.equal(read.feedback.length,1)
    assert.equal((await present(second.recordId)).feedback.length,0,'other construction has its own history')
    await assert.rejects(call(owner,'read_solution_presentation',[project,(await present(second.recordId)).id,read.feedback[0].id]),{code:'22023'})
  })
  await t.test('source and actor cannot be forged; pending components cannot be accepted',async()=>{
    const wrong=await turn('Looks good.',{...screen(shown),artifactId:second.recordId})
    await assert.rejects(wrong.feedback(positive),{code:'42501'})
    const reply=await turn('The drawer looks good.',screen(shown))
    await assert.rejects(reply.feedback({...positive,scope:'components',component_ids:['drawer']}),{code:'22023'})
  })
  await t.test('negative feedback remains a readiness gap until a covering response on the same source',async()=>{
    const reply=await turn('Yes, but change this frame.',screen(shown))
    await reply.feedback({...positive,outcome:'change_requested',has_corrections:true})
    const blocked=await call(owner,'read_construction_readiness',[project,null,target.revision,refinement])
    assert.equal(blocked.status,'needs_data');assert(blocked.issues.some((i:any)=>i.code==='construction_feedback_unsettled'))
    const resolved=await turn('Keep the shown frame as it is.',screen(shown));await resolved.feedback(positive)
    assert.equal((await call(owner,'read_construction_readiness',[project,null,target.revision,refinement])).status,'ready')
  })
  await t.test('new construction head makes old presentation historical; a response cannot accept unseen revision',async()=>{
    await call(owner,'artifact_command',[project,'archive',saved.recordId,1,{}])
    assert.equal((await call(owner,'read_solution_presentation',[project,shown.id,null])).source_current,false)
    const stale=await turn('Accept the old frame.',screen(shown))
    await assert.rejects(stale.feedback(positive),{code:'PT409'})
    const fresh=await present(saved.recordId,2);assert.equal(fresh.source_current,false,'archived head remains unavailable for acceptance')
    assert.equal(fresh.feedback.length,0,'history is scoped to the exact construction revision')
  })
  await t.test('data facade rejects wrong artifact and revoked project callbacks',async()=>{
    let invalid=false
    const api=createSolutions({rpc:async()=>({data:shown,error:null})} as any,()=>()=>{if(invalid)throw new Error('project_changed')})
    assert.deepEqual(await api.presentConstruction(project,saved.recordId,1,'overview'),shown)
    await assert.rejects(api.presentConstruction(project,second.recordId,1,'overview'),/could not be linked/)
    invalid=true;await assert.rejects(api.presentConstruction(project,saved.recordId,1,'overview'),/project_changed/)
  })
})
