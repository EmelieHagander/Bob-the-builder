import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { parameterPlan } from './support/cad-parameter-fixture.ts'
import { compileCadParameters } from '../supabase/functions/_shared/cad-parameters.ts'
import { constructionLists } from '../supabase/functions/_shared/construction-lists.ts'
import { constructionCutFit } from '../supabase/functions/_shared/construction-cut-fit.ts'
import { createConstructionTools, CONSTRUCTION_CUT_SAVE_TOOL } from '../supabase/functions/_shared/construction-draft.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createOperationalReader } from '../supabase/functions/_shared/project-operations.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { schemaIssues } from '../supabase/functions/_shared/schema-issues.ts'
import { isProjectWriteReceipt } from '../src/data/bobEvidence.ts'

async function fixture(t: any) {
 const pg=await projectSchema();t.after(()=>pg.close()); const user=randomUUID(),other=randomUUID(),message='Save a cut plan for the existing blanks. Keep stock, needs and Shopping unchanged.'
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[user,'cut-plan@test.example',other,'outsider@test.example'])
 const rpc=async(name:string,args:any[],uid:string|null=user,role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const project=(await rpc('bob.create_project',[JSON.stringify({name:'Cut plan isolated fixture'})])).id, solution=randomUUID()
 await rpc('bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Concept bracket',description:'Fixture',assumptions:'Product unknown',tradeoffs:'Synthetic',measurements:[]})])
 await rpc('bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Fixture'})])
 const turn=randomUUID(),claim=await rpc('bob.bob_claim_turn',[project,user,turn,message],null,'service_role')
 const write=(p:any,uid=user)=>rpc('bob.bob_project_write_v15',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)],uid)
 const base={record_id:null,expected_revision:0,expected_updated_at:null,request_quote:'Save a cut plan'}
 const material=await write({...base,kind:'catalog',data:{action:'ensure',key:'material',kind:'material',name:'Plywood 18',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'existing blanks',source_seq:null}})
 const placement=(x:number,z:number)=>({x,y:0,z,rx:0,ry:0,rz:0})
 const recipe:any={contract_version:1,units:'mm',assembly_id:'bracket',definitions:[{id:'base',primitive:'box',material_ref:null,x_mm:200,y_mm:100,z_mm:18},{id:'upright',primitive:'box',material_ref:null,x_mm:18,y_mm:100,z_mm:100}],instances:[{id:'foot',definition_id:'base',placement:placement(0,0)},{id:'back',definition_id:'upright',placement:placement(0,18)}],views:['front']}
 const constructionData:any={key:'construction',title:'Two-part bracket',description:'Concept',area_id:null,target_revision:1,change_note:'Fixture',recipe,parameters:compileCadParameters(project,recipe,parameterPlan(recipe),new Map(),new Map()),materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})),joints:[{id:'join',method:'glued_butt',first:{instance_id:'foot',face:'z_max'},second:{instance_id:'back',face:'z_min'},reason:'Concept'}],open_questions:['Hardware/access unknown']}
 const construction=await write({...base,kind:'construction',data:constructionData})
 const needs=[]
 for(const definition_id of ['base','upright']){
  const fields={name:definition_id+' blank',category:'Timber',area_id:null,task_id:null,waste_percent:'0',purchase_increment:'1',assumptions:'Concept',artifact_id:construction.recordId,artifact_revision:1,target_revision:1,definition_id,quantity_mode:'pieces',stock_allocations:[],component_allocations:[],change_note:'Counted blank'}
  needs.push(await write({...base,kind:'operational',data:{resource:'cad_requirement',action:'create',fields}}))
 }
 const draft=await rpc('bob.read_construction_draft',[project,construction.recordId,1,null]),catalogRecord=(await rpc('bob.catalog_read',[project,JSON.stringify({action:'read',id:material.recordId,revision:1,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})])).record
 const catalog=new Map([[material.recordId+'@1',catalogRecord]])
 const candidates:any[]=[{id:'sheet',material_id:material.recordId,material_revision:1,length_mm:2440,width_mm:1220,thickness_mm:18,count:1,kerf_mm:3,trim_mm:5,grain:'length',basis:'provided_spec',note:'Explicit hypothetical test format, not measured stock or a verified product'}]
 const blank_grain=[{definition_id:'base',axis:'x'},{definition_id:'upright',axis:'z'}]
 const fit:any=constructionCutFit(constructionLists(draft,catalog,[]),candidates,blank_grain);assert.equal(fit.status,'feasible')
 const layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
 const fields:any={key:'cut',artifact_id:construction.recordId,artifact_revision:1,requirements:needs.map(r=>({id:r.recordId,revision:r.revision})),candidates,blank_grain,candidate_sources:[{candidate_id:'sheet',kind:'hypothetical',record_id:null,revision:null}],layout,change_note:'Checked hypothetical layout'}
 const payload:any={...base,kind:'cut_plan',data:fields}
 const read=(id:string,rev:number|null=null)=>rpc('bob.read_material_cut_plan',[project,id,rev])
 return{pg,rpc,project,user,other,message,write,read,payload,draft,catalog,material,construction,constructionData,candidates,blank_grain,needs,base,turn,claim}
}

