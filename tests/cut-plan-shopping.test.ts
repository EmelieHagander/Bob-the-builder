import {test} from 'node:test'
import assert from 'node:assert/strict'
import {constructionCutFit} from '../supabase/functions/_shared/construction-cut-fit.ts'
import {constructionLists} from '../supabase/functions/_shared/construction-lists.ts'
import {cutPlanFixture} from './support/cut-plan-fixture.ts'
import {parseProjectWrite,createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {OPERATION_WRITE_TOOLS} from '../supabase/functions/_shared/project-operations.ts'
import {schemaIssues} from '../supabase/functions/_shared/schema-issues.ts'
import {asProjectUser} from './support/project-schema.ts'

async function purchaseFixture(t:any){
 const f=await cutPlanFixture(t)
 const part=await f.write({...f.base,kind:'catalog',data:{action:'ensure',key:'panel',kind:'part',name:'Fixture raw panel',aliases:[],profile_code:'panel',profile_revision:1,categories:['wood.plywood','sheet'],properties:{length:{value:'2440',unit:'mm',truth:'provided_spec',parameter:null,note:''},width:{value:'1220',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:f.material.recordId,material_revision:1,notes:'Format only, no supplier',source_kind:'design_choice',source_quote:'existing blanks',source_seq:null}})
 const p=structuredClone(f.payload);p.data.candidate_sources[0]={candidate_id:'sheet',kind:'catalog_part',record_id:part.recordId,revision:1}
 p.data.candidates[0].count=3 // Only actual used sheets count, not offered capacity.
 const fit:any=constructionCutFit(constructionLists(f.draft,f.catalog,[]),p.data.candidates,f.blank_grain)
 p.data.layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
 const saved=await f.write(p)
 const command=(action='publish',rev=0,uid=f.user)=>f.rpc('bob.material_cut_plan_shopping_command',[f.project,action,saved.recordId,1,rev,'Explicit purchase plan'],uid)
 const payload=(action='publish',rev=0)=>({...f.base,kind:'cut_plan_shopping',record_id:saved.recordId,expected_revision:1,data:{action,shopping_revision:rev,change_note:'Explicit purchase plan'}})
 const writeShopping=(p:any)=>f.rpc('bob.bob_project_write_v16',[f.project,f.claim.thread_id,f.turn,f.claim.generation,JSON.stringify(p)])
 return {...f,part,p,saved,command,purchasePayload:payload,writeShopping}
}

test('catalog cut plan publishes actual whole sheets, normal receipts and immutable provenance',async t=>{
 const f=await purchaseFixture(t)
 const before=(await f.pg.query('select to_jsonb(r) row from bob.material_requirement_revisions r where project_id=$1 order by requirement_id,revision',[f.project])).rows
 const used=f.p.data.layout.used_sheets.length;assert(used>0 && used<3)
 const receipt=await f.writeShopping(f.purchasePayload())
 assert.equal(receipt.record.shopping_revision,1);assert.equal(receipt.record.shopping_ready,true)
 assert.equal(receipt.record.stock_reserved,false);assert.equal(receipt.record.fabrication_ready,false);assert.equal(receipt.record.input_evidence_verified,false)
 assert.deepEqual(await f.writeShopping(f.purchasePayload()),receipt)
 const pub=(await f.read(f.saved.recordId)).shopping
 assert.equal(pub.contributions.length,1);assert.equal(pub.contributions[0].quantity,used)
 const materialId=pub.contributions[0].material_id
 const items=await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'shopping',record_id:materialId,after_id:null})])
 assert.equal(items.records[0].qty,`${used} pcs`);assert.equal(items.records[0].cut_plan_source.product_verified,false)
 assert.equal(items.records[0].cut_plan_source.contributions[0].plan_id,f.saved.recordId)
 assert.equal(items.records[0].cut_plan_source.source_state,'not_checked')
 assert.deepEqual((await f.pg.query('select to_jsonb(r) row from bob.material_requirement_revisions r where project_id=$1 order by requirement_id,revision',[f.project])).rows,before)
 await assert.rejects(f.writeShopping({...f.purchasePayload(),data:{...f.purchasePayload().data,change_note:'Changed replay'}}),/operation_reused/)
 await assert.rejects(f.command('withdraw',0),/shopping_changed/)
 await assert.rejects(f.writeShopping({...f.purchasePayload(),data:{...f.purchasePayload().data,quantity:5}}),/invalid_shopping/)
 await assert.rejects(f.write({...f.p,record_id:f.saved.recordId,expected_revision:1,data:{...f.p.data,key:'changed'}}),/withdraw_required/)
 await f.pg.query("update bob.materials set supplier='Retained supplier',cost='123 kr' where id=$1",[materialId])
 await f.command('withdraw',1)
 assert.equal((await f.read(f.saved.recordId)).shopping.published,false)
 const item=(await f.pg.query('select * from bob.materials where id=$1',[materialId])).rows[0]
 assert.equal(item.qty,'0 pcs');assert.equal(item.supplier,'Retained supplier');assert.equal(item.cost,'123 kr')
 assert.equal((await f.pg.query('select count(*)::int n from bob.cut_plan_shopping_contributions where plan_id=$1',[f.saved.recordId])).rows[0].n,1)
 await f.command('publish',2);assert.equal((await f.read(f.saved.recordId)).shopping_revision,3)
 assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,1)
})

