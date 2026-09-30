import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parseDesignHandoff} from '../supabase/functions/_shared/cad-review.ts'

const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
test('P2c: explicit canonical restoration preserves identity, privacy, CAS and current authority',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),member=randomUUID(),outsider=randomUUID(),id=randomUUID(),turn=randomUUID()
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'restore-owner@example.test',member,'restore-member@example.test',outsider,'restore-outsider@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Restore fixture'})])).id
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('restore-member',$1,'Member','ME',$2)",[project,member])
 const requirement={requirement_id:null,type:'drawing',title:'Drawer placement',description:'Keep drawers on the east side.',resolution:'open',responsible_kind:'bob',responsible_person_id:null,evidence_selector:{kind:'none',id:null,subject:null,area_id:null}}
 const stepInput={step_id:null,title:'Drawing',goal:'A concept drawing with the documented drawer placement',state:'active',phase:'planning',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[requirement]}
 const plan=async(expected:number,steps:any[])=>{
  const proposed=await call(owner,'bob_private.project_plan_propose',[project,expected,JSON.stringify({summary:'Drawing requirements',reason:'Explicit fixture',steps,task_links:[]})],'postgres')
  return (await call(owner,'bob_private.project_plan_decide',[project,expected,proposed.record.revision,'approve','Use requirements'] ,'postgres')).record
 }
 const firstPlan=await plan(0,[stepInput,{...stepInput,title:'Empty requirements',requirements:[]},{...stepInput,title:'Oversized requirement',requirements:[{...requirement,description:'x'.repeat(2000)}]}]),step=firstPlan.steps[0].id
 const quote='Restore this drawing using the current plan requirements.'
 let claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,'OLD PRIVATE requirements'],'service_role'),tid=turn
 await call(owner,'bob.create_drawing_request',[project,claim.thread_id,tid,claim.generation,id,JSON.stringify(scope)])
 const store=(status:string,payload:any,expected:number,c=claim,t=tid)=>call(null,'bob.bob_drawing_request',[project,owner,c.thread_id,t,c.generation,'save',id,expected,status,payload,randomUUID()],'service_role')
 await store('needs_data',{brief:{...scope,brief:'OLD PRIVATE requirements'},owner_request:'OLD PRIVATE text',reference_refs:[],draft:{private:'OLD PRIVATE geometry'}},0)
 const reset=async()=>{
  await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,tid,claim.generation],'service_role')
  const thread=(await pg.query('select next_seq from bob.bob_threads where id=$1',[claim.thread_id])).rows[0]
  await call(owner,'bob.bob_reset_conversation',[project,claim.thread_id,thread.next_seq])
  tid=randomUUID();claim=await call(null,'bob.bob_claim_turn',[project,owner,tid,quote],'service_role')
 }
 await reset()
 const restore=(expected=2,revision=1,s=step,q=quote,uid=owner,c=claim,t=tid)=>call(uid,'bob.restore_drawing_request',[project,c.thread_id,t,c.generation,id,expected,revision,s,q])
 await assert.rejects(restore(1),/drawing_request_changed/)
 await assert.rejects(restore(2,1,firstPlan.steps[1].id),/drawing_requirements_unavailable/)
 await assert.rejects(restore(2,1,firstPlan.steps[2].id),/drawing_requirements_unavailable/)
 await assert.rejects(restore(2,999),/drawing_requirements_changed/)
 await assert.rejects(restore(2,1,randomUUID()),/drawing_scope_changed/)
 await assert.rejects(restore(2,1,step,'invented quote'),/request_quote_required/)
 await assert.rejects(restore(2,1,step,quote,outsider),/project_denied/)
 const memberTurn=randomUUID(),memberClaim=await call(null,'bob.bob_claim_turn',[project,member,memberTurn,quote],'service_role')
 await assert.rejects(restore(2,1,step,quote,member,memberClaim,memberTurn),/drawing_request_denied/)
 await assert.rejects(call(null,'bob.restore_drawing_request',[project,claim.thread_id,tid,claim.generation,id,2,1,step,quote],'service_role'),/permission denied/)
 const result=await restore();assert.equal(result.id,id);assert.equal(result.status,'collecting');assert.equal(result.revision,3)
 assert(parseDesignHandoff(result.payload.brief.handoff),'canonical handoff passes runtime parser without truncation')
 assert(result.payload.brief.handoff.requirements.some((r:any)=>r.requirement.includes('east side')))
 assert.equal(result.payload.owner_request,quote);assert.equal(result.payload.draft,undefined);assert.equal(result.payload.retry,undefined)
 assert(!JSON.stringify(result).includes('OLD PRIVATE'))
 assert.deepEqual(await restore(),result,'lost restoration response is idempotent')
 await assert.rejects(restore(2,1,step,'Restore this drawing'),/drawing_restore_conflict/)
 await assert.rejects(restore(3),/drawing_request_not_paused/)
 const updated=await store('needs_data',result.payload,3);assert.equal(updated.revision,4)
 assert.deepEqual(await restore(),result,'replay is a historical restore receipt, not current readiness')
 const shared=await call(member,'bob.project_drawing_requests',[project,id,null])
 assert(!JSON.stringify(shared).includes('east side'));assert(!JSON.stringify(shared).includes(quote));assert.equal(shared.requests[0].revision,4)
 const nextPlan=await plan(1,[{...stepInput,step_id:step,requirements:[{...requirement,requirement_id:firstPlan.steps[0].requirements[0].id,description:'Keep drawers on the west side.'}]}])
 assert.equal(nextPlan.revision,2)
 await assert.rejects(call(owner,'bob.check_drawing_request',[project,id]),/drawing_requirements_changed/)
 await assert.rejects(store('reviewed',updated.payload,4),/drawing_requirements_changed/)
 // Even direct canonical writing is fenced before accepting a stale candidate.
 await assert.rejects(call(owner,'bob.bob_project_write_v9',[project,claim.thread_id,tid,claim.generation,JSON.stringify({kind:'cad',data:{drawing_request:{id,revision:4}}})]),/drawing_requirements_changed/)
 const rebased=await restore(4,2);assert.equal(rebased.id,id);assert.equal(rebased.revision,5)
 assert(rebased.payload.brief.handoff.requirements.some((r:any)=>r.requirement.includes('west side')))
 await pg.query('update bob.people set auth_user_id=null where project_id=$1 and auth_user_id=$2',[project,owner])
 await assert.rejects(call(owner,'bob.check_drawing_request',[project,id]),/project_denied/)
 await assert.rejects(restore(4,2),/project_denied/)
 await pg.query('update bob.people set auth_user_id=$1 where project_id=$2 and auth_user_id is null',[owner,project])
 const old=claim,oldTurn=tid
 await reset()
 const again=await restore(6,2);assert.equal(again.revision,7)
 await assert.rejects(store('reviewed',rebased.payload,5,old,oldTurn),/turn_not_claimed|project_denied/)
 await call(owner,'bob.cancel_drawing_request',[project,id,7])
 await assert.rejects(restore(6,2),/drawing_request_cancelled/)
 assert.equal((await pg.query('select count(*)::int n from bob_private.project_drawing_requests where id=$1',[id])).rows[0].n,1)
})
