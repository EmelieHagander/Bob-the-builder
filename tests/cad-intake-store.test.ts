import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from '@electric-sql/pglite'
let pg:PGlite
const one='10000000-0000-4000-8000-000000000001',two='10000000-0000-4000-8000-000000000002',turn='20000000-0000-4000-8000-000000000001'
let claim:any
const payload={brief:{brief:'Private original drawing request'},reference_refs:[],evidence:[{value:'132',unit:'cm',revision:2}]}
const sql='select bob.bob_drawing_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) d'
const run=async(op:string,id:string|null=null,expected=0,status:string|null=null,value:unknown=null,key:string|null=null,c=claim,uid=one)=>((await asProjectUser(pg,null,sql,['A',uid,c.thread_id,c.turn??turn,c.generation,op,id,expected,status,value,key],'service_role')).rows[0] as any).d
before(async()=>{
 pg=await projectSchema()
 await pg.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[one,'one@example.test',two,'two@example.test'])
 await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Project A')")
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('one','A','One','ON',$1),('two','A','Two','TW',$2)",[one,two])
 claim=((await asProjectUser(pg,null,'select bob.bob_claim_turn($1,$2,$3,$4) d',['A',one,turn,'Draw the object'],'service_role')).rows[0] as any).d
 assert.equal(claim.status,'claimed')
})
after(()=>pg.close())
test('private request persistence is replay-safe, revision-checked and isolated by owner/thread',async()=>{
 const saved=await run('save',null,0,'needs_data',payload,'write-one')
 assert.equal(saved.revision,1);assert.deepEqual((await run('load',saved.id)).payload,payload)
 assert.deepEqual(await run('save',null,0,'needs_data',payload,'write-one'),saved,'same journal write cannot create duplicate requests')
 await assert.rejects(run('save',null,0,'needs_data',{...payload,brief:{brief:'Different'}},'write-one'),/write_key_conflict/)
 await assert.rejects(run('save',saved.id,0,'draft',payload,'wrong-revision'),/revision_conflict/)
 await assert.rejects(run('load',saved.id,0,null,null,null,claim,two),/project_denied/)
 await assert.rejects(run('load',saved.id,0,null,null,null,{...claim,generation:claim.generation+1}),/turn_not_claimed/)
 const otherTurn='20000000-0000-4000-8000-000000000002'
 const other=((await asProjectUser(pg,null,'select bob.bob_claim_turn($1,$2,$3,$4) d',['A',two,otherTurn,'Other owner'],'service_role')).rows[0] as any).d
 assert.equal(await run('load',saved.id,0,null,null,null,{...other,turn:otherTurn},two),null)
 assert.deepEqual(await run('list',null,0,null,null,null,{...other,turn:otherTurn},two),[])
 await assert.rejects(asProjectUser(pg,one,sql,['A',one,claim.thread_id,turn,claim.generation,'list',null,0,null,null,null]),/permission denied/)
 await assert.rejects(run('save',saved.id,1,'draft',{...payload,previews:{front:'data:image/png;base64,aaa'}},'pixels'),/pixels_forbidden/)
 const closed=await run('save',saved.id,1,'saved',payload,'saved');assert.equal(closed.revision,2);assert.deepEqual(await run('list'),[])
})
