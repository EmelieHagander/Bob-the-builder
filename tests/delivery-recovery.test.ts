import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createBobJournal,fingerprint,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'

test('moving localisation to its own stream reuses an exact recorded phrasebook without another model call',async()=>{
 const input={schemaName:'bob_delivery_language',catalogSchemaKey:'bob_delivery_language',messages:[{role:'user',content:'Original request'}]}
 const response={success:true,data:{drawing_incomplete:'Not saved'},usage:{total_tokens:10}}
 const entries:JournalEntry[]=[{key:'model:work-router:3',fingerprint:await fingerprint(input),value:{ok:true,result:response}}]
 const journal=createBobJournal({entries,save:async e=>{entries.push(e)}},Infinity)
 let calls=0
 const result=await journal.run('model:delivery-language-v1',input,async()=>{calls++;throw new Error('Must use the prepared phrases')})
 assert.deepEqual(result,response);assert.equal(calls,0);assert.equal(journal.reusedModelCalls(),1)
 const replay=createBobJournal({entries,save:async e=>{entries.push(e)}},Infinity)
 assert.deepEqual(await replay.run('model:delivery-language-v1',input,async()=>{throw new Error('No second dispatch')}),response)
 assert.equal(entries.length,2)
})

test('an old free saved answer or changed language request cannot be reused as the new phrasebook',async()=>{
 for(const schema of ['drawing_resume_reply','bob_delivery_language']){
  const old={schemaName:schema,messages:[{role:'user',content:'Original request'}]}
  const input={schemaName:'bob_delivery_language',messages:[{role:'user',content:schema==='bob_delivery_language'?'Reply in French':'Original request'}]}
  const entries:JournalEntry[]=[{key:'model:work-router:0',fingerprint:await fingerprint(old),value:{ok:true,result:{success:true,data:'{"answer":"Ritningen är sparad."}'}}}]
  const journal=createBobJournal({entries,save:async e=>{entries.push(e)}},Infinity)
  let calls=0
  const result=await journal.run('model:delivery-language-v1',input,async()=>{calls++;return 'new phrases'})
  assert.equal(result,'new phrases');assert.equal(calls,1);assert.equal(journal.reusedModelCalls(),0)
  assert.deepEqual(await journal.run('model:work-router',old,async()=>{throw new Error('The historical slot must remain intact')}),{success:true,data:'{"answer":"Ritningen är sparad."}'})
 }
})
