import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProjectCalculator,type CalculatorOptions} from '../supabase/functions/_shared/project-calculator.ts'
import {compileCadParameters,cadParameterTargets,type ParameterInput} from '../supabase/functions/_shared/cad-parameters.ts'
import {callWithCalculator} from '../supabase/functions/_shared/calculator-model-call.ts'
import {catalogFixture,legacyCatalogFixture,catalogCall} from './support/ai-catalog-fixture.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with {type:'json'}
import {makeStairDetails} from './support/stair-fixture.ts'
import type {CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'

const id='90000000-0000-4000-8000-000000000001'
const measurement={id,project_id:'A',revision:1,value:'1.001',unit:'m',truth:'measured',source:'Marked endpoints'}
const nodes:ParameterInput[]=[{id:'span',role:'source',source:{kind:'project_measurement',id,revision:1}},
 {id:'side',role:'decision',value:18,unit:'mm',reason:'Explicit chosen board thickness'},
 {id:'two',role:'decision',value:2,unit:'scalar',reason:'Two sides'},
 {id:'sides',role:'derived',operation:'multiply_v1',operands:['side','two'],rounding:'exact'},
 {id:'inside',role:'derived',operation:'subtract_v1',operands:['span','sides'],rounding:'exact'}]
const graph={calculation:{method:'parameter_graph_v1',nodes,outputs:['inside']}}
const unavailable=async()=>{throw new Error('unexpected read')}
function options(extra:Partial<CalculatorOptions>={}):CalculatorOptions{return {projectId:'A',hasAccess:async()=>true,
 readSources:async()=>({project:new Map([[id,structuredClone(measurement)]]),physical:new Map()}),
 readSource:unavailable,readConstruction:unavailable,quotePacks:unavailable,...extra}}
const value=(r:any,key:string)=>r.outputs.find((o:any)=>o.id===key).value

test('common offered calculator uses exact database values, keeps original units and distinguishes a preview from a saved model',async()=>{
 let pins:any
 const calculator=createProjectCalculator(options({readSources:async p=>{pins=p;return {project:new Map([[id,measurement]]),physical:new Map()}}}))
 const session=createBobToolSession({aiCatalog:catalogFixture(),calculator,lookup:createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null})),
  readPolicy:async()=>({phase:'design',tools:seed})})
 assert((await session.prepare()).some(t=>t.function.name==='calculate_project'))
 const result=await session.execute('calculate_project',graph) as any
 assert.equal(result.status,'calculated');assert.equal(value(result,'inside'),965)
 assert.equal(result.saved,false);assert.equal(result.model.persisted,false);assert.equal(result.source_state,'proposed')
 assert.deepEqual(pins,{project:[{id,revision:1}],physical:[]})
 assert.equal(result.inputs[0].sources[0].unit,'m');assert.equal(result.inputs[0].sources[0].truth,'measured')
 assert.deepEqual(result.dependencies.at(-1),{id:'inside',operation:'subtract_v1',version:1,operands:['span','sides'],rounding:'exact'})
 const old=createBobToolSession({aiCatalog:legacyCatalogFixture(),calculator,lookup:createProjectLookup('A',unavailable),readPolicy:async()=>({phase:'design',tools:seed})})
 assert(!(await old.prepare()).some(t=>t.function.name==='calculate_project'))
})

for(const [label,edit,status] of [
 ['copied source number',(n:any[])=>n[0].value=12,'invalid'],
 ['wrong source revision',(n:any[])=>n[0].source.revision=2,'invalid'],
 ['unsupported area unit',(n:any[])=>n[1].unit='m2','invalid'],
 ['multiply lengths',(n:any[])=>n[2].unit='mm','invalid'],
 ['cycle',(n:any[])=>n[3].operands[0]='inside','invalid'],
 ['arbitrary executable code',(n:any[])=>n[3].operation='eval','invalid'],
 ['unknown input',(n:any[])=>n[1]={id:'side',role:'unknown',unit:'mm',reason:'Thickness not chosen'},'needs_data'],
] as const)test('calculator rejects '+label+' without a mathematical fallback',async()=>{
 const request=structuredClone(graph);edit(request.calculation.nodes)
 const r=await createProjectCalculator(options()).execute(request)
 assert.equal(r.status,status);assert.equal(r.saved,false);assert(!('outputs' in r))
})

