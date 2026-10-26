// Compact construction table (owner decision 2026-10-26): one overview read
// carries definitions, parts and joints with the server fastener schedule;
// exact detail views stay one ID away. Jobs without the pin keep the former
// overview byte for byte.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createConstructionViews,constructionTable,CONSTRUCTION_VIEW_TOKENS,CONSTRUCTION_VIEW_MAX_TOKENS,type ConstructionViewQuery} from '../supabase/functions/_shared/construction-views.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {parseFastenerSchedule,type FastenerSchedule} from '../supabase/functions/_shared/construction-fasteners.ts'
import {countSerializedTokens} from '../supabase/functions/_shared/bob-token-budget.ts'
import {projectSchema} from './support/project-schema.ts'

const project='p_table',artifact='33333333-3333-4333-8333-333333333333'
const now=()=>new Date('2026-10-26T12:00:00Z')
const fixture=JSON.parse(await readFile(new URL('./fixtures/barnrum-bunk-bed-construction.json',import.meta.url),'utf8'))
const bunkBed=():any=>({projectId:project,status:'ok',artifact_id:artifact,revision:20,current_revision:20,archived:false,source_state:'current',
 title:'Barnrum bunk bed',description:'Bunk bed for the barn room.',area_id:null,target_revision:3,
 recipe:structuredClone(fixture.recipe),parameters:{nodes:[],bindings:[],frames:[]},instance_policy:null,materials:[],joints:structuredClone(fixture.joints),
 open_questions:['Mattress size is not confirmed.']})
const query=(view='overview',extra:Partial<ConstructionViewQuery>={}):ConstructionViewQuery=>({artifact_id:artifact,revision:20,view,ids:[],after:null,result_id:null,section:null,...extra})
const end=(e:any)=>`${e.instance_id}.${e.face}`
const tools=(read:()=>unknown,extra:Record<string,unknown>={})=>createConstructionTools({projectId:project,message:'Inspect',constructionViews:true,unlimitedWork:true,now,
 hasAccess:async()=>true,read:async()=>read(),readSources:async()=>({project:new Map(),physical:new Map()}),...extra} as any)

// The real rule (bob_private.construction_fastener_schedule) on the saved bunk
// bed, shaped as bob.read_construction_fasteners returns it.
let server:Promise<{raw:any;schedule:FastenerSchedule}>|undefined
const serverSchedule=()=>server??=(async()=>{
 const pg=await projectSchema()
 try{
  const s=(await pg.query('select bob_private.construction_fastener_schedule($1::jsonb,$2::jsonb) s',[JSON.stringify(fixture.recipe),JSON.stringify(fixture.joints)])).rows[0].s as any
  const raw={status:'ok',project_id:project,artifact_id:artifact,revision:20,...s}
  return {raw,schedule:parseFastenerSchedule(raw,artifact,20)!}
 }finally{await pg.close()}
})()

// Recorded from the implementation before the table existed (2026-10-26).
const FORMER_OVERVIEW='{"projectId":"p_table","status":"ok","artifact_id":"33333333-3333-4333-8333-333333333333","revision":20,"current_revision":20,"source_state":"current","archived":false,"roles_recorded":false,"title":"Barnrum bunk bed","area_id":null,"target_revision":3,"construction_status":"draft","rendered":false,"reviewed":false,"counts":{"definitions":16,"instances":53,"nodes":0,"bindings":0,"joints":36,"materials":0,"unknown_roles":53,"roles_recorded":false,"open_questions":1},"previous_results":[],"views":["parts","parameters","bindings","joints","materials","roles","notes","dependencies"],"details_omitted":true,"next_read":{"artifact_id":"33333333-3333-4333-8333-333333333333","revision":20,"view":"notes","ids":[],"after":null,"result_id":null,"section":null},"message":"Description, questions, parts and dependencies are available in the named views. No current check is inferred from a saved draft or historical result."}'
const FORMER_OVERVIEW_WITH_RESULT='{"projectId":"p_table","status":"ok","artifact_id":"33333333-3333-4333-8333-333333333333","revision":20,"current_revision":20,"source_state":"current","archived":false,"roles_recorded":true,"title":"Barnrum bunk bed","area_id":null,"target_revision":3,"construction_status":"draft","rendered":false,"reviewed":false,"counts":{"definitions":16,"instances":53,"nodes":0,"bindings":0,"joints":36,"materials":0,"unknown_roles":1,"roles_recorded":true,"open_questions":1},"previous_results":[{"result_id":"cs_dbb4e70bf5d01d0906bb64bdb350c4bd1d4a9184945ed49564852e1025d2a91a","kind":"check","revision":20,"observed_at":"2026-10-26T12:00:00.000Z","status":"checked","concept_ready":true,"issue_count":0,"observation":"historical","read":{"artifact_id":"33333333-3333-4333-8333-333333333333","revision":20,"after":null,"view":"result","ids":[],"result_id":"cs_dbb4e70bf5d01d0906bb64bdb350c4bd1d4a9184945ed49564852e1025d2a91a","section":null}}],"views":["parts","parameters","bindings","joints","materials","roles","notes","dependencies"],"details_omitted":true,"next_read":{"artifact_id":"33333333-3333-4333-8333-333333333333","revision":20,"view":"notes","ids":[],"after":null,"result_id":null,"section":null},"message":"Description, questions, parts and dependencies are available in the named views. No current check is inferred from a saved draft or historical result."}'

