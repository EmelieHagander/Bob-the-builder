import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProjectImageTools} from '../supabase/functions/_shared/project-image-tools.ts'
const png=()=>{const b=new Uint8Array(24);b.set([137,80,78,71,13,10,26,10]);const h=new DataView(b.buffer);h.setUint32(16,1024);h.setUint32(20,1024);return b}
const args={prompt:'Instruction showing the project assembly',title:'Assembly',purpose:'instruction',target_kind:'plan_step',target_id:'step',request_quote:'Gör bilden'}
function fixture(){const calls:any[]=[];let count=0;const opts={projectId:'A',message:'Gör bilden vid steget',deadline:Date.now()+200000,hasAccess:async()=>true,writer:{remaining:8,commit:async(p:any)=>{calls.push(p);return {status:'saved',receipt:{recordId:p.record_id}}}} as any,generate:async()=>{count++;return {ok:true as const,image:png()}},upload:async(id:string,_bytes:Uint8Array)=>{calls.push({upload:id})}};return {opts,calls,get generations(){return count}}}
test('an image is ready only after reserve, upload and finalize, using the same identity',async()=>{const f=fixture();const t=createProjectImageTools(f.opts);const r=await t.execute('generate_project_image',args);assert.equal(r.saved,true);assert.deepEqual(f.calls.map(p=>p.kind??'upload'),['image_reserve','upload','image_finalize']);assert.equal(f.calls[0].record_id,f.calls[1].upload);assert.equal(f.calls[0].record_id,f.calls[2].record_id);assert.equal(f.calls[0].data.target_kind,'plan_step')})
test('interrupted upload retains recoverable identity and prevents blind duplicate generation',async()=>{const f=fixture();f.opts.upload=async()=>{throw new Error('offline')};const t=createProjectImageTools(f.opts);const r=await t.execute('generate_project_image',args);assert.equal(r.status,'partial');assert.equal(r.saved,false);assert(r.media_id);assert.equal(f.calls.length,1);assert.equal((await t.execute('generate_project_image',args)).status,'budget_exhausted');assert.equal(f.generations,1)})
test('unauthorised quote and revoked membership never generate or reserve',async()=>{const f=fixture();const t=createProjectImageTools(f.opts);assert.equal((await t.execute('generate_project_image',{...args,request_quote:'invented'})).status,'invalid');f.opts.hasAccess=async()=>false;await assert.rejects(t.execute('generate_project_image',args),/project_denied/);assert.equal(f.generations,0);assert.equal(f.calls.length,0)})
test('finalization recovery never regenerates or uploads an image',async()=>{const f=fixture();const t=createProjectImageTools(f.opts);await t.execute('finalize_project_image',{media_id:'pending',request_quote:'Gör bilden'});assert.equal(f.generations,0);assert.deepEqual(f.calls.map(p=>p.kind),['image_finalize'])})
test('successful image generation discloses illustration provenance and review scope, never a CAD approval',async()=>{
 const f=fixture(),r=await createProjectImageTools(f.opts).execute('generate_project_image',args)
 assert.equal(r.saved,true);assert.equal(r.representation,'illustration');assert.equal(r.geometry_verified,false)
 assert.equal(r.project_id,'A');assert.equal(r.target_kind,'plan_step');assert.equal(r.target_id,'step')
 assert.match(r.review_instruction,/no CAD review/)
})
test('a photo mockup keeps exact reference identities and never falls back after a failed reference read',async()=>{
 const photo='10000000-0000-4000-8000-000000000001',f=fixture(),received:any[]=[]
 f.opts.generate=async(...input:any[])=>{received.push(input);return {ok:true as const,image:png()}}
 const t=createProjectImageTools({...f.opts,defaultImageIds:[photo]})
 const result=await t.execute('generate_project_image',args)
 assert.deepEqual(received[0],[args.prompt,[photo]])
 assert.deepEqual(result.reference_image_ids,[photo])
 const fresh=fixture();fresh.opts.generate=async()=>{throw new Error('reference unavailable')}
 const failed=await createProjectImageTools(fresh.opts).execute('generate_project_image',{...args,reference_image_ids:[photo]})
 assert.equal(failed.saved,false);assert.equal(failed.stage,'reference_images');assert.equal(fresh.calls.length,0)
 const noRefs=fixture();noRefs.opts.generate=f.opts.generate
 await createProjectImageTools({...noRefs.opts,defaultImageIds:[photo]}).execute('generate_project_image',{...args,reference_image_ids:[]})
 assert.deepEqual(received[1],[args.prompt,[]],'explicit no-reference illustration is preserved')
})

test('unlimited image work allows distinct completed images while exact retries keep the saved identity',async()=>{
 const f=fixture(),tools=createProjectImageTools({...f.opts,unlimitedWork:true})
 const first=await tools.execute('generate_project_image',args)
 assert.equal(first.saved,true)
 const repeat=await tools.execute('generate_project_image',{...args,request_quote:'Gör bilden vid steget'})
 assert.equal(repeat.status,'already_generated');assert.equal(repeat.media_id,first.media_id);assert.equal(f.generations,1)
 const next=await tools.execute('generate_project_image',{...args,prompt:'A second useful instruction view'})
 assert.equal(next.saved,true);assert.notEqual(next.media_id,first.media_id);assert.equal(f.generations,2)
})

test('unlimited image work recovers pending identity before permitting another generation',async()=>{
 const f=fixture();let uploadFails=true;f.opts.upload=async()=>{if(uploadFails)throw new Error('offline')}
 const tools=createProjectImageTools({...f.opts,unlimitedWork:true})
 const first=await tools.execute('generate_project_image',args)
 const next={...args,prompt:'A second useful instruction view'}
 const blocked=await tools.execute('generate_project_image',next)
 assert.equal(blocked.status,'recovery_required');assert.equal(blocked.media_id,first.media_id);assert.equal(f.generations,1)
 const finalized=await tools.execute('finalize_project_image',{media_id:first.media_id,request_quote:'Gör bilden'})
 assert.equal(finalized.status,'saved')
 assert.equal((await tools.execute('generate_project_image',args)).status,'already_generated')
 uploadFails=false
 assert.equal((await tools.execute('generate_project_image',next)).status,'saved');assert.equal(f.generations,2)
})

test('unlimited image work does not repeat a failed identical generation but allows a corrected request',async()=>{
 const f=fixture();let generations=0
 const tools=createProjectImageTools({...f.opts,unlimitedWork:true,generate:async()=>++generations===1?{ok:false as const,error:'unavailable'}:{ok:true as const,image:png()}})
 assert.equal((await tools.execute('generate_project_image',args)).status,'unavailable')
 assert.equal((await tools.execute('generate_project_image',args)).status,'no_progress');assert.equal(generations,1)
 assert.equal((await tools.execute('generate_project_image',{...args,prompt:'Corrected reference-free diagram'})).saved,true)
 assert.equal(generations,2)
})

test('unlimited image work respects the root deadline without the legacy fifteen-second reserve',async t=>{
 const start=Date.now();let clock=start;t.mock.method(Date,'now',()=>clock)
 const f=fixture(),legacy=createProjectImageTools({...f.opts,deadline:start+10000})
 assert.equal((await legacy.execute('generate_project_image',args)).status,'budget_exhausted')
 const tools=createProjectImageTools({...f.opts,unlimitedWork:true,deadline:start+10000})
 assert.equal((await tools.execute('generate_project_image',args)).saved,true)
 clock=start+10001
 assert.equal((await tools.execute('generate_project_image',{...args,prompt:'Another instruction'})).status,'budget_exhausted')
 assert.equal(f.generations,1)
})
