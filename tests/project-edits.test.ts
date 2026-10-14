import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { designIntent } from './support/design-intent-fixture.ts'
import { applyProjectDelta, createProjectEdits, PROJECT_EDIT_TOOLS, type EditSnapshot } from '../supabase/functions/_shared/project-edits.ts'
import { createProjectWriter, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { catalogFixture, legacyCatalogFixture } from './support/ai-catalog-fixture.ts'
import { runProjectAnswer } from './support/bob-model-routing.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'

const user = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const solution = '10000000-0000-4000-8000-000000000001'
const measurement = '20000000-0000-4000-8000-000000000001'
const snapshot: EditSnapshot = { project_id: 'A', resource: 'selected_solutions', key: 'project', scope_label: 'Project A',
  record: { id: solution, revision: 1, title: 'Bunk bed', description: 'Existing bed', assumptions: 'Unverified wall', tradeoffs: 'Existing tradeoff', source_media_id: null, design_intent: designIntent() },
  measurements: [{ id: measurement, revision: 1 }], target: { area_id: null, revision: 1, solution_id: solution, solution_revision: 1 } }
const set = (path: string, value: unknown) => ({ op: 'set', path, value_json: JSON.stringify(value) })
const delta = [set('/description', 'Existing bed with back panel'), set('/design_intent/features/-', { description: 'Back panel behind bookcase', basis: 'user_request' })]
const targetReceipt = { projectId:'A',dataset:'target',recordId:'A',label:'Selected project target',operation:'updated',savedAt:'2026-10-14T10:00:00Z',revision:2,record:{id:'A',solution_id:solution,solution_revision:2,revision:2} }

test('deltas preserve sources and old decisions; new item identity is deterministic and alignment becomes draft', async () => {
  const first = await applyProjectDelta(snapshot, delta, 'Requested panel')
  assert.deepEqual(first, await applyProjectDelta(snapshot, delta, 'Requested panel'))
  assert.equal(first.id, solution); assert.equal(first.assumptions, snapshot.record.assumptions)
  assert.deepEqual(first.design_intent.choices, snapshot.record.design_intent.choices)
  assert.deepEqual(first.design_intent.features[0], snapshot.record.design_intent.features[0])
  assert.match(first.design_intent.features[1].id, /^edit_/)
  assert.equal(first.design_intent.alignment.status, 'draft')
  assert.equal(snapshot.record.design_intent.features.length, 1)
})
test('identity, source, parent, prototype and whole-list replacements are rejected', async () => {
  for (const path of ['/id', '/revision', '/area_id', '/measurements', '/source_media_id', '/design_intent', '/design_intent/features', '/design_intent/features/0/id', '/design_intent/features/0/source_ref', '/__proto__/polluted']) {
    await assert.rejects(applyProjectDelta(snapshot, [set(path, 'changed')], 'Reason'))
  }
  await assert.rejects(applyProjectDelta(snapshot, [set('/design_intent/features/-', { id: 'made_up', description: 'Panel', basis: 'user_request' })], 'Reason'))
  await assert.rejects(applyProjectDelta(snapshot, [set('/design_intent/choices/0/status', 'open')], 'Reason'), /inconsistent/)
})

let pg: Awaited<ReturnType<typeof projectSchema>>
let beforeCatalog: any
let generation: number, thread: string
const turn = '30000000-0000-4000-8000-000000000001'
before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name.endsWith('_ai_server_bound_edits_catalog.sql')) beforeCatalog = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest
  })
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [user,'one@example.test',other,'other@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name,description) values('A','a','Project A','Original description'),('B','b','Private B','Private description')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('otherB','B','Other','OB',$2)", [user,other])
  await asProjectUser(pg, user, "select bob.evidence_command('A','measurement','create',$1,0,$2::jsonb)", [measurement, JSON.stringify({ subject: 'Bed width', value: '90', unit: 'cm', truth: 'provided_spec', source: 'Owner design size', notes: 'Not measured', required: false })])
  await asProjectUser(pg, user, "select bob.solution_command('A','create',$1,0,$2::jsonb)", [solution, JSON.stringify({ ...Object.fromEntries(['title','description','assumptions','tradeoffs','source_media_id','design_intent'].map(k => [k,snapshot.record[k]])), measurements: snapshot.measurements })])
  await asProjectUser(pg, user, "select bob.solution_command('A','select',$1,0,$2::jsonb)", [solution, JSON.stringify({ solution_revision: 1, reason: 'Owner selection' })])
  const c: any = (await asProjectUser(pg, null, "select bob.bob_claim_turn('A',$1,$2,'Add panel') result", [user, turn], 'service_role')).rows[0].result
  assert.equal(c.status, 'claimed'); generation = c.generation; thread = c.thread_id
})
after(async () => { await pg?.close() })
const rpc = async (payload: WritePayload) => {
  try { return { data: (await asProjectUser(pg,user,'select bob.bob_project_write_v17($1,$2,$3,$4,$5::jsonb) result',['A',thread,turn,generation,JSON.stringify(payload)])).rows[0].result, error: null } }
  catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
}
const read = async (input: { resource: string; query: string | null; after: string | null }, uid = user) => ({ data: (await asProjectUser(pg,uid,'select bob.read_bob_edit_context($1,$2,$3,$4) result',['A',input.resource,input.query,input.after])).rows[0].result, error: null })