test('saved cut plans use existing receipts, preserve needs, reopen exact layouts and reject adversarial geometry',async t=>{
 const f=await fixture(t);let saved:any
 const before=(await asProjectUser(f.pg,f.user,'select * from bob.material_requirement_revisions where project_id=$1 order by requirement_id,revision',[f.project])).rows
 await t.test('one canonical plan links both unchanged needs and replays the exact receipt',async()=>{
  saved=await f.write(f.payload);assert.equal(saved.dataset,'cut_plans');assert(isProjectWriteReceipt(saved,f.project));assert.equal(saved.revision,1)
  assert.deepEqual(await f.write(f.payload),saved)
  const reopened=await f.read(saved.recordId);assert.deepEqual(reopened.layout,f.payload.data.layout);assert.equal(reopened.source_state,'current');assert.equal(reopened.saved,true)
  for(const k of ['stock_reserved','shopping_ready','fabrication_ready','input_evidence_verified'])assert.equal(reopened[k],false)
  assert.equal(reopened.requirements.length,2);assert.equal(reopened.capacity[0].kind,'hypothetical');assert.equal(reopened.capacity[0].available_sheets,null)
  const read=(await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'cut_plan',record_id:saved.recordId,after_id:null})]));assert.deepEqual(read.records[0],reopened)
  const need=(await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'requirement',record_id:f.needs[0].recordId,after_id:null})])).records[0]
  assert.equal(need.cut_plans[0].id,saved.recordId)
  assert.deepEqual((await asProjectUser(f.pg,f.user,'select * from bob.material_requirement_revisions where project_id=$1 order by requirement_id,revision',[f.project])).rows,before)
  assert.equal((await f.pg.query('select count(*)::int n from bob.material_requirement_stock where project_id=$1',[f.project])).rows[0].n,0)
  assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,0)
 })
 await t.test('forged dimensions, grain, material, cuts, missing pieces or offcuts fail at SQL boundary',async()=>{
  const mutations=[
   (d:any)=>d.layout.placements.pop(),(d:any)=>d.layout.placements[0].length_mm++,
   (d:any)=>d.layout.placements[0].x_mm++,(d:any)=>d.layout.placements[0].instance_id='fake',
   (d:any)=>d.layout.placements[0].length_axis='y',(d:any)=>d.layout.placements[0].grain_axis='none',
   (d:any)=>d.layout.placements[0].thickness_mm++, (d:any)=>d.layout.placements[0].label='P99',
   (d:any)=>d.layout.cuts.pop(),(d:any)=>d.layout.cuts.reverse(),(d:any)=>d.layout.cuts[0].kerf_mm=0,
   (d:any)=>d.layout.cuts[0].span_end_mm--,(d:any)=>d.layout.cuts[0].before_instance_id='fake',
   (d:any)=>d.layout.cuts[0].position_mm+=0.0000001,(d:any)=>d.layout.offcuts.pop(),
   (d:any)=>d.layout.used_sheets.push('fake'),(d:any)=>d.candidates[0].width_mm=99,
   (d:any)=>d.candidates[0].material_id=randomUUID(),(d:any)=>d.candidates[0].grain=null,
   (d:any)=>d.blank_grain[0].axis='z',(d:any)=>d.candidates[0].count=17,
   (d:any)=>d.requirements.pop(),(d:any)=>d.requirements[0].revision++,
   (d:any)=>d.requirements[0].fake_quantity=100,(d:any)=>d.candidate_sources[0].kind='stock',
  ]
  for(let i=0;i<mutations.length;i++){
   const p=structuredClone(f.payload);p.record_id=saved.recordId;p.expected_revision=1;p.data.key='bad'+i;mutations[i](p.data)
   await assert.rejects(f.write(p),undefined,'forgery '+i)
  }
  assert.equal((await f.read(saved.recordId)).revision,1)
 })
 await t.test('duplicate/new identity, changed operation key and stale expected revision cannot replace history',async()=>{
  await assert.rejects(f.write({...f.payload,data:{...f.payload.data,key:'duplicate'}}),/cut_plan_exists/)
  await assert.rejects(f.write({...f.payload,data:{...f.payload.data,change_note:'Different payload same key'}}),/operation_reused/)
  const p={...f.payload,record_id:saved.recordId,expected_revision:0,data:{...f.payload.data,key:'stale'}}
  await assert.rejects(f.write(p),/cut_plan_changed/)
 })
 await t.test('outsider, anonymous, direct writes and expired/settled claims cannot save or leak plans',async()=>{
  assert.equal((await asProjectUser(f.pg,f.other,'select * from bob.material_cut_plans')).rows.length,0)
  await assert.rejects(f.rpc('bob.read_material_cut_plan',[f.project,saved.recordId,null],f.other),/project_denied/)
  await assert.rejects(f.write(f.payload,f.other),/project_denied|turn_not_claimed/)
  await assert.rejects(f.rpc('bob.read_material_cut_plan',[f.project,saved.recordId,null],null,'anon'),/permission denied/)
  for(const table of ['material_cut_plans','material_cut_plan_revisions','material_cut_plan_requirements'])await assert.rejects(asProjectUser(f.pg,f.user,`delete from bob.${table}`),/permission denied/)
  await f.pg.query('update bob_private.bob_thread_provider_state set lock_started_at=now()-interval \'6 minutes\' where in_flight_turn_id=$1',[f.turn])
  await assert.rejects(f.write(f.payload),/turn_not_claimed/)
 })
})

