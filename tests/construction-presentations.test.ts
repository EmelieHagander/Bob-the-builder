import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { constructionFormFixture } from './support/construction-form-fixture.ts'
import { designIntent } from './support/design-intent-fixture.ts'
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
  let legacySaved:any, legacyData:any, legacyTarget:number
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
  await t.test('a text-only legacy Construction can be shown without manufacturing FORM consent',async()=>{
    const legacySolution=randomUUID(),legacyIntent=designIntent('construction')
    await call(owner,'solution_command',[project,'create',legacySolution,0,{title:'Legacy box assembly',description:'Existing geometry without a concept model',
      assumptions:'Dimensions remain design choices',tradeoffs:'',measurements:[],design_intent:legacyIntent}])
    const selected=await call(owner,'solution_command',[project,'select',legacySolution,target.revision,{solution_revision:1,reason:'Review the saved geometry'}])
    legacyTarget=selected.revision
    const legacyMessage='Review this saved assembly one view at a time.',legacyTurn=await turn(legacyMessage)
    const {form_refinement:_form,...withoutForm}=payload.data
    legacyData=withoutForm
    const legacy=await legacyTurn.write({...payload,request_quote:legacyMessage,
      data:{...legacyData,key:'legacy-geometry',title:'Legacy construction',description:'Saved geometry, no FORM components',target_revision:selected.revision}})
    legacySaved=legacy
    const shownLegacy=await present(legacy.recordId,1,'front')
    assert.equal(shownLegacy.source_current,true)
    assert.deepEqual(shownLegacy.components,[{id:'unmapped_geometry',label:'Saved geometry (FORM component mapping not yet established)'}])
    assert.deepEqual(parseSolutionPresentation(shownLegacy,project),shownLegacy)
    const agreed=await turn('Yes, this view matches.',screen(shownLegacy))
    const receipt=await agreed.feedback(positive)
    assert.deepEqual(receipt.record.feedback.component_ids,['unmapped_geometry'])
    const exact=await call(owner,'read_construction_draft',[project,legacy.recordId,1,null])
    assert.equal(exact.form_refinement,undefined,'visual consent cannot invent a missing mapping')
    const readiness=await call(owner,'read_construction_readiness',[project,null,selected.revision,null])
    assert.equal(readiness.status,'ready','legacy feedback does not substitute for a technical check')
  })

  await t.test('a configured facade workpiece commits atomically and requires the exact shown view before any next edit',async t=>{
    assert.equal((await call(owner,'read_construction_piece_progress',[project,legacySaved.recordId])).status,'not_configured')
    const contract=(await pg.query<any>(`select v.metadata->>'worker_piece_progress_version' as pin
      from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
      where p.app='bob' and p.prompt_key='agent-contract.ask-bob'`)).rows[0]
    assert.equal(contract.pin,'4','catalog publication follows schema and preserves the v4 pin')
    const ownerContext=async(query:string,params:any[]=[])=>pg.transaction(async tx=>{
      await tx.query('select set_config($1,$2,true)',['request.jwt.claims',JSON.stringify({sub:owner})])
      return tx.query(query,params)
    })
    const propose={summary:'One visible facade at a time',reason:'Exercise exact saved revisions',steps:[{
      step_id:null,title:'Review construction facade',goal:'Review the saved model before changing another part',state:'active',
      area_id:null,phase:'design',responsible_kind:'bob',responsible_person_id:null,
      notes:'This plan does not certify the number or location of openings.',requirements:[] }]}
    const plan=(await ownerContext('select bob_private.project_plan_propose($1,$2,$3) result',[project,0,JSON.stringify(propose)])).rows[0].result as any
    await ownerContext('select bob_private.project_plan_decide($1,$2,$3,$4,$5)',[project,0,plan.record.revision,'approve','Owner reviewed synthetic step'])
    const planned=(await call(owner,'project_plan_read',[project,null])).record
    const stepId=planned.focus_step_id
    await pg.query(`insert into bob_private.construction_piece_policies(project_id,artifact_id,plan_revision,step_id,max_affected_instances,requested_total_openings)
      values($1,$2,$3,$4,3,7)`,[project,legacySaved.recordId,planned.revision,stepId])
    await pg.query(`insert into bob_private.construction_piece_scopes(artifact_id,project_id,position,view_id,label,expected_openings,x_min,x_max,y_min,y_max,z_min,z_max) values
      ($1,$2,1,'front','Synthetic front',null,100,5000,-100,500,-100,2500),
      ($1,$2,2,'back','Synthetic back',null,100,5000,2500,3500,-100,2500)`,[legacySaved.recordId,project])
    const status=()=>call(owner,'read_construction_piece_progress',[project,legacySaved.recordId])
    assert.equal((await status()).status,'ready')
    assert.equal((await status()).requested_total_openings,7)
    assert((await status()).facades.every((s:any)=>s.expected_openings===null),'facade count was not invented')
    await assert.rejects(call(other,'read_construction_piece_progress',[project,legacySaved.recordId]),{code:'42501'})
    await assert.rejects(asProjectUser(pg,owner,'select * from bob_private.construction_piece_policies'),/permission denied/)
    const add=(source:any,id:string,x:number,y:number)=>({ ...source,
      instances:[...source.instances,{id,definition_id:'rail',placement:{x,y,z:600,rx:0,ry:0,rz:0}}] })
    const base={...legacyData,target_revision:legacyTarget}
    await t.test('P2.4 rejects repinning an unchanged facade to a different selected design', async()=>{
      const rejected=pg.transaction(async tx=>{
        await tx.query('select set_config($1,$2,true)', ['request.jwt.claims',JSON.stringify({sub:owner})])
        const selected=(await tx.query<any>(`select bob.solution_command($1,'select',$2,$3,$4::jsonb) result`,
          [project,solution,legacyTarget,JSON.stringify({solution_revision:1,reason:'Test a newly selected design without geometry changes'})])).rows[0].result
        await tx.query(`insert into bob.artifact_revisions
          select (jsonb_populate_record(null::bob.artifact_revisions,to_jsonb(a)||
            jsonb_build_object('revision',2,'target_revision',$3::integer,'solution_id',$4::uuid,
              'solution_revision',1,'solution_title','Frame and later drawer'))).*
          from bob.artifact_revisions a
          where a.project_id=$1 and a.artifact_id=$2 and a.revision=1`,
          [project,legacySaved.recordId,selected.revision,solution])
        await tx.query(`insert into bob.artifact_construction_revisions
          select (jsonb_populate_record(null::bob.artifact_construction_revisions,to_jsonb(c)||
            jsonb_build_object('artifact_revision',2))).*
          from bob.artifact_construction_revisions c
          where c.project_id=$1 and c.artifact_id=$2 and c.artifact_revision=1`,
          [project,legacySaved.recordId])
        await tx.query(`insert into bob.artifact_construction_instance_policies(project_id,artifact_id,artifact_revision,policy)
          select project_id,artifact_id,2,policy from bob.artifact_construction_instance_policies
          where project_id=$1 and artifact_id=$2 and artifact_revision=1`,
          [project,legacySaved.recordId])
        await tx.exec('set constraints bob.z_enforce_construction_piece immediate')
      })
      await assert.rejects(rejected,/construction_piece_changed_design_without_geometry/)
      assert.equal((await pg.query<any>('select bob_private.effective_target_revision($1,null) revision',[project])).rows[0].revision,legacyTarget)
      assert.equal((await status()).status,'ready')
      assert.equal((await call(owner,'read_construction_draft',[project,legacySaved.recordId,null,null])).revision,1)
    })
    const edit=async(key:string,revision:number,recipe:any)=>{
      const message=`Change synthetic facade piece: ${key}.`,reply=await turn(message)
      return reply.write({kind:'construction',record_id:legacySaved.recordId,expected_revision:revision,expected_updated_at:null,
        request_quote:message,data:{...base,key,recipe,parameters:parameterPacket(project,recipe),
          instance_policy:manufacturePolicy(recipe),change_note:key}})
    }
    const before=legacyData.recipe,front=add(before,'front-piece',1000,0),back=add(before,'back-piece',1200,2600)
    await pg.query('update bob.project_plans set focus_step_id=null where project_id=$1',[project])
    await assert.rejects(edit('unfocused-front',1,front),/construction_piece_step_not_focused/)
    await pg.query('update bob.project_plans set focus_step_id=$1 where project_id=$2',[stepId,project])
    await assert.rejects(edit('two-distant-front-pieces',1,add(front,'far-front-piece',4300,0)),/construction_piece_too_spread_out/)
    await assert.rejects(edit('cross-facades',1,add(front,'back-piece',1200,2600)),/construction_piece_multiple_facades/)
    assert.equal((await status()).status,'ready','failed transaction leaves no review attempt')
    const savedFront=await edit('front-only',1,front)
    assert.equal(savedFront.revision,2)
    assert.equal((await status()).status,'awaiting_review')
    assert.equal((await status()).pending_view,'front')
    assert.equal((await status()).saved_revision,2)
    await assert.rejects(edit('too-early-back',2,add(front,'back-piece',1200,2600)),/construction_piece_review_required/)
    const wrong=await call(owner,'record_construction_presentation',[project,legacySaved.recordId,2,'back'])
    await (await turn('I approve the wrong view.',screen(wrong))).feedback(positive)
    assert.equal((await status()).status,'awaiting_review','another visible facade cannot release the hold')
    const shown=await call(owner,'record_construction_presentation',[project,legacySaved.recordId,2,'front'])
    await (await turn('Please change the front placement.',screen(shown))).feedback({...positive,outcome:'change_requested',has_corrections:true})
    assert.equal((await status()).status,'correction_requested')
    await assert.rejects(edit('wrong-facade-correction',2,add(front,'back-piece',1200,2600)),/construction_piece_correction_must_match_facade/)
    const corrected=await edit('front-correction',2,add(front,'front-adjustment',1450,0))
    assert.equal(corrected.revision,3)
    assert.equal((await status()).status,'awaiting_review')
    assert.equal((await status()).saved_revision,3)
    const correctedShown=await call(owner,'record_construction_presentation',[project,legacySaved.recordId,3,'front'])
    await (await turn('This corrected front matches what I wanted.',screen(correctedShown))).feedback(positive)
    assert.equal((await status()).status,'ready')
    assert.equal((await status()).reviewed_saves,1)
    const savedBack=await edit('back-only',3,add(add(front,'front-adjustment',1450,0),'back-piece',1200,2600))
    assert.equal(savedBack.revision,4)
    assert.equal((await status()).pending_view,'back')
    assert.equal((await status()).saved_revision,4)
    assert.equal((await call(owner,'read_construction_draft',[project,legacySaved.recordId,4,null])).form_refinement,undefined)
  })

  await t.test('a local new window can fasten to an unchanged long plate without opening distant work',async()=>{
    const placement=(x:number,z:number)=>({x,y:0,z,rx:0,ry:0,rz:0})
    const plate={id:'plate',primitive:'box',material_ref:null,x_mm:6000,y_mm:95,z_mm:45}
    const post={id:'post',primitive:'box',material_ref:null,x_mm:45,y_mm:95,z_mm:250}
    const original:any={contract_version:1,units:'mm',assembly_id:'long_anchored_facade',views:['front','top'],
      definitions:[plate,post],instances:[
        {id:'through_plate',definition_id:'plate',placement:placement(0,0)},
        {id:'existing_post',definition_id:'post',placement:placement(850,45)}]}
    const message='Create an isolated long front plate for local-window verification.'
    const reply=await turn(message)
    const savedLong=await reply.write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,
      data:{key:'long-anchor-fixture',title:'Long front plate',description:'Synthetic unchanged through-member',area_id:null,
        target_revision:legacyTarget,change_note:'First synthetic checkpoint',recipe:original,
        parameters:parameterPacket(project,original),materials:['plate','post'].map(definition_id=>({
          definition_id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})),
        joints:[],instance_policy:manufacturePolicy(original),open_questions:['This synthetic frame is not approved for fabrication.']}})
    assert.equal(savedLong.revision,1)
    const plan=(await call(owner,'project_plan_read',[project,null])).record
    assert.equal(plan.focus_step_id!==null,true)
    await pg.query(`insert into bob_private.construction_piece_policies
      (project_id,artifact_id,plan_revision,step_id,max_affected_instances,max_piece_run_mm)
      values($1,$2,$3,$4,6,2200)`,[project,savedLong.recordId,plan.revision,plan.focus_step_id])
    await pg.query(`insert into bob_private.construction_piece_scopes
      (artifact_id,project_id,position,view_id,label,x_min,x_max,y_min,y_max,z_min,z_max)
      values($1,$2,1,'front','Long front fixture',-100,6500,-100,500,-100,2500),
      ($1,$2,2,'left','Overlapping gable fixture',-100,650,-100,3500,-100,2500)`,[savedLong.recordId,project])
    const near={id:'near_new',definition_id:'post',placement:placement(400,45)}
    const far={id:'far_new',definition_id:'post',placement:placement(4500,45)}
    const detached={id:'detached_new',definition_id:'post',placement:placement(400,500)}
    const ambiguous={id:'corner_new',definition_id:'post',placement:placement(25,45)}
    const joint=(id:string)=>({id:'j_'+id,first:{instance_id:'through_plate',face:'z_max'},
      second:{instance_id:id,face:'z_min'},method:'butt',reason:'Local attachment to the unmodified plate.',fasteners:[]})
    const testRevision=async(additions:any[],attached:string[],definitions=original.definitions)=>pg.transaction(async tx=>{
      const recipe={...original,definitions,instances:[...original.instances,...additions]}
      await tx.query(`insert into bob.artifact_revisions
        select (jsonb_populate_record(null::bob.artifact_revisions,to_jsonb(a)||
          jsonb_build_object('revision',2))).* from bob.artifact_revisions a
        where a.project_id=$1 and a.artifact_id=$2 and a.revision=1`,[project,savedLong.recordId])
      await tx.query(`insert into bob.artifact_construction_revisions
        select (jsonb_populate_record(null::bob.artifact_construction_revisions,to_jsonb(c)||
          jsonb_build_object('artifact_revision',2,'recipe',$3::jsonb,'joints',$4::jsonb))).*
        from bob.artifact_construction_revisions c
        where c.project_id=$1 and c.artifact_id=$2 and c.artifact_revision=1`,
        [project,savedLong.recordId,JSON.stringify(recipe),JSON.stringify(attached.map(joint))])
      await tx.query(`insert into bob.artifact_construction_instance_policies
        (project_id,artifact_id,artifact_revision,policy) values($1,$2,2,$3::jsonb)`,
        [project,savedLong.recordId,JSON.stringify(manufacturePolicy(recipe))])
      await tx.exec('set constraints bob.z_enforce_construction_piece immediate')
    })
    await assert.rejects(testRevision([],['existing_post']),/construction_piece_too_spread_out/,
      'a joint only between old parts must retain the entire long span')
    await assert.rejects(testRevision([near,far],['near_new','far_new']),/construction_piece_too_spread_out/,
      'two distant new attachments cannot hide behind a common long member')
    await assert.rejects(testRevision([detached],['detached_new']),/construction_piece_too_spread_out/,
      'a new joint to a non-touching piece does not earn a local-anchor exemption')
    await assert.rejects(testRevision([ambiguous],['corner_new']),/construction_piece_outside_or_ambiguous_facade/,
      'a true equidistant corner part stays unclassified')
    await assert.rejects(testRevision([near],['near_new'],[{...plate,x_mm:6050},post]),/construction_piece_too_spread_out/,
      'a physically altered long plate must keep its full span even when joined to a local piece')
    assert.equal((await call(owner,'read_construction_piece_progress',[project,savedLong.recordId])).status,'ready')
    await testRevision([near],['near_new'])
    const review=await call(owner,'read_construction_piece_progress',[project,savedLong.recordId])
    assert.equal(review.status,'awaiting_review')
    assert.equal(review.pending_view,'front')
    assert.equal(review.saved_revision,2)
  })

})
