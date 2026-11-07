import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compileSaveFormulas,compileEditFormulas,unusedFormulaNodes,CadFormulaError,FORMULA_NODE_PREFIX} from '../supabase/functions/_shared/cad-formulas.ts'
import {compileCadParameters,withZeroDefaults,parseParameterPlan,type ParameterInput} from '../supabase/functions/_shared/cad-parameters.ts'
import {expandCadArrays} from '../supabase/functions/_shared/cad-arrays.ts'
import {parseCadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'
import {ruleJoints,ruleJointId} from '../supabase/functions/_shared/construction-joint-rules.ts'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {extendFormMapping,constructionFormIssues} from '../supabase/functions/_shared/construction-form.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'

// Owner decision 2026-11-07 (lean_construction_version 1). Entry wall: 11
// parts took 26,590 typed characters; half were bindings and derived nodes,
// a quarter joints.
const decision=(id:string,value:number,unit:'mm'|'deg'|'scalar'='mm'):ParameterInput=>({id,role:'decision',value,unit,reason:'Synthetic '+id})
const nodes=[decision('D',2650),decision('st',95),decision('lum',45),decision('two',2,'scalar'),decision('h',2400)]
const wall=()=>({contract_version:1,units:'mm',assembly_id:'wall',views:['front','top'],
 definitions:[{id:'plate',primitive:'box',material_ref:null,x_mm:'st',y_mm:'D - st',z_mm:'lum'},{id:'stud',primitive:'box',material_ref:null,x_mm:'st',y_mm:'lum',z_mm:'h - two * lum'}],
 instances:[{id:'sill',definition_id:'plate',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}},
  {id:'s1',definition_id:'stud',placement:{x:0,y:0,z:'lum',rx:0,ry:0,rz:0}},
  {id:'s2',definition_id:'stud',placement:{x:0,y:'D - st - lum',z:'lum',rx:0,ry:0,rz:0}},
  {id:'top',definition_id:'plate',placement:{x:0,y:0,z:'h - lum',rx:0,ry:0,rz:0}}]})
const compile=(recipe:unknown,plan:unknown)=>{
 const f=compileSaveFormulas(recipe,plan) as {recipe:any;plan:any}
 const zeroed=withZeroDefaults(parseCadAssemblyRequest(structuredClone(f.recipe))!,parseParameterPlan(f.plan))
 const r=parseCadAssemblyRequest(structuredClone(f.recipe))!
 return {recipe:r,parameters:compileCadParameters('p',r,zeroed,new Map(),new Map()),plan:zeroed}
}

test('formulas in the recipe compile to the same saved graph: derived nodes, bindings and computed numbers',()=>{
 const {recipe,parameters,plan}=compile(wall(),{version:1,frames:[],nodes,bindings:[]})
 assert.deepEqual(recipe.definitions.map(d=>[d.x_mm,d.y_mm,d.z_mm]),[[95,2555,45],[95,45,2310]])
 assert.deepEqual(recipe.instances.map(i=>i.placement.y),[0,0,2510,0])
 assert.deepEqual(recipe.instances.map(i=>i.placement.z),[0,45,45,2355])
 const generated=plan.nodes.filter(n=>n.id.startsWith(FORMULA_NODE_PREFIX))
 // D - st is one node for the plate and inside D - st - lum; two * lum and h - two*lum, h - lum, (D-st)-lum.
 assert.equal(generated.length,5,JSON.stringify(generated))
 assert.ok(generated.every(n=>n.role==='derived'))
 assert.equal(plan.bindings.filter(b=>b.path==='definitions/plate/y_mm').length,1)
 assert.equal(parameters.coverage,'complete')
 // The same formula gives the same node in another save.
 const again=compile(wall(),{version:1,frames:[],nodes,bindings:[]}).plan.nodes.filter(n=>n.id.startsWith(FORMULA_NODE_PREFIX)).map(n=>n.id).sort()
 assert.deepEqual(again,generated.map(n=>n.id).sort())
})

test('a formula refuses numbers, unknown names, a field also bound by hand, and reserved node ids, each by path',()=>{
 const bad=wall() as any
 bad.definitions[0].z_mm='lum + 2'
 bad.instances[1].placement.z='ghost'
 bad.instances[2].placement.x='st'
 assert.throws(()=>compileSaveFormulas(bad,{version:1,frames:[],nodes:[...nodes,{...decision('fx.mine',1)}],bindings:[{path:'instances/s2/placement/x',node:'st'}]}),(e:any)=>{
  assert.ok(e instanceof CadFormulaError)
  assert.deepEqual(e.issues.map((i:any)=>[i.code,i.path]).sort(),[
   ['formula_binding_conflict','instances/s2/placement/x'],['formula_number','definitions/plate/z_mm'],
   ['formula_reserved_id','nodes/fx.mine'],['formula_unknown_node','instances/s1/placement/z']].sort())
  return true
 })
 // A hyphen inside a name is part of the name; subtraction has spaces.
 const named=wall() as any;named.instances[1].placement.z='D-st'
 assert.throws(()=>compileSaveFormulas(named,{version:1,frames:[],nodes,bindings:[]}),(e:any)=>e.issues[0].code==='formula_unknown_node')
})

