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
let preConstructionEditsRows:any[]|undefined,preConstructionEditsVersions:Map<string,number>|undefined
let preConstructionViewsRows:any[]|undefined,preConstructionViewsVersions:Map<string,number>|undefined
let preSelectiveToolsRows:any[]|undefined,preSelectiveToolsVersions:Map<string,number>|undefined
let preCompleteContextRows:any[]|undefined,preCompleteContextVersions:Map<string,number>|undefined
let preContextCoverageRows:any[]|undefined,preContextCoverageVersions:Map<string,number>|undefined
let preContextStrategyRows:any[]|undefined,preContextStrategyVersions:Map<string,number>|undefined
let preContinuationRows:any[]|undefined,preContinuationVersions:Map<string,number>|undefined
let preTaskWorkflowRows:any[]|undefined,preTaskWorkflowVersions:Map<string,number>|undefined
let preSourceRenewalRows:any[]|undefined,preSourceRenewalVersions:Map<string,number>|undefined
let preBuildingScopeRows:any[]|undefined,preBuildingScopeVersions:Map<string,number>|undefined
let preCostControlsRows:any[]|undefined,preCostControlsVersions:Map<string,number>|undefined
let preCreationRows:any[]|undefined,preCreationVersions:Map<string,number>|undefined
let preControlledCompletionRows:any[]|undefined,preControlledCompletionVersions:Map<string,number>|undefined
let preTextHygieneRows:any[]|undefined,preTextHygieneVersions:Map<string,number>|undefined
let preWriteStateRows:any[]|undefined,preWriteStateVersions:Map<string,number>|undefined
let prePhaseToolsRows:any[]|undefined,prePhaseToolsVersions:Map<string,number>|undefined
let preCreateSelectRows:any[]|undefined,preCreateSelectVersions:Map<string,number>|undefined
let preMaterialLookupRows:any[]|undefined,preMaterialLookupVersions:Map<string,number>|undefined
let preResultWindowRows:any[]|undefined,preResultWindowVersions:Map<string,number>|undefined
let preConstructionWorkRows:any[]|undefined,preConstructionWorkVersions:Map<string,number>|undefined
let preToolPickerRows:any[]|undefined,preToolPickerVersions:Map<string,number>|undefined
let preToolSheetsRows:any[]|undefined,preToolSheetsVersions:Map<string,number>|undefined
let preToolOrderRows:any[]|undefined,preToolOrderVersions:Map<string,number>|undefined
let preToolRepairRows:any[]|undefined,preToolRepairVersions:Map<string,number>|undefined
let preToolOrderRestoreRows:any[]|undefined,preToolOrderRestoreVersions:Map<string,number>|undefined
let preMaterialsWorkerRows:any[]|undefined,preMaterialsWorkerVersions:Map<string,number>|undefined
let preBuildWorkersRows:any[]|undefined,preBuildWorkersVersions:Map<string,number>|undefined
let preKonradLeanRows:any[]|undefined,preKonradLeanVersions:Map<string,number>|undefined
let preMaterialFinderTeamRows:any[]|undefined,preMaterialFinderTeamVersions:Map<string,number>|undefined
let preMemoryStairRows:any[]|undefined,preMemoryStairVersions:Map<string,number>|undefined
// SQL publications drop the seed markers and name themselves, as `(prior.metadata-'seed_version'-'source_revision')||publication`.
const publishAs=(row:any,publication:string)=>{const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication}}
// Materialise the explicit immutable publication patches in migration order.
// The historical seed stays available for pinned-manifest compatibility tests.
for(const migration of migrations){
 const source=readFileSync(migration,'utf8')
 const textHygiene=source.match(/\$text_hygiene_spec\$([\s\S]+?)\$text_hygiene_spec\$/)
 if(textHygiene){
  preTextHygieneRows=structuredClone(seed);preTextHygieneVersions=new Map(versions)
  const spec=JSON.parse(textHygiene[1]),marker={publication:'bob-text-hygiene-v1',text_hygiene_version:1}
  for(const {variables,...addition} of spec.additions){seed.push({definition:{},...addition,variables,metadata:{...marker}});versions.set(addition.key,1)}
  for(const edit of spec.edits){
   const row=seed.find(row=>row.key===edit.key),{seed_version,source_revision,...rest}=row.metadata??{}
   row.metadata={...rest,...edit.metadata,...marker}
   if(edit.description_append)row.definition={...row.definition,description:row.definition.description+edit.description_append}
   if(edit.add_property){
    const p=row.definition.parameters,name=edit.add_property.name
    row.definition={...row.definition,parameters:{...p,properties:{...p.properties,[name]:edit.add_property.schema},required:[...p.required,name]},
     required_parameters:[...row.definition.required_parameters,name]}
   }
   versions.set(edit.key,versions.get(edit.key)!+1)
  }
 }
 const controlledCompletion=source.match(/\$controlled_completion_spec\$([\s\S]+?)\$controlled_completion_spec\$/)
 if(controlledCompletion){
  preControlledCompletionRows=structuredClone(seed);preControlledCompletionVersions=new Map(versions)
  const spec=JSON.parse(controlledCompletion[1]),marker={publication:'bob-controlled-completion-v1',controlled_completion_version:1}
  for(const {variables,...addition} of spec.additions){seed.push({definition:{},...addition,variables,metadata:{...marker}});versions.set(addition.key,1)}
  for(const edit of spec.edits){
   const row=seed.find(row=>row.key===edit.key),{seed_version,source_revision,...rest}=row.metadata??{}
   row.metadata={...rest,...edit.metadata,...marker}
   if(edit.content!==undefined)row.content=edit.content
   if(edit.definition)row.definition={...row.definition,...edit.definition}
   versions.set(edit.key,versions.get(edit.key)!+1)
  }
 }
 const resultWindow=source.match(/\$result_window_spec\$([\s\S]+?)\$result_window_spec\$/)
 if(resultWindow){
  preResultWindowRows=structuredClone(seed);preResultWindowVersions=new Map(versions)
  const spec=JSON.parse(resultWindow[1]),row=seed.find(row=>row.key===spec.key),{seed_version,source_revision,...rest}=row.metadata??{}
  row.metadata={...rest,...spec.metadata,publication:'bob-result-window-v2'}
  versions.set(spec.key,versions.get(spec.key)!+1)
 }
 const materialLookup=source.match(/\$material_lookup_spec\$([\s\S]+?)\$material_lookup_spec\$/)
 if(materialLookup){
  preMaterialLookupRows=structuredClone(seed);preMaterialLookupVersions=new Map(versions)
  for(const spec of JSON.parse(materialLookup[1])){
   const row=seed.find(row=>row.key===spec.key),{seed_version,source_revision,...rest}=row.metadata??{}
   row.definition={...row.definition,description:row.definition.description+spec.append}
   row.metadata={...rest,publication:'material-lookup-v1',material_lookup_version:1}
   versions.set(spec.key,versions.get(spec.key)!+1)
  }
 }
 const createSelect=source.match(/\$create_select_spec\$([\s\S]+?)\$create_select_spec\$/)
 if(createSelect){
  preCreateSelectRows=structuredClone(seed);preCreateSelectVersions=new Map(versions)
  for(const spec of JSON.parse(createSelect[1])){
   const row=seed.find(row=>row.key===spec.key),{seed_version,source_revision,...rest}=row.metadata??{}
   for(const [from,to] of spec.replacements){
    const fields=['description','additional_description','card_description'].filter(field=>typeof row.definition[field]==='string'&&row.definition[field].includes(from))
    if(!fields.length)throw Error('create_select_text_missing: '+spec.key)
    for(const field of fields)row.definition[field]=row.definition[field].replaceAll(from,to)
   }
   if(spec.parameters)row.definition={...row.definition,parameters:spec.parameters,required_parameters:spec.parameters.required}
   if(spec.add_followups)row.definition.operation_followups=[...row.definition.operation_followups,...spec.add_followups]
   row.metadata={...rest,publication:'create-select-v1',create_select_version:1}
   versions.set(spec.key,versions.get(spec.key)!+1)
  }
 }
 const materialSizeText=source.match(/\$material_size_text_spec\$([\s\S]+?)\$material_size_text_spec\$/)
 if(materialSizeText){
  for(const spec of JSON.parse(materialSizeText[1])){
   const row=seed.find(row=>row.key===spec.key)
   for(const [from,to] of spec.replacements){
    const fields=['description','additional_description','card_description'].filter(field=>typeof row.definition[field]==='string'&&row.definition[field].includes(from))
    if(!fields.length)throw Error('material_size_text_missing: '+spec.key)
    for(const field of fields)row.definition[field]=row.definition[field].replaceAll(from,to)
   }
   publishAs(row,'material-size-text-v1');row.metadata.material_size_text_version=1
   versions.set(spec.key,versions.get(spec.key)!+1)
  }
 }
 const phaseTools=source.match(/\$phase_tools_spec\$([\s\S]+?)\$phase_tools_spec\$/)
 if(phaseTools){
  prePhaseToolsRows=structuredClone(seed);prePhaseToolsVersions=new Map(versions)
  for(const spec of JSON.parse(phaseTools[1])){
   const row=seed.find(row=>row.key===spec.key),{seed_version,source_revision,...rest}=row.metadata??{}
   if(spec.card!==undefined){
    if(row.definition.card_description!==spec.card_before)throw Error('phase_tools_card_changed: '+spec.key)
    row.definition={...row.definition,card_description:spec.card}
   }
   if(spec.core_tools){
    if(JSON.stringify(row.definition.core_tools)!==JSON.stringify(spec.core_tools_before))throw Error('phase_tools_core_tools_changed')
    row.definition={...row.definition,core_tools:spec.core_tools,phase_tools:spec.phase_tools}
   }
   row.metadata=spec.card!==undefined?{...rest,card_publication:'phase-tools-v1',phase_tools_version:1}:{...rest,publication:'phase-tools-v1',phase_tools_version:1}
   versions.set(spec.key,versions.get(spec.key)!+1)
  }
 }
 const writeState=source.match(/\$write_state_spec\$([\s\S]+?)\$write_state_spec\$/)
 if(writeState){
  preWriteStateRows=structuredClone(seed);preWriteStateVersions=new Map(versions)
  for(const spec of JSON.parse(writeState[1])){
   const row=seed.find(row=>row.key===spec.key),{seed_version,source_revision,...rest}=row.metadata??{}
   for(const [from,to] of spec.replacements){
    const fields=['description','additional_description','card_description'].filter(field=>typeof row.definition[field]==='string'&&row.definition[field].includes(from))
    if(!fields.length)throw Error('write_state_text_missing: '+spec.key)
    for(const field of fields)row.definition[field]=row.definition[field].replaceAll(from,to)
   }
   if(spec.append)row.definition.description+=spec.append
   if(spec.core_tools){
    if(JSON.stringify(row.definition.core_tools)!==JSON.stringify(spec.core_tools_before))throw Error('write_state_core_tools_changed')
    row.definition.core_tools=spec.core_tools
   }
   if(spec.remove_followups){
    // jsonb equality: key order is irrelevant, array order is not.
    const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)
    const same=(a:any,b:any)=>stable(a)===stable(b)
    for(const f of spec.remove_followups)if(!row.definition.operation_followups.some((g:any)=>same(g,f)))throw Error('write_state_followup_missing')
    row.definition.operation_followups=[...row.definition.operation_followups.filter((g:any)=>!spec.remove_followups.some((f:any)=>same(g,f))),...spec.add_followups]
   }
   row.metadata={...rest,publication:'write-state-v1',write_state_version:1}
   versions.set(spec.key,versions.get(spec.key)!+1)
  }
 }
 const creation=source.match(/\$creation_preparation_spec\$([\s\S]+?)\$creation_preparation_spec\$/)
 if(creation){
  preCreationRows=structuredClone(seed);preCreationVersions=new Map(versions)
  for(const spec of JSON.parse(creation[1])){
   const row=seed.find(row=>row.key===spec.key),{seed_version,source_revision,...rest}=row.metadata??{}
   row.definition={...row.definition,...spec.patch}
   for(const [from,to] of spec.replacements)for(const field of ['description','additional_description','card_description'])
    if(typeof row.definition[field]==='string')row.definition[field]=row.definition[field].replaceAll(from,to)
   if(spec.followups)row.definition.operation_followups.push(...spec.followups)
   row.metadata={...rest,publication:'creation-preparation-v1',creation_preparation_version:1}
   versions.set(spec.key,versions.get(spec.key)!+1)
  }
 }
 const constructionWork=source.match(/\$construction_work_spec\$([\s\S]+?)\$construction_work_spec\$/)
 if(constructionWork){
  preConstructionWorkRows=structuredClone(seed);preConstructionWorkVersions=new Map(versions)
  for(const spec of JSON.parse(constructionWork[1])){
   const row=seed.find(row=>row.key===spec.key),{seed_version,source_revision,...rest}=row.metadata??{}
   row.definition={...row.definition,...spec.patch}
   if(spec.note)row.definition.description+=spec.note
   row.metadata={...rest,publication:'construction-work-v1',construction_work_version:1}
   versions.set(spec.key,versions.get(spec.key)!+1)
  }
 }
 const costControls=source.match(/\$bob_cost_controls_spec\$([\s\S]+?)\$bob_cost_controls_spec\$/)
 if(costControls){
  preCostControlsRows=structuredClone(seed);preCostControlsVersions=new Map(versions)
  const spec=JSON.parse(costControls[1])
  for(const key of ['tools.change_construction_parameters','bob.tools','profile.ask-bob']){
   const row=seed.find(row=>row.key===key),{seed_version,source_revision,...rest}=row.metadata??{}
   row.metadata={...rest,publication:'bob-cost-controls-v1',bob_cost_controls_version:1}
   if(key==='tools.change_construction_parameters'){
    row.definition.parameters.properties.target_revision=spec.target_revision
    row.definition.parameters.properties.changes.minItems=0
    row.definition.parameters.required.push('target_revision');row.definition.required_parameters=[...row.definition.parameters.required]
    row.definition.description+=spec.note;row.metadata.construction_source_refresh_version=1
   }else if(key==='bob.tools')row.definition.core_tools=spec.core_tools
   else row.definition.reasoning_effort=spec.reasoning_effort
   versions.set(key,versions.get(key)!+1)
  }
 }
 const constructionEvidence=source.match(/\$construction_evidence_spec\$([\s\S]+?)\$construction_evidence_spec\$/)
 if(constructionEvidence)for(const spec of JSON.parse(constructionEvidence[1])){
  const row=seed.find(row=>row.key===spec.key)
  row.definition={...row.definition,...spec.patch}
  const {seed_version,source_revision,...rest}=row.metadata??{}
  row.metadata={...rest,publication:'construction-evidence-v1',construction_evidence_version:1}
  versions.set(row.key,versions.get(row.key)!+1)
 }
 const formRefinement=source.match(/\$form_refinement_spec\$([\s\S]+?)\$form_refinement_spec\$/)
 if(formRefinement){
  const spec=JSON.parse(formRefinement[1]),row=seed.find(row=>row.key==='tools.save_construction_draft')
  row.definition.parameters.properties.form_refinement=spec.schema
  row.definition.parameters.required.push('form_refinement');row.definition.required_parameters=[...row.definition.parameters.required]
  row.definition.description+=spec.note
  const {seed_version,source_revision,...rest}=row.metadata??{}
  row.metadata={...rest,publication:'form-refinement-v1',form_refinement_version:1};versions.set(row.key,versions.get(row.key)!+1)
 }
 const formWorkflow=source.match(/\$form_workflow\$([\s\S]+?)\$form_workflow\$/)
 if(formWorkflow){
  const workflow=JSON.parse(formWorkflow[1]),description=source.match(/\$form_description\$([\s\S]+?)\$form_description\$/)![1]
  for(const key of ['tools.edit_project_record','bob.workflows']){
   const row=seed.find(row=>row.key===key),{seed_version,source_revision,...rest}=row.metadata??{}
   if(key==='bob.workflows')row.definition.workflows.push(workflow)
   else row.definition.description=description
   row.metadata={...rest,publication:'form-concept-v1'};versions.set(key,versions.get(key)!+1)
  }
 }
 const activation=source.match(/\$complete_request_activation_flags\$([\s\S]+?)\$complete_request_activation_flags\$/)
 if(activation){
  const row=seed.find(row=>row.key==='agent-contract.ask-bob');const{seed_version,source_revision,...rest}=row.metadata??{}
  row.metadata={...rest,publication:'bob-complete-request-activation-v1',...JSON.parse(activation[1])};versions.set(row.key,versions.get(row.key)!+1)
 }
 const usdStop=source.match(/\$turn_usd_stop_flags\$([\s\S]+?)\$turn_usd_stop_flags\$/)
 if(usdStop){
  const row=seed.find(row=>row.key==='agent-contract.ask-bob');const{seed_version,source_revision,...rest}=row.metadata??{}
  row.metadata={...rest,publication:'bob-turn-usd-stop-v1',...JSON.parse(usdStop[1])};versions.set(row.key,versions.get(row.key)!+1)
 }
 const usdStopChange=source.match(/\$turn_usd_stop_change\$([\s\S]+?)\$turn_usd_stop_change\$/)
 if(usdStopChange){
  const row=seed.find(row=>row.key==='agent-contract.ask-bob');const{seed_version,source_revision,...rest}=row.metadata??{}
  row.metadata={...rest,publication:'bob-turn-usd-stop-v2',...JSON.parse(usdStopChange[1])};versions.set(row.key,versions.get(row.key)!+1)
 }
 const contractFlags=source.match(/\$contract_flags_change\$([\s\S]+?)\$contract_flags_change\$/)
 if(contractFlags){
  const publication=source.match(/'publication','([a-z0-9-]+)'/)?.[1]??'contract-flags'
  const row=seed.find(row=>row.key==='agent-contract.ask-bob');const{seed_version,source_revision,...rest}=row.metadata??{}
  row.metadata={...rest,publication,...JSON.parse(contractFlags[1])};versions.set(row.key,versions.get(row.key)!+1)
 }
 const completeContext=source.match(/\$bob_complete_context_patches\$([\s\S]+?)\$bob_complete_context_patches\$/)
 if(completeContext){
  preCompleteContextRows=structuredClone(seed);preCompleteContextVersions=new Map(versions)
  for(const patch of JSON.parse(completeContext[1])){
   const row=seed.find(row=>row.key===patch.key);row.definition={...row.definition,...patch.definition}
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'bob-complete-context-v1',...patch.metadata};versions.set(row.key,versions.get(row.key)!+1)
   if(patch.content!==undefined)row.content=patch.content
   if(patch.workflow_method)row.definition.workflows.find((w:any)=>w.name==='workflow_construction_drawing').method=patch.workflow_method
  }
 }
 const selective=source.match(/\$selective_tools_patches\$([\s\S]+?)\$selective_tools_patches\$/)
 if(selective){
  preSelectiveToolsRows=structuredClone(seed);preSelectiveToolsVersions=new Map(versions)
  const method=source.match(/\$selective_construction_method\$([\s\S]+?)\$selective_construction_method\$/)![1]
  for(const patch of JSON.parse(selective[1])){
   const row=seed.find(row=>row.key===patch.key);row.definition={...row.definition,...patch.definition}
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'selective-tools-v1',...patch.metadata};versions.set(row.key,versions.get(row.key)!+1)
   if(patch.content!==undefined)row.content=patch.content
   if(patch.key==='bob.workflows'){const w=row.definition.workflows.find((w:any)=>w.name==='workflow_construction_drawing');w.method+=method;w.tools.push('plan_cad_pieces')}
  }
 }
 const constructionViews=source.match(/\$construction_view_patches\$([\s\S]+?)\$construction_view_patches\$/)
 if(constructionViews){
  preConstructionViewsRows=structuredClone(seed);preConstructionViewsVersions=new Map(versions)
  const patches=JSON.parse(constructionViews[1]),manual=source.match(/\$construction_view_manual\$([\s\S]+?)\$construction_view_manual\$/)![1]
  for(const patch of [...patches,{key:'bob.workflows',definition:{},metadata:{}}]){
   const row=seed.find(row=>row.key===patch.key);row.definition={...row.definition,...patch.definition}
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'construction-views-v1',...patch.metadata};versions.set(row.key,versions.get(row.key)!+1)
   if(patch.key==='bob.workflows')row.definition.workflows.find((w:any)=>w.name==='workflow_construction_drawing').method+=manual
   else if(patch.key!=='tools.read_construction_draft')row.definition.additional_description=(row.definition.additional_description??'')+manual
  }
 }
 const constructionEdit=source.match(/\$construction_edit_contract\$([\s\S]+?)\$construction_edit_contract\$/)
 if(constructionEdit){
  preConstructionEditsRows=structuredClone(seed);preConstructionEditsVersions=new Map(versions)
  const patch=JSON.parse(constructionEdit[1]),policy=JSON.parse(source.match(/\$construction_edit_policy\$([\s\S]+?)\$construction_edit_policy\$/)![1])
  const manual=source.match(/\$construction_edit_manual\$([\s\S]+?)\$construction_edit_manual\$/)![1]
  const publish=(row:any)=>{const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'construction-edits-v1'};versions.set(row.key,(versions.get(row.key)??0)+1)}
  const row=structuredClone(seed.find(row=>row.key==='tools.save_construction_draft'));row.key='tools.edit_construction_parts'
  row.definition={...row.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[],card_description:policy.description,additional_description:policy.how_to}
  seed.push(row);publish(row)
  for(const key of ['tools.save_construction_draft','tools.change_construction_parameters','bob.tools','bob.workflows']){
   const r=seed.find(row=>row.key===key);publish(r)
   if(key==='bob.tools'){r.definition.catalog.push(policy);r.definition.contract_keys.push('tools.edit_construction_parts');r.definition.shelves.find((s:any)=>s.label==='Drawings and CAD').tools.push('edit_construction_parts')}
   else if(key==='bob.workflows'){const w=r.definition.workflows.find((w:any)=>w.name==='workflow_construction_drawing');w.tools.push('edit_construction_parts');w.method+=manual}
   else {r.definition.additional_description=(r.definition.additional_description??'')+manual;if(key==='tools.change_construction_parameters')r.definition.description=r.definition.description.replace('Use save_construction_draft for topology/material/formula changes.','Use edit_construction_parts for topology/material/formula changes.')}
  }
 }
 const buildingScope=source.match(/\$building_scope_contracts\$([\s\S]+?)\$building_scope_contracts\$/)
 if(buildingScope){
  preBuildingScopeRows=structuredClone(seed);preBuildingScopeVersions=new Map(versions)
  const read=(tag:string)=>JSON.parse(source.match(new RegExp('\\$'+tag+'\\$([\\s\\S]+?)\\$'+tag+'\\$'))![1])
  const policies=read('building_scope_policies'),manual=read('building_scope_manual'),workflow=read('building_scope_workflow'),contracts=JSON.parse(buildingScope[1])
  const publish=(row:any)=>{const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'building-scope-v1'};versions.set(row.key,(versions.get(row.key)??0)+1)}
  const template=seed.find(row=>row.key==='tools.read_plan_link_context')
  for(const patch of contracts){
   const policy=policies.find((p:any)=>p.name===patch.name),row=structuredClone(template);row.key='tools.'+patch.name
   row.definition={...row.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[],card_description:policy.description,additional_description:policy.how_to}
   row.metadata={publication:'building-scope-v1',server_fields:patch.parameters.required.includes('request_quote')?['request_quote']:[]}
   seed.push(row);versions.set(row.key,1)
  }
  const intake=seed.find(row=>row.key==='tools.save_building_context');publish(intake)
  intake.definition.additional_description=intake.definition.additional_description.replace(manual.from,manual.to)
  const box=seed.find(row=>row.key==='bob.tools');publish(box)
  for(const policy of policies){box.definition.catalog.push(policy);box.definition.contract_keys.push('tools.'+policy.name)}
  const shelf=box.definition.shelves.find((s:any)=>s.label==='Building and site');shelf.tools=[...contracts.map((c:any)=>c.name),...shelf.tools]
  const flows=seed.find(row=>row.key==='bob.workflows');publish(flows)
  const w=flows.definition.workflows.find((w:any)=>w.name===workflow.name);w.card=workflow.card;w.tools.push(...contracts.map((c:any)=>c.name));w.method+=workflow.method
 }
 const roomDimensions=source.match(/\$room_dimensions_spec\$([\s\S]+?)\$room_dimensions_spec\$/)
 if(roomDimensions){
  const spec=JSON.parse(roomDimensions[1]),row=seed.find(row=>row.key===spec.key),dataset=row.definition.parameters.properties.dataset
  if(!dataset.enum.includes(spec.dataset)){
   dataset.enum=[...spec.datasets];dataset.description+=spec.note
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'room-dimensions-v1'};versions.set(row.key,versions.get(row.key)!+1)
  }
 }
 const jointFasteners=source.match(/\$joint_fasteners_spec\$([\s\S]+?)\$joint_fasteners_spec\$/)
 if(jointFasteners){
  const spec=JSON.parse(jointFasteners[1]),before=JSON.stringify(spec.before)
  // Same walk as the SQL publication: object key order is irrelevant there.
  const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)
  const target=canonical(JSON.parse(before))
  const walk=(v:any):any=>canonical(v)===target?structuredClone(spec.after):Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)])):v
  for(const patch of spec.patches){
   const row=seed.find(row=>row.key===patch.key)
   if(row.metadata?.joint_fastener_version===1)continue
   row.definition=walk(row.definition)
   row.definition.additional_description=(row.definition.additional_description??'')+patch.note
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'joint-fasteners-v1',joint_fastener_version:1};versions.set(row.key,versions.get(row.key)!+1)
  }
 }
 const exactFasteners=source.match(/\$exact_fasteners_spec\$([\s\S]+?)\$exact_fasteners_spec\$/)
 if(exactFasteners){
  for(const patch of JSON.parse(exactFasteners[1]).patches){
   const row=seed.find(row=>row.key===patch.key)
   if(row.metadata?.exact_fastener_version===1)continue
   if(row.metadata?.joint_fastener_version!==1)throw new Error('exact_fasteners_requires_joint_fasteners: '+patch.key)
   row.definition.additional_description=(row.definition.additional_description??'')+patch.note
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'exact-fasteners-v1',exact_fastener_version:1};versions.set(row.key,versions.get(row.key)!+1)
  }
 }
 const memoryPointers=source.match(/\$memory_pointer_instructions\$([\s\S]+?)\$memory_pointer_instructions\$/)
 if(memoryPointers){
  for(const key of ['context-summary.contract','schema.bob_conversation_brief_v2']){
   const row=seed.find(row=>row.key===key)
   const{seed_version,source_revision,...rest}=row.metadata??{}
   row.metadata={...rest,publication:'bob-memory-pointer-scope-v1',...(key.startsWith('schema.')?{memory_pointer_scope_version:1}:{})}
   if(key==='context-summary.contract')row.content+='\n\n'+memoryPointers[1]
   versions.set(key,versions.get(key)!+1)
  }
 }
 const memoryGist=source.match(/\$memory_gist_only_instructions\$([\s\S]+?)\$memory_gist_only_instructions\$/)
 if(memoryGist){
  for(const key of ['context-summary.contract','schema.bob_conversation_brief_v2']){
   const row=seed.find(row=>row.key===key)
   const{seed_version,source_revision,memory_pointer_scope_version,...rest}=row.metadata??{}
   row.metadata={...rest,publication:'bob-memory-gist-only-v1',...(key.startsWith('schema.')?{memory_gist_only_version:1}:{})}
   if(key==='context-summary.contract')row.content=memoryGist[1]
   else row.definition=JSON.parse(source.match(/\$memory_gist_schema\$([\s\S]+?)\$memory_gist_schema\$/)![1])
   versions.set(key,versions.get(key)!+1)
  }
 }
 const workflows=source.match(/\$bob_workflows\$([\s\S]+?)\$bob_workflows\$/)
 if(workflows){
  seed.push({key:'bob.workflows',kind:'agent_contract',content:source.match(/\$bob_workflows_intro\$([\s\S]+?)\$bob_workflows_intro\$/)![1],definition:JSON.parse(workflows[1]),variables:[],metadata:{publication:'bob-workflows-judgement-v1'}})
  versions.set('bob.workflows',1)
  const row=seed.find(row=>row.key==='bob.context-principles')
  const{seed_version,source_revision,...rest}=row.metadata??{}
  row.metadata={...rest,publication:'bob-workflows-judgement-v1'}
  row.content+='\n'+source.match(/\$bob_judgement_principles\$([\s\S]+?)\$bob_judgement_principles\$/)![1]
  versions.set(row.key,versions.get(row.key)!+1)
 }
 const memoryStair=source.match(/\$memory_stair_additions\$([\s\S]+?)\$memory_stair_additions\$/)
 if(memoryStair){
  preMemoryStairRows=structuredClone(seed);preMemoryStairVersions=new Map(versions)
  for(const addition of JSON.parse(memoryStair[1])){seed.push({content:'',definition:{},variables:[],...addition,metadata:{publication:'bob-memory-stair-v1'}});versions.set(addition.key,1)}
  const contract=seed.find(row=>row.key==='agent-contract.ask-bob')
  publishAs(contract,'bob-memory-stair-v1');contract.metadata.memory_stair_version=1;contract.metadata.prompt_tiers_version=1;versions.set(contract.key,versions.get(contract.key)!+1)
 }
 for(const [tag,profile,publication] of [['bob_mini_routing_trial','profile.ask-bob-mini','bob-mini-routing-trial-v1'],['bob_mini_routing_trial_end','profile.ask-bob','bob-mini-routing-trial-end-v1']] as const)if(new RegExp('\\$'+tag+'\\$').test(source)){
  const routing=seed.find(row=>row.key==='routing.ask-bob')
  routing.definition={...routing.definition,default_profile_key:profile};publishAs(routing,publication);versions.set(routing.key,versions.get(routing.key)!+1)
 }
 const plainWords=source.match(/\$plain_words_paragraph\$([\s\S]+?)\$plain_words_paragraph\$/)
 if(plainWords&&/\$bob_plain_words_persona\$/.test(source)){
  const persona=seed.find(row=>row.key==='bob.persona')
  persona.content=persona.content+'\n\n'+plainWords[1];publishAs(persona,'bob-plain-words-v1');persona.metadata.plain_words_version=1;versions.set(persona.key,versions.get(persona.key)!+1)
 }
 if(/\$bob_mini_trial\$/.test(source)){
  const base=seed.find(row=>row.key==='profile.ask-bob')
  seed.push({key:'profile.ask-bob-mini',kind:'execution_profile',content:'',definition:{...base.definition,tier:'mini'},variables:[],metadata:{publication:'bob-mini-trial-v1'}});versions.set('profile.ask-bob-mini',1)
  const role=seed.find(row=>row.key==='role.ask-bob')
  role.definition={...role.definition,profile_key:'profile.ask-bob-mini'};publishAs(role,'bob-mini-trial-v1');versions.set(role.key,versions.get(role.key)!+1)
 }
 if(/\$bob_mini_trial_end\$/.test(source)){
  const role=seed.find(row=>row.key==='role.ask-bob')
  role.definition={...role.definition,profile_key:'profile.ask-bob'};publishAs(role,'bob-mini-trial-end-v1');versions.set(role.key,versions.get(role.key)!+1)
 }
 const materialsWorker=source.match(/\$materials_worker_additions\$([\s\S]+?)\$materials_worker_additions\$/)
 if(materialsWorker){
  preMaterialsWorkerRows=structuredClone(seed);preMaterialsWorkerVersions=new Map(versions)
  const additions=JSON.parse(materialsWorker[1])
  for(const addition of additions){seed.push({content:'',definition:{},variables:[],...addition,metadata:{publication:'bob-materials-worker-v1'}});versions.set(addition.key,1)}
  const worker=JSON.parse(source.match(/\$materials_worker_definition\$([\s\S]+?)\$materials_worker_definition\$/)![1])
  const tool=additions.find((a:any)=>a.key==='tools.ask_materials_worker').definition
  const policy={name:'ask_materials_worker',description:tool.description,how_to:tool.additional_description,schema_version:1,always_load:false,preload_phases:[],active:true}
  const box=seed.find(row=>row.key==='bob.tools')
  box.definition={...box.definition,materials_worker_version:1,workers:{materials:worker},
   contract_keys:[...box.definition.contract_keys,'tools.ask_materials_worker'],catalog:[...box.definition.catalog,policy],
   shelves:box.definition.shelves.map((shelf:any)=>shelf.label==='Materials, stock and Shopping'?{...shelf,tools:['ask_materials_worker',...shelf.tools]}:shelf)}
  publishAs(box,'bob-materials-worker-v1');box.metadata.materials_worker_version=1;versions.set(box.key,versions.get(box.key)!+1)
 }
 const buildWorkers=source.match(/\$build_workers_additions\$([\s\S]+?)\$build_workers_additions\$/)
 if(buildWorkers){
  preBuildWorkersRows=structuredClone(seed);preBuildWorkersVersions=new Map(versions)
  const additions=JSON.parse(buildWorkers[1]),publication='bob-build-workers-v1'
  for(const {variables,...addition} of additions){seed.push({content:'',definition:{},...addition,variables:variables??[],metadata:{publication}});versions.set(addition.key,1)}
  for(const edit of JSON.parse(source.match(/\$build_workers_edits\$([\s\S]+?)\$build_workers_edits\$/)![1])){
   const row=seed.find(row=>row.key===edit.key)
   if(edit.old_content!==undefined&&row.content!==edit.old_content)throw new Error('build_workers_edit_unexpected: '+edit.key)
   if(edit.content!==undefined)row.content=edit.content
   if(edit.variables)row.variables=edit.variables
   if(edit.definition)row.definition={...row.definition,...edit.definition}
   for(const {field,path,old,new:next} of edit.replace??[]){
    const keys:(string|number)[]=path?path.map((k:string)=>/^\d+$/.test(k)?Number(k):k):[field]
    if(field!=='content')row.definition=structuredClone(row.definition)
    const parent=field==='content'?null:keys.slice(0,-1).reduce((o:any,k)=>o?.[k],row.definition)
    const text=field==='content'?row.content:parent?.[keys.at(-1)!]
    if(typeof text!=='string'||text.split(old).length!==2)throw new Error('build_workers_replace_unexpected: '+edit.key+' '+(path??[field]).join('.'))
    if(field==='content')row.content=text.replace(old,()=>next);else parent[keys.at(-1)!]=text.replace(old,()=>next)
   }
   publishAs(row,publication);row.metadata.build_workers_version=1;versions.set(row.key,versions.get(row.key)!+1)
  }
  const workers=JSON.parse(source.match(/\$build_workers_definition\$([\s\S]+?)\$build_workers_definition\$/)![1])
  const materials=JSON.parse(source.match(/\$build_workers_materials\$([\s\S]+?)\$build_workers_materials\$/)![1])
  const retired=JSON.parse(source.match(/\$build_workers_retired\$([\s\S]+?)\$build_workers_retired\$/)![1])
  const policies=Object.values(workers).map((worker:any)=>{const tool=additions.find((a:any)=>a.key==='tools.'+worker.tool).definition
   return {name:worker.tool,description:tool.description,how_to:tool.additional_description,schema_version:1,always_load:false,preload_phases:[],active:true}})
  const box=seed.find(row=>row.key==='bob.tools')
  box.definition={...box.definition,build_workers_version:1,build_workers:workers,retired_tools:retired,
   workers:{...box.definition.workers,materials:{...box.definition.workers.materials,knowledge:materials.knowledge}},
   contract_keys:[...box.definition.contract_keys,...policies.map(p=>'tools.'+p.name)],
   catalog:[...box.definition.catalog.map((c:any)=>c.name==='ask_materials_worker'?materials.policy:c),...policies],
   shelves:box.definition.shelves.map((shelf:any)=>shelf.label==='Drawings and CAD'?{...shelf,tools:[...policies.map(p=>p.name),...shelf.tools]}:shelf)}
  publishAs(box,publication);box.metadata.build_workers_version=1;versions.set(box.key,versions.get(box.key)!+1)
 }
 const checkReads=source.match(/\$bob_check_reads_list\$([\s\S]+?)\$bob_check_reads_list\$/)
 if(checkReads){
  const box=seed.find(row=>row.key==='bob.tools')
  box.definition={...box.definition,check_reads:JSON.parse(checkReads[1])};publishAs(box,'bob-check-reads-v1');versions.set(box.key,versions.get(box.key)!+1)
 }
 const readbackEdits=source.match(/\$bob_report_readback_edits\$([\s\S]+?)\$bob_report_readback_edits\$/)
 if(readbackEdits){
  const publication='bob-report-readback-v1'
  for(const edit of JSON.parse(readbackEdits[1])){
   const row=seed.find(row=>row.key===edit.key)
   for(const {field,path,old,new:next} of edit.replace??[]){
    const keys:(string|number)[]=path?path.map((k:string)=>/^\d+$/.test(k)?Number(k):k):[field]
    if(field!=='content')row.definition=structuredClone(row.definition)
    const parent=field==='content'?null:keys.slice(0,-1).reduce((o:any,k)=>o?.[k],row.definition)
    const text=field==='content'?row.content:parent?.[keys.at(-1)!]
    if(typeof text!=='string'||text.split(old).length!==2)throw new Error('report_readback_replace_unexpected: '+edit.key+' '+(path??[field]).join('.'))
    if(field==='content')row.content=text.replace(old,()=>next);else parent[keys.at(-1)!]=text.replace(old,()=>next)
   }
   publishAs(row,publication);versions.set(row.key,versions.get(row.key)!+1)
  }
  const howTo=JSON.parse(source.match(/\$bob_report_readback_how_to\$([\s\S]+?)\$bob_report_readback_how_to\$/)![1])
  const box=seed.find(row=>row.key==='bob.tools')
  box.definition={...box.definition,report_readback_version:1,catalog:box.definition.catalog.map((c:any)=>c.name in howTo?{...c,how_to:howTo[c.name]}:c)};publishAs(box,publication);versions.set(box.key,versions.get(box.key)!+1)
 }
 // Small publications from scratchpad gen-publication.py: text edits, bob.tools switches, policy how_to copies.
 const publicationSpec=source.match(/\$bob_catalog_publication\$([\s\S]+?)\$bob_catalog_publication\$/)
 if(publicationSpec){
  const spec=JSON.parse(publicationSpec[1])
  if(spec.publication==='bob-konrad-lean-v1'){preKonradLeanRows=structuredClone(seed);preKonradLeanVersions=new Map(versions)}
  if(spec.publication==='bob-finder-save-fixes-v1'){preMaterialFinderTeamRows=structuredClone(seed);preMaterialFinderTeamVersions=new Map(versions)}
  // 2026-11-01: publications may also add rows, set definition paths, add
  // metadata and change the toolbox by path (the SQL applies the same spec).
  for(const {key,kind,content,definition,metadata} of spec.additions??[]){
   if(seed.some(row=>row.key===key))throw new Error('publication_already_published: '+key)
   seed.push({key,kind,content:content??'',definition:definition??{},variables:[],metadata:{...metadata,publication:spec.publication}});versions.set(key,1)
  }
  // Swaps replace every equal subtree of the parameters, with an exact count.
  const swapIn=(node:any,old:string,next:any,hits:{n:number}):any=>{
   if(JSON.stringify(node)===old){hits.n++;return structuredClone(next)}
   if(Array.isArray(node))return node.map(x=>swapIn(x,old,next,hits))
   if(node&&typeof node==='object')return Object.fromEntries(Object.entries(node).map(([k,v])=>[k,swapIn(v,old,next,hits)]))
   return node
  }
  for(const edit of spec.edits){
   const row=seed.find(row=>row.key===edit.key)
   for(const {old,new:next,count} of edit.swap??[]){
    const hits={n:0},parameters=swapIn(row.definition.parameters,JSON.stringify(old),next,hits)
    if(hits.n!==count)throw new Error('publication_swap_unexpected: '+edit.key)
    row.definition={...row.definition,parameters}
   }
   for(const {path,value} of edit.set??[]){
    row.definition=structuredClone(row.definition)
    const parent=path.slice(0,-1).reduce((o:any,k:string)=>o?.[k],row.definition)
    if(!parent||!(path.at(-1) in parent))throw new Error('publication_set_missing: '+edit.key+' '+path.join('.'))
    parent[path.at(-1)]=structuredClone(value)
   }
   for(const {field,path,old,new:next} of edit.replace??[]){
    const keys:(string|number)[]=path?path.map((k:string)=>/^\d+$/.test(k)?Number(k):k):[field]
    if(field!=='content')row.definition=structuredClone(row.definition)
    const parent=field==='content'?null:keys.slice(0,-1).reduce((o:any,k)=>o?.[k],row.definition)
    const text=field==='content'?row.content:parent?.[keys.at(-1)!]
    if(typeof text!=='string'||text.split(old).length!==2)throw new Error('publication_replace_unexpected: '+edit.key+' '+(path??[field]).join('.'))
    if(field==='content')row.content=text.replace(old,()=>next);else parent[keys.at(-1)!]=text.replace(old,()=>next)
   }
   publishAs(row,spec.publication);if(edit.metadata)row.metadata={...row.metadata,...edit.metadata,publication:spec.publication};versions.set(row.key,versions.get(row.key)!+1)
  }
  const box=seed.find(row=>row.key==='bob.tools')
  box.definition={...box.definition,...spec.flags,catalog:box.definition.catalog.map((c:any)=>c.name in spec.how_to?{...c,how_to:spec.how_to[c.name]}:c)}
  for(const {path,old,value} of spec.toolbox_set??[]){
   box.definition=structuredClone(box.definition)
   const parent=path.slice(0,-1).reduce((o:any,k:string)=>o?.[k],box.definition)
   if(!parent||!(path.at(-1) in parent))throw new Error('publication_toolbox_set_missing: '+path.join('.'))
   if(JSON.stringify(parent[path.at(-1)])!==JSON.stringify(old))throw new Error('publication_toolbox_set_changed: '+path.join('.'))
   parent[path.at(-1)]=structuredClone(value)
  }
  for(const {path,values} of spec.toolbox_append??[]){
   box.definition=structuredClone(box.definition)
   const parent=path.slice(0,-1).reduce((o:any,k:string)=>o?.[k],box.definition)
   if(!Array.isArray(parent?.[path.at(-1)]))throw new Error('publication_toolbox_append_missing: '+path.join('.'))
   parent[path.at(-1)]=[...parent[path.at(-1)],...structuredClone(values)]
  }
  publishAs(box,spec.publication);versions.set(box.key,versions.get(box.key)!+1)
 }
 if(/\$bob_tool_order_restore\$/.test(source)){
  preToolOrderRestoreRows=structuredClone(seed);preToolOrderRestoreVersions=new Map(versions)
  const box=seed.find(row=>row.key==='bob.tools')
  const{tool_sheets_version:_s,tool_repair_version:_r,...definition}=box.definition;box.definition={...definition,tool_order_version:1}
  publishAs(box,'tool-order-restore-v1');delete box.metadata.tool_sheets_version;delete box.metadata.tool_repair_version;box.metadata.tool_order_version=1;versions.set(box.key,versions.get(box.key)!+1)
 }
 const toolRepair=source.match(/\$tool_repair_additions\$([\s\S]+?)\$tool_repair_additions\$/)
 if(toolRepair){
  preToolRepairRows=structuredClone(seed);preToolRepairVersions=new Map(versions)
  for(const addition of JSON.parse(toolRepair[1])){seed.push({content:'',definition:{},variables:[],...addition,metadata:{publication:'bob-tool-repair-v1'}});versions.set(addition.key,1)}
  const box=seed.find(row=>row.key==='bob.tools')
  const{tool_order_version:_o,...definition}=box.definition;box.definition={...definition,tool_sheets_version:1,tool_repair_version:1}
  publishAs(box,'bob-tool-repair-v1');delete box.metadata.tool_order_version;box.metadata.tool_sheets_version=1;box.metadata.tool_repair_version=1;versions.set(box.key,versions.get(box.key)!+1)
 }
 if(/\$bob_tool_order\$/.test(source)){
  preToolOrderRows=structuredClone(seed);preToolOrderVersions=new Map(versions)
  const box=seed.find(row=>row.key==='bob.tools')
  const{tool_sheets_version:_d,...definition}=box.definition;box.definition={...definition,tool_order_version:1}
  publishAs(box,'tool-order-v1');delete box.metadata.tool_sheets_version;box.metadata.tool_order_version=1;versions.set(box.key,versions.get(box.key)!+1)
 }
 const toolSheets=source.match(/\$tool_sheets_additions\$([\s\S]+?)\$tool_sheets_additions\$/)
 if(toolSheets){
  preToolSheetsRows=structuredClone(seed);preToolSheetsVersions=new Map(versions)
  for(const addition of JSON.parse(toolSheets[1])){seed.push({content:'',definition:{},variables:[],...addition,metadata:{publication:'tool-sheets-v1'}});versions.set(addition.key,1)}
  const box=seed.find(row=>row.key==='bob.tools')
  box.definition={...box.definition,tool_sheets_version:1,contract_keys:[...box.definition.contract_keys,'tools.use_tool']}
  publishAs(box,'tool-sheets-v1');box.metadata.tool_sheets_version=1;versions.set(box.key,versions.get(box.key)!+1)
 }
 const toolPicker=source.match(/\$tool_picker_additions\$([\s\S]+?)\$tool_picker_additions\$/)
 if(toolPicker){
  preToolPickerRows=structuredClone(seed);preToolPickerVersions=new Map(versions)
  for(const addition of JSON.parse(toolPicker[1])){seed.push({content:'',definition:{},variables:[],...addition,metadata:{publication:'bob-tool-picker-v1'}});versions.set(addition.key,1)}
 }
 const completionGate=source.match(/\$completion_gate_additions\$([\s\S]+?)\$completion_gate_additions\$/)
 if(completionGate)for(const addition of JSON.parse(completionGate[1])){
  seed.push({content:'',definition:{},variables:[],...addition,metadata:{publication:'bob-completion-gate-v1'}})
  versions.set(addition.key,1)
 }
 // Inert FORM 3 source reader: role disabled, tool policy inactive.
 const sourceReader=source.match(/\$source_reader_additions\$([\s\S]+?)\$source_reader_additions\$/)
 if(sourceReader)for(const addition of JSON.parse(sourceReader[1])){
  seed.push({content:'',definition:{},variables:[],...addition,metadata:{publication:'source-reader-v1'}})
  versions.set(addition.key,1)
 }
 // Inert publication: the role stays disabled until a later, approved enablement.
 const targetedCadReview=source.match(/\$targeted_cad_review_additions\$([\s\S]+?)\$targeted_cad_review_additions\$/)
 if(targetedCadReview)for(const {metadata,...addition} of JSON.parse(targetedCadReview[1])){
  seed.push({content:'',definition:{},variables:[],...addition,metadata:{publication:'targeted-cad-review-v1',...metadata}})
  versions.set(addition.key,1)
 }
 const coverageAdditions=source.match(/\$context_coverage_additions\$([\s\S]+?)\$context_coverage_additions\$/)
 if(coverageAdditions){
  preContextCoverageRows=structuredClone(seed);preContextCoverageVersions=new Map(versions)
  const read=(tag:string)=>JSON.parse(source.match(new RegExp('\\$'+tag+'\\$([\\s\\S]+?)\\$'+tag+'\\$'))![1])
  const publish=(row:any)=>{const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'bob-context-coverage-v1'};versions.set(row.key,(versions.get(row.key)??0)+1)}
  for(const addition of JSON.parse(coverageAdditions[1])){const row={content:'',definition:{},variables:[],...addition};seed.push(row);publish(row)}
  for(const patch of read('context_coverage_edits')){
   const row=seed.find(row=>row.key===patch.key);publish(row)
   row.definition={...row.definition,...patch.definition};row.metadata={...row.metadata,...patch.metadata}
   if(patch.append_prompt_keys)row.definition.prompt_keys.push(...patch.append_prompt_keys.filter((k:string)=>!row.definition.prompt_keys.includes(k)))
   if(patch.append_tool_keys)row.definition.tool_keys.push(...patch.append_tool_keys.filter((k:string)=>!row.definition.tool_keys.includes(k)))
   if(patch.append_manual&&!row.definition.additional_description.includes(patch.append_manual))row.definition.additional_description+=patch.append_manual
   if(patch.remove_roles)row.definition.colleagues=row.definition.colleagues.filter((c:any)=>!patch.remove_roles.includes(c.role_key)).map((c:any)=>({...c,...patch.colleague_edits.find((e:any)=>e.role_key===c.role_key)}))
  }
  const retired=read('context_coverage_retired'),box=seed.find(row=>row.key==='bob.tools');publish(box)
  box.definition.contract_keys=box.definition.contract_keys.filter((k:string)=>!retired.includes(k))
  for(const policy of read('context_coverage_policies')){
   box.definition.catalog=box.definition.catalog.filter((p:any)=>p.name!==policy.name).concat(policy)
   if(!box.definition.contract_keys.includes('tools.'+policy.name))box.definition.contract_keys.push('tools.'+policy.name)
  }
  const shellManual=source.match(/\$context_coverage_shell_manual\$([\s\S]+?)\$context_coverage_shell_manual\$/)![1]
  const shellPolicy=box.definition.catalog.find((p:any)=>p.name==='read_cad_shell');if(!shellPolicy.how_to.includes(shellManual))shellPolicy.how_to+=shellManual
  const shelf=box.definition.shelves.find((s:any)=>s.label==='Project records and memory');if(!shelf.tools.includes('read_project_orientation'))shelf.tools.push('read_project_orientation')
  for(let i=seed.length-1;i>=0;i--)if(retired.includes(seed[i].key))seed.splice(i,1)
 }
 const contextAdditions=source.match(/\$context_strategy_additions\$([\s\S]+?)\$context_strategy_additions\$/)
 if(contextAdditions){
  preContextStrategyRows=structuredClone(seed);preContextStrategyVersions=new Map(versions)
  const publish=(row:any)=>{const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'bob-context-strategy-v1'};versions.set(row.key,(versions.get(row.key)??0)+1)}
  for(const addition of JSON.parse(contextAdditions[1])){const row={content:'',definition:{},variables:[],...addition};seed.push(row);publish(row)}
  for(const patch of JSON.parse(source.match(/\$context_strategy_edits\$([\s\S]+?)\$context_strategy_edits\$/)![1])){
   const row=seed.find(row=>row.key===patch.key);publish(row)
   row.definition={...row.definition,...patch.definition};row.metadata={...row.metadata,...patch.metadata}
   if(patch.content!==undefined)row.content=patch.content
   if(patch.prompt_keys)row.definition.prompt_keys=[...row.definition.prompt_keys.filter((k:string)=>!patch.prompt_keys.remove.includes(k)),...patch.prompt_keys.append]
  }
  for(const patch of JSON.parse(source.match(/\$context_strategy_cards\$([\s\S]+?)\$context_strategy_cards\$/)![1])){
   const row=seed.find(row=>row.key===patch.key);publish(row)
   row.definition={...row.definition,...patch.definition,card_description:patch.description,...(patch.key==='tools.describe_tool'?{description:patch.description}:{})}
  }
  const policy=JSON.parse(source.match(/\$context_strategy_history_policy\$([\s\S]+?)\$context_strategy_history_policy\$/)![1]),box=seed.find(row=>row.key==='bob.tools');publish(box)
  box.definition.catalog.push(policy);box.definition.contract_keys.push('tools.read_conversation_message');box.definition.shelves.find((s:any)=>s.label==='Project records and memory').tools.push(policy.name)
 }
 const boundEditContracts=source.match(/\$bound_edit_contracts\$([\s\S]+?)\$bound_edit_contracts\$/)??source.match(/\$model_feedback_contracts\$([\s\S]+?)\$model_feedback_contracts\$/)
 if(boundEditContracts){
  const policies=JSON.parse((source.match(/\$bound_edit_policies\$([\s\S]+?)\$bound_edit_policies\$/)??source.match(/\$model_feedback_policies\$([\s\S]+?)\$model_feedback_policies\$/))![1])
  for(const patch of JSON.parse(boundEditContracts[1])){
   const row=structuredClone(seed.find(row=>row.key==='tools.save_project_description'));row.key='tools.'+patch.name
   row.definition={...row.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[],additional_description:policies.find((p:any)=>p.name===patch.name).how_to}
   row.definition.envelope.schema_version=1
   if(source.includes('$model_feedback_contracts$'))row.definition.card_description=policies.find((p:any)=>p.name===patch.name).description
   row.metadata={publication:source.includes('$model_feedback_contracts$')?'model-feedback-v1':'server-bound-edits',server_fields:patch.parameters.required.includes('request_quote')?['request_quote']:[]}
   seed.push(row);versions.set(row.key,1)
  }
  for(const patch of JSON.parse(source.match(/\$bound_edit_append\$([\s\S]+?)\$bound_edit_append\$/)?.[1]??'[]')){
   const row=seed.find(row=>row.key===patch.key);row.definition.additional_description=(row.definition.additional_description??'')+patch.text;versions.set(row.key,versions.get(row.key)!+1)
  }
  const box=seed.find(row=>row.key==='bob.tools');versions.set(box.key,versions.get(box.key)!+1)
  if(source.includes('$model_feedback_contracts$')){const{seed_version,source_revision,...rest}=box.metadata??{};box.metadata={...rest,publication:'model-feedback-v1'}}
  for(const policy of policies){box.definition.catalog.push(policy);box.definition.contract_keys.push('tools.'+policy.name);box.definition.shelves.find((s:any)=>s.label===(source.includes("='Living plan'")?'Living plan':'Project records and memory')).tools.push(policy.name)}
 }
 const modelFeedbackWorkflow=source.match(/\$model_feedback_workflow\$([\s\S]+?)\$model_feedback_workflow\$/)
 if(modelFeedbackWorkflow){
  const patch=JSON.parse(modelFeedbackWorkflow[1]),row=seed.find(row=>row.key==='bob.workflows'),workflow=row.definition.workflows.find((w:any)=>w.name===patch.name)
  workflow.tools.push(...patch.tools);workflow.method+=patch.method;versions.set(row.key,versions.get(row.key)!+1)
  const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'model-feedback-v1'}
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
  tool.definition.additional_description=(tool.definition.additional_description??'').replace(oldGuard,'').replace(/^ +| +$/g,'')
  versions.set(tool.key,versions.get(tool.key)!+1)
  const resume=seed.find(row=>row.key==='feedback.bob-budget-stop.resume.9c3a74e182d5')
  resume.content=resumeGuidance[1];versions.set(resume.key,versions.get(resume.key)!+1)
 }
 if(source.includes('do $communication$')){
  const content=source.match(/'(När du formulerar besked[^']+)'/)?.[1]
  if(!content)throw new Error('Concise communication migration content missing')
  const [,label,purpose]=source.match(/jsonb_build_object\('label','([^']+)',\s*'purpose','([^']+)'\)/)!
  seed.push({key:'communication.concise',kind:'instruction_fragment',content,definition:{},metadata:{label,purpose},variables:[]})
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
   publishAs(row,'checked-construction-required');versions.set(key,versions.get(key)!+1)
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
   row.definition.additional_description=patch.name==='change_construction_parameters'?policy.how_to:(row.definition.additional_description??'')+' For a changed construction, use change_construction_parameters, check its receipt revision and pass that exact construction_revision. Rendering cannot substitute a newer design.'
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
   publishAs(row,'construction-instance-roles-and-consequences');versions.set(key,(versions.get(key)??0)+1)
  }
  const box=seed.find(row=>row.key==='bob.tools');box.definition.catalog.push(...policies);publishAs(box,'construction-instance-roles-and-consequences')
  box.definition.contract_keys.push(...policies.map((p:any)=>'tools.'+p.name));box.definition.shelves.find((s:any)=>s.label==='Drawings and CAD').tools.push(...policies.map((p:any)=>p.name))
  versions.set(box.key,versions.get(box.key)!+1)
 }
 // Read tools published from the read_construction_changes template: FORM 4b
 // delivery readback (#357) and the inactive FORM 3 task source packet.
 for(const [tag,publication,shelfLabel] of [['construction_delivery','construction-delivery-v1','Drawings and CAD'],['task_sources','task-sources-v1','Project records and memory'],['source_findings','source-reader-v1','Project records and memory']] as const){
  const contracts=source.match(new RegExp('\\$'+tag+'_contracts\\$([\\s\\S]+?)\\$'+tag+'_contracts\\$'))
  if(!contracts)continue
  const policies=JSON.parse(source.match(new RegExp('\\$'+tag+'_policies\\$([\\s\\S]+?)\\$'+tag+'_policies\\$'))![1])
  for(const patch of JSON.parse(contracts[1])){
   const policy=policies.find((p:any)=>p.name===patch.name),row=structuredClone(seed.find(row=>row.key==='tools.read_construction_changes'));row.key='tools.'+patch.name
   row.definition={...row.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[],additional_description:policy.how_to,card_description:policy.description}
   row.definition.envelope.schema_version=1
   row.metadata={publication,server_fields:[]}
   seed.push(row);versions.set(row.key,1)
  }
  const box=seed.find(row=>row.key==='bob.tools');versions.set(box.key,versions.get(box.key)!+1)
  const{seed_version,source_revision,...rest}=box.metadata??{};box.metadata={...rest,publication}
  for(const policy of policies){
   if(!box.definition.catalog.some((p:any)=>p.name===policy.name))box.definition.catalog.push(policy)
   if(!box.definition.contract_keys.includes('tools.'+policy.name))box.definition.contract_keys.push('tools.'+policy.name)
   const shelf=box.definition.shelves.find((s:any)=>s.label===shelfLabel);if(!shelf.tools.includes(policy.name))shelf.tools.push(policy.name)
  }
 }
 const calculatorContract=source.match(/\$calculator_contract\$([\s\S]+?)\$calculator_contract\$/)
 if(calculatorContract){
  const contract=JSON.parse(calculatorContract[1]),policy=JSON.parse(source.match(/\$calculator_policy\$([\s\S]+?)\$calculator_policy\$/)![1])
  const row=structuredClone(seed.find(row=>row.key==='tools.inspect_stair_options'));row.key='tools.calculate_project'
  row.definition={...row.definition,...contract,handler:contract.name,required_parameters:contract.parameters.required,optional_parameters:[],additional_description:policy.how_to}
  row.metadata={publication:'project-calculator-v1'};seed.push(row);versions.set(row.key,1)
  const box=seed.find(row=>row.key==='bob.tools');box.definition.catalog.push(policy);box.definition.contract_keys.push(row.key);publishAs(box,'project-calculator-v1')
  box.definition.shelves.push({label:'Calculations',tools:['calculate_project']});versions.set(box.key,versions.get(box.key)!+1)
  for(const patch of JSON.parse(source.match(/\$calculator_text_patches\$([\s\S]+?)\$calculator_text_patches\$/)![1])){
   let row=seed.find(row=>row.key===patch.key)
   if(!row){row={key:patch.key,kind:'instruction_fragment',content:patch.content,definition:{},metadata:{publication:'project-calculator-v1'},variables:[]};seed.push(row);versions.set(row.key,1)}
   else{row.content+='\n\n'+patch.append;publishAs(row,'project-calculator-v1');versions.set(row.key,versions.get(row.key)!+1)}
  }
  for(const name of JSON.parse(source.match(/\$calculator_roles\$([\s\S]+?)\$calculator_roles\$/)![1])){
   const row=seed.find(row=>row.key==='role.'+name);row.definition.tool_keys.push('tools.calculate_project');publishAs(row,'project-calculator-v1');versions.set(row.key,versions.get(row.key)!+1)
  }
 }
 const taskWorkflowContracts=source.match(/\$task_workflow_contracts\$([\s\S]+?)\$task_workflow_contracts\$/)
 if(taskWorkflowContracts){
  preTaskWorkflowRows=structuredClone(seed);preTaskWorkflowVersions=new Map(versions)
  const contracts=JSON.parse(taskWorkflowContracts[1]),manuals=JSON.parse(source.match(/\$task_workflow_manuals\$([\s\S]+?)\$task_workflow_manuals\$/)![1])
  const publishedMetadata=(metadata:Record<string,unknown>)=>{const{seed_version,source_revision,...rest}=metadata;return{...rest,publication:'bob-task-workflow-v1'}}
  for(const patch of contracts){
   const row=seed.find(row=>row.key==='tools.'+patch.name),manual=manuals.find((m:any)=>m.name===patch.name)
   row.definition={...row.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[],
    additional_description:(row.definition.additional_description??'')+manual.text,envelope:{...row.definition.envelope,schema_version:2}}
   row.metadata=publishedMetadata(row.metadata);versions.set(row.key,versions.get(row.key)!+1)
  }
  for(const patch of JSON.parse(source.match(/\$task_workflow_texts\$([\s\S]+?)\$task_workflow_texts\$/)![1])){
   let row=seed.find(row=>row.key===patch.key)
   if(!row){row={key:patch.key,kind:'instruction_fragment',content:patch.content,definition:{},metadata:{publication:'bob-task-workflow-v1'},variables:patch.variables};seed.push(row);versions.set(row.key,1)}
   else{row.content=patch.mode==='append'?row.content+'\n\n'+patch.content:patch.content;if(patch.mode!=='append')row.variables=patch.variables;row.metadata=publishedMetadata(row.metadata);versions.set(row.key,versions.get(row.key)!+1)}
  }
  const box=seed.find(row=>row.key==='bob.tools')
  for(const policy of box.definition.catalog){const manual=manuals.find((m:any)=>m.name===policy.name);if(manual){policy.schema_version=2;policy.how_to+=manual.text}}
  box.metadata=publishedMetadata(box.metadata);versions.set(box.key,versions.get(box.key)!+1)
  const agent=seed.find(row=>row.key==='agent-contract.ask-bob')
  agent.metadata={...publishedMetadata(agent.metadata),work_completion_version:1};versions.set(agent.key,versions.get(agent.key)!+1)
 }
 const continuationTexts=source.match(/\$bob_continuation_texts\$([\s\S]+?)\$bob_continuation_texts\$/)
 if(continuationTexts){
  preContinuationRows=structuredClone(seed);preContinuationVersions=new Map(versions)
  const published=(metadata:Record<string,unknown>)=>{const{seed_version,source_revision,...rest}=metadata;return {...rest,publication:'bob-continuation-unmetered-v1'}}
  for(const patch of JSON.parse(continuationTexts[1])){
   const row=seed.find(row=>row.key===patch.key)
   if(patch.content!==undefined)row.content=patch.content
   if(patch.remove)row.content=row.content.replaceAll(patch.remove,'')
   if(patch.append)row.content+='\n\n'+patch.append
   if(patch.variables)row.variables=patch.variables
   row.metadata=published(row.metadata);versions.set(row.key,versions.get(row.key)!+1)
  }
  const agent=seed.find(row=>row.key==='agent-contract.ask-bob')
  agent.metadata={...published(agent.metadata),work_completion_version:2,work_allowance_version:1};versions.set(agent.key,versions.get(agent.key)!+1)
 }

 const pageManuals=source.match(/\$cad_page_manuals\$([\s\S]+?)\$cad_page_manuals\$/)
 if(pageManuals){
  const manuals=JSON.parse(pageManuals[1]),box=seed.find(row=>row.key==='bob.tools')
  const publish=(row:any)=>{const{seed_version,source_revision,...rest}=row.metadata;row.metadata={...rest,publication:'cad-annotation-pages-v1'};versions.set(row.key,versions.get(row.key)!+1)}
  for(const patch of manuals){
   const row=seed.find(row=>row.key==='tools.'+patch.name)
   row.definition.additional_description=patch.mode==='replace'?patch.text:(row.definition.additional_description??'')+'\n\n'+patch.text
   publish(row)
   const policy=box.definition.catalog.find((p:any)=>p.name===patch.name)
   policy.how_to=patch.mode==='replace'?patch.text:(policy.how_to??'')+'\n\n'+patch.text
  }
  publish(box)
  const feedback=JSON.parse(source.match(/\$cad_page_feedback\$([\s\S]+?)\$cad_page_feedback\$/)![1]),row=seed.find(row=>row.key===feedback.key)
  row.content=feedback.content;publish(row)
 }
 const sourceRenewal=source.match(/\$cad_source_renewal\$([\s\S]+?)\$cad_source_renewal\$/)
 if(sourceRenewal){
  preSourceRenewalRows=structuredClone(seed);preSourceRenewalVersions=new Map(versions)
  const patch=JSON.parse(sourceRenewal[1]),row=seed.find(row=>row.key==='tools.design_project_cad'),box=seed.find(row=>row.key==='bob.tools')
  row.definition.parameters.properties.construction_revision.description=patch.revision_description
  row.definition.additional_description=(row.definition.additional_description??'')+'\n\n'+patch.manual
  box.definition.catalog.find((p:any)=>p.name==='design_project_cad').how_to+='\n\n'+patch.manual
  for(const item of [row,box]){const{seed_version,source_revision,...rest}=item.metadata;item.metadata={...rest,publication:'cad-source-renewal-v1'};versions.set(item.key,versions.get(item.key)!+1)}
 }
 // Same recursive rewrite as pg_temp.cad_all_views_walk in the migration.
 const allViews=source.match(/\$cad_all_views_spec\$([\s\S]+?)\$cad_all_views_spec\$/)
 if(allViews){
  const spec=JSON.parse(allViews[1]),oldList=JSON.stringify(spec.old),prose=spec.old.join(','),next=spec.views.join(',')
  const walk=(node:any):any=>{
   if(Array.isArray(node))return node.map(walk)
   if(typeof node==='string')return node.replaceAll(prose,next)
   if(!node||typeof node!=='object')return node
   const out:any=Object.fromEntries(Object.entries(node).map(([k,v])=>[k,walk(v)]))
   if(out.items&&typeof out.items==='object'&&JSON.stringify(out.items.enum)===oldList){
    out.items={...out.items,enum:[...spec.views]}
    if('maxItems' in out)out.maxItems=spec.max
    if(!('description' in out))out.description=spec.description
   }
   return out
  }
  for(const key of spec.keys){
   const row=seed.find(row=>row.key===key)
   if(!row||JSON.stringify(row.definition).includes('isometric_back_right'))continue
   row.definition=walk(row.definition)
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'cad-all-views-v1'};versions.set(key,versions.get(key)!+1)
  }
 }
 // Build guides (cad-build-guide-v1): the same append as the migration.
 const buildGuide=source.match(/\$cad_build_guide_spec\$([\s\S]+?)\$cad_build_guide_spec\$/)
 if(buildGuide){
  const spec=JSON.parse(buildGuide[1]),row=seed.find(row=>row.key===spec.key)
  if(row&&!('assembly_dependencies' in row.definition.parameters.properties)){
   row.definition.parameters.properties.assembly_dependencies=structuredClone(spec.property)
   row.definition.parameters.required=[...(row.definition.parameters.required??[]),'assembly_dependencies']
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'cad-build-guide-v1'};versions.set(row.key,versions.get(row.key)!+1)
  }
 }
 const resumeViews=source.match(/\$cad_resume_views_spec\$([\s\S]+?)\$cad_resume_views_spec\$/)
 if(resumeViews){
  const spec=JSON.parse(resumeViews[1]),row=seed.find(row=>row.key===spec.key)
  if(row&&!('views' in row.definition.parameters.properties)){
   row.definition.parameters.properties.views=structuredClone(spec.property)
   row.definition.parameters.required=[...(row.definition.parameters.required??[]),'views']
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'cad-resume-views-v1'};versions.set(row.key,versions.get(row.key)!+1)
  }
 }
 // Build guide text (cad-build-guide-v2): the same description swap as the migration.
 const guideText=source.match(/\$cad_build_guide_text\$([\s\S]+?)\$cad_build_guide_text\$/)
 if(guideText){
  const spec=JSON.parse(guideText[1]),row=seed.find(row=>row.key===spec.key),order=row?.definition.parameters.properties.assembly_dependencies
  if(order&&order.description===spec.old){
   row.definition=structuredClone(row.definition);row.definition.parameters.properties.assembly_dependencies.description=spec.description
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'cad-build-guide-v2'};versions.set(row.key,versions.get(row.key)!+1)
  }
 }
}
// The SQL migration resolves preserved image settings at insertion; tests
// supply that database-owned binding explicitly.
for(const rows of [seed,originalSeed,...(preCostControlsRows?[preCostControlsRows]:[]),...(preCompleteContextRows?[preCompleteContextRows]:[]),...(preSelectiveToolsRows?[preSelectiveToolsRows]:[]),...(preConstructionViewsRows?[preConstructionViewsRows]:[]),...(preConstructionEditsRows?[preConstructionEditsRows]:[]),...(preContextCoverageRows?[preContextCoverageRows]:[]),...(preTaskWorkflowRows?[preTaskWorkflowRows]:[]),...(preContinuationRows?[preContinuationRows]:[]),...(preSourceRenewalRows?[preSourceRenewalRows]:[]),...(preBuildingScopeRows?[preBuildingScopeRows]:[]),...(preContextStrategyRows?[preContextStrategyRows]:[])])for(const row of rows)if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
function fixtureManifest(rows:any[],revisionMap:Map<string,number>,id:string):AiCatalogManifest{
 const modelTiers=new Map(rows.filter(row=>row.kind==='tier_binding').map(row=>[row.definition.model_name,row.definition.tier]))
 return{format_version:1,app:'bob',manifest_id:id,created_at:'2026-10-09T14:00:00Z',
 definitions:rows.map(row=>({id:'fixture-version:'+row.key+':v'+revisionMap.get(row.key),prompt_id:'fixture-prompt:'+row.key,prompt_key:row.key,version:revisionMap.get(row.key)!,
  definition_kind:row.kind,definition_format_version:1,content:row.content??'',definition:row.definition??{},metadata:row.metadata??{},available_variables:row.variables??[],payload_hash:'fixture-hash:'+row.key+':v'+revisionMap.get(row.key)})),
 models:[...modelTiers].map(([model_name,tier])=>({model_name,provider:'openai',model_type:tier,is_active:true,is_default:false,max_output_tokens:150000,
  supports_images:true,supports_reasoning:true,supports_image_output:tier==='image',input_cost_per_1m_tokens:1,output_cost_per_1m_tokens:2,cached_input_cost_per_1m_tokens:null,
  capabilities:{provider_adapter:tier==='embedding'?'openai-embeddings-v1':tier==='image'?'openai-images-v1':'openai-responses-v1',supports_functions:true,supports_json_schema:true,reasoning_efforts:['none','minimal','low','medium','high','xhigh'],...(tier==='embedding'?{supports_embedding_dimensions:true,max_embedding_dimensions:1536,max_batch_inputs:2048}:{})}})),
}}
const preConstructionEditsManifest=fixtureManifest(preConstructionEditsRows??seed,preConstructionEditsVersions??versions,'fixture-pre-construction-edits-manifest')
export function preConstructionEditsCatalogFixture(){return createAiCatalogSession({rpc:async()=>{throw new Error('Pinned fixture')}},{app:'bob',manifest:structuredClone(preConstructionEditsManifest)})}
const manifest=fixtureManifest(seed,versions,'fixture-manifest')
for(const row of preTextHygieneRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preTextHygieneManifest=fixtureManifest(preTextHygieneRows??seed,preTextHygieneVersions??versions,'fixture-pre-text-hygiene-manifest')
for(const row of prePhaseToolsRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const prePhaseToolsManifest=fixtureManifest(prePhaseToolsRows??seed,prePhaseToolsVersions??versions,'fixture-pre-phase-tools-manifest')
for(const row of preToolPickerRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preToolPickerManifest=fixtureManifest(preToolPickerRows??seed,preToolPickerVersions??versions,'fixture-pre-tool-picker-manifest')
for(const row of preToolSheetsRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preToolSheetsManifest=fixtureManifest(preToolSheetsRows??seed,preToolSheetsVersions??versions,'fixture-pre-tool-sheets-manifest')
for(const row of preMemoryStairRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preMemoryStairManifest=fixtureManifest(preMemoryStairRows??seed,preMemoryStairVersions??versions,'fixture-pre-memory-stair-manifest')
/** Manifests pinned before the 2026-10-30 memory stair: one rewritten summary and the per-turn briefing order. */
export function preMemoryStairCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preMemoryStairManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preMaterialsWorkerRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preMaterialsWorkerManifest=fixtureManifest(preMaterialsWorkerRows??seed,preMaterialsWorkerVersions??versions,'fixture-pre-materials-worker-manifest')
/** The manifest before the materials worker pilot: Bob offers the materials tools himself. */
export function preMaterialsWorkerCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preMaterialsWorkerManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preKonradLeanRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preKonradLeanManifest=fixtureManifest(preKonradLeanRows??seed,preKonradLeanVersions??versions,'fixture-pre-konrad-lean-manifest')
/** Manifests pinned before Konrad's lean construction (2026-11-01): rule fasteners, every zero bound, catalog lookups. */
export function preKonradLeanCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preKonradLeanManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preMaterialFinderTeamRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preMaterialFinderTeamManifest=fixtureManifest(preMaterialFinderTeamRows??seed,preMaterialFinderTeamVersions??versions,'fixture-pre-material-finder-team-manifest')
/** Manifests pinned before the finder was offered to the whole team (2026-11-01): Konrad's finder texts, Mattias without it. */
export function preMaterialFinderTeamCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preMaterialFinderTeamManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preBuildWorkersRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preBuildWorkersManifest=fixtureManifest(preBuildWorkersRows??seed,preBuildWorkersVersions??versions,'fixture-pre-build-workers-manifest')
/** Manifests pinned before the 2026-10-31 structural designer and Rita (drawing) workers. */
export function preBuildWorkersCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preBuildWorkersManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preToolOrderRestoreRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preToolOrderRestoreManifest=fixtureManifest(preToolOrderRestoreRows??seed,preToolOrderRestoreVersions??versions,'fixture-pre-tool-order-restore-manifest')
/** The manifest with tool sheets and the repair helper (tool_repair_version 1), before tool order was restored. */
export function preToolOrderRestoreCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preToolOrderRestoreManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preToolRepairRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preToolRepairManifest=fixtureManifest(preToolRepairRows??seed,preToolRepairVersions??versions,'fixture-pre-tool-repair-manifest')
/** The manifest with tool_order_version 1 (every tool native, mid-turn loads appended), before the tool-repair publication. */
export function preToolRepairCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preToolRepairManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preToolOrderRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preToolOrderManifest=fixtureManifest(preToolOrderRows??seed,preToolOrderVersions??versions,'fixture-pre-tool-order-manifest')
/** The manifest with tool_sheets_version 1 (every job tool behind use_tool), before the tool-order publication. */
export function preToolOrderCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preToolOrderManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
/** Manifests pinned before the 2026-10-30 tool-sheets publication: every loaded tool is a native function. */
export function preToolSheetsCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preToolSheetsManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
/** Manifests pinned before the 2026-10-30 tool-picker publication: the phase alone chooses the flexible tools. */
export function preToolPickerCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preToolPickerManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
/** Manifests pinned before the 2026-10-29 phase-tools publication: five permanent tools, earlier cards. */
export function prePhaseToolsCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(prePhaseToolsManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
/** Manifests pinned before the 2026-10-29 text-hygiene publication. */
export function preTextHygieneCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preTextHygieneManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preControlledCompletionRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preControlledCompletionManifest=fixtureManifest(preControlledCompletionRows??seed,preControlledCompletionVersions??versions,'fixture-pre-controlled-completion-manifest')
/** Manifests pinned before 2026-10-29 keep the v2 full review after saved work. */
export function preControlledCompletionCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preControlledCompletionManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
for(const row of preCreationRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preCreationManifest=fixtureManifest(preCreationRows??seed,preCreationVersions??versions,'fixture-pre-creation-manifest')
export function preCreationCatalogFixture(){return createAiCatalogSession({rpc:async()=>{throw Error('Pinned fixture')}},{app:'bob',manifest:structuredClone(preCreationManifest)})}
for(const row of preResultWindowRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preResultWindowManifest=fixtureManifest(preResultWindowRows??seed,preResultWindowVersions??versions,'fixture-pre-result-window-manifest')
/** Manifests pinned before 2026-10-29 keep result window version 1. */
export function preResultWindowCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preResultWindowManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw Error('Pinned fixture')}},{app:'bob',manifest:snapshot})}
for(const row of preMaterialLookupRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preMaterialLookupManifest=fixtureManifest(preMaterialLookupRows??seed,preMaterialLookupVersions??versions,'fixture-pre-material-lookup-manifest')
/** Manifests pinned before 2026-10-29 keep the definition-only material search. */
export function preMaterialLookupCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preMaterialLookupManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw Error('Pinned fixture')}},{app:'bob',manifest:snapshot})}
for(const row of preCreateSelectRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preCreateSelectManifest=fixtureManifest(preCreateSelectRows??seed,preCreateSelectVersions??versions,'fixture-pre-create-select-manifest')
/** Manifests pinned before 2026-10-29's create-select publication: creation never selects. */
export function preCreateSelectCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preCreateSelectManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw Error('Pinned fixture')}},{app:'bob',manifest:snapshot})}
for(const row of preWriteStateRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preWriteStateManifest=fixtureManifest(preWriteStateRows??seed,preWriteStateVersions??versions,'fixture-pre-write-state-manifest')
/** Manifests pinned before writes returned their state (2026-10-29). */
export function preWriteStateCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preWriteStateManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw Error('Pinned fixture')}},{app:'bob',manifest:snapshot})}
for(const row of preConstructionWorkRows??[])if(row.kind==='tier_binding'&&row.definition.model_name===null)row.definition.model_name='fixture-'+row.definition.tier+'-model'
const preConstructionWorkManifest=fixtureManifest(preConstructionWorkRows??seed,preConstructionWorkVersions??versions,'fixture-pre-construction-work-manifest')
export function preConstructionWorkCatalogFixture(){return createAiCatalogSession({rpc:async()=>{throw Error('Pinned fixture')}},{app:'bob',manifest:structuredClone(preConstructionWorkManifest)})}
const preCostControlsManifest=fixtureManifest(preCostControlsRows??seed,preCostControlsVersions??versions,'fixture-pre-cost-controls-manifest')
export function preCostControlsCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preCostControlsManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
const preContextCoverageManifest=fixtureManifest(preContextCoverageRows??seed,preContextCoverageVersions??versions,'fixture-pre-context-coverage-manifest')
export function preContextCoverageCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preContextCoverageManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
const preContextStrategyManifest=fixtureManifest(preContextStrategyRows??seed,preContextStrategyVersions??versions,'fixture-pre-context-strategy-manifest')
export function preContextStrategyCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preContextStrategyManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
const legacyManifest=fixtureManifest(originalSeed,new Map(originalSeed.map(row=>[row.key,1])),'fixture-legacy-seed-manifest')
const preTaskWorkflowManifest=fixtureManifest(preTaskWorkflowRows??seed,preTaskWorkflowVersions??versions,'fixture-pre-task-workflow-manifest')
const preContinuationManifest=fixtureManifest(preContinuationRows??seed,preContinuationVersions??versions,'fixture-pre-continuation-manifest')
const preSourceRenewalManifest=fixtureManifest(preSourceRenewalRows??seed,preSourceRenewalVersions??versions,'fixture-pre-source-renewal-manifest')
const preBuildingScopeManifest=fixtureManifest(preBuildingScopeRows??seed,preBuildingScopeVersions??versions,'fixture-pre-building-scope-manifest')
/** The catalog before read_building_scope/change_building_scope were published. */
export function preBuildingScopeCatalogFixture():AiCatalogSession{return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:structuredClone(preBuildingScopeManifest)})}
export function preSourceRenewalCatalogFixture():AiCatalogSession{return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:preSourceRenewalManifest})}
export function preContinuationCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preContinuationManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
export function legacyCatalogFixture():AiCatalogSession{return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:legacyManifest})}
export function preTaskWorkflowCatalogFixture(update?:(snapshot:AiCatalogManifest)=>void):AiCatalogSession{const snapshot=structuredClone(preTaskWorkflowManifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot})}
export function catalogFixture(update?:(snapshot:AiCatalogManifest)=>void, options:{unlimitedWork?:boolean}={}):AiCatalogSession{const snapshot=structuredClone(manifest);update?.(snapshot);return createAiCatalogSession({rpc:async()=>{throw new Error('Fixture must use pinned manifest')}},{app:'bob',manifest:snapshot,...options})}
export function catalogCall<T>(call:(options:OpenAIServiceOptions,beforeDispatch?:()=>Promise<void>)=>Promise<OpenAIServiceResponse<T>>,session=catalogFixture()){
 return (options:OpenAIServiceOptions,beforeDispatch?:()=>Promise<void>)=>call(applyCatalogModelOptions(session,options),beforeDispatch)
}
export const DRAWING_REVIEW_INSTRUCTION=catalogFixture().text('drawing-review.instruction')
const preConstructionViewsManifest=fixtureManifest(preConstructionViewsRows??seed,preConstructionViewsVersions??versions,'fixture-pre-construction-views-manifest')
export function preConstructionViewsCatalogFixture(){return createAiCatalogSession({rpc:async()=>{throw new Error('Pinned fixture')}},{app:'bob',manifest:structuredClone(preConstructionViewsManifest)})}
const preSelectiveToolsManifest=fixtureManifest(preSelectiveToolsRows??seed,preSelectiveToolsVersions??versions,'fixture-pre-selective-tools-manifest')
export function preSelectiveToolsCatalogFixture(){return createAiCatalogSession({rpc:async()=>{throw new Error('Pinned fixture')}},{app:'bob',manifest:structuredClone(preSelectiveToolsManifest)})}
const preCompleteContextManifest=fixtureManifest(preCompleteContextRows??seed,preCompleteContextVersions??versions,'fixture-pre-complete-context-manifest')
export function preCompleteContextCatalogFixture(){return createAiCatalogSession({rpc:async()=>{throw new Error('Pinned fixture')}},{app:'bob',manifest:structuredClone(preCompleteContextManifest)})}