test('graph uses the original signed decimal rounding and rejects implicit division rounding',async()=>{
 const request={calculation:{method:'parameter_graph_v1',nodes:[{id:'a',role:'decision',value:-1,unit:'mm',reason:'Signed test'},
  {id:'b',role:'decision',value:128,unit:'scalar',reason:'Explicit divisor'},
  {id:'q',role:'derived',operation:'divide_v1',operands:['a','b'],rounding:'half_away_6'}],outputs:['q']}}
 const calculator=createProjectCalculator(options())
 assert.equal(value(await calculator.execute(request),'q'),-.007813)
 request.calculation.nodes[2].rounding='exact'
 assert.equal((await calculator.execute(request)).reason,'parameter_inexact_result')
})

test('saved construction replays its exact graph after a source/head change; tampered saved graphs fail closed',async()=>{
 const recipe:CadAssemblyRequest={contract_version:1,units:'mm',assembly_id:'panel',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:1,y_mm:18,z_mm:300}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
 const other:ParameterInput[]=[{id:'depth',role:'decision',value:300,unit:'mm',reason:'Chosen depth'},
  {id:'zero',role:'decision',value:0,unit:'mm',reason:'Datum'}, {id:'angle',role:'decision',value:0,unit:'deg',reason:'Aligned'}]
 const bindings=[...cadParameterTargets(recipe)].map(([path,t])=>({path,node:path.endsWith('/x_mm')?'inside':path.endsWith('/y_mm')?'side':path.endsWith('/z_mm')?'depth':t.unit==='deg'?'angle':'zero'}))
 const parameters=compileCadParameters('A',recipe,{version:1,frames:[],nodes:[...nodes,...other],bindings},new Map([[id,measurement]]),new Map())
 const stored={status:'ok',projectId:'A',artifact_id:id,revision:1,recipe,parameters}
 const calculator=createProjectCalculator(options({readConstruction:async(_id,r)=>r===null?{...stored,revision:2,source_state:'changed'}:stored}))
 const request={calculation:{method:'construction_parameters_v1',record_id:id,revision:1}}
 const first=await calculator.execute(request),again=await calculator.execute(request)
 assert.equal(value(first,'inside'),965);assert.equal(first.source_state,'changed');assert.equal(first.model.persisted,true)
 assert.deepEqual(again,first)
 stored.parameters.nodes.find(n=>n.id==='inside')!.normalized.value=999
 assert.equal((await calculator.execute(request)).reason,'invalid_saved_parameters')
})

test('saved stair returns full-precision rise/formula, an explicit display policy and exact source provenance',async()=>{
 const d=makeStairDetails();d.recipe.risers=17;d.recipe.first_flight_risers=8
 const calculator=createProjectCalculator(options({readSource:async()=>({status:'ok',project_id:'A',id:d.artifact_id,revision:1,source_state:'changed',record:d})}))
 const result=await calculator.execute({calculation:{method:'saved_stair_study_v1',record_id:d.artifact_id,revision:1}})
 assert.equal(result.status,'calculated');assert.equal(value(result,'rise_mm'),2800/17)
 assert.equal(value(result,'step_formula_mm'),2*(2800/17)+280)
 assert.equal(result.outputs[1].display,(2800/17).toFixed(3));assert.equal(result.outputs[1].display_is_input,false)
 assert.equal(result.inputs[0].source.revision,1);assert.equal(result.model.persisted,true);assert.equal(result.source_state,'changed')
})

test('revoked or cross-project sources return no calculation, and invalid calls consume the shared limit',async()=>{
 let allowed=true
 const calculator=createProjectCalculator(options({hasAccess:async()=>allowed,readSources:async()=>{allowed=false;return {project:new Map([[id,measurement]]),physical:new Map()}}}))
 assert.deepEqual(await calculator.execute(graph),{status:'denied',saved:false})
 const cross=createProjectCalculator(options({readSources:async()=>({project:new Map([[id,{...measurement,project_id:'B'}]]),physical:new Map()})}))
 assert.equal((await cross.execute(graph)).status,'invalid')
 const limited=createProjectCalculator(options())
 for(let i=0;i<12;i++)assert.equal((await limited.execute({})).status,'invalid')
 assert.equal(limited.remaining,0);assert.equal((await limited.execute(graph)).status,'budget_exhausted')
})

