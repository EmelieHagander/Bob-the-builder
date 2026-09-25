import test from 'node:test'
import assert from 'node:assert/strict'
import seed from '../supabase/functions/_shared/building-knowledge-seed.json' with {type:'json'}
import {createKnowledgeReader,searchKnowledge} from '../supabase/functions/_shared/building-knowledge.ts'
import {isBobAnswerEvidence} from '../src/data/bobEvidence.ts'
test('knowledge retrieval covers separate project scenarios with attributable notes',()=>{
 for(const [query,id] of [['våningssäng fukt','timber.moisture'],['veranda förband','timber.fasteners'],['husrenovering bärande','renovation.survey'],['hönshus','animals.hens'],['kaninhus','animals.rabbits'],['drawer clearance','workflow.fit']]){
  const result=searchKnowledge(query,'SE','2026-09-25');assert(result.some(c=>c.id===id),query)
  for(const c of result){assert(c.url.startsWith('https://'));assert.equal(c.rights,'original_summary_links_only');assert(c.edition);assert.equal(c.third_party_text_stored,false)}
 }
 assert.deepEqual(searchKnowledge('qqqqq','SE','2026-09-25'),[])
 assert.equal(searchKnowledge('electrical wiring','general','2026-09-25').length,0)
})
test('withdrawn, private, unreviewed and expired notes are unavailable',()=>{
 const c=seed.cards[0]
 for(const changed of [{status:'withdrawn'},{audience:'private'},{reviewed_at:'2026-10-01'},{review_due:'2026-09-24'},{rights:'unapproved'}]){
  assert.deepEqual(searchKnowledge('trä fukt','SE','2026-09-25',[{...c,...changed}]),[])
 }
})
test('reference evidence is separate from project records, bounded and access checked',async()=>{
 let allowed=true;const reader=createKnowledgeReader(async()=>allowed,()=>new Date('2026-09-25'))
 assert.equal((await reader.execute({query:'kaninhus',jurisdiction:'SE'})).status,'ok');assert.equal(reader.references[0].id,'animals.rabbits')
 assert(isBobAnswerEvidence({kind:'ai_assessment',partial:false,sources:[],references:reader.references},'A'))
 assert(!isBobAnswerEvidence({kind:'ai_assessment',partial:false,sources:[],references:[{...reader.references[0],url:'javascript:alert(1)'}]},'A'))
 allowed=false;assert.equal((await reader.execute({query:'hönshus',jurisdiction:'SE'})).status,'denied')
 assert.equal(reader.references.length,1)
})
