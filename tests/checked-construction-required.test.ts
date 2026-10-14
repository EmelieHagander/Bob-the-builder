import {handoff} from './support/cad-review-fixture.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {designIntent,designManifest} from './support/design-intent-fixture.ts'
import {DESIGN_CAD_TOOL,SAVE_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'
import {PLAN_CAD_PIECES_TOOL} from '../supabase/functions/_shared/cad-pieces.ts'

const guard='20261014062043_checked_construction_required.sql',publication='20261014062144_ai_checked_construction_catalog.sql'
test('every new SQL CAD publication requires a source; genuine historical packets still read, archive and restore without backfill',async t=>{
 const owner=randomUUID(),turn=randomUUID(),solution=randomUUID(),message='Save this historical synthetic drawing.'
 let project:string,claim:any,legacy:any,payload:any,before:any
 const pg=await projectSchema(async(db,name)=>{
  if(name!==guard)return
  const rpc=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(db,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
  await db.query('insert into auth.users values($1,$2,now())',[owner,'mandatory-source@example.test'])
  project=(await rpc(owner,'bob.create_project',[JSON.stringify({name:'Genuine pre-gate fixture'})])).id
  await rpc(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Panel',description:'Synthetic',assumptions:'Concept only',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
  await rpc(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic selection'})])
  claim=await rpc(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
  const recipe:any={contract_version:1,units:'mm',assembly_id:'historical_panel',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:600,y_mm:300,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
  payload={kind:'cad',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{title:'Historical panel',description:'Pre-gate synthetic',assumptions:'Concept only',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,packet:{recipe,manifest:{...designManifest(project,solution),assembly_id:recipe.assembly_id,engine:{name:'build123d'},bob_parameters:parameterPacket(project,recipe)},files:{front:'PHN2Zy8+'}}}}
  legacy=await rpc(owner,'bob.bob_project_write_v16',[project,claim.thread_id,turn,claim.generation,JSON.stringify(payload)])
  before=(await db.query('select * from bob.artifact_cad_revisions where artifact_id=$1',[legacy.recordId])).rows
 });t.after(()=>pg.close())
 const rpc=async(name:string,args:unknown[]):Promise<any>=>(await asProjectUser(pg,owner,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result
 const write=(p:any)=>rpc('bob.bob_project_write_v16',[project!,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 assert.deepEqual((await pg.query('select * from bob.artifact_cad_revisions where artifact_id=$1',[legacy.recordId])).rows,before,'migration must not rewrite saved packets')
 assert.equal((await rpc('bob.read_cad_artifact',[project!,legacy.recordId,1])).construction_source,null)
 const fresh=structuredClone(payload);fresh.data.title='New unbound drawing'
 await assert.rejects(write(fresh),/construction_pin_required/)
 const revise=structuredClone(fresh);revise.record_id=legacy.recordId;revise.expected_revision=1;revise.data.artifact_id=legacy.recordId;revise.data.expected_revision=1
 await assert.rejects(write(revise),/construction_pin_required/)
 await assert.rejects(pg.query('insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) select project_id,artifact_id,artifact_revision,recipe,manifest,files from bob.artifact_cad_revisions where artifact_id=$1',[legacy.recordId]),/construction_pin_required/,'even a direct privileged insert cannot evade the source gate')
 await rpc('bob.artifact_command',[project!,'archive',legacy.recordId,1,'{}'])
 await rpc('bob.artifact_command',[project!,'restore',legacy.recordId,2,'{}'])
 const copies=(await pg.query('select recipe,manifest,files from bob.artifact_cad_revisions where artifact_id=$1 order by artifact_revision',[legacy.recordId])).rows
 assert.equal(copies.length,3);assert(copies.every(row=>JSON.stringify(row)===JSON.stringify(copies[0])))
 assert.equal((await pg.query('select count(*)::int n from bob.artifact_construction_revisions where project_id=$1',[project!])).rows[0].n,0,'no invented construction or materials')
 // A real older paused request adopts its first source in the existing atomic
 // packet transaction, with the same CAS and requirements, never a new ID.
 const requestId=randomUUID(),scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
 await rpc('bob.create_drawing_request',[project!,claim.thread_id,turn,claim.generation,requestId,JSON.stringify(scope)])
 const privateRpc=async(uid:string,name:string,args:any[],role='service_role'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const savePacket=(working:any,expected:number,key:string)=>privateRpc(owner,'bob.bob_drawing_request',[project!,owner,claim.thread_id,turn,claim.generation,'save',requestId,expected,'needs_data',JSON.stringify(working),key])
 const initial={brief:{...scope,brief:message,handoff,construction_revision:null},owner_request:message,reference_refs:[]}
 const parked=await savePacket(initial,0,'parked');assert.equal(parked.id,requestId)
 const mat=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'mat',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const construction=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'source',title:'Panel construction',description:'Single synthetic part',area_id:null,target_revision:1,change_note:'Initial',recipe:payload.data.packet.recipe,parameters:payload.data.packet.manifest.bob_parameters,materials:[{definition_id:'panel',material_id:mat.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],open_questions:['Concept only']}})
 const adopted={...initial,brief:{...initial.brief,artifact_id:construction.recordId,construction_revision:1}}
 const beforeAdoption=(await pg.query('select scope,revision from bob_private.project_drawing_requests where id=$1',[requestId])).rows[0]
 for(const mutate of [(p:any)=>p.brief.artifact_id=legacy.recordId,(p:any)=>p.brief.construction_revision=2,(p:any)=>p.brief.area_id='other']){
  const bad=structuredClone(adopted);mutate(bad)
  await assert.rejects(savePacket(bad,parked.revision,randomUUID()),/drawing_scope_changed|recovery_required/)
  assert.deepEqual((await pg.query('select scope,revision from bob_private.project_drawing_requests where id=$1',[requestId])).rows[0],beforeAdoption)
 }
 const bound=await savePacket(adopted,parked.revision,'adopt');assert.equal(bound.id,requestId);assert.deepEqual(bound.payload.brief.handoff,handoff)
 assert.equal((await pg.query<any>('select scope from bob_private.project_drawing_requests where id=$1',[requestId])).rows[0].scope.artifact_id,construction.recordId)
 assert.deepEqual(await savePacket(adopted,parked.revision,'adopt'),bound,'exact retry stays its original receipt after source binding')
 const switched=structuredClone(adopted);switched.brief.artifact_id=legacy.recordId
 await assert.rejects(savePacket(switched,bound.revision,'switch'),/drawing_scope_changed|recovery_required/)
 assert.equal((await pg.query<any>('select scope from bob_private.project_drawing_requests where id=$1',[requestId])).rows[0].scope.artifact_id,construction.recordId)

})

test('mandatory source publication activates seven versions atomically, preserving pinned manifests, model/settings and other definitions',async t=>{
 let prior:any,settings:any,versions:any
 const pg=await projectSchema(async(db,name)=>{
  if(name!==publication)return
  prior=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  settings=(await db.query('select * from shared.ai_settings order by app,function_name')).rows
  versions=(await db.query('select * from shared.ai_prompt_versions order by id')).rows
 },publication);t.after(()=>pg.close())
 const resolve=async(id:string|null=null)=>(await pg.query<any>("select shared.resolve_ai_catalog('bob',$1) result",[id])).rows[0].result
 const current=await resolve(),changed=new Set(['tools.design_project_cad','tools.save_cad_design','tools.plan_cad_pieces','tools.save_construction_draft','tools.check_construction_draft','bob.frame.outstanding','feedback.cad-assistant.next-action.facd61c3e829'])
 assert.deepEqual(current.models,prior.models);assert.deepEqual(await resolve(prior.manifest_id),prior)
 assert.deepEqual((await pg.query('select * from shared.ai_settings order by app,function_name')).rows,settings)
 const currentVersions=(await pg.query<any>('select * from shared.ai_prompt_versions order by id')).rows
 assert.equal(currentVersions.length,versions.length+7);for(const old of versions)assert.deepEqual(currentVersions.find(v=>v.id===old.id),old)
 for(const old of prior.definitions){const next=current.definitions.find((r:any)=>r.prompt_key===old.prompt_key);if(!changed.has(old.prompt_key)){assert.deepEqual(next,old);continue}
  assert.equal(next.version,old.version+1);assert.equal(next.metadata.publication,'checked-construction-required');assert.deepEqual(next.flow,old.flow);assert.deepEqual(next.available_variables,old.available_variables)
 }
 for(const tool of [DESIGN_CAD_TOOL,SAVE_CAD_TOOL,PLAN_CAD_PIECES_TOOL]){const d=current.definitions.find((r:any)=>r.prompt_key==='tools.'+tool.function.name).definition;assert.deepEqual(d.parameters,tool.function.parameters);assert.equal(d.description,tool.function.description)}
 const schema=DESIGN_CAD_TOOL.function.parameters;assert.equal(schema.properties.artifact_id.type,'string');assert.equal(schema.properties.construction_revision.type,'integer')
 const pin:any=PLAN_CAD_PIECES_TOOL.function.parameters.properties.pieces.items;assert(pin.required.includes('artifact_id')&&pin.required.includes('construction_revision'))
 assert.match(current.definitions.find((r:any)=>r.prompt_key==='bob.frame.outstanding').content,/text-only request still leaves the drawing parked/)
 const heads=async()=>(await pg.query("select prompt_key,active_version_id from shared.ai_prompts where app='bob' order by prompt_key")).rows,before=await heads()
 const sql=readFileSync('supabase/migrations/'+publication,'utf8').replace(/"tools\.check_construction_draft"/g,'"tools.missing_checked_source"').replace(/^begin;$/m,'').replace(/^commit;$/m,'')
 await assert.rejects(pg.transaction(tx=>tx.exec(sql)),/checked_construction_contract_missing/)
 assert.deepEqual(await heads(),before);assert.deepEqual(await resolve(),current)
})

test('mandatory source guard and catalog are reproducible from their reviewed declarations',()=>{
 for(const [script,path] of [['scripts/build-checked-construction-required.ts',guard],['scripts/build-ai-checked-construction-catalog.ts',publication]])assert.match(execFileSync(process.execPath,['--import','tsx',script,'supabase/migrations/'+path,'--check'],{encoding:'utf8'}),/Verified/)
})
