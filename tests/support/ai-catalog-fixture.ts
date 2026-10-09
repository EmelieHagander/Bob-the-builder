/** Test-only materialisation of the database migration seed. There is no
 * production fallback: these fixtures exercise the same catalog resolver. */
import {readFileSync,readdirSync} from 'node:fs'
import {createAiCatalogSession,applyCatalogModelOptions,type AiCatalogSession,type AiCatalogManifest} from '../../supabase/functions/_shared/ai-catalog.ts'
import type {OpenAIServiceOptions,OpenAIServiceResponse} from '../../supabase/functions/_shared/openai-service.ts'
const migrationRoot=new URL('../../supabase/migrations/',import.meta.url)
const migrations=readdirSync(migrationRoot).filter(name=>name.endsWith('.sql')).sort().map(name=>new URL(name,migrationRoot))
const seedFile=migrations.find(path=>readFileSync(path,'utf8').includes('$ai_catalog_seed$'))
if(!seedFile)throw new Error('AI catalog migration seed is missing')
const originalSeed=JSON.parse(readFileSync(seedFile,'utf8').match(/\$ai_catalog_seed\$([\s\S]+?)\$ai_catalog_seed\$/)![1]) as any[]
const seed=structuredClone(originalSeed)
const versions=new Map<string,number>(seed.map(row=>[row.key,1]))
// Materialise the explicit immutable publication patches in migration order.
// The historical seed stays available for pinned-manifest compatibility tests.
for(const migration of migrations){
 const source=readFileSync(migration,'utf8')
 if(source.includes('do $communication$')){
  const content=source.match(/'(När du formulerar besked[^']+)'/)?.[1]
  if(!content)throw new Error('Concise communication migration content missing')
  seed.push({key:'communication.concise',kind:'instruction_fragment',content,definition:{},metadata:{},variables:[]})
  versions.set('communication.concise',1)
  for(const row of seed)if(row.kind==='role'&&!row.definition.prompt_keys.includes('communication.concise')){row.definition.prompt_keys.splice(1,0,'communication.concise');versions.set(row.key,versions.get(row.key)!+1)}
 }
 const patch=source.match(/\$ai_catalog_patch\$([\s\S]+?)\$ai_catalog_patch\$/)
 if(patch)for(const row of JSON.parse(patch[1])){const index=seed.findIndex(value=>value.key===row.key);versions.set(row.key,(versions.get(row.key)??0)+1);if(index<0)seed.push(row);else seed[index]=row}
}
// The SQL migration resolves preserved image settings at insertion; tests
// supply that database-owned binding explicitly.
for(const rows of [seed,originalSeed])for(const row of rows)if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const modelTiers=new Map(seed.filter(row=>row.kind==='tier_binding').map(row=>[row.definition.model_name,row.definition.tier]))
function fixtureManifest(rows:any[],revisionMap:Map<string,number>,id:string):AiCatalogManifest{return{format_version:1,app:'bob',manifest_id:id,created_at:'2026-10-09T14:00:00Z',
 definitions:rows.map(row=>({id:'fixture-version:'+row.key+':v'+revisionMap.get(row.key),prompt_id:'fixture-prompt:'+row.key,prompt_key:row.key,version:revisionMap.get(row.key)!,
  definition_kind:row.kind,definition_format_version:1,content:row.content??'',definition:row.definition??{},metadata:row.metadata??{},available_variables:row.variables??[],payload_hash:'fixture-hash:'+row.key+':v'+revisionMap.get(row.key)})),
 models:[...modelTiers].map(([model_name,tier])=>({model_name,provider:'openai',model_type:tier,is_active:true,is_default:false,max_output_tokens:150000,
  supports_images:true,supports_reasoning:true,supports_image_output:tier==='image',input_cost_per_1m_tokens:1,output_cost_per_1m_tokens:2,cached_input_cost_per_1m_tokens:null,
  capabilities:{provider_adapter:tier==='image'?'openai-images-v1':'openai-responses-v1',supports_functions:true,supports_json_schema:true,reasoning_efforts:['none','minimal','low','medium','high','xhigh']}})),
}}
const manifest=fixtureManifest(seed,versions,'fixture-manifest')
const legacyManifest=fixtureManifest(originalSeed,new Map(originalSeed.map(row=>[row.key,1])),'fixture-legacy-seed-manifest')
export function legacyCatalogFixture():AiCatalogSession{return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:legacyManifest})}
export function catalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(manifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
export function catalogCall<T>(call:(options:OpenAIServiceOptions,beforeDispatch?:()=>Promise<void>)=>Promise<OpenAIServiceResponse<T>>,session=catalogFixture()){
 return (options:OpenAIServiceOptions,beforeDispatch?:()=>Promise<void>)=>call(applyCatalogModelOptions(session,options),beforeDispatch)
}
export const DRAWING_REVIEW_INSTRUCTION=catalogFixture().text('drawing-review.instruction')
