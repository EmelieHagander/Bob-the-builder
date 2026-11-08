import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {initWasm,Resvg} from '@resvg/resvg-wasm'
import {createSavedDrawingHandler,savedSvgPage,sourceSvg,SAVED_VIEW_PNG_MAX,type SavedViewRecord} from '../supabase/functions/_shared/saved-drawing-raster.ts'
import {createDrawingViewAdapter,resolveDrawingViewImage,drawingViewRef} from '../supabase/functions/_shared/project-context/drawings.ts'
import {createProjectContext} from '../supabase/functions/_shared/project-context/dispatcher.ts'
import {createDrawingViewTransport} from '../supabase/functions/_shared/project-context/drawing-transport.ts'
import {applyCatalogModelOptions} from '../supabase/functions/_shared/ai-catalog.ts'
import {runWorker} from '../supabase/functions/_shared/bob-workers.ts'
import {catalogCall,catalogFixture} from './support/ai-catalog-fixture.ts'
const require=createRequire(import.meta.url),id='10000000-0000-4000-8000-000000000001'
const svg='<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300" data-page-height="100"><rect width="200" height="100" fill="red"/><g transform="translate(0,100)"><rect width="200" height="100" fill="green"/></g><g transform="translate(0,200)"><rect width="200" height="100" fill="blue"/><text x="20" y="50" fill="black" font-size="30">Lada Åäö 6×3</text></g></svg>'
const hash=createHash('sha256').update(svg).digest('hex')
const pin={project_id:'p',artifact_id:id,revision:3,view:'front',source_sha256:hash}
const row:SavedViewRecord={status:'ready',projectId:'p',artifact_id:id,revision:3,current_revision:3,view:'front',source_view:'front',source_sha256:hash,title:'Ladan',archived:false,recorded_at:'2026-11-05T07:00:00Z',area_id:null,source_state:'current',source_reasons:[],svg:Buffer.from(svg).toString('base64')}
test('main chat reports its exact preview capability but attaches evidence only after pixel delivery, including restore',async()=>{
 const sources:any[]=[]
 const transport:any={read:async()=>row,raster:async()=>new Uint8Array(),list:async()=>({projectId:'p',total:1,records:[]})}
 const make=(chatPreviews:boolean,imageContextRefs=false)=>createProjectContext({chatPreviews,imageContextRefs,adapters:[createDrawingViewAdapter('p',transport)],hasAccess:async()=>true,sources,imageEvidenceInstruction:'Evidence'})
 const main=make(true),ref=drawingViewRef(id,3,'front')
 const result:any=await main.execute('open_project_item',{refs:[ref]})
 assert.equal(result.items[0].chat_preview.status,'attached_to_answer_after_pixel_delivery')
 assert.equal(result.items[0].context_ref,'image-input:'+main.carrier()[0].content.find(p=>p.type==='image_url')!.image_url.slice(14))
 assert.deepEqual([result.items[0].chat_preview.ref,result.items[0].chat_preview.revision,result.items[0].chat_preview.view],[ref,3,'front'])
 assert.equal(sources.length,0,'opening or preparing alone is not delivery')
 const restored=make(true);restored.restoreState(JSON.parse(JSON.stringify(main.exportState())))
 assert.equal(restored.carrier().length,1);restored.confirmDelivery()
 assert.equal(sources[0].visual.ref,ref)
 const worker:any=await make(false).execute('open_project_item',{refs:[ref]})
 assert(!Object.hasOwn(worker.items[0],'context_ref'),'old workers keep their exact tool payload')
 const staged=make(false,true),opened:any=await staged.execute('open_project_item',{refs:[ref]})
 assert.equal(opened.items[0].context_ref,result.items[0].context_ref)
 assert(!Object.hasOwn(opened.items[0],'chat_preview'))
 assert(JSON.stringify(staged.carrier()).includes(opened.items[0].context_ref),'the worker can retain its exact pixels at a stage transition')
 assert(!Object.hasOwn(worker.items[0],'chat_preview'),'workers do not promise their own private images in the main reply')
})
let font:Uint8Array
before(async()=>{await initWasm(await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));font=await readFile(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'))})
function render(page:ReturnType<typeof savedSvgPage>){const r=new Resvg(page.svg,{background:'white',fitTo:{mode:'zoom',value:1024/Math.max(page.width,page.height)},font:{fontBuffers:[font],defaultFontFamily:'DejaVu Sans'}});try{const im=r.render();try{return{png:new Uint8Array(im.asPng()),pixels:new Uint8Array(im.pixels),width:im.width,height:im.height}}finally{im.free()}}finally{r.free()}}
function request(p=pin){return new Request('https://edge.invalid/drawing-preview',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(p)})}
test('the actual WASM renderer crops each saved sheet, preserves glyphs and bounds image size',()=>{
 const colors=[[255,0,0],[0,128,0],[0,0,255]],outputs=[]
 for(let n=1;n<=3;n++){
  const view=n===1?'front':`front.sheet${n}`,page=savedSvgPage(svg,view),im=render(page)
  assert.equal(page.page,n);assert.equal(im.width,1024);assert.equal(im.height,512)
  const offset=(im.width*10+10)*4;assert.deepEqual([...im.pixels.slice(offset,offset+3)],colors[n-1]);assert(im.png.length<SAVED_VIEW_PNG_MAX)
  if(n===3){let dark=0;for(let i=0;i<im.pixels.length;i+=4)if(im.pixels[i]<20&&im.pixels[i+1]<20&&im.pixels[i+2]<20)dark++;assert(dark>500,'font must actually draw the saved text')}
  outputs.push(createHash('sha256').update(im.png).digest('hex'))
 }
 assert.equal(new Set(outputs).size,3)
})
test('SVG source is hash-pinned; external resources, malformed pages and active content fail closed',async()=>{
 assert.equal(await sourceSvg(row),svg)
 await assert.rejects(sourceSvg({...row,source_sha256:'0'.repeat(64)}),/changed/)
 for(const bad of ['<!DOCTYPE svg>'+svg,svg.replace('<rect','<image href="https://evil.invalid/"'),svg.replace('<rect','<script'),svg.replace('<rect','<use href="https://evil.invalid/#x"'),svg.replace('<rect','<path style="fill:url(https://evil.invalid/)"')])assert.throws(()=>savedSvgPage(bad,'front'))
 assert.throws(()=>savedSvgPage(svg,'front.sheet4'),/page_unavailable/)
 assert.throws(()=>savedSvgPage(svg.replace('0 0 200 300','0 0 0 300'),'front'),/invalid/)
})
test('cached PNG still requires fresh caller authorization and source status; revocation never returns pixels',async()=>{
 let allowed=true,changed=false,renders=0,reads=0
 const handler=createSavedDrawingHandler({read:async(_auth,p,full)=>{reads++;return allowed?{...row,view:p.view,source_state:changed?'changed':'current',svg:full?row.svg:undefined}:null},raster:async page=>{renders++;return render(page).png}})
 const first=await handler(request());assert.equal(first.status,200);assert.equal(first.headers.get('content-type'),'image/png');assert((await first.arrayBuffer()).byteLength>100)
 assert.equal((await handler(request())).status,200);assert.equal(renders,1);assert.equal(reads,5)
 allowed=false;assert.equal((await handler(request())).status,403);assert.equal(renders,1)
 allowed=true;changed=true;assert.equal((await handler(request())).status,200,'changed source is visible as changed, not silently approved')
 const racing=createSavedDrawingHandler({read:async(_a,_p,full)=>({...row,current_revision:full?4:3}),raster:async page=>render(page).png})
 assert.equal((await racing(request())).status,409)
 assert.equal((await handler(new Request('https://edge.invalid',{method:'POST',body:'{}'}))).status,401)
 assert.equal((await handler(request({...pin,project_id:'foreign'}))).status,403)
})
test('listed saved sheets become real provider image input after a JSON restart; checkpoint contains no pixels',async()=>{
 let current=3,authorized=true,rasters=0
 const png=render(savedSvgPage(svg,'front.sheet2')).png
 const transport={list:async()=>({projectId:'p',total:1,records:[{id,revision:3,title:'Ladan',area_id:null,views:['front','front.sheet2','front.sheet3'],source_state:'current',source_reasons:[]}]}),read:async(_id:string,_rev:number,view:string)=>authorized?{...row,view,current_revision:current}:null,raster:async()=>{rasters++;return png}}
 const adapter=createDrawingViewAdapter('p',transport),make=()=>createProjectContext({adapters:[adapter],hasAccess:async()=>authorized,sources:[],imageEvidenceInstruction:'Saved image evidence',describe:async()=>{throw Error('must not write media description')}})
 const context=make(),listed:any=await context.execute('list_project_category',{category:'drawing_views',query:null,area_id:null,after_id:null})
 assert.equal(listed.items.length,1);assert.equal(listed.items[0].views.length,3);assert.equal(rasters,0)
 const ref=drawingViewRef(id,3,'front.sheet2');assert.equal((await context.execute('open_project_item',{refs:[ref]})).status,'ok')
 const state=JSON.parse(JSON.stringify(context.exportState()));assert(!JSON.stringify(state).includes('data:image'));assert(!JSON.stringify(state).includes('<svg'))
 const resumed=make();resumed.restoreState(state);assert(await resumed.validate())
 const image=await resolveDrawingViewImage('p',transport,state.pending[0],AbortSignal.timeout(1000));assert(image.startsWith('data:image/png;base64,'));assert.equal(rasters,1)
 assert.equal(resumed.carrier()[0].content.filter(p=>p.type==='image_url').length,1)
 resumed.confirmDelivery();assert.equal(resumed.exportState().pending.length,0)
 assert.equal((await resumed.execute('describe_project_image',{ref,description:'green'})).status,'unavailable')
 current=4;assert.equal(await resumed.validate(),false)
 await assert.rejects(resolveDrawingViewImage('p',transport,state.pending[0],AbortSignal.timeout(1000)),/context_changed/)
 authorized=false;assert.equal(await resumed.validate(),false)
})
test('the final worker catalog retains drawing categories and exact operation schema',()=>{
 const catalog=catalogFixture(),result=applyCatalogModelOptions(catalog,{app:'bob',functionName:'drawing-worker',catalogVariables:{project_name:'Fixture'},tools:[catalog.tool('list_project_category',{categories:['images','drawing_views']})],catalogToolParameters:{list_project_category:{categories:['images','drawing_views'],include_manual:true}}})
 assert.deepEqual((result.tools![0].function.parameters as any).properties.category.enum,['images','drawing_views'])
})
test('drawing transport pins project/view/hash and rejects oversized or mismatched responses',async()=>{
 const png=render(savedSvgPage(svg,'front')).png;let body:any
 const transport=createDrawingViewTransport({} as any,{projectId:'p',url:'https://project.invalid',key:'public',authHeader:'Bearer member',fetcher:async(url,init)=>{assert.equal(url,'https://project.invalid/functions/v1/drawing-preview');body=JSON.parse(String(init!.body));return new Response(png,{headers:{'content-type':'image/png','x-drawing-source-sha256':hash,'x-drawing-view':'front','content-length':String(png.length)}})}})
 assert.deepEqual(await transport.raster(pin,AbortSignal.timeout(1000)),png);assert.deepEqual(body,pin)
 await assert.rejects(transport.raster({...pin,project_id:'foreign'},AbortSignal.timeout(1000)),/project_denied/)
 for(const headers of [{'content-length':String(SAVED_VIEW_PNG_MAX+1)},{'x-drawing-view':'top'},{'x-drawing-source-sha256':'0'.repeat(64)}]){
  const t=createDrawingViewTransport({} as any,{projectId:'p',url:'https://project.invalid',key:'public',authHeader:'Bearer member',fetcher:async()=>new Response(png,{headers:{'content-type':'image/png','x-drawing-source-sha256':hash,'x-drawing-view':'front',...headers}})})
  await assert.rejects(t.raster(pin,AbortSignal.timeout(1000)))
 }
})


test('Rita can list, open and consume a saved drawing sheet through the actual worker and catalog reconstruction',async()=>{
 const transport={list:async()=>({projectId:'p',total:1,records:[{id,revision:3,title:'Ladan',area_id:null,views:['front','front.sheet2'],source_state:'current',source_reasons:[]}]}),read:async(_id:string,_rev:number,view:string)=>({...row,view}),raster:async()=>render(savedSvgPage(svg,'front.sheet2')).png}
 const context=createProjectContext({adapters:[createDrawingViewAdapter('p',transport)],hasAccess:async()=>true,sources:[],imageEvidenceInstruction:'Saved drawing evidence'})
 const catalog=catalogFixture();let step=0
 const tool=(name:string,args:unknown)=>({success:true,model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},responseId:'r'+step,toolCalls:[{id:'t'+step,type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
 const result=await runWorker({aiCatalog:catalog,worker:{role:'drawing-worker',tool:'ask_drawing_worker',tools:['open_project_item'],reads:['list_project_category'],max_steps:4},userId:'owner',variables:{project_name:'Ladan'},job:{job:'Inspect the saved facade sheet',findings:null},history:[],deadline:Date.now()+60000,hasAccess:async()=>true,readKnowledge:async()=>({}),readCurrent:async()=>({}),session:{prepare:async()=>context.tools,execute:(name,args)=>context.execute(name,args)},images:context,
  callModel:catalogCall(async options=>{
   step++
   const categories=(options.tools!.find(t=>t.function.name==='list_project_category')!.function.parameters as any).properties.category.enum
   assert.deepEqual(categories,['drawing_views'],'the final provider catalog must retain the registered drawing adapter')
   if(step===1)return tool('list_project_category',{category:'drawing_views',query:null,area_id:null,after_id:null})
   if(step===2){assert(JSON.stringify(options.messages).includes('front.sheet2'));return tool('open_project_item',{refs:[drawingViewRef(id,3,'front.sheet2')]})}
   const carrier=options.messages!.filter(m=>Array.isArray(m.content)).flatMap(m=>m.content as any[]),image=carrier.find(p=>p.type==='image_url')
   assert(image?.image_url.startsWith('private-image:drawing:'))
   const pixels=await resolveDrawingViewImage('p',transport,context.exportState().pending[0],AbortSignal.timeout(1000));assert(pixels.startsWith('data:image/png;base64,'))
   return{success:true,model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},responseId:'r3',data:'Inspected the saved facade sheet.'}
  },catalog)})
 assert.equal(result.status,'ok');assert.equal(step,3);assert.equal(context.exportState().pending.length,0);assert.equal(context.exportState().delivered.length,1)
})

test('new stable visual pins survive own source/head changes with a metadata-only notice, while revocation and changed bytes still stop',async()=>{
 let current=3,state='current',authorized=true,source=hash
 const transport={list:async()=>({projectId:'p',total:0,records:[]}),read:async()=>authorized?{...row,current_revision:current,source_state:state,source_sha256:source}:null,raster:async()=>render(savedSvgPage(svg,'front')).png}
 const adapter=createDrawingViewAdapter('p',transport,true),make=()=>createProjectContext({adapters:[adapter],hasAccess:async()=>authorized,sources:[]})
 const c=make(),ref=drawingViewRef(id,3,'front');await c.execute('open_project_item',{refs:[ref]});c.confirmDelivery()
 current=4;state='changed';assert(await c.validate());const notice=c.carrier();assert.equal(notice[0].content.length,1);assert.equal(notice[0].content[0].type,'text');assert(JSON.stringify(notice).includes('pixels_unchanged'));assert.equal(JSON.parse((notice[0].content[0] as any).text).saved_view_metadata_changed[0].historical,true)
 const checkpoint=JSON.parse(JSON.stringify(c.exportState()));assert(!JSON.stringify(checkpoint).includes('data:image'));const resumed=make();resumed.restoreState(checkpoint);assert(await resumed.validate());assert(resumed.carrier().length);resumed.confirmDelivery();assert.deepEqual(resumed.carrier(),[])
 source='0'.repeat(64);assert.equal(await resumed.validate(),false);source=hash;authorized=false;assert.equal(await resumed.validate(),false)
})
