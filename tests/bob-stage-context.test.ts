import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createBobContextContinuation} from '../supabase/functions/_shared/bob-context-continuation.ts'
import {bobStageContextVersion,prepareStageContext,stageImageRef,STAGE_CONTEXT_SPEC,STAGE_CONTEXT_TOOL} from '../supabase/functions/_shared/bob-stage-context.ts'
import {anthropicRequestBody} from '../supabase/functions/_shared/anthropic-service.ts'
import {fingerprint,stableJsonValue} from '../supabase/functions/_shared/bob-job-journal.ts'
import type {AiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'
import type {OpenAIServiceOptions,OpenAIServiceResponse} from '../supabase/functions/_shared/openai-service.ts'
const image=(id:string)=>({type:'image_url' as const,image_url:'private-image:'+id+'/version'})
const imageSource=(url:string)=>url.startsWith('private-image:')?url.slice(14,-8):undefined
const seed:OpenAIServiceOptions={app:'bob',functionName:'ask-bob',catalogRoleKey:'ask-bob',module:'global',coworkerId:'bob',responseItemsMode:'preserve',
 messages:[{role:'user',content:'Review the current proposal. 117 cm is preliminary; measurements are deferred. No owner decision yet.'},{role:'user',content:[image('concept:A')]}]}
const spec=(name:string)=>name===STAGE_CONTEXT_TOOL?STAGE_CONTEXT_SPEC:{type:'function' as const,function:{name,description:name,parameters:{type:'object'}}}
const catalog={definition:()=>({metadata:{continuation_input_tokens:64000,context_input_ceiling_tokens:96000,continuation_summary_tokens:1600,retained_tool_exchanges:2}}),
 role:()=>({providerAdapter:'anthropic-messages-v1',systemMessage:'Coordinate the build.'}),tool:spec} as unknown as AiCatalogSession
const call=(id:string,name:string,args:unknown)=>({id,type:'function' as const,function:{name,arguments:JSON.stringify(args)}})
const reply=(id:string,calls:ReturnType<typeof call>[]=[]):OpenAIServiceResponse=>({success:true,responseId:id,model:'fixture',data:'',usage:{input_tokens:100,output_tokens:10,total_tokens:110},toolCalls:calls,
 outputItems:calls.length?calls.map(c=>({type:'function_call',call_id:c.id,name:c.function.name,arguments:c.function.arguments}))
  :[{type:'message',role:'assistant',content:[{type:'output_text',text:'Stage complete.'}]}]})
const output=(id:string,content:string)=>({role:'tool' as const,tool_call_id:id,content})
const note=(keep=['concept:B'])=>({completed_question:'Proportion comparison finished',findings:[{source_ref:'concept:A',observation:'Older reference; not approval of the current revision.'}],
 unresolved:['117 cm remains preliminary'],next_step:'Explain the balanced placement',keep_image_refs:keep})
const opts={version:1,mainResultReferences:1 as const,imageInputDedupVersion:1 as const,stageContextVersion:1 as const,aiCatalog:catalog,imageSource}
const disk=<T>(v:T):T=>JSON.parse(JSON.stringify(v))
const imageRefs=(o:OpenAIServiceOptions)=>o.messages!.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url').map(p=>typeof p.image_url==='string'?p.image_url:p.image_url.url)

test('stage release keeps original constraints, selected exact pixels, paired native protocol and the exact archive through restart',async()=>{
 const sent:OpenAIServiceOptions[]=[];let renewals=0
 const options={...opts,refreshSurface:async()=>({tools:[spec('new_stage_tool')]}),onRollover:()=>renewals++,
  snapshot:()=>({confirmed_writes:[{revision:21}],unresolved_tools:['construction_edit_preparation_failed']}),
  callModel:async(o:OpenAIServiceOptions)=>{
   sent.push(disk(o));const n=sent.length
   if(n===1)return reply('r1',[call('read1','read_record',{})])
   if(n===2)return reply('r2',[call('stage1',STAGE_CONTEXT_TOOL,note())])
   if(n===3){assert(!JSON.stringify(o.messages).includes('OLD_LARGE_PAYLOAD'));return reply('r3',[call('history1','get_work_history',{call_id:'read1',after:0})])}
   return reply('r'+n)
  }}
 let manager=createBobContextContinuation(options)
 await manager.call(seed)
 await manager.call({...seed,previousResponseId:'r1',messages:[output('read1','{"status":"ok","detail":"OLD_LARGE_PAYLOAD"}'),
  {role:'user',content:'Keep the side window as measured; this is an additional constraint.'},{role:'user',content:[image('concept:B')]}]})
 assert.equal(sent.length,4);assert.equal(renewals,1)
 const fresh=sent[2]
 assert.deepEqual(imageRefs(fresh),['private-image:concept:B/version'])
 assert.equal(fresh.messages![0].content,seed.messages![0].content)
 assert(JSON.stringify(fresh.messages).includes('additional constraint'));assert(JSON.stringify(fresh.messages).includes('construction_edit_preparation_failed'))
 assert(JSON.stringify(fresh.messages).includes('approval_not_implied'));assert(fresh.tools!.some(t=>t.function.name==='new_stage_tool'))
 assert.deepEqual(fresh.messages!.filter(m=>m.role==='tool').map(m=>m.tool_call_id),['stage1'])
 const claude:any=await anthropicRequestBody(fresh,{apiKey:'local-fixture',model:{model_name:'fixture',input_cost_per_1m_tokens:0,output_cost_per_1m_tokens:0,cached_input_cost_per_1m_tokens:0},
  systemMessage:'Coordinate the build.',maxOutputTokens:1000,effort:null,timeoutMs:1000,log:async()=>{},resolveImage:async ref=>{assert.equal(ref,'private-image:concept:B/version');return 'data:image/png;base64,AAAA'}})
 const blocks=claude.messages.flatMap((m:any)=>m.content)
 assert(blocks.some((p:any)=>p.type==='tool_use'&&p.id==='stage1'));assert(blocks.some((p:any)=>p.type==='tool_result'&&p.tool_use_id==='stage1'))
 assert.equal(blocks.filter((p:any)=>p.type==='image'&&p.source.data==='AAAA').length,1)
 assert(JSON.stringify(sent[3].messages).includes('OLD_LARGE_PAYLOAD'),'exact read on demand still works')
 const state=disk(manager.exportState());manager=createBobContextContinuation(options);manager.restoreState(state)
 assert.equal(manager.readOperation({call_id:'read1',after:0},'r4').status,'ok')
 await manager.call({...seed,previousResponseId:'r4',messages:[{role:'user',content:[image('concept:A')]}]})
 assert.deepEqual(imageRefs(sent[4]),['private-image:concept:B/version','private-image:concept:A/version'],'a fresh canonical open can bring retired pixels back')
})

test('a stable media ref with different immutable inputs can release the old version without releasing the chosen version',()=>{
 const old='private-image:same-media/version-1',current='private-image:same-media/version-2',registry=new Set([old,current])
 const value={...note([stageImageRef(current)!]),findings:[{source_ref:stageImageRef(old)!,observation:'Earlier pixels only'}]}
 const result=prepareStageContext({value,seed:[{role:'user',content:[{type:'image_url',image_url:old}]}],
  history:[{role:'user',content:[{type:'image_url',image_url:current},{type:'image_url',image_url:'https://example.invalid/mutable.png'}]}],callIds:new Set(),imageSource:u=>registry.has(u)?stageImageRef(u):undefined})
 assert.equal(result.status,'ready');if(result.status==='ready')assert.deepEqual(imageRefs({...seed,messages:result.seed}),[current,'https://example.invalid/mutable.png'])
})

test('unknown identities, invented findings, public pixels and protocol-bearing messages are never silently discarded',()=>{
 const base={seed:seed.messages!,history:[{role:'user' as const,content:[image('concept:B'),image('https-public')]}],callIds:new Set(['read1']),imageSource:(u:string)=>u.includes('https-public')?undefined:imageSource(u)}
 const result=prepareStageContext({...base,value:{...note(),findings:[{source_ref:'call:read1',observation:'Exact historical result'}]}})
 assert.equal(result.status,'ready');if(result.status==='ready')assert.equal(imageRefs({...seed,messages:result.seed}).length,2)
 assert.deepEqual(prepareStageContext({...base,value:note(['never-opened'])}),{status:'invalid',reason:'image_ref_not_active'})
 assert.deepEqual(prepareStageContext({...base,value:{...note(),findings:[{source_ref:'call:invented',observation:'Fabricated'}]}}),{status:'invalid',reason:'finding_source_not_observed'})
 assert.equal(prepareStageContext({...base,value:{...note(),next_step:'x'.repeat(251)}}).status,'invalid')
 assert.equal(prepareStageContext({...base,history:[{role:'assistant',content:[image('concept:B')]}],value:note()}).status,'invalid')
})

test('a stage handoff mixed with an external operation is refused without losing that operation or its protocol',async()=>{
 const sent:OpenAIServiceOptions[]=[]
 const manager=createBobContextContinuation({...opts,callModel:async o=>{sent.push(disk(o));return sent.length===1
  ?reply('mixed',[call('stage',STAGE_CONTEXT_TOOL,note([])),call('write','edit_record',{})]):reply('after')}})
 const result=await manager.call(seed)
 assert.deepEqual(result.toolCalls!.map(c=>c.id),['write'])
 await manager.call({...seed,previousResponseId:'mixed',messages:[output('write','{"status":"conflict"}')]})
 assert.deepEqual(imageRefs(sent[1]),imageRefs(seed));assert(JSON.stringify(sent[1].messages).includes('handoff_must_be_only_call'))
 assert.deepEqual(sent[1].messages!.filter(m=>m.role==='tool').map(m=>m.tool_call_id),['stage','write'])
})

test('forty stages release unique old images and raw results while retaining archive paths across JSON checkpoints',async()=>{
 let count=0,external=0,renewals=0,previous:string|undefined
 const run={...opts,onRollover:()=>renewals++,callModel:async(o:OpenAIServiceOptions)=>{
  count++;assert(imageRefs(o).length<=2,'only the selected stage evidence stays in input')
  return count%2===1?reply('r'+count,[call('stage'+count,STAGE_CONTEXT_TOOL,{...note(['concept:'+external]),findings:[]})])
   :reply('r'+count,[call('read'+external,'read_record',{})])
 }}
 let manager=createBobContextContinuation(run)
 for(external=0;external<40;external++){
  const messages=external?[output('read'+(external-1),JSON.stringify({status:'ok',payload:'LARGE_OLD_RESULT_'+external})),{role:'user' as const,content:[image('concept:'+external)]}]
   :[{role:'user' as const,content:'Original assignment, no owner approval.'},{role:'user' as const,content:[image('concept:0')]}]
  const result=await manager.call({...seed,previousResponseId:previous,messages});previous=result.responseId
  const state=disk(manager.exportState());manager=createBobContextContinuation(run);manager.restoreState(state)
 }
 assert.equal(count,80);assert.equal(renewals,40)
 assert.equal(manager.readOperation({call_id:'read0',after:0},previous).status,'ok')
})

test('only the new published pin enables stage release; absent and mismatched checkpoint contracts remain exact',async()=>{
 assert.deepEqual(bobStageContextVersion(true,{}),{})
 const metadata={stage_context_version:1,complete_request_version:1,result_reference_version:1,context_strategy_version:1}
 assert.deepEqual(bobStageContextVersion(false,metadata),{});assert.deepEqual(bobStageContextVersion(true,metadata),{stageContextVersion:1})
 assert.throws(()=>bobStageContextVersion(true,{...metadata,stage_context_version:2}),/stage_context_contract_invalid/)
 const {stageContextVersion:_v,...oldOpts}=opts
 const old=createBobContextContinuation({...oldOpts,callModel:async o=>{assert(!o.tools!.some(t=>t.function.name===STAGE_CONTEXT_TOOL));return reply('old')}})
 await old.call(seed);const state=disk(old.exportState());assert(!Object.hasOwn(state,'stageContextVersion'))
 const next=createBobContextContinuation({...opts,callModel:async()=>assert.fail('no dispatch')})
 assert.throws(()=>next.restoreState(state),/context_checkpoint_invalid/)
 assert.throws(()=>createBobContextContinuation({...opts,stageContextVersion:2 as any,callModel:async()=>reply('no')}),/stage_context_version_invalid/)
})

test('releasing evidence never bypasses the existing live pre-dispatch authority gate',async()=>{
 let gateCalls=0,dispatches=0
 const manager=createBobContextContinuation({...opts,callModel:async(_o,before)=>{
  await before?.();dispatches++;return reply('stage',[call('handoff',STAGE_CONTEXT_TOOL,note([]))])
 }})
 await assert.rejects(manager.call(seed,async()=>{if(++gateCalls===2)throw Error('project_denied')}),/project_denied/)
 assert.equal(dispatches,1);assert.equal(gateCalls,2)
})

test('JSONB-style object reordering after a stage preserves the next journal fingerprint',async()=>{
 async function run(restart:boolean){
  const sent:OpenAIServiceOptions[]=[]
  const options={...opts,snapshot:()=>({z:1,a:{preliminary:true}}),callModel:async(o:OpenAIServiceOptions)=>{sent.push(disk(o));return sent.length===1
   ?reply('stage',[call('handoff',STAGE_CONTEXT_TOOL,{...note([]),findings:[]})]):reply('r'+sent.length)}}
  let manager=createBobContextContinuation(options);await manager.call(seed)
  if(restart){const state=stableJsonValue(disk(manager.exportState()));manager=createBobContextContinuation(options);manager.restoreState(state)}
  await manager.call({...seed,previousResponseId:'r2',messages:[{role:'user',content:'Continue the next stage.'}]})
  return fingerprint(sent[2])
 }
 assert.equal(await run(true),await run(false))
})
