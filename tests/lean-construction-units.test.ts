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
  // A formula at the field wins over a hand binding for the same path (audit round 2).
  assert.deepEqual(e.issues.map((i:any)=>[i.code,i.path]).sort(),[
   ['formula_number','definitions/plate/z_mm'],['formula_reserved_id','nodes/fx.mine'],['formula_unknown_node','instances/s1/placement/z']].sort())
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
 assert.equal(changes.instances.upsert[0].placement.y,2465,'the field gets its real value before the recipe is checked')
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
 // Existing parts are joined as the rule says (audit round 2: code does not decide they are already joined).
 assert.deepEqual(ruleJoints(recipe,[],rules,new Map([['sill','existing_part'],['s1','existing_part']])).joints.find(j=>j.id===ruleJointId('s1','sill'))!.fasteners,fasteners)
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

test('old and new format are the same model: identical geometry, and identical geometry after a measure changes',async()=>{
 const {compileConstructionParameterChange}=await import('../supabase/functions/_shared/construction-parameters.ts')
 // Old format: Konrad wrote every derived node and binding by hand.
 const at=(x:number|string,y:number|string,z:number|string)=>({x,y,z,rx:0,ry:0,rz:0})
 const d=(id:string,operation:string,operands:[string,string])=>({id,role:'derived',operation,operands,rounding:operation==='add_v1'||operation==='subtract_v1'?'exact':'half_away_6'})
 const oldRecipe={contract_version:1,units:'mm',assembly_id:'wall',views:['front','top'],
  definitions:[{id:'plate',primitive:'box',material_ref:null,x_mm:95,y_mm:2555,z_mm:45},{id:'stud',primitive:'box',material_ref:null,x_mm:95,y_mm:45,z_mm:2310}],
  instances:[{id:'sill',definition_id:'plate',placement:at(0,0,0)},{id:'s1',definition_id:'stud',placement:at(0,0,45)},
   {id:'s2',definition_id:'stud',placement:at(0,2510,45)},{id:'top',definition_id:'plate',placement:at(0,0,2355)}]}
 const oldPlan={version:1,frames:[],nodes:[...nodes,d('len','subtract_v1',['D','st']),d('double','multiply_v1',['two','lum']),d('stud_h','subtract_v1',['h','double']),
  d('top_z','subtract_v1',['h','lum']),d('s2_y','subtract_v1',['len','lum'])],
  bindings:[['definitions/plate/x_mm','st'],['definitions/plate/y_mm','len'],['definitions/plate/z_mm','lum'],['definitions/stud/x_mm','st'],['definitions/stud/y_mm','lum'],
   ['definitions/stud/z_mm','stud_h'],['instances/s1/placement/z','lum'],['instances/s2/placement/y','s2_y'],['instances/s2/placement/z','lum'],['instances/top/placement/z','top_z']].map(([path,node])=>({path,node}))}
 const old=(()=>{const r=parseCadAssemblyRequest(structuredClone(oldRecipe))!,p=withZeroDefaults(r,parseParameterPlan(oldPlan));return {recipe:r,parameters:compileCadParameters('p',r,p,new Map(),new Map())}})()
 const lean=compile(wall(),{version:1,frames:[],nodes,bindings:[]})
 assert.deepEqual(lean.recipe,old.recipe,'identical geometry')
 // Every field is bound in both; the bindings name different nodes with the same values.
 assert.deepEqual(lean.parameters.bindings.map(b=>b.path).sort(),old.parameters.bindings.map(b=>b.path).sort())
 const value=(p:typeof old.parameters,path:string)=>p.nodes.find(n=>n.id===p.bindings.find(b=>b.path===path)!.node)!.normalized
 for(const b of old.parameters.bindings)assert.deepEqual(value(lean.parameters,b.path),value(old.parameters,b.path),b.path)
 // The same measure change, through the compiler change_construction_parameters uses.
 const change=async(saved:typeof old)=>(await compileConstructionParameterChange('p',{projectId:'p',status:'ok',recipe:saved.recipe,parameters:saved.parameters},
  [decision('D',2700),decision('h',2500)],async()=>({project:new Map(),physical:new Map()}))) as {recipe:any}
 const [a,b]=[await change(old),await change(lean)]
 assert.deepEqual(b.recipe,a.recipe,'identical geometry after the change')
 assert.deepEqual(b.recipe.definitions.map((x:any)=>x.y_mm),[2605,45]);assert.equal(b.recipe.instances.find((i:any)=>i.id==='top').placement.z,2455)
})

