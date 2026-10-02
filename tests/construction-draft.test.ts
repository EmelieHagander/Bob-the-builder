import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'
import type {CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'

export function shelf(){
 const placement=(x:number,z:number)=>({x,y:0,z,rx:0,ry:0,rz:0})
 const recipe:CadAssemblyRequest={contract_version:1,units:'mm',assembly_id:'assembly',definitions:[
  {id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:300,z_mm:800},
  {id:'between',primitive:'box',material_ref:null,x_mm:564,y_mm:300,z_mm:18},
 ],instances:[{id:'left',definition_id:'side',placement:placement(0,0)},{id:'right',definition_id:'side',placement:placement(582,0)},
  ...[0,391,782].map((z,i)=>({id:'board'+i,definition_id:'between',placement:placement(18,z)}))],views:['front','top']}
 const plan=parameterPlan(recipe)
 const bind=plan.bindings.find(b=>b.path==='definitions/between/x_mm')!
 plan.nodes=plan.nodes.filter(n=>n.id!==bind.node)
 plan.nodes.unshift({id:'outerWidth',role:'decision',value:600,unit:'mm',reason:'Explicit synthetic width choice'},
  {id:'thickness',role:'decision',value:18,unit:'mm',reason:'Explicit synthetic material choice'},
  {id:'two',role:'decision',value:2,unit:'scalar',reason:'Two side instances'},
  {id:'bothSides',role:'derived',operation:'multiply_v1',operands:['thickness','two'],rounding:'exact'},
  {id:bind.node,role:'derived',operation:'subtract_v1',operands:['outerWidth','bothSides'],rounding:'exact'})
 // Bind all thickness-dependent dimensions/placements to the same decision.
 for(const path of ['definitions/side/x_mm','definitions/between/z_mm',...['board0','board1','board2'].map(id=>'instances/'+id+'/placement/x')]){
  const b=plan.bindings.find(b=>b.path===path)!;plan.nodes=plan.nodes.filter(n=>n.id!==b.node);b.node='thickness'
 }
 const right=plan.bindings.find(b=>b.path==='instances/right/placement/x')!
 plan.nodes=plan.nodes.filter(n=>n.id!==right.node)
 plan.nodes.push({id:right.node,role:'derived',operation:'subtract_v1',operands:['outerWidth','thickness'],rounding:'exact'})
 return {recipe,plan}
}

test('K1 claimed tools create/read/revise the same construction; SQL authority, pins and history',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),member=randomUUID(),outsider=randomUUID(),message='Create and revise this construction with my design choices.'
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'k1-owner@example.test',member,'k1-member@example.test',outsider,'k1-outsider@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'K1 fixture'})])).id
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,'Member','M',$3)",[randomUUID(),project,member])
 const solution=randomUUID()
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Construction',description:'Synthetic concept',assumptions:'Checks open',tradeoffs:'Simple',measurements:[]})])
 await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic target'})])
 let turn=randomUUID(),claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 const save=(p:any)=>call(owner,'bob.bob_project_write_v14',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 const read=(id:string|null,revision:number|null=null,uid=owner)=>call(uid,'bob.read_construction_draft',[project,id,revision,null])
 const catalog:any={kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'mat',kind:'material',name:'Synthetic plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'my design choices',source_seq:null}}
 const material=await save(catalog)
 const {recipe,plan}=shelf()
 const input:any={key:'initial',record_id:null,expected_revision:0,title:'Construction checkpoint',description:'Synthetic only',area_id:null,target_revision:1,change_note:'Initial design',recipe,parameter_plan:plan,
  materials:recipe.definitions.map(d=>({definition_id:d.id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})),
  joints:[{id:'jointLeft',method:'screwed_butt',first:{instance_id:'left',face:'x_max'},second:{instance_id:'board0',face:'x_min'},reason:'Synthetic design choice; fasteners unresolved'}],
  open_questions:['Fastener size/count and joint fit unchecked'],request_quote:message}
 const payload=(v:any)=>{const {record_id,expected_revision,request_quote,parameter_plan,...data}=structuredClone(v);return {kind:'construction',record_id,expected_revision,expected_updated_at:null,request_quote,data:{...data,parameters:compileCadParameters(project,data.recipe,parameter_plan,new Map(),new Map())}}}
 const writer=createProjectWriter(project,message,async p=>{try{return {data:await save(p),error:null}}catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const tools=createConstructionTools({projectId:project,message,writer,hasAccess:async()=>true,read:(id,revision)=>read(id,revision),readSources:async()=>({project:new Map(),physical:new Map()})})
 const session=createBobToolSession({message,writer,constructionTools:tools,lookup:createProjectLookup(project,async()=>({data:[],error:null}),async()=>({data:[],error:null})),readPolicy:seedToolPolicy})
 // Real handler registration and seed policy; no renderer/model call required.
 assert(tools.tools.some(x=>x.function.name==='save_construction_draft'))
 const offered=await session.prepare();assert(offered.some(x=>x.function.name==='save_construction_draft'))
 const first=await session.execute('save_construction_draft',input)
 assert.equal(first.status,'saved',JSON.stringify(first));const id=first.receipt.recordId
 assert.equal(first.receipt.record.construction_status,'draft');assert.equal(first.receipt.record.rendered,false)
 assert.deepEqual(await save(payload(input)),first.receipt,'exact replay returns original receipt')
 const stored=await read(id);assert.equal(stored.recipe.definitions[1].x_mm,564);assert.equal(stored.source_state,'current')
 assert.equal((await read(null)).items[0].id,id);assert.equal((await read(id,null,member)).artifact_id,id)
 assert.equal((await pg.query('select count(*) n from bob.artifact_cad_revisions where artifact_id=$1',[id])).rows[0].n,0)
 assert.doesNotMatch(JSON.stringify(stored),/source_quote|thread_id|turn_id/)
 await t.test('authority is enforced at RPC and raw table boundaries',async()=>{
  await assert.rejects(read(id,null,outsider),/project_denied/)
  await assert.rejects(call(outsider,'bob.bob_project_write_v14',[project,claim.thread_id,turn,claim.generation,JSON.stringify(payload(input))]),/project_denied|turn_not_claimed/)
  assert.equal((await asProjectUser(pg,outsider,'select * from bob.artifact_construction_revisions')).rows.length,0)
  await assert.rejects(asProjectUser(pg,owner,'update bob.artifact_construction_revisions set joints=joints where artifact_id=$1',[id]),/permission denied/)
  await assert.rejects(pg.query('update bob.artifact_construction_revisions set joints=joints where artifact_id=$1',[id]),/construction_revision_immutable/)
 })
 const next=structuredClone(input);next.record_id=id;next.expected_revision=1;next.key='width';next.parameter_plan.nodes.find((n:any)=>n.id==='outerWidth').value=700
 const updated=await session.execute('save_construction_draft',next)
 assert.equal(updated.status,'saved',JSON.stringify(updated));assert.equal(updated.receipt.recordId,id);assert.equal(updated.receipt.revision,2)
 assert.equal((await read(id)).recipe.definitions[1].x_mm,664);assert.deepEqual((await read(id)).recipe.instances.map((i:any)=>i.id),stored.recipe.instances.map((i:any)=>i.id))
 assert.deepEqual((await read(id,1)).recipe,stored.recipe)
 await t.test('lost update, broken references, wrong units and reused identities are rejected',async()=>{
  await assert.rejects(save(payload({...next,key:'stale'})),/construction_changed/)
  const edit={...next,key:'bad',expected_revision:2};
  for(const [change,expected] of [
   [(p:any)=>{p.data.joints[0].second.instance_id='missing'},/joint_endpoint/],
   [(p:any)=>{p.data.recipe.units='cm'},/invalid_construction_recipe/],
   [(p:any)=>{p.data.parameters.nodes[0].normalized.value=123},/parameter_result_mismatch/],
   [(p:any)=>{p.data.recipe.instances[0].definition_id='between'},/construction_identity_reused/],
   [(p:any)=>{p.data.joints[0].second.instance_id='board1'},/construction_identity_reused/],
   [(p:any)=>{p.data.parameters.bindings.pop()},/unbound_required_parameter/],
  ] as const){const p=payload(edit);change(p);await assert.rejects(save(p),expected)}
  await assert.rejects(call(owner,'bob.artifact_command',[project,'revise',id,2,JSON.stringify({})]),/use_construction_draft_tool/)
  assert.equal((await read(id)).revision,2)
 })
 await t.test('material changes flag history and stop stale new checkpoints',async()=>{
  const changed=structuredClone(catalog);changed.record_id=material.recordId;changed.expected_revision=1;changed.data.action='revise';changed.data.key='thicker';changed.data.properties.thickness.value='21'
  await save(changed)
  assert.equal((await read(id)).source_state,'changed')
  await assert.rejects(save(payload({...next,key:'staleMaterial',expected_revision:2})),/material_changed/)
  const thick=structuredClone(next);thick.key='thickness';thick.expected_revision=2;thick.materials.forEach((m:any)=>m.material_revision=2);thick.parameter_plan.nodes.find((n:any)=>n.id==='thickness').value=21
  const third=await save(payload(thick));assert.equal(third.revision,3);assert.equal((await read(id)).recipe.definitions[1].x_mm,658)
  assert.equal((await read(id,1)).materials[0].material_revision,1)
 })
 await t.test('archive/restore preserve exact construction and old source pins',async()=>{
  await call(owner,'bob.artifact_command',[project,'archive',id,3,'{}'])
  assert.equal((await read(id)).archived,true);assert.equal((await read(null)).items.length,0)
  await call(owner,'bob.artifact_command',[project,'restore',id,4,'{}'])
  assert.equal((await read(id)).revision,5);assert.deepEqual((await read(id)).joints,stored.joints)
 })
 await t.test('generic second construction pins real measurements and permits physical joint cycles',async()=>{
  const measurement=randomUUID(),fact={subject:'Rail length',value:'100',unit:'cm',truth:'provided_spec',source:'Synthetic owner specification',required:true}
  await call(owner,'bob.evidence_command',[project,'measurement','create',measurement,0,JSON.stringify(fact)])
  const row:any=(await asProjectUser(pg,owner,'select * from bob.current_measurements where id=$1',[measurement])).rows[0]
  const other=structuredClone(input);other.key='other';other.title='Three rails';other.recipe.assembly_id='other';other.recipe.instances=other.recipe.instances.slice(0,3)
  other.materials.forEach((m:any)=>m.material_revision=2)
  other.parameter_plan=parameterPlan(other.recipe,[{definition_id:'side',dimension:'z_mm',measurement_id:measurement,revision:1}])
  const names=other.recipe.instances.map((i:any)=>i.id)
  other.joints=names.map((id:string,i:number)=>({id:'edge'+i,method:'unresolved',first:{instance_id:id,face:'x_min'},second:{instance_id:names[(i+1)%names.length],face:'x_max'},reason:'Unresolved synthetic connection'}))
  const {parameter_plan,...data}=other
  const p:any=payload({...other,parameter_plan:parameterPlan(other.recipe)})
  p.data.parameters=compileCadParameters(project,p.data.recipe,parameter_plan,new Map([[measurement,row]]),new Map())
  const saved=await save(p);assert.equal((await read(saved.recordId)).recipe.definitions[0].z_mm,1000)
  assert.equal((await read(saved.recordId)).joints.length,3,'Physical connection graph is allowed to contain cycles')
  await call(owner,'bob.evidence_command',[project,'measurement','revise',measurement,1,JSON.stringify({...fact,value:'110',change_note:'Changed specification'})])
  assert.equal((await read(saved.recordId)).source_state,'changed')
  const stale=structuredClone(p);stale.data.key='staleSource';stale.record_id=saved.recordId;stale.expected_revision=1
  await assert.rejects(save(stale),/measurement.*changed|stale_measurement|measurement.*revision/i)
  assert.equal((await read(saved.recordId,1)).recipe.definitions[0].z_mm,1000)
 })
 await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
})
