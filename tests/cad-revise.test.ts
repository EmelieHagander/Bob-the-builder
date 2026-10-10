import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyCadRevision} from '../supabase/functions/_shared/cad-revise.ts'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {shapeId,handoff,reviewReply} from './support/cad-review-fixture.ts'

const place={x:0,y:0,z:0,rx:0,ry:0,rz:0}
function base(){
 const recipe:any={contract_version:1,units:'mm',assembly_id:'shelf',definitions:[{id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:300,z_mm:900},{id:'board',primitive:'box',material_ref:null,x_mm:600,y_mm:300,z_mm:18}],
  instances:[{id:'left',definition_id:'side',placement:place},{id:'right',definition_id:'side',placement:{...place,x:618}},{id:'shelf1',definition_id:'board',placement:{...place,x:18,z:400}}],views:[...handoff.views]}
 return {recipe,parameter_plan:parameterPlan(recipe),dimension_bindings:[],title:'Shelf',description:'Synthetic',assumptions:'None',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[]}
}
const empty=()=>({definitions:[],instances:[],arrays:[],clearances:[],motions:[],nodes:[],bindings:[]})
const change=(c:any={})=>({upsert:{...empty(),...c.upsert},remove:{...empty(),...c.remove},views:null,title:null,description:null,assumptions:null,...c.top})

test('a change set touches only what it names and keeps everything else exactly',()=>{
 const last=base(),{args,dropped_nodes}=applyCadRevision(last,change({upsert:{nodes:[{id:'lift',role:'decision',value:450,unit:'mm',reason:'Raised shelf'}],bindings:[{path:'instances/shelf1/placement/z',node:'lift'}]}}))
 assert.equal(args.recipe.instances.length,3);assert.deepEqual(args.recipe.definitions,last.recipe.definitions)
 assert.equal(args.parameter_plan.bindings.find((b:any)=>b.path==='instances/shelf1/placement/z').node,'lift')
 assert.equal(args.parameter_plan.bindings.length,last.parameter_plan.bindings.length,'binding replaced by path, not duplicated')
 assert.equal(dropped_nodes.length,1,'the old z decision is no longer reachable');assert.notEqual(dropped_nodes[0],'lift')
 assert.equal(last.parameter_plan.nodes.length,args.parameter_plan.nodes.length,'the input is not mutated (one dropped, one added)')
 assert.equal(args.title,'Shelf')
})
test('removing an instance takes its bindings and orphaned nodes with it',()=>{
 const {args,dropped_nodes}=applyCadRevision(base(),change({remove:{instances:['shelf1']},top:{title:'Shelf without board'}}))
 assert.deepEqual(args.recipe.instances.map((i:any)=>i.id),['left','right'])
 assert(!args.parameter_plan.bindings.some((b:any)=>b.path.startsWith('instances/shelf1/')))
 assert.equal(dropped_nodes.length,6);assert.equal(args.title,'Shelf without board')
})
test('unknown ids, a missing base and malformed change sets are corrections, not silent no-ops',()=>{
 assert.throws(()=>applyCadRevision(base(),change({remove:{instances:['ghost']}})),/revision_unknown_ids:instances\/ghost/)
 assert.throws(()=>applyCadRevision(null,change()),/no_render_to_revise/)
 assert.throws(()=>applyCadRevision(base(),{upsert:{},remove:{}}),/invalid_revision/)
})
test('designer loop: second round sends only the change and renders the merged construction through the same checks',async()=>{
 let calls=0,renders=0,reviews=0,offered:string[]=[]
 const sent:number[]=[]
 const a=createCadAssistant({research:false,projectId:'A',userId:'u',available:true,deadline:Date.now()+200000,hasAccess:async()=>true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'90000000-0000-4000-8000-000000000001'}]:[],related:[],truncated:false},error:null}),1000,40),
  readArtifact:async()=>null,
  render:async r=>{renders++;return {recipe:r,manifest:{},files:{front:'fixture'},previews:Object.fromEntries(r.views.map(v=>[v,'Zml4dHVyZQ==']))}},
  callModel:async o=>{
   if(o.functionName==='cad-reviewer')return ++reviews===1?{...reviewReply(),data:JSON.stringify({verdict:'revise',summary:'Raise shelf to 450 mm',requirements:[{id:shapeId,status:'failed',evidence:'Shelf is at 400 mm'}],issues:[{severity:'error',code:'geometry',correction:'Raise shelf to 450 mm'}]})}:reviewReply()
   calls++
   const call=(name:string,args:unknown)=>{const text=JSON.stringify(args);sent.push(text.length);return {toolCalls:[{id:'c'+calls,type:'function' as const,function:{name,arguments:text}}]}}
   if(calls===2)offered=(o.tools??[]).map((t:any)=>t.function.name)
   return {success:true,data:null,responseId:'r'+calls,model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
    ...(calls===1?call('render_cad_candidate',base()):calls===2?call('revise_cad_candidate',change({upsert:{nodes:[{id:'lift',role:'decision',value:450,unit:'mm',reason:'Raised shelf'}],bindings:[{path:'instances/shelf1/placement/z',node:'lift'}]}})):{})}
  }} as any)
 const result:any=await a.consult({handoff,brief:'Draw a shelf',area_id:null,component_id:null,step_id:null,artifact_id:null})
 assert.equal(result.status,'ready');assert.equal(renders,2);assert.equal(calls,2);assert.equal(reviews,2);assert(offered.includes('revise_cad_candidate'))
 assert.equal(a.candidate!.packet.recipe.instances.find(i=>i.id==='shelf1')!.placement.z,450)
 assert.equal(a.candidate!.packet.manifest.bob_parameters.coverage,'complete')
 assert(sent[1]<sent[0]/3,`repair payload ${sent[1]} should be far smaller than the full render ${sent[0]}`)
})
