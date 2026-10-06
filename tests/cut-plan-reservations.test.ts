import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cutPlanFixture } from './support/cut-plan-fixture.ts'
import { asProjectUser } from './support/project-schema.ts'
import { constructionCutFit } from '../supabase/functions/_shared/construction-cut-fit.ts'
import { constructionLists } from '../supabase/functions/_shared/construction-lists.ts'
import { parseProjectWrite, createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { schemaIssues } from '../supabase/functions/_shared/schema-issues.ts'
import { OPERATION_WRITE_TOOLS } from '../supabase/functions/_shared/project-operations.ts'

async function boundFixture(t: any, quantity='3', length=2440, width=1220, aliases=false) {
 const f=await cutPlanFixture(t),stockId=randomUUID()
 const format={material_id:f.material.recordId,material_revision:1,length_mm:length,width_mm:width,thickness_mm:18,grain:'length',basis:'provided_spec',note:'Isolated specified stock, no inspection claim'}
 const stockData={name:'Fixture sheets',specification:'Isolated fixture',quantity,unit:'pcs',status:'available',area_id:null,notes:'Fixture',change_note:'Initial',sheet_format:format}
 await f.rpc('bob.stock_command',[f.project,'create',stockId,0,JSON.stringify(stockData)])
 const payload=structuredClone(f.payload);payload.data.candidates[0].length_mm=length;payload.data.candidates[0].width_mm=width
 if(aliases) payload.data.candidates.push({...payload.data.candidates[0],id:'alias'})
 payload.data.candidate_sources=payload.data.candidates.map((c:any)=>({candidate_id:c.id,kind:'stock',record_id:stockId,revision:1}))
 const fit:any=constructionCutFit(constructionLists(f.draft,f.catalog,[]),payload.data.candidates,f.blank_grain)
 assert.equal(fit.status,'feasible');payload.data.layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
 const saved=await f.write(payload)
 const reservePayload=(action='reserve',revision=0)=>({...f.base,kind:'cut_plan_stock',record_id:saved.recordId,expected_revision:1,data:{action,reservation_revision:revision,change_note:'Explicit shared stock reservation'}})
 const writeStock=(p:any,uid=f.user)=>f.rpc('bob.bob_project_write_v16',[f.project,f.claim.thread_id,f.turn,f.claim.generation,JSON.stringify(p)],uid)
 const command=(action:string,revision:number,uid=f.user)=>f.rpc('bob.material_cut_plan_stock_command',[f.project,action,saved.recordId,1,revision,'Explicit fixture reservation'],uid)
 const stockRead=async()=>(await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'stock',record_id:stockId,after_id:null})])).records[0]
 return{...f,stockId,stockData,payload,saved,reservePayload,writeStock,command,stockRead}
}
const manualFields=(stockId:string,revision=1,quantity='1')=>({name:'Manual sheet need',category:'Timber',area_id:null,task_id:null,unit:'pcs',required_quantity:quantity,waste_percent:'0',purchase_increment:'1',basis:'Explicit isolated sheet count',assumptions:'Fixture',artifact_id:null,artifact_revision:null,target_revision:1,stock_allocations:[{id:stockId,revision,quantity}],component_allocations:[],change_note:'Fixture'})

