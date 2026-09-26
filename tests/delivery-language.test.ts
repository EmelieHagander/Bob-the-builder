import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createDeliveryLanguage,DELIVERY_MEANINGS,parseDeliveryLanguage,type DeliveryLexicon} from '../supabase/functions/_shared/delivery-language.ts'
import {runClaimedProjectTurn} from '../supabase/functions/_shared/project-turn.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createProjectWriter,type WriteReadback} from '../supabase/functions/_shared/project-write.ts'
const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const response=(data:any)=>({success:true,data,model:'fixture',responseId:'response',usage})
const lexicon:DeliveryLexicon={incomplete:'La demande reste inachevée.',drawing_unavailable:'Le service de dessin est indisponible.',drawing_prerequisite:'Le choix requis manque.',drawing_incomplete:'Le dessin n’est pas enregistré.',uncertain:'Certaines modifications ne sont pas vérifiées. Ne les répétez pas.',recovered:'Seules les modifications indiquées sont vérifiées. Elles n’ont pas été répétées.',chat_unsynced:'Les modifications sont enregistrées mais la conversation n’a pas été synchronisée. Ne les répétez pas.',missing_label:'Résultats manquants',saved_label:'Modifications enregistrées'}
const receipt={projectId:'A',dataset:'tasks',recordId:'task',label:'Étagère',operation:'created',savedAt:'2026-09-25T00:00:00Z',record:{id:'task'}} as WriteReadback
test('localisation uses conversational language intent, preserves exact receipts and caches all failure notices',async()=>{
 let calls=0
 const format=createDeliveryLanguage({userId:'u',message:'Fortsätt, men svara på franska.',hasAccess:async()=>true,callModel:async o=>{
  calls++;assert(String(o.messages![0].content).includes('franska'));assert.equal(o.tools,undefined);assert.equal(o.previousResponseId,undefined);return response(lexicon)
 }})
 const answer=await format({notice:'incomplete',missing:['Une vue de dessus'],receipts:[receipt]})
 assert.match(answer,/demande reste inachevée/);assert.match(answer,/• Étagère/)
 assert.equal(format.fallback({notice:'chat_unsynced'}),lexicon.chat_unsynced)
 assert.match(await format({notice:'uncertain',receipts:[receipt]}),/Ne les répétez pas/);assert.equal(calls,1)
})
test('invalid/localisation-down responses cannot reuse a false completion or insert a fixed language',async()=>{
 const format=createDeliveryLanguage({userId:'u',message:'続けて',hasAccess:async()=>true,callModel:async()=>response({notice:'Done!'})})
 const answer=await format({notice:'uncertain',receipts:[{...receipt,label:'棚'}]})
 assert.equal(answer,'⚠\n✓ 棚');assert.equal(parseDeliveryLanguage({ ...lexicon, completed:'invented' }),null)
})
test('language is prepared in ordinary routing and remains available after a failed transcript commit, without another model call',async()=>{
 let executionCalls=0,languageCalls=0
 const message='Enregistre cette tâche.',receipts:WriteReadback[]=[]
 const writer=createProjectWriter('A',message,async()=>{receipts.push(receipt);return {data:receipt,error:null}},async()=>({data:receipts,error:null}),async()=>({data:{generation:2,receipts},error:null}))
 const result=await runClaimedProjectTurn({projectId:'A',userId:'u',message,writer,generation:1,hasAccess:async()=>true,
  lookup:createProjectLookup('A',async()=>({data:{records:[{id:'A'}],related:[],truncated:false},error:null})),
  callModel:async o=>{
   if(o.schemaName==='bob_work_delivery')return response({goals:[{kind:'task',description:'La tâche',count:1,record_id:null}],request_quote:message,delivery_language:lexicon})
   if(o.schemaName==='bob_delivery_language'){languageCalls++;throw new Error('No late provider call allowed')}
   if(++executionCalls===1)return {...response(null),toolCalls:[{id:'write',type:'function',function:{name:'save_project_task',arguments:JSON.stringify({record_id:null,area_id:'area',step_id:null,name:'Étagère',instructions:'Mesurer',expected_updated_at:null,request_quote:message})}}]}
   return response('La tâche est enregistrée.')
  },fail:async()=>{},commit:async()=>{throw new Error('transport')}})
 assert(result.ok);assert.match(result.answer,/conversation n’a pas été synchronisée/);assert.equal(languageCalls,0);assert.equal(receipts.length,1);assert(result.evidence.partial)
})
test('server message meanings cover all terminal states without a language table',()=>{
 assert.equal(Object.keys(DELIVERY_MEANINGS).length,7)
 assert(parseDeliveryLanguage(lexicon))
})
