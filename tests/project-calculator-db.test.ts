import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {makePlan,planId as id} from './support/multifloor-fixture.ts'
import {makeStair} from './support/stair-fixture.ts'
import {createProjectCalculator,CALCULATOR_TOOL} from '../supabase/functions/_shared/project-calculator.ts'
import type {PGlite} from '@electric-sql/pglite'
let pg:PGlite,previous:any,current:any
const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',both='00000000-0000-4000-8000-000000000003'
const as=(who:string|null,sql:string,values:unknown[]=[],role='authenticated')=>asProjectUser(pg,who,sql,values,role)
const result=async(sql:string,values:unknown[]=[],who=user)=>(await as(who,sql,values)).rows[0].result as any
const source=(kind:string,record:string,revision:number,who=user)=>result('select bob.read_calculation_source($1,$2,$3,$4) result',['A',kind,record,revision],who)
const unavailable=async()=>{throw new Error('unexpected call')}
const calculator=(who=user)=>createProjectCalculator({projectId:'A',hasAccess:async()=>true,readConstruction:unavailable,
 readSources:unavailable,quotePacks:unavailable,readSource:(kind,record,revision)=>source(kind,record,revision,who)})
const quantity=(r:any,key:string)=>r.outputs.find((o:any)=>o.id===key).value
const planData=(recipe=makePlan())=>({title:'Calculator source plan',description:'Synthetic plan',assumptions:'Explicit test estimates',target_revision:1,area_id:null,recipe,measurements:[],change_note:'Test plan'})
const stairData=(extra={})=>({plan_id:id(400),plan_revision:1,recipe:makeStair(),title:'Versioned stair formula',description:'Synthetic stair',assumptions:'Explicit test estimates',change_note:'Test stair',...extra})
const needData=(extra={})=>({name:'Test panels',category:'Timber',area_id:null,task_id:null,unit:'pcs',required_quantity:'10',waste_percent:'10',purchase_increment:'3',basis:'Explicit manual count',assumptions:'Synthetic source',artifact_id:null,artifact_revision:null,target_revision:1,stock_allocations:[{id:id(600),revision:1,quantity:'2'}],component_allocations:[],...extra})

before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name.endsWith('_ai_calculator_catalog.sql'))previous=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  else if(previous&&!current)current=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 })
 current??=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 await pg.query("insert into auth.users(id,email,email_confirmed_at) values($1,'calc1@test.invalid',now()),($2,'calc2@test.invalid',now()),($3,'calc3@test.invalid',now())",[user,other,both])
 await pg.exec("insert into bob.projects(id,slug,name) values('A','calculator-a','Calculator A'),('B','calculator-b','Calculator B')")
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('calc1','A','One','O',$1),('calc2','B','Other','T',$2),('calc3a','A','Both','B',$3),('calc3b','B','Both','B',$3)",[user,other,both])
 await result('select bob.solution_command($1,$2,$3,0,$4) result',['A','create',id(2),JSON.stringify({title:'Calculator test design',description:'Synthetic design',assumptions:'Test only',tradeoffs:'No physical approval',area_id:null})])
 await result('select bob.solution_command($1,$2,$3,0,$4) result',['A','select',id(2),JSON.stringify({solution_revision:1,reason:'Test target',area_id:null})])
 await result('select bob.stock_command($1,$2,$3,0,$4) result',['A','create',id(600),JSON.stringify({name:'Test panel stock',specification:'Synthetic',quantity:'5',unit:'pcs',status:'available',area_id:null,notes:''})])
 await result('select bob.material_requirement_command($1,$2,$3,0,$4) result',['A','create',id(601),JSON.stringify(needData())])
 await result('select bob.physical_building_command($1,$2,0,$3) result',['create',id(200),JSON.stringify({name:'Calculator house',notes:'Synthetic only'})])
 for(const [n,position] of [[201,0],[206,1]])await result('select bob.physical_node_command($1,$2,$3,$4,0,$5) result',[id(200),'level','create',id(n),JSON.stringify({name:'Level '+position,position})])
 for(const [n,level] of [[202,201],[203,201],[207,206],[208,206]])await result('select bob.physical_node_command($1,$2,$3,$4,0,$5) result',[id(200),'space','create',id(n),JSON.stringify({name:'Space '+n,kind:'room',level_id:id(level),truth:'unknown',measurements:[]})])
 await result('select bob.physical_scope_command($1,$2,$3,$4,$5) result',['A','project','link',id(205),JSON.stringify({target_kind:'building',building_id:id(200)})])
 await result('select bob.artifact_multifloor_command($1,$2,$3,0,$4) result',['A','create',id(400),JSON.stringify(planData())])
 await result('select bob.artifact_stair_command($1,$2,$3,0,$4) result',['A','create',id(500),JSON.stringify(stairData())])
})
after(async()=>pg?.close())

