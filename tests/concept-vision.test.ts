import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {initWasm,Resvg} from '@resvg/resvg-wasm'
import {conceptFixture} from './support/solution-concept-fixtures.ts'
import {conceptSvg} from '../supabase/functions/_shared/solution-concept.ts'
import {conceptSourceSvg,createSavedConceptHandler} from '../supabase/functions/_shared/saved-concept-raster.ts'
import {createConceptViewAdapter,resolveConceptViewImage,conceptViewRef} from '../supabase/functions/_shared/project-context/concepts.ts'
import {createProjectContext} from '../supabase/functions/_shared/project-context/dispatcher.ts'
import {validVisualSource} from '../src/data/bobEvidence.ts'
const require=createRequire(import.meta.url),id='10000000-0000-4000-8000-000000000001',intent=conceptFixture('barn'),json=JSON.stringify(intent),sha=createHash('sha256').update(json).digest('hex')
const pin={project_id:'p',solution_id:id,revision:3,view:'profile',source_sha256:sha}
const row={status:'ready' as const,projectId:'p',artifact_id:id,solution_id:id,revision:3,current_revision:3,view:'profile',source_view:'profile',source_sha256:sha,title:'Saved concept',archived:false,recorded_at:'2026-11-05T12:00:00Z',area_id:null,source_state:'current',source_reasons:[],model_json:json}
let font:Uint8Array
before(async()=>{await initWasm(await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));font=await readFile(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'))})
const raster=async(page:any)=>{const r=new Resvg(page.svg,{fitTo:{mode:'width',value:1024},font:{fontBuffers:[font],defaultFontFamily:'DejaVu Sans'}});try{const im=r.render();try{return new Uint8Array(im.asPng())}finally{im.free()}}finally{r.free()}}
const req=(body:any,auth=true)=>new Request('https://edge.invalid/concept-preview',{method:'POST',headers:auth?{Authorization:'Bearer test'}:{},body:JSON.stringify(body)})
test('exact saved concept uses the same SVG as the UI; raster endpoint is bounded, caller gated and domain typed',async()=>{
 assert.equal(await conceptSourceSvg(row),conceptSvg(intent,'profile'))
 await assert.rejects(conceptSourceSvg({...row,source_sha256:'0'.repeat(64)}),/changed/)
 const h=createSavedConceptHandler({read:async()=>row,raster}),response=await h(req(pin))
 assert.equal(response.status,200);assert.equal(response.headers.get('x-drawing-source-sha256'),sha);assert.equal(response.headers.get('cache-control'),'no-store');assert((await response.arrayBuffer()).byteLength<700000)
 assert.equal((await h(req(pin,false))).status,401)
 assert.equal((await h(req({...pin,artifact_id:id}))).status,400)
 assert.equal((await h(req({...pin,source_sha256:'0'.repeat(64)}))).status,403)
 const denied=createSavedConceptHandler({read:async()=>null,raster});assert.equal((await denied(req(pin))).status,403)
})
test('model receives pixels only after opening, evidence only after delivery; checkpoints retain typed refs without pixels',async()=>{
 let current=3,renders=0;const ref=conceptViewRef(id,3,'profile'),sources:any[]=[]
 const transport={list:async()=>({projectId:'p',total:1,records:[{id,revision:3,title:'Saved concept',area_id:null,views:['plan','profile'],source_state:'current',source_reasons:[]}]}),read:async()=>({...row,current_revision:current}),raster:async()=>{renders++;return raster({svg:conceptSvg(intent,'profile')})}}
 const adapter=createConceptViewAdapter('p',transport),context=createProjectContext({adapters:[adapter],hasAccess:async()=>true,sources})
 const result=await context.execute('open_project_item',{refs:[ref]});assert.equal(result.status,'ok');assert.equal(renders,0);assert.equal(sources.length,0)
 const state=JSON.stringify(context.exportState());assert(!state.includes('model_json'));assert(!state.includes('data:image'));assert(state.includes('concept:'))
 const opened=await adapter.open(ref,AbortSignal.timeout(1000));assert(validVisualSource(opened.source));assert.equal(opened.source.visual?.kind,'concept');assert.equal(opened.source.visual?.view,'profile')
 const png=await resolveConceptViewImage('p',transport,opened,AbortSignal.timeout(1000));assert(png.startsWith('data:image/png;base64,'));assert.equal(renders,1)
 await context.confirmDelivery();assert.equal(sources.length,1);assert.equal(sources[0].visual.ref,ref)
 current=4;assert.equal(await adapter.current(ref,opened.version,AbortSignal.timeout(1000)),false);await assert.rejects(resolveConceptViewImage('p',transport,opened,AbortSignal.timeout(1000)),/context_changed/)
 assert(!validVisualSource({...opened.source,visual:{...opened.source.visual,kind:'cad'}}))
})
