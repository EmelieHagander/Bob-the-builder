import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createConstructionViews,CONSTRUCTION_VIEW_TOKENS,CONSTRUCTION_VIEW_TOOL,type ConstructionViewQuery} from '../supabase/functions/_shared/construction-views.ts'
import {createConstructionTools,checkedConstructionForDrawing} from '../supabase/functions/_shared/construction-draft.ts'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {countSerializedTokens} from '../supabase/functions/_shared/bob-token-budget.ts'
import {createBobTurnCheckpoint} from '../supabase/functions/_shared/bob-turn-checkpoint.ts'
import {createBobJournal,stableJsonValue} from '../supabase/functions/_shared/bob-job-journal.ts'
import {projectSchema} from './support/project-schema.ts'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import {catalogFixture,preConstructionViewsCatalogFixture} from './support/ai-catalog-fixture.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'

const project='p_views',artifact='11111111-1111-4111-8111-111111111111',material='22222222-2222-4222-8222-222222222222'
const now=()=>new Date('2026-10-19T16:00:00Z')
function fixture(count=3){
 const recipe:any={contract_version:1,units:'mm',assembly_id:'assembly',views:['front'],
  definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:18,y_mm:300,z_mm:800}],
  instances:Array.from({length:count},(_,n)=>({id:'part'+n,definition_id:'panel',placement:{x:n*1000,y:0,z:0,rx:0,ry:0,rz:0}}))}
 const plan=parameterPlan(recipe)
 const draft:any={projectId:project,status:'ok',artifact_id:artifact,revision:1,current_revision:1,archived:false,source_state:'current',title:'Synthetic frame',description:'Keep manufacturer evidence unresolved.',area_id:null,target_revision:1,
  recipe,parameters:compileCadParameters(project,recipe,plan,new Map(),new Map()),
  instance_policy:{version:1,instances:recipe.instances.map((i:any)=>({instance_id:i.id,role:'build_part',quantity_policy:'manufacture',reason:'Explicit synthetic manufactured part'}))},
  materials:[{definition_id:'panel',material_id:material,material_revision:1,part_id:null,part_revision:null}],
  joints:[],open_questions:['Hardware and strength remain unverified.']}
 const record={id:material,revision:1,current_revision:1,kind:'material',profile_code:'sheet_stock',categories:['wood.plywood','sheet'],source_kind:'design_choice',properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null}}}
 return {draft,record,catalog:new Map([[material+'@1',record]])}
}
const query=(view='overview',extra:Partial<ConstructionViewQuery>={}):ConstructionViewQuery=>({artifact_id:artifact,revision:1,view,ids:[],after:null,result_id:null,section:null,...extra})
const bounded=(value:any)=>assert(countSerializedTokens(value)<=CONSTRUCTION_VIEW_TOKENS,`page was ${countSerializedTokens(value)} tokens`)
async function collect(read:(q:ConstructionViewQuery)=>Promise<any>,q:ConstructionViewQuery){
 const rows:any[]=[];let calls=0
 do{const page=await read(q);assert.equal(page.status,'ok',JSON.stringify(page));bounded(page);rows.push(...page.items);q=page.next_read;if(++calls>1000)throw Error('Non-advancing cursor')}while(q)
 return rows
}

test('large canonical draft becomes a small overview and exact late-selected facts, not a text dump',async()=>{
 const {draft}=fixture(150)
 for(const n of draft.parameters.nodes)n.reason='Synthetic unchanged explanation '.repeat(30)
 draft.parameters.nodes.push({id:'late_source',role:'source',source:{kind:'project_measurement',id:material,revision:7},normalized:{value:9137,unit:'mm'},sources:[{id:material,revision:7,value:'9137',truth:'measured',unit:'mm'}]})
 assert(JSON.stringify(draft).length>600000)
 const tools=createConstructionTools({projectId:project,message:'Inspect',constructionViews:true,unlimitedWork:true,now,hasAccess:async()=>true,read:async()=>draft,
  readSources:async()=>({project:new Map(),physical:new Map()})})
 const read=(q:ConstructionViewQuery)=>tools.execute('read_construction_draft',q)
 const overview=await read(query());bounded(overview)
 assert.equal(overview.counts.instances,150);assert.equal(overview.counts.open_questions,1);assert.equal(overview.details_omitted,true)
 assert(!('recipe'in overview));assert(!('parameters'in overview));assert.equal(overview.next_read.view,'notes')
 const parts=await collect(read,query('parts',{ids:['part149']}))
 assert.deepEqual(parts.find(r=>r.collection==='instances').value,draft.recipe.instances[149])
 assert.equal(parts.find(r=>r.collection==='definitions').value.x_mm,18)
 const source=await collect(read,query('parameters',{ids:['late_source']}))
 assert.deepEqual(source[0].value,draft.parameters.nodes.at(-1));assert.equal(source[0].value.sources[0].truth,'measured')
 draft.instance_policy=null
 const unknown=await read(query());assert.equal(unknown.counts.unknown_roles,150);assert.equal(unknown.roles_recorded,false)
})

