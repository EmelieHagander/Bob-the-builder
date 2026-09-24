import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from '../supabase/functions/_shared/cad-assistant.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import type {CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'
const id='30000000-0000-4000-8000-000000000001'
const recipe:CadAssemblyRequest={contract_version:1,units:'mm',assembly_id:'bed',definitions:[{id:'post',primitive:'box',material_ref:null,x_mm:45,y_mm:70,z_mm:1800},{id:'panel',primitive:'box',material_ref:null,x_mm:800,y_mm:600,z_mm:18}],instances:[{id:'bed.post',definition_id:'post',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}},{id:'drawer.base',definition_id:'panel',placement:{x:100,y:0,z:30,rx:0,ry:0,rz:0}}],views:['front','top']}
const request={brief:'Rita lådorna och behåll deras mått.',area_id:null,component_id:null,step_id:null,artifact_id:null}
const candidate={recipe,source_artifact_id:null,source_revision:null,part_ids:[],title:'Lådor',description:'Under sängen',assumptions:'Design specifications; fit to be checked',target_revision:1,measurements:[]}
const response=(name?:string,args?:unknown)=>({success:true,data:name?null:'Ritningen är klar.',model:'fixture',responseId:'resp',usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(name?{toolCalls:[{id:'call',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]}:{})})
function fixture(){let calls=0;const seen:any[]=[];let allowed=true
 const opts={projectId:'A',userId:'u',hasAccess:async()=>allowed,deadline:Date.now()+200000,available:true,
  makeLookup:()=>createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null}),1000,40),
  callModel:async(o:any)=>{seen.push(o);return calls++===0?response('render_cad_candidate',candidate):response()},
  render:async(r:CadAssemblyRequest)=>({recipe:r,manifest:{bounding_box_mm:{size:[800,600,1800]},instances:r.instances},files:{front:'Zml4dHVyZQ=='}}),
  readArtifact:async()=>({revision:2,recipe:structuredClone(recipe)})}
 return {opts,seen,deny:()=>{allowed=false}}
}
test('CAD assistant has an independent model config, own tools and multi-call loop',async()=>{const f=fixture();const a=createCadAssistant(f.opts);const result=await a.consult(request);assert.equal(result.status,'ready');assert(a.candidate);assert.equal(f.seen.length,2);assert.equal(f.seen[0].functionName,'cad-designer');assert(f.seen[0].tools.some((t:any)=>t.function.name==='render_cad_candidate'));assert.equal(f.seen[1].messages[0].role,'tool');assert.equal(f.seen[1].previousResponseId,'resp');assert.equal(result.saved,false)})
test('detail selection reuses exact source dimensions and placements instead of rebuilding them',async()=>{const f=fixture();let n=0;f.opts.callModel=async()=>n++===0?response('render_cad_candidate',{...candidate,recipe:null,source_artifact_id:id,source_revision:2,part_ids:['drawer.base']}):response();const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).status,'ready');assert.deepEqual(a.candidate!.packet.recipe.instances,[recipe.instances[1]]);assert.deepEqual(a.candidate!.packet.recipe.definitions,[recipe.definitions[1]]);assert.equal(a.candidate!.source_revision,2)})
test('a failed repair invalidates the old candidate; failure cannot save stale success',async()=>{const f=fixture();let n=0;f.opts.callModel=async()=>++n===1?response('render_cad_candidate',candidate):n===2?response('render_cad_candidate',{...candidate,recipe:{...recipe,python:'not allowed'}}):response();const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).status,'incomplete');assert.equal(a.candidate,null)})
test('missing infrastructure is explicit and makes no provider call',async()=>{const f=fixture();f.opts.available=false;const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).stage,'cad_engine');assert.equal(f.seen.length,0);assert.equal(a.candidate,null)})
test('access revocation prevents generation and has no candidate',async()=>{const f=fixture();f.deny();const a=createCadAssistant(f.opts);await assert.rejects(a.consult(request),/project_denied/);assert.equal(f.seen.length,0);assert.equal(a.candidate,null)})
test('stale measurement references block rendering and can be corrected in another call',async()=>{const f=fixture();let n=0,renders=0;f.opts.callModel=async()=>n++===0?response('render_cad_candidate',{...candidate,measurements:[{id,revision:1}]}):response();f.opts.render=async r=>{renders++;return {recipe:r,manifest:{},files:{}}};const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).status,'incomplete');assert.equal(renders,0)})


test('CAD restart restores the rendered candidate without rendering or asking the model twice',async()=>{
 const f=fixture(),entries:JournalEntry[]=[];let now=0,renders=0
 const run=()=>{
  const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},20000,()=>now)
  return createCadAssistant({...f.opts,
   callModel:o=>journal.run('model:cad',o,()=>f.opts.callModel(o),10000),
   render:r=>journal.run('cad:render',r,async()=>{renders++;const packet=await f.opts.render(r);now=15000;return packet}),
  })
 }
 await assert.rejects(run().consult(structuredClone(request)),e=>e instanceof BobContinuation&&e.kind==='yield')
 assert.equal(renders,1);assert.equal(f.seen.length,1)
 now=0
 const resumed=run()
 assert.equal((await resumed.consult(structuredClone(request))).status,'ready')
 assert.deepEqual(resumed.candidate!.packet.recipe,recipe)
 assert.equal(renders,1);assert.equal(f.seen.length,2)
})
