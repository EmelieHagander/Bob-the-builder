// Bob's side of joint fasteners (owner decisions 2026-10-26): lists show the
// server schedule, write tools carry an optional override (null = rule), and
// only manifests from the joint-fasteners publication see any of it.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {constructionLists} from '../supabase/functions/_shared/construction-lists.ts'
import {parseFastenerSchedule,storedJoints,withRuleFasteners,withoutJointFasteners} from '../supabase/functions/_shared/construction-fasteners.ts'
import {CONSTRUCTION_EDIT_TOOL} from '../supabase/functions/_shared/construction-edits.ts'
import {projectSchema} from './support/project-schema.ts'
import {catalogFixture,prePhaseToolsCatalogFixture} from './support/ai-catalog-fixture.ts'
import {listFixture} from './construction-lists.test.ts'

const artifact='11111111-1111-4111-8111-111111111111'
async function serverSchedule(draft:any){
 const pg=await projectSchema()
 try{
  const s=(await pg.query('select bob_private.construction_fastener_schedule($1::jsonb,$2::jsonb) s',[JSON.stringify(draft.recipe),JSON.stringify(draft.joints)])).rows[0].s as any
  return {status:'ok',artifact_id:draft.artifact_id,revision:draft.revision,...s}
 }finally{await pg.close()}
}

test('lists carry the server schedule; an unreadable schedule is a gap; older manifests keep the original list',async()=>{
 const {draft,catalog}=listFixture()
 const schedule=await serverSchedule(draft)
 const original=constructionLists(draft,catalog,[])
 const filled=constructionLists(draft,catalog,[],parseFastenerSchedule(schedule,artifact,4)) as any
 // 21 mm sides screwed into 21 mm shelf edges: 4.0 x 55 (>= 52.5), 300 mm contact -> 3 each, six joints.
 assert.deepEqual(filled.joints[0].hardware_product,{kind:'screw',diameter_mm:4,length_mm:55})
 assert.equal(filled.joints[0].hardware_quantity,3)
 assert.equal(filled.joints[0].fastener.source,'rule')
 assert.deepEqual(filled.fasteners.totals.map((t:any)=>[t.kind,t.diameter_mm,t.length_mm,t.count]),[['screw',4,55,18]])
 assert.equal(filled.fasteners.glue_packages,0);assert.equal(filled.fasteners.basis,'rule_of_thumb_proposal')
 assert(filled.gaps.some((g:any)=>g.code==='fastener_capacity_unverified'))
 assert(!filled.gaps.some((g:any)=>g.code==='joint_hardware_unverified'))
 const unavailable=constructionLists(draft,catalog,[],null) as any
 assert(unavailable.gaps.some((g:any)=>g.code==='fastener_schedule_unavailable'))
 assert(unavailable.joints.every((j:any)=>j.hardware_quantity===null))
 // No schedule reader: byte-identical to the original list.
 assert.deepEqual(constructionLists(draft,catalog,[],undefined),original)
 assert(!('fasteners' in original))
 // A schedule for another revision is not used.
 assert.equal(parseFastenerSchedule(schedule,artifact,5),null)
})

test('derive_construction_lists reads the schedule only when the tool session has a reader',async()=>{
 const {draft,catalog}=listFixture()
 const schedule=await serverSchedule(draft)
 let fastenerReads=0
 const base={projectId:'p_fixture',message:'Lists please',hasAccess:async()=>true,read:async()=>draft,
  readCatalog:async()=>({projectId:draft.projectId,status:'ok',record:[...catalog.values()][0]}),
  readSources:async()=>({project:new Map(),physical:new Map()}),now:()=>new Date('2026-10-05')}
 const input={artifact_id:artifact,revision:4,assembly_dependencies:[]}
 const old=await createConstructionTools(base as any).execute('derive_construction_lists',input)
 assert(old.joints.every((j:any)=>!('fastener' in j)))
 const pinned=await createConstructionTools({...base,readFasteners:async(id:string,revision:number)=>{fastenerReads++;assert.equal(id,artifact);assert.equal(revision,4);return schedule}} as any)
  .execute('derive_construction_lists',input)
 assert.equal(fastenerReads,1)
 assert.equal(pinned.fasteners.totals[0].count,18)
})

