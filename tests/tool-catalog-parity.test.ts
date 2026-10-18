import {test} from 'node:test'
import assert from 'node:assert/strict'
import {projectSchema} from './support/project-schema.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import type {AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import type {ToolPolicy} from '../supabase/functions/_shared/project-tools/session.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with {type:'json'}
const publication='20261017050720_ai_task_workflow_catalog.sql'
const revisedNames=['change_task_readiness','create_work_record','edit_work_record']
const policySql='select name,description,how_to,schema_version,always_load,preload_phases,active from bob.tool_catalog order by name'
const sorted=(rows:ToolPolicy[])=>[...rows].sort((a,b)=>a.name.localeCompare(b.name))

test('historical policy keeps seed parity and current policy matches only the three published contract upgrades',async()=>{
 let historical:ToolPolicy[]|undefined
 const pg=await projectSchema(async(db,name)=>{
  if(name===publication)historical=(await db.query<ToolPolicy>(policySql)).rows
 },'20261017102000_bob_continuation_catalog.sql')
 try{
  assert(historical,'the pre-publication policy boundary was inspected')
  const fixturePolicies=catalogFixture().definition('bob.tools','tool_contract').definition.catalog as ToolPolicy[]
  // Exact-message reading is added by the later context publication, after this test's boundary.
  const exactRead=fixturePolicies.find(policy=>policy.name==='read_conversation_message')
  assert(exactRead,'the current catalog publishes exact private-message reading')
  assert.deepEqual(seed.filter(policy=>policy.name==='read_conversation_message'),[exactRead],'the later seed addition exactly matches its current published policy')
  assert.deepEqual(historical,sorted(seed.filter(policy=>!['read_conversation_message','read_project_orientation'].includes(policy.name))),'all policies present at the historical boundary retain exact seed parity')
  const {rows}=await pg.query<ToolPolicy>(policySql)
  const manifest=(await pg.query<{manifest:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest
  const currentPolicies=manifest.definitions.find(d=>d.prompt_key==='bob.tools')!.definition.catalog as ToolPolicy[]
  const upgraded=new Map<string,ToolPolicy>()
  for(const name of revisedNames){
   const published=currentPolicies.find(policy=>policy.name===name)
   assert(published,name+' has a pinned published policy')
   assert.deepEqual(fixturePolicies.find(policy=>policy.name===name),published,'the current offline fixture materializes '+name)
   const old=historical.find(policy=>policy.name===name)!
   assert.equal(old.schema_version,1);assert.equal(published.schema_version,2)
   assert.notEqual(published.how_to,old.how_to)
   assert.deepEqual(published,{...old,schema_version:2,how_to:published.how_to},name+' preserves every policy field other than its explicit schema/manual upgrade')
   upgraded.set(name,published)
  }
  const expected=historical.map(policy=>upgraded.get(policy.name)??policy)
  assert.deepEqual(rows,expected,'all current rows, including inactive tools and phase preloads, must match the published policy')
  assert.deepEqual(rows.filter((policy,i)=>JSON.stringify(policy)!==JSON.stringify(historical![i])).map(policy=>policy.name),revisedNames,'exactly three policies change')
 }finally{await pg.close()}
})