test('the bunk bed table fits one pinned page: every part and joint once, exact values, server fasteners per joint',async()=>{
 const {schedule}=await serverSchedule(),draft=bunkBed()
 const page=await createConstructionViews(project,now).read(draft,query(),CONSTRUCTION_VIEW_MAX_TOKENS,{table:true,fasteners:schedule})
 assert.equal(page.status,'ok')
 assert(countSerializedTokens(page)<=CONSTRUCTION_VIEW_MAX_TOKENS,`page was ${countSerializedTokens(page)} tokens`)
 assert.equal(page.coverage.complete,true);assert.equal(page.coverage.scope,'overview_table')
 assert.deepEqual(page.next_read,{...query(),view:'notes'},'the last table page still leads to the notes')
 // The former header fields stay.
 assert.equal(page.counts.instances,53);assert.equal(page.counts.joints,36);assert.deepEqual(page.previous_results,[])
 assert(page.views.includes('joints'));assert.equal(page.details_omitted,true);assert.match(page.message,/No current check is inferred/)
 const t=page.table
 assert.deepEqual(t,constructionTable(draft,schedule))
 assert.deepEqual(t.definitions.rows,draft.recipe.definitions.map((d:any)=>[d.id,d.primitive,[d.x_mm,d.y_mm,d.z_mm],d.material_ref]))
 assert.deepEqual(t.definitions.size_mm,{box:['x_mm','y_mm','z_mm']})
 assert.deepEqual(t.parts.rows.map((r:any)=>r[0]),draft.recipe.instances.map((i:any)=>i.id))
 assert.equal(new Set(t.parts.rows.map((r:any)=>r[0])).size,53)
 assert.deepEqual(t.parts.rows,draft.recipe.instances.map((i:any)=>[i.id,i.definition_id,'unknown']),'no saved policy: every role stays unknown')
 assert.equal(new Set(t.joints.rows.map((r:any)=>r[0])).size,36)
 assert.equal(schedule.joints.length,36)
 for(const [n,j] of draft.joints.entries()){
  const f=schedule.joints.find(x=>x.joint_id===j.id)!
  assert.deepEqual(t.joints.rows[n],[j.id,j.method,end(j.first),end(j.second),[f.source,f.kind,f.diameter_mm,f.length_mm,f.count,f.gaps]],j.id)
 }
 assert(t.joints.rows.some((r:any)=>r[4][1]==='screw'&&r[4][4]>=1),'the rule proposes screws for this bed')
 assert(t.joints.rows.some((r:any)=>r[4][5].includes('narrow_contact')),'rule gaps stay visible next to the proposal')
 assert.deepEqual(t.fasteners,{complete:schedule.complete,totals:{columns:['kind','diameter_mm','length_mm','count','joint_ids'],
  rows:schedule.totals.map(x=>[x.kind,x.diameter_mm,x.length_mm,x.count,x.joint_ids])},glue_packages:schedule.glue_packages,basis:'rule_of_thumb_proposal'})
 assert.equal(t.open_questions,1)
 assert(JSON.stringify(t).length<JSON.stringify({recipe:fixture.recipe,joints:fixture.joints}).length,'smaller than the raw recipe and joints it indexes')
})