test('dependency view retains transitive formulas, source pins, affected bindings and adjacent physical records',async()=>{
 const {draft}=fixture()
 draft.parameters.nodes=[{id:'source',role:'source',source:{kind:'project_measurement',id:material,revision:4},normalized:{value:600,unit:'mm'},sources:[{value:'600',truth:'measured'}]},
  {id:'half',role:'derived',operation:'divide_v1',operands:['source','two']},{id:'two',role:'decision',value:2,unit:'scalar',reason:'two'},
  {id:'downstream',role:'derived',operation:'add_v1',operands:['half','unknown']},{id:'unknown',role:'unknown',unit:'mm',reason:'Must measure on site'}]
 draft.parameters.bindings=[{path:'definitions/panel/y_mm',node:'half'},{path:'instances/part2/placement/x',node:'downstream'}]
 draft.joints=[{id:'joint',first:{instance_id:'part0',face:'x_min'},second:{instance_id:'part2',face:'x_max'},method:'unresolved',reason:'No verified joint choice'}]
 const views=createConstructionViews(project,now),rows=await collect(q=>views.read(draft,q),query('dependencies',{ids:['half']}))
 for(const node of draft.parameters.nodes)assert.deepEqual(rows.find(r=>r.collection==='nodes'&&r.id===node.id)?.value,node)
 for(const binding of draft.parameters.bindings)assert.deepEqual(rows.find(r=>r.collection==='bindings'&&r.id===binding.path)?.value,binding)
 assert.deepEqual(rows.find(r=>r.collection==='joints').value,draft.joints[0]);assert(rows.some(r=>r.collection==='roles'));assert(rows.some(r=>r.collection==='materials'))
 const missing=await views.read(draft,query('parts',{ids:['absent']}));assert.deepEqual(missing.missing_ids,['absent']);assert.equal(missing.coverage.total_items,0)
})

test('all pages retain late records and oversized Unicode notes exactly; cursors reject different selections or versions',async()=>{
 const {draft}=fixture(40),views=createConstructionViews(project,now)
 const rows=await collect(q=>views.read(draft,q),query('bindings'))
 assert.deepEqual(rows.map(r=>r.value),draft.parameters.bindings)
 draft.description='Åäö 🪵 — '.repeat(1800)+'LAST: verify load-bearing attachment.'
 const noteRows=await collect(q=>views.read(draft,q),query('notes'))
 const fragments=noteRows.filter(r=>r.collection==='description')
 assert(fragments.length>1);assert(fragments.every(r=>r.fragment.encoding==='json'))
 const text=fragments.map(r=>r.fragment.text).join('')
 assert.equal(JSON.parse(text),draft.description)
 assert.deepEqual(noteRows.find(r=>r.collection==='open_questions').value,draft.open_questions[0])
 const first=await views.read(draft,query('bindings'));assert(first.next_read)
 let last=first
 while(last.next_read)last=await views.read(draft,last.next_read)
 assert.equal(last.coverage.end_of_selection,true);assert.equal(last.coverage.complete,false,'the last page alone does not claim that earlier records were read')
 await assert.rejects(views.read(draft,{...first.next_read,view:'parameters'}),/cursor_invalid/)
 await assert.rejects(views.read({...draft,revision:2},{...first.next_read,revision:2}),/cursor_invalid/)
 await assert.rejects(views.read(draft,{...first.next_read,after:first.next_read.after.replace(/:\d+:\d+$/,':999999:0')}),/cursor_invalid/)
})

test('all checker findings remain accessible beyond the historical 200-row truncation',async()=>{
 const {draft,catalog}=fixture(24);draft.recipe.instances.forEach((i:any)=>i.placement.x=0)
 const old=checkConstruction(draft,catalog,'2026-10-19'),full=checkConstruction(draft,catalog,'2026-10-19',true)
 assert(full.issue_count>200);assert.equal(old.issues.length,200);assert.equal(full.issues.length,full.issue_count)
 const views=createConstructionViews(project,now),summary=await views.observe('check',artifact,1,full);bounded(summary)
 assert.equal(summary.concept_ready,false);assert.equal(summary.issue_count,full.issue_count)
 const rows=await collect(q=>views.read(draft,q),{...summary.result.read,section:'issues'})
 assert.deepEqual(rows.map(r=>r.value),full.issues);assert.deepEqual(rows.at(-1).value,full.issues.at(-1))
 const again=await views.observe('check',artifact,1,full)
 assert.equal(again.result.result_id,summary.result.result_id);assert.equal(views.exportState().length,1,'identical observations do not duplicate large stored results')
})

