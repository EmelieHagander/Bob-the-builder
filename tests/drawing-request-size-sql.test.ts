// 2026-11-02 (Våningssäng2): a reviewed drawing of a 70-part construction
// outgrew the 300 kB request store and every save was refused as a generic
// outage. Larger requests now fit; one above the new limit gets its own code.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {drawingErrorCode} from '../supabase/functions/_shared/drawing-errors.ts'

test('a drawing request of about 1 MB is stored; one above 4 MB is refused as drawing_request_too_large',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),message='Draw the bunk bed.'
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'size-owner@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Size fixture'})])).id
 const turn=randomUUID(),claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 const store=(id:string|null,expected:number,payload:unknown)=>call(null,'bob.bob_drawing_request',
  [project,owner,claim.thread_id,turn,claim.generation,'save',id,expected,'collecting',JSON.stringify(payload),randomUUID()],'service_role')
 const big=(bytes:number)=>({owner_request:message,reference_refs:[],brief:{note:'x'.repeat(bytes)}})
 const id=randomUUID()
 await call(owner,'bob.create_drawing_request',[project,claim.thread_id,turn,claim.generation,id,JSON.stringify({area_id:null,component_id:null,step_id:null,artifact_id:null})])
 const saved=await store(id,0,big(1_000_000))
 assert.ok(saved.id,JSON.stringify(saved).slice(0,300))
 const error=await store(saved.id,saved.revision,big(4_100_000)).then(()=>null,(e:any)=>e)
 assert.match(error?.message??'',/^drawing_request_too_large$/)
 assert.equal(drawingErrorCode(new Error(error.message)),'drawing_request_too_large','the code crosses the RPC boundary instead of becoming unavailable')
 assert.equal((await pg.query('select octet_length(payload::text)>900000 kept from bob_private.drawing_requests where id=$1',[saved.id])).rows[0].kept,true)
})