test('Shopping edits, committed purchases and deleted rows never get silently replaced',async t=>{
 const f=await purchaseFixture(t),p=await f.command(),mid=p.shopping.contributions[0].material_id
 await f.pg.query("update bob.materials set qty='9 pcs' where id=$1",[mid])
 assert.equal((await f.read(f.saved.recordId)).shopping_ready,false)
 await assert.rejects(f.command('withdraw',1),/shopping_edited/)
 await f.pg.query("update bob.materials set qty=$2,status='ordered' where id=$1",[mid,`${f.p.data.layout.used_sheets.length} pcs`])
 await assert.rejects(f.command('withdraw',1),/shopping_committed/)
 await f.command('publish',1) // Repeating the same unchanged contribution does not mutate the ordered item.
 assert.equal((await f.pg.query('select status from bob.materials where id=$1',[mid])).rows[0].status,'ordered')
 await f.pg.query('delete from bob.materials where id=$1',[mid])
 assert.equal((await f.read(f.saved.recordId)).shopping_ready,false)
 await assert.rejects(f.command('publish',2),/shopping_missing/)
 assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,0)
})

test('hypothetical input, foreign callers, raw writes and expired claims fail atomically',async t=>{
 const f=await cutPlanFixture(t),saved=await f.write(f.payload)
 await assert.rejects(f.rpc('bob.material_cut_plan_shopping_command',[f.project,'publish',saved.recordId,1,0,'Hypothetical']),/catalog_required/)
 await assert.rejects(f.rpc('bob.material_cut_plan_shopping_command',[f.project,'publish',saved.recordId,1,0,'Denied'],f.other),/project_denied/)
 await assert.rejects(f.rpc('bob.material_cut_plan_shopping_command',[f.project,'publish',saved.recordId,1,0,'Denied'],null,'anon'),/permission denied/)
 for(const table of ['cut_plan_purchase_groups','cut_plan_shopping','cut_plan_shopping_revisions','cut_plan_shopping_contributions']){
  assert.equal((await asProjectUser(f.pg,f.other,`select * from bob.${table}`)).rows.length,0)
  await assert.rejects(asProjectUser(f.pg,f.user,`delete from bob.${table}`),/permission denied/)
  assert.equal((await f.pg.query(`select count(*)::int n from bob.${table}`)).rows[0].n,0)
 }
 await f.pg.query("update bob_private.bob_thread_provider_state set lock_started_at=now()-interval '6 minutes' where in_flight_turn_id=$1",[f.turn])
 await assert.rejects(f.rpc('bob.bob_project_write_v16',[f.project,f.claim.thread_id,f.turn,f.claim.generation,JSON.stringify({...f.base,kind:'cut_plan_shopping',record_id:saved.recordId,expected_revision:1,data:{action:'publish',shopping_revision:0,change_note:'Expired'}})]),/turn_not_claimed/)
})

