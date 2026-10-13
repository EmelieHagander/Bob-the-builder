import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {INTAKE_SCHEMA} from '../supabase/functions/_shared/cad-intake.ts'
import {CAD_RESEARCH_OUTPUT_CEILING,cadResearchOutputLimit} from '../supabase/functions/_shared/cad-research.ts'
import {catalogFixture,legacyCatalogFixture} from './support/ai-catalog-fixture.ts'
import {projectSchema} from './support/project-schema.ts'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'

test('intake recovery publishes compatible schemas and answer limits without replacing unrelated active catalog fields',()=>{
 const root=new URL('../supabase/migrations/',import.meta.url)
 const name=readdirSync(root).find(n=>n.endsWith('_cad_intake_execution_recovery.sql'))!
 assert(name)
 const source=readFileSync(new URL(name,root),'utf8')
 const patches=JSON.parse(source.match(/\$cad_intake_recovery\$([\s\S]+?)\$cad_intake_recovery\$/)![1])
 assert.equal(patches.length,6)
 assert.deepEqual(patches.find(p=>p.key==='tools.finish_cad_research').parameters,INTAKE_SCHEMA)
 assert.deepEqual(patches.find(p=>p.key==='schema.intake').schema,INTAKE_SCHEMA)
 assert.equal(patches.find(p=>p.key==='profile.cad-research').minimum_output_tokens,CAD_RESEARCH_OUTPUT_CEILING)
 assert.match(source,/pg_advisory_xact_lock/);assert.match(source,/shared\.activate_ai_catalog/)
 assert.match(source,/current_version\.metadata,next_content,definition,current_version\.flow,current_version\.available_variables/)
 assert(!/update shared\.ai_prompt_versions/i.test(source),'pinned versions remain immutable')
 const current=catalogFixture(),legacy=legacyCatalogFixture()
 assert(current.tool('finish_cad_research').function.parameters.required.includes('execution_issues'))
 assert(!legacy.tool('finish_cad_research').function.parameters.required.includes('execution_issues'))
 assert.equal(legacy.role('cad-research').maxOutputTokens,3000)
 assert(current.role('cad-research').maxOutputTokens>=cadResearchOutputLimit(24))
})
test('intake publication changes only six active definitions, preserves pinned history and rolls back a missing contract',async t=>{
 const root=new URL('../supabase/migrations/',import.meta.url)
 const name=readdirSync(root).find(n=>n.endsWith('_cad_intake_execution_recovery.sql'))!
 const sql=readFileSync(new URL(name,root),'utf8')
 const patches=JSON.parse(sql.match(/\$cad_intake_recovery\$([\s\S]+?)\$cad_intake_recovery\$/)![1])
 let previous!:AiCatalogManifest,published:AiCatalogManifest|undefined
 const pg=await projectSchema(async(db,migration)=>{
  if(migration===name)previous=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  if(previous&&migration>name&&!published)published=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 })
 t.after(()=>pg.close())
 const resolve=async(id:string|null=null)=>(await pg.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) result",[id])).rows[0].result
 const latest=await resolve(),current=published??latest
 assert.deepEqual(current.models,previous.models);assert.deepEqual(await resolve(previous.manifest_id),previous)
 for(const old of previous.definitions){
  const next=current.definitions.find(row=>row.prompt_key===old.prompt_key)!
  const patch=patches.find(p=>p.key===old.prompt_key)
  if(!patch){assert.deepEqual(next,old);continue}
  assert.equal(next.version,old.version+1);assert.deepEqual(next.metadata,old.metadata);assert.deepEqual(next.available_variables,old.available_variables)
  if(patch.append)assert.equal(next.content,old.content+'\n\n'+patch.append)
  else assert.equal(next.content,old.content)
  if(patch.parameters)assert.deepEqual(next.definition,{...old.definition,parameters:INTAKE_SCHEMA,required_parameters:INTAKE_SCHEMA.required,optional_parameters:[]})
  if(patch.schema)assert.deepEqual(next.definition,INTAKE_SCHEMA)
  if(patch.minimum_output_tokens)assert.deepEqual(next.definition,{...old.definition,max_output_tokens:Math.max(Number(old.definition.max_output_tokens),CAD_RESEARCH_OUTPUT_CEILING)})
 }
 const session=createAiCatalogSession({rpc:async()=>{throw Error('pinned only')}},{app:'bob',manifest:current})
 assert.deepEqual(session.tool('finish_cad_research').function.parameters,INTAKE_SCHEMA)
 assert(session.role('cad-research').maxOutputTokens>=cadResearchOutputLimit(24))
 const snapshot=async()=>(await pg.query("select prompt_key,active_version_id from shared.ai_prompts where app='bob' order by prompt_key")).rows
 const before=await snapshot()
 await assert.rejects(pg.transaction(tx=>tx.exec(sql.replace('"schema.intake"','"schema.missing_intake"').replace(/^begin;$/m,'').replace(/^commit;$/m,''))),/cad_intake_contract_missing/)
 assert.deepEqual(await snapshot(),before);assert.deepEqual(await resolve(),latest)
})