test('versioned stock/catalog formats bind plans with current whole-sheet capacity; revisions make old plans stale',async t=>{
 const f=await fixture(t), stockId=randomUUID()
 const fmt={material_id:f.material.recordId,material_revision:1,length_mm:2440,width_mm:1220,thickness_mm:18,grain:'length',basis:'provided_spec',note:'Synthetic specified stock, physical condition not checked'}
 const stockData:any={name:'Fixture sheet',specification:'Synthetic',quantity:'1',unit:'pcs',status:'available',area_id:null,notes:'Fixture only',change_note:'Fixture',sheet_format:fmt}
 await f.rpc('bob.stock_command',[f.project,'create',stockId,0,JSON.stringify(stockData)])
 for(const patch of [{unit:'m2'},{sheet_format:{...fmt,thickness_mm:21}},{sheet_format:{...fmt,width_mm:0}},{sheet_format:{...fmt,grain:null}},{sheet_format:{...fmt,basis:'invented'}},{sheet_format:{...fmt,length_mm:2440.0000001}},{sheet_format:{...fmt,material_id:randomUUID()}}])
  await assert.rejects(f.rpc('bob.stock_command',[f.project,'create',randomUUID(),0,JSON.stringify({...stockData,...patch})]))
 const p=structuredClone(f.payload);p.data.candidate_sources=[{candidate_id:'sheet',kind:'stock',record_id:stockId,revision:1}]
 const saved=await f.write(p),record=await f.read(saved.recordId)
 assert.equal(record.capacity[0].available_sheets,1);assert.equal(record.stock_reserved,false)
 await t.test('overoffered capacity, duplicated stock aliases, foreign or mismatching formats fail',async()=>{
  const tooMany=structuredClone(p);tooMany.record_id=saved.recordId;tooMany.expected_revision=1;tooMany.data.key='too-many';tooMany.data.candidates[0].count=2
  // Recompute a valid two-sheet geometry so capacity, rather than the cut
  // verifier, is the rejecting boundary.
  const fit:any=constructionCutFit(constructionLists(f.draft,f.catalog,[]),tooMany.data.candidates,f.blank_grain)
  tooMany.data.layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
  await assert.rejects(f.write(tooMany),/cut_plan_stock_capacity_changed/)
  const aliases=structuredClone(tooMany);aliases.data.key='aliases';aliases.data.candidates[0].count=1;aliases.data.candidates.push({...aliases.data.candidates[0],id:'alias'})
  aliases.data.candidate_sources.push({candidate_id:'alias',kind:'stock',record_id:stockId,revision:1})
  const aliasFit:any=constructionCutFit(constructionLists(f.draft,f.catalog,[]),aliases.data.candidates,f.blank_grain)
  aliases.data.layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,aliasFit[k]]))
  await assert.rejects(f.write(aliases),/cut_plan_stock_capacity_changed/)
  const foreign=structuredClone(p);foreign.record_id=saved.recordId;foreign.expected_revision=1;foreign.data.key='foreign';foreign.data.candidate_sources[0].record_id=randomUUID()
  await assert.rejects(f.write(foreign),/cut_plan_stock_changed/)
  const mismatched=structuredClone(p);mismatched.record_id=saved.recordId;mismatched.expected_revision=1;mismatched.data.key='wrong-format';mismatched.data.candidates[0].grain='none'
  await assert.rejects(f.write(mismatched),/cut_plan_invalid_blank|cut_plan_format_mismatch/)
 })
 await t.test('existing reservations reduce current capacity across stock revisions; a plan is never a reservation',async()=>{
  const manual=randomUUID(),fields={name:'Other manual sheet need',category:'Timber',area_id:null,task_id:null,unit:'pcs',required_quantity:'1',waste_percent:'0',purchase_increment:'1',basis:'Synthetic exact sheet need',assumptions:'Fixture',artifact_id:null,artifact_revision:null,target_revision:1,stock_allocations:[{id:stockId,revision:1,quantity:'1'}],component_allocations:[],change_note:'Fixture'}
  await f.rpc('bob.material_requirement_command',[f.project,'create',manual,0,JSON.stringify(fields)])
  const stock=(await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'stock',record_id:stockId,after_id:null})])).records[0]
  assert.equal(stock.reserved_quantity,1);assert.equal(stock.unreserved_sheets,0)
  assert.equal((await f.read(saved.recordId)).source_state,'changed')
  const blocked=structuredClone(p);blocked.record_id=saved.recordId;blocked.expected_revision=1;blocked.data.key='reserved'
  await assert.rejects(f.write(blocked),/cut_plan_stock_capacity_changed/)
  await f.rpc('bob.material_requirement_command',[f.project,'archive',manual,1,'{}'])
  assert.equal((await f.read(saved.recordId)).source_state,'current')
 })
 await t.test('stock revise/archiving keep original format history and old plan cannot claim current stock',async()=>{
  const withoutFormat={...stockData};delete withoutFormat.sheet_format
  await f.rpc('bob.stock_command',[f.project,'revise',stockId,1,JSON.stringify({...withoutFormat,notes:'Changed stock note'})])
  const stock=(await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'stock',record_id:stockId,after_id:null})])).records[0]
  assert.deepEqual(stock.sheet_format,fmt);assert.equal((await f.read(saved.recordId)).source_state,'changed')
  const stale=structuredClone(p);stale.record_id=saved.recordId;stale.expected_revision=1;stale.data.key='stale-stock'
  await assert.rejects(f.write(stale),/cut_plan_stock_changed/)
  const revised=structuredClone(stale);revised.data.key='revised';revised.data.candidate_sources[0].revision=2
  const next=await f.write(revised);assert.equal(next.revision,2);assert.equal((await f.read(saved.recordId)).source_state,'current')
  assert.equal((await f.read(saved.recordId,1)).source_state,'changed');assert.deepEqual((await f.read(saved.recordId,1)).layout,p.data.layout)
  await f.rpc('bob.stock_command',[f.project,'archive',stockId,2,'{}']);assert.equal((await f.read(saved.recordId)).source_state,'changed')
  await f.rpc('bob.stock_command',[f.project,'restore',stockId,3,'{}'])
  assert.deepEqual((await f.pg.query('select sheet_format from bob.stock_revisions where stock_id=$1 and revision=4',[stockId])).rows[0].sheet_format,fmt)
 })
 await t.test('catalog panel pin supports format without inventing a product or physical availability',async()=>{
  const part=await f.write({...f.base,kind:'catalog',data:{action:'ensure',key:'panel',kind:'part',name:'Fixture raw panel',aliases:[],profile_code:'panel',profile_revision:1,categories:['wood.plywood','sheet'],properties:{length:{value:'2440',unit:'mm',truth:'provided_spec',parameter:null,note:''},width:{value:'1220',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:f.material.recordId,material_revision:1,notes:'Format only, no supplier',source_kind:'design_choice',source_quote:'existing blanks',source_seq:null}})
  const catalogPlan=structuredClone(f.payload);catalogPlan.record_id=saved.recordId;catalogPlan.expected_revision=2;catalogPlan.data.key='catalog-plan';catalogPlan.data.candidate_sources[0]={candidate_id:'sheet',kind:'catalog_part',record_id:part.recordId,revision:1}
  const receipt=await f.write(catalogPlan);const plan=await f.read(receipt.recordId)
  assert.equal(receipt.revision,3);assert.equal(plan.capacity[0].kind,'catalog_part');assert.equal(plan.capacity[0].available_sheets,null);assert.equal(plan.input_evidence_verified,false)
  await assert.rejects(f.rpc('bob.material_requirement_command',[f.project,'publish',f.needs[0].recordId,1,'{}']),/construction_cut_fit_required/)
 })
})