test('real caller-scoped read → bound delta → same solution and target; exact retry returns original receipts', async () => {
  const writes: WritePayload[] = []
  const writer = createProjectWriter('A','Add panel',p => { writes.push(structuredClone(p)); return rpc(p) },async () => ({ data: [], error: null }),async () => ({ data: {generation: 2, receipts: []}, error: null }))
  const edits = createProjectEdits({ projectId: 'A', read, writer, hasAccess: async () => true })
  const context = await edits.execute('read_project_edit_context', { resource: 'selected_solutions', query: null, next_ref: null })
  assert.equal(context.status, 'ok'); assert.equal(context.entries.length, 1)
  assert.ok(!JSON.stringify(context).includes(solution)); assert.ok(!JSON.stringify(context).includes(measurement))
  const args = { edit_ref: context.entries[0].edit_ref, changes: delta, reason: 'Requested panel', request_quote: 'Add panel' }
  const invalid = await edits.execute('edit_project_record', { ...args, changes: [set('/area_id','wrong')] })
  assert.equal(invalid.status,'invalid'); assert.equal(writes.length,0); assert.equal(writer.needsRepair,true)
  const saved = await edits.execute('edit_project_record',args)
  assert.equal(saved.status,'saved',JSON.stringify(saved)); assert.equal(saved.selected_updated,true)
  assert.equal(writer.needsRepair,false); assert.deepEqual(writer.receipts.map(r=>r.dataset).sort(),['solutions','target'])
  assert.equal(writes[0].record_id,solution); assert.equal(writes[0].expected_revision,1)
  const after: any = (await read({resource:'selected_solutions',query:null,after:null})).data
  assert.equal(after[0].record.id,solution); assert.equal(after[0].record.revision,2); assert.equal(after[0].target.solution_revision,2)
  assert.deepEqual(after[0].measurements,snapshot.measurements)
  assert.deepEqual(after[0].record.design_intent.choices,snapshot.record.design_intent.choices)
  const first = await rpc(writes[0]); assert.equal(first.error,null); assert.equal((first.data as any).revision,2)
  assert.equal(Number((await pg.query('select count(*) n from bob.solutions')).rows[0].n),1)
  assert.equal(Number((await pg.query('select count(*) n from bob.solution_revisions')).rows[0].n),2)
  // Same original read + different change is a conflict, never a new record.
  const changed = await edits.execute('edit_project_record',{...args,changes:[set('/title','Another title')]})
  assert.equal(changed.status,'conflict'); assert.equal(Number((await pg.query('select count(*) n from bob.solutions')).rows[0].n),1)
  const next = await edits.execute('read_project_edit_context',{resource:'selected_solutions',query:null,next_ref:null})
  const nextSave = await edits.execute('edit_project_record',{...args,edit_ref:next.entries[0].edit_ref,changes:[set('/title','Bunk bed with panel')]})
  assert.equal(nextSave.status,'saved',JSON.stringify(nextSave)); assert.equal(writer.needsRepair,false)
  assert.equal(Number((await pg.query('select count(*) n from bob.solution_revisions')).rows[0].n),3)
})

