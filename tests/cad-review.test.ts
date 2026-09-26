import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant, type CadPacket} from '../supabase/functions/_shared/cad-assistant.ts'
import {parseDesignHandoff,parseCadReview,candidateFingerprint} from '../supabase/functions/_shared/cad-review.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
import {createProjectContext} from '../supabase/functions/_shared/project-context/dispatcher.ts'
const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const reply=(data:any)=>({success:true,data,model:'fixture',responseId:'designer-cursor',usage})
const call=(name:string,args:any)=>({...reply(null),toolCalls:[{id:'c',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'concept',definitions:[{id:'panel',primitive:'box' as const,x_mm:600,y_mm:300,z_mm:18,material_ref:null}],instances:[{id:'panel-1',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const design={recipe,title:'Concept',description:'Requested concept',assumptions:'Physical fit unresolved',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[]}
const request={brief:'Use the reference.',handoff:{...handoff,coordinates:{origin:'entry corner',positive_x:'east',positive_y:'north',positive_z:'up'}},area_id:null,component_id:null,step_id:null,artifact_id:null}
function fixture(){let renderCount=0,designerCalls=0,reviewCalls=0
 const seen:any[]=[]
 const opts={ownerRequest:'The window faces east. Put access on the reference side.',projectId:'A',userId:'u',deadline:Date.now()+300000,available:true,hasAccess:async()=>true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'solution'}]:[],related:[],truncated:false},error:null}),1000,40),
  render:async(r:typeof recipe):Promise<CadPacket>=>{renderCount++;return {recipe:r,manifest:{engine:{name:'build123d'},instances:r.instances},files:{front:'exact-svg'},previews:Object.fromEntries(r.views.map(view=>[view,`render-${renderCount}-${view}`]))}},
  readArtifact:async()=>null,
  callModel:async(o:any)=>{seen.push(o);if(o.functionName==='cad-reviewer'){reviewCalls++;return reviewReply()}
   return ++designerCalls===1?call('render_cad_candidate',design):reply('Ready')},
 }
 return {opts,seen,get renders(){return renderCount},get reviewCalls(){return reviewCalls}}
}
test('original request and structured directions reach a separate, tool-free reviewer with exact generated pixels',async()=>{
 const f=fixture(),a=createCadAssistant(f.opts)
 assert.equal((await a.consult(request)).status,'ready')
 const review=f.seen.find(o=>o.functionName==='cad-reviewer')
 assert.equal(review.previousResponseId,undefined);assert.equal(review.tools,undefined)
 const data=JSON.parse(review.messages[0].content)
 assert.equal(data.owner_request,f.opts.ownerRequest);assert.equal(data.handoff.coordinates.positive_x,'east')
 assert.deepEqual(data.candidate.recipe,recipe)
 assert(JSON.stringify(review.messages).includes('render-1-front'))
 assert.equal(a.quality!.fingerprint,await candidateFingerprint(a.candidate!))
 assert.equal(a.metrics.review_passed,true)
})
test('review rejection returns concrete feedback to the designer and requires a new reviewed candidate',async()=>{
 const f=fixture();let designers=0,reviews=0
 f.opts.callModel=async o=>{
  if(o.functionName==='cad-reviewer'){
   if(++reviews===1)return reply(JSON.stringify({verdict:'pass',summary:'Wrong side',requirements:[{id:'shape',status:'failed',evidence:'Wrong reference side'}],issues:[{severity:'error',code:'orientation',correction:'Move access to the negative X side'}]}))
   assert.equal(JSON.parse(o.messages[0].content).candidate.recipe.instances[0].placement.x,-600)
   return reviewReply()
  }
  designers++
  if(designers===1)return call('render_cad_candidate',design)
  if(designers===3){assert(JSON.stringify(o.messages).includes('negative X'));assert.equal(o.tool_choice,'required');return call('render_cad_candidate',{...design,recipe:{...recipe,instances:[{...recipe.instances[0],placement:{...recipe.instances[0].placement,x:-600}}]}})}
  return reply('Ready')
 }
 const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).status,'ready');assert.equal(f.renders,2);assert.equal(a.metrics.review_rejections,1)
 assert.equal(a.candidate!.packet.recipe.instances[0].placement.x,-600)
})
test('missing previews, unavailable/malformed review and omitted requirements cannot expose a savable candidate',async()=>{
 for(const failure of ['pixels','provider','coverage']){
  const f=fixture(),model=f.opts.callModel
  if(failure==='pixels')f.opts.render=async r=>({recipe:r,manifest:{},files:{}})
  f.opts.callModel=async o=>o.functionName!=='cad-reviewer'?model(o):failure==='provider'?{...reply(null),success:false}:reply(JSON.stringify({verdict:'pass',summary:'Fine',requirements:[],issues:[]}))
  const a=createCadAssistant(f.opts),result=await a.consult(request)
  assert.equal(result.status,'unavailable');assert.equal(result.stage,'review');assert.equal(a.candidate,null);assert.equal(a.quality,null)
 }
})
test('requested view omissions override a permissive model review and bounded repairs cannot certify the old candidate',async()=>{
 const f=fixture(),model=f.opts.callModel
 f.opts.callModel=async o=>o.functionName==='cad-reviewer'?reviewReply():o.messages?.some((m:any)=>m.role==='system'&&String(m.content).includes('Independent review'))?call('render_cad_candidate',design):model(o)
 const a=createCadAssistant(f.opts),result=await a.consult({...request,handoff:{...request.handoff,views:['front','top','isometric']}})
 assert.equal(result.status,'incomplete');assert.equal(a.candidate,null);assert.equal(a.metrics.review_rejections,3)
})
test('handoff rejects unknown shape, duplicate requirement identities and fabricated coordinate types',()=>{
 assert(parseDesignHandoff(handoff));assert.equal(parseDesignHandoff({...handoff,requirements:[handoff.requirements[0],handoff.requirements[0]]}),null)
 assert.equal(parseDesignHandoff({...handoff,coordinates:{...handoff.coordinates,positive_x:42}}),null)
 assert.equal(parseCadReview({verdict:'pass',summary:'fine',requirements:[],issues:[]},handoff),null)
})
test('review gets original reference pixels and revocation during review prevents saving',async()=>{
 const f=fixture();let valid=true,sawReference=false
 const source={projectId:'A',dataset:'image_pixels',recordId:'ref',label:'Reference',retrievedAt:'now',truth:'unknown' as const}
 const images=createProjectContext({hasAccess:f.opts.hasAccess,sources:[],adapters:[{category:'images',prefix:'image',count:async()=>1,list:async()=>({items:[],next_cursor:null}),open:async()=>({item:{ref:'image:ref',title:'Reference'},image:{type:'image_url',image_url:'data:image/png;base64,original-reference'},source,version:'v1',bytes:1}),current:async()=>valid}]})
 const model=f.opts.callModel
 f.opts.callModel=async o=>{if(o.functionName==='cad-reviewer'){sawReference=JSON.stringify(o.messages).includes('original-reference');valid=false}return model(o)}
 const a=createCadAssistant({...f.opts,context:images,referenceImageRefs:()=>['image:ref']})
 await assert.rejects(a.consult(request),/project_denied/);assert(sawReference);assert.equal(a.candidate,null)
})
