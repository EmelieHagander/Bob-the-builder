import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SERVER_REVISIONS,JOB_OWNED_FIELDS,createRevisionMemory,fillServerRevisions,stripServerRevisions,withoutServerRevisions} from '../supabase/functions/_shared/server-revisions.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

// Owner decision 2026-11-07: "Konrad får inte bestämma vilken version … dom
// ska alltid få senaste versionen." Bed, 09:01-09:08: Konrad sent the
// construction's revision (20) where the target was 15, four times; since
// 2026-10-25 Mattias' requirement writes were refused 18 times for sending
// identity and revision fields the job owns.
const fixture=catalogFixture()
const spec=(name:string)=>({type:'function' as const,function:{name,description:name,parameters:structuredClone((fixture.definition('tools.'+name,'tool_contract').definition as any).parameters)}})
const walk=(schema:any,path:string[]):boolean=>{
 if(!schema||typeof schema!=='object')return false
 if(['anyOf','oneOf','allOf'].some(k=>Array.isArray(schema[k])&&schema[k].some((s:any)=>walk(s,path))))return true
 const [head,...rest]=path
 if(head==='*')return walk(schema.items,rest)
 if(!schema.properties||!(head in schema.properties))return false
 return !rest.length||walk(schema.properties[head],rest)
}

test('every rule names a field the published schema has, and the model sees none of them',()=>{
 for(const [name,rules] of Object.entries(SERVER_REVISIONS)){
  for(const r of rules)assert(walk(spec(name).function.parameters,r.path),name+': '+r.path.join('.'))
  const shown=withoutServerRevisions(spec(name)).function.parameters
  for(const r of rules)assert(!walk(shown,r.path),'still shown '+name+': '+r.path.join('.'))
 }
 // Nothing outside the rules still asks a model for a revision to write,
 // except reads that choose what to read and the named remainder.
 const reads=new Set(['check_construction_cut_fit','read_material_catalog','read_project_record_section','read_cad_artifact','read_cad_shell','read_construction_draft','read_construction_changes','read_construction_delivery',
  'check_construction_draft','derive_construction_lists','read_source_findings','read_task_sources','search_material_catalog'])
 const remainder=new Set(['edit_project_room_layout','continue_construction_change','transition_legacy_drawing','compose_cad_shell','link_cad_shell_steps','link_drawing_gap','link_project_drawing',
  'derive_cad_material_requirement','manage_project_material','design_project_cad','plan_cad_pieces','save_construction_cut_plan'])
 const still:string[]=[]
 for(const row of fixture.manifest().definitions){
  if(row.definition_kind!=='tool_contract'||!row.prompt_key.startsWith('tools.'))continue
  const name=row.prompt_key.slice(6);if(reads.has(name)||remainder.has(name))continue
  const text=JSON.stringify(withoutServerRevisions(spec(name)).function.parameters)
  if(/"[a-z_]*revision"\s*:/.test(text.replace(/"(recipe|parameter_plan|instance_policy|design_intent|form_refinement)?\.?version"/g,'')))still.push(name)
 }
 assert.deepEqual(still,[],'tools still asking for a revision')
})

