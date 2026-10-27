import { CONSTRUCTION_EDIT_TOOL, constructionEditIssues } from './construction-edits.ts'
import { CONSTRUCTION_VIEW_TOOL, createConstructionViews, type ConstructionObservation } from './construction-views.ts'
import { checkConstruction } from './construction-checks.ts'
import { constructionLists } from './construction-lists.ts'
import { constructionCutFit } from './construction-cut-fit.ts'
import { CAD_RECIPE_SCHEMA } from './cad-schema.ts'
import { CAD_ARRAYS_SCHEMA, expandCadArrays } from './cad-arrays.ts'
import { parseCadAssemblyRequest } from './cad-adapter.ts'
import { CAD_PARAMETERS_SCHEMA, CadParameterBindingGap, CadParameterGap, compileCadParameters, parseParameterPlan, parameterSourcePins } from './cad-parameters.ts'
import {CONSTRUCTION_PARAMETER_CHANGES_SCHEMA,compileConstructionParameterChange} from './construction-parameters.ts'
import { INSTANCE_POLICY_SCHEMA,constructionInstancePolicy } from './construction-instance-policy.ts'
import { CONSTRUCTION_ROLE_TOOL,CONSTRUCTION_CHANGES_TOOL,CONSTRUCTION_CONTINUE_TOOL } from './construction-consequences.ts'
import { humanTextRejection, proseFields } from './human-text.ts'
import { JOINT_FASTENER_SCHEMA, parseFastenerSchedule, storedJoints, withRuleFasteners, type FastenerSchedule } from './construction-fasteners.ts'
import { schemaIssues } from './schema-issues.ts'
import { rethrowContinuation, type BobJournal } from './bob-job-journal.ts'
import type { ProjectWriter,WritePayload } from './project-write.ts'
import { parseDesignReadiness, type DesignReadiness } from './project-design-intent.ts'
import { conceptConstructionIssues } from './solution-concept.ts'
import { FORM_REFINEMENT_SCHEMA, constructionFormReadiness, constructionFormIssues, type FormRefinement } from './construction-form.ts'

/** Reconstruct a historical tool check; a new check position still reads live.
 * CAD render/review gates use their independent fresh readers. Old executions
 * have no version flag and retain their existing journal sequence. */
export function constructionCurrentReader(read: (id: string) => Promise<Record<string, any>>, journal?: BobJournal, version?: number) {
 return (id: string) => journal && (version === 1 || version === 2) ? journal.run('construction:current', { id }, () => read(id)) : read(id)
}

/** These reads describe one logical tool position. Our later write can change
 * pending work or turn a preparation into an existing receipt. Reconstruct the
 * earlier answer; SQL still checks current authority/sources inside each write.
 * Version 1 and older jobs retain their original operation sequence. */
export function constructionChangeReaders<T extends Pick<Parameters<typeof createConstructionTools>[0], 'readChanges' | 'prepareRoleChange' | 'prepareConsequence'>>(reads:T,journal?:BobJournal,version?:number):T {
 if(!journal||version!==2)return reads
 const result={...reads}
 for(const key of ['readChanges','prepareRoleChange','prepareConsequence'] as const){
  const read=reads[key]
  if(read)(result as any)[key]=(...args:unknown[])=>journal.run('construction:'+key,args,()=> (read as (...args:any[])=>Promise<any>)(...args))
 }
 return result
}