test('joints code wrote follow their parts: faces rewritten after a move, gone when parts part; existing pairs need nothing fastened; dotted ids stay distinct',()=>{
 const {recipe}=compile(wall(),{version:1,frames:[],nodes,bindings:[]})
 const fasteners=[{material_id:'00000000-0000-4000-8000-000000000001',material_revision:1,count:2,spacing_mm:null}]
 const rules=[{id:'plate_stud',between:['plate','stud'] as [string,string],reason:'Spikas.',fasteners,except:[]}]
 const first=ruleJoints(recipe,[],rules,new Map())
 // A saved code joint whose faces no longer meet is written again with the same id, even without its rule.
 const wrong=first.joints.map(j=>j.id===ruleJointId('s1','sill')?{...j,first:{...j.first,face:'x_max'}}:j)
 const again=ruleJoints(recipe,wrong,[],new Map())
 assert.deepEqual(again.joints.map(j=>[j.id,j.first.face,j.fasteners.length]),[[ruleJointId('s1','sill'),'z_max',1]])
 assert.deepEqual(again.made,[{id:ruleJointId('s1','sill'),parts:['sill','s1'],rule:null}])
 // A code joint whose parts no longer touch is stale; a declared one is left alone.
 const moved=structuredClone(recipe);moved.instances.find(i=>i.id==='s1')!.placement.z=500
 const later=ruleJoints(moved,[...first.joints,{id:'mine',first:{instance_id:'s1',face:'z_max'},second:{instance_id:'top',face:'z_min'}}],[],new Map())
 assert.deepEqual(later.stale.sort(),[ruleJointId('s1','sill'),ruleJointId('s1','top')].sort())
 // Two existing parts are joined as the rule says; except is where they are not.
 const existing=ruleJoints(recipe,[],rules,new Map([['sill','existing_part'],['s1','existing_part']]))
 const both=existing.joints.find(j=>j.id===ruleJointId('s1','sill'))!
 assert.deepEqual(both.fasteners,fasteners);assert.equal(existing.joints.length,4)
 const check=checkConstruction({artifact_id:'a',revision:1,current_revision:1,source_state:'current',archived:false,recipe,materials:[],open_questions:[],
  instance_policy:{version:1,instances:recipe.instances.map(i=>({instance_id:i.id,role:['sill','s1'].includes(i.id)?'existing_part':'build_part',quantity_policy:['sill','s1'].includes(i.id)?'reuse':'manufacture',reason:'x'}))},
  joints:existing.joints.map(j=>({...j,method:'butt'}))},new Map(),'2026-11-07')
 assert.deepEqual(check.issues.filter((i:any)=>['contact_without_joint','joint_faces_do_not_meet'].includes(i.code)&&i.ids.includes('s1')&&i.ids.includes('sill')),[])
 // (a, b.c) and (a.b, c) once met as jr.a.b.c.
 assert.notEqual(ruleJointId('a','b.c'),ruleJointId('a.b','c'))
 assert.match(ruleJointId('a','b.c'),/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/)
})

test('audit round 1, formulas: real values before checks, copied code nodes, unary minus, unit by field, conflicts resolved',async()=>{
 const {formulaNodeIssues,formulaNodeId}=await import('../supabase/functions/_shared/cad-formulas.ts')
 // A tube's outside diameter as a formula passes the tube rule with its real value (placeholder 1 failed it).
 const tube={contract_version:1,units:'mm',assembly_id:'t',views:['front'],definitions:[{id:'pipe',primitive:'tube',material_ref:null,outside_diameter_mm:'od',wall_thickness_mm:3,length_mm:'h'}],
  instances:[{id:'p1',definition_id:'pipe',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}]}
 const t=compileSaveFormulas(tube,{version:1,frames:[],nodes:[decision('od',42),decision('h',2400)],bindings:[]}) as any
 assert.deepEqual([t.recipe.definitions[0].outside_diameter_mm,t.recipe.definitions[0].length_mm],[42,2400])
 assert.ok(parseCadAssemblyRequest(structuredClone(t.recipe)),'the tube recipe is valid before compilation')
 // A whole revision may copy code's own formula nodes; a hand-made one under that name is refused.
 const {plan}=compile(wall(),{version:1,frames:[],nodes,bindings:[]})
 const copied=compileSaveFormulas(wall(),{version:1,frames:[],nodes:plan.nodes.filter(n=>!n.id.startsWith('origin.')),bindings:[]}) as any
 assert.equal(copied.plan.nodes.filter((n:any)=>n.id.startsWith('fx.')).length,5,'copies reused, nothing doubled')
 const id=formulaNodeId('subtract_v1','D','st','exact')
 assert.deepEqual(formulaNodeIssues([{id,role:'derived',operation:'add_v1',operands:['w','w'],rounding:'exact'}]).map(i=>i.code),['formula_reserved_id'])
 assert.deepEqual(formulaNodeIssues([{id,role:'derived',operation:'subtract_v1',operands:['D','st'],rounding:'exact'}]),[])
 // A leading minus negates the product; a negated sub-expression needs no declared zero node.
 const neg={...wall(),instances:[{id:'a',definition_id:'plate',placement:{x:'-two * lum',y:'-(-lum + st)',z:0,rx:0,ry:0,rz:0}}],definitions:[wall().definitions[0]]}
 const n=compileSaveFormulas(neg,{version:1,frames:[],nodes,bindings:[]}) as any
 assert.deepEqual([n.recipe.instances[0].placement.x,n.recipe.instances[0].placement.y],[-90,-50])
 // A formula in the wrong unit is named by its field.
 const deg={...neg,instances:[{id:'a',definition_id:'plate',placement:{x:0,y:0,z:0,rx:'lum',ry:0,rz:0}}]}
 assert.throws(()=>compileSaveFormulas(deg,{version:1,frames:[],nodes,bindings:[]}),(e:any)=>e.issues[0].code==='formula_unit'&&e.issues[0].path==='instances/a/placement/rx')
 // An unknown name is named, with the hint about hyphens.
 assert.throws(()=>compileSaveFormulas({...neg,instances:[{id:'a',definition_id:'plate',placement:{x:'D-st',y:0,z:0,rx:0,ry:0,rz:0}}]},{version:1,frames:[],nodes,bindings:[]}),
  (e:any)=>e.issues[0].detail==='D-st'&&/hyphen/.test(e.issues[0].message))
 // An edit that removes a formula node and uses the same formula keeps it; a formula replaces a removed binding path.
 const edit=compileEditFormulas({nodes:{upsert:[],remove:[id]},bindings:{upsert:[],remove:['instances/s3/placement/y']},
  instances:{upsert:[{id:'s3',definition_id:'stud',placement:{x:0,y:'D - st',z:0,rx:0,ry:0,rz:0}}],remove:[]}},plan.nodes) as any
 assert.deepEqual(edit.nodes.remove,[]);assert.ok(edit.nodes.upsert.some((x:any)=>x.id===id))
 assert.deepEqual(edit.bindings.remove,[])
})