test('the server fills each revision from its reader, the model read, or creation; a value the model sent is dropped',async()=>{
 const memory=createRevisionMemory(),reads:string[]=[]
 const readers={catalog:async(id:string)=>{reads.push('catalog:'+id);return id==='m1'?7:id==='p1'?3:null},measurement:async(id:string)=>{reads.push('m:'+id);return 5},
  spaceMeasurement:async(id:string)=>{reads.push('s:'+id);return 9},construction:async(id:string)=>{reads.push('c:'+id);return 21},plan:async()=>12,target:async(area:string|null)=>area==='kitchen'?4:15}
 const save={record_id:'c1',expected_revision:20,materials:[{definition_id:'side',material_id:'m1',material_revision:1,part_id:null,part_revision:2},{definition_id:'top',material_id:'m1',material_revision:1,part_id:'p1',part_revision:1}],
  joints:[{id:'j',fasteners:[{material_id:'m1',material_revision:99}]}],
  parameter_plan:{nodes:[{id:'w',role:'source',source:{kind:'project_measurement',id:'meas',revision:1}},{id:'h',role:'source',source:{kind:'space_measurement',id:'space',space_revision:1}},{id:'d',role:'decision',value:3}]}}
 const filled=await fillServerRevisions('save_construction_draft',stripServerRevisions('save_construction_draft',save,SERVER_REVISIONS,{}),memory,readers)
 assert('args' in filled);const a=filled.args as any
 assert.equal(a.expected_revision,21,'the construction head, not the 20 the model sent')
 assert.deepEqual(a.materials.map((m:any)=>[m.material_revision,m.part_revision]),[[7,null],[7,3]],'no part, no part revision')
 assert.equal(a.joints[0].fasteners[0].material_revision,7)
 assert.deepEqual(a.parameter_plan.nodes.map((n:any)=>n.source?.revision??n.source?.space_revision??null),[5,9,null])
 assert.equal(a.parameter_plan.nodes[0].source.space_revision,undefined,'a project measurement gets no space revision')
 // A new construction starts at zero.
 const fresh=await fillServerRevisions('save_construction_draft',{record_id:null,materials:[],joints:[],parameter_plan:{nodes:[]}},memory,readers)
 assert('args' in fresh);assert.equal((fresh.args as any).expected_revision,0)
 // Plan, target and read records.
 const target=await fillServerRevisions('select_project_target',{record_id:'sol',area_id:'kitchen',reason:'r'},memory,readers)
 assert('error' in target);assert.deepEqual(target.error.validation.fields,['solution_revision (sol)'],'a record without a reader must have been read')
 memory.observe('read_solution_context',{status:'ok',records:[{id:'sol',revision:2,current_revision:4},{nested:{record_id:'other',revision:1}}]})
 const selected=await fillServerRevisions('select_project_target',{record_id:'sol',area_id:'kitchen',reason:'r'},memory,readers)
 assert('args' in selected);assert.deepEqual([(selected.args as any).expected_revision,(selected.args as any).solution_revision],[4,4])
 const linked=await fillServerRevisions('link_project_plan_evidence',{requirement_id:'q',evidence_id:'other',evidence_kind:'x'},memory,readers)
 assert('args' in linked);assert.deepEqual([(linked.args as any).plan_revision,(linked.args as any).evidence_revision],[12,1])
 // Job-owned identity is dropped only in a worker job.
 const req={data:{artifact_id:'a',artifact_revision:3,target_revision:2,definition_id:'d'},expected_revision:1,record_ref:null}
 assert.deepEqual(stripServerRevisions('derive_cad_material_requirement',req),{data:{definition_id:'d'},record_ref:null})
 assert.deepEqual(stripServerRevisions('derive_cad_material_requirement',req,SERVER_REVISIONS,{}),req)
 assert(Object.keys(JOB_OWNED_FIELDS).length)
})

test('what the model read is kept with the paused job',()=>{
 const memory=createRevisionMemory()
 memory.observe('x',{receipt:{recordId:'r',revision:3}})
 memory.observe('search_material_catalog',{results:[{profile_code:'sheet_stock',profile_revision:2}]})
 memory.observe('read_project_plan',{record:{revision:5,status:'proposed'}})
 const restored=createRevisionMemory();restored.restoreState(JSON.parse(JSON.stringify(memory.exportState())))
 assert.deepEqual([restored.get('r'),restored.get('profile:sheet_stock'),restored.get('proposal')],[3,2,5])
})

test('a Bob session offers no revision field, fills it on the server and keeps its memory in the session state',async()=>{
 const calls:any[]=[]
 const lookup=createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null}))
 const extra={spec:spec('cancel_drawing_request'),version:1,gate:()=>'available' as const,execute:async(v:unknown)=>{calls.push(v);return {status:'cancelled',request:{id:'req',revision:4}}}}
 const policy=async()=>{const p=await seedToolPolicy();return {...p,tools:[...p.tools.filter(t=>t.name!=='cancel_drawing_request'),{name:'cancel_drawing_request',description:'d',how_to:'h',schema_version:1,always_load:true,preload_phases:[],active:true}]}}
 const make=()=>createBobToolSession({aiCatalog:fixture,message:'Avbryt ritningen.',lookup,readPolicy:policy,extraTools:[extra],serverRevisions:{readers:{}}} as any)
 const session=make()
 const offered=(await session.prepare()).find(t=>t.function.name==='cancel_drawing_request')
 assert(offered,'offered');assert.deepEqual(Object.keys((offered!.function.parameters as any).properties),['request_id'])
 const args={request_id:'req',expected_revision:7}
 const unread=await session.execute('cancel_drawing_request',args)
 assert.equal(unread.reason,'version_unknown');assert.equal(calls.length,0,'never read: nothing runs, and the 7 the model sent is not used')
 // A paused job comes back with what the model had read.
 const state=session.exportState() as any
 const resumed=make();await resumed.prepare();resumed.restoreState({...state,revision_memory:[['req',3]]})
 await resumed.execute('cancel_drawing_request',args)
 assert.deepEqual(calls[0],{request_id:'req',expected_revision:3})
 assert.deepEqual((resumed.exportState() as any).revision_memory,[['req',4]],'and remembers the newer revision the result showed')
})
