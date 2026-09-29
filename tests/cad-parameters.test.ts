import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compileCadParameters,cadParameterTargets,type ParameterPlan} from '../supabase/functions/_shared/cad-parameters.ts'
import type {CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'

const measurement='90000000-0000-4000-8000-000000000001'
const sources=new Map([[measurement,{id:measurement,project_id:'p',revision:1,value:'1.001',unit:'m',truth:'measured',source:'Marked endpoints'}]])
function example(){
 const recipe:CadAssemblyRequest={contract_version:1,units:'mm',assembly_id:'opening',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:1,y_mm:18,z_mm:300}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
 const nodes:ParameterPlan['nodes']=[
  {id:'span',role:'source',source:{kind:'project_measurement',id:measurement,revision:1}},
  {id:'thickness',role:'decision',value:18,unit:'mm',reason:'Chosen panel specification for this concept'},
  {id:'two',role:'decision',value:2,unit:'scalar',reason:'Two side panels'},
  {id:'sides',role:'derived',operation:'multiply_v1',operands:['thickness','two'],rounding:'exact'},
  {id:'inside',role:'derived',operation:'subtract_v1',operands:['span','sides'],rounding:'exact'},
  {id:'gap',role:'decision',value:5,unit:'mm',reason:'Working clearance'},
  {id:'opening',role:'derived',operation:'subtract_v1',operands:['inside','gap'],rounding:'exact'},
  {id:'depth',role:'decision',value:300,unit:'mm',reason:'Chosen depth'},
  {id:'zero',role:'decision',value:0,unit:'mm',reason:'Assembly datum'},
  {id:'angle',role:'decision',value:0,unit:'deg',reason:'Aligned local axes'},
 ]
 const bindings=[...cadParameterTargets(recipe)].map(([path,target])=>({path,node:path.endsWith('/x_mm')?'opening':path.endsWith('/y_mm')?'thickness':path.endsWith('/z_mm')?'depth':target.unit==='deg'?'angle':'zero'}))
 return {recipe,plan:{version:1,nodes,bindings} as ParameterPlan}
}
test('P1 graph: exact original unit, versioned calculation and every placement persist',()=>{
 const {recipe,plan}=example(),result=compileCadParameters('p',recipe,plan,sources,new Map())
 assert.equal(recipe.definitions[0].primitive==='box'&&recipe.definitions[0].x_mm,960)
 assert.equal(result.coverage,'complete');assert.equal(result.bindings.length,9)
 assert.deepEqual(result.nodes.find(n=>n.id==='span')?.sources[0],{kind:'project_measurement',id:measurement,revision:1,value:'1.001',unit:'m',truth:'measured',description:'Marked endpoints'})
 assert.deepEqual(result.nodes.find(n=>n.id==='opening')?.normalized,{value:960,unit:'mm'})
})
for(const [name,change,message] of [
 ['missing placement',(p:any)=>p.bindings.pop(),/parameter_gaps/],
 ['unknown is not zero',(p:any)=>p.nodes[8]={id:'zero',role:'unknown',unit:'mm',reason:'Origin not known'},/parameter_gaps/],
 ['cycle',(p:any)=>p.nodes[3].operands[0]='opening',/parameter_cycle/],
 ['missing operand',(p:any)=>p.nodes[3].operands[0]='absent',/parameter_operand_missing/],
 ['wrong unit',(p:any)=>p.nodes[1].unit='deg',/parameter_unit_mismatch/],
 ['guessed source revision',(p:any)=>p.nodes[0].source.revision=2,/parameter_source_changed/],
 ['unsupported code',(p:any)=>p.nodes[3].operation='eval',/invalid_parameter_formula/],
 ['duplicate binding',(p:any)=>p.bindings.push(p.bindings[0]),/invalid_parameter_binding/],
] as const)test('P1 graph rejects '+name,()=>{
 const {recipe,plan}=example(),before=structuredClone(recipe);change(plan)
 assert.throws(()=>compileCadParameters('p',recipe,plan,sources,new Map()),message)
 assert.deepEqual(recipe,before,'Failed compilation must not leave partially applied geometry')
})
test('P1 graph enumerates cut placement, clearance and motion numbers independently',()=>{
 const {recipe}=example()
 recipe.definitions[0].cuts=[{primitive:'cylinder',diameter_mm:3,length_mm:10,placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}]
 recipe.clearances=[{id:'fit',first_id:'panel',second_id:'other',min_mm:5}]
 recipe.motions=[{id:'open',moving_ids:['panel'],obstacle_ids:['other'],delta:{x:0,y:100,z:0}}]
 const paths=[...cadParameterTargets(recipe).keys()]
 assert.equal(paths.length,21)
 assert(paths.includes('definitions/panel/cuts/0/placement/rz'))
 assert(paths.includes('clearances/fit/min_mm'))
 assert(paths.includes('motions/open/delta/y'))
})