test('write tools treat a missing or null fastener as the rule and store only explicit choices',async()=>{
 const joint={id:'j',method:'screwed_butt',first:{instance_id:'a',face:'x_max'},second:{instance_id:'b',face:'x_min'},reason:'Screwed'}
 const nail={kind:'nail',diameter_mm:2.8,length_mm:50,count:null,spacing_mm:null,reason:'Owner prefers nails'}
 assert.deepEqual(withRuleFasteners([joint]),[{...joint,fastener:null}])
 assert.deepEqual(storedJoints([{...joint,fastener:null},{...joint,id:'k',fastener:nail}]),[joint,{...joint,id:'k',fastener:nail}])
 assert.equal(storedJoints(null),null)

 // The real edit tool: an old pinned call without the field passes the schema
 // and reaches the database as a five-key joint; an explicit choice is kept.
 const payloads:any[]=[]
 const tools=createConstructionTools({projectId:'p_fixture',message:'Use nails on the shelf',hasAccess:async()=>true,read:async()=>null,
  readSources:async()=>({project:new Map(),physical:new Map()}),
  writer:{commit:async(p:any)=>{payloads.push(p);return {status:'saved',receipt:{}}}} as any,
  prepareEdit:async()=>({status:'saved'})} as any)
 const edit=(upsert:unknown[])=>tools.execute('edit_construction_parts',{key:'shelf_nails',record_id:artifact,expected_revision:4,change_note:'Nails on the shelf',
  request_quote:'Use nails on the shelf',changes:{joints:{upsert,remove:[]}}})
 assert.equal((await edit([joint])).status,'saved')
 assert.equal((await edit([{...joint,fastener:nail}])).status,'saved')
 assert.deepEqual(payloads[0].data.changes.joints.upsert,[joint])
 assert.deepEqual(payloads[1].data.changes.joints.upsert,[{...joint,fastener:nail}])
 const prose=await edit([{...joint,fastener:{...nail,reason:'bob_project_write_v16'}}])
 assert.equal(prose.status,'invalid');assert.equal(payloads.length,2)
 const wrong=await edit([{...joint,fastener:{...nail,kind:'staple'}}])
 assert.equal(wrong.status,'invalid');assert.equal(payloads.length,2)
})

