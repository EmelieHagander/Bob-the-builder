import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {projectSchema} from './support/project-schema.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {auditFollowupEdits} from '../scripts/build-bob-audit-followup-catalog.ts'
import {countContextTokens} from '../supabase/functions/_shared/bob-token-budget.ts'

test('audit publication changes only reviewed keys, preserves old versions, matches the fixture and replays idempotently',async t=>{
 const migration='20261106111110_bob_audit_followup_catalog.sql';let prior:any[]=[]
 const read=async(pg:any)=>(await pg.query('select p.prompt_key,v.* from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app=\'bob\' order by p.prompt_key')).rows
 const pg=await projectSchema(async(db,name)=>{if(name===migration)prior=await read(db)},migration);t.after(()=>pg.close())
 const current=await read(pg),keys=auditFollowupEdits.map(e=>e.key).sort()
 assert.deepEqual(current.filter((r:any)=>r.id!==prior.find(p=>p.prompt_key===r.prompt_key)?.id).map((r:any)=>r.prompt_key).sort(),keys)
 const fixture=catalogFixture()
 for(const key of keys){
  const actual=current.find((r:any)=>r.prompt_key===key),expected=fixture.definition(key),old=prior.find(p=>p.prompt_key===key)
  const edit:any=auditFollowupEdits.find(e=>e.key===key),definition=structuredClone(old.definition)
  for(const patch of edit.patches??[]){
   const parent=patch.path.slice(0,-1).reduce((o:any,k:string)=>o[k],definition);parent[patch.path.at(-1)]=patch.after
   assert.deepEqual(patch.path.reduce((o:any,k:string)=>o[k],expected.definition),patch.after)
  }
  assert.deepEqual(actual.definition,definition,key);assert.equal(actual.content,expected.content,key)
  const {seed_version:_s,source_revision:_r,...metadata}=old.metadata
  assert.deepEqual(actual.metadata,{...metadata,...edit.metadata,publication:'bob-audit-followup-v1'})
  for(const [name,value] of Object.entries(edit.metadata??{}))assert.deepEqual(expected.metadata[name],value)
  assert.equal(actual.version,old.version+1)
  const stored=(await pg.query('select * from shared.ai_prompt_versions where id=$1',[old.id])).rows[0]
  const {prompt_key:_,...version}=old;assert.deepEqual(stored,version)
 }
 assert(countContextTokens(fixture.role('ask-bob').systemMessage)<=700,'retain the existing startup size contract')
 await pg.exec(readFileSync('supabase/migrations/'+migration,'utf8'));assert.deepEqual(await read(pg),current)
})
