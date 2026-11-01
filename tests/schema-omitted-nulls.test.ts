import {test} from 'node:test'
import assert from 'node:assert/strict'
import {schemaIssues,withOmittedNulls} from '../supabase/functions/_shared/schema-issues.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

const read=(catalogFixture().definition('tools.read_construction_draft').definition as any).parameters
// Live 2026-11-01 (job 44d38cc3): Konrad's first read had no result_id key at all.
const live={artifact_id:null,revision:null,after:null,view:'work',work_kind:'parts',ids:[],step_id:null,section:null}

test('a left-out nullable field is read as null instead of refusing the call',()=>{
 assert.ok(read.required.includes('result_id'))
 assert.deepEqual(schemaIssues(read,live).map(i=>i.path),['$.result_id'])
 assert.deepEqual(schemaIssues(read,withOmittedNulls(read,live)),[])
 assert.equal((withOmittedNulls(read,live) as any).result_id,null)
})

test('only nullable fields are filled; present values are still checked',()=>{
 const {view:_v,...noView}=live
 assert.deepEqual(schemaIssues(read,withOmittedNulls(read,noView)).map(i=>i.path),['$.view'])
 assert.deepEqual(schemaIssues(read,withOmittedNulls(read,{...live,result_id:'cs_short'})).map(i=>i.path),['$.result_id'])
 assert.equal(withOmittedNulls(read,null),null)
 assert.deepEqual(withOmittedNulls(read,[1]),[1])
})