test('revoked/project-external callers cannot read or write bound context', async () => {
  await assert.rejects(read({resource:'solutions',query:null,after:null},other), /project_denied/)
  const edits = createProjectEdits({projectId:'A',read,hasAccess:async()=>false})
  assert.equal((await edits.execute('read_project_edit_context',{resource:'solutions',query:null,next_ref:null})).status,'denied')
})

test('a changed target rejects the entire edit even when the solution read is still current', async () => {
  const rows: any = (await read({resource:'selected_solutions',query:null,after:null})).data
  const s: EditSnapshot = rows[0]
  // Force a downstream domain rejection after the solution append. The entire
  // transaction, including both ledger entries, must roll back.
  await pg.exec("create function bob_private.reject_test_selection() returns trigger language plpgsql as $$ begin raise exception 'synthetic_selection_rejected' using errcode='22023'; end $$; create trigger reject_test_selection before insert on bob.target_revisions for each row execute function bob_private.reject_test_selection()")
  const payload:WritePayload={kind:'bound_solution',record_id:solution,expected_revision:s.record.revision,expected_updated_at:null,request_quote:'Add panel',data:{target:s.target,solution:{...Object.fromEntries(['title','description','assumptions','tradeoffs','source_media_id','design_intent'].map(k=>[k,s.record[k]])),description:'Must roll back',measurements:s.measurements,change_note:'Reason'}}}
  const rejected=await rpc(payload)
  assert.equal(rejected.error?.code,'22023')
  assert.equal(Number((await pg.query('select count(*) n from bob.solution_revisions')).rows[0].n),3)
  await pg.exec('drop trigger reject_test_selection on bob.target_revisions; drop function bob_private.reject_test_selection()')
  await asProjectUser(pg,user,"select bob.solution_command('A','clear',null,$1,$2::jsonb)",[s.target!.revision,JSON.stringify({reason:'Owner changed direction'})])
  const record = await applyProjectDelta(s,[set('/title','Do not save')],'Reason')
  const result = await rpc({kind:'bound_solution',record_id:solution,expected_revision:s.record.revision,expected_updated_at:null,request_quote:'Add panel',data:{target:s.target,solution:{...Object.fromEntries(['title','description','assumptions','tradeoffs','source_media_id','design_intent'].map(k=>[k,record[k]])),measurements:s.measurements,change_note:'Reason'}}})
  assert.equal(result.error?.code,'40001')
  assert.equal(Number((await pg.query('select count(*) n from bob.solution_revisions')).rows[0].n),3)
})

test('project description binds its timestamp and appends without copying existing text', async () => {
  const writer=createProjectWriter('A','Add panel',rpc,async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}))
  const edits=createProjectEdits({projectId:'A',read,writer,hasAccess:async()=>true})
  const context=await edits.execute('read_project_edit_context',{resource:'project_description',query:null,next_ref:null})
  const args={edit_ref:context.entries[0].edit_ref,changes:[{op:'append_text',path:'/description',value_json:JSON.stringify('\nAdded detail')}],reason:'Requested detail',request_quote:'Add panel'}
  const saved=await edits.execute('edit_project_record',args)
  assert.equal(saved.status,'saved',JSON.stringify(saved));assert.equal(saved.content.description,'Original description\nAdded detail')
  assert.equal(saved.selected_updated,false)
})

