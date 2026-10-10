import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {designIntent} from './support/design-intent-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {compileConstructionParameterChange} from '../supabase/functions/_shared/construction-parameters.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'

function assembly(){
 const at=(x:number)=>({x,y:0,z:0,rx:0,ry:0,rz:0})
 const recipe:any={contract_version:1,units:'mm',assembly_id:'frame',definitions:[
  {id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200},
  {id:'board',primitive:'box',material_ref:null,x_mm:564,y_mm:80,z_mm:18}],
  instances:[{id:'left',definition_id:'side',placement:at(0)},{id:'right',definition_id:'side',placement:at(582)},{id:'bottom',definition_id:'board',placement:at(18)}],views:['front','top']}
 const plan=parameterPlan(recipe)
 const board=plan.bindings.find(b=>b.path==='definitions/board/x_mm')!,right=plan.bindings.find(b=>b.path==='instances/right/placement/x')!
 plan.nodes=plan.nodes.filter(n=>n.id!==board.node&&n.id!==right.node)
 plan.nodes.unshift({id:'width',role:'decision',value:600,unit:'mm',reason:'Synthetic delegated design choice'},
  {id:'sideThickness',role:'decision',value:18,unit:'mm',reason:'Synthetic panel choice'},
  {id:'two',role:'decision',value:2,unit:'scalar',reason:'Two existing side instances'},
  {id:'bothSides',role:'derived',operation:'multiply_v1',operands:['sideThickness','two'],rounding:'exact'},
  {id:board.node,role:'derived',operation:'subtract_v1',operands:['width','bothSides'],rounding:'exact'},
  {id:right.node,role:'derived',operation:'subtract_v1',operands:['width','sideThickness'],rounding:'exact'})
 return {recipe,plan}
}