test('a negative value and an array spacing compile; the spacing leaves the recipe for its binding',()=>{
 const recipe={contract_version:1,units:'mm',assembly_id:'a',views:['front'],
  definitions:[{id:'slat',primitive:'box',material_ref:null,x_mm:'lum',y_mm:'lum',z_mm:'st'}],
  instances:[{id:'back',definition_id:'slat',placement:{x:'-lum',y:0,z:0,rx:0,ry:0,rz:0}}],
  arrays:[{id:'row',definition_id:'slat',axis:'x',count:3,start:{x:0,y:'lum',z:0},spacing_mm:'two * lum'}]}
 const f=compileSaveFormulas(recipe,{version:1,frames:[],nodes:nodes.filter(n=>['st','lum','two'].includes(n.id)),bindings:[]}) as any
 assert.equal(f.recipe.arrays[0].spacing_mm,undefined)
 assert.ok(f.plan.bindings.some((b:any)=>b.path==='arrays/row/spacing_mm'))
 const {spacing_mm:_s,...arr}=recipe.arrays[0];void arr
 const zeroed=withZeroDefaults(null,parseParameterPlan(f.plan),f.recipe.arrays)
 const noStart={...f.recipe,arrays:f.recipe.arrays.map(({start:_x,...a}:any)=>a)}
 const expanded=expandCadArrays(noStart,zeroed) as any
 const r=parseCadAssemblyRequest(structuredClone(expanded.recipe))!
 const plan=withZeroDefaults(r,parseParameterPlan(expanded.plan))
 compileCadParameters('p',r,plan,new Map(),new Map())
 assert.deepEqual(r.instances.map(i=>[i.id,i.placement.x,i.placement.y]),[['back',-45,0],['row.1',0,45],['row.2',90,45],['row.3',180,45]])
})

test('an edit compiles formulas in its upserts into node and binding upserts, and drops formula nodes no longer used',()=>{
 const {plan}=compile(wall(),{version:1,frames:[],nodes,bindings:[]})
 const changes=compileEditFormulas({instances:{upsert:[{id:'s3',definition_id:'stud',placement:{x:0,y:'D - st - lum - lum',z:'lum',rx:0,ry:0,rz:0}}],remove:[]}},plan.nodes) as any
 assert.equal(changes.instances.upsert[0].placement.y,0)
 assert.deepEqual(changes.bindings.upsert.map((b:any)=>b.path),['instances/s3/placement/y','instances/s3/placement/z'])
 assert.equal(changes.nodes.upsert.length,1,'D - st - lum is saved already; only the new subtraction is added')
 // Moving s2 back to y = 0 leaves its formula node unused.
 const bindings=plan.bindings.map(b=>b.path==='instances/s2/placement/y'?{...b,node:'origin.zero_mm'}:b)
 const unused=unusedFormulaNodes(plan.nodes,bindings)
 assert.equal(unused.length,1,'only D - st - lum; D - st still sizes the plate')
})

test('joint rules write one joint per touching pair of those definitions, with faces in local coordinates the check accepts',()=>{
 const {recipe}=compile(wall(),{version:1,frames:[],nodes,bindings:[]})
 const fasteners=[{material_id:'00000000-0000-4000-8000-000000000001',material_revision:1,count:2,spacing_mm:null}]
 const rules=[{id:'plate_stud',between:['plate','stud'] as [string,string],reason:'Spikas genom syll och hammarband.',fasteners}]
 const out=ruleJoints(recipe,[],rules,new Map())
 assert.deepEqual(out.issues,[])
 assert.deepEqual(out.joints.map(j=>j.id).sort(),[ruleJointId('s1','sill'),ruleJointId('s1','top'),ruleJointId('s2','sill'),ruleJointId('s2','top')].sort())
 const sill=out.joints.find(j=>j.id===ruleJointId('s1','sill'))!
 assert.deepEqual([sill.first,sill.second],[{instance_id:'sill',face:'z_max'},{instance_id:'s1',face:'z_min'}])
 // The check sees no contact without a joint and every joint fitting.
 const draft={artifact_id:'a',revision:1,current_revision:1,source_state:'current',archived:false,recipe,materials:[],open_questions:[],instance_policy:null,
  joints:out.joints.map(j=>({...j,method:'butt'}))}
 const check=checkConstruction(draft,new Map(),'2026-11-07')
 assert.deepEqual(check.issues.filter((i:any)=>['contact_without_joint','joint_faces_do_not_meet'].includes(i.code)),[])
 // A declared joint for a pair wins; two existing parts are not joined again.
 const declared=[{id:'mine',first:{instance_id:'sill',face:'z_max'},second:{instance_id:'s1',face:'z_min'}}]
 assert.equal(ruleJoints(recipe,declared,rules,new Map()).joints.length,3)
 assert.equal(ruleJoints(recipe,[],rules,new Map([['sill','existing_part'],['s1','existing_part']])).joints.length,3)
 assert.equal(ruleJoints(recipe,[],rules,new Map([['s1','reference']])).joints.length,2)
 // Two rules for one pair, or a rule naming a missing definition, are refused.
 assert.equal(ruleJoints(recipe,[],[...rules,{...rules[0],id:'again'}],new Map()).issues[0].code,'joint_rule_ambiguous')
 assert.equal(ruleJoints(recipe,[],[{...rules[0],between:['plate','ghost']}],new Map()).issues[0].code,'joint_rule_unknown_definition')
})

