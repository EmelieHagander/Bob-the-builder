import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

const emptyScope={area_id:null,component_id:null,step_id:null,artifact_id:null}
test('P2b: project identity survives reset, private content disappears, cancellation is fenced',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),member=randomUUID(),outsider=randomUUID(),turn=randomUUID(),id=randomUUID()
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'root-owner@example.test',member,'root-member@example.test',outsider,'root-outsider@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Persistent drawing fixture'})])).id
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('root-member',$1,'Member','ME',$2)",[project,member])
 const claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,'Draw a concept'],'service_role')
 const create=(scope:any=emptyScope,key=id)=>call(owner,'bob.create_drawing_request',[project,claim.thread_id,turn,claim.generation,key,JSON.stringify(scope)])
 const read=(uid=owner,key:string|null=id)=>call(uid,'bob.project_drawing_requests',[project,key,null])
 const store=(op:string,key:string|null=id,expected=0,status:string|null=null,value:any=null,writeKey=randomUUID(),c=claim,tid=turn)=>call(null,'bob.bob_drawing_request',[project,owner,c.thread_id,tid,c.generation,op,key,expected,status,value,writeKey],'service_role')
 const working={brief:{...emptyScope,brief:'PRIVATE owner words',handoff:{requirements:[{secret:'PRIVATE requirement'}]}},owner_request:'PRIVATE original',reference_refs:[],evidence:[{secret:'PRIVATE source'}]}
 const root=await create();assert.equal(root.id,id);assert.equal(root.revision,0)
 assert.deepEqual(await create(),root,'lost create response reuses one identity')
 assert.equal((await read(member)).requests[0].reason,'context_missing','an interrupted first packet is not reported as running')
 const otherTurn=randomUUID(),otherClaim=await call(null,'bob.bob_claim_turn',[project,member,otherTurn,'Other private request'],'service_role')
 assert.equal(await call(null,'bob.bob_drawing_request',[project,member,otherClaim.thread_id,otherTurn,otherClaim.generation,'load',id,0,null,null,null],'service_role'),null)
 const saved=await store('save',id,0,'needs_data',working)
 assert.equal(saved.id,id);assert.equal(saved.revision,1)
 assert.deepEqual((await store('load')).payload,working)
 const projection=(await read(member)).requests[0]
 assert.equal(projection.id,id);assert.equal(projection.status,'needs_data');assert.equal(projection.reason,null)
 assert.deepEqual(Object.keys(projection).sort(),['id','project_id','revision','kind','status','reason','scope','responsible_person_id','artifact_id','artifact_revision','created_at','updated_at'].sort())
 assert(!JSON.stringify(await read(member)).includes('PRIVATE'))
 await assert.rejects(read(outsider),/project_denied/)
 await pg.query('update bob.people set auth_user_id=null where project_id=$1 and auth_user_id=$2',[project,owner])
 await assert.rejects(read(owner),/project_denied/)
 await assert.rejects(store('load'),/project_denied/)
 await pg.query('update bob.people set auth_user_id=$1 where project_id=$2 and auth_user_id is null',[owner,project])
 await assert.rejects(asProjectUser(pg,member,'select * from bob_private.project_drawing_requests'),/permission denied/)
 await assert.rejects(call(member,'bob.cancel_drawing_request',[project,id,1]),/drawing_request_denied/)
 await assert.rejects(create({...emptyScope,brief:'PRIVATE'}),/invalid_drawing_scope/)
 await assert.rejects(create({...emptyScope,step_id:randomUUID()},randomUUID()),/project_denied/)
 await assert.rejects(call(null,'bob.create_drawing_request',[project,claim.thread_id,turn,claim.generation,randomUUID(),JSON.stringify(emptyScope)],'service_role'),/permission denied/)
 await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
 const thread=(await asProjectUser(pg,owner,'select id,next_seq from bob.bob_threads where id=$1',[claim.thread_id])).rows[0]
 await call(owner,'bob.bob_reset_conversation',[project,thread.id,thread.next_seq])
 assert.equal((await pg.query('select count(*)::int n from bob_private.drawing_requests where id=$1',[id])).rows[0].n,0)
 const paused=(await read(member)).requests[0]
 assert.equal((await asProjectUser(pg,member,'select id from bob.bob_threads where id=$1',[otherClaim.thread_id])).rows.length,1,'another member thread survives');
 assert.equal(paused.id,id);assert.equal(paused.status,'paused');assert.equal(paused.reason,'context_cleared');assert.equal(paused.revision,2)
 assert(!JSON.stringify(await pg.query('select * from bob_private.project_drawing_requests where id=$1',[id])).includes('PRIVATE'))
 const nextTurn=randomUUID(),next=await call(null,'bob.bob_claim_turn',[project,owner,nextTurn,'Continue the same drawing'],'service_role')
 const recovered=await store('load',id,0,null,null,randomUUID(),next,nextTurn)
 assert.equal(recovered.status,'paused');assert.equal(recovered.reason,'context_cleared');assert.equal(recovered.id,id)
 assert.deepEqual(recovered.payload,{brief:{},owner_request:null,reference_refs:[]})
 await assert.rejects(store('save',id,2,'collecting',working,randomUUID(),next,nextTurn),/drawing_context_cleared/)
 await assert.rejects(call(owner,'bob.cancel_drawing_request',[project,id,1]),/drawing_request_changed/)
 const cancelled=await call(owner,'bob.cancel_drawing_request',[project,id,2]);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.revision,3)
 assert.deepEqual(await call(owner,'bob.cancel_drawing_request',[project,id,2]),cancelled)
 await assert.rejects(store('save',id,3,'reviewed',working,randomUUID(),next,nextTurn),/drawing_request_cancelled/)
 assert.equal((await store('load',id,0,null,null,randomUUID(),next,nextTurn)).status,'cancelled')
 await pg.query('delete from bob.people where project_id=$1 and auth_user_id=$2',[project,member])
 await assert.rejects(read(member),/project_denied/)
})
