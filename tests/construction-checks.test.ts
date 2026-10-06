import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'

const project='p_fixture', artifact='11111111-1111-4111-8111-111111111111', material='22222222-2222-4222-8222-222222222222'
const placement=(x=0,y=0,z=0,rx=0,ry=0,rz=0)=>({x,y,z,rx,ry,rz})
function fixture(){
 const draft:any={projectId:project,status:'ok',artifact_id:artifact,revision:1,current_revision:1,source_state:'current',archived:false,open_questions:[],
 recipe:{contract_version:1,units:'mm',assembly_id:'case',definitions:[{id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:300,z_mm:800},{id:'panel',primitive:'box',material_ref:null,x_mm:564,y_mm:300,z_mm:18}],
 instances:[{id:'left',definition_id:'side',placement:placement()},{id:'right',definition_id:'side',placement:placement(582)},...[0,391,782].map((z,i)=>({id:'panel'+i,definition_id:'panel',placement:placement(18,0,z)}))],views:['front']},
 materials:['side','panel'].map(definition_id=>({definition_id,material_id:material,material_revision:1,part_id:null,part_revision:null})),
 joints:[0,1,2].flatMap(i=>['left','right'].map(side=>({id:side+i,method:'screwed_butt',first:{instance_id:side,face:side==='left'?'x_max':'x_min'},second:{instance_id:'panel'+i,face:side==='left'?'x_min':'x_max'},reason:'Concept choice'})))}
 const catalog=new Map([[material+'@1',{id:material,revision:1,current_revision:1,kind:'material',source_kind:'design_choice',profile_code:'sheet_stock',categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null}}}]])
 return {draft,catalog}
}
const check=(draft:any,catalog:any)=>checkConstruction(draft,catalog,'2026-10-03')
test('construction save identifies missing binding paths so the same request can correct them without a lookup retry',async()=>{
 const {parameterPlan}=await import('./support/cad-parameter-fixture.ts')
 const {draft}=fixture(),message='Save this shelf concept.'
 const plan=parameterPlan(draft.recipe),paths=plan.bindings.map(b=>b.path)
 const dotted=structuredClone(plan);dotted.bindings.forEach(b=>b.path=b.path.replaceAll('/','.'))
 let writes=0,sourceFailed=false,persisted:any
 const tools=createConstructionTools({projectId:project,message,hasAccess:async()=>true,read:async()=>null,
  readSources:async()=>{if(sourceFailed)throw Error('private network diagnostic');return {project:new Map(),physical:new Map()}},
  writer:{commit:async payload=>{writes++;persisted=payload;return {status:'saved'}}} as any})
 const input={key:'initial',record_id:null,expected_revision:0,title:'Shelf',description:'Synthetic concept',area_id:null,target_revision:1,change_note:'Initial',recipe:draft.recipe,parameter_plan:dotted,materials:draft.materials,joints:draft.joints,open_questions:[],request_quote:message}
 const rejected=await tools.execute('save_construction_draft',input)
 assert.equal(rejected.status,'invalid');assert.deepEqual(rejected.unbound,paths);assert.equal(writes,0)
 const corrected=await tools.execute('save_construction_draft',{...input,parameter_plan:plan})
 assert.equal(corrected.status,'saved');assert.equal(writes,1);assert.equal(persisted.data.parameters.coverage,'complete')
 assert.deepEqual(persisted.data.recipe,draft.recipe)
 sourceFailed=true
 const unavailable=await tools.execute('save_construction_draft',{...input,parameter_plan:plan})
 assert.equal(unavailable.status,'unavailable');assert(!JSON.stringify(unavailable).includes('private network diagnostic'));assert.equal(writes,1)
})
test('complete five-part concept passes with six contacts and physical joint cycles; no product or strength approval',()=>{
 const {draft,catalog}=fixture(),r=check(draft,catalog)
 assert.equal(r.concept_ready,true,JSON.stringify(r.issues));assert.equal(r.fabrication_ready,false)
 assert.deepEqual(r.bounds_mm.size,[600,300,800]);assert.equal(r.part_count,5);assert.equal(r.joint_count,6)
 assert(r.fabrication_gaps.some(g=>g.code==='product_specification_unverified'))
 assert(r.fabrication_gaps.some(g=>g.code==='joint_product_and_capacity_unverified'))
 assert.equal(r.joint_checks.length,6);assert(r.joint_checks.every((j:any)=>j.reference.id==='timber.fasteners'))
})
test('independent geometry catches reversed face, wrong span, missing joint, collision and unsupported operation',()=>{
 const cases:Array<[string,(d:any)=>void]>=[
  ['joint_faces_do_not_meet',d=>{d.joints[0].first.face='x_min'}],
  ['joint_faces_do_not_meet',d=>{d.recipe.definitions[1].x_mm=550}],
  ['contact_without_joint',d=>{d.joints.pop()}],
  ['part_collision',d=>{d.recipe.instances[2].placement.x=10}],
  ['unsupported_rotation',d=>{d.recipe.instances[0].placement.rz=45}],
  ['unsupported_joint_method',d=>{d.joints[0].method='dowel'}],
  ['disconnected_parts',d=>{d.recipe.instances[4].placement.z=1000}],
 ]
 for(const [code,change] of cases){const {draft,catalog}=fixture();change(draft);const r=check(draft,catalog);assert.equal(r.concept_ready,false,code);assert(r.issues.some(i=>i.code===code),JSON.stringify(r.issues))}
})
test('catalog dimensions, material applicability, unknowns and stale sources fail closed',()=>{
 for(const [code,change] of [
  ['material_thickness_mismatch',(m:any)=>{m.properties.thickness.value='21'}],
  ['material_dimension_unknown',(m:any)=>{m.properties.thickness.truth='estimated'}],
  ['joint_material_not_supported',(m:any)=>{m.categories=['steel','sheet']}],
  ['unsupported_material_profile',(m:any)=>{m.profile_code='liquid'}],
  ['material_unavailable_or_changed',(m:any)=>{m.current_revision=2}],
 ] as const){const {draft,catalog}=fixture();change(catalog.get(material+'@1'));const r=check(draft,catalog);assert(!r.concept_ready);assert(r.issues.some(i=>i.code===code),code)}
 const {draft,catalog}=fixture();draft.source_state='changed';assert(check(draft,catalog).issues.some(i=>i.code==='checkpoint_not_current'))
 draft.source_state='current';draft.current_revision=2;assert(!check(draft,catalog).concept_ready)
})
test('generic rotated bracket uses local face normals and adhesive source; expired knowledge blocks',()=>{
 const {draft,catalog}=fixture()
 draft.recipe.definitions=[{id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200},{id:'panel',primitive:'box',material_ref:null,x_mm:100,y_mm:80,z_mm:18}]
 draft.recipe.instances=[{id:'upright',definition_id:'side',placement:placement()},{id:'arm',definition_id:'panel',placement:placement(118,80,0,0,0,180)}]
 draft.joints=[{id:'corner',method:'glued_butt',first:{instance_id:'upright',face:'x_max'},second:{instance_id:'arm',face:'x_max'},reason:'Different dimensions and rotated local axes'}]
 const r=check(draft,catalog);assert(r.concept_ready,JSON.stringify(r.issues));assert.deepEqual(r.bounds_mm.size,[118,80,200]);assert.equal(r.joint_checks[0].reference.id,'timber.adhesives')
 assert(checkConstruction(draft,catalog,'2028-01-01').issues.some(i=>i.code==='joint_knowledge_unavailable'))
 draft.recipe.instances[1].placement.rz=0;assert(!check(draft,catalog).concept_ready)
})
test('exact catalog panel dimensions cannot be replaced by an unfounded named product choice',()=>{
 const {draft,catalog}=fixture();const part='33333333-3333-4333-8333-333333333333'
 draft.materials[1].part_id=part;draft.materials[1].part_revision=1
 catalog.set(part+'@1',{id:part,kind:'part',revision:1,current_revision:1,material_id:material,material_revision:1,profile_code:'panel',properties:Object.fromEntries(Object.entries({thickness:'18',width:'300',length:'564'}).map(([k,value])=>[k,{value,unit:'mm',truth:'provided_spec',parameter:null}]))} as any)
 assert(check(draft,catalog).concept_ready)
 ;(catalog.get(part+'@1') as any).properties.length.value='500'
 assert(check(draft,catalog).issues.some(i=>i.code==='part_dimensions_mismatch'))
})
test('tool re-reads canonical revision and catalog; access revocation, forged responses and read errors never approve',async()=>{
 const {draft,catalog}=fixture();let allowed=true,changed=false,reads=0,wrongProject=false,fail=false
 const tools=()=>createConstructionTools({projectId:project,message:'check',hasAccess:async()=>allowed,now:()=>new Date('2026-10-03'),
 read:async()=>{reads++;return {...draft,current_revision:changed?2:1,revision:changed?2:1}},readSources:async()=>({project:new Map(),physical:new Map()}),
 readCatalog:async(id,revision)=>{if(fail)throw Error('network');return {status:'ok',projectId:wrongProject?'other':project,record:catalog.get(id+'@'+revision)}}})
 const run=()=>tools().execute('check_construction_draft',{artifact_id:artifact,revision:1})
 assert.equal((await run()).concept_ready,true);assert.equal(reads,2)
 allowed=false;assert.equal((await run()).status,'denied');allowed=true
 wrongProject=true;assert.equal((await run()).status,'unavailable');wrongProject=false
 fail=true;assert.equal((await run()).status,'unavailable');fail=false
 changed=true;assert.notEqual((await run()).concept_ready,true)
 let count=0
 const concurrent=createConstructionTools({projectId:project,message:'check',hasAccess:async()=>true,readSources:async()=>({project:new Map(),physical:new Map()}),
 read:async()=>({...draft,revision:++count===1?1:2}),readCatalog:async()=>({status:'ok',projectId:project,record:catalog.get(material+'@1')})})
 assert.equal((await concurrent.execute('check_construction_draft',{artifact_id:artifact,revision:1})).status,'conflict')
})

