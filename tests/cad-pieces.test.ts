import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import { createCadPieces as createCadPiecesImplementation } from '../supabase/functions/_shared/cad-pieces.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
const createCadPieces=(opts:Omit<Parameters<typeof createCadPiecesImplementation>[0],'aiCatalog'>)=>createCadPiecesImplementation({...opts,aiCatalog:catalogFixture()})
import {handoff} from './support/cad-review-fixture.ts'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

const input=(n=3)=>({assembly_title:'Guest room',assembly_brief:'Origin at the inner north-west floor corner; +x east, +y south, +z up.',area_id:null,
 pieces:Array.from({length:n},(_,i)=>({piece_key:'piece_'+i,brief:'Piece '+i,component_id:null,handoff}))})
function fakeStore(opts:{reuse?:string;fail?:string;release?:(ids:string[])=>Promise<{released:string[]}>}={}){
 const saved:{key:string;payload:any;status:string}[]=[]
 return {saved,store:{list:async()=>[],load:async()=>null,
  save:async(_id:string|null,_e:number,status:string,payload:any,key?:string)=>{
   if(key==='piece:'+opts.reuse)throw new Error('drawing_request_reuse:existing-id')
   if(key==='piece:'+opts.fail)throw new Error('drawing_request_unavailable')
   saved.push({key:key!,payload,status});return {id:'id-'+key,revision:1,status,payload}
  },
  releasePieces:opts.release??(async(ids:string[])=>({released:ids}))} as any}
}
test('pieces are stored as separate requests with stable keys, then released together',async()=>{
 const {store,saved}=fakeStore(),released:string[][]=[]
 store.releasePieces=async(ids:string[])=>{released.push(ids);return {released:ids}}
 const pieces=createCadPieces({requestStore:store,ownerRequest:'Rita gästrummet',hasAccess:async()=>true})
 const out:any=await pieces.execute(input())
 assert.equal(out.status,'queued')
 assert.deepEqual(saved.map(s=>[s.key,s.status]),[['piece:piece_0','collecting'],['piece:piece_1','collecting'],['piece:piece_2','collecting']])
 assert.deepEqual(Object.keys(saved[0].payload.brief).sort(),['area_id','artifact_id','brief','component_id','handoff','step_id'],'consult accepts the stored brief as is')
 assert.match(saved[1].payload.brief.brief,/Piece 2 of 3 \(piece_1\) of "Guest room"/)
 assert.equal(saved[0].payload.owner_request,'Rita gästrummet')
 assert.deepEqual(released,[['id-piece:piece_0','id-piece:piece_1','id-piece:piece_2']])
 assert.equal((await pieces.execute(input()) as any).status,'budget_exhausted','one split per turn')
})
test('an invalid piece stores nothing',async()=>{
 const {store,saved}=fakeStore(),bad=input()
 bad.pieces[1].handoff={...handoff,views:[]} as any
 const out:any=await createCadPieces({requestStore:store,ownerRequest:null,hasAccess:async()=>true}).execute(bad)
 assert.equal(out.status,'invalid');assert.deepEqual(out.issues,[{piece_key:'piece_1',reason:'invalid_handoff'}]);assert.equal(saved.length,0)
 const dup=input();dup.pieces[2].piece_key='piece_0'
 assert.equal((await createCadPieces({requestStore:store,ownerRequest:null,hasAccess:async()=>true}).execute(dup) as any).status,'invalid')
 assert.equal((await createCadPieces({requestStore:store,ownerRequest:null,hasAccess:async()=>true}).execute(input(1)) as any).status,'invalid','a single piece belongs in design_project_cad')
})
test('one piece failing to store does not stop the others; existing requests are reported, not released',async()=>{
 const {store}=fakeStore({reuse:'piece_0',fail:'piece_1'})
 const out:any=await createCadPieces({requestStore:store,ownerRequest:null,hasAccess:async()=>true}).execute(input())
 assert.deepEqual(out.pieces,[{piece_key:'piece_0',request_id:'existing-id',status:'existing_request'},{piece_key:'piece_1',request_id:null,status:'not_stored'},{piece_key:'piece_2',request_id:'id-piece:piece_2',status:'queued'}])
})
test('a release failure leaves stored pieces resumable and says so',async()=>{
 const {store}=fakeStore({release:async()=>{throw new Error('drawing_pieces_unavailable')}})
 const out:any=await createCadPieces({requestStore:store,ownerRequest:null,hasAccess:async()=>true}).execute(input(2))
 assert.equal(out.status,'not_started');assert(out.pieces.every((p:any)=>p.status==='stored_not_started'&&p.request_id))
 await assert.rejects(createCadPieces({requestStore:store,ownerRequest:null,hasAccess:async()=>false}).execute(input(2)),/project_denied/)
})

test('SQL: released pieces are designed one at a time after the turn; unreleased failures still wait for new data',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 await pg.exec(`create schema if not exists cron; create schema if not exists net; create or replace function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint'`)
 const owner=randomUUID(),turn=randomUUID(),[a,b,failed]=[randomUUID(),randomUUID(),randomUUID()]
 const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const service=(name:string,args:any[])=>call(null,'bob.'+name,args,'service_role')
 const jobs=async()=>(await pg.query('select drawing_request_id id from bob_private.bob_jobs where drawing_request_id is not null order by created_at')).rows.map((r:any)=>r.id)
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'pieces@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Pieces fixture'})])).id
 const queued=await service('bob_enqueue_job',[project,owner,turn,'Rita gästrummet',{version:1,ciphertext:'fixture'},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker'])
 const secret=(await pg.query('select * from bob_private.bob_jobs where id=$1',[queued.jobId])).rows[0]
 const claim=await service('bob_claim_job',[queued.jobId,secret.capability])
 const binding=[project,owner,secret.thread_id,turn,claim.generation]
 for(const [id,i] of [[a,1],[b,2],[failed,3]] as const){
  const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
  await call(owner,'bob.create_drawing_request',[project,secret.thread_id,turn,claim.generation,id,scope])
  await service('bob_drawing_request',[...binding,'save',id,0,id===failed?'retrieval_failed':'collecting',{brief:{...scope,brief:'piece '+i},owner_request:'Rita gästrummet',reference_refs:[]},randomUUID()])
 }
 const out=await service('release_drawing_pieces',[...binding,[a,b,failed]])
 assert.deepEqual(out.released,[a,b].sort(),'only fresh collecting pieces are released')
 await assert.rejects(service('release_drawing_pieces',[project,owner,secret.thread_id,randomUUID(),claim.generation,[a]]),/turn_not_claimed|project_denied/)
 assert.deepEqual(await jobs(),[],'nothing runs while the turn holds the thread')
 await service('bob_finish_job',[queued.jobId,claim.claimToken,null])
 await service('bob_dispatch_jobs',[])
 assert.deepEqual(await jobs(),[a],'first piece starts after the turn; the thread runs one piece at a time')
 const first=(await pg.query('select * from bob_private.bob_jobs where drawing_request_id=$1',[a])).rows[0]
 const firstClaim=await service('bob_claim_job',[first.id,first.capability])
 await service('bob_finish_job',[first.id,firstClaim.claimToken,'design_failed'])
 await service('bob_dispatch_jobs',[])
 assert.deepEqual(await jobs(),[a,b],'a failed piece does not stop the next one')
})