test('bounded parameter command recomputes canonical dependencies with SQL receipt, version and authority guards',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID(),turn=randomUUID(),message='Create this synthetic frame and change its width within my design choices.'
 const rpc=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'parameter-owner@example.test',outsider,'parameter-outsider@example.test'])
 const project=(await rpc(owner,'bob.create_project',[JSON.stringify({name:'Parameter change fixture'})])).id,solution=randomUUID()
 await rpc(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Frame',description:'Synthetic only',assumptions:'Strength unknown',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await rpc(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic design'})])
 const claim=await rpc(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role'),binding=[project,claim.thread_id,turn,claim.generation]
 const write=(p:any)=>rpc(owner,'bob.bob_project_write_v16',[...binding,JSON.stringify(p)])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Synthetic plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'my design choices',source_seq:null}})
 const {recipe,plan}=assembly()
 const data:any={key:'initial',title:'Frame checkpoint',description:'Synthetic concept; no fabrication approval',area_id:null,target_revision:1,change_note:'Initial',recipe,
  parameters:compileCadParameters(project,recipe,plan,new Map(),new Map()),materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})),
  joints:[{id:'leftJoint',method:'screwed_butt',first:{instance_id:'left',face:'x_max'},second:{instance_id:'bottom',face:'x_min'},reason:'Synthetic concept'},
   {id:'rightJoint',method:'screwed_butt',first:{instance_id:'bottom',face:'x_max'},second:{instance_id:'right',face:'x_min'},reason:'Synthetic concept'}],open_questions:['Hardware and strength unchecked']}
 const initial=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data})
 const id=initial.recordId,read=(revision:number|null=null)=>rpc(owner,'bob.read_construction_draft',[project,id,revision,null])
 const before=await read();let sourceReads=0,allowed=true
 const readSources=async(pins:any)=>{
  sourceReads++;const rows=(await asProjectUser(pg,owner,'select * from bob.current_measurements where project_id=$1',[project])).rows
  return {project:new Map(rows.map((r:any)=>[r.id,r])),physical:new Map()}
 }
 const sqlErrors:string[]=[]
 const writer=()=>createProjectWriter(project,message,async p=>{try{return {data:await write(p),error:null}}catch(e:any){sqlErrors.push([e.message,e.detail,e.where].filter(Boolean).join(' / '));return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const tools=()=>createConstructionTools({projectId:project,message,writer:writer(),hasAccess:async()=>allowed,read:(_id,revision)=>read(revision),readSources,
  prepareParameterChange:async p=>{try{return await rpc(owner,'bob.prepare_construction_parameter_change',[...binding,JSON.stringify(p)])}catch(e:any){return {status:e.code==='PT409'?'conflict':e.code==='42501'?'denied':'invalid',reason:e.message}}}})
 const input:any={key:'width',record_id:id,expected_revision:1,changes:[{id:'width',role:'decision',value:700,unit:'mm',reason:'Synthetic requested design correction'}],change_note:'Change only the width',request_quote:message}
 let updated:any
 await t.test('real tool registration saves one new version and derives dimensions, placement and concept list from it',async()=>{
  const writerInstance=writer(),constructionTools=tools(),session=createBobToolSession({message,writer:writerInstance,constructionTools,lookup:createProjectLookup(project,async()=>({data:[],error:null}),async()=>({data:[],error:null})),readPolicy:seedToolPolicy})
  assert((await session.prepare()).some(x=>x.function.name==='change_construction_parameters'))
  const {request_quote,...modelInput}=input
  updated=await session.execute('change_construction_parameters',modelInput)
  assert.equal(updated.status,'saved',JSON.stringify({updated,sqlErrors}));assert.equal(updated.receipt.recordId,id);assert.equal(updated.receipt.revision,2)
  const after=await read();assert.equal(after.recipe.definitions[1].x_mm,664);assert.equal(after.recipe.instances[1].placement.x,682)
  for(const field of ['materials','joints','open_questions','title','description','area_id','target_revision'])assert.deepEqual(after[field],before[field])
  assert.deepEqual(after.recipe.instances.map((i:any)=>i.id),before.recipe.instances.map((i:any)=>i.id))
  assert.deepEqual((await read(1)).recipe,before.recipe)
  const checked=createConstructionTools({projectId:project,message,hasAccess:async()=>true,read:(_id,r)=>read(r),readSources,
   readCatalog:(id,revision)=>rpc(owner,'bob.catalog_read',[project,JSON.stringify({action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})])})
  const lists=await checked.execute('derive_construction_lists',{artifact_id:id,revision:2,assembly_dependencies:[]})
  assert.equal(lists.checked.concept_ready,true,JSON.stringify(lists));assert.match(JSON.stringify(lists),/664/)
 })
 await t.test('exact retry returns the original receipt without recompilation; changed key payload and stale revision conflict',async()=>{
  const calls=sourceReads,result=await tools().execute('change_construction_parameters',input)
  assert.deepEqual(result,updated);assert.equal(sourceReads,calls)
  assert.equal((await tools().execute('change_construction_parameters',{...input,changes:[{...input.changes[0],value:701}]})).status,'conflict')
  assert.equal((await tools().execute('change_construction_parameters',{...input,key:'stale'})).status,'conflict')
  assert.equal((await read()).revision,2)
 })
 await t.test('unknown, wrong units/roles, formulas, duplicate/missing IDs and model normalised fields never save',async()=>{
  const fresh={...input,key:'invalid',expected_revision:2}
  const unknown=await tools().execute('change_construction_parameters',{...fresh,changes:[{id:'width',role:'unknown',unit:'mm',reason:'No controlling value available'}]})
  assert.equal(unknown.status,'needs_data');assert.equal(unknown.gaps[0].id,'width')
  const calls=sourceReads,twoGaps=await tools().execute('change_construction_parameters',{...fresh,changes:
   ['width','sideThickness'].map(id=>({id,role:'unknown',unit:'mm',reason:'Both controlling values are missing'}))})
  assert.equal(twoGaps.status,'needs_data');assert.deepEqual(twoGaps.gaps.map((g:any)=>g.id),['width','sideThickness'])
  assert.equal(sourceReads,calls,'all known gaps return together before another source read')
  const derived=before.parameters.nodes.find((n:any)=>n.role==='derived')
  for(const changes of [[{...input.changes[0],unit:'deg'}],[{...input.changes[0],role:'estimate'}],[{...input.changes[0],id:'missing'}],
   [input.changes[0],input.changes[0]],[{...input.changes[0],normalized:{value:1,unit:'mm'}}],[{id:derived.id,role:'decision',value:700,unit:'mm',reason:'Replace formula'}]]){
   assert.equal((await tools().execute('change_construction_parameters',{...fresh,changes})).status,'invalid')
  }
  assert.equal((await read()).revision,2)
 })
 await t.test('SQL rejects forged recomputation, geometry, bindings and formulas even through the RPC',async()=>{
  const draft=await read(),changes=[{...input.changes[0],value:750}],computed=await compileConstructionParameterChange(project,draft,changes,readSources)
  const p:any={kind:'construction_parameters',record_id:id,expected_revision:2,expected_updated_at:null,request_quote:message,data:{key:'forged',change_note:'Synthetic attack',changes,computed}}
  for(const mutate of [(x:any)=>x.data.computed.recipe.views=['right'],(x:any)=>x.data.computed.recipe.instances.pop(),
   (x:any)=>x.data.computed.parameters.nodes.find((n:any)=>n.role==='derived').operation='add_v1',
   (x:any)=>x.data.computed.parameters.bindings[0].node='width',
   (x:any)=>x.data.computed.parameters.nodes.find((n:any)=>n.id==='width').normalized.value=999]){
   const attack=structuredClone(p);mutate(attack);await assert.rejects(write(attack),/parameter_change_topology|parameter_result_mismatch/)
  }
  assert.equal((await read()).revision,2)
 })
 await t.test('claim and access guard both preparation and save; revocation before commit stops the tool',async()=>{
  await assert.rejects(rpc(outsider,'bob.prepare_construction_parameter_change',[...binding,JSON.stringify({kind:'construction_parameters',record_id:id,expected_revision:2,expected_updated_at:null,request_quote:message,data:{key:'outsider',change_note:'No authority',changes:input.changes,computed:null}})]),/project_denied|turn_not_claimed/)
  allowed=false;assert.equal((await tools().execute('change_construction_parameters',{...input,key:'denied',expected_revision:2})).status,'denied');allowed=true
  const guarded=createConstructionTools({projectId:project,message,writer:writer(),hasAccess:async()=>allowed,read:(_id,r)=>read(r),readSources,
   prepareParameterChange:async p=>{const result=await rpc(owner,'bob.prepare_construction_parameter_change',[...binding,JSON.stringify(p)]);allowed=false;return result}})
  assert.equal((await guarded.execute('change_construction_parameters',{...input,key:'revoked',expected_revision:2})).status,'denied');allowed=true
  assert.equal((await read()).revision,2)
 })
 await t.test('same source measurement revision is read canonically; fabricated values and source identity substitution are rejected',async()=>{
  const measurement=randomUUID(),fact={subject:'Synthetic outer width',value:'600',unit:'mm',truth:'provided_spec',source:'Synthetic fixture specification',notes:'',required:true}
  await rpc(owner,'bob.evidence_command',[project,'measurement','create',measurement,0,JSON.stringify({...fact,area_id:null,component_id:null})])
  const snapshot:any=(await asProjectUser(pg,owner,'select * from bob.current_measurements where id=$1',[measurement])).rows[0]
  const second=assembly();second.plan.nodes=second.plan.nodes.map(n=>n.id==='width'?{id:'width',role:'source',source:{kind:'project_measurement',id:measurement,revision:1}}:n)
  const d={...data,key:'source',recipe:second.recipe,parameters:compileCadParameters(project,second.recipe,second.plan,new Map([[measurement,snapshot]]),new Map())}
  const checkpoint=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:d})
  await rpc(owner,'bob.evidence_command',[project,'measurement','revise',measurement,1,JSON.stringify({...fact,value:'800',change_note:'Updated canonical specification'})])
  const delta:any={...input,key:'sourceChange',record_id:checkpoint.recordId,expected_revision:1,changes:[{id:'width',role:'source',source:{kind:'project_measurement',id:measurement,revision:2}}]}
  const result=await tools().execute('change_construction_parameters',delta)
  assert.equal(result.status,'saved',JSON.stringify({result,sqlErrors}))
  const back=await rpc(owner,'bob.read_construction_draft',[project,checkpoint.recordId,null,null]);assert.equal(back.recipe.definitions[1].x_mm,764)
  assert.equal(back.parameters.nodes.find((n:any)=>n.id==='width').sources[0].value,'800')
  assert.deepEqual(await tools().execute('change_construction_parameters',delta),result)
  const bad={...delta,key:'sourceForged',expected_revision:2,changes:[{...delta.changes[0],value:900}]}
  assert.equal((await tools().execute('change_construction_parameters',bad)).status,'invalid')
  assert.equal((await tools().execute('change_construction_parameters',{...bad,changes:[{id:'width',role:'source',source:{kind:'project_measurement',id:randomUUID(),revision:2}}]})).status,'invalid')
  await rpc(owner,'bob.evidence_command',[project,'measurement','revise',measurement,2,JSON.stringify({...fact,value:'850',change_note:'Later source head'})])
  const calls=sourceReads;assert.deepEqual(await tools().execute('change_construction_parameters',delta),result);assert.equal(sourceReads,calls,'receipt replay survives later source drift')
 })
 await t.test('two prepared commands cannot both commit an old head; retry preserves the first receipt after a later version',async()=>{
  const draft=await read(),command=(key:string,value:number)=>({kind:'construction_parameters',record_id:id,expected_revision:2,expected_updated_at:null,request_quote:message,
   data:{key,change_note:'Concurrent correction',changes:[{...input.changes[0],value}],computed:null as any}})
  const first=command('concurrentA',710),second=command('concurrentB',720)
  for(const p of [first,second])assert.equal((await rpc(owner,'bob.prepare_construction_parameter_change',[...binding,JSON.stringify(p)])).status,'ready')
  first.data.computed=await compileConstructionParameterChange(project,draft,first.data.changes,readSources)
  second.data.computed=await compileConstructionParameterChange(project,draft,second.data.changes,readSources)
  const receipt=await write(first);assert.equal(receipt.revision,3)
  await assert.rejects(write(second),/construction_changed/)
  assert.equal((await read()).revision,3);assert.equal((await read()).recipe.definitions[1].x_mm,674)
  assert.deepEqual(await write({...first,data:{...first.data,computed:null}}),receipt)
  const calls=sourceReads;assert.deepEqual(await tools().execute('change_construction_parameters',input),updated);assert.equal(sourceReads,calls)
 })
})
