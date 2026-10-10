import {test} from 'node:test'
import assert from 'node:assert/strict'
import {drawingResumeReply,createDeliveryLanguage,type DeliveryLexicon} from './support/colleague-catalog-fixture.ts'
import type {ProjectWriteReceipt} from '../src/data/provenance.ts'
import {BobContinuation} from '../supabase/functions/_shared/bob-job-journal.ts'
const usage={input_tokens:0,output_tokens:0,total_tokens:0}
const outcome={status:'needs_data',gaps:[{id:'depth',action:'owner_decision',detail:'Owner must choose depth.'},{id:'depth_again',action:'owner_decision',detail:'Same missing depth.'}]}
const lexicon:DeliveryLexicon={incomplete:'La demande reste inachevée.',drawing_unavailable:'Le service de dessin est indisponible.',drawing_prerequisite:'Le choix requis manque.',drawing_incomplete:'Le dessin n’est pas enregistré.',uncertain:'Certaines modifications ne sont pas vérifiées.',recovered:'Seules les modifications indiquées sont vérifiées.',chat_unsynced:'La conversation n’a pas été synchronisée.',missing_label:'Résultats manquants',saved_label:'Modifications enregistrées'}
const receipt:ProjectWriteReceipt={projectId:'p',dataset:'artifacts',recordId:'11111111-1111-4111-8111-111111111111',label:'Étagère',operation:'created',revision:3,areaId:null,savedAt:'2026-10-10T20:00:00Z'}
const languageReply=async()=>({success:true,data:JSON.stringify(lexicon),model:'fixture',usage})
const base={projectId:'p',message:'Draw a 60 by 80 cm shelf, reply in French.',userId:'u',outcome,hasAccess:async()=>true,callModel:languageReply}
test('P4 event status uses the prepared phrases; provider sees no outcome, gaps or receipt it could rewrite',async()=>{
 const answer=await drawingResumeReply({...base,outcome:{...outcome,retry_suppressed:true},callModel:async o=>{
  assert.equal(o.tools,undefined);assert.equal(o.aiFunction,'bob-delivery-language')
  assert.equal(o.functionName,'work-router');assert.equal(o.module,'global');assert.equal(o.outputTokenLimit,2000)
  assert.equal(o.schemaName,'bob_delivery_language')
  assert.deepEqual(JSON.parse(String(o.messages![0].content)),{current_request:base.message,conversation:null})
  return languageReply()
 }})
 assert.match(answer,/^Le dessin n’est pas enregistré\./)
 assert.match(answer,/Owner must choose depth\./);assert.match(answer,/Same missing depth\./)
 assert(!answer.includes(lexicon.saved_label))
})
test('a free saved answer and an outcome saved flag/user_message cannot override missing receipts',async()=>{
 const answer=await drawingResumeReply({...base,outcome:{status:'unavailable',reason:'render_failed',saved:true,user_message:'Ritningen är sparad.'},callModel:async()=>({success:true,data:'{"answer":"Ritningen är sparad."}',model:'fixture',usage})})
 assert.equal(answer,'⚠\nrender_failed');assert(!answer.includes('sparad'))
})
test('only the actual drawing receipt establishes delivery, including its exact revision',async()=>{
 const answer=await drawingResumeReply({...base,drawingReceipt:receipt,outcome:{status:'ready',saved:false}})
 assert.equal(answer,'Modifications enregistrées\n• Étagère · v3')
 assert(!answer.includes('inachevée'));assert(!answer.includes('enregistré.'))
 for(const invalid of [{...receipt,projectId:'other',label:'PRIVATE'}, {...receipt,revision:0}, {...receipt,dataset:'tasks'}, {...receipt,operation:'deleted'}, undefined]){
  const failed=await drawingResumeReply({...base,drawingReceipt:invalid,outcome:{status:'ready',saved:true}})
  assert(failed.startsWith(lexicon.drawing_incomplete));assert(!failed.includes('PRIVATE'));assert(!failed.includes(lexicon.saved_label))
 }
})
test('partial receipts are kept without treating a saved task/construction as a saved drawing',async()=>{
 const task:ProjectWriteReceipt={...receipt,dataset:'tasks',recordId:'task',label:'Choose joint',revision:undefined}
 const answer=await drawingResumeReply({...base,receipts:[task,receipt,{...task,projectId:'other',label:'PRIVATE'}],outcome:{status:'blocked',reason:'render_failed'}})
 assert(answer.startsWith(lexicon.drawing_unavailable));assert.match(answer,/• Choose joint/);assert.match(answer,/• Étagère · v3/)
 assert(!answer.includes('PRIVATE'));assert.match(answer,/render_failed/)
})
test('prepared phrases and budget stops require no language call, even after provider failure',async()=>{
 let calls=0
 const opts={...base,callModel:async()=>{calls++;throw new Error('Provider must not run')}}
 const format=createDeliveryLanguage(opts);format.seed(lexicon)
 assert.equal(await drawingResumeReply({...opts,formatNotice:format,drawingReceipt:receipt}),'Modifications enregistrées\n• Étagère · v3')
 const stopped={status:'blocked',reason:'turn_budget_exhausted',budget_stop:{calls:12}}
 assert((await drawingResumeReply({...opts,formatNotice:format,outcome:stopped})).startsWith(lexicon.drawing_unavailable))
 assert.equal(await drawingResumeReply({...opts,outcome:stopped}),'⚠\nturn_budget_exhausted')
 assert.equal(calls,0)
})
test('already saved requests and known CAD failures retain exact results without buying a status reply',async()=>{
 const opts={...base,callModel:async()=>{throw new Error('Status is already known')}}
 assert.equal(await drawingResumeReply({...opts,outcome:{status:'already_saved'},drawingReceipt:receipt}),'✓ Étagère · v3')
 assert.equal(await drawingResumeReply({...opts,outcome:{status:'blocked',stage:'cad_engine',reason:'render_failed',next_action:'Repair the renderer, retain the construction.'}}),'⚠\nrender_failed\nRepair the renderer, retain the construction.')
})
test('language failure keeps original gaps/cause, cannot ask for Bob decisions, and cannot swallow a pause or access loss',async()=>{
 const down={...base,callModel:async()=>({success:false,data:null,model:'fixture',usage})}
 assert.match(await drawingResumeReply(down),/Owner must choose depth/)
 assert(!((await drawingResumeReply({...down,outcome:{status:'needs_data',gaps:[{action:'bob_decision',detail:'Select a reversible joint.'}]}})).includes('?')))
 assert.match(await drawingResumeReply({...down,outcome:{status:'unavailable',reason:'review_sources_incomplete'}}),/review_sources_incomplete/)
 await assert.rejects(drawingResumeReply({...base,callModel:async()=>{throw new BobContinuation('yield')}}),BobContinuation)
 await assert.rejects(drawingResumeReply({...base,hasAccess:async()=>false}),/project_denied/)
 let accesses=0
 const format=createDeliveryLanguage(base);format.seed(lexicon)
 await assert.rejects(drawingResumeReply({...base,formatNotice:format,hasAccess:async()=>++accesses===1}),/project_denied/)
})