test('checkpoint roundtrip reopens exact check/list results after source drift without reading catalog or checking again',async()=>{
 const {draft,record}=fixture(1);let allowed=true,source='current',catalogReads=0,reads=0
 const options={projectId:project,message:'Inspect',constructionViews:true,unlimitedWork:true,now,hasAccess:async()=>allowed,
  read:async()=>{reads++;return {...structuredClone(draft),source_state:source}},readCurrent:async()=>({...draft,source_state:source}),
  readCatalog:async()=>{catalogReads++;return {projectId:project,status:'ok',record}},readSources:async()=>({project:new Map(),physical:new Map()})}
 const tools=createConstructionTools(options)
 const checked=await tools.execute('check_construction_draft',{artifact_id:artifact,revision:1});assert.equal(checked.status,'checked');bounded(checked)
 const lists=await tools.execute('derive_construction_lists',{artifact_id:artifact,revision:1,assembly_dependencies:[]});assert.equal(lists.status,'derived');bounded(lists)
 let saved:any=null
 const binding={jobId:'job',turnId:'turn',catalogManifestId:'views-catalog'}
 const checkpoint=createBobTurnCheckpoint({...binding,checkpoint:null,journal:createBobJournal({entries:[],save:async()=>{}},Infinity),
  save:async write=>(saved=stableJsonValue({...binding,version:1,revision:write.expectedRevision+1,state:write.state,journalState:write.journalState}))})
 await checkpoint.commit({components:{constructionTools:tools.exportState()}})
 const resumed=createConstructionTools(options);resumed.restoreState(JSON.parse(JSON.stringify(saved.state.components.constructionTools)))
 const calls=catalogReads;source='changed'
 const result=await resumed.execute('read_construction_draft',{...checked.result.read,section:'metadata'})
 assert.equal(result.status,'ok');assert.equal(result.observation,'historical');assert.equal(result.source_state,'changed');assert.equal(catalogReads,calls)
 const bom=await collect(q=>resumed.execute('read_construction_draft',q),{...lists.result.read,section:'bom'})
 assert.equal(bom[0].value.quantity,1);assert.equal(bom[0].value.blank_mm.x,18)
 assert.equal((await resumed.execute('check_construction_draft',{artifact_id:artifact,revision:1})).status,'conflict')
 const overview=await resumed.execute('read_construction_draft',query());assert.equal(overview.previous_results.length,2);assert.equal(overview.source_state,'changed')
 const noAccessReads=reads;allowed=false
 assert.equal((await resumed.execute('read_construction_draft',checked.result.read)).status,'denied');assert.equal(reads,noAccessReads)
 allowed=true
 const revoked=createConstructionTools({...options,read:async()=>{allowed=false;return draft}})
 revoked.restoreState(tools.exportState());assert.equal((await revoked.execute('read_construction_draft',checked.result.read)).status,'denied');allowed=true
 const before=resumed.exportState(),bad=structuredClone(before) as any;bad.observations[0].projectId='other'
 assert.throws(()=>resumed.restoreState(bad),/checkpoint_invalid/);assert.deepEqual(resumed.exportState(),before)
 assert.throws(()=>createConstructionTools({...options,constructionViews:false}).restoreState(before),/checkpoint_invalid/)
 const mismatch=await resumed.execute('read_construction_draft',{...checked.result.read,revision:2});assert.equal(mismatch.status,'unavailable')
})

test('drawing gate still checks canonical geometry and live sources rather than trusting an observed result',async()=>{
 const {draft,record}=fixture(1);let calls=0
 const options={projectId:project,message:'Draw',constructionViews:true,now,hasAccess:async()=>true,read:async()=>draft,
  readCatalog:async()=>{calls++;return {projectId:project,status:'ok',record}},readSources:async()=>({project:new Map(),physical:new Map()})}
 const checked=await checkedConstructionForDrawing(options,artifact,1)
 assert.equal(checked.status,'ready');assert.deepEqual(checked.draft.recipe,draft.recipe);assert(Array.isArray(checked.checked.issues));assert(!('result'in checked.checked));assert.equal(calls,1)
 draft.source_state='changed';assert.equal((await checkedConstructionForDrawing(options,artifact,1)).status,'conflict')
})