test('whole-sheet reservations preserve blank needs/history, use normal receipts and require explicit release',async t=>{
 const f=await boundFixture(t)
 const before=(await f.pg.query('select to_jsonb(r) row from bob.material_requirement_revisions r where project_id=$1 order by requirement_id,revision',[f.project])).rows
 await t.test('one sheet covers both needs without revising blank quantities',async()=>{
  const receipt=await f.writeStock(f.reservePayload());assert.equal(receipt.dataset,'cut_plans');assert.equal(receipt.revision,1)
  assert.deepEqual(await f.writeStock(f.reservePayload()),receipt)
  const plan=await f.read(f.saved.recordId);assert.equal(plan.stock_reserved,true);assert.equal(plan.reservation_revision,1)
  assert.equal(plan.reservation.allocations.length,1);assert.equal(plan.reservation.allocations[0].quantity,1)
  assert.equal(plan.requirements.length,2);assert.deepEqual(plan.layout,f.payload.data.layout)
  for(const k of ['shopping_ready','fabrication_ready','input_evidence_verified'])assert.equal(plan[k],false)
  const stock=await f.stockRead();assert.equal(stock.reserved_quantity,1);assert.equal(stock.unreserved_sheets,2)
  assert.deepEqual((await f.pg.query('select to_jsonb(r) row from bob.material_requirement_revisions r where project_id=$1 order by requirement_id,revision',[f.project])).rows,before)
  assert.equal((await f.pg.query('select count(*)::int n from bob.material_requirement_stock where project_id=$1',[f.project])).rows[0].n,0)
 })
 await t.test('forged quantity, changed replay, stale CAS and direct plan revision cannot alter held capacity',async()=>{
  await assert.rejects(f.writeStock({...f.reservePayload(),data:{...f.reservePayload().data,quantity:99}}),/invalid_reservation/)
  await assert.rejects(f.writeStock({...f.reservePayload(),data:{...f.reservePayload().data,change_note:'Changed replay'}}),/operation_reused/)
  await assert.rejects(f.command('release',0),/reservation_changed/)
  const revised={...f.payload,record_id:f.saved.recordId,expected_revision:1,data:{...f.payload.data,key:'held-revision'}}
  await assert.rejects(f.write(revised),/reservation_release_required/)
  assert.equal((await f.read(f.saved.recordId)).revision,1)
  assert.equal((await f.pg.query('select count(*)::int n from bob.material_cut_plan_revisions where plan_id=$1',[f.saved.recordId])).rows[0].n,1)
 })
 await t.test('legacy/manual requirements share capacity and count only current allocation revisions',async()=>{
  const id=randomUUID(),fields=manualFields(f.stockId,1,'2')
  await f.rpc('bob.material_requirement_command',[f.project,'create',id,0,JSON.stringify(fields)])
  assert.equal((await f.stockRead()).reserved_quantity,3)
  await assert.rejects(f.rpc('bob.material_requirement_command',[f.project,'create',randomUUID(),0,JSON.stringify(manualFields(f.stockId))]),/already reserved/)
  await f.rpc('bob.material_requirement_command',[f.project,'revise',id,1,JSON.stringify({...fields,required_quantity:'1',stock_allocations:[{id:f.stockId,revision:1,quantity:'1'}]})])
  assert.equal((await f.stockRead()).reserved_quantity,2)
  const extra=randomUUID()
  await f.rpc('bob.material_requirement_command',[f.project,'create',extra,0,JSON.stringify(manualFields(f.stockId))])
  assert.equal((await f.stockRead()).reserved_quantity,3,'historical manual quantities must not consume capacity twice')
  await f.rpc('bob.material_requirement_command',[f.project,'archive',extra,1,'{}'])
  await f.rpc('bob.material_requirement_command',[f.project,'archive',id,2,'{}'])
  assert.equal((await f.stockRead()).reserved_quantity,1)
 })
 await t.test('stale stock pins hold capacity but never claim current coverage; release retains history',async()=>{
  await f.rpc('bob.stock_command',[f.project,'revise',f.stockId,1,JSON.stringify({...f.stockData,quantity:'1',notes:'Changed current stock'})])
  const plan=await f.read(f.saved.recordId);assert.equal(plan.source_state,'changed');assert.equal(plan.stock_reserved,false);assert.equal(plan.reservation.reserved,true)
  assert.equal((await f.stockRead()).reserved_quantity,1);assert.equal((await f.stockRead()).unreserved_sheets,0)
  await assert.rejects(f.rpc('bob.material_requirement_command',[f.project,'create',randomUUID(),0,JSON.stringify(manualFields(f.stockId,2))]),/already reserved/)
  const released=await f.writeStock(f.reservePayload('release',1));assert.equal(released.record.reservation_revision,2);assert.equal(released.record.stock_reserved,false)
  assert.equal(released.record.reservation.reserved,false);assert.equal((await f.stockRead()).reserved_quantity,0)
  assert.deepEqual(await f.writeStock(f.reservePayload('release',1)),released)
  const history=(await asProjectUser(f.pg,f.user,'select revision,reserved from bob.material_cut_plan_reservation_revisions where plan_id=$1 order by revision',[f.saved.recordId])).rows
  assert.deepEqual(history,[{revision:1,reserved:true},{revision:2,reserved:false}])
  assert.equal((await f.pg.query('select count(*)::int n from bob.material_cut_plan_stock where plan_id=$1',[f.saved.recordId])).rows[0].n,1)
  await assert.rejects(f.command('reserve',2),/stock_changed/)
  for(const need of f.needs)await assert.rejects(f.rpc('bob.material_requirement_command',[f.project,'publish',need.recordId,1,'{}']),/construction_cut_fit_required/)
  assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,0)
 })
 await t.test('project authority, raw-table writes and settled/expired model claims are fenced',async()=>{
  await assert.rejects(f.command('reserve',2,f.other),/project_denied/)
  await assert.rejects(f.rpc('bob.material_cut_plan_stock_command',[f.project,'reserve',f.saved.recordId,1,2,'Denied'],null,'anon'),/permission denied/)
  for(const table of ['material_cut_plan_reservations','material_cut_plan_reservation_revisions','material_cut_plan_stock']){
   assert.equal((await asProjectUser(f.pg,f.other,`select * from bob.${table}`)).rows.length,0)
   await assert.rejects(asProjectUser(f.pg,f.user,`delete from bob.${table}`),/permission denied/)
  }
  await f.pg.query("update bob_private.bob_thread_provider_state set lock_started_at=now()-interval '6 minutes' where in_flight_turn_id=$1",[f.turn])
  await assert.rejects(f.writeStock(f.reservePayload('reserve',2)),/turn_not_claimed/)
 })
})