test('changed needs, targets and geometry fence saved plans while retaining exact historical layouts',async t=>{
 const f=await fixture(t),saved=await f.write(f.payload)
 await f.rpc('bob.material_requirement_command',[f.project,'archive',f.needs[0].recordId,1,'{}'])
 assert.equal((await f.read(saved.recordId)).source_state,'changed')
 const blocked=structuredClone(f.payload);blocked.record_id=saved.recordId;blocked.expected_revision=1;blocked.data.key='archived-need'
 await assert.rejects(f.write(blocked),/cut_plan_requirements_changed/)
 await f.rpc('bob.material_requirement_command',[f.project,'restore',f.needs[0].recordId,2,'{}'])
 const repinned=structuredClone(blocked);repinned.data.key='repinned';repinned.data.requirements[0].revision=3
 assert.equal((await f.write(repinned)).revision,2);assert.equal((await f.read(saved.recordId)).source_state,'current')
 const next=structuredClone(f.constructionData);next.key='changed-source';next.recipe.definitions[0].x_mm=250;next.parameters=compileCadParameters(f.project,next.recipe,parameterPlan(next.recipe),new Map(),new Map())
 await f.write({...f.base,kind:'construction',record_id:f.construction.recordId,expected_revision:1,data:next})
 assert.equal((await f.read(saved.recordId)).source_state,'changed');assert.deepEqual((await f.read(saved.recordId,1)).layout,f.payload.data.layout)
 const stale=structuredClone(repinned);stale.expected_revision=2;stale.data.key='old-source'
 await assert.rejects(f.write(stale),/cut_plan_construction_changed/)
})