test('roles come only from the saved policy: missing or unclassified roles stay unknown',async()=>{
 const draft=bunkBed(),[a,b,c]=draft.recipe.instances.map((i:any)=>i.id)
 draft.instance_policy={version:1,instances:[{instance_id:a,role:'build_part',quantity_policy:'manufacture',reason:'New part'},
  {instance_id:b,role:'unknown',quantity_policy:'unknown',reason:'Not decided'},{instance_id:c,role:'guessed',quantity_policy:'manufacture',reason:'Invalid'}]}
 const roles=constructionTable(draft).parts.rows.map((r:any)=>r[2])
 assert.equal(roles[0],'build_part');assert(roles.slice(1).every((r:string)=>r==='unknown'))
})

test('without a readable schedule the table says so and shows no fastener',async()=>{
 const draft=bunkBed()
 for(const t of [constructionTable(draft),constructionTable(draft,null),
  (await createConstructionViews(project,now).read(draft,query(),CONSTRUCTION_VIEW_MAX_TOKENS,{table:true,fasteners:null})).table]){
  assert.deepEqual(t.fasteners,{status:'unavailable'});assert.equal(t.joints.rows.length,36);assert(t.joints.rows.every((r:any)=>r[4]===null))
 }
 // A joint without a schedule row has no fastener; the others keep theirs.
 const {schedule}=await serverSchedule(),missing={...schedule,joints:schedule.joints.slice(1)}
 const rows=constructionTable(draft,missing).joints.rows
 assert.equal(rows[draft.joints.findIndex((j:any)=>j.id===schedule.joints[0].joint_id)][4],null)
 assert.equal(rows.filter((r:any)=>r[4]!==null).length,35)
})

/** A synthetic construction far beyond one page, with a cylinder definition. */
function large(){
 const definitions=[{id:'post',primitive:'box',material_ref:null,x_mm:45,y_mm:45,z_mm:2000},{id:'rail',primitive:'box',material_ref:'pine',x_mm:900,y_mm:45,z_mm:95},
  {id:'dowel',primitive:'cylinder',material_ref:null,diameter_mm:8,length_mm:40}]
 const instances=Array.from({length:400},(_,n)=>({id:`part_${n}`,definition_id:definitions[n%3].id,placement:{x:n*100,y:0,z:0,rx:0,ry:0,rz:0}}))
 const joints=Array.from({length:300},(_,n)=>({id:`joint_${n}_between_neighbouring_posts`,method:n%10?'screwed_butt':'glued_butt',first:{instance_id:`part_${n}`,face:'x_max'},second:{instance_id:`part_${n+1}`,face:'x_min'},reason:'Synthetic'}))
 const draft:any={...bunkBed(),revision:7,current_revision:7,recipe:{definitions,instances},joints,
  instance_policy:{version:1,instances:instances.filter((_,n)=>n%2).map(i=>({instance_id:i.id,role:'build_part',quantity_policy:'manufacture',reason:'New'}))}}
 const rows=joints.map(j=>j.method==='glued_butt'?{joint_id:j.id,method:j.method,source:'rule',kind:'glue',diameter_mm:null,length_mm:null,count:null,gaps:[]}
  :{joint_id:j.id,method:j.method,source:'rule',kind:'screw',diameter_mm:5,length_mm:120,count:2,gaps:[]})
 const screwed=rows.filter(r=>r.kind==='screw')
 const raw={status:'ok',project_id:project,artifact_id:artifact,revision:7,rule_version:'fastener-rules-v1',complete:true,glue_packages:1,joints:rows,
  totals:[{kind:'screw',diameter_mm:5,length_mm:120,count:screwed.length*2,joint_ids:screwed.map(r=>r.joint_id)}]}
 return {draft,raw,schedule:parseFastenerSchedule(raw,artifact,7)!}
}
async function readTable(read:(q:ConstructionViewQuery)=>Promise<any>,budget:number){
 const rows:Record<string,unknown[]>={definitions:[],parts:[],joints:[],totals:[]},open=new Map<string,string>()
 let q:ConstructionViewQuery|null=query('overview',{revision:7}),pages=0,fragments=0,page:any
 do{
  page=await read(q!);assert.equal(page.status,'ok',JSON.stringify(page).slice(0,300))
  assert(countSerializedTokens(page)<=budget,`page was ${countSerializedTokens(page)} tokens`)
  assert.equal(page.counts.instances,400,'every page keeps the overview header')
  for(const k of ['definitions','parts','joints'])rows[k].push(...(page.table[k]?.rows??[]))
  rows.totals.push(...(page.table.fasteners.totals?.rows??[]))
  for(const f of page.table.fragments??[]){fragments++
   const key=f.collection+'/'+f.id,text=open.get(key)??''
   assert.equal(f.fragment.offset,Array.from(text).length,'fragments continue at their exact offset')
   if(!f.fragment.complete){open.set(key,text+f.fragment.text);continue}
   open.delete(key);rows[f.collection==='fastener_totals'?'totals':f.collection].push(JSON.parse(text+f.fragment.text))
  }
  if(++pages>200)throw Error('Non-advancing cursor')
  q=page.coverage.end_of_selection?null:page.next_read
 }while(q)
 assert.equal(open.size,0);assert.equal(page.next_read.view,'notes');assert.equal(page.next_read.after,null)
 return {rows,pages,fragments}
}

