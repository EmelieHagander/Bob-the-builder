import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {cutPlanFixture} from './support/cut-plan-fixture.ts'
import {constructionCutFit} from '../supabase/functions/_shared/construction-cut-fit.ts'
import {constructionLists} from '../supabase/functions/_shared/construction-lists.ts'

async function mixedFixture(t:any, hypothetical=false, unusedHypothetical=false) {
 const f=await cutPlanFixture(t),stockId=randomUUID()
 const stockData={name:'Isolated small sheet',specification:'Fixture',quantity:'1',unit:'pcs',status:'available',area_id:null,notes:'No inspection claim',change_note:'Fixture',sheet_format:{material_id:f.material.recordId,material_revision:1,length_mm:220,width_mm:110,thickness_mm:18,grain:'length',basis:'provided_spec',note:'Isolated fixture'}}
 await f.rpc('bob.stock_command',[f.project,'create',stockId,0,JSON.stringify(stockData)])
 const part=await f.write({...f.base,kind:'catalog',data:{action:'ensure',key:'mixed-panel',kind:'part',name:'Small catalog panel',aliases:[],profile_code:'panel',profile_revision:1,categories:['wood.plywood','sheet'],properties:{length:{value:'220',unit:'mm',truth:'provided_spec',parameter:null,note:''},width:{value:'110',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:f.material.recordId,material_revision:1,notes:'No supplier/pack claim',source_kind:'design_choice',source_quote:'existing blanks',source_seq:null}})
 const p=structuredClone(f.payload)
 p.data.candidates=['stock:sheet','purchase:sheet'].map(id=>({...p.data.candidates[0],id,length_mm:220,width_mm:110,count:1}))
 p.data.candidate_sources=[{candidate_id:'stock:sheet',kind:'stock',record_id:stockId,revision:1},{candidate_id:'purchase:sheet',kind:hypothetical?'hypothetical':'catalog_part',record_id:hypothetical?null:part.recordId,revision:hypothetical?null:1}]
 if(unusedHypothetical){p.data.candidates.push({...f.candidates[0],id:'unused'});p.data.candidate_sources.push({candidate_id:'unused',kind:'hypothetical',record_id:null,revision:null})}
 const fit:any=constructionCutFit(constructionLists(f.draft,f.catalog,[]),p.data.candidates,f.blank_grain)
 assert.equal(fit.status,'feasible');assert.deepEqual([...fit.used_sheets].sort(),['purchase:sheet:1','stock:sheet:1'])
 p.data.layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
 const saved=await f.write(p)
 const command=(action:string,revision:number)=>f.rpc(action==='reserve'||action==='release'?'bob.material_cut_plan_stock_command':'bob.material_cut_plan_shopping_command',[f.project,action,saved.recordId,1,revision,'Explicit portion commitment'])
 const payload=(action:string,revision:number)=>({...f.base,kind:action==='reserve'||action==='release'?'cut_plan_stock':'cut_plan_shopping',record_id:saved.recordId,expected_revision:1,data:{action,[action==='reserve'||action==='release'?'reservation_revision':'shopping_revision']:revision,change_note:'Explicit portion commitment'}})
 const write=(p:any)=>f.rpc('bob.bob_project_write_v16',[f.project,f.claim.thread_id,f.turn,f.claim.generation,JSON.stringify(p)])
 const read=()=>f.read(saved.recordId)
 return {...f,stockId,stockData,part,p,saved,command,payload,writeMixed:write,readMixed:read}
}
const supply=(stock=false,purchase=false)=>({used_sheets:2,stock_sheets:1,catalog_sheets:1,hypothetical_sheets:0,stock_commitment_current:stock,purchase_commitment_current:purchase,commitments_current:stock&&purchase})

test('mixed plan reserves only stock and publishes only catalog; receipts, CAS and history remain independent',async t=>{
 const f=await mixedFixture(t)
 const needs=(await f.pg.query('select to_jsonb(r) row from bob.material_requirement_revisions r where project_id=$1 order by requirement_id,revision',[f.project])).rows
 assert.deepEqual((await f.readMixed()).supply,supply())
 const reserve=await f.writeMixed(f.payload('reserve',0))
 assert.deepEqual(reserve.record.supply,supply(true));assert.equal(reserve.record.stock_reserved,false,'mixed is never full-stock coverage')
 assert.deepEqual(await f.writeMixed(f.payload('reserve',0)),reserve)
 assert.equal(reserve.record.reservation.allocations.length,1);assert.equal(reserve.record.reservation.allocations[0].stock_id,f.stockId);assert.equal(reserve.record.reservation.allocations[0].quantity,1)
 const published=await f.writeMixed(f.payload('publish',0))
 assert.deepEqual(published.record.supply,supply(true,true));assert.equal(published.record.shopping_ready,true)
 assert.deepEqual(await f.writeMixed(f.payload('publish',0)),published)
 assert.equal(published.record.shopping.contributions.length,1);assert.equal(published.record.shopping.contributions[0].quantity,1)
 assert.equal(published.record.shopping.contributions[0].part_id,f.part.recordId)
 assert.equal(published.record.stock_reserved,false);assert.equal(published.record.fabrication_ready,false);assert.equal(published.record.input_evidence_verified,false)
 const mid=published.record.shopping.contributions[0].material_id
 await f.pg.query("update bob.materials set qty='9 pcs' where id=$1",[mid])
 assert.deepEqual((await f.readMixed()).supply,supply(true,false),'edited Shopping must not masquerade as complete mixed coverage')
 await assert.rejects(f.command('withdraw',1),/shopping_edited/)
 await f.pg.query("update bob.materials set qty='1 pcs' where id=$1",[mid])
 await assert.rejects(f.command('release',0),/reservation_changed/);await assert.rejects(f.command('withdraw',0),/shopping_changed/)
 await assert.rejects(f.writeMixed({...f.payload('publish',0),data:{...f.payload('publish',0).data,change_note:'Changed replay'}}),/operation_reused/)
 const revise={...f.p,record_id:f.saved.recordId,expected_revision:1,data:{...f.p.data,key:'revised'}}
 await assert.rejects(f.write(revise),/release_required|withdraw_required|stock_capacity_changed/)
 await f.command('withdraw',1);assert.deepEqual((await f.readMixed()).supply,supply(true))
 await assert.rejects(f.write(revise),/release_required|stock_capacity_changed/)
 await f.command('release',1);assert.deepEqual((await f.readMixed()).supply,supply())
 assert.equal((await f.write(revise)).revision,2)
 assert.deepEqual((await f.read(f.saved.recordId,1)).layout,f.p.data.layout)
 assert.deepEqual((await f.pg.query('select to_jsonb(r) row from bob.material_requirement_revisions r where project_id=$1 order by requirement_id,revision',[f.project])).rows,needs)
 assert.equal((await f.pg.query('select qty from bob.materials where project_id=$1',[f.project])).rows[0].qty,'0 pcs')
})

test('purchase-first partial success survives a failed reservation and resumes without duplicate purchases',async t=>{
 const f=await mixedFixture(t),published=await f.command('publish',0),mid=published.shopping.contributions[0].material_id
 assert.deepEqual(published.supply,supply(false,true))
 const need=randomUUID(),fields={name:'Other sheet use',category:'Timber',area_id:null,task_id:null,unit:'pcs',required_quantity:'1',waste_percent:'0',purchase_increment:'1',basis:'Fixture',assumptions:'Fixture',artifact_id:null,artifact_revision:null,target_revision:1,stock_allocations:[{id:f.stockId,revision:1,quantity:'1'}],component_allocations:[],change_note:'Fixture'}
 await f.rpc('bob.material_requirement_command',[f.project,'create',need,0,JSON.stringify(fields)])
 await assert.rejects(f.command('reserve',0),/stock_capacity_changed/)
 let plan=await f.readMixed();assert.equal(plan.reservation_revision,0);assert.equal(plan.shopping_revision,1);assert.equal(plan.shopping.published,true);assert.equal(plan.supply.commitments_current,false)
 assert.equal((await f.pg.query('select qty from bob.materials where id=$1',[mid])).rows[0].qty,'1 pcs')
 await f.rpc('bob.material_requirement_command',[f.project,'archive',need,1,'{}'])
 plan=await f.command('reserve',0);assert.deepEqual(plan.supply,supply(true,true));assert.equal(plan.shopping_revision,1)
 await f.pg.query("update bob.materials set status='ordered' where id=$1",[mid])
 await assert.rejects(f.command('withdraw',1),/shopping_committed/)
 plan=await f.command('release',1);assert.deepEqual(plan.supply,supply(false,true));assert.equal(plan.shopping.published,true)
 await assert.rejects(f.write({...f.p,record_id:f.saved.recordId,expected_revision:1,data:{...f.p.data,key:'ordered-layout-change'}}),/withdraw_required/)
 assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,1)
})

test('used hypothetical sheets block both commitments atomically',async t=>{
 const f=await mixedFixture(t,true)
 await assert.rejects(f.command('reserve',0),/stock_sources_required/)
 await assert.rejects(f.command('publish',0),/catalog_required/)
 const plan=await f.readMixed();assert.deepEqual(plan.supply,{...supply(),catalog_sheets:0,hypothetical_sheets:1});assert.equal(plan.reservation_revision,0);assert.equal(plan.shopping_revision,0)
 assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,0)
})

test('unused hypothetical offers do not block mixed commitments; stale stock preserves both histories',async t=>{
 const f=await mixedFixture(t,false,true)
 await f.command('reserve',0);const pub=await f.command('publish',0)
 assert.deepEqual(pub.supply,supply(true,true))
 await f.rpc('bob.stock_command',[f.project,'revise',f.stockId,1,JSON.stringify({...f.stockData,notes:'Changed stock source'})])
 const stale=await f.readMixed();assert.equal(stale.source_state,'changed');assert.deepEqual(stale.supply,supply())
 assert.equal(stale.reservation.reserved,true);assert.equal(stale.shopping.published,true)
 const stock=(await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'stock',record_id:f.stockId,after_id:null})])).records[0]
 assert.equal(stock.reserved_quantity,1)
 assert.equal((await f.pg.query('select qty from bob.materials where project_id=$1',[f.project])).rows[0].qty,'1 pcs')
 await f.command('withdraw',1);await f.command('release',1)
 assert.equal((await f.readMixed()).reservation_revision,2);assert.equal((await f.readMixed()).shopping_revision,2)
})
