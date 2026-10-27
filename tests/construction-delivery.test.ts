import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cutPlanFixture } from './support/cut-plan-fixture.ts'
import { asProjectUser } from './support/project-schema.ts'
import { designManifest } from './support/design-intent-fixture.ts'
import { handoff } from './support/cad-review-fixture.ts'
import { buildCadLineage } from '../supabase/functions/_shared/cad-lineage.ts'
import { checkConstruction } from '../supabase/functions/_shared/construction-checks.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { CONSTRUCTION_DELIVERY_TOOL } from '../supabase/functions/_shared/construction-delivery.ts'
import { createRecordDetailReader } from '../supabase/functions/_shared/project-record-detail.ts'
import { createOperationalReader } from '../supabase/functions/_shared/project-operations.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'

const artifact='11111111-1111-4111-8111-111111111111'
const query={artifact_id:artifact,revision:1,resource:'drawings',after:null}
const page=()=>({status:'ok',projectId:'fixture',artifact_id:artifact,revision:1,resource:'drawings',index_only:true,records:[],truncated:false,next_after:null})
const unused=async()=>{throw Error('Delivery discovery must not read or regenerate geometry')}

test('delivery index uses the ordinary toolbox, checks source identity and authority, and never calls geometry',async()=>{
 let allowed=true,reads=0,result:any=page()
 const make=()=>createConstructionTools({projectId:'fixture',message:'Continue',unlimitedWork:true,hasAccess:async()=>allowed,
  read:unused,readSources:unused,readDelivery:async()=>{reads++;return result}})
 const tools=make(),session=createBobToolSession({constructionTools:tools,lookup:createProjectLookup('fixture',unused),readPolicy:seedToolPolicy})
 assert((await session.prepare()).some(t=>t.function.name==='read_construction_delivery'))
 assert.equal((await session.execute('read_construction_delivery',query)).status,'ok')
 assert.equal((await tools.execute('read_construction_delivery',{...query,project_id:'other'})).status,'invalid')
 assert.equal(reads,1)
 for(const bad of [{projectId:'other'},{revision:2},{resource:'cut_plans'},{index_only:false},{truncated:true},{records:[{id:artifact,revision:1,source:{artifact_id:artifact,revision:2}}]}]){
  result={...page(),...bad};assert.equal((await tools.execute('read_construction_delivery',query)).status,'unavailable')
 }
 allowed=false;const before=reads
 assert.equal((await tools.execute('read_construction_delivery',query)).status,'denied');assert.equal(reads,before)
 allowed=true
 const revoked=createConstructionTools({projectId:'fixture',message:'Continue',hasAccess:async()=>allowed,read:unused,readSources:unused,
  readDelivery:async()=>{allowed=false;return page()}})
 assert.equal((await revoked.execute('read_construction_delivery',query)).status,'denied')
})

function box() {
 const part=(id:string,definition_id:string,x:number,y:number,z:number)=>({id,definition_id,placement:{x,y,z,rx:0,ry:0,rz:0}})
 const joint=(id:string,a:string,af:string,b:string,bf:string)=>({id,method:'glued_butt',first:{instance_id:a,face:af},second:{instance_id:b,face:bf},reason:'Synthetic box contact; strength unverified'})
 return {title:'Five-panel box',description:'Open box with a bottom and four sides. Specified 18 mm board; strength and product suitability remain unverified.',
  message:'Save the box drawing, description and material/cutting lists and link the drawing to the work.',
  recipe:{contract_version:1,units:'mm',assembly_id:'box_delivery',views:['front','top'],definitions:[
   {id:'bottom',primitive:'box',material_ref:null,x_mm:600,y_mm:400,z_mm:18},
   {id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:400,z_mm:200},
   {id:'end',primitive:'box',material_ref:null,x_mm:564,y_mm:18,z_mm:200}],
   instances:[part('bottom','bottom',0,0,0),part('left','side',0,0,18),part('right','side',582,0,18),part('front','end',18,0,18),part('back','end',18,382,18)]},
  joints:[...['left','right','front','back'].map(id=>joint('bottom_'+id,'bottom','z_max',id,'z_min')),
   ...['front','back'].flatMap(id=>[joint('left_'+id,'left','x_max',id,'x_min'),joint('right_'+id,'right','x_min',id,'x_max')])],
  blank_grain:[{definition_id:'bottom',axis:'x'},{definition_id:'side',axis:'z'},{definition_id:'end',axis:'x'}]}
}