test('calculator catalog is append-only, preserves existing model settings and exactly matches the offered code schema',async()=>{
 assert.notEqual(previous.manifest_id,current.manifest_id);assert.deepEqual(previous.models,current.models)
 const replay=(await pg.query<any>('select shared.resolve_ai_catalog($1,$2) result',['bob',previous.manifest_id])).rows[0].result
 assert.deepEqual(replay,previous)
 const changed=new Set(['tools.calculate_project','bob.tools','calculator.schema-phase','bob.contract',...['cad-designer','cad-research','cad-reviewer','plan-compiler','plan-reviewer'].map(k=>k+'.contract'),...['ask-bob','cad-designer','cad-research','cad-reviewer','plan-compiler','plan-reviewer'].map(k=>'role.'+k)])
 for(const row of previous.definitions)if(!changed.has(row.prompt_key))assert.deepEqual(current.definitions.find((r:any)=>r.prompt_key===row.prompt_key),row,row.prompt_key)
 assert.deepEqual(current.definitions.find((r:any)=>r.prompt_key==='tools.calculate_project').definition.parameters,CALCULATOR_TOOL.function.parameters)
 execFileSync('node',['--import','tsx','scripts/build-ai-calculator-catalog.ts','--check'],{stdio:'pipe'})
})

test('canonical material writer and calculator share one arithmetic implementation; manual base remains manual',async()=>{
 const r=await calculator().execute({calculation:{method:'material_purchase_v1',requirement_id:id(601),revision:1}})
 assert.equal(r.status,'calculated');assert.equal(r.source_state,'current');assert.equal(r.base_provenance.status,'manual');assert.equal(r.base_provenance.calculated,false)
 assert.equal(quantity(r,'required_with_waste'),11);assert.equal(quantity(r,'net_quantity'),9);assert.equal(quantity(r,'purchase_quantity'),9)
 assert.equal(r.inputs.find((x:any)=>x.id==='required_quantity').role,'manual')
 const stored=await result('select to_jsonb(r) result from bob.material_requirement_revisions r where requirement_id=$1 and revision=1',[id(601)])
 assert.equal(quantity(r,'purchase_quantity'),stored.purchase_quantity)
 const math=await result('select to_jsonb(m) result from bob_private.material_purchase_math_v1(2.0001,10,0.3,0.1,0) m')
 assert.equal(math.required_with_waste,2.2002);assert.equal(math.purchase_quantity,2.4)
})

test('material replay survives a changed requirement and stock; repeated reads create no new output or receipt',async()=>{
 const before=await source('material',id(601),1)
 await result('select bob.material_requirement_command($1,$2,$3,$4,$5) result',['A','revise',id(601),1,JSON.stringify(needData({required_quantity:'20',change_note:'Changed count'}))])
 const request={calculation:{method:'material_purchase_v1',requirement_id:id(601),revision:1}}
 const c=calculator(),first=await c.execute(request),again=await c.execute(request)
 assert.equal(first.source_state,'changed');assert.equal(quantity(first,'purchase_quantity'),9);assert.deepEqual(first,again)
 assert.deepEqual(first.outputs,before.calculation.outputs)
 assert.equal((await pg.query<any>('select count(*)::int n from bob.material_requirement_revisions where requirement_id=$1',[id(601)])).rows[0].n,2)
})