test('the latest catalog publishes the field and the rule note; the publication is reproducible',async()=>{
 const latest=catalogFixture()
 for(const key of ['tools.save_construction_draft','tools.transition_legacy_drawing','tools.edit_construction_parts','tools.derive_construction_lists']){
  assert.equal(latest.definition(key).metadata.joint_fastener_version,1,key)
  assert.equal(latest.definition(key).metadata.publication,key==='tools.save_construction_draft'?'form-refinement-v1':'joint-fasteners-v1',key)
 }
 assert.deepEqual(latest.tool('edit_construction_parts').function.parameters,CONSTRUCTION_EDIT_TOOL.function.parameters)
 assert.match(latest.definition('tools.save_construction_draft').definition.additional_description,/Joint fastener: null applies the fixed rule/)
 assert.match(latest.definition('tools.derive_construction_lists').definition.additional_description,/server fastener schedule/)
 assert.deepEqual(withoutJointFasteners(CONSTRUCTION_EDIT_TOOL.function.parameters).properties.changes.properties.joints.properties.upsert.items.required,
  ['id','method','first','second','reason'])
 const sql=await readFile(new URL('../supabase/migrations/20261026173000_ai_joint_fasteners_catalog.sql',import.meta.url),'utf8')
 assert.match(sql,/joint_fasteners_schema_changed/)
 const source=await readFile(new URL('../supabase/functions/_shared/ask-openai.ts',import.meta.url),'utf8')
 assert.match(source,/prompt_key==='tools\.derive_construction_lists'&&row\.metadata\?\.joint_fastener_version===1/)
 assert.match(source,/readRpc\('read_construction_fasteners'/)
})

test('fastener requirement refusals reach Bob as specific, answerable messages',async()=>{
 const {createProjectWriter}=await import('../supabase/functions/_shared/project-write.ts')
 const message='Add the screws to the list'
 for(const [code,status,pattern] of [['fastener_group_not_in_schedule','invalid',/totals row of derive_construction_lists/],['fastener_requirement_exists','conflict',/revise that existing requirement/],
  ['fastener_construction_required','invalid',/exact current saved construction revision/],['construction_derive_required','invalid',/blank, fastener or glue/],
  ['fastener_quantity_exact','invalid',/^No requirement saved\. Fastener and glue needs are exact counts from the schedule; leave waste_percent out\. If a spare is sensible, recommend it in your reply instead, separate from the need\.$/]] as const){
  const writer=createProjectWriter('p_fixture',message,async()=>({data:null,error:{code:code==='fastener_requirement_exists'?'PT409':'22023',message:code}}),
   async()=>({data:[],error:null}),async()=>({data:{generation:1,receipts:[]},error:null}),{})
  const r:any=await writer.commit({kind:'operational',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{resource:'cad_requirement',action:'create',fields:{quantity_mode:'fasteners'}}})
  assert.equal(r.status,status,code);assert.match(r.message,pattern)
 }
})

test('the latest catalog says fastener and glue needs are exact; the publication touches only the derive tool and is reproducible',async t=>{
 // Owner decision 2026-10-26: show the exact count; Bob may recommend a spare in words.
 const latest=catalogFixture(),derive=latest.definition('tools.derive_cad_material_requirement')
 const note=' Fastener and glue needs are exact counts from the schedule, so omit waste_percent (or send 0); purchase_increment stays the pack size. If a spare is sensible, recommend it in the reply as a suggestion, separate from the need.'
 assert(derive.definition.additional_description.endsWith(note))
 assert.equal(derive.definition.additional_description.split(note).length,2)
 assert.doesNotMatch(note,/["“”]|e\.g\.|for example/,'model-facing notes carry no example utterances')
 assert.equal(derive.metadata.publication,'exact-fasteners-v1');assert.equal(derive.metadata.exact_fastener_version,1);assert.equal(derive.metadata.joint_fastener_version,1)
 assert.deepEqual(latest.manifest().definitions.filter(row=>row.metadata?.exact_fastener_version===1).map(row=>row.prompt_key),['tools.derive_cad_material_requirement'])
 const publication='supabase/migrations/20261026190500_ai_exact_fasteners_catalog.sql'
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-exact-fasteners-catalog.ts',publication,'--check'],{encoding:'utf8'}),/matches its builder/)

 // Compare the full schema at this publication's boundary; later publications
 // may legitimately revise other definitions. Older manifests stay intact.
 let prior:any
 const migration=publication.split('/').at(-1)!
 const pg=await projectSchema(async(db,name)=>{if(name===migration)prior=((await db.query("select shared.resolve_ai_catalog('bob',null) m")).rows[0] as any).m},migration)
 t.after(()=>pg.close())
 const published=((await pg.query("select shared.resolve_ai_catalog('bob',null) m")).rows[0] as any).m
 const byKey=(m:any)=>new Map<string,any>(m.definitions.map((row:any)=>[row.prompt_key,row]))
 const before=byKey(prior),after=byKey(published)
 assert.deepEqual([...after.keys()].sort(),[...before.keys()].sort())
 for(const [key,row] of after)if(key!=='tools.derive_cad_material_requirement')assert.deepEqual(row,before.get(key),key)
 const old=before.get('tools.derive_cad_material_requirement'),next=after.get('tools.derive_cad_material_requirement')
 assert.equal(next.version,old.version+1);assert.equal(old.definition.additional_description.includes(note),false)
 // The 2026-10-29 phase-tools publication later rewrote only this tool's card; compare at the boundary before it.
 const boundary=prePhaseToolsCatalogFixture().definition('tools.derive_cad_material_requirement')
 assert.deepEqual(next.definition,boundary.definition);assert.deepEqual(next.metadata,boundary.metadata)
 assert.deepEqual({...derive.definition,card_description:boundary.definition.card_description},boundary.definition)
 assert.deepEqual(next.available_variables,old.available_variables);assert.deepEqual(next.flow,old.flow)
 assert.deepEqual(((await pg.query("select shared.resolve_ai_catalog('bob',$1) m",[prior.manifest_id])).rows[0] as any).m,prior)
 const active=async()=>((await pg.query("select active_version_id from shared.ai_prompts where app='bob' and prompt_key='tools.derive_cad_material_requirement'")).rows[0] as any).active_version_id
 const current=await active()
 await pg.exec(await readFile(new URL('../'+publication,import.meta.url),'utf8'))
 assert.equal(await active(),current,'Re-running is a no-op')
})