test('structured specialists calculate in a bounded phase and finish with the pinned tool-free JSON schema',async()=>{
 const catalog=catalogFixture(),calls:any[]=[]
 const calculator=createProjectCalculator(options())
 const reply=(extra:any={})=>({success:true,data:null,model:'fixture',responseId:'r'+calls.length,usage:{input_tokens:1,output_tokens:1,total_tokens:2},...extra})
 const result=await callWithCalculator({app:'bob',module:'living-plan',coworkerId:'bob',aiFunction:'plan-reviewer',functionName:'plan-reviewer',catalogRoleKey:'plan-reviewer',catalogSchemaKey:'bob_plan_review',prompt:'Check the exact opening.'},
  {catalog,calculator,hasAccess:async()=>true,deadline:Date.now()+10000,callModel:catalogCall(async o=>{
   calls.push(o)
   if(calls.length===1)return reply({toolCalls:[{id:'calc',type:'function',function:{name:'calculate_project',arguments:JSON.stringify(graph)}}]})
   if(calls.length===2)return reply()
   assert.equal(o.tools,undefined);assert(o.schema);assert.equal(o.schemaName,'bob_plan_review')
   assert.match(JSON.stringify(o.messages),/965/);assert.doesNotMatch(JSON.stringify(o.messages),/phase draft/)
   return reply({data:{ready_to_save:true,summary:'Code result used',issues:[]}})
  },catalog)})
 assert.equal(result.success,true);assert.equal(calls.length,3);assert.equal(calls[0].schema,undefined)
 assert.deepEqual(calls[0].tools[0].function.parameters,catalog.tool('calculate_project').function.parameters)
})

test('calculator phase has no manual-arithmetic fallback after provider failure, access revocation or exhausted budget',async()=>{
 const catalog=catalogFixture(),calculator=createProjectCalculator(options());let calls=0
 const optionsCall={app:'bob',module:'living-plan',coworkerId:'bob',aiFunction:'plan-reviewer',functionName:'plan-reviewer',catalogRoleKey:'plan-reviewer',catalogSchemaKey:'bob_plan_review'}
 const result=await callWithCalculator(optionsCall,{catalog,calculator,hasAccess:async()=>true,deadline:Date.now()+10000,callModel:async()=>{calls++;return {success:false,data:null,error:'turn_budget_exhausted',model:'fixture',usage:{input_tokens:0,output_tokens:0,total_tokens:0}}}})
 assert.equal(result.error,'turn_budget_exhausted');assert.equal(calls,1)
 await assert.rejects(callWithCalculator(optionsCall,{catalog,calculator,hasAccess:async()=>false,deadline:Date.now()+10000,callModel:unavailable}),/project_denied/)
 for(let i=0;i<12;i++)await calculator.execute({})
 assert.equal((await callWithCalculator(optionsCall,{catalog,calculator,hasAccess:async()=>true,deadline:Date.now()+10000,callModel:unavailable})).error,'calculator_budget_exhausted')
})

test('specialist offering and execution respect live policy deactivation, mismatch and failed policy reads',async()=>{
 let enabled=true
 const c=createProjectCalculator(options({isEnabled:async()=>enabled}))
 assert.equal((await c.offered()).length,1);enabled=false
 assert.deepEqual(await c.offered(),[]);assert.equal((await c.execute(graph)).reason,'calculator_policy_unavailable')
 const revokedDuringRead=createProjectCalculator(options({isEnabled:async()=>enabled,readSources:async()=>{enabled=false;return {project:new Map([[id,measurement]]),physical:new Map()}}}))
 enabled=true;assert.equal((await revokedDuringRead.execute(graph)).reason,'calculator_policy_unavailable')
 const broken=createProjectCalculator(options({isEnabled:async()=>{throw new Error('policy unavailable')}}))
 assert.deepEqual(await broken.offered(),[]);assert.equal((await broken.execute(graph)).reason,'calculator_policy_unavailable')
})

test('pack quote preserves exact article and need pins, whole-pack rounding and unknown pack size',async()=>{
 let size:number|null=12
 const c=createProjectCalculator(options({quotePacks:async()=>({article_id:id,article_revision:1,calculation_version:'k4-pack-aggregate-v1',source_state:'changed',purchase_unit:'box',content_unit:'pcs',
  needs:[{id,revision:1,net_quantity:13}],purchase_count:size===null?null:2,surplus_quantity:size===null?null:11,pack_state:size===null?'unknown':'known'})}))
 const request={calculation:{method:'pack_purchase_v1',article_id:id,article_revision:1,needs:[{id,revision:1}]}}
 const result=await c.execute(request);assert.equal(result.source_state,'changed');assert.equal(value(result,'purchase_count'),2);assert.equal(result.saved,false)
 size=null;const missing=await c.execute(request);assert.equal(value(missing,'purchase_count'),null);assert.deepEqual(missing.gaps,['content_per_purchase_unit'])
 assert.equal((await c.execute({calculation:{...request.calculation,needs:[{id,revision:1},{id,revision:1}]}})).reason,'invalid_calculation_reference')
})
