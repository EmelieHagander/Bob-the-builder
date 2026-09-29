import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from './support/cad-parameter-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {splitDimensionBindings,bindPhysicalDimensions} from '../supabase/functions/_shared/cad-physical-lineage.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'

const snapshotId='30000000-0000-4000-8000-000000000041'
const spaceId='30000000-0000-4000-8000-000000000042'
const buildingId='30000000-0000-4000-8000-000000000043'
const measureId='30000000-0000-4000-8000-000000000044'
const parentId='30000000-0000-4000-8000-000000000045'
const snapshot={id:snapshotId,space_id:spaceId,building_id:buildingId,space_revision:3,measurement_id:measureId,measurement_revision:2,
 subject:'Room width',value:'1.001',unit:'m',truth:'measured',source:'Accepted room snapshot; tape between marked walls'}
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'physical-fixture',
 definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:800,y_mm:300,z_mm:18}],
 instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const binding={definition_id:'panel',dimension:'x_mm',space_measurement_id:snapshotId,space_revision:3}
const request={request_id:null,brief:'Draw from the accepted room measurement, not a project copy.',handoff,area_id:null,component_id:null,step_id:null,artifact_id:null}
const response=(name?:string,args?:unknown)=>({success:true,data:null,responseId:'physical-test',model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
 ...(name?{toolCalls:[{id:'render',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]}:{})})
function fixture(options:{missing?:boolean;denied?:boolean;changed?:boolean;archived?:boolean;buildingArchived?:boolean;readError?:boolean;parent?:any;truth?:string}={}){
 let calls=0,renders=0,reviews=0;const reads:any[]=[],reviewInputs:any[]=[]
 const a=createCadAssistant({research:false,projectId:'destination',userId:'u',available:true,deadline:Date.now()+300000,hasAccess:async()=>true,
  makeLookup:()=>createProjectLookup('destination',async(_p,q)=>{
   reads.push(q)
   if(options.denied&&q.dataset==='physical_space_measurements')return {data:null,error:{code:'42501'}}
   if(options.readError&&q.dataset==='physical_space_measurements')return {data:null,error:{code:'backend_error'}}
   const records=q.dataset==='target'?[{id:'project',revision:1,solution_id:'solution'}]:
    q.dataset==='physical_buildings'?[{id:buildingId,revision:1,archived:!!options.buildingArchived}]:
    q.dataset==='physical_spaces'?[{id:spaceId,building_id:buildingId,revision:options.changed&&renders?4:3,archived:!!options.archived}]:
    q.dataset==='physical_space_measurements'&&!options.missing?[{...snapshot,truth:options.truth??snapshot.truth,...(options.changed&&renders?{space_revision:4}:{})}]:[]
   return {data:{records,related:[],truncated:false},error:null}
  },1000,40),
  readArtifact:async()=>options.parent??null,
  render:async r=>{renders++;return {recipe:r,manifest:{engine:{name:'build123d'}},files:{},previews:{front:'Zml4dHVyZQ==',top:'Zml4dHVyZQ=='}}},
  callModel:async o=>{
   if(o.functionName==='cad-reviewer'){reviews++;reviewInputs.push(o.messages);return reviewReply()}
   if(++calls===1){const metadata={title:'Room-bound panel',description:'Source lineage fixture',assumptions:'Concept only; no certification',target_revision:1,measurements:[]}
    return options.parent?response('render_saved_cad_candidate',{...metadata,source_artifact_id:parentId,source_revision:1,part_ids:['panel']}):
     response('render_cad_candidate',{...metadata,recipe,dimension_bindings:[binding]})
   }
   return response()
  }})
 return {a,reads,reviewInputs,get renders(){return renders},get reviews(){return reviews},get calls(){return calls}}
}

test('P1b: an accepted physical snapshot drives geometry without a project measurement copy',async()=>{
 const f=fixture(),result=await f.a.consult(request)
 assert.equal(result.status,'ready')
 assert.equal(f.renders,1);assert.equal(f.reviews,1)
 const c=f.a.candidate!,l=c.packet.manifest.bob_lineage
 assert.equal(c.packet.recipe.definitions[0].x_mm,1001)
 assert.deepEqual(c.measurements,[],'physical evidence is not repinned as a destination project measurement')
 assert.equal(l.version,2);assert.equal(l.coverage,'partial')
 assert.deepEqual(l.bindings[0].source,{kind:'space_measurement',id:snapshotId,building_id:buildingId,space_id:spaceId,space_revision:3,
  measurement_id:measureId,measurement_revision:2,value:'1.001',unit:'m',truth:'measured',description:snapshot.source})
 assert(JSON.stringify(f.reviewInputs).includes(snapshotId))
 assert(f.reads.some(q=>q.dataset==='physical_space_measurements'&&q.record_id===snapshotId))
 assert(!f.reads.some(q=>q.dataset==='measurements'&&q.record_id===measureId),'do not broaden access to the original project')
})

test('P1b: a saved detail keeps its physical source identity',async()=>{
 const f=fixture();assert.equal((await f.a.consult(request)).status,'ready')
 const parent=f.a.candidate!
 const detail=fixture({parent:{recipe:parent.packet.recipe,lineage:parent.packet.manifest.bob_lineage}})
 assert.equal((await detail.a.consult(request)).status,'ready')
 assert.deepEqual(detail.a.candidate!.packet.manifest.bob_lineage.bindings,parent.packet.manifest.bob_lineage.bindings)
 assert.deepEqual(detail.a.candidate!.measurements,[])
})

for(const kind of ['missing','denied','changed','archived'] as const)test(`P1b: physical source ${kind} cannot be approved`,async()=>{
 const f=fixture({[kind]:true})
 if(kind==='denied')await assert.rejects(f.a.consult(request),/project_denied/)
 else assert.notEqual((await f.a.consult(request)).status,'ready')
 assert.equal(f.a.candidate,null);assert.equal(f.reviews,0)
 if(kind==='changed')assert.equal(f.renders,1)
})

for(const truth of ['estimated','provided_spec'])test(`P1b: physical ${truth} retains its truth class`,async()=>{
 const f=fixture({truth});assert.equal((await f.a.consult(request)).status,'ready')
 assert.equal(f.a.candidate!.packet.manifest.bob_lineage.bindings[0].source.truth,truth)
})


test('P1b: two source kinds cannot claim the same geometric parameter',()=>{
 const projectBinding={definition_id:'panel',dimension:'x_mm',measurement_id:measureId,revision:2}
 assert.throws(()=>splitDimensionBindings([projectBinding,binding]),/duplicate_dimension_binding/)
 const l=buildCadLineage('destination',recipe,[],new Map(),handoff.coordinates)
 const r=structuredClone(recipe),records=new Map([[snapshotId,snapshot]])
 bindPhysicalDimensions(r,[binding],records,l)
 assert.throws(()=>bindPhysicalDimensions(r,[binding],records,l),/invalid_physical_binding/)
})

test('P1b: archived building blocks physical rendering rather than dropping that source',async()=>{
 const f=fixture({buildingArchived:true}),result=await f.a.consult(request)
 assert.equal(result.status,'needs_data');assert.equal(result.reason,'physical_sources_changed')
 assert.equal(f.renders,0);assert.equal(f.reviews,0);assert.equal(f.calls,1)
})

test('P1b: a physical retrieval failure remains technical and cannot restart unchanged',async()=>{
 const f=fixture({readError:true}),result=await f.a.consult(request)
 assert.equal(result.status,'unavailable');assert.equal(result.reason,'physical_sources_unavailable')
 assert.equal(result.stage,'source');assert.equal(f.renders,0);assert.equal(f.reviews,0)
 assert.deepEqual(await f.a.consult(request),result);assert.equal(f.calls,1)
})
