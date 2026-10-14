import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {DESIGN_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {historicalTaskResumeDescription} from '../scripts/catalog-publication-history.ts'

const publication='20261012090928_ai_task_budget_catalog.sql'
test('task guidance publishes four immutable versions, preserving models, settings and older pinned manifests',async t=>{
 let prior:any,settings:any
 const pg=await projectSchema(async(db,name)=>{
  if(name!==publication)return
  prior=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  settings=(await db.query('select * from shared.ai_settings order by app,function_name')).rows
 },publication);t.after(()=>pg.close())
 const current=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 assert.notEqual(current.manifest_id,prior.manifest_id);assert.deepEqual(current.models,prior.models)
 assert.deepEqual((await pg.query('select * from shared.ai_settings order by app,function_name')).rows,settings)
 assert.deepEqual((await pg.query<any>('select shared.resolve_ai_catalog($1,$2) result',['bob',prior.manifest_id])).rows[0].result,prior)
 const changed=new Set(['bob.frame.outstanding','feedback.bob-budget-stop.resume.eefd1193bc73','feedback.bob-budget-stop.resume.51aac0199a6c','tools.design_project_cad'])
 assert.equal(current.definitions.length,prior.definitions.length)
 for(const old of prior.definitions){
  const next=current.definitions.find((r:any)=>r.prompt_key===old.prompt_key)
  if(changed.has(old.prompt_key)){assert.equal(next.version,old.version+1);assert.equal(next.metadata.publication,'owner-task-budget')}
  else assert.deepEqual(next,old,old.prompt_key)
 }
 const actual=current.definitions.find((r:any)=>r.prompt_key==='tools.design_project_cad').definition
 const old=prior.definitions.find((r:any)=>r.prompt_key==='tools.design_project_cad').definition
 const expected=structuredClone(old)
 expected.parameters.properties.request_id.description=historicalTaskResumeDescription
 expected.additional_description=actual.additional_description
 assert.deepEqual(actual,expected,'only the budget guidance fields change')
 assert.match(actual.additional_description,/fresh \$3 \/ 24-call CAD period/)
 const executable=structuredClone(old.parameters)
 executable.properties.request_id.description=historicalTaskResumeDescription
 assert.deepEqual(executable,actual.parameters)
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-task-budget-catalog.ts','supabase/migrations/'+publication,'--check'],{encoding:'utf8'}),/Verified task budget catalog/)
})

test('integrated resume publishes only two new versions and keeps ledger details out of the model',async t=>{
 let prior:any,settings:any
 const integrated='20261013131820_ai_task_resume_catalog.sql'
 const pg=await projectSchema(async(db,name)=>{
  if(name!==integrated)return
  prior=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  settings=(await db.query('select * from shared.ai_settings order by app,function_name')).rows
 },integrated);t.after(()=>pg.close())
 const current=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 assert.notEqual(current.manifest_id,prior.manifest_id);assert.deepEqual(current.models,prior.models)
 assert.deepEqual((await pg.query('select * from shared.ai_settings order by app,function_name')).rows,settings)
 assert.deepEqual((await pg.query<any>('select shared.resolve_ai_catalog($1,$2) result',['bob',prior.manifest_id])).rows[0].result,prior)
 const changed=new Set(['tools.design_project_cad','feedback.bob-budget-stop.resume.9c3a74e182d5'])
 assert.equal(current.definitions.length,prior.definitions.length)
 for(const old of prior.definitions){
  const next=current.definitions.find((r:any)=>r.prompt_key===old.prompt_key)
  if(changed.has(old.prompt_key)){assert.equal(next.version,old.version+1);assert.equal(next.metadata.publication,'guarded-task-resume')}
  else assert.deepEqual(next,old,old.prompt_key)
 }
 const actual=current.definitions.find((r:any)=>r.prompt_key==='tools.design_project_cad').definition
 const old=prior.definitions.find((r:any)=>r.prompt_key==='tools.design_project_cad').definition
 assert.match(old.additional_description,/fresh \$3 \/ 24-call CAD period/)
 assert.deepEqual({...actual,additional_description:old.additional_description},old)
 assert.doesNotMatch(actual.additional_description,/budget|\$3|24-call/i)
 assert.doesNotMatch(actual.parameters.properties.request_id.description,/budget|allocation|\$/i)
 const resume=current.definitions.find((r:any)=>r.prompt_key==='feedback.bob-budget-stop.resume.9c3a74e182d5').content
 assert.match(resume,/new owner message/);assert.match(resume,/Automatic continuations/)
 assert.doesNotMatch(resume,/budget|allocation|\$/i)
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-task-resume-catalog.ts','supabase/migrations/'+integrated,'--check'],{encoding:'utf8'}),/Verified integrated task-resume publication/)
})