test('stair formula previews, saves, reloads and replays exact old/new plan pins without rounded-rise drift',async()=>{
 const c=calculator()
 const initial=await c.execute({calculation:{method:'saved_stair_study_v1',record_id:id(500),revision:1}})
 assert.equal(initial.status,'calculated');assert.equal(quantity(initial,'rise_mm'),175);assert.equal(quantity(initial,'step_formula_mm'),630)
 const recipe=makePlan();recipe.levels[1].floor_z_mm=3150
 const changedPlan=planData(recipe) as any;delete changedPlan.area_id
 await result('select bob.artifact_multifloor_command($1,$2,$3,$4,$5) result',['A','revise',id(400),1,JSON.stringify(changedPlan)])
 const historical=await c.execute({calculation:{method:'saved_stair_study_v1',record_id:id(500),revision:1}})
 assert.equal(historical.source_state,'changed');assert.equal(quantity(historical,'step_formula_mm'),630)
 const spec=makeStair();spec.risers=17
 const preview=await c.execute({calculation:{method:'stair_study_v1',plan_id:id(400),plan_revision:2,recipe:spec}})
 assert.equal(preview.status,'calculated');assert.equal(quantity(preview,'rise_mm'),3150/17)
 assert.equal(quantity(preview,'step_formula_mm'),2*(3150/17)+280);assert.equal(preview.model.persisted,false)
 await result('select bob.artifact_stair_command($1,$2,$3,$4,$5) result',['A','refresh_source',id(500),1,JSON.stringify(stairData({plan_revision:2}))])
 const refreshed=await calculator().execute({calculation:{method:'saved_stair_study_v1',record_id:id(500),revision:2}})
 assert.equal(refreshed.model.persisted,true);assert.equal(refreshed.source_state,'current');assert.equal(quantity(refreshed,'step_formula_mm'),673.75)
 assert.equal(quantity(await calculator().execute({calculation:{method:'saved_stair_study_v1',record_id:id(500),revision:1}}),'step_formula_mm'),630)
})

test('caller-bound RPC denies outsiders/anon/service, isolates projects and hides unavailable physical sources',async()=>{
 await assert.rejects(source('material',id(601),1,other),/project_denied/)
 await assert.rejects(as(null,'select bob.read_calculation_source($1,$2,$3,$4)',['A','material',id(601),1],'anon'),/permission denied/)
 await assert.rejects(as(user,'select bob.read_calculation_source($1,$2,$3,$4)',['A','material',id(601),1],'service_role'),/permission denied/)
 const cross=(await as(both,'select bob.read_calculation_source($1,$2,$3,$4) result',['B','material',id(601),1])).rows[0].result as any
 assert.deepEqual(cross,{status:'not_found',project_id:'B'})
 const secured=(await pg.query<any>("select prosecdef,proconfig from pg_proc where oid='bob.read_calculation_source(text,text,uuid,integer)'::regprocedure")).rows[0]
 assert.equal(secured.prosecdef,false);assert(secured.proconfig.some((s:string)=>s==='search_path=""'))
 await assert.rejects(source('unknown',id(500),1),/invalid_calculation_source/)
 assert.equal((await source('stair',id(500),2,both)).status,'ok')
 await result('select bob.physical_scope_command($1,$2,$3,$4,$5) result',['A','project','unlink',id(205),'{}'])
 assert.equal((await source('stair',id(500),2,both)).status,'not_found')
 assert.equal((await as(both,'select count(*)::int n from bob.current_artifacts where id=$1',[id(500)])).rows[0].n,1,'A revoked physical source hides geometry, not the project Artifact marker')
})
