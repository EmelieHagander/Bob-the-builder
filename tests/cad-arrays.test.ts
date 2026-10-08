import {test} from 'node:test'
import assert from 'node:assert/strict'
import {expandCadArrays} from '../supabase/functions/_shared/cad-arrays.ts'
import {compileCadParameters,type ParameterPlan} from '../supabase/functions/_shared/cad-parameters.ts'
import {parseCadAssemblyRequest,type CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'

function example(count=5){
 const recipe={contract_version:1,units:'mm',assembly_id:'wall',definitions:[{id:'stud',primitive:'box',material_ref:null,x_mm:45,y_mm:95,z_mm:2400}],instances:[],views:['front'],
  arrays:[{id:'studs',definition_id:'stud',axis:'x',count}]}
 const nodes:ParameterPlan['nodes']=[
  {id:'w',role:'decision',value:45,unit:'mm',reason:'Stud width'},{id:'d',role:'decision',value:95,unit:'mm',reason:'Stud depth'},
  {id:'h',role:'decision',value:2400,unit:'mm',reason:'Wall height'},{id:'cc',role:'decision',value:600,unit:'mm',reason:'Stud spacing'},
  {id:'zero',role:'decision',value:0,unit:'mm',reason:'Datum'},{id:'angle',role:'decision',value:0,unit:'deg',reason:'Aligned'},
 ]
 const bindings=[{path:'definitions/stud/x_mm',node:'w'},{path:'definitions/stud/y_mm',node:'d'},{path:'definitions/stud/z_mm',node:'h'},{path:'arrays/studs/spacing_mm',node:'cc'},
  ...['x','y','z'].map(k=>({path:'arrays/studs/start/'+k,node:'zero'})),...['rx','ry','rz'].map(k=>({path:'arrays/studs/start/'+k,node:'angle'}))]
 return {recipe,plan:{version:1,frames:[],nodes,bindings} as ParameterPlan}
}
test('array expands to ordinary instances with derived, provenance-linked placements',()=>{
 const {recipe:raw,plan:rawPlan}=example(),{recipe,plan}=expandCadArrays(raw,rawPlan)
 const parsed=parseCadAssemblyRequest(recipe) as CadAssemblyRequest
 assert.ok(parsed);assert.ok(!('arrays' in parsed))
 const result=compileCadParameters('p',parsed,plan,new Map(),new Map())
 assert.deepEqual(parsed.instances.map(i=>[i.id,i.placement.x]),[['studs.1',0],['studs.2',600],['studs.3',1200],['studs.4',1800],['studs.5',2400]])
 assert.equal(result.coverage,'complete')
 const x4=result.nodes.find(n=>n.id===result.bindings.find(b=>b.path==='instances/studs.4/placement/x')?.node)
 assert.equal(x4?.role,'derived');assert.deepEqual(x4?.normalized,{value:1800,unit:'mm'})
 assert.ok(!result.bindings.some(b=>b.path.startsWith('arrays/')))
})
test('index nodes are shared between arrays',()=>{
 const {recipe:raw,plan:rawPlan}=example(3) as any
 raw.arrays.push({id:'nogs',definition_id:'stud',axis:'z',count:3})
 rawPlan.bindings.push({path:'arrays/nogs/spacing_mm',node:'cc'},...['x','y','z'].map(k=>({path:'arrays/nogs/start/'+k,node:'zero'})),...['rx','ry','rz'].map(k=>({path:'arrays/nogs/start/'+k,node:'angle'})))
 const {recipe,plan}=expandCadArrays(raw,rawPlan)
 assert.equal(plan.nodes.filter(n=>n.id.startsWith('repeat.n')).length,2)
 compileCadParameters('p',parseCadAssemblyRequest(recipe)!,plan,new Map(),new Map())
})
test('recipes without arrays pass through untouched',()=>{
 const {plan}=example(),recipe={assembly_id:'x'}
 assert.equal(expandCadArrays(recipe,plan).recipe,recipe)
})
for(const [name,change,message] of [
 ['missing spacing',(r:any,p:any)=>p.bindings=p.bindings.filter((b:any)=>b.path!=='arrays/studs/spacing_mm'),/parameter_gaps/],
 ['binding for unknown array',(r:any,p:any)=>p.bindings.push({path:'arrays/ghost/spacing_mm',node:'cc'}),/cad_array_unknown_binding/],
 ['single copy',(r:any)=>r.arrays[0].count=1,/invalid_cad_array/],
 ['instance id clash',(r:any)=>r.instances.push({id:'studs.2',definition_id:'stud',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}),/cad_array_instance_conflict/],
 ['node id clash',(r:any,p:any)=>p.nodes.push({id:'studs.o1',role:'decision',value:1,unit:'mm',reason:'x'}),/cad_array_node_conflict/],
 ['parameter budget',(r:any)=>{r.arrays[0].count=256;for(let i=0;i<3;i++)r.arrays.push({...r.arrays[0],id:'more'+i})},/parameter_gaps|cad_array_parameter_budget/],
] as const)test('array rejects '+name,()=>{
 const {recipe,plan}=example() as any;change(recipe,plan)
 assert.throws(()=>expandCadArrays(recipe,plan),message)
})
