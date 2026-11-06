import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createBobContextContinuation} from '../supabase/functions/_shared/bob-context-continuation.ts'
import {releaseUsedImages,IMAGE_RELEASE_AFTER_RESPONSES} from '../supabase/functions/_shared/bob-image-release.ts'
import {STAGE_CONTEXT_SPEC,STAGE_CONTEXT_TOOL} from '../supabase/functions/_shared/bob-stage-context.ts'
import type {AiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'
import type {OpenAIServiceOptions,OpenAIServiceResponse} from '../supabase/functions/_shared/openai-service.ts'

// Entry, 2026-11-06: four opened images (+30k tokens) and the reviewed mockup
// stayed in every later request until Bob hit his context ceiling.
type Message=NonNullable<OpenAIServiceOptions['messages']>[number]
const image=(id:string)=>({type:'image_url' as const,image_url:'private-image:'+id+'/version'})
const imageSource=(url:string)=>url.startsWith('private-image:')?'image-input:'+url.slice(14):undefined
const answer=(id:string):Message=>({role:'assistant',content:'',nativeOutput:[{type:'function_call',call_id:id,name:'x',arguments:'{}'}]})
const result=(id:string):Message=>({role:'tool',tool_call_id:id,content:'{}'})
const opened=(id:string):Message=>({role:'user',content:[{type:'text',text:JSON.stringify({ref:'image:'+id,title:'Photo '+id})},image(id)]})
const pixels=(groups:Message[][])=>groups.flat().flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url').length

test('pixels stay while in use and leave after a later saved result, or after three answers',()=>{
 const saves=new Set(['save'])
 const run=(groups:Message[][])=>releaseUsedImages({groups,imageSource,saved:id=>saves.has(id)})
 // Delivered in group 0, first seen by answer 1: still in use.
 const inUse=[[answer('open'),result('open'),opened('A')],[answer('look'),result('look')]]
 assert.equal(run(inUse).released,0)
 // A save in the delivery group came from calls made before the image was seen.
 assert.equal(run([[answer('save'),result('save'),opened('A')]]).released,0)
 // A save after it was seen releases it; the image's text stays and says how to reopen.
 const used=run([[answer('open'),result('open'),opened('A')],[answer('save'),result('save')]])
 assert.equal(used.released,1);assert.equal(pixels(used.groups),0)
 const stub=JSON.stringify(used.groups[0][2])
 assert.match(stub,/Photo A/);assert.match(stub,/image_pixels_released/);assert.match(stub,/open_project_item/)
 // Idempotent: the next request keeps the same, already released text.
 assert.deepEqual(run(used.groups),{groups:used.groups,released:0})
 // Without a save, the third answer after delivery is the last one that sees it.
 const looks=(n:number)=>[[answer('open'),result('open'),opened('A')],...Array.from({length:n},(_,i)=>[answer('l'+i),result('l'+i)])]
 assert.equal(IMAGE_RELEASE_AFTER_RESPONSES,3)
 assert.equal(run(looks(2)).released,0);assert.equal(run(looks(3)).released,1)
 // Unknown or public images, tool results and native answers are never touched.
 const other=[[answer('open'),{role:'user' as const,content:[{type:'image_url' as const,image_url:'https://example.invalid/a.png'}]},
  {role:'tool' as const,tool_call_id:'open',content:[image('B')] as any}],[answer('save'),result('save')]]
 assert.deepEqual(run(other as Message[][]),{groups:other,released:0})
})

const spec=(name:string)=>name===STAGE_CONTEXT_TOOL?STAGE_CONTEXT_SPEC:{type:'function' as const,function:{name,description:name,parameters:{type:'object'}}}
const catalog={definition:()=>({metadata:{continuation_input_tokens:64000,context_input_ceiling_tokens:96000,continuation_summary_tokens:1600,retained_tool_exchanges:2}}),
 role:()=>({providerAdapter:'anthropic-messages-v1',systemMessage:'Coordinate the build.'}),tool:spec} as unknown as AiCatalogSession
const call=(id:string,name:string)=>({id,type:'function' as const,function:{name,arguments:'{}'}})
const reply=(id:string,calls:ReturnType<typeof call>[]):OpenAIServiceResponse=>({success:true,responseId:id,model:'fixture',data:'',usage:{input_tokens:100,output_tokens:10,total_tokens:110},toolCalls:calls,
 outputItems:calls.map(c=>({type:'function_call',call_id:c.id,name:c.function.name,arguments:c.function.arguments}))})
const seed:OpenAIServiceOptions={app:'bob',functionName:'ask-bob',catalogRoleKey:'ask-bob',module:'global',coworkerId:'bob',responseItemsMode:'preserve',
 messages:[{role:'user',content:[{type:'text',text:'Make the front windows 42 x 117 cm, like this photo.'},image('owner-photo')]}]}
const urls=(o:OpenAIServiceOptions)=>o.messages!.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url').map(p=>typeof p.image_url==='string'?p.image_url:p.image_url.url)
const disk=<T>(v:T):T=>JSON.parse(JSON.stringify(v))

for(const enabled of [true,false])test(`opened pixels ${enabled?'leave after the saved mockup; the owner photo stays':'stay for jobs without the pin'}`,async()=>{
 const sent:OpenAIServiceOptions[]=[]
 const opts={version:1,mainResultReferences:1 as const,imageInputDedupVersion:1 as const,stageContextVersion:1 as const,aiCatalog:catalog,imageSource,
  ...(enabled?{imageReleaseVersion:1 as const}:{}),
  callModel:async(o:OpenAIServiceOptions)=>{sent.push(disk(o));const n=sent.length
   return n===1?reply('r1',[call('open1','open_project_item')]):n===2?reply('r2',[call('gen1','generate_project_image')]):reply('r'+n,[call('look'+n,'open_project_item')])}}
 let manager=createBobContextContinuation(opts)
 await manager.call(seed)
 await manager.call({...seed,previousResponseId:'r1',messages:[{role:'tool',tool_call_id:'open1',content:'{"status":"ok","saved":false}'},opened('mockup-v4'),opened('window-photo')]})
 // A worker restart restores the same chain before the saved result arrives.
 const state=disk(manager.exportState());manager=createBobContextContinuation(opts);manager.restoreState(state)
 await manager.call({...seed,previousResponseId:'r2',messages:[{role:'tool',tool_call_id:'gen1',content:'{"status":"saved","saved":true}'}]})
 assert.deepEqual(urls(sent[1]),['private-image:owner-photo/version','private-image:mockup-v4/version','private-image:window-photo/version'])
 assert.deepEqual(urls(sent[2]),enabled?['private-image:owner-photo/version']:urls(sent[1]))
 if(enabled)assert.equal(JSON.stringify(sent[2].messages).split('image_pixels_released').length-1,2)
 assert.equal((state as any).imageReleaseVersion,enabled?1:undefined)
})

test('the pin requires the stage contract and an image identity, and saved state must match it',()=>{
 const base={version:1,mainResultReferences:1 as const,imageInputDedupVersion:1 as const,aiCatalog:catalog,callModel:async()=>assert.fail('no dispatch')}
 assert.throws(()=>createBobContextContinuation({...base,imageReleaseVersion:1}),/image_release_version_invalid/)
 assert.throws(()=>createBobContextContinuation({...base,stageContextVersion:1,imageReleaseVersion:1}),/image_release_version_invalid/)
 const old=createBobContextContinuation({...base,stageContextVersion:1,imageSource}).exportState()
 assert.throws(()=>createBobContextContinuation({...base,stageContextVersion:1,imageSource,imageReleaseVersion:1}).restoreState(old),/context_checkpoint_invalid/)
})
