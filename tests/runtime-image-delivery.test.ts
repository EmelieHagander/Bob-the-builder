import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProjectImageTools} from '../supabase/functions/_shared/project-image-tools.ts'
const args={prompt:'Show the saved barn in its actual setting',title:'Ladan',purpose:'proposal',target_kind:'task',target_id:'task',request_quote:'Visa ladan',reference_image_ids:[]}
function fixture(){let count=0,target='ready',version=1,link='saved',access=true;const calls:any[]=[]
 const opts={unlimitedWork:true,projectId:'p',message:'Visa ladan',deadline:Date.now()+100000,hasAccess:async()=>access,
  delivery:{validateTarget:async()=>{calls.push('preflight');return{status:target}},generationKey:async(prompt:string,refs:string[])=>JSON.stringify([prompt,refs,version])},
  writer:{remaining:Infinity,commit:async(p:any)=>{calls.push(p);return{status:p.kind==='image_link'?link:'saved',receipt:{recordId:p.record_id}}}} as any,
  generate:async()=>{count++;calls.push('provider');const image=new Uint8Array(24);image.set([137,80,78,71,13,10,26,10]);const h=new DataView(image.buffer);h.setUint32(16,1024);h.setUint32(20,1024);return{ok:true as const,image}},upload:async()=>{calls.push('upload')}}
 return{opts,calls,get count(){return count},target:(v:string)=>target=v,version:()=>version++,link:(v:string)=>link=v,access:(v:boolean)=>access=v}
}
test('invalid attachment fails before provider, reservation or upload; corrected input can then generate',async()=>{
 const f=fixture(),t=createProjectImageTools(f.opts);f.target('not_found')
 assert.equal((await t.execute('generate_project_image',args)).stage,'target');assert.equal(f.count,0);assert.deepEqual(f.calls,['preflight'])
 f.target('ready');assert.equal((await t.execute('generate_project_image',{...args,target_id:'correct'})).saved,true);assert.equal(f.count,1)
 assert.equal(f.calls.find(c=>c.kind==='image_reserve').data.target_id,'p')
})
test('attachment race leaves durable ready media; correction after checkpoint reuses it without generation/upload',async()=>{
 const f=fixture(),t=createProjectImageTools(f.opts);f.link('invalid')
 const first=await t.execute('generate_project_image',args);assert.equal(first.status,'partial');assert.equal(first.image_saved,true)
 const next=createProjectImageTools(f.opts);next.restoreState(JSON.parse(JSON.stringify(t.exportState())));f.link('saved')
 const result=await next.execute('generate_project_image',{...args,target_id:'new-task',title:'Ny titel'})
 assert.equal(result.media_id,first.media_id);assert.equal(result.saved,true);assert.equal(f.count,1)
 assert.equal(f.calls.filter(c=>c==='upload').length,1);assert.equal(f.calls.filter(c=>c.kind==='image_finalize').length,1)
})
test('generation identity includes reference/config versions while purpose and target do not cause duplicates',async()=>{
 const f=fixture(),t=createProjectImageTools(f.opts)
 const first=await t.execute('generate_project_image',args)
 assert.equal((await t.execute('generate_project_image',{...args,purpose:'instruction',target_id:'other'})).media_id,first.media_id)
 assert.equal(f.count,1);f.version();await t.execute('generate_project_image',args);assert.equal(f.count,2)
})
test('pending upload is recovered and finalized before attachment repair; no replacement is generated',async()=>{
 const f=fixture();f.opts.upload=async()=>{throw Error('offline')};const t=createProjectImageTools(f.opts)
 const first=await t.execute('generate_project_image',args);assert.equal(first.stage,'upload')
 assert.equal((await t.execute('generate_project_image',{...args,target_id:'other'})).status,'recovery_required')
 await t.execute('finalize_project_image',{media_id:first.media_id,request_quote:args.request_quote})
 assert.equal((await t.execute('generate_project_image',{...args,target_id:'other'})).saved,true);assert.equal(f.count,1)
})
test('revoked access and unavailable preflight never dispatch a paid operation',async()=>{
 const f=fixture(),t=createProjectImageTools(f.opts);f.access(false);await assert.rejects(t.execute('generate_project_image',args),/project_denied/)
 f.access(true);f.target('unavailable');assert.equal((await t.execute('generate_project_image',args)).status,'unavailable');assert.equal(f.count,0)
})
