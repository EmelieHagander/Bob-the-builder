import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {workpadFrame} from '../supabase/functions/_shared/bob-agent-workpad.ts'

test('later project writes retire private hints without erasing them or weakening claim/CAS checks',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const user=randomUUID(),other=randomUUID(),turn=randomUUID()
 await pg.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[user,'pad@example.test',other,'other@example.test'])
 await pg.exec("insert into bob.projects(id,slug,name,description) values('pad-A','pad-a','Pad','Test'),('pad-B','pad-b','Other','Other')")
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('pad-owner','pad-A','Owner','O',$1)",[user])
 const service=async(sql:string,args:unknown[])=>((await asProjectUser(pg,null,sql,args,'service_role')).rows[0] as any).d
 const claim=await service('select bob.bob_claim_turn($1,$2,$3,$4) d',['pad-A',user,turn,'Continue'])
 assert.equal(claim.status,'claimed')
 const bind=['pad-A',user,claim.thread_id,turn,claim.generation,'bob']
 const read=()=>service('select bob.bob_agent_workpad_current($1,$2,$3,$4,$5,$6) d',bind)
 const note={status:'waiting',goal:'Old frame',next_step:'Check current sources',steps:[],blockers:['Old unresolved choice'],references:['v14']}
 const write=(revision:number)=>service('select bob.bob_agent_workpad_current($1,$2,$3,$4,$5,$6,$7,$8::jsonb) d',[...bind,revision,JSON.stringify(note)])
 assert.equal((await read()).note,null)
 assert.equal((await write(0)).revision,1)
 assert.deepEqual((await read()).note,note)
 const receipt=async(project:string)=>pg.query("insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,receipt) values($1,$2,$3,$4,'{}','{}')",[project,user,turn,randomUUID()])
 await receipt('pad-B');assert.deepEqual((await read()).note,note,'other project changes cannot invalidate this note')
 await receipt('pad-A')
 const stale=await read();assert.equal(stale.note,null);assert.equal(stale.revision,1);assert.equal(stale.freshness,'project_changed')
 assert.doesNotMatch(workpadFrame(stale),/Old unresolved choice|v14/)
 const original=await service('select bob.bob_agent_workpad($1,$2,$3,$4,$5,$6) d',bind)
 assert.deepEqual(original.note,note,'old pinned jobs and stored note stay untouched')
 assert.equal((await write(1)).revision,2,'a deliberate same-note reaffirmation advances CAS after later work')
 assert.equal((await write(1)).revision,2,'replay is idempotent')
 assert.deepEqual((await read()).note,note)
 const conflict=await service('select bob.bob_agent_workpad_current($1,$2,$3,$4,$5,$6,$7,$8::jsonb) d',[...bind,1,JSON.stringify({...note,goal:'conflicting edit'})])
 assert.equal(conflict.status,'conflict')
 await assert.rejects(service('select bob.bob_agent_workpad_current($1,$2,$3,$4,$5,$6) d',['pad-A',other,...bind.slice(2)]),/project_denied|turn_not_claimed/)
 await assert.rejects(asProjectUser(pg,user,'select bob.bob_agent_workpad_current($1,$2,$3,$4,$5,$6)',bind),/permission denied/)
 await service('select bob.bob_commit_turn_v2($1,$2,$3,$4,$5,$6,$7,$8) d',[...bind.slice(0,5),'Done','{"kind":"ai_assessment","sources":[],"partial":false}','test-response'])
 await assert.rejects(read(),/turn_not_claimed/)
})
