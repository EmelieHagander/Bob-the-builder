import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {DESIGN_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'

const root=new URL('../supabase/migrations/',import.meta.url)
const publication=readdirSync(root).find(name=>name.endsWith('_ai_drawing_intent_catalog.sql'))!
const sql=readFileSync(new URL(publication,root),'utf8')
const patches=JSON.parse(sql.match(/\$drawing_intent_texts\$([\s\S]+?)\$drawing_intent_texts\$/)![1])
const changed=new Set([...patches.map((p:any)=>p.key),'tools.design_project_cad'])

test('current-task guidance replaces forced resume atomically without changing pinned work or model settings',async t=>{
 let prior:any,settings:any
 const pg=await projectSchema(async(db,name)=>{
  if(name!==publication)return
  prior=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  settings=(await db.query('select * from shared.ai_settings order by app,function_name')).rows
 },publication)
 t.after(()=>pg.close())
 const current=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 assert.match(prior.definitions.find((d:any)=>d.prompt_key==='bob.frame.outstanding').content,/at once/,'reproduce the broad old resume instruction')
 assert.notEqual(current.manifest_id,prior.manifest_id)
 assert.deepEqual((await pg.query<any>('select shared.resolve_ai_catalog($1,$2) result',['bob',prior.manifest_id])).rows[0].result,prior)
 assert.deepEqual(current.models,prior.models)
 assert.deepEqual((await pg.query('select * from shared.ai_settings order by app,function_name')).rows,settings)
 assert.equal(current.definitions.length,prior.definitions.length)
 for(const old of prior.definitions){
  const next=current.definitions.find((d:any)=>d.prompt_key===old.prompt_key)
  if(!changed.has(old.prompt_key)){assert.deepEqual(next,old,old.prompt_key);continue}
  assert.equal(next.version,old.version+1)
  assert.equal(next.metadata.publication,'current-owner-deliverable')
  if(old.prompt_key==='tools.design_project_cad'){
   const expected=structuredClone(old.definition)
   expected.parameters.properties.request_id.description=DESIGN_CAD_TOOL.function.parameters.properties.request_id.description
   assert.deepEqual(next.definition,expected,'only the request guidance changes; tool authority and schema shape stay intact')
  }else{
   assert.equal(next.content,patches.find((p:any)=>p.key===old.prompt_key).content)
   assert.deepEqual(next.definition,old.definition)
   assert.deepEqual(next.available_variables,old.available_variables)
  }
 }
})

test('all current resume hints respect text-only work and still allow requested drawings without another approval',()=>{
 const catalog=catalogFixture()
 for(const patch of patches){
  const hint=catalog.text(patch.key)
  assert.match(hint,/current|requested deliverable|next task/i,patch.key)
  assert.match(hint,/text|description|requested deliverable/i,patch.key)
  assert.doesNotMatch(hint,/at once|call this immediately|do not read requests or sources first/i,patch.key)
 }
 const tool=catalog.tool('design_project_cad').function
 assert.deepEqual(tool.parameters,DESIGN_CAD_TOOL.function.parameters)
 const guidance=(tool.parameters.properties.request_id as {description:string}).description
 assert.match(guidance,/text-only request/)
 assert.match(guidance,/When a drawing is requested, reuse this ID/)
 assert.match(guidance,/no extra confirmation/)
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-drawing-intent-catalog.ts','supabase/migrations/'+publication,'--check'],{encoding:'utf8'}),/Verified current-owner-deliverable publication/)
})