test('journal replay rebuilds the same selection and write without refreshing CAS or duplicating a save', async () => {
  const entries:JournalEntry[]=[]
  let reads=0,writes=0,allowed=true
  const source=structuredClone(snapshot)
  const run=async()=>{
    const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity)
    const writer=createProjectWriter('A','Add panel',p=>journal.run('write',p,async()=>{
      writes++
      return {data:{projectId:'A',dataset:'solutions',recordId:solution,label:'Bunk bed',operation:'updated',savedAt:'2026-10-14T10:00:00Z',revision:2,record:{...snapshot.record,...p.data.solution as object,revision:2},related_receipts:[targetReceipt]},error:null}
    }),async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}))
    const edits=createProjectEdits({projectId:'A',writer,hasAccess:async()=>allowed,read:input=>journal.run('read',input,async()=>{reads++;return {data:[source],error:null}})})
    const context=await edits.execute('read_project_edit_context',{resource:'selected_solutions',query:null,next_ref:null})
    if(context.status!=='ok')return context
    const saved=await edits.execute('edit_project_record',{edit_ref:context.entries[0].edit_ref,changes:delta,reason:'Requested panel',request_quote:'Add panel'})
    return {context,saved}
  }
  const original=await run();assert.equal(original.saved.status,'saved')
  source.record.revision=9;source.record.description='Concurrent change'
  assert.deepEqual(await run(),original);assert.equal(reads,1);assert.equal(writes,1)
  allowed=false;assert.equal((await run()).status,'denied');assert.equal(writes,1)
})

test('published model contract has no database IDs, concurrency fields or quote; old pinned manifests keep their bench', async () => {
  const live=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest
  const old=(await pg.query<any>("select shared.resolve_ai_catalog('bob',$1) manifest",[beforeCatalog.manifest_id])).rows[0].manifest
  assert.deepEqual(old,beforeCatalog);assert.deepEqual(live.models,beforeCatalog.models)
  for(const previous of beforeCatalog.definitions){
    if(['tools.save_project_solution','tools.save_project_description','bob.tools'].includes(previous.prompt_key))continue
    assert.deepEqual(live.definitions.find((r:any)=>r.prompt_key===previous.prompt_key),previous)
  }
  for(const tool of PROJECT_EDIT_TOOLS){
    const row=live.definitions.find((r:any)=>r.prompt_key==='tools.'+tool.function.name)
    assert.deepEqual(row.definition.parameters,tool.function.parameters)
    assert.deepEqual(row.metadata.server_fields,tool.function.name==='edit_project_record'?['request_quote']:[])
  }
  const catalog=catalogFixture()
  const schema=catalog.tool('edit_project_record',{server_quote:true}).function.parameters
  assert.deepEqual(Object.keys(schema.properties).sort(),['changes','edit_ref','reason'])
  for(const name of ['record_id','area_id','expected_revision','expected_updated_at','request_quote'])assert.ok(!JSON.stringify(schema).includes('"'+name+'"'))
  const writer=createProjectWriter('A','Add panel',rpc,async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}))
  const edits=createProjectEdits({projectId:'A',writer,hasAccess:async()=>true,read})
  const session=createBobToolSession({aiCatalog:catalog,message:'Add panel',lookup:createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null})),writer,projectEdits:edits,readPolicy:seedToolPolicy})
  const prepared=await session.prepare()
  assert.ok(prepared.some(t=>t.function.name==='edit_project_record'))
  assert.ok(!prepared.some(t=>t.function.name==='save_project_description'))
  await session.execute('save_project_solution',{record_id:solution})
  const afterFailure=await session.prepare()
  assert.ok(!afterFailure.some(t=>t.function.name==='save_project_solution'),'a failed edit cannot fall back to create')
  const legacy=createBobToolSession({aiCatalog:legacyCatalogFixture(),message:'Add panel',lookup:createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null})),writer,projectEdits:edits,readPolicy:seedToolPolicy})
  const oldTools=await legacy.prepare()
  assert.ok(!oldTools.some(t=>t.function.name==='edit_project_record'))
  assert.ok(oldTools.some(t=>t.function.name==='save_project_description'))
})

