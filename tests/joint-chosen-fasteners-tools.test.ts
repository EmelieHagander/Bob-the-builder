// Joints held by catalog items the designer chose (owner decision 2026-11-01):
// the tools, the saved shape and the readers of several fastener rows per joint.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {JOINT_CHOSEN_FASTENERS_SCHEMA,storedChosenJoints,withChosenJointFasteners,type FastenerSchedule} from '../supabase/functions/_shared/construction-fasteners.ts'
import {constructionTable} from '../supabase/functions/_shared/construction-views.ts'
import {constructionLists} from '../supabase/functions/_shared/construction-lists.ts'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {schemaIssues} from '../supabase/functions/_shared/schema-issues.ts'
import {listFixture} from './construction-lists.test.ts'

const screw='00000000-0000-4000-8000-0000000000a1',glue='00000000-0000-4000-8000-0000000000a2'
const chosen=[{material_id:screw,material_revision:1,count:null,spacing_mm:null},{material_id:glue,material_revision:1,count:null,spacing_mm:null}]
const opts={projectId:'p',message:'Build',writer:{} as any,hasAccess:async()=>true,read:async()=>({}),readSources:async()=>({project:new Map(),physical:new Map()})}
const tool=(extra:Record<string,unknown>,name:string)=>createConstructionTools({...opts,...extra} as any).tools.find(t=>t.function.name===name)!
const jointItems=(t:any,name:string)=>name==='save_construction_draft'?t.function.parameters.properties.joints.items:t.function.parameters.properties.changes.properties.joints.properties.upsert.items

test('pinned turns keep method and rule fastener; the new manifest asks for the chosen list in save and edit alike',()=>{
 for(const name of ['save_construction_draft','edit_construction_parts']){
  const old=jointItems(tool({},name),name),now=jointItems(tool({chosenJointFasteners:true},name),name)
  assert.deepEqual(Object.keys(old.properties),['id','method','first','second','reason','fastener'],name)
  assert.deepEqual(Object.keys(now.properties),['id','first','second','reason','fasteners'],name)
  assert.deepEqual(now.required,['id','first','second','reason','fasteners'])
  assert.deepEqual(now.properties.fasteners,JOINT_CHOSEN_FASTENERS_SCHEMA)
  const joint={id:'j',first:{instance_id:'a',face:'x_max'},second:{instance_id:'b',face:'x_min'},reason:'Glue and screws',fasteners:chosen}
  assert.deepEqual(schemaIssues(now,joint),[]);assert(schemaIssues(old,joint).length>0)
 }
 assert.equal(withChosenJointFasteners({a:1}).a,1,'other schemas pass through')
})

test('a chosen joint is saved as a butt joint carrying exactly the chosen list',()=>{
 const joint={id:'j',first:{instance_id:'a',face:'x_max'},second:{instance_id:'b',face:'x_min'},reason:'Glue and screws',fasteners:chosen}
 assert.deepEqual(storedChosenJoints([joint]),[{id:'j',method:'butt',first:joint.first,second:joint.second,reason:'Glue and screws',fasteners:chosen}])
})

// Schedule rows as bob_private.construction_fastener_schedule returns them for butt joints.
const row=(joint_id:string,kind:string|null,d:number|null,l:number|null,count:number|null,material_id:string|null,extra:Record<string,unknown>={})=>({joint_id,method:'butt',source:material_id?'chosen':'none',kind,diameter_mm:d,length_mm:l,count,spacing_mm:count?100:null,
 through_instance_id:'left',through_mm:21,embed_mm:658,contact_length_mm:300,contact_width_mm:21,proposal:null,gaps:[],material_id,material_revision:material_id?1:null,...extra})

