import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildBobRequest,type BobImageInputCounts} from '../supabase/functions/_shared/bob-complete-request.ts'
import {createBobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'
import {createBobContextContinuation,estimateBobRequestInput} from '../supabase/functions/_shared/bob-context-continuation.ts'
import {anthropicRequestBody} from '../supabase/functions/_shared/anthropic-service.ts'
import {responseMessageContent,prepareResponseImages} from '../supabase/functions/_shared/openai-content.ts'
import type {AiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'
import type {OpenAIServiceOptions,OpenAIServiceResponse} from '../supabase/functions/_shared/openai-service.ts'

const A='private-image:drawing:source:3:front/'+'a'.repeat(64)
const B='private-image:drawing:source:4:front/'+'b'.repeat(64)
const image=(ref=A)=>({type:'image_url' as const,image_url:ref})
const tool=(name:string)=>({type:'function' as const,function:{name,description:name,parameters:{type:'object'}}})
const call=(id:string)=>({id,type:'function' as const,function:{name:'read_record',arguments:'{}'}})
const output=(id:string)=>({role:'tool' as const,tool_call_id:id,content:'{"status":"ok","revision":3}'})
const usage={input_tokens:100,output_tokens:20,total_tokens:120}
const reply=(id:string):OpenAIServiceResponse=>({success:true,responseId:id,model:'fixture',data:null,usage,toolCalls:[call(id)],
 outputItems:[{type:'function_call',call_id:id,name:'read_record',arguments:'{}'}]})
const seed:OpenAIServiceOptions={app:'bob',coworkerId:'bob',module:'global',functionName:'ask-bob',catalogRoleKey:'ask-bob',
 responseItemsMode:'preserve',tools:[tool('read_record')],messages:[{role:'user',content:'Compare this exact saved view with the current construction.'},{role:'user',content:[image()]}]}
const catalog=(ceiling=96000)=>({definition:()=>({metadata:{continuation_input_tokens:1000,context_input_ceiling_tokens:ceiling,continuation_summary_tokens:1600,retained_tool_exchanges:2}}),
 role:()=>({providerAdapter:'anthropic-messages-v1',systemMessage:'Inspect exact evidence.'}),tool}) as unknown as AiCatalogSession
const disk=<T>(v:T):T=>JSON.parse(JSON.stringify(v))
const images=(o:OpenAIServiceOptions)=>o.messages!.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url')

test('exact private image inputs collapse once while metadata, distinct versions/details and native pairs stay exact',()=>{
 const state:any={seed:seed.messages,history:[{role:'assistant',content:'',nativeOutput:[{type:'function_call',call_id:'c',name:'read_record',arguments:'{}'}]},output('c'),
  {role:'user',content:[{type:'text',text:'Source is now historical; unchanged pixels do not prove the current model.'},image(),{type:'image_url',image_url:{url:A,detail:'auto'}},image(B),
   {type:'image_url',image_url:{url:A,detail:'high'}},{type:'image_url',image_url:{url:A,detail:'low'}},image('https://example.invalid/mutable.png'),image('https://example.invalid/mutable.png')]},
  {role:'user',content:[image()]}]}
 const counts:BobImageInputCounts[]=[]
 const before=disk(state),legacy=buildBobRequest(seed,state,c=>counts.push(c)),next=buildBobRequest(seed,{...state,imageInputDedupVersion:1},c=>counts.push(c))
 assert.deepEqual(counts,[{before:9,after:9,removed:0,unique_private:4,other:2,dedup_version:0},
  {before:9,after:6,removed:3,unique_private:4,other:2,dedup_version:1}])
 assert.deepEqual(next,buildBobRequest(seed,{...state,imageInputDedupVersion:1}),'observability does not alter provider options')
 assert.equal(images(legacy).length,9);assert.equal(images(next).length,6)
 assert.deepEqual(state,before);assert.deepEqual(next.messages!.slice(0,4),legacy.messages!.slice(0,4))
 assert(JSON.stringify(next.messages).includes('Source is now historical'));assert.equal(next.messages!.length,5,'empty duplicate-only message is omitted')
 assert(images(next).some(p=>p.image_url===B));assert.deepEqual(buildBobRequest(seed,state),legacy,'old pins remain byte-identical')
 const malformed:any={seed:seed.messages,history:[{role:'user',content:[image()],nativeOutput:[{type:'message',role:'assistant',content:[]}]}],imageInputDedupVersion:1}
 assert.throws(()=>buildBobRequest(seed,malformed,()=>assert.fail('invalid input has no dispatch diagnostic')),/bob_native_output_role_invalid/,'dedup cannot hide invalid native protocol')
 assert.throws(()=>buildBobRequest(seed,{...state,imageInputDedupVersion:2} as any),/image_input_dedup_version_invalid/)
})

test('image diagnostics contain only numbers, distinguish ineligible inputs and cover empty requests',()=>{
 const counts:BobImageInputCounts[]=[]
 const state:any={seed:[{role:'user',content:[image(),image()]},{role:'assistant',content:[image()]},
  {role:'user',tool_call_id:'do-not-deduplicate',content:[image()]},{role:'user',content:[image('data:image/png;base64,SECRET_PIXELS'),image('https://private.example/SECRET_URL')]}],history:[],imageInputDedupVersion:1}
 const result=buildBobRequest(seed,state,c=>counts.push(c))
 assert.equal(images(result).length,5)
 buildBobRequest(seed,{seed:[{role:'user',content:'PRIVATE_ASSIGNMENT'}],history:[]},c=>counts.push(c))
 assert.deepEqual(counts,[{before:6,after:5,removed:1,unique_private:1,other:4,dedup_version:1},
  {before:0,after:0,removed:0,unique_private:0,other:0,dedup_version:0}])
 assert(counts.every(c=>Object.values(c).every(Number.isSafeInteger)))
 assert(!/private-image|SECRET|PRIVATE_ASSIGNMENT|image_url/.test(JSON.stringify(counts)))
})

test('counts travel outside provider options and checkpoints; completed journal replay emits no new attempt',async()=>{
 const entries:JournalEntry[]=[],attempts:BobImageInputCounts[]=[],requests:OpenAIServiceOptions[]=[]
 let firstState:unknown
 for(let segment=0;segment<2;segment++){
  const journal=createBobJournal({entries,save:async e=>{entries.push(e)}},Date.now()+60000)
  const manager=createBobContextContinuation({version:1,mainResultReferences:1,imageInputDedupVersion:1,aiCatalog:catalog(),
   callModel:(o,before,counts)=>journal.run('model:ask-bob',o,async()=>{
    await before?.();assert(counts);attempts.push(counts);requests.push(disk(o));return reply('recorded')
   })})
  await manager.call({...seed,messages:[...seed.messages!,{role:'user',content:[image()]}]})
  const state=disk(manager.exportState())
  assert(!JSON.stringify(state).includes('unique_private'),'counts are not continuation state')
  if(segment===0)firstState=state;else assert.deepEqual(state,firstState)
 }
 assert.deepEqual(attempts,[{before:2,after:1,removed:1,unique_private:1,other:0,dedup_version:1}])
 assert.equal(requests.length,1)
 assert(!JSON.stringify(requests).includes('unique_private'),'counts are not journal/provider input')
})

test('both provider request shapes contain real pixels once per exact private view',async()=>{
 const request=buildBobRequest(seed,{seed:seed.messages!,history:[{role:'user',content:[image(),image(B),image(B)]}],imageInputDedupVersion:1})
 const resolveImage=async(ref:string)=>{assert([A,B].includes(ref));return 'data:image/png;base64,AAAA'}
 const openai:any=await prepareResponseImages({input:request.messages!.map(m=>({role:m.role,content:responseMessageContent(m.role as 'user',m.content)}))},resolveImage)
 assert.equal(openai.input.flatMap((m:any)=>m.content).filter((p:any)=>p.type==='input_image'&&p.image_url==='data:image/png;base64,AAAA').length,2)
 const claude:any=await anthropicRequestBody(request,{apiKey:'unused-local-fixture',model:{model_name:'fixture',input_cost_per_1m_tokens:0,output_cost_per_1m_tokens:0,cached_input_cost_per_1m_tokens:0},
  systemMessage:'Inspect exact evidence.',maxOutputTokens:1000,effort:null,timeoutMs:1000,log:async()=>{},resolveImage})
 assert.equal(claude.messages.flatMap((m:any)=>m.content).filter((p:any)=>p.type==='image'&&p.source.data==='AAAA').length,2)
})

test('forty repeated opens remain one image through JSON restarts without changing source results or model count',async()=>{
 async function run(restart:boolean){const sent:OpenAIServiceOptions[]=[];const opts={version:1,mainResultReferences:1 as const,imageInputDedupVersion:1 as const,aiCatalog:catalog(),
  callModel:async(o:OpenAIServiceOptions)=>{sent.push(disk(o));return reply('r'+sent.length)}}
  let manager=createBobContextContinuation(opts)
  for(let i=0;i<40;i++){
   if(restart){const state=disk(manager.exportState());manager=createBobContextContinuation(opts);manager.restoreState(state)}
   await manager.call(i?{...seed,previousResponseId:'r'+i,messages:[output('r'+i),{role:'user',content:[{type:'text',text:'Reopened exact saved view.'},image()]}]}:seed)
   assert.equal(images(sent[i]).length,1);assert.deepEqual(sent[i].messages![0],seed.messages![0])
  }
  assert.equal(sent.length,40);assert.equal(manager.readOperation({call_id:'r1',after:null},'r40').status,'ok')
  return {sent,state:disk(manager.exportState())}
 }
 assert.deepEqual(await run(true),await run(false))
 const oldSent:OpenAIServiceOptions[]=[];const old=createBobContextContinuation({version:1,mainResultReferences:1,aiCatalog:catalog(),callModel:async o=>{oldSent.push(o);return reply('old'+oldSent.length)}})
 await old.call(seed);await old.call({...seed,previousResponseId:'old1',messages:[output('old1'),{role:'user',content:[image()]}]})
 assert.equal(images(oldSent[1]).length,2);assert(!Object.hasOwn(old.exportState(),'imageInputDedupVersion'))
 const fresh=createBobContextContinuation({version:1,mainResultReferences:1,imageInputDedupVersion:1,aiCatalog:catalog(),callModel:async()=>assert.fail('no dispatch')})
 assert.throws(()=>fresh.restoreState(old.exportState()),/context_checkpoint_invalid/)
})

test('deduplication precedes the input ceiling, while distinct required views still fail without silent loss',async()=>{
 const assignment='Measured constraints remain exact. '.repeat(1000)
 const request={...seed,messages:[{role:'user' as const,content:assignment},{role:'user' as const,content:[image(),image()]}]}
 let calls=0
 const make=(enabled:boolean)=>createBobContextContinuation({version:1,mainResultReferences:1,...(enabled?{imageInputDedupVersion:1 as const}:{}),aiCatalog:catalog(20000),
  callModel:async o=>{calls++;assert.equal(images(o).length,1);assert.equal(o.messages![0].content,assignment);assert(estimateBobRequestInput(o).total<20000);return reply('fits')}})
 await assert.rejects(make(false).call(request),/context_input_too_large/);assert.equal(calls,0)
 await make(true).call(request);assert.equal(calls,1)
 await assert.rejects(make(true).call({...request,messages:[request.messages[0],{role:'user',content:[image(),image(B)]}]}),/context_input_too_large/)
 assert.equal(calls,1)
})
