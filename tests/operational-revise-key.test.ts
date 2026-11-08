import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from './support/pglite.ts'

// Owner run Våningssäng 2, 2026-11-08: Mattias revised the same material rows
// twice in one turn (after Konrad's last construction revision); the second
// revise of each came back operation_reused. A revise is keyed on the
// revision it starts from (20261108120000_operational_revise_key.sql).
let pg:PGlite,owner:string
const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
 (await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;
   create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 })
 owner=randomUUID();await pg.query('insert into auth.users values($1,$2,now())',[owner,'revise@test.invalid'])
})
after(()=>pg.close())

test('one turn can revise the same record twice; an exact retry reuses its receipt; another payload from the same revision is refused',async()=>{
 const message='Spara lagret och räkna om det.',project=(await call(owner,'bob.create_project',[{name:'Lager'}])).id,turn=randomUUID()
 const c=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 const write=(p:unknown)=>call(owner,'bob.bob_project_write_v16',[project,c.thread_id,turn,c.generation,p])
 const fields={name:'Boards',specification:'Fixture stock',quantity:'4',unit:'pcs',status:'available',area_id:null,notes:'User reported',change_note:'Fixture'}
 const op=(action:string,f:unknown,record_id:string|null,expected_revision:number)=>({kind:'operational',record_id,expected_revision,expected_updated_at:null,request_quote:'Spara lagret',data:{resource:'stock',action,fields:f}})
 const created=await write(op('create',fields,null,0))
 const first=await write(op('revise',{...fields,quantity:'6'},created.recordId,1))
 assert.equal(first.revision,2)
 // Before the migration this came back operation_reused.
 const second=await write(op('revise',{...fields,quantity:'5'},created.recordId,2))
 assert.equal(second.revision,3)
 assert.deepEqual(await write(op('revise',{...fields,quantity:'5'},created.recordId,2)),second,'an exact retry reuses its receipt')
 await assert.rejects(write(op('revise',{...fields,quantity:'7'},created.recordId,2)),/operation_reused/)
 assert.deepEqual(await write(op('create',fields,null,0)),created,'a create keeps its key')
})