test('cut assessment summary retains exact candidate inputs and placements in its reference, without a saved-stock claim',async()=>{
 const {draft,record}=fixture(1)
 const tools=createConstructionTools({projectId:project,message:'Inspect',constructionViews:true,unlimitedWork:true,now,hasAccess:async()=>true,read:async()=>draft,
  readCatalog:async()=>({projectId:project,status:'ok',record}),readSources:async()=>({project:new Map(),physical:new Map()})})
 const candidates=[{id:'sheet',material_id:material,material_revision:1,length_mm:1200,width_mm:800,thickness_mm:18,count:1,kerf_mm:3,trim_mm:0,grain:'none',basis:'design_choice',note:'Synthetic format, not stock'}]
 const summary=await tools.execute('check_construction_cut_fit',{artifact_id:artifact,revision:1,candidates,blank_grain:[{definition_id:'panel',axis:'none'}]})
 assert.equal(summary.status,'feasible');assert.equal(summary.result.kind,'cut_fit');assert.equal(summary.fabrication_ready,false);bounded(summary)
 const inputs=await collect(q=>tools.execute('read_construction_draft',q),{...summary.result.read,section:'candidate_inputs'});assert.deepEqual(inputs.map(r=>r.value),candidates)
 const placements=await collect(q=>tools.execute('read_construction_draft',q),{...summary.result.read,section:'placements'});assert.equal(placements[0].value.instance_id,'part0')
 const metadata=await collect(q=>tools.execute('read_construction_draft',q),{...summary.result.read,section:'metadata'})
 assert.equal(metadata[0].value.saved,false);assert.equal(metadata[0].value.stock_reserved,false);assert.equal(metadata[0].value.shopping_ready,false)
})

test('active-operation replay uses the recorded observation clock and unchanged model-visible result',async()=>{
 const {draft,record}=fixture(1),entries:any[]=[];let clock='2026-10-19T16:00:00Z',clockReads=0
 const run=async()=>{
  const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity)
  const tools=createConstructionTools({projectId:project,message:'Inspect',constructionViews:true,hasAccess:async()=>true,read:async()=>draft,
   readCatalog:async()=>({projectId:project,status:'ok',record}),readSources:async()=>({project:new Map(),physical:new Map()}),
   observationTime:input=>journal.run('construction:observation',input,async()=>{clockReads++;return clock})})
  return tools.execute('check_construction_draft',{artifact_id:artifact,revision:1})
 }
 const first=await run();clock='2026-10-20T16:00:00Z'
 assert.deepEqual(await run(),first);assert.equal(clockReads,1)
})

test('result cursors retain exact order after JSONB-style object-key reordering',async()=>{
 const {draft}=fixture(1),views=createConstructionViews(project,now)
 const output={status:'checked',checked:{issues:Array.from({length:60},(_,i)=>({code:'issue',ids:['part'+i],message:'Exact constraint '+i})),limits:['Preserve original constraints']},other:{empty:[]},retrievedAt:'first'}
 const result=await views.observe('check',artifact,1,output)
 const first=await views.read(draft,result.result.read);assert(first.next_read)
 const reverse=(value:any):any=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverse(v)])):value
 const resumed=createConstructionViews(project,now);resumed.restoreState(reverse(views.exportState()))
 assert.deepEqual(await resumed.read(draft,first.next_read),await views.read(draft,first.next_read))
 const changed=await views.observe('check',artifact,1,{...output,retrievedAt:'second'})
 assert.notEqual(changed.result.result_id,result.result.result_id,'result identities retain all fields rather than journal fingerprint exceptions')
 const empty=await collect(q=>resumed.read(draft,q),{...result.result.read,section:'other.empty'})
 assert.deepEqual(empty[0].value,[])
})

test('published view contract matches migrated catalog and old pinned manifests keep their original read schema',async()=>{
 const pg=await projectSchema()
 try{
  const manifest=(await pg.query<{manifest:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob') manifest")).rows[0].manifest
  const catalog=createAiCatalogSession({rpc:async()=>{throw Error('Pinned')}},{app:'bob',manifest})
  for(const key of ['tools.read_construction_draft','tools.check_construction_draft','tools.derive_construction_lists','tools.check_construction_cut_fit','bob.workflows']){
   assert.deepEqual(catalog.definition(key).definition,catalogFixture().definition(key).definition,key)
   assert.deepEqual(catalog.definition(key).metadata,catalogFixture().definition(key).metadata,key)
  }
  assert.deepEqual(catalog.tool('read_construction_draft').function.parameters,CONSTRUCTION_VIEW_TOOL.function.parameters)
  assert(!('view'in preConstructionViewsCatalogFixture().tool('read_construction_draft').function.parameters.properties))
  assert.equal(catalog.definition('tools.read_construction_draft').metadata.construction_view_version,1)
 }finally{await pg.close()}
})
