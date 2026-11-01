import {test} from 'node:test'
import assert from 'node:assert/strict'
import {expandCadArrays} from '../supabase/functions/_shared/cad-arrays.ts'
import {CadParameterBindingGap,CadReservedParameter,ZERO_NODE_IDS,compileCadParameters,inheritCadParameters,withZeroDefaults,zeroDefaults,type ParameterPlan} from '../supabase/functions/_shared/cad-parameters.ts'
import {compileConstructionParameterChange} from '../supabase/functions/_shared/construction-parameters.ts'
import {parseCadAssemblyRequest,type CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'

// Owner decision 2026-11-01: a position or rotation stated as 0 needs no
// binding of its own; code binds it to one fixed zero node with a reason.
const at=(x:number,y=0,z=0)=>({x,y,z,rx:0,ry:0,rz:0})
function box(){
 const recipe={contract_version:1,units:'mm',assembly_id:'box',views:['front'],
  definitions:[{id:'side',primitive:'box',material_ref:null,x_mm:12,y_mm:300,z_mm:250},{id:'bottom',primitive:'box',material_ref:null,x_mm:376,y_mm:300,z_mm:12}],
  instances:[{id:'left',definition_id:'side',placement:at(0)},{id:'right',definition_id:'side',placement:at(388)},{id:'floor',definition_id:'bottom',placement:at(12)}]}
 const plan:ParameterPlan={version:1,frames:[],nodes:[
  {id:'t',role:'decision',value:12,unit:'mm',reason:'Board thickness'},{id:'w',role:'decision',value:400,unit:'mm',reason:'Outer width'},
  {id:'d',role:'decision',value:300,unit:'mm',reason:'Depth'},{id:'h',role:'decision',value:250,unit:'mm',reason:'Height'},
  {id:'right_x',role:'derived',operation:'subtract_v1',operands:['w','t'],rounding:'exact'},
  {id:'two',role:'decision',value:2,unit:'scalar',reason:'Two boards'},{id:'tt',role:'derived',operation:'multiply_v1',operands:['t','two'],rounding:'exact'},
  {id:'inner',role:'derived',operation:'subtract_v1',operands:['w','tt'],rounding:'exact'},
 ],bindings:[
  {path:'definitions/side/x_mm',node:'t'},{path:'definitions/side/y_mm',node:'d'},{path:'definitions/side/z_mm',node:'h'},
  {path:'definitions/bottom/x_mm',node:'inner'},{path:'definitions/bottom/y_mm',node:'d'},{path:'definitions/bottom/z_mm',node:'t'},
  {path:'instances/right/placement/x',node:'right_x'},{path:'instances/floor/placement/x',node:'t'},
 ]}
 return {recipe:parseCadAssemblyRequest(recipe) as CadAssemblyRequest,plan}
}

test('without the default every zero still needs its own binding',()=>{
 const {recipe,plan}=box()
 assert.throws(()=>compileCadParameters('p',recipe,plan,new Map(),new Map()),(e:unknown)=>e instanceof CadParameterBindingGap&&e.unbound.length===16)
})

test('zero positions and rotations bind to two code nodes; the saved graph stays complete and reads back',()=>{
 const {recipe,plan}=box(),filled=withZeroDefaults(recipe,plan)
 assert.equal(filled.bindings.length,plan.bindings.length+16)
 assert.deepEqual(filled.nodes.slice(-2).map(n=>n.id),[ZERO_NODE_IDS.mm,ZERO_NODE_IDS.deg])
 const saved=compileCadParameters('p',recipe,filled,new Map(),new Map())
 assert.equal(saved.coverage,'complete')
 assert.ok(saved.nodes.filter(n=>n.id.startsWith('origin.')).every(n=>n.role==='decision'&&n.value===0&&n.reason.startsWith('Code default')))
 assert.deepEqual(inheritCadParameters('p',recipe,saved,structuredClone(recipe)),saved)
})

test('non-zero positions and dimensions are never defaulted',()=>{
 const {recipe,plan}=box()
 const missing={...plan,bindings:plan.bindings.filter(b=>b.path!=='instances/right/placement/x'&&b.path!=='definitions/side/z_mm')}
 assert.throws(()=>compileCadParameters('p',recipe,withZeroDefaults(recipe,missing),new Map(),new Map()),
  (e:unknown)=>e instanceof CadParameterBindingGap&&JSON.stringify(e.unbound)===JSON.stringify(['definitions/side/z_mm','instances/right/placement/x']))
})

test('an explicit binding wins over the default',()=>{
 const {recipe,plan}=box()
 plan.nodes.push({id:'flat',role:'decision',value:0,unit:'deg',reason:'Lies flat'})
 plan.bindings.push({path:'instances/floor/placement/rz',node:'flat'})
 const filled=withZeroDefaults(recipe,plan)
 assert.equal(filled.bindings.filter(b=>b.path==='instances/floor/placement/rz').map(b=>b.node).join(),'flat')
})

test('a model node with a reserved ID is rejected; the exact code node is reused',()=>{
 const {recipe,plan}=box()
 assert.throws(()=>withZeroDefaults(recipe,{...plan,nodes:[...plan.nodes,{id:ZERO_NODE_IDS.mm,role:'decision',value:5,unit:'mm',reason:'Mine'}]}),CadReservedParameter)
 const once=withZeroDefaults(recipe,plan),again=withZeroDefaults(recipe,once)
 assert.deepEqual(again,once)
})

test('a code zero node no binding uses any more is dropped instead of failing as unused',()=>{
 const {recipe,plan}=box(),filled=withZeroDefaults(recipe,plan)
 const moved={...filled,bindings:filled.bindings.filter(b=>b.node!==ZERO_NODE_IDS.deg)}
 const all=structuredClone(recipe)
 // Every rotation now has its own node: the shared zero-degree node is orphaned.
 moved.nodes.push({id:'flat',role:'decision',value:0,unit:'deg',reason:'Lies flat'})
 for(const i of all.instances)for(const k of ['rx','ry','rz'])moved.bindings.push({path:`instances/${i.id}/placement/${k}`,node:'flat'})
 const d=zeroDefaults(all,moved)
 assert.deepEqual(d.unused,[ZERO_NODE_IDS.deg])
 compileCadParameters('p',all,withZeroDefaults(all,moved),new Map(),new Map())
})

test('array start rotations default to none; start positions still need a node',()=>{
 const raw={contract_version:1,units:'mm',assembly_id:'wall',definitions:[{id:'stud',primitive:'box',material_ref:null,x_mm:45,y_mm:95,z_mm:2400}],instances:[],views:['front'],
  arrays:[{id:'studs',definition_id:'stud',axis:'x',count:3}]}
 const plan:ParameterPlan={version:1,frames:[],nodes:[{id:'w',role:'decision',value:45,unit:'mm',reason:'Stud'},{id:'d',role:'decision',value:95,unit:'mm',reason:'Stud'},
  {id:'h',role:'decision',value:2400,unit:'mm',reason:'Wall'},{id:'cc',role:'decision',value:600,unit:'mm',reason:'Spacing'},{id:'zero',role:'decision',value:0,unit:'mm',reason:'Datum'}],
  bindings:[{path:'definitions/stud/x_mm',node:'w'},{path:'definitions/stud/y_mm',node:'d'},{path:'definitions/stud/z_mm',node:'h'},{path:'arrays/studs/spacing_mm',node:'cc'},
   ...['x','y','z'].map(k=>({path:'arrays/studs/start/'+k,node:'zero'}))]}
 const {recipe,plan:expanded}=expandCadArrays(raw,withZeroDefaults(null,plan,raw.arrays))
 const parsed=parseCadAssemblyRequest(recipe) as CadAssemblyRequest
 const saved=compileCadParameters('p',parsed,withZeroDefaults(parsed,expanded),new Map(),new Map())
 assert.equal(saved.bindings.find(b=>b.path==='instances/studs.3/placement/rz')?.node,ZERO_NODE_IDS.deg)
 assert.equal(parsed.instances[2].placement.x,1200)
 const noStart={...plan,bindings:plan.bindings.filter(b=>b.path!=='arrays/studs/start/y')}
 assert.throws(()=>expandCadArrays(raw,withZeroDefaults(null,noStart,raw.arrays)),/parameter_gaps/)
})

test('a parameter change cannot move the shared code zero',async()=>{
 const {recipe,plan}=box(),saved=compileCadParameters('p',structuredClone(recipe),withZeroDefaults(recipe,plan),new Map(),new Map())
 const draft={projectId:'p',status:'ok',recipe,parameters:saved}
 const none=async()=>({project:new Map(),physical:new Map()})
 await assert.rejects(compileConstructionParameterChange('p',draft,[{id:ZERO_NODE_IDS.mm,role:'decision',value:5,unit:'mm',reason:'Shift'}],none),/invalid_parameter_change_identity/)
 const changed=await compileConstructionParameterChange('p',draft,[{id:'w',role:'decision',value:500,unit:'mm',reason:'Wider'}],none)
 assert.equal(changed.recipe.instances.find(i=>i.id==='right')?.placement.x,488)
 assert.equal(changed.recipe.instances.find(i=>i.id==='left')?.placement.x,0)
})