test('offered spare candidate counts never replace actual used-sheet quantities',async t=>{
 const f=await boundFixture(t)
 const p=structuredClone(f.payload);p.record_id=f.saved.recordId;p.expected_revision=1;p.data.key='offer-three';p.data.candidates[0].count=3
 const fit:any=constructionCutFit(constructionLists(f.draft,f.catalog,[]),p.data.candidates,f.blank_grain)
 p.data.layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
 const rev=await f.write(p)
 const reserved=await f.rpc('bob.material_cut_plan_stock_command',[f.project,'reserve',rev.recordId,2,0,'Explicit used sheets'])
 assert.equal(reserved.reservation.allocations[0].quantity,fit.used_sheets.length)
 assert(fit.used_sheets.length<3)
})

test('duplicate stock aliases reserve actual used sheets once per shared stock identity',async t=>{
 const f=await boundFixture(t,'2',220,110,true);assert.equal(f.payload.data.layout.used_sheets.length,2)
 const plan=await f.command('reserve',0);assert.equal(plan.stock_reserved,true)
 assert.equal(plan.reservation.allocations.length,1);assert.equal(plan.reservation.allocations[0].quantity,2)
 assert.equal((await f.stockRead()).reserved_quantity,2);assert.equal((await f.stockRead()).unreserved_sheets,0)
 const old=structuredClone(f.payload.data.layout)
 await f.rpc('bob.material_requirement_command',[f.project,'archive',f.needs[0].recordId,1,'{}'])
 assert.equal((await f.read(f.saved.recordId)).stock_reserved,false)
 assert.equal((await f.stockRead()).reserved_quantity,2)
 await f.command('release',1);assert.equal((await f.stockRead()).reserved_quantity,0)
 assert.deepEqual((await f.read(f.saved.recordId)).layout,old)
})

test('candidate IDs with separators still bind every actual used sheet to stock',async t=>{
 const f=await boundFixture(t),p=structuredClone(f.payload)
 p.record_id=f.saved.recordId;p.expected_revision=1;p.data.key='colon-id'
 p.data.candidates[0].id='raw:sheet:format';p.data.candidate_sources[0].candidate_id='raw:sheet:format'
 const fit:any=constructionCutFit(constructionLists(f.draft,f.catalog,[]),p.data.candidates,f.blank_grain)
 p.data.layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
 await f.write(p)
 const reserved=await f.rpc('bob.material_cut_plan_stock_command',[f.project,'reserve',f.saved.recordId,2,0,'Exact separated ID'])
 assert.equal(reserved.stock_reserved,true);assert.equal(reserved.reservation.allocations.length,1)
 assert.equal(reserved.reservation.allocations[0].quantity,1)
})

test('hypothetical plans cannot reserve stock or invent a fulfillment record',async t=>{
 const f=await cutPlanFixture(t),saved=await f.write(f.payload)
 await assert.rejects(f.rpc('bob.material_cut_plan_stock_command',[f.project,'reserve',saved.recordId,1,0,'Hypothetical cannot reserve']),/stock_sources_required/)
 for(const table of ['material_cut_plan_reservations','material_cut_plan_reservation_revisions','material_cut_plan_stock'])assert.equal((await f.pg.query(`select count(*)::int n from bob.${table} where project_id=$1`,[f.project])).rows[0].n,0)
 const plan=await f.read(saved.recordId);assert.equal(plan.reservation_revision,0);assert.equal(plan.reservation,null);assert.equal(plan.stock_reserved,false)
})

test('existing material tool exposes strict plan reservation inputs through the normal writer/toolbox',async t=>{
 const f=await boundFixture(t),args={record_id:f.saved.recordId,expected_revision:1,expected_updated_at:null,request_quote:'Save a cut plan',resource:'cut_plan',action:'reserve',data:{reservation_revision:0,change_note:'Explicit shared stock reservation'}}
 const spec=OPERATION_WRITE_TOOLS.find(t=>t.function.name==='manage_project_material')!
 assert.deepEqual(schemaIssues(spec.function.parameters,args),[])
 const parsed=parseProjectWrite('manage_project_material',args,f.project,f.message);assert.equal(parsed?.kind,'cut_plan_stock')
 for(const patch of [{data:{...args.data,quantity:1}},{action:'publish'},{resource:'requirement'},{record_id:null},{expected_revision:0},{data:{...args.data,reservation_revision:-1}}])assert.equal(parseProjectWrite('manage_project_material',{...args,...patch},f.project,f.message),null)
 const writer=createProjectWriter(f.project,f.message,async p=>({data:await f.writeStock(p),error:null}),async()=>({data:[],error:null}))
 const lookup=createProjectLookup(f.project,async()=>({data:[],error:null}),async()=>true)
 const session=createBobToolSession({projectId:f.project,phase:'planning',message:f.message,lookup,writer,readPolicy:seedToolPolicy})
 await session.prepare()
 const result:any=await session.execute('manage_project_material',args);assert.equal(result.status,'saved');assert.equal(result.receipt.record.stock_reserved,true)
 assert.equal(writer.receipts.length,1);assert.equal(writer.receipts[0].dataset,'cut_plans')
})
