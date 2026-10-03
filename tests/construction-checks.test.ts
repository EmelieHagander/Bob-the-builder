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