async function addPlan(f:any,key:string,grain='length'){
 const construction=await f.write({...f.base,kind:'construction',data:{...f.constructionData,key,title:'Additional '+key}})
 const needs=[]
 for(const definition_id of ['base','upright'])needs.push(await f.write({...f.base,kind:'operational',data:{resource:'cad_requirement',action:'create',fields:{name:key+' '+definition_id,category:'Timber',area_id:null,task_id:null,waste_percent:'0',purchase_increment:'1',assumptions:'Fixture',artifact_id:construction.recordId,artifact_revision:1,target_revision:1,definition_id,quantity_mode:'pieces',stock_allocations:[],component_allocations:[],change_note:'Counted'}}}))
 const p=structuredClone(f.p);p.data.key=key;p.data.artifact_id=construction.recordId;p.data.requirements=needs.map((x:any)=>({id:x.recordId,revision:1}));p.data.candidates[0].grain=grain
 if(grain==='none')p.data.blank_grain=p.data.blank_grain.map((g:any)=>({...g,axis:'none'}))
 const fit:any=constructionCutFit(constructionLists(f.draft,f.catalog,[]),p.data.candidates,p.data.blank_grain)
 assert.equal(fit.status,'feasible');p.data.layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
 return {saved:await f.write(p),p,needs}
}

test('compatible plans aggregate once and withdraw only their own quantities',async t=>{
 const f=await purchaseFixture(t),second=await addPlan(f,'second')
 const first=await f.command(),mid=first.shopping.contributions[0].material_id
 const publish=(plan:any)=>f.rpc('bob.material_cut_plan_shopping_command',[f.project,'publish',plan.saved.recordId,1,0,'Additional contribution'])
 const two=await publish(second)
 assert.equal(two.shopping.contributions[0].material_id,mid)
 assert.equal((await f.pg.query('select qty from bob.materials where id=$1',[mid])).rows[0].qty,`${f.p.data.layout.used_sheets.length+second.p.data.layout.used_sheets.length} pcs`)
 await f.command('publish',1)
 assert.equal((await f.pg.query('select qty from bob.materials where id=$1',[mid])).rows[0].qty,`${f.p.data.layout.used_sheets.length+second.p.data.layout.used_sheets.length} pcs`,'republishing replaces own quantity, never adds it twice')
 await f.rpc('bob.material_requirement_command',[f.project,'archive',f.needs[0].recordId,1,'{}'])
 assert.equal((await f.read(f.saved.recordId)).shopping_ready,false)
 await assert.rejects(f.command('publish',2),/sources_changed/)
 assert.equal((await f.pg.query('select qty from bob.materials where id=$1',[mid])).rows[0].qty,`${f.p.data.layout.used_sheets.length+second.p.data.layout.used_sheets.length} pcs`,'stale sources do not silently discard purchases')
 await f.command('withdraw',2)
 assert.equal((await f.pg.query('select qty from bob.materials where id=$1',[mid])).rows[0].qty,`${second.p.data.layout.used_sheets.length} pcs`)
 assert.equal((await f.read(second.saved.recordId)).shopping_ready,true)
 const otherRead=await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'shopping',record_id:mid,after_id:null})])
 assert.equal(otherRead.records[0].cut_plan_source.contribution_count,1)
})


test('existing material tool publishes through the caller writer and rejects forged quantities',async t=>{
 const f=await purchaseFixture(t),args={resource:'cut_plan',action:'publish',record_id:f.saved.recordId,expected_revision:1,expected_updated_at:null,request_quote:'Save a cut plan',data:{shopping_revision:0,change_note:'Explicit purchase plan'}}
 const spec=OPERATION_WRITE_TOOLS.find(t=>t.function.name==='manage_project_material')!
 assert.deepEqual(schemaIssues(spec.function.parameters,args),[])
 assert.deepEqual(parseProjectWrite('manage_project_material',args,f.project,f.message),f.purchasePayload())
 for(const patch of [{data:{...args.data,quantity:1}},{data:{...args.data,shopping_revision:-1}},{record_id:null},{expected_revision:0},{action:'release'}])assert.equal(parseProjectWrite('manage_project_material',{...args,...patch},f.project,f.message),null)
 const writer=createProjectWriter(f.project,f.message,async p=>({data:await f.writeShopping(p),error:null}),async()=>({data:[],error:null}))
 const result:any=await writer.write('manage_project_material',args)
 assert.equal(result.status,'saved');assert.equal(result.receipt.record.shopping_ready,true)
})


test('different grain choices stay in separate Shopping rows',async t=>{
 const f=await purchaseFixture(t),other=await addPlan(f,'different-grain','none')
 const first=await f.command(),second=await f.rpc('bob.material_cut_plan_shopping_command',[f.project,'publish',other.saved.recordId,1,0,'Different grain'])
 assert.notEqual(first.shopping.contributions[0].material_id,second.shopping.contributions[0].material_id)
 assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,2)
})
