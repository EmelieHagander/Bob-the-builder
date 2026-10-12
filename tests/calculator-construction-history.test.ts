import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {designIntent} from './support/design-intent-fixture.ts'

test('calculator replays a canonically saved pre-D v1 quantity without replacing its all-instance semantics with v2 roles',async t=>{
 const user=randomUUID();let project='',need='',construction=''
 const pg=await projectSchema(async(db,name)=>{
  if(name!=='20261011090115_construction_instance_roles.sql')return
  const call=async(fn:string,args:unknown[],who:string|null=user,role='authenticated')=>(await asProjectUser(db,who,`select ${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result as any
  await db.query("insert into auth.users values($1,'calculator-history@test.invalid',now())",[user])
  project=(await call('bob.create_project',[JSON.stringify({name:'Calculator historical fixture'})])).id
  const solution=randomUUID()
  await call('bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Historical concept',description:'Synthetic history',assumptions:'Not physical evidence',tradeoffs:'Test only',measurements:[],design_intent:designIntent()})])
  await call('bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic target'})])
  const turn=randomUUID(),message='Save the historical calculation fixture'
  const claim=await call('bob.bob_claim_turn',[project,user,turn,message],null,'service_role')
  const base={record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message}
  const write=(data:any)=>call('bob.bob_project_write_v14',[project,claim.thread_id,turn,claim.generation,JSON.stringify({...base,...data})])
  const material=await write({kind:'catalog',data:{action:'ensure',key:'material',kind:'material',name:'History plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],
   properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
  const place=(x:number)=>({x,y:0,z:0,rx:0,ry:0,rz:0})
  const recipe:any={contract_version:1,units:'mm',assembly_id:'history',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:200,y_mm:100,z_mm:18}],
   instances:[{id:'first',definition_id:'panel',placement:place(0)},{id:'second',definition_id:'panel',placement:place(300)}],views:['front']}
  const saved=await write({kind:'construction',data:{key:'construction',title:'Historical two-panel concept',description:'Synthetic history',area_id:null,target_revision:1,change_note:'Fixture',recipe,
   parameters:compileCadParameters(project,recipe,parameterPlan(recipe),new Map(),new Map()),materials:[{definition_id:'panel',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],open_questions:['Fit and fastening remain unknown']}})
  construction=saved.recordId
  const fields={name:'Historical panel area',category:'Timber',area_id:null,task_id:null,waste_percent:'0',purchase_increment:'1',assumptions:'Synthetic',artifact_id:construction,artifact_revision:1,target_revision:1,definition_id:'panel',quantity_mode:'area_xy',stock_allocations:[],component_allocations:[],change_note:'Historical count'}
  const requirement=await write({kind:'operational',data:{resource:'cad_requirement',action:'create',fields}});need=requirement.recordId
  const r=(await asProjectUser(db,user,'select method_version,required_quantity from bob.current_material_requirements where id=$1',[need])).rows[0] as any
  assert.equal(r.method_version,'1');assert.equal(Number(r.required_quantity),.04)
 })
 t.after(()=>pg.close())
 const replay=(await asProjectUser(pg,user,'select bob.read_calculation_source($1,$2,$3,1) result',[project,'material',need])).rows[0].result as any
 assert.equal(replay.status,'ok');assert.equal(replay.calculation.base_provenance.status,'replayed')
 assert.equal(replay.calculation.base_provenance.version,'1');assert.equal(replay.calculation.base_provenance.instance_semantics,'all_saved_instances_v1')
 assert.equal(replay.calculation.base_provenance.value,.04);assert.equal(replay.calculation.base_provenance.source.artifact_id,construction)
 assert.deepEqual(replay.calculation.base_provenance.source.instance_ids,['first','second'])
 const stored=(await asProjectUser(pg,user,'select method_version,required_quantity from bob.current_material_requirements where id=$1',[need])).rows[0] as any
 assert.equal(stored.method_version,'1');assert.equal(Number(stored.required_quantity),.04)
})
