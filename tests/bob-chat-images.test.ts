import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { parseBobImageIds } from '../src/domain/bobImages.ts'
import { readOutgoing } from '../src/lib/bobOutgoing.ts'
import { readBobTranscript } from '../src/data/bobTranscript.ts'
import { createBobHandler } from '../supabase/functions/_shared/bob-request.ts'
import { catalogFixture, legacyCatalogFixture } from './support/ai-catalog-fixture.ts'
const image='10000000-0000-4000-8000-000000000001', turn='20000000-0000-4000-8000-000000000001'

test('chat accepts bounded identities and rejects image URLs, bytes, duplicates and extra fields',async()=>{
  assert.deepEqual(parseBobImageIds([image.toUpperCase()]),[image])
  for(const value of [[image,image.toUpperCase()],['https://private.invalid/photo'],['data:image/png;base64,AAA'],Array(5).fill(image),'image',{}])assert.throws(()=>parseBobImageIds(value),/invalid_images/)
  const received:any[]=[]
  const handler=createBobHandler({authenticate:async()=> 'owner',answer:async input=>{received.push(input);return {ok:true,projectId:'A',answer:'Seen',evidence:{kind:'ai_assessment',sources:[],partial:false}}}})
  const request=(data:any)=>handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({action:'send',projectId:'A',message:'Here.',clientTurnId:turn,...data})}))
  assert.equal((await request({imageIds:[image]})).status,200)
  assert.deepEqual(received[0].imageIds,[image])
  assert.equal((await request({imageIds:[image,image]})).status,400)
  assert.equal((await request({imageUrls:['https://private.invalid']})).status,400)
  assert.equal(received.length,1)
})
test('reload and unconfirmed outgoing delivery retain exact images with the original turn',()=>{
  const outgoing=readOutgoing(JSON.stringify({text:'Here.',turnId:turn,threadId:null,imageIds:[image]}))
  assert.deepEqual(outgoing?.imageIds,[image])
  const transcript=readBobTranscript([{role:'user',text:'Here.',turn_id:turn,delivery_state:'failed',seq:1,image_ids:[image]}],'A',new Map())
  assert.deepEqual(transcript.messages[0].imageIds,[image])
  assert.deepEqual(transcript.unfinished?.imageIds,[image])
  assert.equal(readOutgoing(JSON.stringify({text:'Here.',turnId:turn,threadId:null,imageIds:['foreign-url']})),null)
})
test('the current immutable AI catalog exposes image references; old manifests retain their schema',()=>{
  const contract=catalogFixture().tool('generate_project_image')
  assert.equal((contract.function.parameters as any).properties.reference_image_ids.maxItems,4)
  assert.match(contract.function.description,/photographed place/)
  assert.equal(Object.hasOwn(legacyCatalogFixture().tool('generate_project_image').function.parameters.properties,'reference_image_ids'),false)
  execFileSync(process.execPath,['--import','tsx','scripts/build-ai-chat-image-catalog.ts','--check'])
})
