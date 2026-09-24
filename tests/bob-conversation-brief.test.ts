import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkedBrief, readStoredBrief } from '../supabase/functions/_shared/bob-conversation-brief.ts'

test('legacy summaries survive while structured briefs retain ordered exact-history pointers',()=>{
  assert.deepEqual(readStoredBrief('Earlier width 174 cm, not verified.',12),{gist:'Earlier width 174 cm, not verified.',index:[]})
  const brief={gist:'The owner corrected the working width.',index:[{seq:8,descriptor:'Correction'},{seq:3,descriptor:'First proposal'}]}
  assert.deepEqual(readStoredBrief(JSON.stringify(brief),12).index.map(e=>e.seq),[3,8])
  assert.deepEqual(brief.index.map(e=>e.seq),[8,3])
})

test('future, repeated and oversized pointers cannot be persisted as valid conversation memory',()=>{
  for(const index of [[{seq:13,descriptor:'Future'}],[{seq:1,descriptor:'A'},{seq:1,descriptor:'Duplicate'}],[{seq:1,descriptor:'x'.repeat(201)}]]){
    assert.throws(()=>checkedBrief({gist:'Summary',index},12),/context_unavailable/)
  }
  assert.throws(()=>checkedBrief({gist:'x'.repeat(12001),index:[]},12),/context_unavailable/)
})