test('readers show every chosen item of a joint; one-row joints keep their former shape',()=>{
 const {draft,catalog}=listFixture()
 draft.joints=storedChosenJoints(draft.joints.map((j:any)=>({...j,fasteners:j.id==='left0'?chosen:[{...chosen[0]}]})))
 const joints=draft.joints.flatMap((j:any)=>j.id==='left0'?[row(j.id,'screw',4,45,3,screw),row(j.id,'glue',null,null,null,glue)]:[row(j.id,'screw',4,45,3,screw)])
 const schedule:FastenerSchedule={status:'ok',rule_version:'fastener-rules-v1',complete:true,glue_packages:1,joints,totals:[{kind:'screw',diameter_mm:4,length_mm:45,count:18,joint_ids:draft.joints.map((j:any)=>j.id)}]}
 const table=constructionTable(draft,schedule)
 const cells=new Map(table.joints.rows.map((r:any)=>[r[0],r[4]]))
 assert.deepEqual(cells.get('left0'),[['chosen','screw',4,45,3,[]],['chosen','glue',null,null,null,[]]])
 assert.deepEqual(cells.get('right0'),['chosen','screw',4,45,3,[]])
 assert.deepEqual(table.joints.rows.find((r:any)=>r[0]==='left0').slice(0,2),['left0','butt'])
 const lists:any=constructionLists(draft,catalog,[],schedule)
 const left=lists.joints.find((j:any)=>j.joint_id==='left0'),right=lists.joints.find((j:any)=>j.joint_id==='right0')
 assert.equal(left.hardware_quantity,3);assert.equal(left.adhesive_quantity,'shared_package')
 assert.deepEqual(left.fasteners.map((f:any)=>[f.kind,f.material_id]),[['screw',screw],['glue',glue]])
 assert.equal(right.fastener.material_id,screw);assert.equal(right.fastener.source,'chosen')
 assert.equal(lists.fasteners.basis,'chosen_catalog_items')
})

test('the model check accepts a butt joint with chosen items and asks for them when the list is empty',()=>{
 const {draft,catalog}=listFixture()
 draft.joints=storedChosenJoints(draft.joints.map((j:any)=>({...j,fasteners:j.id==='left0'?[]:chosen})))
 const result=checkConstruction(draft,catalog,'2026-11-01',true)
 assert(!result.issues.some((i:any)=>i.code==='unsupported_joint_method'))
 assert.deepEqual(result.issues.filter((i:any)=>i.code==='joint_fasteners_missing').map((i:any)=>i.ids[0]),['left0'])
})

test('added hardware: sizes follow how it is counted; screws, nails and bolts need a size; glue counts per construction',async()=>{
 const {catalogFastenerWrite,MATERIAL_CATEGORIES}=await import('../supabase/functions/_shared/material-catalog.ts')
 const add=(patch:Record<string,unknown>)=>catalogFastenerWrite({key:'k',name:'Item',kind:'dowel',counting:'along_contact',material_category:'wood',diameter_mm:8,length_mm:40,request_quote:'q',...patch}) as any
 assert.equal(add({}).payload.data.profile_code,'joint_hardware')
 assert.deepEqual(add({}).payload.data.categories,['wood','fastener'])
 assert.deepEqual(add({diameter_mm:null}).issue.fields,['diameter_mm','length_mm'])
 assert.deepEqual(add({kind:'glue',counting:'per_construction',diameter_mm:null,length_mm:null}).payload.data.properties.fastener_counting.value,'per_construction')
 assert.deepEqual(add({kind:'glue',counting:'per_joint',diameter_mm:null,length_mm:null}).issue.fields,['counting'])
 assert.deepEqual(add({kind:'screw',counting:'per_joint',diameter_mm:null,length_mm:null}).issue.fields,['diameter_mm','length_mm'])
 assert.deepEqual(add({kind:'bracket',counting:'per_joint',diameter_mm:null,length_mm:null,material_category:'metal'}).payload.data.properties,
  {fastener_kind:{value:'bracket',unit:null,truth:'provided_spec',parameter:null,note:'Vald av konstruktören.'},fastener_counting:{value:'per_joint',unit:null,truth:'provided_spec',parameter:null,note:'Vald av konstruktören.'}})
 assert.equal(add({material_category:'unobtainium'}),null);assert(MATERIAL_CATEGORIES.includes('adhesive'))
})
