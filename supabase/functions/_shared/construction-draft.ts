import { CONSTRUCTION_EDIT_TOOL, constructionEditIssues } from './construction-edits.ts'
import { CONSTRUCTION_VIEW_TOOL, CONSTRUCTION_EVIDENCE_VIEW_TOOL, createConstructionViews, type ConstructionObservation } from './construction-views.ts'
import { checkConstruction } from './construction-checks.ts'
import { constructionLists } from './construction-lists.ts'
import { CONSTRUCTION_DELIVERY_TOOL, validConstructionDelivery, type ConstructionDeliveryResource } from './construction-delivery.ts'
import { constructionCutFit } from './construction-cut-fit.ts'
import { CAD_RECIPE_SCHEMA } from './cad-schema.ts'
import { CAD_ARRAYS_SCHEMA, expandCadArrays, withRepeatStartSchema, withoutRepeatStarts } from './cad-arrays.ts'
import { parseCadAssemblyRequest } from './cad-adapter.ts'
import { CAD_PARAMETERS_SCHEMA, ZERO_NODE_IDS, cadParameterTargets, CadParameterBindingGap, CadParameterGap, CadParameterUnusedNodes, CadReservedParameter, compileCadParameters, parseParameterPlan, roundNodeValues, parameterSourcePins, withDefaultZeroText, withZeroDefaults, zeroDefaults } from './cad-parameters.ts'
import {CONSTRUCTION_PARAMETER_CHANGES_SCHEMA,compileConstructionParameterChange} from './construction-parameters.ts'
import { INSTANCE_POLICY_SCHEMA,INSTANCE_ROLE_POLICY,constructionInstancePolicy } from './construction-instance-policy.ts'
import { CONSTRUCTION_ROLE_TOOL,CONSTRUCTION_CHANGES_TOOL,CONSTRUCTION_CONTINUE_TOOL } from './construction-consequences.ts'
import { humanTextRejection, proseFields } from './human-text.ts'
import { JOINT_FASTENER_SCHEMA, parseFastenerSchedule, storedChosenJoints, storedJoints, withChosenJointFasteners, withRuleFasteners, type FastenerSchedule } from './construction-fasteners.ts'
import { schemaIssues, withOmittedNulls } from './schema-issues.ts'
import { fingerprint, rethrowContinuation, type BobJournal } from './bob-job-journal.ts'
import type { ProjectWriter,WritePayload } from './project-write.ts'
import { parseDesignReadiness, type DesignReadiness } from './project-design-intent.ts'
import { conceptConstructionIssues } from './solution-concept.ts'
import { FORM_REFINEMENT_SCHEMA, constructionFormReadiness, constructionFormIssues, type FormRefinement } from './construction-form.ts'
import { REQUIREMENT_PROBES_SCHEMA, EVIDENCE_COMPONENTS_SCHEMA, checkConstructionEvidence, constructionEvidenceReuse, constructionEvidenceContract } from './construction-evidence.ts'
import { withConstructionWorkRead, withConstructionWorkWrite, withConstructionWorkCheck, createConstructionWorkPackets, checkConstructionWorkOutputs, type ConstructionWorkSources } from './construction-work.ts'
import type { ProjectEdits } from './project-edits.ts'
import { countSerializedTokens } from './bob-token-budget.ts'
import { compactConstructionCheck } from './write-state.ts'
import { recipeSize, staleSizeText, staleTextRejection, withConstructionText } from './construction-text.ts'
import { SKETCH_KEYS, CONSTRUCTION_SKETCH_COMMIT_TOOL, CONSTRUCTION_SKETCH_COMMIT_TOOL_V2, mergeNewConstruction, parseNewSketch, withNewConstructionSketch, type NewConstructionSketch, baseKeysOf, composeSketchChanges, parseSketch, sketchChangeCount, sketchSummary, withConstructionSketch, type ConstructionSketch, type ConstructionSketchStore } from './construction-sketch.ts'
import { CadFormulaError, compileEditFormulas, compileSaveFormulas, definitionFields, instanceFields, unusedFormulaNodes } from './cad-formulas.ts'
import { ruleJoints, type JointRule, type RuleJoint, type RuleScope } from './construction-joint-rules.ts'
import { extendFormMapping, type FormAssignment } from './construction-form.ts'
import { withLeanCommit, withLeanEdit, withLeanSave } from './construction-lean.ts'
import type { ParameterInput } from './cad-parameters.ts'
import { frameParameterIds } from './cad-frames.ts'
import { measurementMillimetres } from './cad-lineage.ts'

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
export const CONSTRUCTION_SOURCE_REFRESH_NOTE=' target_revision:null preserves the saved target pin. After reading a changed selected Solution, supply its current target_revision to reconcile this SAME construction with it; changes:[] refreshes only that pin. Readiness and exact concept-geometry checks still apply. Update the Solution before reconciling the construction, then check the saved receipt revision after the final change. A mismatch needs corrected inputs or an explicit full revision of this same artifact, not a duplicate.'
export const CONSTRUCTION_PARAMETER_REFRESH_TOOL=tool('change_construction_parameters',CONSTRUCTION_PARAMETER_TOOL.function.description+CONSTRUCTION_SOURCE_REFRESH_NOTE,{
 ...CONSTRUCTION_PARAMETER_TOOL.function.parameters.properties,
 target_revision:nullableRev,changes:{...CONSTRUCTION_PARAMETER_CHANGES_SCHEMA,minItems:0},
})
export const CONSTRUCTION_CHECK_TOOL=tool('check_construction_draft','Check an exact current saved construction before drawing. Reads canonical geometry and catalog revisions server-side. Supports uncut wooden boxes, right-angle rotations and planar screwed/glued butt-joint concepts. Reports collisions, wrong local faces, missing joints, disconnected parts and material dimension mismatches with stable IDs. Compare returned bounds/count against the original request. concept_ready permits concept development only; fabrication_ready is always false until product, hardware, load and manufacturing checks exist. Unsupported operations and stale sources stop this check.',{
 artifact_id:uuid,revision:rev,
})
export const CONSTRUCTION_EVIDENCE_CHECK_TOOL=tool('check_construction_draft',CONSTRUCTION_CHECK_TOOL.function.description+
 ' component_ids:[] checks the whole model; named concept IDs start a local scope that expands to dependencies, neighbors and joints. requirement_checks bind registered feature IDs to clear_space (a space/opening component), minimum_span (physical component, axis and positive minimum_node from the concept), or connected (mapped component_ids). Give each probe a stable id. The code reports actual properties and every unprobed/unsupported requirement, retaining unverified functional meaning. Both local and whole findings are saved for later turns; read them with view=results/result. A property pass does not prove the natural-language function or grant delivery.',{
 artifact_id:uuid,revision:rev,component_ids:EVIDENCE_COMPONENTS_SCHEMA,requirement_checks:REQUIREMENT_PROBES_SCHEMA,
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
 save_construction_draft:['title','description','change_note','parameter_plan.frames.*.reason','parameter_plan.nodes.*.reason','instance_policy.instances.*.reason','joints.*.reason','joints.*.fastener.reason','joint_rules.*.reason','open_questions.*'],
 transition_legacy_drawing:['change_note','joints.*.reason','joints.*.fastener.reason','open_questions.*'],
 change_construction_parameters:['change_note','changes.*.reason','text.title','text.description','text.open_questions.*'],
 edit_construction_parts:['change_note','changes.nodes.upsert.*.reason','changes.joints.upsert.*.reason','changes.joints.upsert.*.fastener.reason','changes.roles.upsert.*.reason','joint_rules.*.reason','text.title','text.description','text.open_questions.*'],
 change_construction_roles:['change_note','changes.*.reason'],
 continue_construction_change:['change_note','review_note'],
 save_construction_cut_plan:['change_note','candidates.*.note'],
 commit_construction_sketch:['change_note'],
}
/** The table's schedule for one exact saved revision. A failed or mismatched
 * read is shown as unavailable; fasteners are never recomputed here. */
/** The exact unbound array paths of a parameter_gaps rejection, when readable. */
function arrayGaps(message:string):string[]{
 try{const v=JSON.parse(message.slice('parameter_gaps:'.length));return Array.isArray(v?.unbound)?v.unbound.filter((p:unknown)=>typeof p==='string').slice(0,256):[]}catch{return []}
}
// Owner-approved wording (2026-11-01, repeat_start_version 1).
const REPEAT_GAP_MESSAGE='No construction saved. Bind every path in unbound.'
const LEAN_REPEAT_GAP_MESSAGE='No construction saved. Give each field in unbound as a formula, or 0.'
/** The schedule rows of chosen items that carry a fact, compactly; null when
 * the schedule could not be read (never shown as "no facts"). */
export function chosenFastenerFacts(schedule:FastenerSchedule|null){
 if(!schedule)return {status:'unavailable'}
 return {status:'ok',complete:schedule.complete,glue_packages:schedule.glue_packages,
  rows:schedule.joints.filter(r=>(r.source==='chosen'||r.source==='none')&&Array.isArray(r.gaps)&&r.gaps.length)
   .map(r=>({joint_id:r.joint_id,kind:r.kind??null,diameter_mm:r.diameter_mm??null,length_mm:r.length_mm??null,count:r.count??null,gaps:r.gaps}))}
}
async function tableFasteners(read:((id:string,revision:number)=>Promise<unknown>)|undefined,id:string,revision:number):Promise<FastenerSchedule|null>{
 if(!read)return null
 try{return parseFastenerSchedule(await read(id,revision),id,revision)}
 catch(error){
  rethrowContinuation(error)
  console.error('[Construction table fasteners unavailable]',JSON.stringify({revision,error:(error instanceof Error?error.name+': '+error.message:String(error)).slice(0,300)}))
  return null
 }
}
export function latestObservations<T extends {artifact_id:string;revision:number}>(rows:T[]):T[]{
 const latest=new Map<string,number>()
 for(const o of rows)latest.set(o.artifact_id,Math.max(latest.get(o.artifact_id)??0,o.revision))
 return rows.filter(o=>o.revision===latest.get(o.artifact_id))
}
/** A failed construction preparation keeps the model-facing status mapping.
 * The server's two named write conflicts pass through so the repair can be
 * named; every other database detail stays behind the generic reason. */
const NAMED_PREPARATION_CONFLICTS=new Set(['construction_changed','operation_reused'])
export function constructionPreparationFailure(error:{code?:string|null;message?:string|null},fallback:string){
 const code=error.code??''
 return {status:code==='42501'?'denied':['PT409','40001'].includes(code)?'conflict':code==='22023'?'invalid':'unavailable',
  reason:code==='PT409'&&NAMED_PREPARATION_CONFLICTS.has(error.message??'')?error.message as string:fallback}
}
type SavedConstructionResult = Omit<ConstructionObservation,'output'>
export type ConstructionToolsState = { version:1; used:number } | { version:2; used:number; observations:ConstructionObservation[] }
 | {version:3;used:number;observations:ConstructionObservation[];savedResults:SavedConstructionResult[]}
export function createConstructionTools(opts:{projectId:string;message:string;writer?:ProjectWriter;hasAccess:()=>Promise<boolean>;unlimitedWork?:boolean;
 fastPageFit?:boolean;
 readSummary?:(id:string,revision:number)=>Promise<unknown>;
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
 /** Pinned per manifest (default_zero_version 1): positions and rotations the
  * recipe states as 0 may stay unbound; code binds them to a fixed zero node. */
 defaultZero?:boolean;
 /** Pinned per manifest (decimal_rounding_version 1): values with more than 6
  * decimals are rounded and reported as rounded_values, not rejected. */
 decimalRounding?:boolean;
 /** Pinned per manifest (repeat_start_version 1, needs defaultZero): a repeat
  * states its first copy's position; a start of 0 binds to the code zero. */
 repeatStart?:boolean;
 /** Pinned per manifest (joint_fastener_version 2, owner decision 2026-11-01):
  * a joint names the catalog items that hold it, in any mix, instead of a
  * method with a rule fastener. Saved as method 'butt' with that list. */
 chosenJointFasteners?:boolean;
 /** Pinned per manifest (build_place_version 1, owner decision 2026-11-02):
  * a save names the sub-build it belongs in, and code places it there right
  * after the save, so a part never lands in Snickeriet by a forgotten step. */
 placeIn?:(artifactId:string,subBuildId:string)=>Promise<Record<string,any>>;
 formRefinement?:boolean;
 formEvidence?:boolean;
 constructionSourceRefresh?:boolean;
 coherentWork?:boolean;
 creationPreparation?:boolean;
 /** Pinned per manifest (write_state_version 1): saved construction writes
  * carry the check of their receipt revision; requires coherentWork. */
 writeState?:boolean;
 /** Pinned per manifest (construction_text_version 1): parameter changes and
  * part edits carry corrected title/description text and are rejected when
  * they would leave a stated overall size wrong; requires coherentWork. */
 constructionText?:boolean; constructionNotes?:boolean;
 readWorkSources?:(draft:Record<string,any>|null,stepId:string|null)=>Promise<ConstructionWorkSources>;
 prepareSolutionEdit?:ProjectEdits['prepare'];
 prepareWork?:(payload:WritePayload)=>Promise<Record<string,any>>;
 openDelivery?:(resource:ConstructionDeliveryResource,id:string,revision:number)=>Promise<Record<string,any>>;
 saveObservation?:(observation:ConstructionObservation)=>Promise<ConstructionObservation>;
 readObservations?:(id:string,revision:number,resultId:string|null,after:string|null)=>Promise<Record<string,any>>;
 readConstructionReadiness?:(targetRevision:number,areaId:string|null,refinement:FormRefinement)=>Promise<unknown>;
 observationTime?:(input:unknown)=>Promise<string>;
 prepareEdit?:(payload:WritePayload)=>Promise<Record<string,any>>;
 prepareParameterChange?:(payload:WritePayload)=>Promise<Record<string,any>>;
 prepareLegacyTransition?:(payload:WritePayload)=>Promise<Record<string,any>>;
 prepareRoleChange?:(payload:WritePayload)=>Promise<Record<string,any>>;
 prepareConsequence?:(payload:WritePayload)=>Promise<Record<string,any>>;
 readChanges?:(id:string,revision:number,after:string|null)=>Promise<Record<string,any>>;
 readDelivery?:(id:string,revision:number,resource:ConstructionDeliveryResource,after:string|null)=>Promise<Record<string,any>>;
 readDesignReadiness?:(targetRevision:number,purpose:'construction'|null,areaId?:string|null)=>Promise<DesignReadiness|unknown>;
 readCatalog?:(id:string,revision:number)=>Promise<Record<string,any>>;now?:()=>Date;
 /** Server fastener schedule for one saved revision; present only for catalogs with joint fasteners. */
 readFasteners?:(id:string,revision:number)=>Promise<unknown>;
 /** Pinned per manifest (construction_sketch_version 1, owner decision
  * 2026-11-07): part edits can go to the job's private sketch, checked whole
  * and saved once with commit_construction_sketch. */
 sketches?:ConstructionSketchStore;
 /** Pinned per manifest (construction_sketch_version 2): new constructions are
  * sketched in parts by key and saved once; keyed by that key. */
 newSketches?:ConstructionSketchStore;
 /** Pinned per manifest (server_target_version 1, owner decision 2026-11-07):
  * no target_revision in the construction writes; the server keeps a
  * construction on the current selected target. */
 serverTarget?:boolean;
 /** The current selected target revision of a project or area (null: none). */
 readCurrentTarget?:(areaId:string|null)=>Promise<number|null>;
 /** Pinned per manifest (lean_construction_version 1, owner decision
  * 2026-11-07; needs defaultZero, chosenJointFasteners, formRefinement and
  * both sketch stores): formulas in the recipe, joint rules, code-kept FORM
  * mapping, and refused construction writes kept in the sketch. */
 leanConstruction?:boolean;
 /** Pinned per manifest (joint_rule_store_version 1, owner decision
  * 2026-11-08; with lean writing): joint rules are stored with the
  * construction and part edits apply them to the parts they add or move. */
 storedJointRules?:boolean;
 readSources:(pins:ReturnType<typeof parameterSourcePins>)=>Promise<{project:Map<string,Record<string,any>>;physical:Map<string,Record<string,any>>}>}){
 let used=0
 const views=createConstructionViews(opts.projectId,opts.now,opts.fastPageFit)
 const targetless=<T extends {function:{parameters:any}}>(tool:T):T=>opts.serverTarget?withoutTargetRevision(tool):tool
 const workPackets=createConstructionWorkPackets(opts.projectId,opts.fastPageFit)
 const baseReadTool=opts.constructionViews?(opts.formEvidence?CONSTRUCTION_EVIDENCE_VIEW_TOOL:CONSTRUCTION_VIEW_TOOL):CONSTRUCTION_READ_TOOL
 const readTool=opts.coherentWork?withConstructionWorkRead(baseReadTool,opts.creationPreparation):baseReadTool
 const baseCheckTool=opts.formEvidence?CONSTRUCTION_EVIDENCE_CHECK_TOOL:CONSTRUCTION_CHECK_TOOL
 const checkTool=opts.coherentWork?withConstructionWorkCheck(baseCheckTool):baseCheckTool
 const baseSaveTool=opts.constructionRepeats?CONSTRUCTION_REPEAT_SAVE_TOOL:CONSTRUCTION_SAVE_TOOL
 const formSaveTool=opts.formRefinement?withFormRefinement(baseSaveTool):baseSaveTool
 const zeroText=<T,>(tool:T)=>opts.defaultZero?withDefaultZeroText(tool,{path:(CAD_PARAMETERS_SCHEMA.properties.bindings as any).items.properties.path.description,arrays:CAD_ARRAYS_SCHEMA.description}):tool
 const placedSaveTool=(t=>opts.defaultZero&&opts.repeatStart?withRepeatStartSchema(t):t)(zeroText(opts.chosenJointFasteners?withChosenJointFasteners(formSaveTool):formSaveTool))
 const subBuildSaveTool=opts.placeIn?withSubBuild(placedSaveTool):placedSaveTool
 const lean=!!(opts.leanConstruction&&opts.defaultZero&&opts.chosenJointFasteners&&opts.formRefinement&&opts.sketches&&opts.newSketches)
 const stored=lean&&!!opts.storedJointRules
 const sketchedSaveTool=targetless(opts.newSketches?withNewConstructionSketch(subBuildSaveTool):subBuildSaveTool)
 const saveTool=lean?withLeanSave(sketchedSaveTool,stored):sketchedSaveTool
 const joints=(value:unknown)=>opts.chosenJointFasteners?storedChosenJoints(value):storedJoints(value)
 const baseParameterTool=opts.constructionSourceRefresh?CONSTRUCTION_PARAMETER_REFRESH_TOOL:CONSTRUCTION_PARAMETER_TOOL
 const withText=(tool:typeof CONSTRUCTION_EDIT_TOOL)=>opts.constructionText?withConstructionText(tool,opts.constructionNotes):tool
 const parameterTool=targetless(opts.coherentWork?withText(withConstructionWorkWrite(baseParameterTool)):baseParameterTool)
 const workEditTool=opts.coherentWork?withText(withConstructionWorkWrite(CONSTRUCTION_EDIT_TOOL)):CONSTRUCTION_EDIT_TOOL
 const fastenedEditTool=zeroText(opts.chosenJointFasteners?withChosenJointFasteners(workEditTool):workEditTool)
 const sketchedEditTool=targetless(opts.sketches?withConstructionSketch(fastenedEditTool):fastenedEditTool)
 const editTool=lean?withLeanEdit(sketchedEditTool,stored):sketchedEditTool
 const commitTool=opts.newSketches?(lean?withLeanCommit(CONSTRUCTION_SKETCH_COMMIT_TOOL_V2):CONSTRUCTION_SKETCH_COMMIT_TOOL_V2):CONSTRUCTION_SKETCH_COMMIT_TOOL
 const sketchTools=opts.writer&&opts.sketches?[commitTool]:[]
 const prepareChange=async(v:Record<string,any>,domain:WritePayload,prepare:(p:WritePayload)=>Promise<Record<string,any>>)=>{
  let payload=domain
  if(opts.coherentWork&&v.solution_edit!==null){
   if(v.target_revision!==null)return {error:{status:'invalid',message:'A joint Solution/Construction change uses target_revision:null; the server binds the new selected revision.'}}
   if(!opts.prepareSolutionEdit||!opts.prepareWork)return {error:{status:'unavailable'}}
   const solution=await opts.prepareSolutionEdit({...v.solution_edit,request_quote:v.request_quote})
   if(solution.status!=='ready')return {error:solution}
   if(solution.payload.kind!=='bound_solution'||!solution.snapshot.target)return {error:{status:'invalid',message:'Choose the selected Solution edit_ref for this construction scope.'}}
   payload={...domain,kind:'construction_work',data:{key:v.key,solution:solution.payload,construction:domain}}
  }
  return {payload,domain,prepared:await (payload.kind==='construction_work'?opts.prepareWork!(payload):prepare(payload))}
 }
 const changed=(result:Record<string,any>,prepared:Record<string,any>,revision:number)=>opts.coherentWork?{...result,work_operation:'changed',
  diagnostics:{operation:'work_change',reused:prepared.status==='saved',revision,new_revision:result.receipt?.revision??null}}:result
 const reusableCheck=async(draft:Record<string,any>,key:string,today:string):Promise<ConstructionObservation|undefined>=>{
  const valid=(o:ConstructionObservation)=>o.kind==='check'&&o.artifact_id===draft.artifact_id&&o.revision===draft.revision
   &&o.output.work_check_key===key&&constructionEvidenceReuse(o,draft,today)==='current_for_analysis'
  const local=views.findObservation(valid)
  if(local)return local
  if(!opts.readObservations)return undefined
  try{
   const index=await opts.readObservations(draft.artifact_id,draft.revision,null,null)
   if(index?.status!=='ok'||index.projectId!==opts.projectId||index.artifact_id!==draft.artifact_id||index.revision!==draft.revision)return undefined
   // A bounded cache lookup, never a claim of exhaustive result history. A
   // miss recomputes the check; it does not add a new main-model round trip.
   for(const ref of (index.results??[]).filter((r:Record<string,any>)=>r.kind==='check').slice(0,4)){
    const saved=await opts.readObservations(draft.artifact_id,draft.revision,ref.result_id,null)
    const o=saved?.observation as ConstructionObservation|undefined
    if(o&&o.projectId===opts.projectId&&valid(o)){await views.importObservation(o);rememberSaved(o);return o}
   }
  }catch(error){rethrowContinuation(error)}
  return undefined
 }
 const savedResults=new Map<string,SavedConstructionResult>()
 function rememberSaved({output:_output,...ref}:ConstructionObservation){savedResults.set(ref.id,ref)}
 const present=async(kind:string,id:string,revision:number,output:Record<string,any>,observedAt?:string)=>{
  if(!opts.constructionViews)return output
  const result=await views.observe(kind,id,revision,output,observedAt)
  if(opts.formEvidence&&kind==='check'){
   if(!opts.saveObservation)throw Error('construction_evidence_store_unavailable')
   const stored=await opts.saveObservation(views.observation(result.result.result_id)!)
   if(stored.id!==result.result.result_id)throw Error('construction_observation_mismatch')
   await views.importObservation(stored)
   rememberSaved(stored)
   if(!await opts.hasAccess())return {status:'denied'}
   return {...result,result:{...result.result,observed_at:stored.observed_at},persistence:'saved'}
  }
  return result
 }
 // Owner decision 2026-11-07 (server_target_version 1): the server keeps a
 // construction on the current selected target. The current target to send
 // when this revision still uses an older one; null keeps the saved pin.
 const currentTargetFor=async(recordId:string,expectedRevision:number):Promise<{target:number|null}|{error:Record<string,any>}>=>{
  const current=await (opts.readCurrent?.(recordId)??opts.read(recordId,null,null)) as Record<string,any>
  if(!await opts.hasAccess())return {error:{status:'denied'}}
  if(current?.projectId!==opts.projectId||current.status!=='ok'||current.artifact_id!==recordId)return {error:{status:'unavailable'}}
  if(current.revision!==expectedRevision||current.archived!==false||current.source_state!=='changed'||!opts.readCurrentTarget)return {target:null}
  const target=await opts.readCurrentTarget(current.area_id??null)
  if(!await opts.hasAccess())return {error:{status:'denied'}}
  return {target:target!==null&&target!==current.target_revision?target:null}
 }
 // A construction save, prepared and checked without saving: the same path
 // serves a save, a sketched new construction and its commit.
 // sketching: an unfinished construction may still miss concept components or
 // fill a component only partly; those come back as pending, not as refusals.
 const PENDING_CONCEPT=new Set(['concept_part_missing','form_envelope_incomplete'])
 const prepareSave=async(v:Record<string,any>,sketching=false):Promise<{error:Record<string,any>}|{commit:WritePayload;recipe:Record<string,any>;parameters:unknown;readiness:DesignReadiness;pending:Record<string,any>[];made:RuleJoint[];droppedRules:string[]}>=>{
  if(!opts.message.includes(v.request_quote)||!v.request_quote.trim()||(v.record_id===null?v.expected_revision!==0:v.expected_revision<1))return {error:{status:'invalid',message:'Use the current request and exact expected revision.'}}
  const pending:Record<string,any>[]=[]
  // A rule refusal is kept in a sketch, so it is returned only once the
  // construction itself passes; a construction error is never kept (audit round 3).
  let deferred:Record<string,any>|null=null,droppedRules:string[]=[]
  // Lean writing: formulas become the same nodes and bindings a hand-written plan has.
  if(lean){
   // Measurements give formula fields their real values before the recipe is checked.
   const declared=(Array.isArray(v.parameter_plan?.nodes)?v.parameter_plan.nodes:[]).filter((n:any)=>n?.role==='source'&&n.source&&typeof n.id==='string')
   let valueOf=(_id:string):number|undefined=>undefined
   if(declared.length){
    try{
     const src=await opts.readSources(parameterSourcePins({version:1,frames:[],nodes:declared,bindings:[]} as any)),by=new Map(declared.map((n:any)=>[n.id,n.source]))
     valueOf=id=>{const ref:any=by.get(id),r=ref&&(ref.kind==='project_measurement'?src.project:src.physical).get(ref.id);try{return r?measurementMillimetres(r):undefined}catch{return undefined}}
    }catch(error){rethrowContinuation(error)}
   }
   try{const f=compileSaveFormulas(v.recipe,v.parameter_plan,valueOf);v={...v,recipe:f.recipe,parameter_plan:f.plan}}
   catch(e){if(e instanceof CadFormulaError)return {error:{status:'invalid',reason:'formula_invalid',issues:e.issues,message:'No construction saved. Correct the named formulas.'}};throw e}
   // A repeat's parts take the role given for the repeat's id; a part named on its own keeps its own.
   const counts=new Map<string,number>((Array.isArray(v.recipe?.arrays)?v.recipe.arrays:[]).filter((a:any)=>typeof a?.id==='string'&&Number.isSafeInteger(a.count)).map((a:any)=>[a.id,a.count]))
   // Rows naming one id twice are refused by the policy check below, unexpanded (audit round 3).
   const rows=v.instance_policy?.instances
   if(counts.size&&Array.isArray(rows)&&new Set(rows.map((r:any)=>r?.instance_id)).size===rows.length){
    const named=new Set(rows.map((r:any)=>r?.instance_id))
    v={...v,instance_policy:{...v.instance_policy,instances:rows.flatMap((r:any)=>counts.has(r?.instance_id)
     ?Array.from({length:Math.min(counts.get(r.instance_id)!,512)},(_,n)=>`${r.instance_id}.${n+1}`).filter(id=>!named.has(id)).map(id=>({...r,instance_id:id})):[r])}}
   }
  }
  if(v.form_refinement?!opts.readConstructionReadiness:!opts.readDesignReadiness)return {error:{status:'unavailable',message:'Could not read the selected solution and expert advice. Recover that read before fixing construction geometry.'}}
  const read=v.form_refinement
   ? (await opts.readConstructionReadiness!(v.target_revision,v.area_id,v.form_refinement) as Record<string,unknown>|null)?.design_readiness
   : await opts.readDesignReadiness!(v.target_revision,'construction',v.area_id)
  const readiness=parseDesignReadiness(read)
  if(!await opts.hasAccess())return {error:{status:'denied'}}
  if(!readiness||readiness.project_id!==opts.projectId||readiness.area_id!==v.area_id
    ||readiness.purpose!=='construction')return {error:{status:'unavailable',message:'Could not verify advice for this exact selected solution and construction purpose. Read the current target and solution again.'}}
  const checkpoint=v.form_refinement?constructionFormReadiness(readiness,v.form_refinement):readiness
  if(checkpoint.status!=='ready')return {error:{status:checkpoint.status,readiness:checkpoint,issues:checkpoint.issues,
    message:'No construction saved. Resolve the listed evidence and design choices before fixing their geometry: investigate relevant sources, explain alternatives and recommend a supported direction. Reuse prior choices or decide within the existing mandate, then save and select that solution revision.'}}
  if(readiness.target_revision!==v.target_revision)return {error:{status:'conflict',message:'The selected target changed. Read its exact current revision and shared advice before fixing construction geometry.'}}
  const arrays=opts.defaultZero&&opts.constructionRepeats&&Array.isArray(v.recipe?.arrays)?v.recipe.arrays.filter((a:any)=>typeof a?.id==='string'):[]
  const authored=opts.defaultZero?withZeroDefaults(null,parseParameterPlan(v.parameter_plan),arrays):v.parameter_plan
  const expanded=opts.constructionRepeats?expandCadArrays(opts.repeatStart?withoutRepeatStarts(v.recipe):v.recipe,parseParameterPlan(authored)):{recipe:v.recipe,plan:authored}
  if(opts.preciseEditDiagnostics){
   const issues=constructionEditIssues({...v,recipe:expanded.recipe,parameter_plan:expanded.plan,instance_policy:v.instance_policy??constructionInstancePolicy(expanded.recipe as any,null)})
   if(issues.length)return {error:{status:'invalid',issues,message:'No construction changed. Correct only the named posts; for an existing construction use edit_construction_parts.'}}
  }
  const recipe=parseCadAssemblyRequest(structuredClone(expanded.recipe))
  if(!recipe)return {error:{status:'invalid',message:'Invalid CAD recipe or referenced part IDs.'}}
  constructionInstancePolicy(recipe,v.instance_policy)
  let parsedPlan=parseParameterPlan(expanded.plan)
  // Lean writing: a binding for a part that is gone cannot apply, and the
  // formula nodes only it used go with it (a whole revision without a part).
  // Only a part or definition the saved revision had and this one drops takes
  // its bindings along; any other unknown path is a mistake and is named.
  if(lean){
   const targets=cadParameterTargets(recipe),owner=(path:string)=>path.split('/').slice(0,2).join('/')
   const owners=(r:any)=>new Set<string>([...(r?.definitions??[]).map((d:any)=>'definitions/'+d?.id),...(r?.instances??[]).map((i:any)=>'instances/'+i?.id)])
   let gone=new Set<string>()
   if(typeof v.record_id==='string'){
    const saved=await opts.read(v.record_id,v.expected_revision,null) as Record<string,any>
    if(!await opts.hasAccess())return {error:{status:'denied'}}
    if(saved?.projectId===opts.projectId&&saved.status==='ok'&&saved.artifact_id===v.record_id){const now=owners(recipe);gone=new Set([...owners(saved.recipe)].filter(x=>!now.has(x)))
     // A whole save states the rule set; stored rules it leaves out are named (review of #505).
     if(stored&&Array.isArray(saved.joint_rules)){const sent=new Set((Array.isArray(v.joint_rules)?v.joint_rules:[]).map((r:any)=>r?.id));droppedRules=saved.joint_rules.map((r:any)=>r?.id).filter((id:unknown)=>typeof id==='string'&&!sent.has(id))}}
   }
   const bindings=parsedPlan.bindings.filter(b=>targets.has(b.path)||!gone.has(owner(b.path)))
   const unknown=bindings.filter(b=>!targets.has(b.path)).map(b=>b.path)
   if(unknown.length)return {error:{status:'invalid',reason:'binding_path_unknown',issues:unknown.slice(0,24).map(path=>({code:'binding_path_unknown',path,message:'No such field in the recipe; check the part or definition id and the field name.'})),
    message:'No construction saved. These bindings name fields the recipe does not have.'}}
   const fx=unusedFormulaNodes(parsedPlan.nodes,bindings,frameParameterIds(parsedPlan.frames))
   parsedPlan={...parsedPlan,bindings,nodes:parsedPlan.nodes.filter(n=>!fx.includes(n.id))}
  }
  const plan=opts.defaultZero?withZeroDefaults(recipe,parsedPlan):parsedPlan
  // Image-oriented construction checkpoints need a canonical image carrier;
  // never accept model-supplied image hashes as read evidence.
  if(plan.frames.some(f=>f.kind==='image'))return {error:{status:'invalid',message:'Image frames are not supported by the construction checkpoint yet. Keep that orientation as an open question.'}}
  const sources=await opts.readSources(parameterSourcePins(plan))
  const parameters=compileCadParameters(opts.projectId,recipe,plan,sources.project,sources.physical)
  if(!parseCadAssemblyRequest(recipe))return {error:{status:'invalid',message:'Computed dimensions or placement are outside the supported geometry contract.'}}
  // Lean writing: joint rules become one joint per touching pair they cover.
  let made:RuleJoint[]=[],saveJoints:Record<string,any>[]=Array.isArray(v.joints)?v.joints:[]
  if(lean){
   const roles=new Map(constructionInstancePolicy(recipe,v.instance_policy).instances.map(i=>[i.instance_id,i.role] as [string,string]))
   const ruled=ruleJoints(recipe,Array.isArray(v.joints)?v.joints:[],(v.joint_rules??[]) as JointRule[],roles)
   if(ruled.issues.length)deferred={status:'invalid',reason:'joint_rule_invalid',issues:ruled.issues,message:'No construction saved. Correct the named joint rules.'}
   // Code's joints replace their own earlier versions by id; stale ones go.
   const fresh=new Map(ruled.joints.map(j=>[j.id,j]))
   saveJoints=[...saveJoints.filter(j=>!ruled.stale.includes(j?.id)).map(j=>fresh.get(j?.id)??j),...ruled.joints.filter(j=>!saveJoints.some(x=>x?.id===j.id))]
   made=ruled.made
  }
  if(readiness.design_intent?.model){
   const policy=constructionInstancePolicy(recipe,v.instance_policy)
   const references=new Set(policy.instances.filter(i=>i.role==='reference').map(i=>i.instance_id))
   // Lean writing: code completes the FORM mapping from the parts' places.
   if(lean&&v.form_refinement){
    const ext=extendFormMapping(readiness.design_intent,recipe,v.form_refinement,references)
    if(ext.issues.length)return {error:{status:'needs_data',reason:'form_mapping_incomplete',issues:ext.issues,message:'No construction saved. Move a part no concept component holds inside one; for a part several hold, name its component in form_refinement.'}}
    const scope=(r:FormRefinement)=>r.mappings.map(m=>m.component_id).sort().join(',')
    if(ext.changed&&scope(ext.refinement)!==scope(v.form_refinement)){
     const again=parseDesignReadiness((await opts.readConstructionReadiness!(v.target_revision,v.area_id,ext.refinement) as Record<string,unknown>|null)?.design_readiness)
     if(!await opts.hasAccess())return {error:{status:'denied'}}
     if(!again||again.target_revision!==v.target_revision)return {error:{status:'unavailable',message:'Could not verify advice for the completed mapping. Read the current target and solution again.'}}
     const scoped=constructionFormReadiness(again,ext.refinement)
     if(scoped.status!=='ready')return {error:{status:scoped.status,readiness:scoped,issues:scoped.issues,
      message:'No construction saved. A part sits in a concept component whose choices are still open; resolve them or move the part.'}}
    }
    v={...v,form_refinement:ext.refinement}
   }
   const found=v.form_refinement?constructionFormIssues(readiness.design_intent,recipe,references,v.form_refinement,true,sketching):conceptConstructionIssues(readiness.design_intent,recipe,references)
   const issues=sketching?found.filter(i=>!PENDING_CONCEPT.has(i.code)):found
   pending.push(...(sketching?found.filter(i=>PENDING_CONCEPT.has(i.code)):[]))
   if(issues.length)return {error:{status:'needs_data',issues,message:'No construction saved. Preserve the selected concept component identities, dimensions and relations, or explicitly revise that Solution before handoff.'}}
  }
  if(deferred)return {error:deferred}
  if(!await opts.hasAccess())return {error:{status:'denied'}}
  const {record_id,expected_revision,request_quote,parameter_plan:_plan,sub_build_id:_subBuild,joint_rules:_rules,...data}=v
  // A save states the whole rule set, stored for the new revision.
  return {commit:{kind:'construction',record_id,expected_revision,expected_updated_at:null,request_quote,data:{...data,joints:joints(saveJoints),recipe,parameters,
   ...(stored?{joint_rules:structuredClone(Array.isArray(v.joint_rules)?v.joint_rules:[])}:{})}} as WritePayload,recipe,parameters,readiness,pending,made,droppedRules}
 }
 const saveDraft=async(v:Record<string,any>):Promise<Record<string,any>>=>{
  const ready=await prepareSave(v)
  if('error' in ready)return ready.error
  if(!await opts.hasAccess())return {status:'denied'}
  const result=withRuleJoints(await opts.writer!.commit(ready.commit),ready.made,v.joint_rules)
  return result.status==='saved'&&ready.droppedRules.length?{...result,joint_rules_dropped:ready.droppedRules}:result
 }
 // The joints code wrote from joint rules, so Konrad and Bob see each one.
 // Rules sent that wrote nothing say so (audit round 3).
 const RULE_NOTE='No pair these rules cover needed a joint: each touching pair already has one, is in except, or was not added, changed or moved here.'
 const withRuleJoints=(result:Record<string,any>,made:RuleJoint[],rules?:unknown)=>!['saved','sketched'].includes(result?.status)?result
  :made.length?{...result,rule_joints:made.slice(0,64),...(made.length>64?{rule_joints_omitted:made.length-64}:{})}
  :Array.isArray(rules)&&rules.length?{...result,rule_joints:[],rule_note:RULE_NOTE}:result
 // Lean writing in a part edit: what follows from the merged construction.
 // Bindings code wrote for a part that is gone go with it, formula nodes and
 // code zero nodes nothing uses go, a number written where code computes the
 // field is refused rather than silently replaced, rule joints are written
 // for touching pairs without one, and the FORM mapping follows the parts.
 type Cascade={roles:string[];materials:string[];joints:string[]}
 type Recomputed={path:string;written:number;computed:number}
 type LeanExtra={unused:string[];staleBindings:string[];joints:Record<string,any>[];stale:string[];made:RuleJoint[];formRefinement:FormRefinement|null;cascade:Cascade;recomputed:Recomputed[];deferred:Record<string,any>|null;ruleSet:JointRule[]|null}
 const leanEdit=async(v:Record<string,any>,prepared:Record<string,any>,d:ReturnType<typeof zeroDefaults>,raw:Record<string,any>,scope:RuleScope={},storedRules:JointRule[]|null=null):Promise<{error:Record<string,any>}|LeanExtra>=>{
  const next=prepared.next,draft=prepared.draft,planIn=parseParameterPlan(next.parameter_plan)
  const none:LeanExtra={unused:[],staleBindings:[],joints:[],stale:[],made:[],formRefinement:null,cascade:{roles:[],materials:[],joints:[]},recomputed:[],deferred:null,ruleSet:null}
  const recipe=parseCadAssemblyRequest(structuredClone(next.recipe))
  if(!recipe)return none
  // What only served removed parts goes with them: their roles, the materials
  // of removed definitions and joints naming a removed part. Konrad no longer
  // lists these (audit round 2); the answer names them.
  const parts=new Set(recipe.instances.map(i=>i.id)),defs=new Set(recipe.definitions.map(x=>x.id))
  const policyRows=Array.isArray(next.instance_policy?.instances)?next.instance_policy.instances:null
  const cascade:Cascade={roles:(policyRows??[]).filter((r:any)=>!parts.has(r?.instance_id)).map((r:any)=>r.instance_id),
   materials:(Array.isArray(next.materials)?next.materials:[]).filter((m:any)=>!defs.has(m?.definition_id)).map((m:any)=>m.definition_id),
   joints:(Array.isArray(next.joints)?next.joints:[]).filter((j:any)=>!parts.has(j?.first?.instance_id)||!parts.has(j?.second?.instance_id)).map((j:any)=>j.id)}
  const liveJoints=(Array.isArray(next.joints)?next.joints:[]).filter((j:any)=>!cascade.joints.includes(j.id))
  const livePolicy=policyRows?{...next.instance_policy,instances:policyRows.filter((r:any)=>parts.has(r?.instance_id))}:next.instance_policy
  const targets=cadParameterTargets(recipe)
  const plan0={...planIn,nodes:[...planIn.nodes.filter(n=>!d.unused.includes(n.id)),...d.nodes],bindings:[...planIn.bindings.filter(b=>!d.stale.includes(b.path)),...d.bindings]}
  // A binding whose field is gone goes, unless this change wrote it by hand:
  // a mistyped path is refused, not dropped.
  const handPaths=new Set<string>((raw?.bindings?.upsert??[]).map((b:any)=>b?.path))
  const unknown=[...handPaths].filter(path=>!targets.has(path))
  if(unknown.length)return {error:{status:'invalid',reason:'binding_path_unknown',issues:unknown.slice(0,24).map(path=>({code:'binding_path_unknown',path,message:'No such field in the recipe; check the part or definition id and the field name.'})),
   message:'No construction changed. These bindings name fields the recipe does not have.'}}
  const staleBindings=plan0.bindings.filter(b=>!targets.has(b.path)&&!handPaths.has(b.path)).map(b=>b.path)
  const plan1={...plan0,bindings:plan0.bindings.filter(b=>!staleBindings.includes(b.path))}
  const frames=frameParameterIds(plan1.frames),fx=unusedFormulaNodes(plan1.nodes,plan1.bindings,frames)
  const kept=plan1.nodes.filter(n=>!fx.includes(n.id)),used=new Set([...plan1.bindings.map(b=>b.node),...frames])
  for(const n of kept)if(n.role==='derived')n.operands.forEach(o=>used.add(o))
  const zero=kept.filter(n=>Object.values(ZERO_NODE_IDS).includes(n.id as any)&&!used.has(n.id)).map(n=>n.id)
  const unused=[...fx,...zero],plan={...plan1,nodes:kept.filter(n=>!zero.includes(n.id))}
  // Geometry for contacts and envelopes; a plan that does not compile is
  // reported by the normal path after this one.
  try{
   const sources=await opts.readSources(parameterSourcePins(plan))
   compileCadParameters(opts.projectId,recipe,plan,sources.project,sources.physical)
  }catch(error){rethrowContinuation(error);return {...none,unused,staleBindings,cascade}}
  // A number in an upserted part where code computes the field from a node:
  // the computed value or the saved one (copied from a read) leaves it as it
  // is; any other number is refused rather than silently replaced.
  const computed=cadParameterTargets(recipe),bound=new Map(plan.bindings.map(b=>[b.path,b.node]))
  const savedRecipe=draft?.recipe?parseCadAssemblyRequest(structuredClone(draft.recipe)):null,before=savedRecipe?cadParameterTargets(savedRecipe):new Map()
  const fields=[...(raw?.definitions?.upsert??[]).flatMap((x:any)=>x&&typeof x==='object'?definitionFields(x):[]),...(raw?.instances?.upsert??[]).flatMap((x:any)=>x&&typeof x==='object'?instanceFields(x):[])]
  const near=(a:unknown,b:unknown)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=1e-6
  const follows=fields.filter(f=>typeof f.obj[f.key]==='number'&&bound.has(f.path)&&!handPaths.has(f.path)&&!near(f.obj[f.key],computed.get(f.path)?.get()))
  const clash=follows.filter(f=>!near(f.obj[f.key],before.get(f.path)?.get()))
   .map(f=>({code:'number_follows_node',path:f.path,written:f.obj[f.key],computed:computed.get(f.path)!.get(),node:bound.get(f.path),
    message:'This field is computed from a parameter node; write a formula or a node name to change it (origin.zero_mm, or origin.zero_deg for a rotation, for zero).'}))
  // The saved number sent again: computed anew from its node, and named in the answer.
  const recomputed=follows.filter(f=>near(f.obj[f.key],before.get(f.path)?.get())).map(f=>({path:f.path,written:f.obj[f.key] as number,computed:computed.get(f.path)!.get() as number}))
  // A refusal of how something was written is kept, so it is returned only
  // after the construction checks below (audit round 3).
  let deferred:Record<string,any>|null=clash.length?{status:'invalid',reason:'formula_invalid',issues:clash.slice(0,24),message:'No construction changed. These fields follow a parameter node; write a formula or a node name to change them.'}:null
  // A rule joins the parts this change adds, changes or moves: new parts, parts
  // it names, and parts whose computed place or size changed (audit round 3).
  if(scope.touched&&savedRecipe){
   const was=new Map(savedRecipe.instances.map(i=>[i.id,i])),defWas=new Map(savedRecipe.definitions.map(x=>[x.id,JSON.stringify(x)]))
   const defNow=new Map(recipe.definitions.map(x=>[x.id,JSON.stringify(x)]))
   for(const i of recipe.instances){const w=was.get(i.id)
    if(!w||w.definition_id!==i.definition_id||JSON.stringify(w.placement)!==JSON.stringify(i.placement)||defWas.get(i.definition_id)!==defNow.get(i.definition_id))scope.touched.add(i.id)}
  }
  const policy=constructionInstancePolicy(recipe,livePolicy)
  const roles=new Map(policy.instances.map(i=>[i.instance_id,i.role] as [string,string]))
  // Stored rules apply too; a sent rule replaces a stored one by id, and a
  // stored rule of a removed definition goes (owner decision 2026-11-08).
  // A sent rule for a definition pair replaces the stored rule of that pair
  // too, so a new id never makes the pair ambiguous (review of #505).
  const sent=(v.joint_rules??[]) as JointRule[],sentIds=new Set(sent.map(r=>r.id)),pairOf=(r:JointRule)=>JSON.stringify([...(r.between??[])].sort())
  const sentPairs=new Set(sent.map(pairOf))
  const ruleSet=storedRules?[...storedRules.filter(r=>!sentIds.has(r.id)&&!sentPairs.has(pairOf(r))&&(r.between??[]).every(x=>defs.has(x))),...sent]:null
  const ruled=ruleJoints(recipe,liveJoints,ruleSet??sent,roles,scope)
  if(ruled.issues.length)deferred??={status:'invalid',reason:'joint_rule_invalid',issues:ruled.issues,message:'No construction changed. Correct the named joint rules.'}
  if(ruleSet&&ruleSet.length>32)deferred??={status:'invalid',reason:'joint_rules_full',message:'No construction changed. A construction holds at most 32 joint rules; replace one by its id or its definition pair.'}
  let formRefinement:FormRefinement|null=null
  // An edit the server moves to a newer selected Solution maps its parts in
  // that Solution's concept; the saved pin is refused once the target moved
  // (Entrén, 2026-11-08: every part edit after Bob's Solution edit failed).
  const target=Number.isSafeInteger(v.target_revision)?v.target_revision as number:draft?.target_revision
  if(draft?.form_refinement&&Number.isSafeInteger(target)&&opts.readConstructionReadiness){
   const raw=await opts.readConstructionReadiness(target,draft.area_id??null,draft.form_refinement) as Record<string,unknown>|null
   if(!await opts.hasAccess())return {error:{status:'denied'}}
   if(raw?.status==='conflict')return {error:{status:'conflict',reason:'construction_target_changed',
    message:'No construction changed. The selected Solution changed while this edit was prepared; send the same edit again.'}}
   const read=parseDesignReadiness(raw?.design_readiness)
   if(!read?.design_intent?.model)return {error:{status:'unavailable',message:'Could not read the concept this construction is mapped to; nothing changed.'}}
   const references=new Set(policy.instances.filter(i=>i.role==='reference').map(i=>i.instance_id))
   const ext=extendFormMapping(read.design_intent,recipe,draft.form_refinement,references,(v.form_assign??[]) as FormAssignment[])
   if(ext.issues.length)return {error:{status:'needs_data',reason:'form_mapping_incomplete',issues:ext.issues,message:'No construction changed. Move a part no concept component holds inside one; for a part several hold, name its component in form_assign.'}}
   // A part in a concept component this construction did not cover yet brings
   // that component's open choices into scope; say so before the write.
   const scope=(r:FormRefinement)=>r.mappings.map(m=>m.component_id).sort().join(',')
   if(ext.changed&&scope(ext.refinement)!==scope(draft.form_refinement)){
    const again=parseDesignReadiness((await opts.readConstructionReadiness(target,draft.area_id??null,ext.refinement) as Record<string,unknown>|null)?.design_readiness)
    if(!await opts.hasAccess())return {error:{status:'denied'}}
    if(!again)return {error:{status:'unavailable',message:'Could not verify advice for the completed mapping; nothing changed.'}}
    const scoped=constructionFormReadiness(again,ext.refinement)
    if(scoped.status!=='ready')return {error:{status:scoped.status,readiness:scoped,issues:scoped.issues,
     message:'No construction changed. A part sits in a concept component whose choices are still open; resolve them or move the part.'}}
   }
   if(ext.changed)formRefinement=ext.refinement
  }
  return {unused,staleBindings,joints:ruled.joints,stale:ruled.stale,made:ruled.made,formRefinement,cascade,recomputed,deferred,ruleSet}
 }
 // Lean writing: formulas in upserted definitions and parts become node and
 // binding upserts, against the saved revision this change applies to. A
 // sketch keeps what was written, so this runs at every prepare.
 const readBase=async(v:Record<string,any>):Promise<{error:Record<string,any>}|{draft:Record<string,any>}>=>{
  const draft=await opts.read(v.record_id,v.expected_revision,null) as Record<string,any>
  if(!await opts.hasAccess())return {error:{status:'denied'}}
  if(draft?.projectId!==opts.projectId||draft.status!=='ok'||draft.artifact_id!==v.record_id||draft.revision!==v.expected_revision)return {error:{status:'conflict',message:'Read the current revision of this construction; nothing changed.'}}
  return {draft}
 }
 // A part edit, prepared against its saved revision and compiled, not saved.
 // The same path serves a direct save, a sketched change and a sketch commit.
 const prepareParts=async(v:Record<string,any>):Promise<{error:Record<string,any>}|{payload:WritePayload;domain:WritePayload;prepared:Record<string,any>;made?:RuleJoint[];cascaded?:{roles:string[];materials:string[];joints:string[]}|null;recomputed?:Recomputed[];codeRemoved?:string[]}>=>{
  if(!v.request_quote.trim()||!opts.message.includes(v.request_quote))return {error:{status:'invalid',issues:[{code:'request_quote',path:'request_quote'}]}}
  let made:RuleJoint[]=[],ruleOnly:RuleJoint[]=[],cascaded:{roles:string[];materials:string[];joints:string[]}|null=null,recomputed:Recomputed[]=[],deferred:Record<string,any>|null=null,codeRemoved:string[]=[],baseRules:JointRule[]|null=null,ruleSet:JointRule[]|null=null
  const raw=v.changes
  if(lean){
   const base=await readBase(v)
   if('error' in base)return base
   if(stored)baseRules=Array.isArray(base.draft.joint_rules)?base.draft.joint_rules as JointRule[]:[]
   // A measurement added in this change gives its formulas real values too.
   const added=(Array.isArray(v.changes?.nodes?.upsert)?v.changes.nodes.upsert:[]).filter((n:any)=>n?.role==='source'&&n.source&&typeof n.id==='string')
   let valueOf=(_id:string):number|undefined=>undefined
   if(added.length){
    try{
     const src=await opts.readSources(parameterSourcePins({version:1,frames:[],nodes:added,bindings:[]} as any)),by=new Map(added.map((n:any)=>[n.id,n.source]))
     valueOf=id=>{const ref:any=by.get(id),r=ref&&(ref.kind==='project_measurement'?src.project:src.physical).get(ref.id);try{return r?measurementMillimetres(r):undefined}catch{return undefined}}
    }catch(error){rethrowContinuation(error)}
   }
   try{v={...v,changes:compileEditFormulas(v.changes??{},(base.draft.parameters?.nodes??[]) as ParameterInput[],valueOf)}}
   catch(e){if(e instanceof CadFormulaError)return {error:{status:'invalid',reason:'formula_invalid',issues:e.issues,message:'No construction changed. Correct the named formulas.'}};throw e}
   // An edit that only sends joint rules joins the saved construction's
   // touching parts; the joints are found on the saved revision and sent as
   // the change (the database refuses an empty one).
   if(!sketchChangeCount(v.changes??{})&&Array.isArray(v.joint_rules)&&v.joint_rules.length){
    const draft=base.draft,recipe=parseCadAssemblyRequest(structuredClone(draft.recipe))
    const plan=parseParameterPlan({version:1,frames:(draft.parameters?.frames??[]).map(({source_version:_v,translation_mm:_t,rotation_degrees:_r,axes:_a,...f}:any)=>f),
     nodes:(draft.parameters?.nodes??[]).map(({normalized:_n,sources:_s,...n}:any)=>n),bindings:draft.parameters?.bindings??[]})
    const saved={draft,next:{recipe:draft.recipe,parameter_plan:plan,materials:draft.materials,joints:draft.joints,instance_policy:draft.instance_policy??null}}
    const extra=recipe?await leanEdit(v,saved,zeroDefaults(recipe,plan),{},{rewrite:true},baseRules):null
    if(extra&&'error' in extra)return extra
    if(extra?.deferred)return {error:extra.deferred}
    if(extra&&(extra.joints.length||extra.stale.length)){v={...v,changes:{joints:{upsert:extra.joints,remove:extra.stale}}};ruleOnly=extra.made;codeRemoved=extra.stale}
    else if(extra)return {error:{status:'invalid',reason:'rules_wrote_nothing',rule_joints:[],message:'No construction changed. '+RULE_NOTE+(stored?' Rules are stored with the revision a change saves; rules that write no joint save nothing, so send a new rule with the parts it is for.':'')}}
   }
  }
 const editPayload=(changes:Record<string,any>,formRefinement:FormRefinement|null=null,rules:JointRule[]|null=null):WritePayload=>({kind:'construction_edit',record_id:v.record_id,expected_revision:v.expected_revision,expected_updated_at:null,request_quote:v.request_quote,
   data:{key:v.key,change_note:v.change_note,changes:changes?.joints?{...changes,joints:{...changes.joints,upsert:joints(changes.joints.upsert)}}:changes,computed:null,
    ...(opts.coherentWork?{target_revision:v.target_revision}:{}),...(opts.constructionText&&v.text?{text:v.text}:{}),...(formRefinement?{form_refinement:formRefinement}:{}),...(rules?{joint_rules:rules}:{})}})
  let change=await prepareChange(v,editPayload(v.changes),opts.prepareEdit!)
  if(change.error)return {error:change.error}
  // The server merges the plan, so zero defaults are known only after a first
  // prepare; they ride a second prepare as ordinary binding and node changes.
  const merged=opts.defaultZero&&change.prepared.status==='ready'&&change.prepared.next?parseCadAssemblyRequest(structuredClone(change.prepared.next.recipe)):null
  if(merged){
   const d=zeroDefaults(merged,parseParameterPlan(change.prepared.next.parameter_plan))
   const c=structuredClone(v.changes) as Record<string,any>,list=(k:string)=>c[k]??={upsert:[],remove:[]}
   let added=false,formRefinement:FormRefinement|null=null
   made=[]
   if(d.bindings.length||d.nodes.length||d.unused.length||d.stale.length){
    added=true
    if(d.bindings.length)list('bindings').upsert.push(...d.bindings)
    if(d.stale.length)list('bindings').remove.push(...d.stale.filter(path=>!c.bindings.remove.includes(path)))
    if(d.nodes.length)list('nodes').upsert.push(...d.nodes)
    if(d.unused.length)list('nodes').remove.push(...d.unused.filter(id=>!c.nodes.remove.includes(id)))
   }
   if(lean){
    // A rule in a part edit joins the parts this change adds or changes, so an
    // except from an earlier save still holds for the rest.
    // Code adds the parts whose computed place or size changed.
    const touched=new Set<string>([...(raw?.instances?.upsert??[]).map((x:any)=>x?.id),...(raw?.roles?.upsert??[]).map((x:any)=>x?.instance_id)])
    const extra=await leanEdit(v,change.prepared,d,raw,{touched},baseRules)
    if('error' in extra)return extra
    deferred=extra.deferred;recomputed=extra.recomputed
    // What only served removed parts goes with them.
    const drop=(name:string,key:string,ids:string[])=>{for(const id of ids)if(!list(name).remove.includes(id)&&!c[name].upsert.some((x:any)=>x?.[key]===id))c[name].remove.push(id)}
    drop('roles','instance_id',extra.cascade.roles);drop('materials','definition_id',extra.cascade.materials);drop('joints','id',extra.cascade.joints)
    cascaded=extra.cascade
    for(const id of extra.unused){
     const at=c.nodes?.upsert.findIndex((n:any)=>n?.id===id)??-1
     if(at>=0)c.nodes.upsert.splice(at,1);else if(!list('nodes').remove.includes(id))c.nodes.remove.push(id)
    }
    for(const path of extra.staleBindings){
     const at=c.bindings?.upsert.findIndex((b:any)=>b?.path===path)??-1
     if(at>=0)c.bindings.upsert.splice(at,1);else if(!list('bindings').remove.includes(path))c.bindings.remove.push(path)
    }
    // A code joint written again replaces its saved version (not removed and
    // added in one change); a stale one goes unless this change upserts it.
    if(extra.joints.length){
     const ids=new Set(extra.joints.map(j=>j.id)),upsert=list('joints').upsert
     for(const j of extra.joints){const at=upsert.findIndex((x:any)=>x?.id===j.id);if(at>=0)upsert[at]=j;else upsert.push(j)}
     c.joints.remove=c.joints.remove.filter((r:string)=>!ids.has(r))
    }
    const stale=extra.stale.filter(id=>!c.joints?.upsert.some((j:any)=>j?.id===id)&&!c.joints?.remove.includes(id))
    if(stale.length)list('joints').remove.push(...stale)
    codeRemoved=[...new Set([...codeRemoved,...stale])]
    formRefinement=extra.formRefinement;made=extra.made
    // A changed rule set is stored with the new revision; an unchanged one is inherited.
    const byId=(rules:JointRule[]|null)=>JSON.stringify([...(rules??[])].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))
    if(extra.ruleSet&&byId(extra.ruleSet)!==byId(baseRules))ruleSet=extra.ruleSet
    added||=!!(extra.unused.length||extra.staleBindings.length||extra.joints.length||stale.length||formRefinement||ruleSet||Object.values(extra.cascade).some(x=>x.length))
   }
   if(added){
    change=await prepareChange(v,editPayload(c,formRefinement,ruleSet),opts.prepareEdit!)
    if(change.error)return {error:change.error}
   }
  }
  const {payload,domain,prepared}=change
  if(!await opts.hasAccess())return {error:{status:'denied'}}
  // Bob may first save the owner's decisions in the selected Solution; the
  // unchanged construction then points at an older target and the server
  // refuses target_revision:null. That is a missing input, not a write race,
  // so it stays repairable in the same job (bed, 2026-11-06).
  if(opts.serverTarget&&opts.coherentWork&&payload.kind==='construction_edit'&&v.target_revision===null&&prepared.status==='conflict'&&prepared.reason==='construction_changed'){
   const bound=await currentTargetFor(v.record_id,v.expected_revision)
   if('error' in bound)return bound
   if(bound.target!==null)return await prepareParts({...v,target_revision:bound.target})
   return {error:{status:'invalid',reason:'construction_sources_changed',
    message:'No construction changed. A measurement or other source this construction uses has a newer revision; update it with change_construction_parameters first.'}}
  }
  if(opts.coherentWork&&payload.kind==='construction_edit'&&v.target_revision===null&&prepared.status==='conflict'&&prepared.reason==='construction_changed'){
   const current=await (opts.readCurrent?.(v.record_id)??opts.read(v.record_id,null,null)) as Record<string,any>
   if(!await opts.hasAccess())return {error:{status:'denied'}}
   if(current?.projectId===opts.projectId&&current.status==='ok'&&current.artifact_id===v.record_id
    &&current.revision===v.expected_revision&&current.archived===false&&current.source_state==='changed')
    return {error:{status:'invalid',reason:'target_revision_required',source_state:current.source_state,
     message:'No construction changed. This revision still uses an older selected Solution or changed sources, so target_revision:null (keep the old pin) is refused. Read view=work for the current selected Solution and resend this same edit with its current target_revision. Changed measurements use change_construction_parameters with their newer revisions.'}}
  }
  if(prepared.status!=='ready'&&prepared.status!=='saved')return {error:prepared}
  if(prepared.status==='ready'){
   const draft=prepared.draft,next=prepared.next
   if(draft?.projectId!==opts.projectId||draft.artifact_id!==v.record_id||draft.revision!==v.expected_revision||draft.current_revision!==v.expected_revision||draft.archived)return {error:{status:'conflict'}}
   if(!next)return {error:{status:'unavailable'}}
   const issues=constructionEditIssues(next,draft)
   if(issues.length)return {error:{status:'invalid',issues,message:'No construction changed. Correct only the named posts and their dependencies.'}}
   const recipe=parseCadAssemblyRequest(structuredClone(next.recipe))
   if(!recipe)return {error:{status:'invalid',issues:[{code:'invalid_recipe',path:'changes'}]}}
   constructionInstancePolicy(recipe,next.instance_policy)
   const plan=parseParameterPlan(next.parameter_plan)
   if(plan.frames.some(f=>f.kind==='image'))return {error:{status:'invalid',issues:[{code:'unsupported_image_frame',path:'frames'}]}}
   const sources=await opts.readSources(parameterSourcePins(plan))
   const parameters=compileCadParameters(opts.projectId,recipe,plan,sources.project,sources.physical)
   if(!parseCadAssemblyRequest(recipe))return {error:{status:'invalid',issues:[{code:'computed_geometry_invalid',path:'changes'}]}}
   if(opts.constructionText){
    const after=recipeSize(recipe,next.instance_policy),stale=staleSizeText(v.text??draft,recipeSize(draft.recipe,draft.instance_policy),after)
    if(stale.length)return {error:staleTextRejection(stale,after!,!!v.text)}
   }
   domain.data.computed={recipe,parameters}
  }
  if(deferred)return {error:deferred}
  return {payload,domain,prepared,made:made.length?made:ruleOnly,cascaded,recomputed,codeRemoved}
 }
 // The database refuses a concept mismatch without naming it; code names the
 // component, the parts outside it and the numbers (deep audit 2026-11-08).
 const conceptIssues=async(prepared:Record<string,any>,domain:WritePayload):Promise<Record<string,any>[]>=>{
  try{
   const draft=prepared.draft,data=domain.data as Record<string,any>,computed=data.computed as Record<string,any>|null
   const refinement=data.form_refinement??draft?.form_refinement
   // The concept of the target this write binds to (a moved one after a retarget).
   const target=Number.isSafeInteger(data.target_revision)?data.target_revision as number:draft?.target_revision
   if(!computed?.recipe||!refinement||!Number.isSafeInteger(target)||!opts.readConstructionReadiness)return []
   const read=parseDesignReadiness((await opts.readConstructionReadiness(target,draft.area_id??null,refinement) as Record<string,unknown>|null)?.design_readiness)
   if(!await opts.hasAccess()||!read?.design_intent?.model)return []
   const recipe=parseCadAssemblyRequest(structuredClone(computed.recipe))
   if(!recipe)return []
   const policy=constructionInstancePolicy(recipe,prepared.next?.instance_policy??null)
   const references=new Set(policy.instances.filter(i=>i.role==='reference').map(i=>i.instance_id))
   return constructionFormIssues(read.design_intent,recipe,references,refinement,true)
    .filter(i=>['concept_geometry_changed','form_instance_unmapped','form_instance_missing','concept_mapping_unsupported'].includes(i.code)).slice(0,12)
  }catch(error){rethrowContinuation(error);return []}
 }
 const editParts=async(v:Record<string,any>):Promise<Record<string,any>>=>{
  const ready=await prepareParts(v)
  if('error' in ready)return ready.error
  if(!await opts.hasAccess())return {status:'denied'}
  const removed=ready.codeRemoved??[]
  const result=withRuleJoints(changed(await opts.writer!.commit(ready.payload),ready.prepared,v.expected_revision),ready.made??[],removed.length?undefined:v.joint_rules)
  if(lean&&result.status==='invalid'&&typeof result.reason==='string'&&result.reason.startsWith('concept_')){
   const issues=await conceptIssues(ready.prepared,ready.domain)
   if(issues.length)return {...result,issues}
  }
  if(result.status!=='saved')return result
  const gone=ready.cascaded&&Object.values(ready.cascaded).some(x=>x.length)?ready.cascaded:null
  // Code's joints this edit removed: parts that no longer touch, a reference part, a pair now in except (round 4).
  return {...result,...(gone?{removed_with_parts:gone}:{}),...(ready.recomputed?.length?{recomputed:ready.recomputed.slice(0,24)}:{}),
   ...(removed.length?{code_joints_removed:removed.slice(0,64)}:{})}
 }
 // Owner decision 2026-11-07 (sketchbook B): the whole-model check of a sketch,
 // run on the merged draft in code, the same check a saved revision gets.
 const sketchCheck=async(draft:Record<string,any>):Promise<Record<string,any>>=>{
  const unchecked={status:'unavailable',message:'The sketch could not be checked; it is checked again when it is saved.'}
  if(!opts.readCatalog)return unchecked
  const catalog=new Map<string,Record<string,any>>()
  for(const m of draft.materials??[])for(const kind of ['material','part']){
   const id=m[kind+'_id'],revision=m[kind+'_revision']
   if(!id||catalog.has(`${id}@${revision}`))continue
   if(catalog.size>=32)return {status:'unsupported',message:'This check supports at most 32 distinct catalog revisions.'}
   const row=await opts.readCatalog(id,revision)
   if(row?.projectId!==opts.projectId||row.status!=='ok'||row.record?.id!==id||row.record?.revision!==revision)return unchecked
   catalog.set(`${id}@${revision}`,row.record)
  }
  const today=(opts.now?.()??new Date()).toISOString().slice(0,10)
  const model=opts.formEvidence?checkConstructionEvidence(draft,catalog,today,[],[]):checkConstruction(draft,catalog,today,!!opts.constructionViews)
  const {details_read:_read,result_id:_result,...check}=compactConstructionCheck({...model,status:'checked'})
  return {...check,scope:'sketch'}
 }
 const SKETCH_KEPT='Nothing sketched; your sketch is unchanged.'
 const KEPT_EDIT='This change is kept in your sketch of the construction; send only the corrections with mode sketch, then commit it with commit_construction_sketch.'
 const KEPT_NEW='This construction is kept in your sketch under its key. Send the correction with mode sketch and the same key, with the current title, description, area, refinement and open questions; parts you do not send stay as they are. Then commit it with commit_construction_sketch.'
 // Owner review 2026-11-07: only a refusal of how something was written is
 // kept (a text that is not plain prose, a formula, a joint rule), never one
 // of the construction itself (geometry, concept, readiness, collisions):
 // those are refused as before and nothing is kept. A kept sketch is never a
 // saved construction; its commit runs every check again.
 const keepable=(r:Record<string,any>)=>r?.status==='invalid'&&(r.validation?.code==='human_text'||['formula_invalid','joint_rule_invalid'].includes(r.reason))
 // A refused write stored in the sketch: the refusal stays the answer, with
 // where the work now waits.
 const keptAfter=async(refusal:Record<string,any>,store:()=>Promise<Record<string,any>>,note:string):Promise<Record<string,any>>=>{
  const kept=await store()
  const sketch=kept.status==='sketched'?{status:'kept',...(kept.new_key?{new_key:kept.new_key,part_count:kept.part_count}:{record_id:kept.record_id,base_revision:kept.base_revision,change_count:kept.change_count})}
   :kept.sketch?.status==='kept_with_issues'?kept.sketch:null
  // Not kept: a second problem the refusal did not name is shown with it.
  if(!sketch)return kept.status&&kept.status!=='denied'&&(kept.status!==refusal.status||kept.reason!==refusal.reason)
   ?{...refusal,also:{status:kept.status,...(kept.reason?{reason:kept.reason}:{}),...(kept.issues?{issues:kept.issues}:{}),...(typeof kept.message==='string'?{message:kept.message}:{})}}:refusal
  return {...refusal,saved:false,sketch,message:[typeof refusal.message==='string'?refusal.message:null,note].filter(Boolean).join(' ')}
 }
 // A refused direct edit is kept only where no sketch of that construction is
 // open: merged into ordinary sketch work, a later rebase could restore it
 // over newer saved work (audit round 2).
 const keepEdit=async(refusal:Record<string,any>,input:Record<string,any>):Promise<Record<string,any>>=>{
  const open=await opts.sketches!.read(input.record_id),prior=open.status==='ok'?parseSketch(open.sketch):null
  if(open.status!=='ok'||prior&&prior.shadow!==true)return refusal
  const out=await keptAfter(refusal,()=>sketchParts({...input,shadow:true}),KEPT_EDIT)
  // This try replaces the earlier one; when it cannot be kept, the earlier one goes (round 4).
  if(!out.sketch&&prior?.shadow===true&&(await opts.sketches!.drop(input.record_id)).status==='dropped')return {...out,earlier_try:EARLIER_TRY}
  return out
 }
 const EARLIER_TRY={status:'discarded',message:'The sketch kept from your earlier refused try is discarded; this try replaces it.'}
 // The same for a refused direct save, under its key.
 const keepSave=async(refusal:Record<string,any>,input:Record<string,any>):Promise<Record<string,any>>=>{
  const open=await readNewSketch(input.key)
  if('error' in open||open.sketch&&open.sketch.shadow!==true)return refusal
  const out=await keptAfter(refusal,()=>sketchNew({...input,shadow:true}),KEPT_NEW)
  if(!out.sketch&&open.sketch?.shadow===true&&(await opts.newSketches!.drop(input.key)).status==='dropped')return {...out,earlier_try:EARLIER_TRY}
  return out
 }
 // A saved change covers a shadow when it names every id the shadow changes,
 // every rule and assignment it holds, and its text (audit round 3: a kept
 // rule-only change was dropped by any saved edit).
 const covers=(saved:Record<string,any>,shadow:ConstructionSketch)=>Object.entries(SKETCH_KEYS).every(([name,key])=>{
  const d=(shadow.changes as Record<string,any>)?.[name];if(!d)return true
  const ids=new Set<string>([...(saved.changes?.[name]?.upsert??[]).map((x:any)=>x?.[key]),...(saved.changes?.[name]?.remove??[])])
  return [...(d.upsert??[]).map((x:any)=>x?.[key]),...(d.remove??[])].every((id:string)=>ids.has(id))
 })&&(shadow.joint_rules??[]).every(r=>(saved.joint_rules??[]).some((x:any)=>x?.id===r.id))
  &&(shadow.form_assign??[]).every(a=>(saved.form_assign??[]).some((x:any)=>x?.instance_id===a.instance_id))
  &&(!shadow.text||!!saved.text)
 const savedKeys=async(id:string,revision:number)=>{
  const draft=await opts.read(id,revision,null) as Record<string,any>
  return draft?.projectId===opts.projectId&&draft.status==='ok'&&draft.artifact_id===id&&draft.revision===revision?baseKeysOf(draft):null
 }
 const byKey=(prior:unknown,next:unknown,key:string)=>{
  const out=Array.isArray(prior)?structuredClone(prior) as Record<string,any>[]:[]
  for(const item of Array.isArray(next)?next as Record<string,any>[]:[]){const at=out.findIndex(x=>x?.[key]===item?.[key]);if(at>=0)out[at]=structuredClone(item);else out.push(structuredClone(item))}
  return out
 }
 const sketchRefusal=(error:Record<string,any>)=>({...error,saved:false,sketched:false,
  message:[typeof error.message==='string'?error.message:null,SKETCH_KEPT].filter(Boolean).join(' ')})
 const readSketch=async(id:string):Promise<{error:Record<string,any>}|{revision:number;sketch:ConstructionSketch|null}>=>{
  const stored=await opts.sketches!.read(id)
  if(stored.status!=='ok')return {error:{status:'unavailable',saved:false,message:'The sketch could not be read; nothing changed.'}}
  const sketch=stored.sketch==null?null:parseSketch(stored.sketch)
  if(stored.sketch!=null&&!sketch)return {error:{status:'unavailable',saved:false,message:'The sketch could not be read; nothing changed.'}}
  return {revision:stored.revision,sketch}
 }
 // The merged change list, prepared and checked on its base, then stored.
 const storeSketch=async(next:Record<string,any>,prior:ConstructionSketch|null,storedRevision:number,notes:string[],baseKeys?:ConstructionSketch['base_keys']):Promise<Record<string,any>>=>{
  const count=sketchChangeCount(next.changes)
  if(!count&&!next.text&&!(lean&&next.joint_rules?.length)){
   const dropped=await opts.sketches!.drop(next.record_id)
   return dropped.status==='dropped'?{status:'sketched',saved:false,record_id:next.record_id,change_count:0,message:'Your sketch has no changes left and was closed.'}
    :{status:'unavailable',saved:false,message:'The sketch could not be closed.'}
  }
  const ready=await prepareParts({...next,changes:count?next.changes:{instances:{upsert:[],remove:[]}}})
  const lean_fields=lean?{joint_rules:next.joint_rules??[],form_assign:next.form_assign??[]}:{}
  // A sketch begun only to keep a refused direct change is that change's
  // shadow; a later sketch call makes it ordinary work.
  const shadowOf=(n:Record<string,any>,p:ConstructionSketch|null):{shadow?:true}=>n.shadow===true&&(!p||p.shadow===true)?{shadow:true}:{}
  if('error' in ready){
   // Lean writing: a written change stays in the sketch with what is wrong,
   // so the next call sends only the corrections.
   if(!lean||!keepable(ready.error))return sketchRefusal(ready.error)
   const base=baseKeys??prior?.base_keys??await savedKeys(next.record_id,next.expected_revision)
   if(!base)return sketchRefusal(ready.error)
   const kept:ConstructionSketch={version:1,base_revision:next.expected_revision,base_keys:base,changes:next.changes,change_count:count,
    text:next.text??null,target_revision:next.target_revision??null,notes:notes.slice(-20),...lean_fields,...shadowOf(next,prior)}
   if(!await opts.hasAccess())return {status:'denied'}
   const put=await opts.sketches!.put(next.record_id,storedRevision,kept)
   if(put.status!=='stored')return sketchRefusal(ready.error)
   return {...ready.error,saved:false,sketched:true,sketch:{status:'kept_with_issues',base_revision:kept.base_revision,change_count:count},
    message:[typeof ready.error.message==='string'?ready.error.message:null,KEPT_EDIT].filter(Boolean).join(' ')}
  }
  if(ready.prepared.status!=='ready')return sketchRefusal({status:'invalid',reason:'key_already_saved',message:'This key belongs to a change saved in this request; give the sketched change a new key.'})
  const draft=ready.prepared.draft,merged=ready.prepared.next,computed=ready.domain.data.computed as Record<string,any>
  // The check sees what a commit would save: code's joints and the mapping it keeps.
  const check=await sketchCheck({...draft,recipe:computed.recipe,parameters:computed.parameters,materials:merged.materials,joints:merged.joints,instance_policy:merged.instance_policy,
   form_refinement:(ready.domain.data as Record<string,any>).form_refinement??draft.form_refinement})
  const sketch:ConstructionSketch={version:1,base_revision:next.expected_revision,base_keys:baseKeys??prior?.base_keys??baseKeysOf(draft),changes:next.changes,
   change_count:count,text:next.text??null,target_revision:next.target_revision??null,notes:notes.slice(-20),...lean_fields,...shadowOf(next,prior)}
  if(!await opts.hasAccess())return {status:'denied'}
  const put=await opts.sketches!.put(next.record_id,storedRevision,sketch)
  if(put.status!=='stored')return {status:put.status,saved:false,message:'The sketch was not stored; read it with commit_construction_sketch action read before continuing.'}
  return withRuleJoints({status:'sketched',saved:false,record_id:next.record_id,base_revision:sketch.base_revision,change_count:count,sketch:sketchSummary(sketch.changes),check,
   message:'Kept in your sketch and checked as a whole; nothing is saved yet. Save it with commit_construction_sketch when the assignment is done or at a step the owner should see.'},ready.made??[])
 }
 const sketchParts=async(v:Record<string,any>):Promise<Record<string,any>>=>{
  if(!v.request_quote.trim()||!opts.message.includes(v.request_quote))return {status:'invalid',issues:[{code:'request_quote',path:'request_quote'}]}
  if(v.solution_edit!=null)return sketchRefusal({status:'invalid',reason:'sketch_construction_only',
   message:'A sketch changes only this construction. Save the Solution change first, or use mode save for a joint Solution and Construction change.'})
  const read=await readSketch(v.record_id)
  if('error' in read)return read.error
  // A sketch kept from a refused direct change is replaced by the next refused
  // try, not merged with it: each try is a whole change (audit round 3).
  const prior=lean&&v.shadow===true&&read.sketch?.shadow===true?null:read.sketch
  if(prior&&prior.base_revision!==v.expected_revision)return sketchRefusal({status:'conflict',reason:'sketch_base_differs',base_revision:prior.base_revision,
   message:`Your sketch of this construction starts from revision ${prior.base_revision}. Send changes with that expected_revision, or commit, rebase or discard the sketch first.`})
  if(lean){
   // Rules and assignments from earlier calls stay; a later one with the same id replaces it.
   // A rule naming a definition this call removes, or an assignment of a part
   // it removes, goes with it.
   const goneDefs=new Set<string>(v.changes?.definitions?.remove??[]),goneParts=new Set<string>(v.changes?.instances?.remove??[])
   v={...v,joint_rules:byKey(prior?.joint_rules,v.joint_rules,'id').filter((r:any)=>!(r?.between??[]).some((x:string)=>goneDefs.has(x))),
    form_assign:byKey(prior?.form_assign,v.form_assign,'instance_id').filter((a:any)=>!goneParts.has(a?.instance_id))}
  }
  let changes=v.changes
  if(prior){
   const composed=composeSketchChanges(prior.changes,v.changes,prior.base_keys)
   if('issues' in composed)return sketchRefusal({status:'invalid',issues:composed.issues,
    message:'An id is both upserted and removed, or a removed id is neither saved nor in the sketch.'})
   changes=composed.changes
  }else if(!sketchChangeCount(changes))changes={}
  return await storeSketch({...v,changes,text:v.text??prior?.text??null,target_revision:v.target_revision??prior?.target_revision??null},
   prior,read.revision,[...(read.sketch?.notes??[]),v.change_note])
 }
 const sketchCommit=async(v:Record<string,any>):Promise<Record<string,any>>=>{
  if(opts.newSketches){
   // Lean writing: a keyed sketch may also revise a saved construction, and
   // the job's construction is bound to record_id, so new_key decides.
   if(lean?v.record_id===null&&v.new_key===null:(v.record_id===null)===(v.new_key===null))return {status:'invalid',saved:false,validation:{code:'sketch_subject',fields:['new_key']},
    message:'Name either an existing construction or, for a new one, new_key: the key its sketch used.'}
   if(lean?v.new_key!==null:v.record_id===null)return await newSketchCommit(v)
  }
  const read=await readSketch(v.record_id)
  if('error' in read)return read.error
  const sketch=read.sketch
  if(!sketch)return {status:'not_found',saved:false,message:'No sketch of this construction is open in this request.'}
  const kept={status:'kept',base_revision:sketch.base_revision,change_count:sketch.change_count}
  if(lean&&v.action==='commit'){
   const prose=humanTextRejection(proseFields({changes:sketch.changes,text:sketch.text,joint_rules:sketch.joint_rules??[]},CONSTRUCTION_PROSE.edit_construction_parts))
   if(prose)return {status:'invalid',saved:false,sketch:kept,validation:{code:'human_text',fields:prose.fields},message:'Not saved. '+prose.message+' Correct it with mode sketch; your sketch is kept.'}
  }
  if(v.action==='read'){
   const full=countSerializedTokens(sketch.changes)<=6000
   return {status:'ok',saved:false,record_id:v.record_id,base_revision:sketch.base_revision,change_count:sketch.change_count,sketch:sketchSummary(sketch.changes),
    ...(full?{changes:sketch.changes}:{changes_omitted:true}),text:sketch.text,target_revision:sketch.target_revision,notes:sketch.notes}
  }
  if(v.action==='discard'){
   const dropped=await opts.sketches!.drop(v.record_id)
   return dropped.status==='dropped'?{status:'discarded',saved:false,record_id:v.record_id,change_count:sketch.change_count}
    :{status:'unavailable',saved:false,sketch:kept,message:'The sketch could not be discarded.'}
  }
  if(v.key===null||v.change_note===null)return {status:'invalid',saved:false,sketch:kept,
   validation:{code:'commit_fields_required',fields:['key','change_note'].filter(f=>v[f]===null)},message:'commit and rebase need a key and a change_note.'}
  const edit={record_id:v.record_id,key:v.key,change_note:v.change_note,request_quote:v.request_quote,
   ...(opts.coherentWork?{solution_edit:null}:{}),...(opts.constructionText?{text:sketch.text}:{}),
   ...(lean?{joint_rules:sketch.joint_rules??[],form_assign:sketch.form_assign??[]}:{})}
  if(v.action==='rebase'){
   const current=await (opts.readCurrent?.(v.record_id)??opts.read(v.record_id,null,null)) as Record<string,any>
   if(!await opts.hasAccess())return {status:'denied'}
   if(current?.projectId!==opts.projectId||current.status!=='ok'||current.artifact_id!==v.record_id||current.archived!==false||!Number.isSafeInteger(current.revision))
    return {status:'unavailable',saved:false,sketch:kept,message:'The current revision could not be read; the sketch is unchanged.'}
   // A removal the current revision no longer holds is already done.
   const keys=baseKeysOf(current),changes=Object.fromEntries(Object.entries(sketch.changes)
    .map(([name,d])=>[name,{upsert:d!.upsert,remove:d!.remove.filter(r=>keys[name as keyof typeof keys].includes(r))}])
    .filter(([,d])=>(d as any).upsert.length||(d as any).remove.length))
   const moved={...edit,expected_revision:current.revision,changes,text:sketch.text,target_revision:sketch.target_revision}
   const result=await storeSketch(moved,sketch,read.revision,sketch.notes,keys)
   if(result.status==='sketched')return {...result,status:'rebased',previous_base_revision:sketch.base_revision}
   if(!['invalid','needs_data','conflict'].includes(result.status))return result
   // It does not apply cleanly yet: keep it on the current revision, unchecked,
   // so the named items can be corrected there with mode sketch.
   const put=await opts.sketches!.put(v.record_id,read.revision,{...sketch,base_revision:current.revision,base_keys:keys,changes,change_count:sketchChangeCount(changes)})
   if(put.status!=='stored')return result
   return {...result,saved:false,sketch:{status:'moved_unchecked',base_revision:current.revision,previous_base_revision:sketch.base_revision,change_count:sketchChangeCount(changes)},
    message:[typeof result.message==='string'?result.message.replace(' '+SKETCH_KEPT,''):null,
     `Your sketch now starts from revision ${current.revision} but does not apply there yet. Correct the named items with mode sketch and expected_revision ${current.revision}, or discard it.`].filter(Boolean).join(' ')}
  }
  const result=await editParts({...edit,expected_revision:sketch.base_revision,changes:sketch.change_count?sketch.changes:{instances:{upsert:[],remove:[]}},
   ...(opts.coherentWork?{target_revision:sketch.target_revision}:{})})
  if(result.status!=='saved')return {...result,saved:false,sketch:kept,message:[typeof result.message==='string'?result.message:null,
   'Your sketch is kept.',result.status==='conflict'?'If the construction changed since the sketch began, use action rebase, then commit.':null].filter(Boolean).join(' ')}
  const dropped=await opts.sketches!.drop(v.record_id)
  return {...result,sketch:{status:dropped.status==='dropped'?'committed':'committed_not_closed',change_count:sketch.change_count}}
 }
 // Owner decision 2026-11-07 (construction_sketch_version 2): a new
 // construction built in parts under one key, checked whole, saved once.
 const readNewSketch=async(key:string):Promise<{error:Record<string,any>}|{revision:number;sketch:NewConstructionSketch|null}>=>{
  const stored=await opts.newSketches!.read(key)
  if(stored.status!=='ok')return {error:{status:'unavailable',saved:false,message:'The sketch could not be read; nothing changed.'}}
  const sketch=stored.sketch==null?null:parseNewSketch(stored.sketch)
  if(stored.sketch!=null&&!sketch)return {error:{status:'unavailable',saved:false,message:'The sketch could not be read; nothing changed.'}}
  return {revision:stored.revision,sketch}
 }
 const newSummary=(save:Record<string,any>)=>({definitions:(save.recipe?.definitions??[]).map((d:any)=>d.id).slice(0,200),
  instances:(save.recipe?.instances??[]).map((i:any)=>i.id).slice(0,200),joints:(save.joints??[]).map((j:any)=>j.id).slice(0,200)})
 const sketchNew=async(v:Record<string,any>):Promise<Record<string,any>>=>{
  // Lean writing: a complete revision of a saved construction may be sketched
  // by key too (entry, 13:53: a 10,711-token revision was refused for this).
  if(v.record_id!==null&&!lean)return sketchRefusal({status:'invalid',reason:'sketch_existing_construction',
   message:'This job works on a saved construction; sketch its changes with edit_construction_parts mode sketch.'})
  if(!v.request_quote.trim()||!opts.message.includes(v.request_quote))return {status:'invalid',issues:[{code:'request_quote',path:'request_quote'}]}
  const read=await readNewSketch(v.key)
  if('error' in read)return read.error
  const {request_quote,...given}=v
  // A keyed sketch keeps the construction and revision it began on: the job's
  // binding fills record_id with whatever it holds now, and the server fills
  // the current revision, so later calls must not move the sketch (audit
  // 2026-11-07: a new frame committed over another; a revision over a newer one).
  // A sketch kept from a refused direct save is replaced by the next refused
  // try, not merged with it: each try is a whole construction (audit round 3).
  const replace=lean&&given.shadow===true&&read.sketch?.shadow===true
  const prior=replace?undefined:read.sketch?.save
  // A sketch of one saved construction never continues as another: the job
  // may now be bound elsewhere (audit round 3, security).
  if(lean&&prior&&typeof prior.record_id==='string'&&given.record_id!==prior.record_id)
   return sketchRefusal({status:'invalid',reason:'operation_scope_changed',new_key:v.key,message:'This key holds a sketch of another construction; give this sketch a new key, or commit or discard that one.'})
  const input=lean&&prior?{...given,record_id:prior.record_id??null,expected_revision:prior.expected_revision??0}:given
  const {shadow:_shadow,...fields}=input
  const shadow=given.shadow===true&&(!read.sketch||read.sketch.shadow===true)
  const save=lean?{...mergeNewConstruction(prior??null,fields),joint_rules:byKey(prior?.joint_rules,fields.joint_rules,'id')}
   :mergeNewConstruction(read.sketch?.save??null,input)
  const ready=await prepareSave({...save,request_quote},true)
  if('error' in ready){
   if(!lean||!keepable(ready.error))return sketchRefusal(ready.error)
   const kept:NewConstructionSketch={version:1,kind:'new',key:v.key,save,part_count:(save.recipe?.instances??[]).length,notes:[...(read.sketch?.notes??[]),v.change_note].slice(-20),...(shadow?{shadow:true as const}:{})}
   if(!await opts.hasAccess())return {status:'denied'}
   const put=await opts.newSketches!.put(v.key,read.revision,kept as any)
   if(put.status!=='stored')return sketchRefusal(ready.error)
   return {...ready.error,saved:false,sketched:true,new_key:v.key,sketch:{status:'kept_with_issues',new_key:v.key,part_count:kept.part_count,revises:save.record_id??null},
    message:[typeof ready.error.message==='string'?ready.error.message:null,KEPT_NEW].filter(Boolean).join(' ')}
  }
  const check=await sketchCheck({projectId:opts.projectId,artifact_id:null,revision:0,current_revision:0,source_state:'current',archived:false,
   // What the commit would save: a repeat's role already given to each copy (audit round 3).
   recipe:ready.recipe,parameters:ready.parameters,materials:save.materials,joints:(ready.commit.data as Record<string,any>).joints,instance_policy:(ready.commit.data as Record<string,any>).instance_policy??null,
   design_intent:ready.readiness.design_intent??null,form_refinement:(ready.commit.data as Record<string,any>).form_refinement??null})
  const sketch:NewConstructionSketch={version:1,kind:'new',key:v.key,save,part_count:(save.recipe?.instances??[]).length,notes:[...(read.sketch?.notes??[]),v.change_note].slice(-20),...(lean&&shadow?{shadow:true as const}:{})}
  if(!await opts.hasAccess())return {status:'denied'}
  const put=await opts.newSketches!.put(v.key,read.revision,sketch as any)
  if(put.status!=='stored')return {status:put.status,saved:false,message:'The sketch was not stored; read it with commit_construction_sketch action read before continuing.'}
  // The construction a commit would revise, or null for a new one (owner decision 2026-11-08).
  return withRuleJoints({status:'sketched',saved:false,new_key:v.key,part_count:sketch.part_count,...(lean?{revises:save.record_id??null}:{}),sketch:newSummary(save),check,
   ...(ready.pending.length?{pending:ready.pending.slice(0,24)}:{}),
   message:'Kept in your sketch and checked as a whole; nothing is saved yet. Send the next parts with the same key, then save it with commit_construction_sketch and this new_key.'
    +(ready.pending.length?' Pending lists what the concept still needs; it must be complete when you save.':'')},ready.made)
 }
 const newSketchCommit=async(v:Record<string,any>):Promise<Record<string,any>>=>{
  const read=await readNewSketch(v.new_key)
  if('error' in read)return read.error
  const sketch=read.sketch
  if(!sketch)return {status:'not_found',saved:false,message:'No sketch of a new construction with this key is open in this request.'}
  const kept={status:'kept',new_key:sketch.key,part_count:sketch.part_count}
  if(v.action==='read'){
   const full=countSerializedTokens(sketch.save)<=6000
   return {status:'ok',saved:false,new_key:sketch.key,part_count:sketch.part_count,sketch:newSummary(sketch.save),...(full?{save:sketch.save}:{save_omitted:true}),notes:sketch.notes}
  }
  if(v.action==='discard'){
   const dropped=await opts.newSketches!.drop(sketch.key)
   return dropped.status==='dropped'?{status:'discarded',saved:false,new_key:sketch.key}:{status:'unavailable',saved:false,sketch:kept,message:'The sketch could not be discarded.'}
  }
  if(v.action==='rebase')return {status:'invalid',saved:false,sketch:kept,message:typeof sketch.save.record_id==='string'&&lean
   ?'A whole revision cannot move onto a newer one without overwriting it. Read the construction, sketch your changes with edit_construction_parts, then discard this sketch.'
   :'A new construction has no saved revision to move onto; commit or discard it.'}
  if(v.key===null||v.change_note===null)return {status:'invalid',saved:false,sketch:kept,
   validation:{code:'commit_fields_required',fields:['key','change_note'].filter(f=>v[f]===null)},message:'commit needs a key and a change_note.'}
  // Lean writing: the sketch may hold a refused text; it is checked again here.
  const existing=lean&&typeof sketch.save.record_id==='string'?sketch.save.record_id:null
  // Saved only onto the construction it was sketched from (audit round 3, security).
  if(existing&&v.record_id!==existing)return {status:'invalid',reason:'operation_scope_changed',saved:false,sketch:kept,
   message:'This sketch revises another construction than this job works on; nothing was saved. Discard it, or commit it from that construction\'s job.'}
  if(lean){
   const prose=humanTextRejection(proseFields(sketch.save,CONSTRUCTION_PROSE.save_construction_draft.filter(p=>p!=='change_note')))
   if(prose)return {status:'invalid',saved:false,sketch:kept,validation:{code:'human_text',fields:prose.fields},message:'Not saved. '+prose.message+' Correct it with mode sketch and the same key; your sketch is kept.'}
  }
  // The server binds the target current at the commit, as for a direct save.
  const target=opts.serverTarget&&opts.readCurrentTarget?await opts.readCurrentTarget(sketch.save.area_id??null):sketch.save.target_revision
  if(target===null)return {status:'needs_data',reason:'design_target_required',saved:false,sketch:kept,
   message:'No construction saved. This project or area has no selected solution to build from yet; the solution is selected first.'}
  const result=await saveDraft({...sketch.save,target_revision:target,key:v.key,change_note:v.change_note,request_quote:v.request_quote,
   record_id:existing,expected_revision:existing?sketch.save.expected_revision:0})
  if(result.status!=='saved')return {...result,saved:false,sketch:kept,message:[typeof result.message==='string'?result.message:null,'Your sketch is kept.',
   existing&&result.status==='conflict'?'The construction changed after this whole revision was sketched; nothing was overwritten. Read it, sketch your changes with edit_construction_parts, then discard this sketch.':null].filter(Boolean).join(' ')}
  const dropped=await opts.newSketches!.drop(sketch.key)
  const receipt=result.receipt,sub=sketch.save.sub_build_id
  const placement=opts.placeIn&&typeof sub==='string'&&receipt?.dataset==='artifacts'&&typeof receipt.recordId==='string'?{placement:await opts.placeIn(receipt.recordId,sub)}:{}
  return {...result,...placement,sketch:{status:dropped.status==='dropped'?'committed':'committed_not_closed',new_key:sketch.key,part_count:sketch.part_count}}
 }
 const tools={
 // Durable checks already have an exact, access-controlled result ID in the
 // evidence store. Keep its reference, not a second full report in every save.
 exportState():ConstructionToolsState{
  if(!opts.constructionViews)return {version:1,used}
  const latest=latestObservations([...views.references(),...savedResults.values()])
  const ids=new Set(latest.map(o=>o.id))
  const observations=views.exportState(o=>ids.has(o.id)&&!savedResults.has(o.id))
  return opts.formEvidence?{version:3,used,observations,savedResults:[...savedResults.values()].filter(o=>ids.has(o.id)).map(o=>({...o}))}
   :{version:2,used,observations}
 },
 restoreState(state:ConstructionToolsState){
  if(!state||!Number.isSafeInteger(state.used)||state.used<0||!opts.constructionViews&&state.version!==1
   ||opts.constructionViews&&state.version!==2&&!(opts.formEvidence&&state.version===3))throw new Error('construction_tools_checkpoint_invalid')
  if(state.version===2||state.version===3){
   const restoredResults=new Map<string,SavedConstructionResult>()
   if(state.version===3){
    if(!Array.isArray(state.savedResults))throw new Error('construction_tools_checkpoint_invalid')
    for(const ref of state.savedResults){
     if(!ref||!/^cs_[a-f0-9]{64}$/.test(ref.id)||restoredResults.has(ref.id)||ref.projectId!==opts.projectId||typeof ref.artifact_id!=='string'
      ||!Number.isSafeInteger(ref.revision)||ref.revision<1||ref.kind!=='check'||typeof ref.observed_at!=='string'||!Number.isFinite(Date.parse(ref.observed_at))
      ||Object.keys(ref).some(k=>!['id','projectId','artifact_id','revision','kind','observed_at'].includes(k)))throw new Error('construction_tools_checkpoint_invalid')
     restoredResults.set(ref.id,{...ref})
    }
   }
   views.restoreState(state.observations);savedResults.clear()
   for(const [id,ref]of restoredResults)savedResults.set(id,ref)
  }
  used=state.used
 },
 /** Code-only persistence readback. The model's overview/table remains available
  * on demand; proving one revision was saved does not require paginating it. */
 async readSavedSummary(id:string,revision:number):Promise<Record<string,any>>{
  if(!await opts.hasAccess())return {status:'denied'}
  const draft=await (opts.readSummary?opts.readSummary(id,revision):opts.read(id,revision,null)) as Record<string,any>
  if(!await opts.hasAccess())return {status:'denied'}
  if(draft?.projectId!==opts.projectId||draft.status!=='ok'||draft.artifact_id!==id||draft.revision!==revision)return {status:'unavailable'}
  if(opts.readSummary){
   if(!Number.isSafeInteger(draft.current_revision)||draft.current_revision<1||typeof draft.archived!=='boolean'
    ||!['current','changed','unavailable'].includes(draft.source_state)||draft.view!=='overview')return {status:'unavailable'}
   if(opts.formEvidence)return draft
   const {saved_results_read:_saved,...summary}=draft;return summary
  }
  const query={artifact_id:id,revision,view:'overview',ids:[],after:null,result_id:null,section:null}
  return await views.read(draft,query,undefined,undefined,opts.formEvidence?{saved_results_read:{...query,view:'results'}}:{})
 },
 tools:[readTool,checkTool,CONSTRUCTION_LIST_TOOL,CONSTRUCTION_CUT_FIT_TOOL,CONSTRUCTION_CHANGES_TOOL,...(opts.readDelivery?[CONSTRUCTION_DELIVERY_TOOL]:[]),...(opts.writer?[saveTool,editTool,parameterTool,CONSTRUCTION_LEGACY_TOOL,CONSTRUCTION_ROLE_TOOL,CONSTRUCTION_CONTINUE_TOOL,CONSTRUCTION_CUT_SAVE_TOOL,...sketchTools]:[])],get remaining(){return opts.unlimitedWork?Infinity:Math.max(0,12-used)},
 async execute(name:string,raw:unknown):Promise<Record<string,any>>{
  // Owner decision 2026-11-01: a value with too many decimals no longer costs a
  // whole save; code rounds it and says which values it rounded.
  const rounded=opts.decimalRounding&&raw&&typeof raw==='object'&&!Array.isArray(raw)?(r=>
   name===CONSTRUCTION_SAVE_TOOL.function.name?roundNodeValues(r.parameter_plan?.nodes)
   :name===CONSTRUCTION_EDIT_TOOL.function.name?roundNodeValues(r.changes?.nodes?.upsert)
   :name===CONSTRUCTION_PARAMETER_TOOL.function.name?roundNodeValues(r.changes):[])(raw=structuredClone(raw) as Record<string,any>):[]
  const result=await tools.executeTool(name,raw)
  return rounded.length&&result&&typeof result==='object'?{...result,rounded_values:rounded}:result
 },
 async executeTool(name:string,raw:unknown):Promise<Record<string,any>>{
  if(++used>12&&!opts.unlimitedWork)return {status:'budget_exhausted'}
  const spec=[editTool,CONSTRUCTION_LEGACY_TOOL,parameterTool,readTool,saveTool,checkTool,CONSTRUCTION_LIST_TOOL,CONSTRUCTION_CUT_FIT_TOOL,CONSTRUCTION_CUT_SAVE_TOOL,CONSTRUCTION_ROLE_TOOL,CONSTRUCTION_CHANGES_TOOL,CONSTRUCTION_CONTINUE_TOOL,...sketchTools,...(opts.readDelivery?[CONSTRUCTION_DELIVERY_TOOL]:[])].find(s=>s.function.name===name)
  if(!spec)return {status:'invalid'}
  // Old exact result pointers remain usable after an upgrade; the new native
  // schemas still show every field explicitly to new model requests.
  if(opts.coherentWork&&raw&&typeof raw==='object'&&!Array.isArray(raw)){
   const input=raw as Record<string,unknown>
   if(name===CONSTRUCTION_READ_TOOL.function.name)raw={step_id:null,work_kind:null,...input}
   if(name===CONSTRUCTION_CHECK_TOOL.function.name)raw={outputs:[],...input}
   if(name===CONSTRUCTION_EDIT_TOOL.function.name||name===CONSTRUCTION_PARAMETER_TOOL.function.name)raw={...(opts.serverTarget?{}:{target_revision:null}),solution_edit:null,...(opts.constructionText?{text:null}:{}),...input}
  }
  // An older pinned catalog may omit this new field. Preserve its uncertainty;
  // the database inherits an existing policy rather than erasing it.
  if(name===CONSTRUCTION_SAVE_TOOL.function.name&&raw&&typeof raw==='object'&&!Array.isArray(raw)&&!('instance_policy' in raw))raw={...raw,instance_policy:null}
  // Older pinned schemas have no joint fastener field: null means "use the rule".
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
   const r=raw as Record<string,any>
   // Chosen-fastener joints (2026-11-01) have no rule field to fill.
   const ruled=(tool:string)=>!opts.chosenJointFasteners||tool===CONSTRUCTION_LEGACY_TOOL.function.name
   if((name===CONSTRUCTION_SAVE_TOOL.function.name||name===CONSTRUCTION_LEGACY_TOOL.function.name)&&ruled(name)&&Array.isArray(r.joints))raw={...r,joints:withRuleFasteners(r.joints)}
   if(name===CONSTRUCTION_EDIT_TOOL.function.name&&ruled(name)&&Array.isArray(r.changes?.joints?.upsert))raw={...r,changes:{...r.changes,joints:{...r.changes.joints,upsert:withRuleFasteners(r.changes.joints.upsert)}}}
  }
  // Lean writing: a role's quantity_policy follows from the role; one sent anyway is ignored.
  const leanWrite=lean&&(name===CONSTRUCTION_SAVE_TOOL.function.name||name===CONSTRUCTION_EDIT_TOOL.function.name)
  if(leanWrite&&raw&&typeof raw==='object'&&!Array.isArray(raw)){
   const strip=(rows:unknown)=>Array.isArray(rows)?rows.map((r:any)=>r&&typeof r==='object'&&!Array.isArray(r)?(({quantity_policy:_q,...x})=>x)(r):r):rows
   const r=structuredClone(raw) as Record<string,any>
   if(Array.isArray(r.instance_policy?.instances))r.instance_policy.instances=strip(r.instance_policy.instances)
   if(Array.isArray(r.changes?.roles?.upsert))r.changes.roles.upsert=strip(r.changes.roles.upsert)
   raw=r
  }
  raw=withOmittedNulls(spec.function.parameters,raw)
  const issues=schemaIssues(spec.function.parameters,raw)
  if(issues.length)return {status:'invalid',issues}
  const prose=humanTextRejection(proseFields(raw,CONSTRUCTION_PROSE[name]??[]))
  const textRefusal=prose?{status:'invalid',validation:{code:'human_text',fields:prose.fields},message:'No change made. '+prose.message}:null
  // Lean writing: a construction with a text to correct is kept in the sketch.
  const keepText=!!textRefusal&&lean&&!!opts.writer&&(name===CONSTRUCTION_SAVE_TOOL.function.name||name===CONSTRUCTION_EDIT_TOOL.function.name&&!!opts.prepareEdit)
  if(textRefusal&&!keepText)return textRefusal
  const v=raw as any
  if(leanWrite){
   const fill=(rows:any[])=>rows.map((r:any)=>({...r,quantity_policy:INSTANCE_ROLE_POLICY[r.role as keyof typeof INSTANCE_ROLE_POLICY]}))
   if(Array.isArray(v.instance_policy?.instances))v.instance_policy={...v.instance_policy,instances:fill(v.instance_policy.instances)}
   if(Array.isArray(v.changes?.roles?.upsert))v.changes={...v.changes,roles:{...v.changes.roles,upsert:fill(v.changes.roles.upsert)}}
  }
  if(!await opts.hasAccess())return {status:'denied'}
  try{
   if(opts.serverTarget&&[CONSTRUCTION_EDIT_TOOL.function.name,CONSTRUCTION_PARAMETER_TOOL.function.name].includes(name))v.target_revision=null
   if(opts.serverTarget&&name===CONSTRUCTION_SAVE_TOOL.function.name){
    const target=opts.readCurrentTarget?await opts.readCurrentTarget(v.area_id??null):null
    if(!await opts.hasAccess())return {status:'denied'}
    if(target===null)return {status:'needs_data',reason:'design_target_required',
     message:'No construction saved. This project or area has no selected solution to build from yet; the solution is selected first.'}
    v.target_revision=target
   }
   if(keepText){
    const {mode:_mode,...input}=v
    // A refused direct save is kept only where no sketch work is open under its key (audit round 3).
    if(name===CONSTRUCTION_SAVE_TOOL.function.name)return v.mode==='sketch'?await keptAfter(textRefusal!,()=>sketchNew(input),KEPT_NEW):await keepSave(textRefusal!,input)
    return v.mode==='sketch'?await keptAfter(textRefusal!,()=>sketchParts(input),KEPT_EDIT):await keepEdit(textRefusal!,input)
   }
   if(name===CONSTRUCTION_DELIVERY_TOOL.function.name){
    const result=await opts.readDelivery!(v.artifact_id,v.revision,v.resource,v.after)
    if(!await opts.hasAccess())return {status:'denied'}
    return validConstructionDelivery(result,opts.projectId,v.artifact_id,v.revision,v.resource)?result:{status:'unavailable'}
   }
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
    if(opts.sketches){
     const {mode,...input}=v
     if(mode==='sketch')return await sketchParts(input)
     const result=await editParts(input)
     if(lean&&keepable(result))return await keepEdit(result,input)
     // The shadow of a refused try is done once a change covering it saves;
     // otherwise it stays open and the answer says so.
     if(lean&&result.status==='saved'){
      const open=await opts.sketches.read(input.record_id),shadow=open.status==='ok'?parseSketch(open.sketch):null
      if(shadow?.shadow===true){
       if(covers(input,shadow))await opts.sketches.drop(input.record_id)
       else return {...result,open_sketch:{status:'kept',base_revision:shadow.base_revision,change_count:shadow.change_count,
        message:'A sketch kept from a refused change of this construction is still open; commit, rebase or discard it.'}}
      }
     }
     return result
    }
    return await editParts(v)
   }
   if(name===CONSTRUCTION_SKETCH_COMMIT_TOOL.function.name){
    if(!opts.writer||!opts.sketches||!opts.prepareEdit&&!(opts.newSketches&&v.record_id===null))return {status:'unavailable'}
    return await sketchCommit(v)
   }
   if(name===CONSTRUCTION_PARAMETER_TOOL.function.name){
    if(!opts.writer||!opts.prepareParameterChange)return {status:'unavailable'}
    if(!v.request_quote.trim()||!opts.message.includes(v.request_quote))return {status:'invalid',message:'Use an exact quote from the current request.'}
    if(opts.serverTarget&&(opts.constructionSourceRefresh||opts.coherentWork)&&!(opts.coherentWork&&v.solution_edit)){
     const bound=await currentTargetFor(v.record_id,v.expected_revision)
     if('error' in bound)return bound.error
     v.target_revision=bound.target
     if(!v.changes.length&&bound.target===null)return {status:'invalid',reason:'construction_no_change',
      message:'No construction changed: no changed inputs, and this construction already follows the current selected solution.'}
    }
    if(opts.constructionSourceRefresh&&!v.changes.length&&v.target_revision===null&&!(opts.coherentWork&&v.solution_edit))return {status:'invalid',message:'Name changed inputs or an explicit current target revision.'}
    const change=await prepareChange(v,{kind:'construction_parameters',record_id:v.record_id,expected_revision:v.expected_revision,expected_updated_at:null,request_quote:v.request_quote,
     data:{key:v.key,change_note:v.change_note,changes:v.changes,computed:null,...(opts.constructionSourceRefresh||opts.coherentWork?{target_revision:v.target_revision}:{}),...(opts.constructionText&&v.text?{text:v.text}:{})}},opts.prepareParameterChange)
    if(change.error)return change.error
    const {payload,domain,prepared}=change
    if(!await opts.hasAccess())return {status:'denied'}
    if(prepared.status!=='ready'&&prepared.status!=='saved')return prepared
    if(prepared.status==='ready'){
     const draft=prepared.draft
     if(draft?.projectId!==opts.projectId||draft.artifact_id!==v.record_id)return {status:'unavailable'}
     if(draft.revision!==v.expected_revision||draft.current_revision!==v.expected_revision||draft.archived)return {status:'conflict'}
     const computed=await compileConstructionParameterChange(opts.projectId,draft,v.changes,opts.readSources)
     domain.data.computed=computed
     if(opts.constructionText){
      const after=recipeSize((computed as Record<string,any>).recipe,draft.instance_policy),stale=staleSizeText(v.text??draft,recipeSize(draft.recipe,draft.instance_policy),after)
      if(stale.length)return staleTextRejection(stale,after!,!!v.text)
     }
    }
    if(!await opts.hasAccess())return {status:'denied'}
    return changed(await opts.writer.commit(payload),prepared,v.expected_revision)
   }
   if(name===CONSTRUCTION_READ_TOOL.function.name){
    if(opts.constructionViews){
     if(opts.coherentWork&&v.view==='work'){
      if(!v.work_kind||v.result_id!==null||v.section!==null||!opts.readWorkSources)return {status:'invalid',message:'Use work_kind, step_id and no result reference for view=work.'}
      const draft=v.artifact_id===null?null:await opts.read(v.artifact_id,v.revision,null) as Record<string,any>
      if(!await opts.hasAccess())return {status:'denied'}
      if(v.artifact_id===null&&(v.revision!==null||v.ids.length))return {status:'invalid'}
      if(draft&&(draft.projectId!==opts.projectId||draft.status!=='ok'||draft.artifact_id!==v.artifact_id||v.revision!==null&&draft.revision!==v.revision))return {status:'unavailable'}
      const sources=await opts.readWorkSources(draft,v.step_id)
      if(!draft&&opts.creationPreparation){
       const selected=sources.packet.solution,areaId=sources.packet.scope?.area_id??null
       if(selected?.status==='ok'){
        if(!opts.readDesignReadiness||!Number.isSafeInteger(selected.target_revision))return {status:'unavailable',reason:'construction_preparation_unavailable'}
        const readiness=parseDesignReadiness(await opts.readDesignReadiness(selected.target_revision,'construction',areaId))
        if(!await opts.hasAccess())return {status:'denied'}
        if(!readiness||readiness.project_id!==opts.projectId||readiness.area_id!==areaId||readiness.purpose!=='construction')return {status:'unavailable',reason:'construction_preparation_unavailable'}
        if(readiness.target_revision!==selected.target_revision||readiness.solution_id!==selected.solution_id||readiness.solution_revision!==selected.solution_revision)
         return {status:'conflict',reason:'work_sources_changed'}
        // The same canonical gate used at save, shown before authoring geometry.
        // Readiness is evidence at this read; save still checks it afresh.
        const scoped=!!(opts.formRefinement&&readiness.design_intent?.model&&['ready','needs_data'].includes(readiness.status))
        sources.packet={...sources.packet,creation_state:readiness.status,scoped_refinement_available:scoped,
         preparation:{...readiness,design_intent:undefined,pin:undefined,scope:'whole_solution',
          scoped_refinement:scoped?'Explicit form_refinement may defer unrelated choices; the save gate checks that exact scope.':null}}
       }else sources.packet={...sources.packet,creation_state:['empty','no_selected_solution'].includes(selected?.status)?'no_selected_solution':'unavailable'}
      }
      if(draft){
       const current=await (opts.readCurrent?.(v.artifact_id)??opts.read(v.artifact_id,null,null)) as Record<string,any>
       if(!await opts.hasAccess())return {status:'denied'}
       if(current?.projectId!==opts.projectId||current.artifact_id!==v.artifact_id||current.status!=='ok')return {status:'unavailable'}
       if(current.revision!==draft.revision||current.source_state!==draft.source_state||current.archived!==draft.archived)return {status:'conflict',reason:'work_sources_changed',current_revision:current.revision}
      }
      if(!await opts.hasAccess())return {status:'denied'}
      return await workPackets.read(draft??{projectId:opts.projectId,artifact_id:null,revision:null,current_revision:null,source_state:'not_created',archived:false},v,sources)
     }
     if(opts.coherentWork&&(v.work_kind!==null||v.step_id!==null))return {status:'invalid',message:'work_kind and step_id apply only to view=work.'}
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
     if(opts.formEvidence&&(v.view==='results'||v.view==='result')){
      if(!opts.readObservations)throw Error('construction_evidence_read_unavailable')
      if(v.view==='results'&&(v.ids.length||v.result_id!==null||v.section!==null))return {status:'invalid',message:'List saved checks without IDs, result_id or section; follow next_read.'}
      const stored=await opts.readObservations(v.artifact_id,draft.revision,v.view==='result'?v.result_id:null,v.view==='results'?v.after:null)
      if(!await opts.hasAccess())return {status:'denied'}
      if(stored?.projectId!==opts.projectId||stored.artifact_id!==v.artifact_id||stored.revision!==draft.revision||!['ok','not_found'].includes(stored.status))throw Error('construction_evidence_read_unavailable')
      if(v.view==='results')return {...stored,view:'results',observation:'historical',
       items:(stored.results??[]).map((r:Record<string,any>)=>({collection:'results',id:r.result_id,value:{...r,read:{...v,revision:draft.revision,view:'result',after:null,result_id:r.result_id}}})),
       next_read:stored.next_after?{...v,revision:draft.revision,after:stored.next_after}:null,results:undefined,
       message:'Saved check references for this revision. Open a result for findings and current reuse status; history grants no drawing or manufacturing permission.'}
      if(stored.observation){
       await views.importObservation(stored.observation)
       if(stored.observation.kind==='check')rememberSaved(stored.observation)
       const current={...draft,current_revision:stored.current_revision,source_state:stored.source_state,archived:stored.archived}
       return await views.read(current,v,opts.viewPageTokens?.(),undefined,{persistence:'saved',reuse_status:constructionEvidenceReuse(stored.observation,current,(opts.now?.()??new Date()).toISOString().slice(0,10))})
      }
      // Earlier list/cut observations retain their turn-local lifetime.
     }
     const extraHeader=opts.formEvidence&&v.view==='overview'?{saved_results_read:{...v,revision:draft.revision,view:'results',after:null}}:{}
     if(opts.constructionTable&&v.view==='overview'){
      const fasteners=await tableFasteners(opts.readFasteners,draft.artifact_id,draft.revision)
      if(!await opts.hasAccess())return {status:'denied'}
      return await views.read(draft,v,opts.viewPageTokens?.(),{table:true,fasteners,...(opts.chosenJointFasteners?{chosen:true}:{})},extraHeader)
     }
     return await views.read(draft,v,opts.viewPageTokens?.(),undefined,extraHeader)
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
    if(current.revision!==v.revision||current.source_state!=='current'||current.archived)return {status:'conflict',
     reason:current.archived?'construction_archived':current.revision!==v.revision?'construction_revision_changed':'construction_sources_changed',
     artifact_id:v.artifact_id,requested_revision:v.revision,current_revision:current.revision,target_revision:current.target_revision,source_state:current.source_state,
     message:current.archived?'This construction is archived; no current check was produced.'
      :current.revision!==v.revision?'Read the current revision of this same construction before checking; no current check was produced.'
      :'This construction still refers to changed or unavailable sources. Read its pinned sources and current project readiness before revising this same artifact; no current check was produced.'}
    const observedAt=opts.constructionViews?await (opts.observationTime?.({tool:name,artifact_id:v.artifact_id,revision:v.revision})??Promise.resolve((opts.now?.()??new Date()).toISOString())):undefined
    const today=(observedAt??(opts.now?.()??new Date()).toISOString()).slice(0,10)
    const workKey=opts.coherentWork&&name===CONSTRUCTION_CHECK_TOOL.function.name?await fingerprint({artifact_id:v.artifact_id,revision:v.revision,
     component_ids:v.component_ids??[],requirement_checks:v.requirement_checks??[],contract:constructionEvidenceContract(draft,today)}):null
    const reused=workKey?await reusableCheck(current,workKey,today):undefined
    const model=reused?.output??(opts.formEvidence&&name===CONSTRUCTION_CHECK_TOOL.function.name
     ?checkConstructionEvidence(draft,catalog,today,v.component_ids,v.requirement_checks)
     :checkConstruction(draft,catalog,today,!!opts.constructionViews))
    // Chosen joint fasteners (2026-11-01): the database's facts per chosen item
    // come with the check, so a weak choice shows where the designer looks.
    const facts=!reused&&opts.chosenJointFasteners&&name===CONSTRUCTION_CHECK_TOOL.function.name&&(Array.isArray(draft.joints)?draft.joints:[]).some((j:any)=>j?.method==='butt')
     ?chosenFastenerFacts(await tableFasteners(opts.readFasteners,v.artifact_id,v.revision)):undefined
    const checked=facts?{...model,fastener_facts:facts}:model
    if(name===CONSTRUCTION_CHECK_TOOL.function.name){
     if(!opts.coherentWork)return await present('check',v.artifact_id,v.revision,{projectId:opts.projectId,...checked},observedAt)
     const outputs:Record<string,any>=v.outputs.length
      ?opts.readDelivery&&opts.openDelivery?await checkConstructionWorkOutputs(opts.projectId,v.artifact_id,v.revision,v.outputs,{read:opts.readDelivery,open:opts.openDelivery,hasAccess:opts.hasAccess}):{status:'unavailable',resources:[]}
      :{status:'not_requested',resources:[]}
     if(outputs.status==='denied'||!await opts.hasAccess())return {status:'denied'}
     const final=await (opts.readCurrent?.(v.artifact_id)??opts.read(v.artifact_id,null,null)) as Record<string,any>
     if(!await opts.hasAccess())return {status:'denied'}
     if(final?.projectId!==opts.projectId||final.artifact_id!==v.artifact_id||final.status!=='ok')return {status:'unavailable'}
     if(final.revision!==v.revision||final.source_state!=='current'||final.archived)return {status:'conflict',reason:'work_sources_changed',current_revision:final.revision,
      diagnostics:{operation:'work_check',revision:v.revision,source_changed:true}}
     const output={projectId:opts.projectId,...checked,work_check_key:workKey}
     const saved:Record<string,any>=await present('check',v.artifact_id,v.revision,output,reused?.observed_at??observedAt)
     if(saved.status==='denied')return saved
     const complete=(checked.issue_count??0)<=(checked.issues?.length??0)&&(checked.fabrication_gap_count??0)<=(checked.fabrication_gaps?.length??0)
     const details={...output,result:saved.result,persistence:saved.persistence,artifact_id:v.artifact_id,revision:v.revision,source_state:final.source_state,
      outputs,work_operation:'checked',details_omitted:!complete,coverage:{complete,scope:'reported_technical_findings'},
      diagnostics:{operation:'work_check',revision:v.revision,reused:!!reused,coverage_complete:complete,outputs_requested:v.outputs.length}}
     const {diagnostics:_diagnostics,...modelDetails}=details
     if(countSerializedTokens(modelDetails)<=12000)return details
     const page=await views.read(final,{artifact_id:v.artifact_id,revision:v.revision,after:null,view:'result',ids:[],result_id:saved.result.result_id,section:null},6000)
     return {...saved,outputs,findings:page.items,coverage:{...page.coverage,complete:complete&&page.coverage?.complete===true},next_read:page.next_read,
      work_operation:'checked',diagnostics:{...details.diagnostics,coverage_complete:false}}
    }
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
   if(opts.newSketches){
    const {mode,...input}=v
    if(mode==='sketch')return await sketchNew(input)
    const result=await saveDraft(input)
    if(lean&&keepable(result))return await keepSave(result,input)
    // A sketch kept under this key from a refused save is done now; ordinary sketch work stays.
    if(lean&&result.status==='saved'){const open=await readNewSketch(input.key);if(!('error' in open)&&open.sketch?.shadow===true)await opts.newSketches.drop(input.key)}
    return result
   }
   return await saveDraft(v)
  }catch(error){
   rethrowContinuation(error)
   if(error instanceof CadParameterGap)return {status:'needs_data',reason:'unknown_required_parameters',gaps:error.gaps,message:'No construction changed. Resolve these controlling values in the same request; no zero or invented value was saved.'}
   if(opts.writeState&&error instanceof CadParameterUnusedNodes&&error.unused.length)return {status:'invalid',reason:'parameter_unused_node',unused_nodes:error.unused,
    message:'No construction changed. These parameter nodes feed no binding, frame or other node: '+error.unused.join(', ')+'. Remove each orphaned node (and a formula that only fed it), or bind it to the path it was meant to control, then retry with a new key.'}
   if(error instanceof CadReservedParameter)return {status:'invalid',reason:'reserved_parameter_id',message:'No construction changed. '+error.id+' is the code zero node; give your own node another ID.'}
   if(error instanceof CadParameterBindingGap&&lean)return {status:'invalid',reason:'unbound_fields',unbound:error.unbound,message:'No construction changed. Write each field in unbound as a formula or a node name; a position or rotation of 0 needs nothing.'}
   if(error instanceof CadParameterBindingGap)return {status:'invalid',message:'Bind every path in unbound to a parameter node using these exact slash-separated paths. Keep the same construction IDs and correct the parameter plan; no source lookup retry is needed.',unbound:error.unbound}
   const message=error instanceof Error?error.message:''
   if(opts.constructionRepeats&&/^(invalid_cad_array|cad_array_[a-z_]+)(:.*)?$/.test(message))return {status:'invalid',reason:message.split(':')[0],message:'No construction saved. Correct array IDs/counts and bindings; generated instance/node IDs must be unique and fit the existing canonical limits.'}
   if(opts.constructionRepeats&&message.startsWith('parameter_gaps:'))return opts.defaultZero&&opts.repeatStart
    ?{status:'invalid',reason:'array_binding_missing',unbound:arrayGaps(message),message:lean?LEAN_REPEAT_GAP_MESSAGE:REPEAT_GAP_MESSAGE}
    :opts.defaultZero
    ?{status:'invalid',reason:'array_binding_missing',unbound:arrayGaps(message),message:'No construction saved. Bind arrays/<id>/start/x, y and z, zero included, and arrays/<id>/spacing_mm; an unbound start rotation means none.'}
    :{status:'invalid',reason:'array_binding_missing',message:'Bind all six arrays/<id>/start placement paths and arrays/<id>/spacing_mm. No construction saved.'}
   if(message.startsWith('parameter_code_zero:'))return {status:'invalid',reason:'parameter_code_zero',
    message:'No construction changed. '+message.slice('parameter_code_zero:'.length)+' is code\'s shared zero; to move what sits on it, bind that path to a node of its own with edit_construction_parts.'}
   if(opts.constructionViews&&message==='construction_view_cursor_invalid')return {status:'invalid',message:'Use next_read from this exact revision, view and selection. A cursor cannot be reused for another selection.'}
   if(opts.constructionViews&&message==='construction_view_header_too_large')return {status:'invalid',message:'Use fewer named IDs or one result section to keep the page envelope small. No data was omitted as complete.'}
   const known=/^(invalid_requirement_probe|invalid_form_refinement|invalid_instance_policy|invalid_parameter_[a-z_]+|parameter_[a-z_]+|unknown_required_parameters|coordinate_[a-z_]+)$/
   if(known.test(message))return {status:'invalid',message}
   // The owner-facing text stays generic; the cause must still reach the logs.
   console.error('[Construction tool unavailable]',JSON.stringify({tool:name,error:(error instanceof Error?error.name+': '+message:String(error)).slice(0,300)}))
   return {status:'unavailable',message:'Could not verify construction data. Read again; a failed lookup does not mean data is absent.'}
  }
 }}
 if(!opts.writeState||!opts.coherentWork)return placing(tools)
 // Owner decision 2026-10-29 (write_state_version 1): a construction write
 // returns the check Bob would otherwise request next, through the same check
 // path, persistence and reuse keys. A check that cannot run stays visible.
 const executeOnce=tools.execute.bind(tools)
 tools.execute=async(name:string,raw:unknown):Promise<Record<string,any>>=>{
  const result=await executeOnce(name,raw)
  if(!CHECKED_WRITES.has(name)||result?.status!=='saved')return result
  const receipt=result.receipt
  if(receipt?.dataset!=='artifacts'||typeof receipt.recordId!=='string'||!Number.isSafeInteger(receipt.revision))
   return {...result,checked_concept_ready:null,check:compactConstructionCheck(undefined)}
  const check=compactConstructionCheck(await executeOnce(CONSTRUCTION_CHECK_TOOL.function.name,{artifact_id:receipt.recordId,revision:receipt.revision,
   outputs:[],...(opts.formEvidence?{component_ids:[],requirement_checks:[]}:{})}))
  return {...result,checked_concept_ready:check.status==='checked'?check.concept_ready:null,check}
 }
 return placing(tools)
 // A saved construction goes into the sub-build its save named. The save stands
 // even when the placement is refused; the refusal is returned beside it.
 function placing<T extends {execute:(name:string,raw:unknown)=>Promise<Record<string,any>>}>(t:T):T{
  if(!opts.placeIn)return t
  const saveOnce=t.execute.bind(t)
  t.execute=async(name:string,raw:unknown)=>{
   const result=await saveOnce(name,raw)
   const sub=(raw as Record<string,unknown>|null)?.sub_build_id
   if(name!==CONSTRUCTION_SAVE_TOOL.function.name||result?.status!=='saved'||typeof sub!=='string')return result
   const receipt=result.receipt
   if(receipt?.dataset!=='artifacts'||typeof receipt.recordId!=='string')return {...result,placement:{status:'unavailable'}}
   return {...result,placement:await opts.placeIn!(receipt.recordId,sub)}
  }
  return t
 }
}
/** The save names its sub-build (null: none yet); placement follows the save. */
export function withSubBuild<T extends typeof CONSTRUCTION_SAVE_TOOL>(spec:T):T{return {...spec,function:{...spec.function,
 parameters:{...spec.function.parameters,required:[...spec.function.parameters.required,'sub_build_id'],properties:{...spec.function.parameters.properties,
  sub_build_id:{anyOf:[uuid,{type:'null'}],description:'The sub-build this construction belongs in, from read_build_tree or the request. It is placed there right after saving. null keeps its current place.'}}},
}}}
/** The construction write without a model-supplied target_revision. */
export function withoutTargetRevision<T extends {function:{parameters:any}}>(spec:T):T{
 const p=spec.function.parameters
 if(!p?.properties||!('target_revision' in p.properties))return spec
 const {target_revision:_target,...properties}=p.properties
 return {...spec,function:{...spec.function,parameters:{...p,properties,required:(p.required??[]).filter((k:string)=>k!=='target_revision')}}}
}
const CHECKED_WRITES=new Set(['save_construction_draft','edit_construction_parts','change_construction_parameters','commit_construction_sketch'])
export type ConstructionTools=ReturnType<typeof createConstructionTools>

/** The drawing desk uses the same checker and exact caller reads, without
 * trusting a model's earlier assertion that a checkpoint passed. */
export async function checkedConstructionForDrawing(opts:Parameters<typeof createConstructionTools>[0],id:string,revision:number) {
 // CAD performs a fresh whole-construction check, not the interactive work
 // packet/output interface. Keep its schema and arguments on the same contract.
 const tools=createConstructionTools({...opts,constructionViews:false,formEvidence:false,coherentWork:false})
 const checked=await tools.execute('check_construction_draft',{artifact_id:id,revision})
 if(checked.status!=='checked'||!checked.concept_ready)return {status:checked.status==='checked'?'needs_data':checked.status,checked}
 const draft=await opts.read(id,revision,null) as Record<string,any>
 if(!await opts.hasAccess())return {status:'denied',checked}
 if(draft?.projectId!==opts.projectId||draft.status!=='ok'||draft.artifact_id!==id||draft.revision!==revision
  ||draft.current_revision!==revision||draft.source_state!=='current'||draft.archived)return {status:'conflict',checked}
 return {status:'ready',draft,checked}
}
