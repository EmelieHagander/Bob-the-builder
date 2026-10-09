import {createProjectContext} from './support/colleague-catalog-fixture.ts'
import {createMediaAdapter,type MediaRow} from '../supabase/functions/_shared/project-context/media.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
const id='90000000-0000-4000-8000-000000000001'
const source={id,project_id:'A',revision:1,value:'2',unit:'m',truth:'measured',source:'Marked endpoints',archived:false}
const request={handoff,brief:'Place the panel from the measured datum.',area_id:null,component_id:null,step_id:null,artifact_id:null}
function fixture(mode='new'){
 const recipe:any={contract_version:1,units:'mm',assembly_id:'panel',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:600,y_mm:300,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
 const plan=parameterPlan(recipe),binding=plan.bindings.find(b=>b.path==='instances/panel/placement/x')!
 plan.nodes=plan.nodes.filter(n=>n.id!==binding.node)
 plan.nodes.push({id:'datum',role:'source',source:{kind:'project_measurement',id,revision:1}},{id:'clearance',role:'decision',value:20,unit:'mm',reason:'Chosen clearance'}, {id:binding.node,role:'derived',operation:'subtract_v1',operands:['datum','clearance'],rounding:'exact'})
 const imageId='90000000-0000-4000-8000-000000000002'
 const row:MediaRow={id:imageId,project_id:'A',title:'Owner reference',purpose:'reference',source_kind:'user_upload',state:'ready',content_type:'image/png',byte_size:8,width:2,height:2,bucket_id:'bob-project-media',object_path:'A/'+imageId,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',media_links:[]}
 const version=JSON.stringify([row.updated_at,row.content_type,row.byte_size,row.width,row.height,row.title,row.purpose,row.source_kind,[]])
 const context=createProjectContext({hasAccess:async()=>true,sources:[],adapters:[createMediaAdapter('A',{count:async()=>1,list:async()=>[row],read:async()=>mode==='saved-image-changed'?{...row,title:'Changed direction'}:row,download:async()=>Uint8Array.from([137,80,78,71,13,10,26,10])})]})
 if(mode.startsWith('saved-image'))plan.frames=[{id:'photo',kind:'image',source_ref:'image:'+imageId,required:true,reason:'Explicit owner reference mapping',placement:Object.fromEntries(['x','y','z','rx','ry','rz'].map(k=>[k,plan.bindings.find(b=>b.path==='instances/panel/placement/'+k)!.node])) as any}]
 if(mode==='saved-image')plan.frames.push({...plan.frames[0],id:'photo-detail'})
 let renders=0,reviews=0,calls=0
 const packet=compileCadParameters('A',structuredClone(recipe),plan,new Map([[id,source]]),new Map(),new Map([['image:'+imageId,version]]))
 const savedRecipe=structuredClone(recipe);savedRecipe.instances[0].placement.x=1980
 const a=createCadAssistant({research:false,context,projectId:'A',userId:'u',available:true,deadline:Date.now()+200000,hasAccess:async()=>true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:id}]:q.dataset==='measurements'?[{...source,revision:mode==='changed'&&renders?2:1}]:[],related:[],truncated:mode==='truncated'&&q.dataset==='measurements'},error:null}),1000,40),
  readArtifact:async()=>({recipe:savedRecipe,parameters:packet,parameter_state:'complete'}),
  render:async r=>{renders++;return {recipe:r,manifest:{bob_parameters:{forged:true}},files:{front:'fixture'},previews:{front:'fixture',top:'fixture'}}},
  callModel:async o=>{
   if(o.functionName==='cad-reviewer'){reviews++;if(mode==='saved-image'){assert(JSON.stringify(o.messages).includes('image:'+imageId));assert(JSON.stringify(o.messages).includes('data:image/png;base64,iVBORw0KGgo='),'Exact saved frame pixels reach reviewer')}assert(JSON.parse(o.messages![0].content as string).candidate.manifest.bob_parameters.nodes.some((n:any)=>n.role==='derived'));return reviewReply()}
   calls++
   const args:any={recipe,parameter_plan:plan,dimension_bindings:[],title:'Panel',description:'Synthetic',assumptions:'Site fit not certified',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[]}
   if(mode==='missing')delete args.parameter_plan
   if(mode==='unknown')plan.nodes[0]={id:plan.nodes[0].id,role:'unknown',unit:'mm',reason:'Panel width unavailable'}
   if(mode.startsWith('saved')){delete args.recipe;delete args.parameter_plan;args.source_artifact_id=id;args.source_revision=1;args.part_ids=['panel']}
   return {success:true,data:null,responseId:'reply',model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(calls===1?{toolCalls:[{id:'call',type:'function' as const,function:{name:mode.startsWith('saved')?'render_saved_cad_candidate':'render_cad_candidate',arguments:JSON.stringify(args)}}]}:{})}
  }})
 return {a,get renders(){return renders},get reviews(){return reviews}}
}
for(const mode of ['new','saved','saved-image'])test('P1 production '+mode+' path computes placement, pins source and reviews server-owned graph',async()=>{
 const f=fixture(mode);assert.equal((await f.a.consult(request)).status,'ready')
 assert.equal(f.a.candidate!.packet.recipe.instances[0].placement.x,1980)
 assert.deepEqual(f.a.candidate!.measurements,[{id,revision:1}]);assert.equal(f.reviews,1)
 assert.equal(f.a.candidate!.packet.manifest.bob_parameters.coverage,'complete')
})
for(const [mode,status,renders] of [['missing','incomplete',0],['unknown','needs_data',0],['truncated','unavailable',0],['changed','needs_data',1],['saved-image-changed','needs_data',0]] as const)test('P1 production rejects '+mode+' parameters without saveable candidate',async()=>{
 const f=fixture(mode),result=await f.a.consult(request)
 assert.equal(result.status,status);assert.equal(f.renders,renders);assert.equal(f.reviews,0);assert.equal(f.a.candidate,null)
 if(status!=='incomplete'){assert.deepEqual(await f.a.consult(request),result);assert.equal(f.renders,renders)}
})