test('Bob computes saved layout, normal receipts survive the toolbox, and the operational reader can reopen it',async t=>{
 const f=await fixture(t),sources:any[]=[],saved:any[]=[]
 const writer=createProjectWriter(f.project,f.message,async p=>{try{return{data:await f.write(p),error:null}}catch(e:any){return{data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const tools=createConstructionTools({projectId:f.project,message:f.message,writer,hasAccess:async()=>true,read:async()=>f.draft,readCatalog:async()=>({projectId:f.project,status:'ok',record:[...f.catalog.values()][0]}),readSources:async()=>({project:new Map(),physical:new Map()})})
 const reader=createOperationalReader(f.project,async input=>({data:await f.rpc('bob.read_project_work',[f.project,JSON.stringify(input)]),error:null}),async()=>true,sources)
 const session=createBobToolSession({message:f.message,writer,constructionTools:tools,operationalReader:reader,lookup:createProjectLookup(f.project,async()=>({data:[],error:null}),async()=>({data:[],error:null})),readPolicy:seedToolPolicy})
 const initialBudget=writer.remaining
 const input:any={key:'cut-tool',record_id:null,expected_revision:0,artifact_id:f.construction.recordId,revision:1,requirements:f.payload.data.requirements,candidates:f.candidates,blank_grain:f.blank_grain,candidate_sources:f.payload.data.candidate_sources,change_note:'Computed by handler',request_quote:'Save a cut plan'}
 assert.deepEqual(schemaIssues(CONSTRUCTION_CUT_SAVE_TOOL.function.parameters,input),[])
 assert(schemaIssues(CONSTRUCTION_CUT_SAVE_TOOL.function.parameters,{...input,layout:f.payload.data.layout}).length>0)
 assert((await session.prepare()).some(t=>t.function.name==='save_construction_cut_plan'))
 const result:any=await session.execute('save_construction_cut_plan',input);assert.equal(result.status,'saved',JSON.stringify(result));saved.push(result.receipt)
 assert.equal(result.receipt.record.saved,true);assert.equal(result.receipt.record.layout.placements.length,2)
 const read:any=await session.execute('read_project_work',{resource:'cut_plan',record_id:result.receipt.recordId,after_id:null});assert.equal(read.status,'ok');assert.equal(read.records[0].source_state,'current')
 assert.equal(sources[0].dataset,'cut_plan');assert.equal(writer.remaining,initialBudget-1)
 const impossible=structuredClone(input);impossible.key='impossible';impossible.candidates[0].width_mm=99;const failed=await tools.execute('save_construction_cut_plan',impossible)
 assert.equal(failed.status,'infeasible');assert.equal(writer.remaining,initialBudget-1)
})