test('ambiguous results stay separate; pagination binds filters and cannot forge a selection', async () => {
  const many=[0,1,2].map(i=>({...structuredClone(snapshot),key:'scope'+i,scope_label:'Area '+i}))
  const inputs:unknown[]=[]
  const edits=createProjectEdits({projectId:'A',hasAccess:async()=>true,read:async input=>{inputs.push(input);return {data:input.after===null?many:[many[2]],error:null}}})
  const first=await edits.execute('read_project_edit_context',{resource:'selected_solutions',query:null,next_ref:null})
  assert.equal(first.entries.length,2);assert.notEqual(first.entries[0].edit_ref,first.entries[1].edit_ref);assert.ok(first.next_ref)
  assert.equal((await edits.execute('read_project_edit_context',{resource:'solutions',query:null,next_ref:first.next_ref})).status,'invalid')
  const next=await edits.execute('read_project_edit_context',{resource:'selected_solutions',query:null,next_ref:first.next_ref})
  assert.equal(next.entries.length,1);assert.equal(next.next_ref,null);assert.equal((inputs[1] as any).after,'scope1')
  const stale=createProjectEdits({projectId:'A',hasAccess:async()=>true,read:async()=>({data:[{...snapshot,head_revision:4}],error:null})})
  const selected=await stale.execute('read_project_edit_context',{resource:'selected_solutions',query:null,next_ref:null})
  assert.equal(selected.entries[0].selected_version_is_current,false)
})

test('the model loop reads, corrects an invalid delta, saves once and finishes without an extra completion call', async () => {
  let steps=0,writes=0,editRef=''
  const writer=createProjectWriter('A','Add panel',async p=>{
    writes++
    return {data:{projectId:'A',dataset:'solutions',recordId:solution,label:'Bunk bed',operation:'updated',savedAt:'2026-10-14T10:00:00Z',revision:2,record:{...snapshot.record,...p.data.solution as object,revision:2},related_receipts:[targetReceipt]},error:null}
  },async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}))
  const edits=createProjectEdits({projectId:'A',writer,read:async()=>({data:[snapshot],error:null}),hasAccess:async()=>true})
  const result=await runProjectAnswer({projectId:'A',userId:user,message:'Add panel',writer,projectEdits:edits,hasAccess:async()=>true,
    lookup:createProjectLookup('A',async()=>({data:{records:[{id:'A',name:'Project A'}],related:[],truncated:false},error:null})),
    callModel:async options=>{
      const n=steps++
      if(n===1){const content=options.messages.filter(m=>m.role==='tool').at(-1)!.content;editRef=JSON.parse(String(content)).entries[0].edit_ref}
      const toolCall=(name:string,args:unknown)=>({id:'call'+n,type:'function' as const,function:{name,arguments:JSON.stringify(args)}})
      const calls=n===0?[toolCall('read_project_edit_context',{resource:'selected_solutions',query:null,next_ref:null})]:n===1?[toolCall('edit_project_record',{edit_ref:editRef,changes:[set('/id','forged')],reason:'Reason'})]:n===2?[toolCall('edit_project_record',{edit_ref:editRef,changes:delta,reason:'Requested panel'})]:undefined
      return {success:true,data:calls?null:'Bakpanelen är sparad i samma lösning.',model:'fixture',responseId:'response'+n,usage:{input_tokens:1,output_tokens:1,total_tokens:2},toolCalls:calls}
    },
  })
  assert.equal(result.ok,true);assert.equal(steps,4);assert.equal(writes,1);assert.equal(writer.needsRepair,false)
  if(result.ok)assert.equal(result.evidence.partial,false)
})
