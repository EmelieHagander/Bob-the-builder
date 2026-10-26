import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createCadTransport} from '../supabase/functions/_shared/cad-transport.ts'
import {fastenerSchedule} from './support/fastener-schedule-fixture.ts'
import {cadPreviewKeys,type CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'
const recipe:CadAssemblyRequest={contract_version:1,units:'mm',assembly_id:'fixture',definitions:[{id:'part',primitive:'box',x_mm:10,y_mm:20,z_mm:30,material_ref:null}],instances:[{id:'one',definition_id:'part',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1sAAAAASUVORK5CYII='
const hash=async(encoded:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',Buffer.from(encoded,'base64'))).toString('hex')
async function packet(){const files={step:Buffer.from('ISO-10303-21').toString('base64'),front:Buffer.from('<svg/>').toString('base64')},bounds={min:[0,0,0],max:[10,20,30],size:[10,20,30]}
 return {files,previews:{front:png},manifest:{contract_version:1,assembly_id:'fixture',engine:{name:'build123d',version:'0.13.0',units:'mm'},definitions:recipe.definitions,instances:[{id:'one',definition_id:'part',bounding_box_mm:bounds}],bounding_box_mm:bounds,exports:{step:{file:'assembly.step',sha256:await hash(files.step)},front:{file:'front.svg',sha256:await hash(files.front)}},previews:{front:{file:'front.png',sha256:await hash(png),source_sha256:await hash(files.front)}}}}
}
test('transport delivers bounded PNG views only with valid hashes bound to the exact SVG exports',async()=>{
 const p=await packet();const fetcher=(async()=>new Response(JSON.stringify(p))) as typeof fetch
 const result=await createCadTransport('https://fixture.invalid/render','fixture',fetcher)(recipe)
 assert.equal(result.previews?.front,png)
 assert.equal(result.manifest.previews,undefined)
 assert.deepEqual(result.manifest.preview_metadata,p.manifest.previews)
 assert(!JSON.stringify(result.manifest).includes(png))
 p.manifest.previews.front.source_sha256='0'.repeat(64)
 await assert.rejects(createCadTransport('https://fixture.invalid/render','fixture',fetcher)(recipe),/invalid_cad_preview/)
})
test('preview metadata cannot smuggle bytes or paths into the private commitment',async()=>{
 for(const patch of [{file:'../front.png'},{pixels:png},{sha256:'not-a-hash'}]){
  const p=await packet();Object.assign(p.manifest.previews.front,patch)
  await assert.rejects(createCadTransport('https://fixture.invalid/render','fixture',(async()=>new Response(JSON.stringify(p))) as typeof fetch)(recipe),/invalid_cad_preview/)
 }
})
test('missing or corrupted previews cannot masquerade as visual feedback',async()=>{
 const p=await packet();p.previews.front='not png'
 await assert.rejects(createCadTransport('https://fixture.invalid/render','fixture',(async()=>new Response(JSON.stringify(p))) as typeof fetch)(recipe),/invalid_cad_preview/)
})
test('construction envelope preserves recipe and refuses a different source revision',async()=>{
 const p:any=await packet(),source={artifact_id:'11111111-1111-4111-8111-111111111111',revision:3}
 p.manifest.drawing_source=source
 const fetcher=(async(_url:any,init:any)=>{assert.deepEqual(JSON.parse(init.body),{recipe,drawing_source:source});return new Response(JSON.stringify(p))}) as typeof fetch
 const render=createCadTransport('https://fixture.invalid/render','fixture',fetcher)
 assert.equal((await render(recipe,source)).manifest.drawing_source.revision,3)
 p.manifest.drawing_source={...source,revision:2}
 await assert.rejects(render(recipe,source),/cad_construction_source_mismatch/)
})
// Owner decision 2026-10-26: drawings carry no fasteners. The worker still
// accepts a schedule and answers annotations version 2 (dormant); the edge
// never sends one and refuses a version 2 answer.
test('a drawing is sent as recipe and source only and must come back as annotations version 1',async()=>{
 const source={artifact_id:'11111111-1111-4111-8111-111111111111',revision:3},schedule=fastenerSchedule()
 const views={front:{coverage:'complete',dimensions:[{axis:'x',mm:10},{axis:'z',mm:30}],parts:[{number:'P1',instance_id:'one',definition_id:'part',blank_mm:{x_mm:10,y_mm:20,z_mm:30}}]}}
 const bodies:unknown[]=[]
 const respond=(annotations:unknown)=>(async(_url:any,init:any)=>{
  bodies.push(JSON.parse(init.body))
  const p:any=await packet();p.manifest.drawing_source=source;p.manifest.annotations=annotations;return new Response(JSON.stringify(p))
 }) as typeof fetch
 const drawn=await createCadTransport('https://fixture.invalid/render','fixture',respond({version:1,coverage:'complete',views}))(recipe,source)
 assert.equal(drawn.manifest.annotations.version,1);assert.equal('fasteners' in drawn.manifest.annotations,false)
 for(const annotations of [{version:2,coverage:'complete',views,fasteners:schedule},{version:1,coverage:'complete',views,fasteners:schedule}])
  await assert.rejects(createCadTransport('https://fixture.invalid/render','fixture',respond(annotations))(recipe,source),/invalid_cad_result/)
 // A stale caller passing a schedule still sends the two-key envelope.
 await (createCadTransport('https://fixture.invalid/render','fixture',respond({version:1,coverage:'complete',views})) as any)(recipe,source,schedule)
 assert.equal(bodies.length,4)
 for(const body of bodies)assert.deepEqual(body,{recipe,drawing_source:source})
})
test('no fastener schedule is read for a drawing render',async()=>{
 const transport=await import('../supabase/functions/_shared/cad-transport.ts')
 assert.equal('readConstructionFasteners' in transport,false)
 const code=await readFile(new URL('../supabase/functions/_shared/ask-openai.ts',import.meta.url),'utf8')
 const start=code.indexOf("memo('cad:render'"),render=code.slice(start,code.indexOf('},45000)',start)).replace(/\/\/[^\n]*/g,'')
 assert(start>0&&render.length>0)
 assert.match(render,/createCadTransport\(Deno\.env\.get\('BOB_CAD_URL'\),Deno\.env\.get\('BOB_CAD_TOKEN'\)\)\(recipe,source\)/)
 assert.doesNotMatch(render,/fastener/i)
 // The one remaining schedule read serves derive_construction_lists.
 assert.equal(code.split("'read_construction_fasteners'").length,2)
 assert.match(code,/readFasteners:async\(id:string,revision:number\)=>\{\s*const \{data,error\}=await readRpc\('read_construction_fasteners'/)
})
test('every numbered sheet is required, hash checked and retained for independent review',async()=>{
 const r=structuredClone(recipe),p:any=await packet()
 r.instances=Array.from({length:33},(_,i)=>({...structuredClone(recipe.instances[0]),id:'part'+i.toString().padStart(3,'0')}))
 p.manifest.instances=r.instances.map(i=>({...p.manifest.instances[0],id:i.id}))
 p.previews['front.sheet2']=png
 p.manifest.previews['front.sheet2']={...p.manifest.previews.front,file:'front.sheet2.png'}
 const fetcher=(async()=>new Response(JSON.stringify(p))) as typeof fetch
 const render=createCadTransport('https://fixture.invalid/render','fixture',fetcher)
 const saved=await render(r)
 assert.deepEqual(Object.keys(saved.previews!),cadPreviewKeys(r))
 assert.equal(saved.manifest.preview_metadata['front.sheet2'].source_sha256,await hash(p.files.front))
 for(const change of [(v:any)=>delete v.previews['front.sheet2'],(v:any)=>v.previews.extra=png,
   (v:any)=>v.manifest.previews['front.sheet2'].source_sha256='0'.repeat(64),
   (v:any)=>v.previews['front.sheet2']='not png']){
  const bad=structuredClone(p);change(bad)
  await assert.rejects(createCadTransport('https://fixture.invalid/render','fixture',(async()=>new Response(JSON.stringify(bad))) as typeof fetch)(r),/cad_previews_missing|invalid_cad_preview/)
 }
 const boundary={...r,instances:Array.from({length:512},(_,i)=>({...r.instances[0],id:'p'+i})),views:['front','right','top','isometric'] as CadAssemblyRequest['views']}
 assert.equal(cadPreviewKeys(boundary).length,64)
 assert(cadPreviewKeys(boundary).includes('isometric.sheet16'))
})
