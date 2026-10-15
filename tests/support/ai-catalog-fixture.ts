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
 const boundEditContracts=source.match(/\$bound_edit_contracts\$([\s\S]+?)\$bound_edit_contracts\$/)
 if(boundEditContracts){
  const policies=JSON.parse(source.match(/\$bound_edit_policies\$([\s\S]+?)\$bound_edit_policies\$/)![1])
  for(const patch of JSON.parse(boundEditContracts[1])){
   const row=structuredClone(seed.find(row=>row.key==='tools.save_project_description'));row.key='tools.'+patch.name
   row.definition={...row.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[],additional_description:policies.find((p:any)=>p.name===patch.name).how_to}
   row.definition.envelope.schema_version=1
   row.metadata={publication:'server-bound-edits',server_fields:patch.parameters.required.includes('request_quote')?['request_quote']:[]}
   seed.push(row);versions.set(row.key,1)
  }
  for(const patch of JSON.parse(source.match(/\$bound_edit_append\$([\s\S]+?)\$bound_edit_append\$/)![1])){
   const row=seed.find(row=>row.key===patch.key);row.definition.additional_description=(row.definition.additional_description??'')+patch.text;versions.set(row.key,versions.get(row.key)!+1)
  }
  const box=seed.find(row=>row.key==='bob.tools');versions.set(box.key,versions.get(box.key)!+1)
  for(const policy of policies){box.definition.catalog.push(policy);box.definition.contract_keys.push('tools.'+policy.name);box.definition.shelves.find((s:any)=>s.label===(source.includes("='Living plan'")?'Living plan':'Project records and memory')).tools.push(policy.name)}
 }
 const taskTexts=source.match(/\$task_budget_texts\$([\s\S]+?)\$task_budget_texts\$/)
 if(taskTexts){
  for(const patch of JSON.parse(taskTexts[1])){
   const row=seed.find(row=>row.key===patch.key);row.content=patch.content;versions.set(row.key,versions.get(row.key)!+1)
  }
  const tool=JSON.parse(source.match(/\$task_budget_tool\$([\s\S]+?)\$task_budget_tool\$/)![1])
  const row=seed.find(row=>row.key==='tools.design_project_cad')
  row.definition.parameters.properties.request_id.description=tool.request_id_description
  row.definition.additional_description=(row.definition.additional_description??'')+'\n\n'+tool.additional_description
  versions.set(row.key,versions.get(row.key)!+1)
 }
 const resumeGuidance=source.match(/\$resume_guidance\$([\s\S]+?)\$resume_guidance\$/)
 if(resumeGuidance){
  const oldGuard=source.match(/\$old_guard\$([\s\S]+?)\$old_guard\$/)![1]
  const tool=seed.find(row=>row.key==='tools.design_project_cad')
  tool.definition.additional_description=(tool.definition.additional_description??'').replace(oldGuard,'').trim()
  versions.set(tool.key,versions.get(tool.key)!+1)
  const resume=seed.find(row=>row.key==='feedback.bob-budget-stop.resume.9c3a74e182d5')
  resume.content=resumeGuidance[1];versions.set(resume.key,versions.get(resume.key)!+1)
 }
 if(source.includes('do $communication$')){
  const content=source.match(/'(När du formulerar besked[^']+)'/)?.[1]
  if(!content)throw new Error('Concise communication migration content missing')
  seed.push({key:'communication.concise',kind:'instruction_fragment',content,definition:{},metadata:{},variables:[]})
  versions.set('communication.concise',1)
  for(const row of seed)if(row.kind==='role'&&!row.definition.prompt_keys.includes('communication.concise')){row.definition.prompt_keys.splice(1,0,'communication.concise');versions.set(row.key,versions.get(row.key)!+1)}
 }
 const patch=source.match(/\$ai_catalog_patch\$([\s\S]+?)\$ai_catalog_patch\$/)
 if(patch)for(const row of JSON.parse(patch[1])){const index=seed.findIndex(value=>value.key===row.key);versions.set(row.key,(versions.get(row.key)??0)+1);if(index<0)seed.push(row);else seed[index]=row}
 const serverPatches=source.match(/\$cad_server_contracts\$([\s\S]+?)\$cad_server_contracts\$/)
 if(serverPatches)for(const patch of JSON.parse(serverPatches[1])){
  const row=seed.find(row=>row.key===patch.key)
  versions.set(row.key,versions.get(row.key)!+1)
  row.metadata.server_owned_values=true
  for(const field of patch.remove_fields??[]){
   delete row.definition.parameters.properties[field]
   for(const key of ['required_parameters','optional_parameters'])row.definition[key]=row.definition[key].filter((key:string)=>key!==field)
   row.definition.parameters.required=row.definition.parameters.required.filter((key:string)=>key!==field)
  }
  if(patch.server_need_ids){
   const need=row.definition.parameters.properties.additional_needs.items
   delete need.properties.id;need.required=need.required.filter((key:string)=>key!=='id')
   row.metadata.schema_bindings={...row.metadata.schema_bindings,...patch.schema_bindings}
  }
 }
 const handoffPatches=source.match(/\$cad_handoff_contracts\$([\s\S]+?)\$cad_handoff_contracts\$/)
 if(handoffPatches)for(const patch of JSON.parse(handoffPatches[1])){
  const row=seed.find(row=>row.key===patch.key)
  versions.set(row.key,versions.get(row.key)!+1)
  row.definition={...row.definition,description:patch.description,parameters:patch.parameters,required_parameters:patch.parameters.required,optional_parameters:[]}
  row.metadata={...row.metadata,server_owned_values:true,saved_handoff_resume:true}
 }
 const budgetStopContracts=source.match(/\$budget_stop_contracts\$([\s\S]+?)\$budget_stop_contracts\$/)
 if(budgetStopContracts)for(const patch of JSON.parse(budgetStopContracts[1])){
  const row=seed.find(row=>row.key===patch.key)
  versions.set(row.key,versions.get(row.key)!+1)
  row.definition={...row.definition,description:patch.description,parameters:patch.parameters,required_parameters:patch.parameters.required,optional_parameters:[]}
 }
 const drawingIntentTexts=source.match(/\$drawing_intent_texts\$([\s\S]+?)\$drawing_intent_texts\$/)
 if(drawingIntentTexts){
  for(const patch of JSON.parse(drawingIntentTexts[1])){
   const row=seed.find(row=>row.key===patch.key)
   row.content=patch.content;row.metadata={...row.metadata,publication:'current-owner-deliverable'}
   versions.set(row.key,versions.get(row.key)!+1)
  }
  const patch=JSON.parse(source.match(/\$drawing_intent_contract\$([\s\S]+?)\$drawing_intent_contract\$/)![1])
  const row=seed.find(row=>row.key==='tools.design_project_cad')
  row.definition.parameters.properties.request_id.description=patch.request_id_description
  row.metadata={...row.metadata,publication:'current-owner-deliverable'}
  versions.set(row.key,versions.get(row.key)!+1)
 }
 const checkedContracts=source.match(/\$checked_construction_contracts\$([\s\S]+?)\$checked_construction_contracts\$/)
 if(checkedContracts){
  const contracts=JSON.parse(checkedContracts[1]),append=JSON.parse(source.match(/\$checked_construction_append\$([\s\S]+?)\$checked_construction_append\$/)![1]),feedback=JSON.parse(source.match(/\$checked_construction_feedback\$([\s\S]+?)\$checked_construction_feedback\$/)![1])
  for(const key of new Set<string>([...contracts,...append,feedback].map((p:any)=>p.key))){
   const row=seed.find(row=>row.key===key)
   const contract=contracts.find((p:any)=>p.key===key),extra=append.find((p:any)=>p.key===key)
   if(contract)row.definition={...row.definition,description:contract.description,parameters:contract.parameters,required_parameters:contract.parameters.required,optional_parameters:[]}
   if(extra){if(row.kind==='instruction_fragment')row.content+='\n\n'+extra.content;else row.definition.additional_description=(row.definition.additional_description??'')+'\n\n'+extra.content}
   if(feedback.key===key)row.content=feedback.content
   row.metadata={...row.metadata,publication:'checked-construction-required'};versions.set(key,versions.get(key)!+1)
  }
 }
 const intakePatches=source.match(/\$cad_intake_recovery\$([\s\S]+?)\$cad_intake_recovery\$/)
 if(intakePatches)for(const patch of JSON.parse(intakePatches[1])){
  const row=seed.find(row=>row.key===patch.key)
  versions.set(row.key,versions.get(row.key)!+1)
  if(patch.parameters)row.definition={...row.definition,parameters:patch.parameters,required_parameters:patch.parameters.required,optional_parameters:[]}
  if(patch.schema)row.definition=patch.schema
  if(patch.minimum_output_tokens)row.definition={...row.definition,max_output_tokens:Math.max(row.definition.max_output_tokens??0,patch.minimum_output_tokens)}
  if(patch.append)row.content+='\n\n'+patch.append
 }
 const revisionPatches=source.match(/\$cad_revision_contracts\$([\s\S]+?)\$cad_revision_contracts\$/)
 if(revisionPatches)for(const patch of JSON.parse(revisionPatches[1])){
  const row=seed.find(row=>row.key===patch.key)
  versions.set(row.key,versions.get(row.key)!+1)
  row.definition={...row.definition,description:patch.description,parameters:patch.parameters,required_parameters:patch.parameters.required,optional_parameters:[]}
 }
 const parameterContracts=source.match(/\$parameter_contracts\$([\s\S]+?)\$parameter_contracts\$/)
 if(parameterContracts){
  const policy=JSON.parse(source.match(/\$parameter_policy\$([\s\S]+?)\$parameter_policy\$/)![1])
  for(const patch of JSON.parse(parameterContracts[1])){
   let row=seed.find(row=>row.key==='tools.'+patch.name)
   if(!row){row=structuredClone(seed.find(row=>row.key==='tools.save_construction_draft'));row.key='tools.'+patch.name;seed.push(row)}
   versions.set(row.key,(versions.get(row.key)??0)+1)
   row.definition={...row.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[]}
  }
  const toolbox=seed.find(row=>row.key==='bob.tools');versions.set(toolbox.key,versions.get(toolbox.key)!+1)
  toolbox.definition.catalog.push(policy);toolbox.definition.contract_keys.push('tools.'+policy.name)
  toolbox.definition.shelves.find((s:any)=>s.label==='Drawings and CAD').tools.push(policy.name)
 }
 const legacyContract=source.match(/\$legacy_transition_contract\$([\s\S]+?)\$legacy_transition_contract\$/)
 if(legacyContract){
  const patch=JSON.parse(legacyContract[1]),policy=JSON.parse(source.match(/\$legacy_transition_policy\$([\s\S]+?)\$legacy_transition_policy\$/)![1])
  const row=structuredClone(seed.find(row=>row.key==='tools.save_construction_draft'));row.key='tools.'+patch.name
  row.definition={...row.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[],additional_description:policy.how_to}
  seed.push(row);versions.set(row.key,1)
  for(const manual of JSON.parse(source.match(/\$legacy_reader_manuals\$([\s\S]+?)\$legacy_reader_manuals\$/)![1])){
   const old=seed.find(row=>row.key===manual.key);old.definition.additional_description=(old.definition.additional_description??'')+manual.text;versions.set(old.key,versions.get(old.key)!+1)
  }
  const box=seed.find(row=>row.key==='bob.tools');box.definition.catalog.push(policy);box.definition.contract_keys.push(row.key)
  box.definition.shelves.find((s:any)=>s.label==='Drawings and CAD').tools.push(patch.name);versions.set(box.key,versions.get(box.key)!+1)
 }
 const consequenceContracts=source.match(/\$consequence_contracts\$([\s\S]+?)\$consequence_contracts\$/)
 if(consequenceContracts){
  const policies=JSON.parse(source.match(/\$consequence_policies\$([\s\S]+?)\$consequence_policies\$/)![1])
  for(const patch of JSON.parse(consequenceContracts[1])){
   const name=patch.contract?.name??patch.name,key='tools.'+name
   let row=seed.find(row=>row.key===key),newRow=false
   if(!row){row=structuredClone(seed.find(row=>row.key==='tools.save_construction_draft'));row.key=key;seed.push(row);newRow=true}
   if(patch.contract)row.definition={...row.definition,...patch.contract,handler:name,required_parameters:patch.contract.parameters.required,optional_parameters:[]}
   row.definition.additional_description=(newRow?'':row.definition.additional_description??'')+patch.text
   versions.set(key,(versions.get(key)??0)+1)
  }
  const box=seed.find(row=>row.key==='bob.tools');box.definition.catalog.push(...policies)
  box.definition.contract_keys.push(...policies.map((p:any)=>'tools.'+p.name));box.definition.shelves.find((s:any)=>s.label==='Drawings and CAD').tools.push(...policies.map((p:any)=>p.name))
  versions.set(box.key,versions.get(box.key)!+1)
 }
 const calculatorContract=source.match(/\$calculator_contract\$([\s\S]+?)\$calculator_contract\$/)
 if(calculatorContract){
  const contract=JSON.parse(calculatorContract[1]),policy=JSON.parse(source.match(/\$calculator_policy\$([\s\S]+?)\$calculator_policy\$/)![1])
  const row=structuredClone(seed.find(row=>row.key==='tools.inspect_stair_options'));row.key='tools.calculate_project'
  row.definition={...row.definition,...contract,handler:contract.name,required_parameters:contract.parameters.required,optional_parameters:[],additional_description:policy.how_to}
  seed.push(row);versions.set(row.key,1)
  const box=seed.find(row=>row.key==='bob.tools');box.definition.catalog.push(policy);box.definition.contract_keys.push(row.key)
  box.definition.shelves.push({label:'Calculations',tools:['calculate_project']});versions.set(box.key,versions.get(box.key)!+1)
  for(const patch of JSON.parse(source.match(/\$calculator_text_patches\$([\s\S]+?)\$calculator_text_patches\$/)![1])){
   let row=seed.find(row=>row.key===patch.key)
   if(!row){row={key:patch.key,kind:'instruction_fragment',content:patch.content,definition:{},metadata:{},variables:[]};seed.push(row);versions.set(row.key,1)}
   else{row.content+='\n\n'+patch.append;versions.set(row.key,versions.get(row.key)!+1)}
  }
  for(const name of JSON.parse(source.match(/\$calculator_roles\$([\s\S]+?)\$calculator_roles\$/)![1])){
   const row=seed.find(row=>row.key==='role.'+name);row.definition.tool_keys.push('tools.calculate_project');versions.set(row.key,versions.get(row.key)!+1)
  }
 }
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