test('FORM box delivery is found after interruption and reopened from one exact revision without rewriting saved outputs',async t=>{
 let priorManifest:any
 const f=await cutPlanFixture(t,box(),async(pg,name)=>{
  if(name==='20261027162751_ai_construction_delivery_catalog.sql')priorManifest=(await pg.query("select shared.resolve_ai_catalog('bob') m")).rows[0].m
 })
 const index=(resource:string,revision=1,after:string|null=null,uid:string|null=f.user,role='authenticated')=>
  f.rpc('bob.read_construction_delivery',[f.project,f.construction.recordId,revision,resource,after],uid,role)
 const checked=checkConstruction(f.draft,f.catalog,'2026-10-27');assert.equal(checked.concept_ready,true,JSON.stringify(checked.issues))
 const manifest={...designManifest(f.project,f.solution),assembly_id:f.draft.recipe.assembly_id,engine:{name:'build123d'},
  bob_parameters:f.draft.parameters,bob_lineage:buildCadLineage(f.project,f.draft.recipe,[],new Map(),handoff.coordinates),
  annotations:{version:1,coverage:'complete'},drawing_source:{artifact_id:f.construction.recordId,revision:1},
  bob_construction:{version:1,project_id:f.project,artifact_id:f.construction.recordId,revision:1,check:checked}}
 const drawing=await f.write({...f.base,kind:'cad',data:{title:'Box drawing',description:f.constructionData.description,assumptions:'Synthetic reviewed-candidate fixture; no physical approval',
  target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,
  packet:{recipe:f.draft.recipe,manifest,files:{front:'PHN2Zy8+',top:'PHN2Zy8+'}}}})
 const cut=await f.write(f.payload)
 const counts=async()=>(await f.pg.query('select (select count(*) from bob.artifact_cad_revisions)::int drawings,(select count(*) from bob.material_cut_plan_revisions)::int cuts,(select count(*) from bob.material_requirement_revisions)::int needs')).rows[0]
 const before=await counts()
 await t.test('saved outputs and original description are discoverable, never labelled complete or fabrication ready',async()=>{
  const drawings=await index('drawings'),needs=await index('requirements'),cuts=await index('cut_plans')
  assert.equal(drawings.source_state,'current');assert.match(drawings.description,/Open box with a bottom and four sides/)
  assert.equal(drawings.index_only,true);assert.equal(drawings.fabrication_ready,false);assert.equal(drawings.complete,undefined)
  assert.deepEqual(drawings.records.map((r:any)=>[r.id,r.revision]),[[drawing.recordId,1]])
  assert.deepEqual(drawings.records[0].step_links,[]);assert.equal(drawings.records[0].source_state,'not_checked')
  assert.deepEqual(needs.records.map((r:any)=>r.id).sort(),f.needs.map(r=>r.recordId).sort())
  assert.deepEqual(cuts.records.map((r:any)=>r.id),[cut.recordId]);assert.equal(drawings.next_after,null)
  assert(!JSON.stringify(drawings).includes('PHN2Zy8+'),'no file bytes in discovery')
 })
 await f.rpc('bob.bob_fail_turn_v2',[f.project,f.user,f.claim.thread_id,f.turn,f.claim.generation],null,'service_role')
 const continuation=randomUUID(),message='Continue the saved box delivery; repair the missing work link.'
 const claim=await f.rpc('bob.bob_claim_turn',[f.project,f.user,continuation,message],null,'service_role')
 const write=(p:any)=>f.rpc('bob.bob_project_write_v17',[f.project,claim.thread_id,continuation,claim.generation,p])
 await t.test('a new turn repairs only the missing Step link, then new readers reopen exact saved content',async()=>{
  const proposal=await f.rpc('bob_private.project_plan_propose',[f.project,0,{summary:'Build the box',reason:'Fixture mandate',steps:[{step_id:null,title:'Build box',goal:'Use the saved box outputs',state:'active',phase:'planning',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[]}],task_links:[]}],f.user,'postgres')
  const plan=await f.rpc('bob_private.project_plan_decide',[f.project,0,proposal.record.revision,'approve','Fixture mandate'],f.user,'postgres')
  const step=plan.record.steps[0].id
  const missing=await index('drawings');assert.equal(missing.records[0].id,drawing.recordId)
  const payload={kind:'drawing_link',record_id:drawing.recordId,expected_revision:1,expected_updated_at:null,request_quote:message,data:{step_id:step,action:'link'}}
  const linked=await write(payload);assert.deepEqual(await write(payload),linked)
  assert.deepEqual((await index('drawings')).records[0].step_links,[{step_id:step,in_current_plan:true}])
  const reader=createRecordDetailReader((_dataset,id,revision)=>f.rpc('bob.read_cad_artifact',[f.project,id,revision]),async()=>true)
  const reopened=await reader.execute((await index('drawings')).records[0].read.arguments)
  assert.equal(reopened.status,'ok');assert.deepEqual(reopened.data.recipe,f.draft.recipe)
  assert.deepEqual(reopened.data.construction_source,{project_id:f.project,artifact_id:f.construction.recordId,revision:1})
  const materialReader=createOperationalReader(f.project,async args=>({data:await f.rpc('bob.read_project_work',[f.project,args]),error:null}),async()=>true,[])
  for(const resource of ['requirements','cut_plans'])for(const row of (await index(resource)).records){
   const back=await materialReader.execute(row.read.arguments)
   assert.equal(back.status,'ok');assert.equal(back.records[0].revision,row.read.expected_revision)
   assert.equal(back.records[0].artifact_id,f.construction.recordId);assert.equal(back.records[0].artifact_revision,1)
   if(resource==='cut_plans'){
    assert.deepEqual(back.records[0].layout,f.payload.data.layout)
    assert.equal(back.records[0].fabrication_ready,false);assert.equal(back.records[0].shopping_ready,false)
   }
  }
  assert.equal((await f.pg.query('select sum(required_quantity)::int n from bob.current_material_requirements where project_id=$1',[f.project])).rows[0].n,5)
  assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,0,'no purchase was inferred from blanks or a hypothetical layout')
  assert.deepEqual(await counts(),before,'link repair made no new geometry, list or cut-plan revisions')
 })
 await t.test('outsiders, anonymous calls, other-project sources and invalid selectors cannot disclose an output',async()=>{
  await assert.rejects(index('drawings',1,null,f.other),{code:'42501'})
  await assert.rejects(index('requirements',1,null,null,'anon'),{code:'42501'})
  await assert.rejects(f.rpc('bob.read_construction_delivery',[f.project,randomUUID(),1,'drawings',null]),{code:'PT404'})
  const another=(await f.rpc('bob.create_project',[{name:'Another permitted project'}])).id
  await assert.rejects(f.rpc('bob.read_construction_delivery',[another,f.construction.recordId,1,'drawings',null]),{code:'PT404'},'project membership cannot rebind an output from a different project')
  await assert.rejects(index('invented'),{code:'22023'})
  await assert.rejects(index('drawings',0),{code:'22023'})
  const fn=(await f.pg.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid='bob.read_construction_delivery(text,uuid,integer,text,uuid)'::regprocedure")).rows[0]
  assert.equal(fn.prosecdef,false);assert.equal(fn.anon,false);assert(fn.proconfig.includes('search_path=""'))
 })
 await t.test('a newer construction exposes the old delivery as historical, without copying it to the new source',async()=>{
  const next=structuredClone(f.constructionData);next.key='box-revision';next.description='Revised description; existing outputs still belong to version one.'
  await write({...f.base,request_quote:message,kind:'construction',record_id:f.construction.recordId,expected_revision:1,data:next})
  const old=await index('drawings');assert.equal(old.source_state,'changed');assert.equal(old.records[0].id,drawing.recordId)
  for(const resource of ['drawings','requirements','cut_plans'])assert.deepEqual((await index(resource,2)).records,[])
  assert.deepEqual((await f.read(cut.recordId,1)).layout,f.payload.data.layout)
  assert.equal((await f.read(cut.recordId,1)).source_state,'changed')
  assert.deepEqual(await counts(),before)
 })
 await t.test('pages cover every saved need once, include fasteners, and use the latest matching revision per identity',async()=>{
  const pins:{id:string;revision:number}[]=[],fields:any[]=[]
  const modes=['length_x','length_y','length_z','area_xy','area_xz','area_yz']
  for(const definition_id of ['bottom','side','end'])for(const quantity_mode of modes){
   if(pins.length>=13)continue
   const id=randomUUID(),data={name:`Fixture ${definition_id} ${quantity_mode}`,category:'Timber',area_id:null,task_id:null,waste_percent:'0',purchase_increment:'1',assumptions:'Pagination fixture; alternatives are not combined for purchasing',artifact_id:f.construction.recordId,artifact_revision:2,target_revision:1,definition_id,quantity_mode,stock_allocations:[],component_allocations:[],change_note:'Fixture alternative quantity'}
   await f.rpc('bob.material_requirement_cad_command',[f.project,'create',id,0,data]);pins.push({id,revision:1});fields.push(data)
  }
  await f.rpc('bob.material_requirement_cad_command',[f.project,'revise',pins[0].id,1,{...fields[0],change_note:'Same source, newer requirement revision'}]);pins[0].revision=2
  const glue=randomUUID(),glueData={...fields[0],name:'Shared glue package',quantity_mode:'glue',change_note:'Fixture glue'};delete glueData.definition_id
  await f.rpc('bob.material_requirement_cad_command',[f.project,'create',glue,0,glueData]);pins.push({id:glue,revision:1})
  const first=await index('requirements',2);assert.equal(first.records.length,12);assert.equal(first.truncated,true);assert.equal(first.next_after,first.records.at(-1).id)
  const last=await index('requirements',2,first.next_after);assert.equal(last.truncated,false);assert.equal(last.next_after,null)
  assert.deepEqual([...first.records,...last.records].map((r:any)=>({id:r.id,revision:r.revision})),pins.sort((a,b)=>a.id.localeCompare(b.id)))
  assert([...first.records,...last.records].some((r:any)=>r.id===glue),'fastener provenance is not omitted from the requirement index')
 })
 await t.test('the published tool contract is executable and the publication replays without another version',async()=>{
  const active=async()=>(await f.pg.query("select p.active_version_id,v.definition from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' and p.prompt_key='tools.read_construction_delivery'")).rows[0]
  const original=await active();assert.deepEqual(original.definition.parameters,CONSTRUCTION_DELIVERY_TOOL.function.parameters)
  assert.equal(original.definition.description,CONSTRUCTION_DELIVERY_TOOL.function.description)
  const current:any=(await f.pg.query("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  assert.equal(current.definitions.length,priorManifest.definitions.length+1)
  for(const old of priorManifest.definitions)if(old.prompt_key!=='bob.tools')assert.deepEqual(current.definitions.find((r:any)=>r.prompt_key===old.prompt_key),old,old.prompt_key)
  const tools=createConstructionTools({projectId:f.project,message:'Read delivery',hasAccess:async()=>true,constructionViews:true,formEvidence:true,
   read:unused,readSources:unused,readDelivery:(id,revision,resource,after)=>f.rpc('bob.read_construction_delivery',[f.project,id,revision,resource,after])})
  for(const manifest of [priorManifest,current]){
   const catalog=createAiCatalogSession({rpc:unused},{app:'bob',manifest})
   const session=createBobToolSession({constructionTools:tools,lookup:createProjectLookup(f.project,unused),aiCatalog:catalog,
    readPolicy:async()=>({phase:'design',tools:manifest.definitions.find((r:any)=>r.prompt_key==='bob.tools').definition.catalog})})
   assert.equal((await session.prepare()).some(s=>s.function.name==='read_construction_delivery'),manifest===current)
   if(manifest===current)assert.equal((await session.execute('read_construction_delivery',{artifact_id:f.construction.recordId,revision:2,resource:'requirements',after:null})).status,'ok')
  }
  await f.pg.exec(readFileSync('supabase/migrations/20261027162751_ai_construction_delivery_catalog.sql','utf8'))
  assert.deepEqual(await active(),original)
 })
})
