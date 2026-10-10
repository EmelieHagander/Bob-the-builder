import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from '../supabase/functions/_shared/cad-assistant.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {catalogFixture,catalogCall} from './support/ai-catalog-fixture.ts'
import {fixtureDesignReadiness,createProjectContext} from './support/colleague-catalog-fixture.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {shapeId,handoff} from './support/cad-review-fixture.ts'
import type {DesignReadiness} from '../supabase/functions/_shared/project-design-intent.ts'

const solution='44444444-4444-4444-8444-444444444444'
const artifact='11111111-1111-4111-8111-111111111111'
const image='33333333-3333-4333-8333-333333333333'
const recipe:any={contract_version:1,units:'mm',assembly_id:'generic_fixture',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:600,y_mm:300,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
const request={request_id:null,brief:'Draw the discussed object',handoff,area_id:null,component_id:null,step_id:null,artifact_id:null}
const reply=(data:unknown)=>({success:true,data,model:'fixture',responseId:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2}})
const renderReply=()=>({...reply(null),toolCalls:[{id:'render',type:'function' as const,function:{name:'render_cad_candidate',arguments:JSON.stringify({purpose:'project',recipe,parameter_plan:parameterPlan(recipe),dimension_bindings:[],title:'Discussed object',description:'A scoped concept',assumptions:'Physical fit still needs verification',target_revision:1,measurements:[]})}}]})
function fixture(){
 const catalog=catalogFixture(),seen:any[]=[]
 let readiness=fixtureDesignReadiness('A',solution),renders=0
 const model=async(o:any)=>{
  seen.push(o)
  if(o.functionName==='cad-reviewer')return reply(JSON.stringify({verdict:'pass',summary:'Reviewed exact concept',requirements:Object.fromEntries(o.catalogSchemaParameters.requirement_ids.map((id:string)=>[id,{status:'met',evidence:'Exact recipe and generated views'}])),issues:[]}))
  return renderReply()
 }
 const opts={aiCatalog:catalog,projectId:'A',userId:'owner',ownerRequest:'Draw the discussed object',research:false,available:true,deadline:Date.now()+300000,hasAccess:async()=>true,
  makeLookup:()=>createProjectLookup('A',async(_project,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:solution,solution_revision:1}]:[],related:[],truncated:false},error:null}),1000,40),
  readDesignReadiness:async()=>structuredClone(readiness),readArtifact:async()=>null,
  callModel:async(o:any,guard?:()=>Promise<void>)=>{await guard?.();return catalogCall(model,catalog)(o)},
  render:async(r:any,_source?:unknown,guard?:()=>Promise<void>)=>{await guard?.();renders++;return {recipe:r,manifest:{instances:r.instances},files:{front:'fixture'},previews:Object.fromEntries(r.views.map((v:string)=>[v,'fixture-pixels']))}},
 }
 return {opts,seen,model,get readiness(){return readiness},setReadiness:(value:DesignReadiness)=>{readiness=value},get renders(){return renders}}
}
test('missing or unready canonical intent prevents CAD paid work, including an already checked construction',async()=>{
 for(const mode of ['missing','open','construction']){
  const f=fixture()
  let calls=0,purpose:string|null=null
  const unready={...f.readiness,status:'needs_data' as const,pin:null,issues:[{code:'choice_open',choice_id:'support',message:'Investigate and recommend a support solution before geometry'}]}
  const assistant=createCadAssistant({...f.opts,
   readDesignReadiness:mode==='missing'?undefined:async(_revision,p)=>{purpose=p;return unready},
   readArtifact:async()=>mode==='construction'?{source_kind:'construction',artifact_id:artifact,revision:1,recipe,target_revision:1}:null,
   checkConstruction:async()=>{throw Error('readiness precedes construction dispatch')},
   callModel:async()=>{calls++;throw Error('unready intent must precede paid work')},
  })
  const result=await assistant.consult({...request,artifact_id:mode==='construction'?artifact:null})
  assert.equal(result.stage,'design_readiness');assert.equal(result.saved,false);assert.equal(calls,0);assert.equal(f.renders,0)
  assert.equal(assistant.candidate,null)
  if(mode==='construction')assert.equal(purpose,'construction')
 }
})
test('designer and independent reviewer receive the same selected intent pin and every required feature',async()=>{
 const f=fixture()
 f.readiness.design_intent!.features.push({id:'storage',description:'Preserve the discussed integral storage module',basis:'user_request',source_ref:null})
 const a=createCadAssistant(f.opts)
 assert.equal((await a.consult(request)).status,'ready')
 assert.deepEqual(f.seen.map(o=>o.functionName),['cad-designer','cad-reviewer'])
 const contexts=f.seen.map(o=>JSON.parse(o.messages.find((m:any)=>typeof m.content==='string'&&JSON.parse(m.content).design_readiness)?.content))
 for(const context of contexts){assert.deepEqual(context.design_readiness.pin,f.readiness.pin);assert(context.handoff.requirements.some((r:any)=>r.id==='intent_storage'))}
 assert.deepEqual(a.candidate?.packet.manifest.bob_design_intent,f.readiness.pin)
 assert.deepEqual(a.candidate?.packet.manifest.bob_design_images,[])
})
test('an Area without its own target can inherit the Project design intent while retaining the requested drawing scope',async()=>{
 const f=fixture(),area='a_fixture',requestedAreas:(string|null|undefined)[]=[],reads:(string|null)[]=[]
 f.readiness.area_id=area
 assert.equal(f.readiness.pin?.area_id,null,'the canonical pin belongs to the effective Project target')
 const a=createCadAssistant({...f.opts,
  makeLookup:()=>createProjectLookup('A',async(_project,q)=>{
   reads.push(q.area_id)
   return {data:{records:q.dataset==='target'&&q.area_id===null?[{id:'project',revision:1,solution_id:solution,solution_revision:1}]:[],related:[],truncated:false},error:null}
  },1000,40),
  readDesignReadiness:async(_revision,_purpose,requestedArea)=>{requestedAreas.push(requestedArea);return structuredClone(f.readiness)},
 })
 assert.equal((await a.consult({...request,area_id:area})).status,'ready')
 assert.deepEqual(reads.slice(0,2),[area,null])
 assert(requestedAreas.length>1&&requestedAreas.every(value=>value===area),'initial and actual dispatch reads stay bound to the requested Area')
 assert.equal(a.candidate?.area_id,area)
 assert.equal(a.candidate?.packet.manifest.bob_design_intent.area_id,null)
})
test('readiness for another exact Area cannot authorize the requested Area even when the solution is identical',async()=>{
 const f=fixture(),wrong=fixtureDesignReadiness('A',solution,1,'a_other')
 const a=createCadAssistant({...f.opts,readDesignReadiness:async()=>wrong,callModel:async()=>{throw Error('wrong Area precedes paid work')}})
 const result=await a.consult({...request,area_id:'a_fixture'})
 assert.equal(result.stage,'design_readiness');assert.equal(result.reason,'design_intent_changed')
 assert.equal(f.renders,0);assert.equal(a.candidate,null)
})
test('an unresolved canonical feature overrides a permissive reviewer and cannot expose a saved candidate',async()=>{
 const f=fixture();f.readiness.design_intent!.features.push({id:'storage',description:'Include integral storage',basis:'user_request',source_ref:null})
 const model=f.opts.callModel
 const a=createCadAssistant({...f.opts,callModel:async(o:any,guard)=>{
  if(o.functionName!=='cad-reviewer')return model(o,guard)
  await guard?.()
  return reply(JSON.stringify({verdict:'pass',summary:'Simplified concept',requirements:{[shapeId]:{status:'met',evidence:'Base form'},intent_storage:{status:'unresolved',evidence:'Storage was omitted from simplification'}},issues:[]}))
 }})
 const result=await a.consult(request)
 assert.equal(result.status,'incomplete');assert.equal(result.reason,'no_progress');assert.equal(f.renders,1)
 assert.equal(a.candidate,null);assert.equal(a.quality,null)
})
test('selected reference images are opened automatically and their exact versions accompany the reviewed geometry',async()=>{
 const f=fixture();f.readiness.design_intent!.features.push({id:'shape',description:'Retain the selected visible silhouette',basis:'user_request',source_ref:null})
 f.readiness.design_intent!.references.push({image_id:image,role:'appearance',note:'The selected appearance reference'})
 const context=createProjectContext({hasAccess:async()=>true,sources:[],adapters:[{category:'images',prefix:'image',count:async()=>1,list:async()=>({items:[],next_cursor:null}),open:async()=>({item:{ref:'image:'+image,title:'Selected reference'},image:{type:'image_url',image_url:'data:image/png;base64,selected-original'},source:{projectId:'A',dataset:'image_pixels',recordId:image,label:'Selected reference',retrievedAt:'fixture',truth:'unknown' as const},version:'selected-v1',bytes:1}),current:async()=>true}]})
 const a=createCadAssistant({...f.opts,context})
 assert.equal((await a.consult(request)).status,'ready')
 assert(f.seen.every(o=>JSON.stringify(o.messages).includes('selected-original')))
 assert.deepEqual(a.candidate?.packet.manifest.bob_design_images,[{image_id:image,source_version:'selected-v1'}])
})
test('an actual new render dispatch rechecks intent and stops before rendering a changed selected solution',async()=>{
 const f=fixture(),model=f.opts.callModel
 let stale=false,freshReads=0
 const a=createCadAssistant({...f.opts,
  readDesignReadiness:async(_revision,_purpose,_area,fresh)=>{if(fresh)freshReads++;return stale?{...f.readiness,status:'conflict',pin:null,issues:[{code:'target_changed',choice_id:null,message:'Reload the selected Solution'}]}:structuredClone(f.readiness)},
  callModel:async(o,guard)=>{const result=await model(o,guard);stale=true;return result},
 })
 const result=await a.consult(request)
 assert.equal(result.stage,'design_readiness');assert.equal(result.reason,'design_readiness_changed')
 assert.equal(f.renders,0);assert.equal(a.candidate,null);assert(freshReads>=2)
})
test('an unavailable selected original reference stops before collector, designer or reviewer work',async()=>{
 const f=fixture();f.readiness.design_intent!.features.push({id:'shape',description:'Selected silhouette',basis:'user_request',source_ref:null})
 f.readiness.design_intent!.references.push({image_id:image,role:'appearance',note:'Selected original'})
 const a=createCadAssistant({...f.opts,research:true,callModel:async()=>{throw Error('missing pixels precede paid work')}})
 const result=await a.consult(request)
 assert.equal(result.status,'unavailable');assert.equal(result.stage,'reference_images');assert.equal(f.renders,0)
})
test('authority loss inside the actual new render dispatch stays denied rather than becoming a renderer failure',async()=>{
 const f=fixture(),model=f.opts.callModel
 let allowed=true
 const a=createCadAssistant({...f.opts,hasAccess:async()=>allowed,callModel:async(o,guard)=>{const result=await model(o,guard);allowed=false;return result}})
 await assert.rejects(a.consult(request),/project_denied/)
 assert.equal(f.renders,0);assert.equal(a.candidate,null)
})
test('explicit bounded illustration deferral remains available while construction requires resolved choices',async()=>{
 const f=fixture(),readiness=fixtureDesignReadiness('A',solution,1,null,'illustration')
 readiness.design_intent!.choices.push({id:'support',question:'Which support construction?',alternatives:[],recommendation:'',basis:'',consequences:'',geometry_dependency:true,status:'deferred',selected_direction:null,decision_authority:'bob',decision_basis:'',deferral:{scope:'illustration',reason:'This output explores external proportions only'}})
 readiness.deferred_choice_ids=['support'];f.setReadiness(readiness)
 const a=createCadAssistant(f.opts)
 assert.equal((await a.consult(request)).status,'ready')
 assert.equal(a.candidate?.packet.manifest.bob_design_intent.purpose,'illustration')
 assert(f.seen.every(o=>JSON.stringify(o.messages).includes('external proportions only')))
})