test('a large construction pages with next_read; all pages give every row once; the cursor binds revision, view and schedule',async()=>{
 const {draft,schedule}=large(),views=createConstructionViews(project,now),option={table:true as const,fasteners:schedule}
 const full=constructionTable(draft,schedule)
 assert.deepEqual(full.definitions.size_mm,{box:['x_mm','y_mm','z_mm'],cylinder:['diameter_mm','length_mm']})
 assert.deepEqual(full.definitions.rows[2],['dowel','cylinder',[8,40],null])
 const expected={definitions:full.definitions.rows,parts:full.parts.rows,joints:full.joints.rows,totals:full.fasteners.totals.rows}
 const pinned=await readTable(q=>views.read(draft,q,CONSTRUCTION_VIEW_MAX_TOKENS,option),CONSTRUCTION_VIEW_MAX_TOKENS)
 const small=await readTable(q=>views.read(draft,q,undefined,option),CONSTRUCTION_VIEW_TOKENS)
 assert.deepEqual(pinned.rows,expected);assert.deepEqual(small.rows,expected)
 assert(small.fragments>1,'the long fastener total is split into exact JSON fragments at 2,000 tokens')
 assert.equal(expected.parts.length,400);assert.equal(expected.joints.length,300)
 assert(pinned.pages>1&&pinned.pages<small.pages,`${pinned.pages} pages at 6,000 vs ${small.pages} at 2,000`)

 const first=await views.read(draft,query('overview',{revision:7}),CONSTRUCTION_VIEW_MAX_TOKENS,option)
 assert.equal(first.coverage.complete,false);assert.match(first.next_read.after,/^cv1:[a-f0-9]{24}:\d+:0$/)
 assert(!('joints'in first.table)||first.table.joints.rows.length<300,'an absent or partial section is never shown as complete')
 await assert.rejects(views.read({...draft,revision:8},{...first.next_read,revision:8},CONSTRUCTION_VIEW_MAX_TOKENS,option),/cursor_invalid/)
 await assert.rejects(views.read(draft,{...first.next_read,view:'parts'},CONSTRUCTION_VIEW_MAX_TOKENS),/cursor_invalid/)
 await assert.rejects(views.read(draft,first.next_read,CONSTRUCTION_VIEW_MAX_TOKENS,{table:true,fasteners:null}),/cursor_invalid/)
 assert.equal((await views.read(draft,first.next_read,CONSTRUCTION_VIEW_MAX_TOKENS)).status,'invalid','without the table the overview takes no cursor')
 assert.equal((await views.read(draft,query('overview',{revision:7,ids:['part_1']}),CONSTRUCTION_VIEW_MAX_TOKENS,option)).status,'invalid')

 // The pinned read tool continues the same cursor and re-reads the schedule for each page.
 let reads=0
 const tool=tools(()=>draft,{constructionTable:true,viewPageTokens:()=>CONSTRUCTION_VIEW_MAX_TOKENS,readFasteners:async()=>{reads++;return large().raw}})
 const viaTool=await readTable(q=>tool.execute('read_construction_draft',q),CONSTRUCTION_VIEW_MAX_TOKENS)
 assert.deepEqual(viaTool.rows,expected);assert.equal(reads,viaTool.pages)
 const stale=await tools(()=>({...draft,revision:8,current_revision:8}),{constructionTable:true,readFasteners:async()=>({...large().raw,revision:8})})
  .execute('read_construction_draft',{...first.next_read,revision:8})
 assert.equal(stale.status,'invalid');assert.match(stale.message,/exact revision, view and selection/)
})

