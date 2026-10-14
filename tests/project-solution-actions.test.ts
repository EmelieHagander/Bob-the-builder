import { randomUUID } from 'node:crypto'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { designIntent } from './support/design-intent-fixture.ts'
import { createSolutionActions, SOLUTION_ACTION_TOOLS, type SolutionResource } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectWriter, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'

const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002'
const original='10000000-0000-4000-8000-000000000001',measurement='20000000-0000-4000-8000-000000000001'
let turn='30000000-0000-4000-8000-000000000001'
const quote='Make an explicit alternative and select it; link the recorded width.'
const set=(path:string,value:unknown)=>({op:'set',path,value_json:JSON.stringify(value)})
let pg:Awaited<ReturnType<typeof projectSchema>>,thread:string,generation:number,beforeCatalog:any
before(async()=>{
  pg=await projectSchema(async(db,name)=>{if(name.endsWith('_ai_solution_actions_catalog.sql'))beforeCatalog=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest})
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[user,'one@example.test',other,'other@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Project A'),('B','b','Private B'); insert into bob.areas(id,project_id,slug,name) values('areaA','A','assembly','Assembly'),('areaB','B','other','Other')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('otherB','B','Other','OB',$2)",[user,other])
  await asProjectUser(pg,user,"select bob.evidence_command('A','measurement','create',$1,0,$2::jsonb)",[measurement,JSON.stringify({subject:'Bed width',value:'90',unit:'cm',truth:'provided_spec',source:'Owner design size',notes:'Not measured',required:false})])
  await asProjectUser(pg,user,"select bob.solution_command('A','create',$1,0,$2::jsonb)",[original,JSON.stringify({title:'Original bed',description:'Existing bed',assumptions:'Unverified wall',tradeoffs:'Existing tradeoff',source_media_id:null,design_intent:designIntent(),measurements:[{id:measurement,revision:1}]})])
  const c:any=(await asProjectUser(pg,null,"select bob.bob_claim_turn('A',$1,$2,$3) result",[user,turn,quote],'service_role')).rows[0].result
  assert.equal(c.status,'claimed');thread=c.thread_id;generation=c.generation
})
after(async()=>{await pg?.close()})
const read=async(input:{resource:SolutionResource;query:string|null;after:string|null},uid=user)=>({data:(await asProjectUser(pg,uid,'select bob.read_bob_solution_context($1,$2,$3,$4) result',['A',input.resource,input.query,input.after])).rows[0].result,error:null})
const rpc=async(payload:WritePayload)=>{
  try{return {data:(await asProjectUser(pg,user,'select bob.bob_project_write_v18($1,$2,$3,$4,$5::jsonb) result',['A',thread,turn,generation,JSON.stringify(payload)])).rows[0].result,error:null}}
  catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}
}
function setup(){
  const payloads:WritePayload[]=[]
  const writer=createProjectWriter('A',quote,p=>{payloads.push(structuredClone(p));return rpc(p)},async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}))
  return {writer,payloads,actions:createSolutionActions({projectId:'A',writer,hasAccess:async()=>true,read})}
}
const choose=async(actions:ReturnType<typeof createSolutionActions>,resource:SolutionResource,query:string|null=null)=>{
  const r=await actions.execute('read_solution_context',{resource,query,next_ref:null});assert.equal(r.status,'ok',JSON.stringify(r));return r.entries
}
let created:string,createPayload:WritePayload
test('explicit alternative copies complete existing content; only changed fields and generated identity differ',async()=>{
  const {actions,payloads,writer}=setup(),scopes=await choose(actions,'scopes','Project A'),base=await choose(actions,'solutions','Original bed')
  assert.ok(!JSON.stringify(base).includes(original));assert.ok(!JSON.stringify(base).includes(measurement))
  const args={scope_ref:scopes[0].ref,base_ref:base[0].ref,changes:[set('/title','Alternative bed'),set('/description','Bed with back panel')],reason:'Explicit alternative',request_quote:quote}
  const r=await actions.execute('create_solution_alternative',args);assert.equal(r.status,'saved',JSON.stringify(r))
  createPayload=structuredClone(payloads[0])
  created=writer.receipts[0].recordId;assert.notEqual(created,original)
  const records:any=(await read({resource:'solutions',query:'Alternative bed',after:null})).data
  assert.equal(records[0].record.assumptions,'Unverified wall');assert.deepEqual(records[0].record.design_intent.choices,designIntent().choices)
  assert.deepEqual(records[0].measurements,[{id:measurement,revision:1}]);assert.equal(records[0].record.design_intent.alignment.status,'draft')
  assert.equal((await actions.execute('create_solution_alternative',args)).status,'saved');assert.equal(Number((await pg.query('select count(*) n from bob.solutions')).rows[0].n),2)
  assert.equal((await rpc({...payloads[0],data:{...payloads[0].data,solution:{...(payloads[0].data.solution as any),description:'Different retry'}}})).error?.code,'40001')
  assert.equal(Number((await pg.query('select count(*) n from bob.target_revisions')).rows[0].n),0,'create never selects')
})
test('scope and exact solution are bound; stale selection conflicts; intentional next selection can succeed in same turn',async()=>{
  const {actions,payloads}=setup(),scopes=await choose(actions,'scopes','Project A'),choices=await choose(actions,'solutions')
  const alt=choices.find((e:any)=>e.content.title==='Alternative bed'),old=choices.find((e:any)=>e.content.title==='Original bed')
  const args={scope_ref:scopes[0].ref,solution_ref:alt.ref,reason:'Choose alternate',request_quote:quote}
  assert.equal((await actions.execute('select_solution_alternative',args)).status,'saved')
  assert.equal((await actions.execute('select_solution_alternative',args)).status,'saved','exact retry')
  assert.equal((await actions.execute('select_solution_alternative',{...args,solution_ref:old.ref})).status,'conflict')
  const refreshed=await choose(actions,'scopes','Project A')
  assert.equal((await actions.execute('select_solution_alternative',{...args,scope_ref:refreshed[0].ref,solution_ref:old.ref})).status,'saved')
  assert.equal((await rpc(payloads[0])).error,null,'original retry survives later selection')
  const current:any=(await read({resource:'selected_solutions',query:null,after:null})).data
  assert.equal(current[0].record.id,original)
  const staleScope=(await choose(actions,'scopes','Project A'))[0]
  await asProjectUser(pg,user,"select bob.solution_command('A','select',$1,$2,$3::jsonb)",[original,current[0].target.revision,JSON.stringify({solution_revision:1,reason:'Another caller selected'})])
  assert.equal((await actions.execute('select_solution_alternative',{...args,scope_ref:staleScope.ref})).status,'conflict','a change outside this turn is also a conflict')
})
test('measurement link removal and addition preserve content, exact evidence and selection; changed source never refreshes silently',async()=>{
  const {actions,payloads,writer}=setup(),selected=(await choose(actions,'selected_solutions'))[0]
  const args={solution_ref:selected.ref,action:'remove_measurement',source_ref:null,item_index:0,role:null,note:null,reason:'Remove explicit link',request_quote:quote}
  const r=await actions.execute('change_solution_evidence',args);assert.equal(r.status,'saved',JSON.stringify(r));assert.equal(r.selected_updated,true)
  assert.deepEqual(writer.receipts.map(r=>r.dataset).sort(),['solutions','target'])
  assert.equal((await actions.execute('change_solution_evidence',args)).status,'saved')
  let s=(await choose(actions,'selected_solutions'))[0],m=(await choose(actions,'measurements'))[0]
  assert.equal(m.content.truth,'provided_spec');assert.equal(m.content.value,'90')
  const add={...args,solution_ref:s.ref,action:'add_measurement',source_ref:m.ref,item_index:null,reason:'Use the exact recorded width'}
  assert.equal((await actions.execute('change_solution_evidence',add)).status,'saved')
  const saved=structuredClone(payloads.at(-1)!)
  const canonical:any=(await read({resource:'selected_solutions',query:null,after:null})).data
  assert.equal(canonical[0].record.id,original);assert.equal(canonical[0].record.description,'Existing bed');assert.deepEqual(canonical[0].measurements,[{id:measurement,revision:1}])
  s=(await choose(actions,'selected_solutions'))[0]
  await asProjectUser(pg,user,"select bob.evidence_command('A','measurement','revise',$1,1,$2::jsonb)",[measurement,JSON.stringify({subject:'Bed width',value:'91',unit:'cm',truth:'provided_spec',source:'Updated owner size',notes:'Still not measured',required:false,change_note:'Owner correction'})])
  assert.equal((await rpc(saved)).error,null,'exact retry recovers even after the linked source changes')
  assert.equal((await actions.execute('change_solution_evidence',{...add,solution_ref:s.ref})).status,'conflict','stale source is not upgraded')
  assert.equal((await actions.execute('create_solution_alternative',{scope_ref:(await choose(actions,'scopes','Project A'))[0].ref,base_ref:null,changes:[set('/title','Repair duplicate'),set('/description','Wrong fallback')],reason:'Fallback',request_quote:quote})).status,'invalid')
})
test('source failure and downstream rejection leave the original solution and target unchanged',async()=>{
  const {actions}=setup(),s=(await choose(actions,'selected_solutions'))[0],m=(await choose(actions,'measurements'))[0]
  const before=(await pg.query('select count(*) n from bob.solution_revisions')).rows[0].n
  await pg.exec("create function bob_private.reject_bound_test() returns trigger language plpgsql as $$ begin raise exception 'synthetic_selection_rejected' using errcode='22023';end $$; create trigger reject_bound_test before insert on bob.target_revisions for each row execute function bob_private.reject_bound_test()")
  assert.equal((await actions.execute('change_solution_evidence',{solution_ref:s.ref,action:'add_measurement',source_ref:m.ref,item_index:null,role:null,note:null,reason:'Current pin',request_quote:quote})).status,'invalid')
  assert.equal((await pg.query('select count(*) n from bob.solution_revisions')).rows[0].n,before)
  await pg.exec('drop trigger reject_bound_test on bob.target_revisions;drop function bob_private.reject_bound_test()')
})
test('image links use exact source metadata and preserve prior design choices; removal is explicit',async()=>{
  await asProjectUser(pg,null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',['A',user,thread,turn,generation],'service_role')
  turn=randomUUID()
  const claim:any=(await asProjectUser(pg,null,"select bob.bob_claim_turn('A',$1,$2,$3) result",[user,turn,quote],'service_role')).rows[0].result
  assert.equal(claim.status,'claimed');thread=claim.thread_id;generation=claim.generation
  const image='40000000-0000-4000-8000-000000000001'
  await pg.query("insert into bob.media_assets(id,project_id,original_name,title,purpose,content_type,byte_size,width,height,state,created_by) values($1,'A','sample.png','Panel reference','reference','image/png',8,1,1,'ready',$2)",[image,user])
  const {actions,payloads}=setup(),source=(await choose(actions,'images'))[0]
  assert.ok(!JSON.stringify(source).includes(image));assert.match(source.content.note,/metadata only/)
  let s=(await choose(actions,'selected_solutions'))[0]
  const args={solution_ref:s.ref,action:'set_primary_image',source_ref:source.ref,item_index:null,role:null,note:null,reason:'Use the existing image',request_quote:quote}
  assert.equal((await actions.execute('change_solution_evidence',args)).status,'saved')
  s=(await choose(actions,'selected_solutions'))[0]
  const linked=await actions.execute('change_solution_evidence',{...args,solution_ref:s.ref,action:'add_design_reference',role:'appearance',note:'Appearance reference; no measured dimensions'})
  assert.equal(linked.status,'saved',JSON.stringify(linked))
  const saved=payloads.at(-1)!,canonical:any=(await read({resource:'selected_solutions',query:null,after:null})).data
  assert.equal(canonical[0].record.source_media_id,image);assert.equal(canonical[0].record.design_intent.references[0].image_id,image)
  assert.deepEqual(canonical[0].record.design_intent.choices,designIntent().choices)
  s=(await choose(actions,'selected_solutions'))[0]
  await pg.query("update bob.media_assets set updated_at=clock_timestamp(),title='Changed metadata' where id=$1",[image])
  assert.equal((await rpc(saved)).error,null)
  assert.equal((await actions.execute('change_solution_evidence',{...args,solution_ref:s.ref})).status,'conflict')
  assert.equal((await actions.execute('change_solution_evidence',{...args,solution_ref:s.ref,action:'clear_primary_image',source_ref:null})).status,'saved')
  const after:any=(await read({resource:'selected_solutions',query:null,after:null})).data
  assert.equal(after[0].record.source_media_id,null);assert.equal(after[0].record.design_intent.references.length,1,'clearing primary does not clear reference list')
})
test('foreign caller, fabricated refs and wrong source kinds are rejected without writes; pagination stays bound',async()=>{
  for(const resource of ['solutions','scopes','measurements','images'] as SolutionResource[])await assert.rejects(read({resource,query:null,after:null},other),/project_denied/)
  const {actions,payloads}=setup(),s=(await choose(actions,'selected_solutions'))[0],scope=(await choose(actions,'scopes','Project A'))[0]
  assert.equal((await actions.execute('select_solution_alternative',{solution_ref:original,scope_ref:scope.ref,reason:'Bad ref',request_quote:quote})).status,'invalid')
  assert.equal((await actions.execute('change_solution_evidence',{solution_ref:s.ref,action:'set_primary_image',source_ref:scope.ref,item_index:null,role:null,note:null,reason:'Wrong kind',request_quote:quote})).status,'invalid')
  assert.equal(payloads.length,0)
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA2','A','second','Second'),('areaA3','A','third','Third')")
  const page=await actions.execute('read_solution_context',{resource:'scopes',query:null,next_ref:null});assert.ok(page.next_ref)
  assert.equal((await actions.execute('read_solution_context',{resource:'images',query:null,next_ref:page.next_ref})).status,'invalid')
  assert.equal((await actions.execute('read_solution_context',{resource:'scopes',query:'Other',next_ref:page.next_ref})).status,'invalid')
  assert.equal((await actions.execute('read_solution_context',{resource:'scopes',query:null,next_ref:page.next_ref})).status,'ok')
})
test('a stale copied base cannot create a replacement; blank creation receives server identity and Area scope',async()=>{
  const stale={...createPayload,data:{...createPayload.data,solution:{...(createPayload.data.solution as any),title:'Must not create from stale base'}}}
  const count=(await pg.query('select count(*) n from bob.solutions')).rows[0].n
  assert.equal((await rpc(stale)).error?.code,'40001');assert.equal((await pg.query('select count(*) n from bob.solutions')).rows[0].n,count)
  await asProjectUser(pg,null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',['A',user,thread,turn,generation],'service_role')
  turn=randomUUID()
  const c:any=(await asProjectUser(pg,null,"select bob.bob_claim_turn('A',$1,$2,$3) result",[user,turn,quote],'service_role')).rows[0].result
  assert.equal(c.status,'claimed');thread=c.thread_id;generation=c.generation
  const {actions,writer}=setup(),scope=(await choose(actions,'scopes','Assembly'))[0]
  const r=await actions.execute('create_solution_alternative',{scope_ref:scope.ref,base_ref:null,changes:[set('/title','New Area alternative'),set('/description','New content only')],reason:'Explicit new direction',request_quote:quote})
  assert.equal(r.status,'saved',JSON.stringify(r));assert.equal(writer.receipts[0].record.area_id,'areaA')
  const saved=(await choose(actions,'solutions','New Area alternative'))[0]
  assert.equal(saved.content.assumptions,'');assert.equal(saved.content.design_intent,null);assert.deepEqual(saved.content.measurements,[])
  assert.equal((await actions.execute('select_solution_alternative',{scope_ref:scope.ref,solution_ref:saved.ref,reason:'Choose Area alternative',request_quote:quote})).status,'saved')
})
test('an evidence action cannot take over the content editor receipt for an identical stale inner payload',async()=>{
  const s:any=((await read({resource:'selected_solutions',query:'Original bed',after:null})).data as any[])[0]
  const data={target:s.target,solution:{...Object.fromEntries(['title','description','assumptions','tradeoffs','source_media_id','design_intent'].map(k=>[k,s.record[k]])),measurements:s.measurements,change_note:'Same requested content'}}
  const content:WritePayload={kind:'bound_solution',record_id:s.record.id,expected_revision:s.record.revision,expected_updated_at:null,request_quote:quote,data}
  const saved=await rpc(content);assert.equal(saved.error,null)
  const evidence:WritePayload={...content,kind:'bound_solution_evidence',data:{...data,sources:[]}}
  assert.equal((await rpc(evidence)).error?.code,'40001')
  assert.deepEqual(await rpc(content),saved,'content editor retains its exact retry receipt')
})
test('new catalog removes legacy solution writes, omits database inputs, and preserves older manifests and model settings',async()=>{
  const live=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest
  assert.ok(beforeCatalog,'publication exists')
  assert.deepEqual((await pg.query<any>("select shared.resolve_ai_catalog('bob',$1) manifest",[beforeCatalog.manifest_id])).rows[0].manifest,beforeCatalog)
  assert.deepEqual(live.models,beforeCatalog.models)
  for(const row of beforeCatalog.definitions)if(!['tools.save_project_solution','tools.select_project_target','bob.tools'].includes(row.prompt_key))assert.deepEqual(live.definitions.find((r:any)=>r.prompt_key===row.prompt_key),row)
  for(const spec of SOLUTION_ACTION_TOOLS){
    const row=live.definitions.find((r:any)=>r.prompt_key==='tools.'+spec.function.name);assert.deepEqual(row.definition.parameters,spec.function.parameters)
    const model=catalogFixture().tool(spec.function.name,{server_quote:true}).function.parameters
    for(const key of ['record_id','area_id','expected_revision','expected_updated_at','request_quote','image_id'])assert.ok(!JSON.stringify(model).includes('"'+key+'"'))
  }
  const {writer,actions}=setup(),lookup=createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null}))
  const session=createBobToolSession({aiCatalog:catalogFixture(),message:quote,lookup,writer,solutionActions:actions,readPolicy:seedToolPolicy})
  const names=(await session.prepare()).map(t=>t.function.name)
  assert.ok(names.includes('create_solution_alternative'));assert.ok(!names.includes('save_project_solution'));assert.ok(!names.includes('select_project_target'))
  const old=createBobToolSession({aiCatalog:createAiCatalogSession({rpc:async()=>{throw Error('Pinned only')}},{app:'bob',manifest:beforeCatalog}),message:quote,lookup,writer,solutionActions:actions,readPolicy:seedToolPolicy})
  const oldNames=(await old.prepare()).map(t=>t.function.name);assert.ok(!oldNames.includes('create_solution_alternative'));assert.ok(oldNames.includes('save_project_solution'))
})
test('journal restart reuses exact choices and writes, with live authority still checked',async()=>{
  const entries:JournalEntry[]=[],rows:any=(await read({resource:'solutions',query:'Alternative bed',after:null})).data
  const scopes:any=(await read({resource:'scopes',query:'Project A',after:null})).data
  let readCount=0,writes=0,allowed=true
  const run=async()=>{
    const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity)
    const writer=createProjectWriter('A',quote,p=>journal.run('write',p,async()=>{writes++;return {data:{projectId:'A',dataset:'target',recordId:'A',label:'Selected target',operation:'updated',savedAt:'2026-10-14T12:00:00Z',revision:20,record:{id:'A',solution_id:created,solution_revision:1,revision:20}},error:null}}),async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}))
    const actions=createSolutionActions({projectId:'A',writer,hasAccess:async()=>allowed,read:input=>journal.run('read',input,async()=>{readCount++;return {data:input.resource==='scopes'?scopes:rows,error:null}})})
    const choices=await actions.execute('read_solution_context',{resource:'solutions',query:null,next_ref:null});if(choices.status!=='ok')return choices
    const scope=await actions.execute('read_solution_context',{resource:'scopes',query:null,next_ref:null})
    return actions.execute('select_solution_alternative',{solution_ref:choices.entries[0].ref,scope_ref:scope.entries[0].ref,reason:'Choose',request_quote:quote})
  }
  const first=await run();assert.equal(first.status,'saved');rows[0].record.revision=20
  assert.deepEqual(await run(),first);assert.equal(readCount,2);assert.equal(writes,1)
  allowed=false;assert.equal((await run()).status,'denied');assert.equal(writes,1)
})