const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'}
const uuid={type:'string',format:'uuid'}
const nullableUuid={anyOf:[uuid,{type:'null'}]}
const rev={type:'integer',minimum:1,maximum:999999999}
const nullableRev={anyOf:[rev,{type:'null'}]}
const endpoint=obj({instance_id:id,face:{type:'string',enum:['x_min','x_max','y_min','y_max','z_min','z_max']}})
const tool=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function' as const,function:{name,description,parameters:obj(properties)}})
export const CONSTRUCTION_SAVE_TOOL=tool('save_construction_draft',
 'Create or revise the requested construction concept after expert advice and significant choices are recorded in the selected solution for purpose=construction. Read its design_intent, investigate dependencies and recommend supported options before fixing geometry; reuse prior decisions and delegated technical choices. Canonical readiness is checked before compilation and again at save. You choose parts and typed joints, save this shared checkpoint, then check its exact revision. A CAD drawing is not a substitute for this material/joint construction. Read current drafts and exact catalog materials first. Preserve stable IDs and unrelated parts. CAD parameter bindings compute dimensions and placements server-side in mm/deg. material_ref must be null; materials pins each definition. Joints name box faces in LOCAL part coordinates; methods/reasons are unverified design choices. Keep missing hardware/knowledge in open_questions. Then check_construction_draft and correct reported issues. No strength, drawing or purchase approval is implied.',{
 key:{type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$',description:'Unique key for this intended write in the turn. Reuse only for exact retry; a new revision needs a new key.'},
 record_id:nullableUuid,expected_revision:{type:'integer',minimum:0,maximum:999999999},
 title:{type:'string',minLength:1,maxLength:200},description:{type:'string',minLength:1,maxLength:5500},area_id:{type:['string','null']},target_revision:rev,
 change_note:{type:'string',minLength:1,maxLength:1000},recipe:CAD_RECIPE_SCHEMA,parameter_plan:CAD_PARAMETERS_SCHEMA,instance_policy:INSTANCE_POLICY_SCHEMA,
 materials:{type:'array',minItems:1,maxItems:128,items:obj({definition_id:id,material_id:uuid,material_revision:rev,part_id:nullableUuid,part_revision:nullableRev})},
 joints:{type:'array',maxItems:1024,items:obj({id,method:{type:'string',enum:['screwed_butt','glued_butt','dowel','bolted','unresolved']},first:endpoint,second:endpoint,reason:{type:'string',minLength:1,maxLength:2000},fastener:JOINT_FASTENER_SCHEMA})},
 open_questions:{type:'array',maxItems:40,items:{type:'string',minLength:1,maxLength:1000}},
 request_quote:{type:'string',minLength:1,maxLength:500},
})
export const CONSTRUCTION_READ_TOOL=tool('read_construction_draft','List current construction drafts, or read exact saved geometry, parameters, material revisions and joints. A draft is not a reviewed/rendered drawing. Historical revisions retain their original values; inspect source_state.',{
 artifact_id:nullableUuid,revision:nullableRev,after:nullableUuid,
})
/** A pinned authoring shorthand only. Stored geometry/graphs keep the existing contract. */
export const CONSTRUCTION_REPEAT_SAVE_TOOL={...CONSTRUCTION_SAVE_TOOL,function:{...CONSTRUCTION_SAVE_TOOL.function,
 description:CONSTRUCTION_SAVE_TOOL.function.description+' For repeated identical parts use recipe.arrays (empty for none). Bind each array start and spacing in parameter_plan; the server expands stable <id>.1..<id>.<count> instances before normal compilation. Name expanded IDs in roles and joints. Arrays are authoring shorthand, not saved templates: later parameter/part changes target the saved expanded graph. For small changes use change_construction_parameters, change_construction_roles or edit_construction_parts.',
 parameters:{...CONSTRUCTION_SAVE_TOOL.function.parameters,properties:{...CONSTRUCTION_SAVE_TOOL.function.parameters.properties,
  recipe:{...CAD_RECIPE_SCHEMA,required:[...CAD_RECIPE_SCHEMA.required,'arrays'],properties:{...CAD_RECIPE_SCHEMA.properties,
   arrays:CAD_ARRAYS_SCHEMA,instances:{...(CAD_RECIPE_SCHEMA.properties.instances as Record<string,unknown>),minItems:0}}}}}}}
export const FORM_REFINEMENT_NOTE=' form_refinement:null uses the complete concept handoff. For an independent checkpoint, map selected concept component_ids to all actual instance_ids exactly once; one component may have several uncut, unrotated box parts within its exact envelope. Canonical component, parameter, feature, constraint and contacting-envelope dependencies determine whether unresolved choices affect this scope. All conceptual geometry still needs resolved supported values. Remaining components and choices stay visible on readback. An envelope is not proof of function: refinements remain unverified and cannot authorize drawings or purchases. Small edits inherit the saved mapping; use a complete save to change the mapping.'
export function withFormRefinement<T extends typeof CONSTRUCTION_SAVE_TOOL>(spec:T){return {...spec,function:{...spec.function,
 description:spec.function.description+FORM_REFINEMENT_NOTE,
 parameters:{...spec.function.parameters,required:[...spec.function.parameters.required,'form_refinement'],properties:{...spec.function.parameters.properties,form_refinement:FORM_REFINEMENT_SCHEMA}},
}}}
export const CONSTRUCTION_LEGACY_TOOL=tool('transition_legacy_drawing','Prepare a saved older drawing for construction-driven correction. Read its exact Artifact ID/revision and current selected solution first. The SERVER copies its geometry and parameter graph; never recreate dimensions or IDs. With construction_id:null supply explicit current catalog materials, typed joint choices and open questions. null means evidence is missing and returns all gaps without saving; never infer catalog pins or joints from appearance. A saved graph is required to create; if absent establish a matching construction through the ordinary construction tools and reuse its exact ID/revision with materials/joints/open_questions:null. Reuse requires identical geometry, stable IDs and existing parameter/source pins. Already prepared returns that existing checkpoint without a duplicate. Check the receipt/readback; then change its parameter IDs, check_construction_draft and pass the ORIGINAL drawing Artifact ID and exact construction_revision to design_project_cad. This operation prepares a construction only, preserves drawing history and does not render or deliver a drawing.',{
 key:{type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$'},record_id:uuid,expected_revision:rev,target_revision:rev,
 construction_id:nullableUuid,construction_revision:nullableRev,
 materials:{anyOf:[CONSTRUCTION_SAVE_TOOL.function.parameters.properties.materials,{type:'null'}]},
 joints:{anyOf:[CONSTRUCTION_SAVE_TOOL.function.parameters.properties.joints,{type:'null'}]},
 open_questions:{anyOf:[{...(CONSTRUCTION_SAVE_TOOL.function.parameters.properties.open_questions as Record<string,unknown>),maxItems:39},{type:'null'}]},
 change_note:{type:'string',minLength:1,maxLength:1000},request_quote:{type:'string',minLength:1,maxLength:500},
})
export const CONSTRUCTION_PARAMETER_TOOL=tool('change_construction_parameters','Change only existing input nodes in an exact saved construction. Read its stable parameter IDs first. Supply changed decision/estimate values in the SAME role/unit with an honest reason, or the newer revision of the SAME source measurement; never supply measured source values. Derived nodes, formulas, bindings, parts, materials and joints remain unchanged. The server reads the checkpoint and recomputes all dependent dimensions and placements. Unknown controlling values block saving. Use save_construction_draft for topology/material/formula changes. key identifies this intended write; exact retry reuses its receipt even after another head change. After saved, check_construction_draft at the receipt revision and pass that exact construction_revision to design_project_cad. A construction receipt alone is not a drawing delivery.',{
 key:{type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$'},record_id:uuid,expected_revision:rev,
 changes:CONSTRUCTION_PARAMETER_CHANGES_SCHEMA,change_note:{type:'string',minLength:1,maxLength:1000},request_quote:{type:'string',minLength:1,maxLength:500},
})
export const CONSTRUCTION_CHECK_TOOL=tool('check_construction_draft','Check an exact current saved construction before drawing. Reads canonical geometry and catalog revisions server-side. Supports uncut wooden boxes, right-angle rotations and planar screwed/glued butt-joint concepts. Reports collisions, wrong local faces, missing joints, disconnected parts and material dimension mismatches with stable IDs. Compare returned bounds/count against the original request. concept_ready permits concept development only; fabrication_ready is always false until product, hardware, load and manufacturing checks exist. Unsupported operations and stale sources stop this check.',{
 artifact_id:uuid,revision:rev,
})
export const CONSTRUCTION_LIST_TOOL=tool('derive_construction_lists','Derive a concept BOM, one blank cut row per actual instance and joint references from the exact current checked construction, without redesign or rendering. Code counts instances and copies the server-computed local mm dimensions. assembly_dependencies=[] leaves order unresolved; otherwise name every saved joint once and its prerequisite joints. Code rejects cycles in this separate order graph; it does not verify physical tool access. No raw-sheet purchase count, hardware count or stock reservation is inferred. Use derive_cad_material_requirement to save blank requirements from the same construction revision, then read them back. This read tool does not save lists or approve fabrication.',{
 artifact_id:uuid,revision:rev,
 assembly_dependencies:{type:'array',maxItems:1024,items:obj({joint_id:id,depends_on:{type:'array',maxItems:64,uniqueItems:true,items:id}})},
})
const candidateMm=(minimum:number)=>({anyOf:[{type:'number',minimum,maximum:1000000},{type:'null'}]})
export const CONSTRUCTION_CUT_FIT_TOOL=tool('check_construction_cut_fit','Check actual rectangular blank placement for ALL instances in the exact current checked construction against explicit candidate sheet formats. Supply exact used material pins, sheet count, mm length/width/thickness, saw kerf, trim per edge, sheet grain direction and each definition’s LOCAL in-plane grain axis. null means unknown and blocks a layout; none is an explicit decision that grain imposes no constraint. Candidate dimensions/grain are supplied specifications or design choices with an honest basis/note, not verified physical stock. Code returns a bounded guillotine cutting layout with placements, cut order and offcuts, or a concrete gap. No summed-area shortcut or optimal purchase count. This read-only result is not saved and cannot unlock stock/reuse allocation or Shopping. Keep existing need identities and history.',{
 artifact_id:uuid,revision:rev,
 candidates:{type:'array',minItems:1,maxItems:8,items:obj({id,material_id:uuid,material_revision:rev,
  length_mm:candidateMm(0.000001),width_mm:candidateMm(0.000001),thickness_mm:candidateMm(0.000001),
  count:{type:'integer',minimum:1,maximum:16},kerf_mm:candidateMm(0),trim_mm:candidateMm(0),
  grain:{type:['string','null'],enum:['length','width','none',null]},basis:{type:'string',enum:['design_choice','provided_spec']},note:{type:'string',minLength:1,maxLength:1000}})},
 blank_grain:{type:'array',minItems:1,maxItems:128,items:obj({definition_id:id,axis:{type:['string','null'],enum:['x','y','z','none',null]}})},
})
export const CONSTRUCTION_CUT_SAVE_TOOL=tool('save_construction_cut_plan','Save a feasible sheet cutting plan under ALL existing piece needs from this exact current construction. Code computes the layout and SQL independently replays the cuts; never supply placements or claim that an area sum proves fit. Read existing cut_plan and requirement resources first. Reuse record_id/current revision when updating; key names one intended write in the turn. candidate_sources names every candidate: hypothetical uses null record_id/revision; stock pins an existing current stock revision with sheet_format and available whole sheets; catalog_part pins a current panel part with exact material and dimensions, not a verified supplier/product. Preserve hypothetical/estimated evidence. This saves a plan only: no stock reservation, Shopping handoff, optimal purchase count or fabrication approval. Read_project_work(cut_plan) to reopen the receipt and inspect source_state.',{
 key:{type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$'},record_id:nullableUuid,expected_revision:{type:'integer',minimum:0,maximum:999999999},
 ...CONSTRUCTION_CUT_FIT_TOOL.function.parameters.properties,
 requirements:{type:'array',minItems:1,maxItems:24,items:obj({id:uuid,revision:rev})},
 candidate_sources:{type:'array',minItems:1,maxItems:8,items:obj({candidate_id:id,kind:{type:'string',enum:['hypothetical','stock','catalog_part']},record_id:nullableUuid,revision:nullableRev})},
 change_note:{type:'string',minLength:1,maxLength:1000},request_quote:{type:'string',minLength:1,maxLength:500},
})
/** Text people read in construction writes: titles, notes, reasons and open
 * questions (shown on drawings and source maps). Ids, keys and paths are typed. */
const CONSTRUCTION_PROSE:Record<string,readonly string[]>={
 save_construction_draft:['title','description','change_note','parameter_plan.frames.*.reason','parameter_plan.nodes.*.reason','instance_policy.instances.*.reason','joints.*.reason','joints.*.fastener.reason','open_questions.*'],
 transition_legacy_drawing:['change_note','joints.*.reason','joints.*.fastener.reason','open_questions.*'],
 change_construction_parameters:['change_note','changes.*.reason'],
 edit_construction_parts:['change_note','changes.nodes.upsert.*.reason','changes.joints.upsert.*.reason','changes.joints.upsert.*.fastener.reason','changes.roles.upsert.*.reason'],
 change_construction_roles:['change_note','changes.*.reason'],
 continue_construction_change:['change_note','review_note'],
 save_construction_cut_plan:['change_note','candidates.*.note'],
}
/** The table's schedule for one exact saved revision. A failed or mismatched
 * read is shown as unavailable; fasteners are never recomputed here. */
async function tableFasteners(read:((id:string,revision:number)=>Promise<unknown>)|undefined,id:string,revision:number):Promise<FastenerSchedule|null>{
 if(!read)return null
 try{return parseFastenerSchedule(await read(id,revision),id,revision)}
 catch(error){
  rethrowContinuation(error)
  console.error('[Construction table fasteners unavailable]',JSON.stringify({revision,error:(error instanceof Error?error.name+': '+error.message:String(error)).slice(0,300)}))
  return null
 }
}
export type ConstructionToolsState = { version:1; used:number } | { version:2; used:number; observations:ConstructionObservation[] }
export function createConstructionTools(opts:{projectId:string;message:string;writer?:ProjectWriter;hasAccess:()=>Promise<boolean>;unlimitedWork?:boolean;
 read:(id:string|null,revision:number|null,after:string|null)=>Promise<unknown>;
 readCurrent?:(id:string)=>Promise<unknown>;
 preciseEditDiagnostics?:boolean;
 constructionViews?:boolean;
 /** Page budget for this read; absent keeps the default 2,000-token page. */
 viewPageTokens?:()=>number;
 /** Owner decision 2026-10-26 (pinned per job): the overview carries the compact
  * construction table with the server fastener schedule from readFasteners. */
 constructionTable?:boolean;
 constructionRepeats?:boolean;
 formRefinement?:boolean;
 readConstructionReadiness?:(targetRevision:number,areaId:string|null,refinement:FormRefinement)=>Promise<unknown>;
 observationTime?:(input:unknown)=>Promise<string>;
 prepareEdit?:(payload:WritePayload)=>Promise<Record<string,any>>;
 prepareParameterChange?:(payload:WritePayload)=>Promise<Record<string,any>>;
 prepareLegacyTransition?:(payload:WritePayload)=>Promise<Record<string,any>>;
 prepareRoleChange?:(payload:WritePayload)=>Promise<Record<string,any>>;
 prepareConsequence?:(payload:WritePayload)=>Promise<Record<string,any>>;
 readChanges?:(id:string,revision:number,after:string|null)=>Promise<Record<string,any>>;
 readDesignReadiness?:(targetRevision:number,purpose:'construction'|null,areaId?:string|null)=>Promise<DesignReadiness|unknown>;
 readCatalog?:(id:string,revision:number)=>Promise<Record<string,any>>;now?:()=>Date;
 /** Server fastener schedule for one saved revision; present only for catalogs with joint fasteners. */
 readFasteners?:(id:string,revision:number)=>Promise<unknown>;
 readSources:(pins:ReturnType<typeof parameterSourcePins>)=>Promise<{project:Map<string,Record<string,any>>;physical:Map<string,Record<string,any>>}>}){
 let used=0
 const views=createConstructionViews(opts.projectId,opts.now)
 const readTool=opts.constructionViews?CONSTRUCTION_VIEW_TOOL:CONSTRUCTION_READ_TOOL
 const baseSaveTool=opts.constructionRepeats?CONSTRUCTION_REPEAT_SAVE_TOOL:CONSTRUCTION_SAVE_TOOL
 const saveTool=opts.formRefinement?withFormRefinement(baseSaveTool):baseSaveTool
 const present=(kind:string,id:string,revision:number,output:Record<string,any>,observedAt?:string)=>opts.constructionViews?views.observe(kind,id,revision,output,observedAt):output
 return {
 exportState():ConstructionToolsState{return opts.constructionViews?{version:2,used,observations:views.exportState()}:{version:1,used}},
 restoreState(state:ConstructionToolsState){if(state?.version!==(opts.constructionViews?2:1)||!Number.isSafeInteger(state.used)||state.used<0)throw new Error('construction_tools_checkpoint_invalid');if(state.version===2)views.restoreState(state.observations);used=state.used},
 tools:[readTool,CONSTRUCTION_CHECK_TOOL,CONSTRUCTION_LIST_TOOL,CONSTRUCTION_CUT_FIT_TOOL,CONSTRUCTION_CHANGES_TOOL,...(opts.writer?[saveTool,CONSTRUCTION_EDIT_TOOL,CONSTRUCTION_PARAMETER_TOOL,CONSTRUCTION_LEGACY_TOOL,CONSTRUCTION_ROLE_TOOL,CONSTRUCTION_CONTINUE_TOOL,CONSTRUCTION_CUT_SAVE_TOOL]:[])],get remaining(){return opts.unlimitedWork?Infinity:Math.max(0,12-used)},
 async execute(name:string,raw:unknown):Promise<Record<string,any>>{
  if(++used>12&&!opts.unlimitedWork)return {status:'budget_exhausted'}
  const spec=[CONSTRUCTION_EDIT_TOOL,CONSTRUCTION_LEGACY_TOOL,CONSTRUCTION_PARAMETER_TOOL,readTool,saveTool,CONSTRUCTION_CHECK_TOOL,CONSTRUCTION_LIST_TOOL,CONSTRUCTION_CUT_FIT_TOOL,CONSTRUCTION_CUT_SAVE_TOOL,CONSTRUCTION_ROLE_TOOL,CONSTRUCTION_CHANGES_TOOL,CONSTRUCTION_CONTINUE_TOOL].find(s=>s.function.name===name)
  if(!spec)return {status:'invalid'}
  // An older pinned catalog may omit this new field. Preserve its uncertainty;
  // the database inherits an existing policy rather than erasing it.
  if(name===CONSTRUCTION_SAVE_TOOL.function.name&&raw&&typeof raw==='object'&&!Array.isArray(raw)&&!('instance_policy' in raw))raw={...raw,instance_policy:null}
  // Older pinned schemas have no joint fastener field: null means "use the rule".
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
   const r=raw as Record<string,any>
   if((name===CONSTRUCTION_SAVE_TOOL.function.name||name===CONSTRUCTION_LEGACY_TOOL.function.name)&&Array.isArray(r.joints))raw={...r,joints:withRuleFasteners(r.joints)}
   if(name===CONSTRUCTION_EDIT_TOOL.function.name&&Array.isArray(r.changes?.joints?.upsert))raw={...r,changes:{...r.changes,joints:{...r.changes.joints,upsert:withRuleFasteners(r.changes.joints.upsert)}}}
  }
  const issues=schemaIssues(spec.function.parameters,raw)
  if(issues.length)return {status:'invalid',issues}
  const prose=humanTextRejection(proseFields(raw,CONSTRUCTION_PROSE[name]??[]))
  if(prose)return {status:'invalid',validation:{code:'human_text',fields:prose.fields},message:'No change made. '+prose.message}
  const v=raw as any
  if(!await opts.hasAccess())return {status:'denied'}
  try{
   if(name===CONSTRUCTION_CHANGES_TOOL.function.name){
    if(!opts.readChanges)return {status:'unavailable'}
    const result=await opts.readChanges(v.artifact_id,v.revision,v.after)
    if(!await opts.hasAccess())return {status:'denied'}
    if(result?.projectId!==opts.projectId||result.artifact_id!==v.artifact_id||result.revision!==v.revision||JSON.stringify(result).length>600000)return {status:'unavailable'}
    return result
   }
   if(name===CONSTRUCTION_ROLE_TOOL.function.name||name===CONSTRUCTION_CONTINUE_TOOL.function.name){
    if(!opts.writer)return {status:'denied'}
    const prepare=name===CONSTRUCTION_ROLE_TOOL.function.name?opts.prepareRoleChange:opts.prepareConsequence
    if(!prepare)return {status:'unavailable'}
    if(!v.request_quote.trim()||!opts.message.includes(v.request_quote))return {status:'invalid',message:'Use an exact quote from the current request.'}
    const {record_id,expected_revision,request_quote,...data}=v
    const payload:WritePayload={kind:name===CONSTRUCTION_ROLE_TOOL.function.name?'construction_roles':'construction_consequence',record_id,expected_revision,expected_updated_at:null,request_quote,data:{...data,computed:null}}
    const prepared=await prepare(payload)
    if(!await opts.hasAccess())return {status:'denied'}
    if(prepared.status!=='ready'&&prepared.status!=='saved')return prepared
    if(prepared.status==='ready'&&prepared.kind==='cut_plan'){
     const draft=prepared.draft,catalog=new Map<string,Record<string,any>>()
     if(!draft||draft.projectId!==opts.projectId||draft.artifact_id!==record_id||draft.revision!==expected_revision||!opts.readCatalog)return {status:'unavailable'}
     for(const m of draft.materials)for(const [id,revision] of [[m.material_id,m.material_revision],[m.part_id,m.part_revision]]){
      if(id&&!catalog.has(`${id}@${revision}`)){
       if(catalog.size>=32)return {status:'unsupported',message:'This check supports at most 32 distinct catalog revisions.'}
       const row=await opts.readCatalog(id,revision)
       if(row?.projectId!==opts.projectId||row.status!=='ok'||row.record?.id!==id||row.record.revision!==revision)return {status:'unavailable'}
       catalog.set(`${id}@${revision}`,row.record)
      }
     }
     const checked=checkConstruction(draft,catalog,(opts.now?.()??new Date()).toISOString().slice(0,10))
     if(!checked.concept_ready)return {status:'needs_data',checked}
     const lists=constructionLists(draft,catalog,[])
     if(lists.status!=='derived')return lists
     if(lists.bom.some((b:any)=>b.material_id&&catalog.get(`${b.material_id}@${b.material_revision}`)?.profile_code!=='sheet_stock'))return {status:'unsupported',message:'Saved sheet cutting requires sheet_stock manufacturing blanks.'}
     const fit=constructionCutFit(lists,prepared.domain.data.candidates,prepared.domain.data.blank_grain)
     if(fit.status!=='feasible')return {...fit,message:'The saved cutting inputs do not produce a new feasible layout. Revise the explicit candidate/grain choices with the ordinary cutting tool; existing purchases and reservations remain recorded.'}
     payload.data.computed=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,(fit as any)[k]]))
    }
    if(!await opts.hasAccess())return {status:'denied'}
    return await opts.writer.commit(payload)
   }
   if(name===CONSTRUCTION_LEGACY_TOOL.function.name){
    if(!opts.writer||!opts.prepareLegacyTransition)return {status:'unavailable'}
    if(!v.request_quote.trim()||!opts.message.includes(v.request_quote))return {status:'invalid',message:'Use an exact quote from the current request.'}
    const {record_id,expected_revision,request_quote,...data}=v
    const payload:WritePayload={kind:'legacy_construction',record_id,expected_revision,expected_updated_at:null,request_quote,data:{...data,joints:storedJoints(data.joints)}}
    const prepared=await opts.prepareLegacyTransition(payload)
    if(!await opts.hasAccess())return {status:'denied'}
    if(!['ready','saved'].includes(prepared.status))return {...prepared,message:prepared.status==='already_prepared'
     ?'Use this existing construction ID and its current revision; no duplicate was created. Check or correct it, then render the original drawing identity.'
     :prepared.status==='needs_data'?'No transition saved. Establish the listed evidence without inventing parameter roles, material pins or joints.':prepared.message}
    return await opts.writer.commit(payload)
   }
   if(name===CONSTRUCTION_EDIT_TOOL.function.name){
    if(!opts.writer||!opts.prepareEdit)return {status:'unavailable'}
    if(!v.request_quote.trim()||!opts.message.includes(v.request_quote))return {status:'invalid',issues:[{code:'request_quote',path:'request_quote'}]}
    const payload:WritePayload={kind:'construction_edit',record_id:v.record_id,expected_revision:v.expected_revision,expected_updated_at:null,request_quote:v.request_quote,
     data:{key:v.key,change_note:v.change_note,changes:v.changes?.joints?{...v.changes,joints:{...v.changes.joints,upsert:storedJoints(v.changes.joints.upsert)}}:v.changes,computed:null}}
    const prepared=await opts.prepareEdit(payload)
    if(!await opts.hasAccess())return {status:'denied'}
    if(prepared.status!=='ready'&&prepared.status!=='saved')return prepared
    if(prepared.status==='ready'){
     const draft=prepared.draft,next=prepared.next
     if(draft?.projectId!==opts.projectId||draft.artifact_id!==v.record_id||draft.revision!==v.expected_revision||draft.current_revision!==v.expected_revision||draft.archived)return {status:'conflict'}
     if(!next)return {status:'unavailable'}
     const issues=constructionEditIssues(next,draft)
     if(issues.length)return {status:'invalid',issues,message:'No construction changed. Correct only the named posts and their dependencies.'}
     const recipe=parseCadAssemblyRequest(structuredClone(next.recipe))
     if(!recipe)return {status:'invalid',issues:[{code:'invalid_recipe',path:'changes'}]}
     constructionInstancePolicy(recipe,next.instance_policy)
     const plan=parseParameterPlan(next.parameter_plan)
     if(plan.frames.some(f=>f.kind==='image'))return {status:'invalid',issues:[{code:'unsupported_image_frame',path:'frames'}]}
     const sources=await opts.readSources(parameterSourcePins(plan))
     const parameters=compileCadParameters(opts.projectId,recipe,plan,sources.project,sources.physical)
     if(!parseCadAssemblyRequest(recipe))return {status:'invalid',issues:[{code:'computed_geometry_invalid',path:'changes'}]}
     payload.data.computed={recipe,parameters}
    }
    if(!await opts.hasAccess())return {status:'denied'}
    return await opts.writer.commit(payload)
   }
   if(name===CONSTRUCTION_PARAMETER_TOOL.function.name){
    if(!opts.writer||!opts.prepareParameterChange)return {status:'unavailable'}
    if(!v.request_quote.trim()||!opts.message.includes(v.request_quote))return {status:'invalid',message:'Use an exact quote from the current request.'}
    const payload:WritePayload={kind:'construction_parameters',record_id:v.record_id,expected_revision:v.expected_revision,expected_updated_at:null,request_quote:v.request_quote,
     data:{key:v.key,change_note:v.change_note,changes:v.changes,computed:null}}
    const prepared=await opts.prepareParameterChange(payload)
    if(!await opts.hasAccess())return {status:'denied'}
    if(prepared.status!=='ready'&&prepared.status!=='saved')return prepared
    if(prepared.status==='ready'){
     const draft=prepared.draft
     if(draft?.artifact_id!==v.record_id||draft.revision!==v.expected_revision||draft.current_revision!==v.expected_revision||draft.archived)return {status:'conflict'}
     payload.data.computed=await compileConstructionParameterChange(opts.projectId,draft,v.changes,opts.readSources)
    }
    if(!await opts.hasAccess())return {status:'denied'}
    return await opts.writer.commit(payload)
   }
   if(name===CONSTRUCTION_READ_TOOL.function.name){
    if(opts.constructionViews){
     if(v.artifact_id===null){
      if(v.view!=='overview'||v.ids.length||v.result_id!==null||v.section!==null||v.revision!==null)return {status:'invalid',message:'List drafts with view=overview and no revision, filter or result reference.'}
      const result=await opts.read(null,null,v.after) as Record<string,any>
      if(!await opts.hasAccess())return {status:'denied'}
      if(result?.projectId!==opts.projectId||result.status!=='ok'||!Array.isArray(result.items))return {status:'unavailable'}
      return {...result,next_read:result.next_cursor?{...v,after:result.next_cursor}:null}
     }
     if(v.view==='result'&&(!v.result_id||v.revision===null))return {status:'invalid',message:'Use the exact result_id and construction revision returned by the earlier check.'}
     const draft=await opts.read(v.artifact_id,v.revision,null) as Record<string,any>
     if(!await opts.hasAccess())return {status:'denied'}
     if(draft?.projectId!==opts.projectId||!['ok','not_found'].includes(draft.status))return {status:'unavailable'}
     if(draft.status==='not_found')return {status:'not_found',projectId:opts.projectId}
     if(draft.artifact_id!==v.artifact_id||v.revision!==null&&draft.revision!==v.revision)return {status:'unavailable'}
     if(opts.constructionTable&&v.view==='overview'){
      const fasteners=await tableFasteners(opts.readFasteners,draft.artifact_id,draft.revision)
      if(!await opts.hasAccess())return {status:'denied'}
      return await views.read(draft,v,opts.viewPageTokens?.(),{table:true,fasteners})
     }
     return await views.read(draft,v,opts.viewPageTokens?.())
    }
    const result=await opts.read(v.artifact_id,v.revision,v.after) as Record<string,any>
    if(!await opts.hasAccess())return {status:'denied'}
    if(!result||result.projectId!==opts.projectId||!['ok','not_found'].includes(result.status)||JSON.stringify(result).length>600000)throw new Error('construction_read_unavailable')
    return result
   }
   if(name===CONSTRUCTION_CHECK_TOOL.function.name||name===CONSTRUCTION_LIST_TOOL.function.name||(name===CONSTRUCTION_CUT_FIT_TOOL.function.name||name===CONSTRUCTION_CUT_SAVE_TOOL.function.name)){
    if(!opts.readCatalog)return {status:'unavailable'}
    const draft=await opts.read(v.artifact_id,v.revision,null) as Record<string,any>
    if(!draft||draft.projectId!==opts.projectId||draft.status!=='ok'||draft.artifact_id!==v.artifact_id||draft.revision!==v.revision){
     console.error('[Construction tool unavailable]',JSON.stringify({tool:name,reason:'draft_read_mismatch',status:draft?.status??null,revision:draft?.revision??null,expected:v.revision,project_match:draft?.projectId===opts.projectId}))
     return {status:'unavailable'}
    }
    const pins=new Map<string,{id:string;revision:number}>()
    for(const m of draft.materials??[])for(const kind of ['material','part'])if(m[kind+'_id'])pins.set(`${m[kind+'_id']}@${m[kind+'_revision']}`,{id:m[kind+'_id'],revision:m[kind+'_revision']})
    if(pins.size>32)return {status:'unsupported',message:'This check supports at most 32 distinct catalog revisions.'}
    const catalog=new Map<string,Record<string,any>>()
    for(const [key,pin] of pins){
     const result=await opts.readCatalog(pin.id,pin.revision)
     if(result?.projectId!==opts.projectId||result.status!=='ok'||result.record?.id!==pin.id||result.record?.revision!==pin.revision)throw new Error('construction_source_unavailable')
     catalog.set(key,result.record)
    }
    // Do not present results assembled across a changed head/source as current.
    const current=await (opts.readCurrent?.(v.artifact_id)??opts.read(v.artifact_id,null,null)) as Record<string,any>
    if(!await opts.hasAccess())return {status:'denied'}
    if(current?.projectId!==opts.projectId||current.status!=='ok'||current.artifact_id!==v.artifact_id)throw new Error('construction_source_unavailable')
    if(current.revision!==v.revision||current.source_state!=='current'||current.archived)return {status:'conflict',message:'Construction or sources changed; read and revise before checking.'}
    const observedAt=opts.constructionViews?await (opts.observationTime?.({tool:name,artifact_id:v.artifact_id,revision:v.revision})??Promise.resolve((opts.now?.()??new Date()).toISOString())):undefined
    const checked=checkConstruction(draft,catalog,(observedAt??(opts.now?.()??new Date()).toISOString()).slice(0,10),!!opts.constructionViews)
    if(name===CONSTRUCTION_CHECK_TOOL.function.name)return await present('check',v.artifact_id,v.revision,{projectId:opts.projectId,...checked},observedAt)
    if(!checked.concept_ready)return await present(name===CONSTRUCTION_LIST_TOOL.function.name?'lists':'cut_fit',v.artifact_id,v.revision,{status:'needs_data',checked,message:'Correct the same construction before deriving lists; no quantities or fabrication approval returned.'},observedAt)
    if((name===CONSTRUCTION_CUT_FIT_TOOL.function.name||name===CONSTRUCTION_CUT_SAVE_TOOL.function.name)){
     const lists=constructionLists(draft,catalog,[])
     if(lists.status!=='derived')return await present('cut_fit',v.artifact_id,v.revision,{projectId:opts.projectId,...lists,checked},observedAt)
     if(lists.bom.some((b:any)=>b.material_id&&catalog.get(`${b.material_id}@${b.material_revision}`)?.profile_code!=='sheet_stock'))return {status:'unsupported',message:'This cutting assessment supports sheet_stock manufacturing blanks only; profile/bar cutting needs a separate capability.'}
     const fit=constructionCutFit(lists,v.candidates,v.blank_grain)
     if(name===CONSTRUCTION_CUT_FIT_TOOL.function.name)return await present('cut_fit',v.artifact_id,v.revision,{projectId:opts.projectId,...fit,checked},observedAt)
     if(!opts.writer)return {status:'denied'}
     if(!opts.message.includes(v.request_quote)||!v.request_quote.trim()||(v.record_id===null?v.expected_revision!==0:v.expected_revision<1))return {status:'invalid',message:'Use the current request and exact cut-plan revision.'}
     if(fit.status!=='feasible')return await present('cut_fit',v.artifact_id,v.revision,{projectId:opts.projectId,...fit,checked},observedAt)
     if(!await opts.hasAccess())return {status:'denied'}
     return await opts.writer.commit({kind:'cut_plan',record_id:v.record_id,expected_revision:v.expected_revision,expected_updated_at:null,request_quote:v.request_quote,
      data:{key:v.key,artifact_id:v.artifact_id,artifact_revision:v.revision,requirements:v.requirements,candidates:v.candidates,blank_grain:v.blank_grain,
       candidate_sources:v.candidate_sources,layout:Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,(fit as any)[k]])),change_note:v.change_note}})
    }
    // Catalogs with joint fasteners read the server schedule; others keep the unverified gap.
    const fasteners=opts.readFasteners?parseFastenerSchedule(await opts.readFasteners(v.artifact_id,v.revision),v.artifact_id,v.revision):undefined
    return await present('lists',v.artifact_id,v.revision,{projectId:opts.projectId,...constructionLists(draft,catalog,v.assembly_dependencies,fasteners),checked},observedAt)
   }
   if(!opts.writer)return {status:'denied'}
   if(!opts.message.includes(v.request_quote)||!v.request_quote.trim()||(v.record_id===null?v.expected_revision!==0:v.expected_revision<1))return {status:'invalid',message:'Use the current request and exact expected revision.'}
   if(v.form_refinement?!opts.readConstructionReadiness:!opts.readDesignReadiness)return {status:'unavailable',message:'Could not read the selected solution and expert advice. Recover that read before fixing construction geometry.'}
   const read=v.form_refinement
    ? (await opts.readConstructionReadiness!(v.target_revision,v.area_id,v.form_refinement) as Record<string,unknown>|null)?.design_readiness
    : await opts.readDesignReadiness!(v.target_revision,'construction',v.area_id)
   const readiness=parseDesignReadiness(read)
   if(!await opts.hasAccess())return {status:'denied'}
   if(!readiness||readiness.project_id!==opts.projectId||readiness.area_id!==v.area_id
     ||readiness.purpose!=='construction')return {status:'unavailable',message:'Could not verify advice for this exact selected solution and construction purpose. Read the current target and solution again.'}
   const checkpoint=v.form_refinement?constructionFormReadiness(readiness,v.form_refinement):readiness
   if(checkpoint.status!=='ready')return {status:checkpoint.status,readiness:checkpoint,issues:checkpoint.issues,
     message:'No construction saved. Resolve the listed evidence and design choices before fixing their geometry: investigate relevant sources, explain alternatives and recommend a supported direction. Reuse prior choices or decide within the existing mandate, then save and select that solution revision.'}
   if(readiness.target_revision!==v.target_revision)return {status:'conflict',message:'The selected target changed. Read its exact current revision and shared advice before fixing construction geometry.'}
   const expanded=opts.constructionRepeats?expandCadArrays(v.recipe,parseParameterPlan(v.parameter_plan)):{recipe:v.recipe,plan:v.parameter_plan}
   if(opts.preciseEditDiagnostics){
    const issues=constructionEditIssues({...v,recipe:expanded.recipe,parameter_plan:expanded.plan,instance_policy:v.instance_policy??constructionInstancePolicy(expanded.recipe as any,null)})
    if(issues.length)return {status:'invalid',issues,message:'No construction changed. Correct only the named posts; for an existing construction use edit_construction_parts.'}
   }
   const recipe=parseCadAssemblyRequest(structuredClone(expanded.recipe))
   if(!recipe)return {status:'invalid',message:'Invalid CAD recipe or referenced part IDs.'}
   constructionInstancePolicy(recipe,v.instance_policy)
   const plan=parseParameterPlan(expanded.plan)
   // Image-oriented construction checkpoints need a canonical image carrier;
   // never accept model-supplied image hashes as read evidence.
   if(plan.frames.some(f=>f.kind==='image'))return {status:'invalid',message:'Image frames are not supported by the construction checkpoint yet. Keep that orientation as an open question.'}
   const sources=await opts.readSources(parameterSourcePins(plan))
   const parameters=compileCadParameters(opts.projectId,recipe,plan,sources.project,sources.physical)
   if(!parseCadAssemblyRequest(recipe))return {status:'invalid',message:'Computed dimensions or placement are outside the supported geometry contract.'}
   if(readiness.design_intent?.model){
    const policy=constructionInstancePolicy(recipe,v.instance_policy)
    const references=new Set(policy.instances.filter(i=>i.role==='reference').map(i=>i.instance_id))
    const issues=v.form_refinement?constructionFormIssues(readiness.design_intent,recipe,references,v.form_refinement,true):conceptConstructionIssues(readiness.design_intent,recipe,references)
    if(issues.length)return {status:'needs_data',issues,message:'No construction saved. Preserve the selected concept component identities, dimensions and relations, or explicitly revise that Solution before handoff.'}
   }
   if(!await opts.hasAccess())return {status:'denied'}
   const {record_id,expected_revision,request_quote,parameter_plan,...data}=v
   return await opts.writer.commit({kind:'construction',record_id,expected_revision,expected_updated_at:null,request_quote,data:{...data,joints:storedJoints(data.joints),recipe,parameters}})
  }catch(error){
   rethrowContinuation(error)
   if(error instanceof CadParameterGap)return {status:'needs_data',reason:'unknown_required_parameters',gaps:error.gaps,message:'No construction changed. Resolve these controlling values in the same request; no zero or invented value was saved.'}
   if(error instanceof CadParameterBindingGap)return {status:'invalid',message:'Bind every path in unbound to a parameter node using these exact slash-separated paths. Keep the same construction IDs and correct the parameter plan; no source lookup retry is needed.',unbound:error.unbound}
   const message=error instanceof Error?error.message:''
   if(opts.constructionRepeats&&/^(invalid_cad_array|cad_array_[a-z_]+)(:.*)?$/.test(message))return {status:'invalid',reason:message.split(':')[0],message:'No construction saved. Correct array IDs/counts and bindings; generated instance/node IDs must be unique and fit the existing canonical limits.'}
   if(opts.constructionRepeats&&message.startsWith('parameter_gaps:'))return {status:'invalid',reason:'array_binding_missing',message:'Bind all six arrays/<id>/start placement paths and arrays/<id>/spacing_mm. No construction saved.'}
   if(opts.constructionViews&&message==='construction_view_cursor_invalid')return {status:'invalid',message:'Use next_read from this exact revision, view and selection. A cursor cannot be reused for another selection.'}
   if(opts.constructionViews&&message==='construction_view_header_too_large')return {status:'invalid',message:'Use fewer named IDs or one result section to keep the page envelope small. No data was omitted as complete.'}
   const known=/^(invalid_form_refinement|invalid_instance_policy|invalid_parameter_[a-z_]+|parameter_[a-z_]+|unknown_required_parameters|coordinate_[a-z_]+)$/
   if(known.test(message))return {status:'invalid',message}
   // The owner-facing text stays generic; the cause must still reach the logs.
   console.error('[Construction tool unavailable]',JSON.stringify({tool:name,error:(error instanceof Error?error.name+': '+message:String(error)).slice(0,300)}))
   return {status:'unavailable',message:'Could not verify construction data. Read again; a failed lookup does not mean data is absent.'}
  }
 }}
}
export type ConstructionTools=ReturnType<typeof createConstructionTools>

/** The drawing desk uses the same checker and exact caller reads, without
 * trusting a model's earlier assertion that a checkpoint passed. */
export async function checkedConstructionForDrawing(opts:Parameters<typeof createConstructionTools>[0],id:string,revision:number) {
 const tools=createConstructionTools({...opts,constructionViews:false})
 const checked=await tools.execute('check_construction_draft',{artifact_id:id,revision})
 if(checked.status!=='checked'||!checked.concept_ready)return {status:checked.status==='checked'?'needs_data':checked.status,checked}
 const draft=await opts.read(id,revision,null) as Record<string,any>
 if(!await opts.hasAccess())return {status:'denied',checked}
 if(draft?.projectId!==opts.projectId||draft.status!=='ok'||draft.artifact_id!==id||draft.revision!==revision
  ||draft.current_revision!==revision||draft.source_state!=='current'||draft.archived)return {status:'conflict',checked}
 return {status:'ready',draft,checked}
}