test('the FORM mapping follows the parts: a new part goes to the component holding it, a removed part leaves, assign moves one',()=>{
 const {intent,recipe,refinement}=constructionFormFixture()
 const r=structuredClone(recipe)
 r.instances.push({id:'middle',definition_id:'rail',placement:{x:300,y:0,z:0,rx:0,ry:0,rz:0}})
 const added=extendFormMapping(intent,r,refinement,new Set())
 assert.deepEqual(added.issues,[]);assert.equal(added.changed,true)
 assert.deepEqual(added.refinement.mappings,[{component_id:'frame',instance_ids:['left','right','middle']}])
 assert.deepEqual(constructionFormIssues(intent,r,new Set(),added.refinement,true).filter(i=>i.code.startsWith('form_')),[])
 // Removed: right goes.
 const fewer={...r,instances:r.instances.filter((i:any)=>i.id!=='right')}
 assert.deepEqual(extendFormMapping(intent,fewer,refinement,new Set()).refinement.mappings[0].instance_ids,['left','middle'])
 // Outside every component: named, not guessed.
 const far=structuredClone(r);far.instances.push({id:'far',definition_id:'rail',placement:{x:5000,y:0,z:0,rx:0,ry:0,rz:0}})
 assert.deepEqual(extendFormMapping(intent,far,refinement,new Set()).issues.map(i=>[i.code,i.ids[0]]),[['form_instance_outside','far']])
 // A part inside the drawer envelope goes there, adding that component.
 const drawer=structuredClone(r);drawer.instances.push({id:'knob',definition_id:'rail',placement:{x:800,y:0,z:0,rx:0,ry:0,rz:0}})
 drawer.definitions.push({id:'small',primitive:'box',material_ref:null,x_mm:18,y_mm:18,z_mm:18});drawer.instances.at(-1).definition_id='small'
 assert.deepEqual(extendFormMapping(intent,drawer,refinement,new Set()).refinement.mappings.map(m=>m.component_id),['frame','drawer'])
 // assign overrides the envelope.
 assert.deepEqual(extendFormMapping(intent,drawer,refinement,new Set(),[{instance_id:'knob',component_id:'frame'}]).refinement.mappings.map(m=>m.component_id),['frame'])
})

test('the model sees no revision in a joint rule; the server fills it, as for joints (server_revisions_version 1)',async()=>{
 const {createConstructionTools}=await import('../supabase/functions/_shared/construction-draft.ts')
 const {withoutServerRevisions}=await import('../supabase/functions/_shared/server-revisions.ts')
 const store={read:async()=>({status:'unavailable' as const}),put:async()=>({status:'unavailable' as const}),drop:async()=>({status:'unavailable' as const}),list:async()=>({status:'unavailable' as const})}
 const tools=createConstructionTools({projectId:'p',message:'m',hasAccess:async()=>true,read:async()=>null,readSources:async()=>({project:new Map(),physical:new Map()}),
  writer:{} as any,defaultZero:true,chosenJointFasteners:true,formRefinement:true,serverTarget:true,sketches:store,newSketches:store,leanConstruction:true})
 for(const [name,rules] of [['save_construction_draft',(p:any)=>p.properties.joint_rules],['edit_construction_parts',(p:any)=>p.properties.joint_rules]] as const){
  const spec=tools.tools.find(t=>t.function.name===name)!
  assert.ok(rules(spec.function.parameters).items.properties.fasteners.items.properties.material_revision,'code validates the filled value')
  const shown=withoutServerRevisions(spec)
  assert.equal(rules(shown.function.parameters).items.properties.fasteners.items.properties.material_revision,undefined,name)
 }
})
