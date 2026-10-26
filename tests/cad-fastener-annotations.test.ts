// CAD drawings carry the construction's fastener schedule (owner decisions
// 2026-10-26, B2): publication accepts annotations version 1 as before, or
// version 2 only with the exact rule schedule of the pinned construction revision.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {designIntent,designManifest} from './support/design-intent-fixture.ts'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {handoff} from './support/cad-review-fixture.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {manufacturePolicy} from './support/construction-instance-policy-fixture.ts'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

test('a drawing publishes annotations v2 only with the exact fastener schedule of its pinned construction revision',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),turn=randomUUID(),message='Save my synthetic construction and drawing with fasteners.'
 const rpc=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'fastener-drawing@example.test'])
 const project=(await rpc(owner,'bob.create_project',[JSON.stringify({name:'Fastener drawing fixture'})])).id,solution=randomUUID()
 await rpc(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Bracket',description:'Synthetic',assumptions:'Unknown strength',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await rpc(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic target'})])
 const claim=await rpc(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 const write=(p:any)=>rpc(owner,'bob.bob_project_write_v14',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 const mat=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'mat',kind:'material',name:'Plywood concept',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 // An 18 mm upright screwed into a 100 mm arm end: the rule gives 4.0 x 45, two screws, narrow edge flagged.
 const recipe:any={contract_version:1,units:'mm',assembly_id:'bracket',definitions:[
  {id:'upright',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200},{id:'arm',primitive:'box',material_ref:null,x_mm:100,y_mm:80,z_mm:18}],
  instances:[{id:'upright',definition_id:'upright',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}},{id:'arm',definition_id:'arm',placement:{x:18,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
 const draft:any={recipe,parameters:compileCadParameters(project,recipe,parameterPlan(recipe),new Map(),new Map()),
  materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:mat.recordId,material_revision:1,part_id:null,part_revision:null})),
  joints:[{id:'corner',method:'screwed_butt',first:{instance_id:'upright',face:'x_max'},second:{instance_id:'arm',face:'x_min'},reason:'Concept'}],
  open_questions:['Strength remains unverified'],instance_policy:manufacturePolicy(recipe),target_revision:1,area_id:null,title:'Bracket',description:'Synthetic concept'}
 const checkpoint=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'checkpoint',title:draft.title,description:draft.description,area_id:null,target_revision:1,change_note:'Initial',recipe,parameters:draft.parameters,materials:draft.materials,joints:draft.joints,open_questions:draft.open_questions,instance_policy:draft.instance_policy}})
 draft.artifact_id=checkpoint.recordId
 const catalog=new Map([[mat.recordId+'@1',{id:mat.recordId,revision:1,current_revision:1,kind:'material',profile_code:'sheet_stock',categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null}}}]])
 const checked=checkConstruction({...draft,status:'ok',projectId:project,revision:1,current_revision:1,archived:false,source_state:'current',source_kind:'construction'},catalog,'2026-10-04')
 assert.equal(checked.concept_ready,true)
 // Read exactly as the Edge does before rendering: the caller's reader for the pinned revision.
 const {status,project_id,artifact_id,revision,...schedule}=await rpc(owner,'bob.read_construction_fasteners',[project,checkpoint.recordId,1])
 assert.deepEqual([status,project_id,artifact_id,revision],['ok',project,checkpoint.recordId,1])
 assert.deepEqual(schedule.totals,[{kind:'screw',diameter_mm:4.0,length_mm:45,count:2,joint_ids:['corner']}])
 const views={front:{coverage:'complete',dimensions:[],parts:[]},top:{coverage:'complete',dimensions:[],parts:[]}}
 const drawing=(annotations:unknown,title='Bracket drawing')=>({kind:'cad',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{title,description:'Synthetic concept',assumptions:'Not fabrication ready',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,
  packet:{recipe,manifest:{...designManifest(project,solution),assembly_id:recipe.assembly_id,engine:{name:'build123d'},bob_parameters:draft.parameters,bob_lineage:buildCadLineage(project,recipe,[],new Map(),handoff.coordinates),
   annotations,drawing_source:{artifact_id:checkpoint.recordId,revision:1},bob_construction:{version:1,project_id:project,artifact_id:checkpoint.recordId,revision:1,check:checked}},files:{front:'PHN2Zy8+'}}}})
 // A JSON round trip (Edge, worker, journal) may print 4.0 as 4; jsonb compares numbers by value.
 const echoed=JSON.parse(JSON.stringify(schedule))
 const changed=structuredClone(echoed);changed.totals[0].count=3
 const otherRevision=structuredClone(echoed);otherRevision.joints[0].length_mm=50
 for(const annotations of [{version:2,coverage:'complete',views},{version:2,coverage:'complete',views,fasteners:changed},{version:2,coverage:'complete',views,fasteners:otherRevision},
  {version:2,coverage:'complete',views,fasteners:null},{version:1,coverage:'complete',views,fasteners:echoed},{version:2,coverage:'partial',views,fasteners:echoed},{version:3,coverage:'complete',views,fasteners:echoed}])
  await assert.rejects(write(drawing(annotations)),/construction_annotations_required/,JSON.stringify(annotations).slice(0,80))
 const saved=await write(drawing({version:2,coverage:'complete',views,fasteners:echoed}))
 const stored=async(id:string,rev:number)=>(await asProjectUser(pg,owner,'select manifest from bob.artifact_cad_revisions where artifact_id=$1 and artifact_revision=$2',[id,rev])).rows[0].manifest
 assert.deepEqual((await stored(saved.recordId,1)).annotations.fasteners,schedule,'the app reads the stored schedule verbatim')
 // Bob's drawing reader strips nulls from its manifest view as before.
 const back=await rpc(owner,'bob.read_cad_artifact',[project,saved.recordId,null])
 assert.equal(back.manifest.annotations.version,2);assert.deepEqual(back.manifest.annotations.fasteners.totals,schedule.totals)
 // Version 1 drawings without a schedule stay valid.
 const plain=await write(drawing({version:1,coverage:'complete',views},'Bracket drawing without fasteners'))
 assert.equal((await rpc(owner,'bob.read_cad_artifact',[project,plain.recordId,null])).manifest.annotations.version,1)
 // An exact archive copy keeps its lifecycle exemption.
 await rpc(owner,'bob.artifact_command',[project,'archive',saved.recordId,1,'{}'])
 assert.deepEqual((await stored(saved.recordId,2)).annotations.fasteners,schedule)
})

test('the installed validator carries the guarded version 2 check exactly once',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const def=(await pg.query(`select pg_get_functiondef('bob_private.validate_cad_construction_source()'::regprocedure) d`)).rows[0].d as string
 assert.equal(def.split('bob_private.construction_fastener_schedule(source.recipe,source.joints)').length,2)
 assert.doesNotMatch(def,/'version' is distinct from '1'::jsonb or new\.manifest/)
})
