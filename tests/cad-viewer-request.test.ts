import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createCadViewerHandler, createCadWireframeTransport, type CadViewerDependencies } from '../supabase/functions/_shared/cad-viewer-request.ts'
import { CAD_WIREFRAME_BYTES, cadViewerSourceHash } from '../supabase/functions/_shared/cad-wireframe.ts'
const {recipe,geometry}=JSON.parse(readFileSync(new URL('./fixtures/cad-wireframes.json',import.meta.url),'utf8')).machined
const pin={project_id:'project.A',artifact_id:'00000000-0000-4000-8000-000000000001',revision:3}
const request=(data:unknown=pin,auth='Bearer fixture')=>new Request('https://fixture.invalid/cad-viewer',{method:'POST',headers:{Authorization:auth},body:JSON.stringify(data)})
const body=async(res:Response)=>({status:res.status,body:await res.json()})
function context() {
 let allowed=true, source=recipe, exports=0, attempts=0, lease='', status='empty', payload:unknown
 const deps:CadViewerDependencies={
  authorize:async(auth,p)=>allowed&&auth==='Bearer fixture'&&JSON.stringify(p)===JSON.stringify(pin)?source:null,
  claim:async(_p,hash,retry)=>{
   assert.equal(hash,await cadViewerSourceHash(source))
   if(status==='ready')return {status:'ready',payload}
   if(status==='generating')return {status:'pending'}
   if(status==='failed'&&(!retry||attempts===3))return {status:'failed',retry_allowed:attempts<3}
   status='generating';lease='lease'+(++attempts);return {status:'claimed',lease_token:lease,attempt:attempts}
  },
  finish:async(_p,_h,l,p)=>{if(l!==lease)return false;payload=p;status=p?'ready':'failed';return true},
  render:async(r,h)=>{exports++;assert.deepEqual(r,recipe);assert.equal(h,geometry.source_hash);return geometry},
 }
 return {deps,handler:createCadViewerHandler(deps),revoke:()=>{allowed=false},change:()=>{source={...recipe,assembly_id:'changed'}},exports:()=>exports,attempts:()=>attempts}
}
test('exact saved version is exported once, cached and reused without an AI or paid view loop',async()=>{
 const c=context()
 const first=await c.handler(request());assert.equal(first.headers.get('Cache-Control'),'no-store')
 assert.deepEqual((await first.json()).source,pin)
 for(let n=0;n<4;n++)assert.equal((await body(await c.handler(request()))).body.status,'ready')
 assert.equal(c.exports(),1);assert.equal(c.attempts(),1)
})
test('simultaneous viewers share a claim and polls do not trigger more exports',async()=>{
 const c=context();let complete!:()=>void
 const render=c.deps.render
 c.deps.render=async(r,h)=>{await new Promise<void>(resolve=>{complete=resolve});return render(r,h)}
 const first=c.handler(request())
 for(let n=0;n<15&&!complete;n++)await new Promise(resolve=>setTimeout(resolve,0))
 assert(complete)
 const others=await Promise.all(Array.from({length:8},()=>c.handler(request())))
 for(const r of others)assert.equal((await r.json()).status,'pending')
 complete();assert.equal((await (await first).json()).status,'ready');assert.equal(c.exports(),1)
})
test('project isolation, revocation and source replacement block even cached output',async()=>{
 const c=context();assert.equal((await c.handler(request({...pin,project_id:'other'}))).status,403);assert.equal(c.exports(),0)
 await c.handler(request());c.revoke()
 assert.equal((await c.handler(request())).status,403);assert.equal(c.exports(),1)
 for(const revoke of ['access','source']) {
  const next=context(),render=next.deps.render
  next.deps.render=async(r,h)=>{const output=await render(r,h);if(revoke==='access')next.revoke();else next.change();return output}
  assert.equal((await next.handler(request())).status,403)
 }
})
test('failure requires an explicit retry, with at most three export attempts for a pin',async()=>{
 const c=context();c.deps.render=async()=>{throw new Error('private worker failure')}
 assert.deepEqual((await body(await c.handler(request()))).body,{status:'failed',retry_allowed:true})
 for(let n=0;n<5;n++)await c.handler(request())
 assert.equal(c.attempts(),1)
 await c.handler(request({...pin,retry:true}))
 assert.deepEqual((await body(await c.handler(request({...pin,retry:true})))).body,{status:'failed',retry_allowed:false})
 await c.handler(request({...pin,retry:true}));assert.equal(c.attempts(),3)
})
test('bad identity, bearer, user-selected geometry/endpoint and unbounded bodies never render',async()=>{
 const c=context()
 assert.equal((await c.handler(request(pin,''))).status,401)
 for(const extra of [{url:'https://other.invalid'}, {recipe}, {retry:1}, {revision:0}]) assert.equal((await c.handler(request({...pin,...extra}))).status,400)
 assert.equal((await c.handler(request({...pin,oversized:'a'.repeat(2000)}))).status,413)
 assert.equal((await c.handler(new Request('https://fixture.invalid',{method:'GET'}))).status,405)
 assert.equal(c.exports(),0)
})
test('malformed cached or generated edges cannot become a successful empty view',async()=>{
 const c=context();c.deps.claim=async()=>({status:'ready',payload:{...geometry,definitions:[]}})
 assert.equal((await c.handler(request())).status,503)
 const next=context();next.deps.render=async()=>({...geometry,source_hash:'b'.repeat(64)})
 assert.equal((await (await next.handler(request())).json()).status,'failed')
})
test('transport uses only the configured worker, with bearer, timeout and streamed byte bounds',async()=>{
 const fetcher=(async(url:URL,init:RequestInit)=>{
  assert.equal(url.toString(),'https://worker.invalid/wireframe');assert.equal(init.redirect,'error');assert(init.signal)
  assert.equal((init.headers as any).Authorization,'Bearer server-token')
  assert.deepEqual(JSON.parse(init.body as string),{recipe,source_hash:geometry.source_hash})
  return new Response(JSON.stringify(geometry))
 }) as typeof fetch
 assert.deepEqual(await createCadWireframeTransport('https://worker.invalid/render','server-token',fetcher)(recipe,geometry.source_hash),geometry)
 for(const url of ['http://worker.invalid/render','https://user:pass@worker.invalid/render','https://worker.invalid/other'])
  await assert.rejects(createCadWireframeTransport(url,'server-token',fetcher)(recipe,geometry.source_hash),/cad_endpoint_invalid/)
 let canceled=false
 const oversize=(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(CAD_WIREFRAME_BYTES+1))},cancel(){canceled=true}}))) as typeof fetch
 await assert.rejects(createCadWireframeTransport('https://worker.invalid/render','server-token',oversize)(recipe,geometry.source_hash),/cad_view_too_large/)
 assert(canceled)
})
