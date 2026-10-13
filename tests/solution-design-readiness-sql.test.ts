import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {designIntent,designManifest} from './support/design-intent-fixture.ts'
import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {parseDesignIntent,parseDesignReadiness,type DesignIntent} from '../supabase/functions/_shared/project-design-intent.ts'
import type {CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'

test('shared SolutionVersion advice, references and readiness fence construction and CAD at SQL',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID(),message='Develop the synthetic fixture within my delegated design choices.'
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'intent-owner@example.test',outsider,'intent-outsider@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Design readiness fixture'})])).id
 const other=(await call(outsider,'bob.create_project',[JSON.stringify({name:'Separate design fixture'})])).id
 const solution=randomUUID();let solutionRevision=1,targetRevision=1
 const body=(intent?:DesignIntent|null)=>({area_id:null,title:'Fixture assembly',description:'A synthetic agreed assembly.',assumptions:'Products and fabrication unchecked',tradeoffs:'Synthetic',measurements:[],...(intent!==undefined?{design_intent:intent}:{})})
 const select=async()=>{const r=await call(owner,'bob.solution_command',[project,'select',solution,targetRevision===1&&solutionRevision===1?0:targetRevision,JSON.stringify({solution_revision:solutionRevision,reason:'Use this exact synthetic design intent'})]);targetRevision=r.revision}
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify(body())]);await select()
 const ready=(purpose:string|null='construction',revision=targetRevision,area:string|null=null,uid=owner)=>call(uid,'bob.read_design_readiness',[project,area,revision,purpose])
 const revise=async(intent:DesignIntent|null,extra:Record<string,unknown>={})=>{
  const {area_id,...b}=body(intent);await call(owner,'bob.solution_command',[project,'revise',solution,solutionRevision,JSON.stringify({...b,change_note:'Reconcile expert advice',...extra})]);solutionRevision++;await select()
 }
 const recipe:CadAssemblyRequest={contract_version:1,units:'mm',assembly_id:'fixture_assembly',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:300,y_mm:200,z_mm:18}],instances:[{id:'panel_one',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
 let turn=randomUUID(),claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 const write=(p:any)=>call(owner,'bob.bob_project_write_v16',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 const catalog:any={kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'fixtureMaterial',kind:'material',name:'Synthetic fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'delegated design choices',source_seq:null}}
 const material=await write(catalog)
 const construction=(key:string)=>({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key,title:'Fixture checkpoint '+key,description:'Synthetic geometry',area_id:null,target_revision:targetRevision,change_note:'Develop selected direction',recipe,parameters:parameterPacket(project,recipe),materials:[{definition_id:'panel',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],open_questions:['Product and fabrication checks remain open.']}})
 const cad=(key:string,purpose:'illustration'|'concept'|'construction'='construction')=>({kind:'cad',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:message,data:{title:'Fixture drawing '+key,description:'Synthetic drawing',assumptions:'No engineering approval',target_revision:targetRevision,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,
  packet:{recipe,manifest:{...designManifest(project,solution,solutionRevision,targetRevision,null,purpose),bob_parameters:parameterPacket(project,recipe),engine:{name:'build123d'},assembly_id:recipe.assembly_id},files:{front:'PHN2Zz48L3N2Zz4=',step:'SYNTHETIC_EXPORT'}}}})
 await t.test('legacy text stays unknown; Auth, outsider, service and direct table writes cannot grant readiness',async()=>{
  const legacy=await ready();assert.equal(legacy.status,'needs_data');assert.equal(legacy.design_intent,null);assert.equal(legacy.pin,null);assert(parseDesignReadiness(legacy));assert.equal(legacy.issues[0].code,'design_intent_required')
  await assert.rejects(write(construction('legacy')),/design_readiness_required/)
  await assert.rejects(ready('construction',targetRevision,null,outsider),/project_denied/)
  await assert.rejects(call(null,'bob.read_design_readiness',[project,null,targetRevision,'construction'],'anon'),/permission denied/)
  await assert.rejects(call(null,'bob.read_design_readiness',[project,null,targetRevision,'construction'],'service_role'),/permission denied/)
  await assert.rejects(asProjectUser(pg,owner,'update bob.solution_revisions set design_intent=$1 where solution_id=$2',[JSON.stringify(designIntent()),solution]),/permission denied/)
  assert.equal((await pg.query('select count(*)::int n from bob.artifact_construction_revisions where project_id=$1',[project])).rows[0].n,0)
 })
 await t.test('raw string caps, Unicode codepoints and whitespace use the same shape contract as the runtime parser',async()=>{
  const changes=[
   (x:DesignIntent)=>{x.summary=' '+'s'.repeat(2000)},
   (x:DesignIntent)=>{x.features[0].description=' '+'d'.repeat(1000)},
   (x:DesignIntent)=>{x.features[0].source_ref=' '+'r'.repeat(200)},
   (x:DesignIntent)=>{x.choices[0].question=' '+'q'.repeat(1000)},
   (x:DesignIntent)=>{x.choices[0].alternatives=[' '+'a'.repeat(1000)]},
   (x:DesignIntent)=>{x.choices[0].selected_direction=' '+'s'.repeat(2000)},
   (x:DesignIntent)=>{Object.assign(x.choices[0],{status:'deferred',selected_direction:null,deferral:{scope:'illustration',reason:' '+'r'.repeat(2000)}})},
   (x:DesignIntent)=>{x.choices[0].recommendation='\u00a0\t\n\u202f\ufeff'},
   (x:DesignIntent)=>{x.alignment.basis='\u00a0\t\n\u202f\ufeff'},
  ]
  for(const change of changes){const x=designIntent();change(x);assert.equal(parseDesignIntent(x),null);await assert.rejects(call(owner,'bob.solution_command',[project,'create',randomUUID(),0,JSON.stringify(body(x))]),/invalid_design_|design_choice_direction_required/)}
  const x=designIntent();x.summary='😀'.repeat(2000);assert(parseDesignIntent(x));const id=randomUUID()
  await call(owner,'bob.solution_command',[project,'create',id,0,JSON.stringify(body(x))])
  const lookup=await call(owner,'bob.search_bob_project_data_v2',[project,'solutions',null,null,null,id,null]);assert(parseDesignIntent(lookup.records[0].design_intent));assert.equal(lookup.records[0].design_intent.summary,x.summary)
  assert.equal((await call(owner,'bob_private.design_text_present',['v'])),true,'vertical-tab support must not treat the letter v as whitespace')
 })
 await t.test('geometry-dependent choices require advice and an actual selected direction, not delegation alone',async()=>{
  const open=designIntent();open.choices[0].status='open';open.choices[0].selected_direction=null;open.choices[0].recommendation='';open.choices[0].basis='';open.choices[0].consequences='';open.choices[0].decision_basis='Bob may decide within the existing mandate.'
  await revise(open);const r=await ready();assert.equal(r.status,'needs_data');assert(r.issues.some((i:any)=>i.code==='design_geometry_choice_open'));assert.equal(r.pin,null)
  await assert.rejects(write(construction('unsettled')),/design_readiness_required/)
  const unresolved=designIntent();unresolved.choices[0].selected_direction=null
  await assert.rejects(revise(unresolved),/design_choice_direction_required/)
  assert.equal((await pg.query('select current_revision from bob.solutions where id=$1',[solution])).rows[0].current_revision,solutionRevision)
  await revise(designIntent());const settled=await ready();assert.equal(settled.status,'ready');assert(parseDesignReadiness(settled));assert.equal(settled.design_intent.choices[0].decision_authority,'bob')
 })
 let checkpoint:any,referenceImage:string
 await t.test('construction persists and reopens exact shared solution pins; an exact receipt remains idempotent',async()=>{
  const p=construction('settled');checkpoint=await write(p)
  assert.deepEqual(await write(p),checkpoint)
  const r=await call(owner,'bob.read_construction_draft',[project,checkpoint.recordId,null,null]);assert.equal(r.solution_id,solution);assert.equal(r.solution_revision,solutionRevision);assert.equal(r.design_intent.choices[0].selected_direction,designIntent().choices[0].selected_direction);assert.equal(r.design_intent_pin.target_revision,targetRevision)
  assert.equal(r.rendered,false);assert.equal(r.reviewed,false);assert(r.open_questions.length)
 })
 await t.test('bounded exploratory deferral permits only its selected purpose; developing geometry remains blocked',async()=>{
  const limited=designIntent('illustration');const choice=limited.choices[0];choice.status='deferred';choice.selected_direction=null;choice.deferral={scope:'illustration',reason:'Explore the outside form only; support geometry is intentionally not selected.'}
  await revise(limited);const r=await ready(null);assert.equal(r.status,'ready');assert.equal(r.purpose,'illustration');assert.deepEqual(r.deferred_choice_ids,[choice.id]);assert(parseDesignReadiness(r))
  const blocked=await ready('construction');assert.equal(blocked.status,'needs_data');assert(blocked.issues.some((i:any)=>i.code==='design_deferral_out_of_scope'))
  await assert.rejects(write(construction('wrongPurpose')),/design_readiness_required/)
  const drawing=await write(cad('exploratory','illustration'));assert.equal(drawing.dataset,'artifacts')
  const read=await call(owner,'bob.read_cad_artifact',[project,drawing.recordId,null]);assert.equal(read.manifest.bob_design_intent.purpose,'illustration');assert.equal(read.design_intent.choices[0].status,'deferred')
  await call(owner,'bob.artifact_command',[project,'archive',drawing.recordId,1,'{}']);await call(owner,'bob.artifact_command',[project,'restore',drawing.recordId,2,'{}'])
  assert.equal((await call(owner,'bob.read_cad_artifact',[project,drawing.recordId,3])).manifest.bob_design_intent.purpose,'illustration')
 })
 await t.test('selected historical solution does not silently follow a newer draft; ordinary edits preserve choices but clear alignment',async()=>{
  const chosenRevision=solutionRevision,chosenTarget=targetRevision
  const {area_id,...b}=body();await call(owner,'bob.solution_command',[project,'revise',solution,solutionRevision,JSON.stringify({...b,description:'Changed form requires reconciliation.',change_note:'Change narrative without fresh design intent'})]);solutionRevision++
  const current:any=(await asProjectUser(pg,owner,'select * from bob.current_solutions where id=$1',[solution])).rows[0]
  assert.equal(current.design_intent.alignment.status,'draft');assert.equal(current.design_intent.choices[0].status,'deferred')
  const pinned=await ready(null);assert.equal(pinned.solution_revision,chosenRevision);assert.equal(pinned.target_revision,chosenTarget);assert.equal(pinned.status,'ready')
  const lookup=await call(owner,'bob.search_bob_project_data_v2',[project,'target',null,null,null,null,null]);assert.equal(lookup.records[0].solution_revision,chosenRevision);assert.equal(lookup.records[0].design_intent.alignment.status,'aligned')
  await select();assert.equal((await ready(null)).status,'needs_data');assert.equal((await ready(null,chosenTarget)).status,'conflict')
  assert.equal((await call(owner,'bob.read_construction_draft',[project,checkpoint.recordId,1,null])).design_intent.purpose,'construction')
 })
 await t.test('reference roles, visual features, same-project access and exact original-image versions survive design handoff',async()=>{
  const image=randomUUID(),foreign=randomUUID();referenceImage=image
  const reserve=(p:string,id:string,uid:string)=>call(uid,'bob.media_command',[p,'reserve',id,JSON.stringify({original_name:'fixture.png',title:'Fixture reference',purpose:'reference',content_type:'image/png',byte_size:20,width:1,height:1,target_kind:'project',target_id:p})])
  await reserve(project,image,owner);await reserve(other,foreign,outsider)
  await pg.query("insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,'{\"size\":20,\"mimetype\":\"image/png\"}')",[project+'/'+image]);await call(owner,'bob.media_command',[project,'finalize',image,'{}'])
  const intent=designIntent();intent.references=[{image_id:foreign,role:'layout',note:'Foreign project'}]
  await assert.rejects(revise(intent),/design_reference_unavailable/)
  intent.references=[{image_id:image,role:'appearance',note:'Preserve this fixture form.'}];intent.features=[]
  await revise(intent,{source_media_id:image});assert.equal((await ready()).status,'needs_data');assert((await ready()).issues.some((i:any)=>i.code==='missing_design_features'))
  intent.features=designIntent().features;intent.features[0].source_ref='image:'+image;await revise(intent,{source_media_id:image})
  const r=await ready();assert.equal(r.status,'ready')
  const lookup=await call(owner,'bob.search_bob_project_data_v2',[project,'solutions',null,null,null,solution,null]);assert.equal(lookup.records[0].source_media_id,image);assert.deepEqual(lookup.records[0].design_intent,intent)
  const p=cad('reference');p.data.packet.manifest.bob_design_images=[{image_id:image,source_version:'[]'}] as any
  await assert.rejects(write(p),/design_image_changed/)
  const version:any=(await pg.query("select jsonb_build_array(m.updated_at,m.content_type,m.byte_size,m.width,m.height,m.title,m.purpose,coalesce(m.source_kind,'unknown'),coalesce((select jsonb_agg(jsonb_build_array(l.area_id,l.task_id,l.step_id,l.plan_step_id)::text order by jsonb_build_array(l.area_id,l.task_id,l.step_id,l.plan_step_id)::text) from bob.media_links l where l.project_id=m.project_id and l.media_id=m.id),'[]'::jsonb))::text source_version from bob.media_assets m where m.id=$1",[image])).rows[0]
  p.data.packet.manifest.bob_design_images=[{image_id:image,source_version:version.source_version}] as any
  const saved=await write(p);const read=await call(owner,'bob.read_cad_artifact',[project,saved.recordId,1]);assert.equal(read.manifest.bob_design_images[0].image_id,image)
  const forged=structuredClone(p);forged.data.title='Wrong selected version';forged.data.packet.manifest.bob_design_intent.solution_revision--;await assert.rejects(write(forged),/design_intent_pin_required/)
 })
 await t.test('an inherited Area target keeps its effective pin; an explicitly cleared Area does not inherit approval',async()=>{
  const area='fixture_area',foreignArea='foreign_fixture_area'
  await pg.query("insert into bob.areas(id,project_id,name,slug) values($1,$2,'Fixture area','fixture-area'),($3,$4,'Foreign area','foreign-area')",[area,project,foreignArea,other])
  const inherited=await ready('construction',targetRevision,area);assert.equal(inherited.status,'ready');assert.equal(inherited.area_id,area);assert.equal(inherited.pin.area_id,null);assert.equal(inherited.pin.target_revision,targetRevision);assert(parseDesignReadiness(inherited))
  await assert.rejects(ready('construction',targetRevision,foreignArea),/project_denied/)
  const areaSolution=randomUUID();await call(owner,'bob.solution_command',[project,'create',areaSolution,0,JSON.stringify({...body(designIntent()),area_id:area})])
  const areaTarget=await call(owner,'bob.solution_command',[project,'select',areaSolution,0,JSON.stringify({solution_revision:1,reason:'Synthetic Area direction',area_id:area})])
  const cleared=await call(owner,'bob.solution_command',[project,'clear',null,areaTarget.revision,JSON.stringify({reason:'This Area has no settled design direction.',area_id:area})])
  const r=await call(owner,'bob.read_design_readiness',[project,area,cleared.revision,'construction']);assert.equal(r.status,'needs_data');assert.equal(r.solution_id,null);assert.equal(r.pin,null);assert.equal(r.issues[0].code,'design_target_required');assert(parseDesignReadiness(r))
  assert.equal((await ready()).status,'ready','clearing an Area leaves the selected Project target intact')
 })
 await t.test('private reset retains shared expert choices and a new turn reuses them without a new owner decision',async()=>{
  await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
  const thread:any=(await pg.query('select id,next_seq from bob.bob_threads where id=$1',[claim.thread_id])).rows[0]
  const before=await ready();await call(owner,'bob.bob_reset_conversation',[project,thread.id,thread.next_seq])
  const after=await ready();assert.deepEqual(after,before);assert.equal((await pg.query('select count(*)::int n from bob.bob_threads where id=$1',[thread.id])).rows[0].n,0)
  turn=randomUUID();claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
  const saved=await write(construction('afterReset'));assert.equal(saved.dataset,'artifacts');assert.equal((await call(owner,'bob.read_construction_draft',[project,saved.recordId,1,null])).design_intent.choices[0].decision_authority,'bob')
 })
 await t.test('Bob image writes distinguish an omitted existing image from explicit clearing',async()=>{
  const fresh=async()=>{await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role');turn=randomUUID();claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')}
  const {area_id,...b}=body()
  const omitted:any={kind:'solution',record_id:solution,expected_updated_at:null,expected_revision:solutionRevision,request_quote:message,data:{...b,change_note:'Preserve existing image and shared choices'}}
  const kept=await write(omitted);solutionRevision++;assert.equal(kept.record.source_media_id,referenceImage);assert.equal(kept.record.design_intent.alignment.status,'aligned');assert.deepEqual(await write(omitted),kept)
  await fresh();const cleared={...omitted,expected_revision:solutionRevision,data:{...omitted.data,source_media_id:null,change_note:'Explicitly clear the primary image'}}
  const removed=await write(cleared);solutionRevision++;assert.equal(removed.record.source_media_id,null);assert.equal(removed.record.design_intent.alignment.status,'draft');assert.equal(removed.record.design_intent.choices[0].status,'resolved')
  assert.equal((await ready()).solution_revision,targetRevision,'the older selected version stays pinned until an explicit target selection')
 })
 await t.test('deleted original evidence becomes unavailable, while historical CAD remains navigable',async()=>{
  await call(owner,'bob.media_command',[project,'begin_delete',referenceImage,'{}'])
  await asProjectUser(pg,owner,'delete from storage.objects where name=$1',[project+'/'+referenceImage])
  await call(owner,'bob.media_command',[project,'finish_delete',referenceImage,'{}'])
  const r=await ready();assert.equal(r.status,'unavailable');assert(r.issues.some((i:any)=>i.code==='design_reference_unavailable'));assert.equal(r.pin,null);assert(parseDesignReadiness(r))
  await assert.rejects(write(construction('missingReference')),/design_readiness_required/)
 })
 await t.test('valid large JSON cannot create an unreadable solution or target; compact versions round-trip near the whole-answer cap',async()=>{
  const large=designIntent();large.summary='s'.repeat(2000)
  large.features=Array.from({length:24},(_,i)=>({id:'feature_'+i,description:'d'.repeat(1000),basis:'project_record',source_ref:null}))
  for(const field of ['recommendation','basis','consequences','decision_basis'] as const)large.choices[0][field]='e'.repeat(2000)
  assert(parseDesignIntent(large),'shape and the 48k JSON limit are valid; the whole readback is a separate bounded boundary')
  const id=randomUUID();await assert.rejects(call(owner,'bob.solution_command',[project,'create',id,0,JSON.stringify({...body(large),description:'A bounded readback must remain possible.'})]),/compact_design_intent_required/)
  assert.equal((await pg.query('select count(*)::int n from bob.solutions where id=$1',[id])).rows[0].n,0,'rejected create leaves no orphan head')
  const compact=designIntent();compact.summary='s'.repeat(1700);compact.features=large.features
  await call(owner,'bob.solution_command',[project,'create',id,0,JSON.stringify(body(compact))])
  const lookup=await call(owner,'bob.search_bob_project_data_v2',[project,'solutions',null,null,null,id,null])
  assert.deepEqual(lookup.records[0].design_intent,compact);assert(Buffer.byteLength(JSON.stringify(lookup))>27000);assert(Buffer.byteLength(JSON.stringify(lookup))<30000)
  const selected=await call(owner,'bob.solution_command',[project,'select',id,targetRevision,JSON.stringify({solution_revision:1,reason:'Concise selection'})])
  const target=await call(owner,'bob.search_bob_project_data_v2',[project,'target',null,null,null,'project',null]);assert.deepEqual(target.records[0].design_intent,compact)
  const before=await call(owner,'bob.read_design_readiness',[project,null,selected.revision,'construction']);assert.equal(before.status,'ready')
  const {area_id,...big}=body(large);await assert.rejects(call(owner,'bob.solution_command',[project,'revise',id,1,JSON.stringify({...big,change_note:'Oversized new revision'})]),/compact_design_intent_required/)
  assert.equal((await pg.query('select current_revision from bob.solutions where id=$1',[id])).rows[0].current_revision,1)
  assert.equal((await pg.query('select count(*)::int n from bob.solution_revisions where solution_id=$1',[id])).rows[0].n,1)
  assert.deepEqual(await call(owner,'bob.read_design_readiness',[project,null,selected.revision,'construction']),before)
  const targetBytes=Number((await pg.query('select octet_length($1::jsonb::text)::int bytes',[JSON.stringify(target)])).rows[0].bytes)
  const near=structuredClone(compact),extra=29950-targetBytes;assert(extra>0&&extra<1800)
  near.choices[0].recommendation+='x'.repeat(extra)
  const nearId=randomUUID();await call(owner,'bob.solution_command',[project,'create',nearId,0,JSON.stringify(body(near))])
  await assert.rejects(call(owner,'bob.solution_command',[project,'select',nearId,selected.revision,JSON.stringify({solution_revision:1,reason:'r'.repeat(1000)})]),/compact_design_intent_required/)
  assert.deepEqual(await call(owner,'bob.read_design_readiness',[project,null,selected.revision,'construction']),before,'oversized selected-target readback rolls back its pointer and decision')
  const final=await call(owner,'bob.solution_command',[project,'select',nearId,selected.revision,JSON.stringify({solution_revision:1,reason:'Concise selection'})])
  assert.equal((await call(owner,'bob.read_design_readiness',[project,null,final.revision,'construction'])).status,'ready')
 })
 await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
})
