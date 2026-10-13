import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
const {recipe,geometry}=JSON.parse(readFileSync(new URL('./fixtures/cad-wireframes.json',import.meta.url),'utf8')).machined
test('display cache enforces project RLS, service-only leases, bounded retries and immutable source rows',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'viewer-owner@example.test',outsider,'viewer-other@example.test'])
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'CAD viewer fixture'})])).id
 const other=(await call(outsider,'bob.create_project',[JSON.stringify({name:'Other CAD viewer fixture'})])).id
 const solution=randomUUID()
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Cabin',description:'Concept',assumptions:'Unverified',tradeoffs:'Simple',measurements:[]})])
 await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use design'})])
 const target=(await pg.query('select current_revision from bob.project_targets where project_id=$1',[project])).rows[0].current_revision
 const artifact=randomUUID()
 await call(owner,'bob.artifact_command',[project,'create',artifact,0,JSON.stringify({title:'Machined block',description:'Piece',kind:'plan',status:'concept',assumptions:'Concept',source_media_id:null,measurements:[],target_revision:target})])
 // Fixture stands in for the tested CAD writer; derivative RPCs must never change this source.
 await pg.exec('set session_replication_role=replica')
 await pg.query("insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,$3,'{}','{}')",[project,artifact,JSON.stringify(recipe)])
 await pg.exec('set session_replication_role=origin')
 const original=(await pg.query('select row_to_json(c) value from bob.artifact_cad_revisions c where artifact_id=$1',[artifact])).rows[0].value
 const hash=geometry.source_hash
 const claim=(h=hash,retry=false,p=project,role='service_role')=>call(null,'bob.claim_cad_viewer_export',[p,artifact,1,h,retry],role)
 const finish=(h:string,lease:string,payload:unknown)=>call(null,'bob.finish_cad_viewer_export',[project,artifact,1,h,lease,payload===null?null:JSON.stringify(payload)],'service_role')
 await assert.rejects(claim(hash,false,project,'authenticated'),/permission denied/)
 await assert.rejects(claim(hash,false,other),/viewer_source_unavailable/)
 await assert.rejects(claim('bad'),/viewer_source_unavailable/)
 const first=await claim();assert.equal(first.status,'claimed');assert.equal(first.attempt,1)
 assert.deepEqual(await claim(),{status:'pending'});assert.deepEqual(await claim(hash,true),{status:'pending'})
 assert.equal(await finish(hash,randomUUID(),geometry),false,'wrong lease cannot replace the export')
 await assert.rejects(finish(hash,first.lease_token,{...geometry,source_hash:'b'.repeat(64)}),/viewer_payload_invalid/)
 assert.equal(await finish(hash,first.lease_token,geometry),true)
 assert.deepEqual(await claim(),{status:'ready',payload:geometry})
 assert.equal(await finish(hash,first.lease_token,null),false,'finished cache cannot be clobbered')
 assert.equal((await asProjectUser(pg,owner,'select * from bob.cad_viewer_exports')).rows.length,1)
 assert.equal((await asProjectUser(pg,outsider,'select * from bob.cad_viewer_exports')).rows.length,0)
 assert.equal((await asProjectUser(pg,null,'select * from bob.cad_viewer_exports',[],'anon').catch(()=>({rows:[]}))).rows.length,0)
 await assert.rejects(asProjectUser(pg,owner,"update bob.cad_viewer_exports set status='failed',payload=null"),/permission denied/)
 const retryHash='b'.repeat(64)
 let next=await claim(retryHash);await finish(retryHash,next.lease_token,null)
 for(let n=0;n<4;n++)assert.deepEqual(await claim(retryHash),{status:'failed',retry_allowed:true})
 next=await claim(retryHash,true);assert.equal(next.attempt,2)
 await pg.query("update bob.cad_viewer_exports set lease_expires_at=now()-interval '1 second' where source_hash=$1",[retryHash])
 assert.equal(await finish(retryHash,next.lease_token,{...geometry,source_hash:retryHash}),false,'expired worker fenced')
 assert.deepEqual(await claim(retryHash),{status:'failed',retry_allowed:true},'expiry does not pay for a retry automatically')
 const third=await claim(retryHash,true);assert.equal(third.attempt,3)
 assert.equal(await finish(retryHash,next.lease_token,null),false,'previous worker cannot finish a newer lease')
 await finish(retryHash,third.lease_token,null)
 assert.deepEqual(await claim(retryHash,true),{status:'failed',retry_allowed:false})
 assert.deepEqual((await pg.query('select row_to_json(c) value from bob.artifact_cad_revisions c where artifact_id=$1',[artifact])).rows[0].value,original)
 assert.equal((await pg.query('select current_revision from bob.artifacts where id=$1',[artifact])).rows[0].current_revision,1)
})
