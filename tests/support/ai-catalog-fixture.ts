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
let preWriteStateRows:any[]|undefined,preWriteStateVersions:Map<string,number>|undefined
let preMaterialLookupRows:any[]|undefined,preMaterialLookupVersions:Map<string,number>|undefined
let preResultWindowRows:any[]|undefined,preResultWindowVersions:Map<string,number>|undefined
let preConstructionWorkRows:any[]|undefined,preConstructionWorkVersions:Map<string,number>|undefined
// Materialise the explicit immutable publication patches in migration order.
// The historical seed stays available for pinned-manifest compatibility tests.
for(const migration of migrations){
 const source=readFileSync(migration,'utf8')
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
   versions.set(key,(versions.get(key)??0)+1)
  }
  const box=seed.find(row=>row.key==='bob.tools');box.definition.catalog.push(...policies)
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
 const resumeViews=source.match(/\$cad_resume_views_spec\$([\s\S]+?)\$cad_resume_views_spec\$/)
 if(resumeViews){
  const spec=JSON.parse(resumeViews[1]),row=seed.find(row=>row.key===spec.key)
  if(row&&!('views' in row.definition.parameters.properties)){
   row.definition.parameters.properties.views=structuredClone(spec.property)
   row.definition.parameters.required=[...(row.definition.parameters.required??[]),'views']
   const{seed_version,source_revision,...rest}=row.metadata??{};row.metadata={...rest,publication:'cad-resume-views-v1'};versions.set(row.key,versions.get(row.key)!+1)
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