test('caller SQL checkpoint and exact normalized catalog feed a successful real check-tool result',async t=>{
 const {projectSchema,asProjectUser}=await import('./support/project-schema.ts')
 const {parameterPlan}=await import('./support/cad-parameter-fixture.ts')
 const {createProjectWriter}=await import('../supabase/functions/_shared/project-write.ts')
 const {randomUUID}=await import('node:crypto')
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),turn=randomUUID(),solution=randomUUID(),message='Create the synthetic concept.'
 const rpc=async(name:string,args:unknown[],service=false):Promise<any>=>(await asProjectUser(pg,service?null:owner,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,service?'service_role':'authenticated')).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'k2-owner@example.test'])
 const projectId=(await rpc('bob.create_project',[JSON.stringify({name:'K2 fixture'})])).id
 await rpc('bob.solution_command',[projectId,'create',solution,0,JSON.stringify({area_id:null,title:'Synthetic concept',description:'No physical safety approval',assumptions:'Product checks open',tradeoffs:'Simple',measurements:[]})])
 await rpc('bob.solution_command',[projectId,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic test target'})])
 const claim=await rpc('bob.bob_claim_turn',[projectId,owner,turn,message],true)
 const write=(payload:any)=>rpc('bob.bob_project_write_v14',[projectId,claim.thread_id,turn,claim.generation,JSON.stringify(payload)])
 const mat=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Plywood concept',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'1.8',unit:'cm',truth:'provided_spec',parameter:null,note:'Declared synthetic choice'}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const writer=createProjectWriter(projectId,message,async p=>({data:await write(p),error:null}),async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const tools=createConstructionTools({projectId,message,writer,hasAccess:async()=>true,now:()=>new Date('2026-10-03'),
 read:(id,revision,after)=>rpc('bob.read_construction_draft',[projectId,id,revision,after]),
 readSources:async()=>({project:new Map(),physical:new Map()}),
 readCatalog:(id,revision)=>rpc('bob.catalog_read',[projectId,JSON.stringify({action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})])})
 const {draft}=fixture();draft.materials.forEach((m:any)=>m.material_id=mat.recordId)
 const saved=await tools.execute('save_construction_draft',{key:'initial',record_id:null,expected_revision:0,title:'Five-part concept',description:'Synthetic only',area_id:null,target_revision:1,change_note:'Initial',recipe:draft.recipe,parameter_plan:parameterPlan(draft.recipe),materials:draft.materials,joints:draft.joints,open_questions:[],request_quote:message})
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const checked=await tools.execute('check_construction_draft',{artifact_id:saved.receipt.recordId,revision:1})
 assert.equal(checked.status,'checked',JSON.stringify(checked));assert.equal(checked.concept_ready,true,JSON.stringify(checked.issues));assert.equal(checked.fabrication_ready,false)
 assert.deepEqual(checked.bounds_mm.size,[600,300,800]);assert.equal(checked.joint_count,6)
 const before=await rpc('bob.read_construction_draft',[projectId,saved.receipt.recordId,1,null])
 const fit=await tools.execute('check_construction_cut_fit',{artifact_id:saved.receipt.recordId,revision:1,
  candidates:[{id:'candidate',material_id:mat.recordId,material_revision:1,length_mm:2440,width_mm:1220,thickness_mm:18,count:1,kerf_mm:3,trim_mm:5,grain:'length',basis:'design_choice',note:'Synthetic candidate, not physical stock'}],
  blank_grain:before.recipe.definitions.map((d:any)=>({definition_id:d.id,axis:d.x_mm===18?'z':'x'}))})
 assert.equal(fit.status,'feasible',JSON.stringify(fit));assert.equal(fit.placements.length,5);assert.equal(fit.stock_reserved,false)
 assert.deepEqual(await rpc('bob.read_construction_draft',[projectId,saved.receipt.recordId,1,null]),before)
 assert.equal((await asProjectUser(pg,owner,"select active from bob.tool_catalog where name='check_construction_cut_fit'")).rows[0].active,true)
 assert.equal((await pg.query('select count(*) n from bob.artifact_cad_revisions where artifact_id=$1',[saved.receipt.recordId])).rows[0].n,0)
})
