import {test} from 'node:test'
import assert from 'node:assert/strict'
import {helperConversation} from '../supabase/functions/_shared/bob-helper-context.ts'
import {pickTurnTools,runProjectAnswer} from '../supabase/functions/_shared/project-answer.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const context:any={summary:'',recent:[{seq:7,role:'user',text:'I meant the front windows.',state:'pending'}],stair:{snapshot:{},snapshotLockedAt:'2026-11-05T10:00:00Z',summaries:[{id:'summary',level:2,seqFrom:1,seqTo:3,text:'Owner delegated the framing and roof concept; remeasure at build start.'}],raw:[{seq:4,role:'user',text:'Use the saved sizes for now and keep going.',state:'completed'},{seq:5,role:'assistant',text:'Next I will draw the frame.',state:'completed'},{seq:6,role:'user',text:'117 is the preliminary height.',state:'completed'}],events:[]},history:{remaining:Infinity,search:async()=>({status:'empty'})}}
test('stair history and delegated work reach both picker and completion helper; legacy calls remain unchanged',async()=>{
 assert.equal(helperConversation(context,false).memory_summary,'');assert.equal(helperConversation(context,false).recent_conversation.length,1)
 const c=helperConversation(context,true);assert.equal(c.recent_conversation.length,4);assert(JSON.stringify(c).includes('remeasure at build start'))
 let sawPicker=false,sawGate=false,main=0;const aiCatalog=catalogFixture()
 await pickTurnTools({aiCatalog,context,continuedWork:true,message:context.recent[0].text,callModel:async o=>{const input=JSON.parse(String(o.messages![0].content));assert(input.recent_conversation.some((m:any)=>m.seq===4));assert(input.memory_summary[0].text.includes('delegated'));sawPicker=true;return {success:true,model:'fixture',usage,data:{tools:[]}}}} as any,[],[],Infinity)
 const result=await runProjectAnswer({aiCatalog,context,continuedWork:true,unlimitedWork:true,projectId:'A',userId:'u',message:context.recent[0].text,hasAccess:async()=>true,deadline:Infinity,
  writer:createProjectWriter('A',context.recent[0].text,async()=>assert.fail('no real write'),async()=>({data:[],error:null})),
  lookup:createProjectLookup('A',async()=>({data:{records:[{id:'A',name:'Fixture'}],related:[],truncated:false},error:null}),1000,1000),
  callModel:async o=>{if(o.functionName==='completion-gate'){const input=JSON.parse(String(o.messages![0].content));assert(input.recent_conversation.some((m:any)=>m.seq===5));assert(Array.isArray(input.available_capabilities));sawGate=true;return {success:true,model:'fixture',usage,data:{work_remaining:true,reason:'The delegated next action is still possible.'}} as any}main++;return {success:true,model:'fixture',usage,responseId:'r'+main,data:main===1?'I will draw it next.':'I have reported the remaining work accurately.',outputPhase:'final_answer'} as any}})
 assert(result.ok);assert(sawPicker&&sawGate);assert.equal(main,2)
})