test('without the table option the overview is byte-identical to the former output',async()=>{
 const draft=bunkBed(),views=createConstructionViews(project,now)
 assert.equal(JSON.stringify(await views.read(draft,query())),FORMER_OVERVIEW)
 assert.equal(JSON.stringify(await views.read(draft,query(),CONSTRUCTION_VIEW_MAX_TOKENS)),FORMER_OVERVIEW)
 await views.observe('check',artifact,20,{status:'checked',checked:{concept_ready:true,issue_count:0,part_count:53}})
 const roles={...draft,instance_policy:{version:1,instances:[{instance_id:'right_gable',role:'build_part',quantity_policy:'manufacture',reason:'New'},{instance_id:'left_gable',role:'unknown',quantity_policy:'unknown',reason:'Not decided'}]}}
 assert.equal(JSON.stringify(await views.read(roles,query('overview',{revision:null}),CONSTRUCTION_VIEW_MAX_TOKENS)),FORMER_OVERVIEW_WITH_RESULT)
 const {raw}=await serverSchedule()
 for(const extra of [{},{constructionTable:false}]){
  let reads=0
  const tool=tools(()=>draft,{...extra,viewPageTokens:()=>CONSTRUCTION_VIEW_MAX_TOKENS,readFasteners:async()=>{reads++;return raw}})
  assert.equal(JSON.stringify(await tool.execute('read_construction_draft',query())),FORMER_OVERVIEW)
  assert.equal((await tool.execute('read_construction_draft',query('overview',{after:'cv1:'+'0'.repeat(24)+':1:0'}))).status,'invalid')
  assert.equal(reads,0,'jobs without the pin never read the schedule for an overview')
 }
})

test('the pinned read tool reads the schedule once for the exact revision; a failed read leaves fasteners unavailable',async()=>{
 const {raw,schedule}=await serverSchedule(),draft=bunkBed()
 const make=(extra:Record<string,unknown>)=>tools(()=>draft,{constructionTable:true,viewPageTokens:()=>CONSTRUCTION_VIEW_MAX_TOKENS,...extra})
 const calls:unknown[][]=[]
 const page=await make({readFasteners:async(id:string,revision:number)=>{calls.push([id,revision]);return raw}}).execute('read_construction_draft',query('overview',{revision:null}))
 assert.deepEqual(calls,[[artifact,20]],'the current read resolves to the exact saved revision')
 assert.equal(page.status,'ok');assert.deepEqual(page.table,constructionTable(draft,schedule))
 for(const readFasteners of [undefined,async()=>{throw new Error('rpc_down')},async()=>null,async()=>({...raw,revision:19}),async()=>({status:'not_found'})]){
  const r=await make(readFasteners?{readFasteners}:{}).execute('read_construction_draft',query())
  assert.equal(r.status,'ok');assert.deepEqual(r.table.fasteners,{status:'unavailable'});assert(r.table.joints.rows.every((x:any)=>x[4]===null))
 }
 calls.length=0
 const detail=make({readFasteners:async(...a:unknown[])=>{calls.push(a);return raw}})
 assert.equal((await detail.execute('read_construction_draft',query('joints'))).status,'ok')
 assert.equal(calls.length,0,'detail views do not read the schedule')
 let allowed=true
 const revoked=tools(()=>draft,{constructionTable:true,hasAccess:async()=>allowed,readFasteners:async()=>{allowed=false;return raw}})
 assert.equal((await revoked.execute('read_construction_draft',query())).status,'denied')
})
