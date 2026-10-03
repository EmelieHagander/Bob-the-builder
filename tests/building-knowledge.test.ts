import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import seed from '../supabase/functions/_shared/building-knowledge-seed.json' with {type:'json'}
import {createKnowledgeReader,searchKnowledge} from '../supabase/functions/_shared/building-knowledge.ts'
import {isBobAnswerEvidence} from '../src/data/bobEvidence.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {runClaimedProjectTurn} from '../supabase/functions/_shared/project-turn.ts'

// The original seed hashes sorted UTF-8 JSON with a space after each separator,
// excluding only content_sha256. Keep that register contract as fields evolve.
function hashJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(hashJson).join(', ')+']'
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+': '+hashJson(v)).join(', ')+'}'
 return JSON.stringify(value)
}
test('every curated package has complete scope, questions, checks, limitations and an intact versioned hash',()=>{
 assert.equal(new Set(seed.cards.map(c=>c.id)).size,seed.cards.length)
 for(const c of seed.cards){
  assert.match(c.version,/^2026-\d{2}-\d{2}\.\d+$/)
  assert.equal(c.reviewed_at,c.id==='timber.adhesives'?'2026-10-02':'2026-09-25','package metadata changes do not pretend to re-review a source')
  assert(c.review_due>=c.reviewed_at)
  for(const key of ['applicability','required_questions','checks','limitations'] as const){
   assert(c[key].length>0,c.id+' '+key)
   assert(c[key].every(text=>typeof text==='string'&&text.trim().length>0),c.id+' '+key)
  }
  const {content_sha256,...content}=c
  assert.equal(createHash('sha256').update(hashJson(content),'utf8').digest('hex'),content_sha256,c.id)
 }
})
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
 assert(searchKnowledge('trä fukt','SE',c.review_due,[c]).length>0,'review due day remains included')
 assert.equal(searchKnowledge('trä fukt','SE','2027-03-26',[c]).length,0)
 assert.equal(searchKnowledge('kanin höns el','general','2026-09-25').length,0,'SE guidance cannot be retrieved as general guidance')
 assert(searchKnowledge('drawer clearance','general','2026-09-25').some(c=>c.id==='workflow.fit'))
})
test('reference evidence is separate from project records, bounded and access checked',async()=>{
 let allowed=true;const reader=createKnowledgeReader(async()=>allowed,()=>new Date('2026-09-25'))
 assert.equal((await reader.execute({query:'kaninhus',jurisdiction:'SE'})).status,'ok');assert.equal(reader.references[0].id,'animals.rabbits')
 assert(isBobAnswerEvidence({kind:'ai_assessment',partial:false,sources:[],references:reader.references},'A'))
 assert(!isBobAnswerEvidence({kind:'ai_assessment',partial:false,sources:[],references:[{...reader.references[0],url:'javascript:alert(1)'}]},'A'))
 allowed=false;assert.equal((await reader.execute({query:'hönshus',jurisdiction:'SE'})).status,'denied')
 assert.equal(reader.references.length,1)
})
test('real Bob tool loop delivers package metadata and preserves references separately from project truth',async()=>{
 const knowledgeReader=createKnowledgeReader(async()=>true,()=>new Date('2026-09-30'))
 const lookup=createProjectLookup('A',async()=>({data:{records:[{id:'A',name:'Fixture project'}],related:[],truncated:false},error:null}),1000,12)
 let calls=0,committed:any
 const answer=await runClaimedProjectTurn({projectId:'A',userId:'fixture-user',message:'Kontrollera lådans rörelse',lookup,knowledgeReader,
  hasAccess:async()=>true,fail:async()=>{},commit:async r=>{committed=r},callModel:async options=>{
   calls++
   assert(options.tools?.some(t=>t.function.name==='search_building_knowledge'))
   if(calls===1)return {success:true,data:null,model:'fixture',responseId:'package-search',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
    toolCalls:[{id:'knowledge-call',type:'function',function:{name:'search_building_knowledge',arguments:JSON.stringify({query:'drawer clearance',jurisdiction:'general'})}}]}
   const result=JSON.parse(String(options.messages!.find(m=>m.role==='tool'&&m.tool_call_id==='knowledge-call')!.content))
   assert.equal(result.status,'ok');assert.equal(result.corpus_version,seed.version)
   const card=result.records.find((c:any)=>c.id==='workflow.fit')
   for(const key of ['applicability','required_questions','checks','limitations'] as const)assert.deepEqual(card[key],seed.cards.find(c=>c.id===card.id)![key])
   assert.equal(options.previousResponseId,'package-search')
   return {success:true,data:'Rörelsen behöver kontrolleras mot projektets underlag.',model:'fixture',responseId:'package-answer',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
  }})
 assert(answer.ok);assert.equal(calls,2)
 assert(answer.evidence.references?.some(r=>r.id==='workflow.fit'&&r.version===seed.cards.find(c=>c.id==='workflow.fit')!.version))
 assert(!answer.evidence.sources.some(s=>s.recordId==='workflow.fit'),'general package must never become a project record')
 assert.deepEqual(committed.evidence,answer.evidence)
})
