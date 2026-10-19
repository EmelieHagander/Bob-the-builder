import {test} from 'node:test'
import assert from 'node:assert/strict'
import {repeatedParts} from './support/construction-repeat-fixture.ts'
import {expandCadArrays} from '../supabase/functions/_shared/cad-arrays.ts'
import {compileCadParameters,parameterSourcePins} from '../supabase/functions/_shared/cad-parameters.ts'
import {parseCadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {schemaIssues} from '../supabase/functions/_shared/schema-issues.ts'

test('compact repetition equals the explicitly authored canonical graph, geometry, bindings and source lineage',()=>{
 const {recipe,plan}=repeatedParts(5),source='10000000-0000-4000-8000-000000000001'
 plan.nodes[3]={id:'spacing',role:'source',source:{kind:'project_measurement',id:source,revision:3}}
 const sources=new Map([[source,{id:source,project_id:'p',revision:3,archived:false,value:'100',unit:'mm',truth:'measured',source:'Synthetic site datum'}]])
 const expanded=expandCadArrays(recipe,plan),canonical:any=structuredClone(recipe);delete canonical.arrays
 const explicit=structuredClone(plan);explicit.bindings=explicit.bindings.filter(b=>!b.path.startsWith('arrays/'))
 for(let i=0;i<5;i++){
  const id='slats.'+(i+1);canonical.instances.push({id,definition_id:'slat',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}})
  if(i)explicit.nodes.push({id:'repeat.n'+i,role:'decision',value:i,unit:'scalar',reason:'Step count from the first copy of a repeat'},
   {id:'slats.o'+i,role:'derived',operation:'multiply_v1',operands:['spacing','repeat.n'+i],rounding:'exact'},
   {id:'slats.p'+i,role:'derived',operation:'add_v1',operands:['origin','slats.o'+i],rounding:'exact'})
  for(const k of ['x','y','z','rx','ry','rz'])explicit.bindings.push({path:`instances/${id}/placement/${k}`,node:k==='x'&&i?'slats.p'+i:k.startsWith('r')?'angle':'origin'})
 }
 assert.deepEqual(expanded.plan,explicit);assert.deepEqual(expanded.recipe,canonical)
 const a=parseCadAssemblyRequest(expanded.recipe)!,b=parseCadAssemblyRequest(canonical)!
 const ca=compileCadParameters('p',a,expanded.plan,sources,new Map()),cb=compileCadParameters('p',b,explicit,sources,new Map())
 assert.deepEqual(ca,cb);assert.deepEqual(a,b);assert.deepEqual(a.instances.map(i=>i.placement.x),[0,100,200,300,400])
 assert.deepEqual(parameterSourcePins(expanded.plan),parameterSourcePins(plan))
 assert.equal(ca.nodes.find(n=>n.id==='spacing')?.sources[0].revision,3)
 assert(JSON.stringify({recipe,plan}).length<JSON.stringify({recipe:canonical,plan:explicit}).length)
})

test('the old pinned tool rejects repetition while the new schema accepts it, without changing CAD schemas',()=>{
 const opts={projectId:'p',message:'Build',writer:{} as any,hasAccess:async()=>true,read:async()=>({}),readSources:async()=>({project:new Map(),physical:new Map()})}
 const old=createConstructionTools(opts).tools.find(t=>t.function.name==='save_construction_draft')!,current=createConstructionTools({...opts,constructionRepeats:true}).tools.find(t=>t.function.name==='save_construction_draft')!
 const {recipe}=repeatedParts()
 assert(schemaIssues((old.function.parameters.properties as any).recipe,recipe).length>0)
 assert.deepEqual(schemaIssues((current.function.parameters.properties as any).recipe,recipe),[])
 assert.equal(parseCadAssemblyRequest(recipe),null)
})
