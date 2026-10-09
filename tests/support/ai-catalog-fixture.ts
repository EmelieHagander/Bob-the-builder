/** Test-only materialisation of the database migration seed. There is no
 * production fallback: these fixtures exercise the same catalog resolver. */
import {readFileSync,readdirSync} from 'node:fs'
import {createAiCatalogSession,applyCatalogModelOptions,type AiCatalogSession,type AiCatalogManifest} from '../../supabase/functions/_shared/ai-catalog.ts'
import type {OpenAIServiceOptions,OpenAIServiceResponse} from '../../supabase/functions/_shared/openai-service.ts'
const migrationRoot=new URL('../../supabase/migrations/',import.meta.url)
const seedFile=readdirSync(migrationRoot).filter(name=>name.includes('catalog')).map(name=>new URL(name,migrationRoot)).find(path=>readFileSync(path,'utf8').includes('$ai_catalog_seed$'))
if(!seedFile)throw new Error('AI catalog migration seed is missing')
const seed=JSON.parse(readFileSync(seedFile,'utf8').match(/\$ai_catalog_seed\$([\s\S]+?)\$ai_catalog_seed\$/)![1]) as any[]
// The SQL migration resolves preserved image settings at insertion; tests
// supply that database-owned binding explicitly.
for(const row of seed)if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const modelTiers=new Map(seed.filter(row=>row.kind==='tier_binding').map(row=>[row.definition.model_name,row.definition.tier]))
const manifest:AiCatalogManifest={format_version:1,app:'bob',manifest_id:'fixture-manifest',created_at:'2026-10-09T14:00:00Z',
 definitions:seed.map(row=>({id:'fixture-version:'+row.key,prompt_id:'fixture-prompt:'+row.key,prompt_key:row.key,version:1,
  definition_kind:row.kind,definition_format_version:1,content:row.content??'',definition:row.definition??{},metadata:row.metadata??{},available_variables:row.variables??[],payload_hash:'fixture-hash:'+row.key})),
 models:[...modelTiers].map(([model_name,tier])=>({model_name,provider:'openai',model_type:tier,is_active:true,is_default:false,max_output_tokens:150000,
  supports_images:true,supports_reasoning:true,supports_image_output:tier==='image',input_cost_per_1m_tokens:1,output_cost_per_1m_tokens:2,cached_input_cost_per_1m_tokens:null,
  capabilities:{provider_adapter:tier==='image'?'openai-images-v1':'openai-responses-v1',supports_functions:true,supports_json_schema:true,reasoning_efforts:['none','minimal','low','medium','high','xhigh']}})),
}
export function catalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(manifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
export function catalogCall<T>(call:(options:OpenAIServiceOptions,beforeDispatch?:()=>Promise<void>)=>Promise<OpenAIServiceResponse<T>>,session=catalogFixture()){
 return (options:OpenAIServiceOptions,beforeDispatch?:()=>Promise<void>)=>call(applyCatalogModelOptions(session,options),beforeDispatch)
}
export const DRAWING_REVIEW_INSTRUCTION=catalogFixture().text('drawing-review.instruction')
