import {type ProjectCalculator} from './project-calculator.ts'
import {callWithCalculator} from './calculator-model-call.ts'
import { BobBudgetError, budgetStopMessage, budgetResumeAction, readBudgetStop, withoutBudgetDetails } from './bob-budget-stop.ts'
import {createDrawingDependencies} from './drawing-dependencies.ts'
import {CAD_PARAMETERS_SCHEMA,parameterSourcePins,inheritCadParameters,cadParameterSources} from './cad-parameters.ts'
import { drawingInputFingerprint, drawingCandidateCommitment } from './drawing-request-recovery.ts'
import {physicalLineageSources} from './cad-physical-lineage.ts'
import { buildCadLineage } from './cad-lineage.ts'
import { DIMENSION_BINDINGS_SCHEMA, type DrawingRequestStore, type DrawingRequest } from './cad-intake.ts'
import { CAD_RESEARCH_CONTRACT } from './cad-research.ts'
import { collectDrawingReviewEvidence } from './drawing-review.ts'
import { CAD_RECIPE_SCHEMA } from './cad-schema.ts'
import { CAD_ARRAYS_SCHEMA } from './cad-arrays.ts'
import { createCadPieces } from './cad-pieces.ts'
import { READ_CAD_SHELL_TOOL, parseCadShellRead } from './cad-shell.ts'
import type { KnowledgeReader } from './building-knowledge.ts'
import { fingerprint, rethrowContinuation, stableJsonValue } from './bob-job-journal.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import type { AiCatalogSession, AiVariables } from './ai-catalog.ts'
import { type createProjectLookup } from './project-lookup.ts'
import { parseCadAssemblyRequest, type CadAssemblyRequest, type CadDrawingSource } from './cad-adapter.ts'
import type { MaterialCatalogReader } from './material-catalog.ts'
import type { ProjectContext } from './project-context/dispatcher.ts'
import { CONTEXT_LIMITS } from './project-context/dispatcher.ts'
import { createGroundedModelCall } from './project-grounding.ts'
import { parseDesignHandoff, CAD_REVIEW_SCOPE, parseCadReview, candidateFingerprint, type CadReview } from './cad-review.ts'
import { HANDOFF_INPUT_SCHEMA, REQUIREMENT_CHANGES_SCHEMA, prepareDesignHandoff } from './cad-handoff.ts'
import { designIntentHandoff, parseDesignReadiness, type DesignReadiness } from './project-design-intent.ts'

const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const text=(v:unknown,n:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=n
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const nullable={type:['string','null']}
function tool(name:string,description:string,properties:Record<string,unknown>){return {type:'function' as const,function:{name,description,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}}}}
export const DESIGN_CAD_TOOL=tool('design_project_cad',
  'Render a requested drawing of one exact saved, checked construction revision. Every project drawing needs its own construction source with stable part IDs, dimensions, placements, pinned catalog materials and declared joints before CAD. Read or save the construction, compare it with the owner requirements and original reference images, run check_construction_draft and correct that same construction before calling this tool. For an older drawing, use transition_legacy_drawing to retain its geometry and identities and establish the missing material/joint evidence. Pass the saved construction Artifact ID, or its already linked drawing ID, and the exact receipt revision. CAD reuses the saved geometry; it cannot design a replacement assembly. Reference pixels and the original requirements accompany independent candidate review. Reuse the same request_id on retry. Returns a checked candidate that still needs save_cad_design.',
  {request_id:{...nullable,description:'Use the saved request ID only when the current owner message requests or continues a drawing deliverable. A message about the same object, a correction, an image description, or a project-text update does not by itself request CAD. Complete a text-only request through its own read/write tools and finish the reply without resuming the drawing. When a drawing is requested, reuse this ID, its saved requirements and a source-current draft; no extra confirmation is needed. Null only for a new drawing request. With an ID, pass handoff:null and requirement_changes:[] to preserve ALL requirements; put explicit requirement corrections in requirement_changes.'},brief:{type:'string'},handoff:{anyOf:[HANDOFF_INPUT_SCHEMA,{type:'null'}],description:'New request only: transfer owner requirements without IDs; the server creates and persists their identities. Map coordinates and views, keep unknown directions null and cite exact source refs. Resume with null: the server reads the saved handoff, including earlier corrections. Use requirement_changes only for explicit additions or changes.'},requirement_changes:REQUIREMENT_CHANGES_SCHEMA,area_id:nullable,component_id:nullable,step_id:{...nullable,description:'Current work Step this drawing supports; read the plan and pass its exact ID when relevant. Null for a project-wide drawing. Planning is a phase.'},artifact_id:{type:'string',description:'Exact saved construction Artifact ID, or a drawing already linked to that construction. A missing construction must be saved and checked first. The server renders its geometry verbatim into a linked drawing.'},construction_revision:{type:'integer',minimum:1,maximum:999999999,description:'Copy the exact saved/read construction revision. Required for every project drawing. The server checks this version and preserves it on resume; it cannot substitute a newer design.'}})
export const SAVE_CAD_TOOL=tool('save_cad_design','Save the exact independently reviewed rendering of its saved, checked construction revision from this turn, including the construction source pin and plan Step link. Source, material and target revisions are checked again at publication. This concept drawing is not measured truth or structural certification.',
  {request_quote:{type:'string'}})
export const READ_CAD_TOOL=tool('read_cad_artifact','Read an exact saved CAD artifact revision, including its reusable assembly and pinned inputs. Null revision reads current. Use part_ids to select an existing subassembly when rendering; do not redesign it merely to obtain a detail view.',
  {artifact_id:{type:'string'},revision:{type:['integer','null']}})
// A JSON object is deliberately validated by the same bounded engine contract.
// The model gets the complete vocabulary here, not executable expressions.
export const RENDER_CAD_TOOL=tool('render_cad_candidate',
  'Render a bounded mm assembly. recipe: {contract_version:1,units:"mm",assembly_id,definitions,instances,views,clearances?,motions?}. Definition: {id,material_ref:null|string,primitive:"box",x_mm,y_mm,z_mm} or primitive:"tube",outside_diameter_mm,wall_thickness_mm,length_mm or primitive:"cylinder",diameter_mm,length_mm. Any definition may have cuts:[{primitive:"box",x_mm,y_mm,z_mm,placement} or {primitive:"cylinder",diameter_mm,length_mm,placement}]; max16 cuts/part,256 total. Box origin is minimum corner; cylinders/tubes are centred in XY and start at z=0. Cut placements are local to the part. Instances: {id,definition_id,placement:{x,y,z,rx,ry,rz}}; angles in degrees. Optional clearances:[{id,first_id,second_id,min_mm}] max16 checks. Optional motions:[{id,moving_ids:[instance IDs] max8,obstacle_ids:[instance IDs] max32,delta:{x,y,z}}] max16; reports a conservative swept bounding envelope for linear travel, not hinge/rotation simulation. Optional arrays:[{id,definition_id,axis:"x"|"y"|"z",count}] repeat one part at equal spacing instead of listing each copy; prefer them for studs, slats, joists and rungs. Views: front,right,top,isometric. Max128 definitions,512 instances after arrays expand. Output includes exact overlap volumes (bounded; partial if incomplete), requested distances and motion envelopes. Inspect every warning, correct unintended overlaps, and explain intentional joints or unresolved checks. For saved details use render_saved_cad_candidate. This tool creates new geometry; instance IDs belong in recipe.instances. Geometry does not certify strength or real site fit.',
  {purpose:{type:'string',enum:['project','diagnostic'],description:'Project deliverable or diagnostic test. Diagnostic attempts stop the design workflow for renderer investigation; they cannot replace a project candidate.'},recipe:{...CAD_RECIPE_SCHEMA,properties:{...CAD_RECIPE_SCHEMA.properties,instances:{...CAD_RECIPE_SCHEMA.properties.instances as object,minItems:0},arrays:CAD_ARRAYS_SCHEMA}},parameter_plan:{...CAD_PARAMETERS_SCHEMA,description:'Required provenance for EVERY recipe number: definitions/<id>/<dimension>, definitions/<id>/cuts/<index>/<dimension>, definitions/<id>/cuts/<index>/placement/<axis>, instances/<id>/placement/<axis>, clearances/<id>/min_mm, motions/<id>/delta/<axis>. Bind each path to one node. Source nodes name exact project or accepted room measurement pins; server supplies values. Decision/estimate nodes need explicit basis and mm/deg/scalar unit. Derived nodes use versioned operations and operand IDs; do not perform arithmetic in prose. Source/formula values overwrite recipe placeholders. Unknown required parameters stop the request; ordinary reversible design choices are decisions, not owner approval requests. Decimal precision is six places; exact forbids rounding; half_away_6 rounds ties away from zero.'},dimension_bindings:DIMENSION_BINDINGS_SCHEMA,title:{type:'string'},description:{type:'string'},assumptions:{type:'string'},measurements:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},revision:{type:'integer'}},required:['id','revision']}}})
const {recipe:_newRecipe,parameter_plan:_parameters,dimension_bindings:_bindings,...renderMetadata}=RENDER_CAD_TOOL.function.parameters.properties
export const RENDER_SAVED_CAD_TOOL=tool('render_saved_cad_candidate','Render an exact saved assembly or selection of its existing instance IDs. No new geometry. Empty part_ids selects the whole assembly.',{...renderMetadata,source_artifact_id:{type:'string'},source_revision:{type:'integer',minimum:1},part_ids:{type:'array',items:{type:'string'}}})
const READ_REQUESTS_TOOL=tool('read_drawing_requests','Read minimal project drawing status and exact saved Artifact references. No private chat or drafts. Use after_id for the next page.',{request_id:{type:['string','null']},after_id:{type:['string','null']}})
const CANCEL_REQUEST_TOOL=tool('cancel_drawing_request','Cancel your drawing request only when the owner asks to stop it. Read its current revision first. This fences late saves; it does not delete an already saved Artifact.',{request_id:{type:'string'},expected_revision:{type:'integer',minimum:0}})
const ENSURE_GAP_TOOL=tool('ensure_drawing_gap_task','Atomically reuse/create the Task for a gap bound to an already shared current Plan requirement. Read stable gap and requirement IDs first. Private-only needs stay in chat or link existing work; never copy private assessment prose.',{request_id:{type:'string'},expected_revision:{type:'integer',minimum:0},gap_id:{type:'string'},requirement_id:{type:'string'},plan_revision:{type:'integer',minimum:1}})
const REQUEST_WORK_TOOL=tool('read_drawing_request_work','Read stable gaps and existing Task/Step links. A completed Task does not prove a missing measurement has been supplied.',{request_id:{type:'string'}})
const LINK_GAP_TOOL=tool('link_drawing_gap','Link a stable drawing gap to an existing project Task and/or Step. Read request work first and reuse existing links; never duplicate a Task by its title. Do not copy private assessment prose into project Tasks. Null references leave the gap as a chat complement.',{request_id:{type:'string'},expected_revision:{type:'integer',minimum:0},gap_id:{type:'string'},task_id:{type:['string','null']},step_id:{type:['string','null']}})
export type CadPacket={recipe:CadAssemblyRequest;manifest:Record<string,any>;files:Record<string,string>;previews?:Record<string,string>}
export const RESTORE_REQUEST_TOOL=tool('restore_drawing_request','Restore your paused request from ALL canonical requirements of a current approved plan Step and the current owner instruction. Read request and plan first. Keeps the same ID; starts fresh intake without recovering deleted chat. Then call design_project_cad with that ID and preserve the restored requirements. Does not grant readiness.',{request_id:{type:'string'},expected_revision:{type:'integer',minimum:0},plan_revision:{type:'integer',minimum:1},step_id:{type:'string'},request_quote:{type:'string',maxLength:500}})

export type CadCandidate={packet:CadPacket;title:string;description:string;assumptions:string;target_revision:number;measurements:{id:string;revision:number}[];source_artifact_id:string|null;source_revision:number|null;part_ids:string[];area_id:string|null;component_id:string|null;step_id:string|null;artifact_id:string|null;expected_revision:number;drawing_request?:{id:string;revision:number}}

export function createCadAssistant(opts:{aiCatalog:AiCatalogSession;calculator?:ProjectCalculator;runtimeVersion?:()=>Promise<string>;requestModel?:(id:string,o:OpenAIServiceOptions,work:()=>Promise<OpenAIServiceResponse<string>>)=>Promise<OpenAIServiceResponse<string>>;requestStore?:DrawingRequestStore;research?:boolean;durable?:boolean;ownerRequest?:string;projectId:string;userId:string;hasAccess:()=>Promise<boolean>;makeLookup:()=>ReturnType<typeof createProjectLookup>;callModel:(o:OpenAIServiceOptions,beforeDispatch?:()=>Promise<void>)=>Promise<OpenAIServiceResponse<string>>;render:(r:CadAssemblyRequest,source?:CadDrawingSource,beforeDispatch?:()=>Promise<void>)=>Promise<CadPacket>;readArtifact:(id:string,revision:number|null,fresh?:boolean)=>Promise<any>;readDesignReadiness?:(targetRevision:number,purpose:'construction'|null,areaId?:string|null,fresh?:boolean)=>Promise<DesignReadiness>;readShell?:(id:string,revision:number|null)=>Promise<any>;checkConstruction?:(id:string,revision:number,fresh?:boolean)=>Promise<Record<string,any>>;knowledgeReader?:KnowledgeReader;catalog?:MaterialCatalogReader;context?:ProjectContext;referenceImageRefs?:()=>string[];deadline:number;available:boolean}){
 const catalogText=(key:string,variables?:AiVariables)=>{if(!opts.aiCatalog)throw new Error('ai_catalog_unavailable');return opts.aiCatalog.text(key,variables)}
 let lifecycleUsed=0
 let used=0,candidate:CadCandidate|null=null,partial=false,requiredTools:string[]=[]
 let savedRequest:(()=>Promise<void>)|null=null
 let terminalFailure:Record<string,unknown>|null=null
 let acceptedReview:{fingerprint:string;review:CadReview}|null=null
 const metrics={research_calls:0,consultations:0,renders:0,input_corrections:0,reviews:0,review_rejections:0,review_unavailable:0}
 const sources:ReturnType<typeof createProjectLookup>['sources']=[]
 const pieces=createCadPieces({aiCatalog:opts.aiCatalog,projectId:opts.projectId,requestStore:opts.requestStore,ownerRequest:opts.ownerRequest??null,hasAccess:opts.hasAccess,checkConstruction:opts.checkConstruction})
 return {tools:[DESIGN_CAD_TOOL],lifecycleTools:opts.requestStore?.read&&opts.requestStore?.cancel?[...pieces.tools,...(opts.readShell?[READ_CAD_SHELL_TOOL]:[]),READ_REQUESTS_TOOL,CANCEL_REQUEST_TOOL,...(opts.requestStore.work&&opts.requestStore.linkGap?[REQUEST_WORK_TOOL,LINK_GAP_TOOL,...(opts.requestStore.ensureGapTask?[ENSURE_GAP_TOOL]:[])]:[]),...(opts.requestStore.restore?[RESTORE_REQUEST_TOOL]:[])]:[],get lifecycleRemaining(){return Math.max(0,12-lifecycleUsed)},
 async lifecycle(name:string,raw:unknown){
  if(!object(raw))return {status:'invalid'}
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(lifecycleUsed>=12)return {status:'budget_exhausted'}
  if(name==='plan_cad_pieces'){lifecycleUsed++;return pieces.execute(raw)}
  if(name==='read_cad_shell'&&opts.readShell){const v=parseCadShellRead(raw);if(!v)return {status:'invalid'};lifecycleUsed++;return await opts.readShell(v.shell_id,v.revision)??{status:'not_found'}}
  if(name==='ensure_drawing_gap_task'&&Object.keys(raw).sort().join(',')==='expected_revision,gap_id,plan_revision,request_id,requirement_id'&&uuid(raw.request_id)&&uuid(raw.gap_id)&&uuid(raw.requirement_id)&&Number.isSafeInteger(raw.expected_revision)&&raw.expected_revision>=0&&Number.isSafeInteger(raw.plan_revision)&&raw.plan_revision>0&&opts.requestStore?.ensureGapTask){lifecycleUsed++;return opts.requestStore.ensureGapTask(raw.request_id,raw.expected_revision,raw.gap_id,raw.requirement_id,raw.plan_revision)}
  if(name==='read_drawing_request_work'&&Object.keys(raw).join(',')==='request_id'&&uuid(raw.request_id)&&opts.requestStore?.work){lifecycleUsed++;return opts.requestStore.work(raw.request_id)}
  if(name==='link_drawing_gap'&&Object.keys(raw).sort().join(',')==='expected_revision,gap_id,request_id,step_id,task_id'&&uuid(raw.request_id)&&uuid(raw.gap_id)&&Number.isSafeInteger(raw.expected_revision)&&raw.expected_revision>=0&&(raw.task_id===null||text(raw.task_id,200))&&(raw.step_id===null||uuid(raw.step_id))&&opts.requestStore?.linkGap){lifecycleUsed++;return opts.requestStore.linkGap(raw.request_id,raw.expected_revision,raw.gap_id,raw.task_id,raw.step_id)}
  if(name==='read_drawing_requests'&&Object.keys(raw).sort().join(',')==='after_id,request_id'&&[raw.request_id,raw.after_id].every(v=>v===null||uuid(v))&&opts.requestStore?.read){
   lifecycleUsed++;return opts.requestStore.read(raw.request_id,raw.after_id)
  }
  if(name==='restore_drawing_request'&&Object.keys(raw).sort().join(',')==='expected_revision,plan_revision,request_id,request_quote,step_id'&&uuid(raw.request_id)&&uuid(raw.step_id)&&Number.isSafeInteger(raw.expected_revision)&&raw.expected_revision>=0&&Number.isSafeInteger(raw.plan_revision)&&raw.plan_revision>0&&text(raw.request_quote,500)&&opts.requestStore?.restore){
   if(!opts.ownerRequest?.includes(raw.request_quote))return {status:'invalid',reason:'request_quote_required'}
   lifecycleUsed++
   try{
    const result=await opts.requestStore.restore(raw.request_id,raw.expected_revision,raw.plan_revision,raw.step_id,raw.request_quote)
    candidate=null;acceptedReview=null;savedRequest=null
    return {status:'restored',request_id:result.id,revision:result.revision,brief:result.payload.brief,next_action:catalogText("feedback.cad-assistant.next-action.cb389635c1a3")}
   }catch(error){
    rethrowContinuation(error)
    if(error instanceof Error&&['drawing_request_changed','drawing_request_cancelled','drawing_request_complete','drawing_request_denied','drawing_request_not_paused','drawing_scope_changed','drawing_requirements_changed','drawing_requirements_unavailable','drawing_restore_conflict','request_quote_required','drawing_request_pixels_forbidden'].includes(error.message))return {status:'recovery_required',reason:error.message,saved:false,request_id:raw.request_id,next_action:catalogText("feedback.cad-assistant.next-action.c85770be1951")}
    throw error
   }
  }
  if(name==='cancel_drawing_request'&&Object.keys(raw).sort().join(',')==='expected_revision,request_id'&&uuid(raw.request_id)&&Number.isSafeInteger(raw.expected_revision)&&raw.expected_revision>=0&&opts.requestStore?.cancel){
   lifecycleUsed++;const result=await opts.requestStore.cancel(raw.request_id,raw.expected_revision)
   if(result.status==='cancelled'&&candidate?.drawing_request?.id===raw.request_id){candidate=null;acceptedReview=null;savedRequest=null}
   return result
  }
  return {status:'invalid'}
 },sources,markSaved:async()=>{await savedRequest?.()},pending:()=>opts.requestStore?.list()??Promise.resolve([]),get metrics(){return {...metrics,review_passed:!!acceptedReview}},get quality(){return acceptedReview?structuredClone(acceptedReview):null},get requiredTools(){return requiredTools.slice()},get failure(){return terminalFailure?structuredClone(terminalFailure):null},get remaining(){return terminalFailure?0:Math.max(0,2-used)},get partial(){return partial},get candidate(){return candidate&&acceptedReview?structuredClone(candidate):null},
 async consult(raw:unknown){
  if(terminalFailure)return withoutBudgetDetails(terminalFailure)
  candidate=null;acceptedReview=null;requiredTools=[];savedRequest=null
  if(!object(raw)||Object.keys(raw).filter(k=>k!=='request_id'&&k!=='requirement_changes'&&k!=='construction_revision').sort().join(',')!=='area_id,artifact_id,brief,component_id,handoff,step_id'||!text(raw.brief,6000)
    ||[raw.area_id,raw.component_id,raw.step_id,raw.artifact_id].some(v=>v!==null&&!text(v,200)))return {status:'invalid',saved:false}
  if(raw.request_id!=null&&!uuid(raw.request_id))return {status:'invalid',saved:false}
  raw=structuredClone(raw)
  if(!object(raw))return {status:"invalid",saved:false}
  if(!await opts.hasAccess())throw new Error('project_denied')
  let request:DrawingRequest|null=null
  if(raw.request_id){
   if(!opts.requestStore)return {status:'unavailable',stage:'intake_store',saved:false}
   try{request=await opts.requestStore.load(raw.request_id)}catch(error){rethrowContinuation(error);return {status:'unavailable',stage:'intake_store',saved:false}}
   if(!request)return {status:'unavailable',stage:'intake_store',saved:false}
   if(!await opts.hasAccess())throw new Error('project_denied')
   if(request.status==='saved')return {status:request.receipt?'already_saved':'completed_unlinked',saved:!!request.receipt,request_id:request.id,receipt:request.receipt??null,
    next_action:catalogText("feedback.cad-assistant.next-action.63790c027600")}
   if(request.status==='cancelled'||request.status==='paused')return {status:request.status==='cancelled'?'cancelled':'recovery_required',saved:false,request_id:request.id,revision:request.revision,reason:request.reason,
    next_action:request.status==='cancelled'?catalogText("feedback.cad-assistant.next-action.bb0c45185974"):catalogText("feedback.cad-assistant.next-action.2d11b91ea601")}
   const scope=Object.fromEntries(['area_id','component_id','step_id','artifact_id'].map(key=>[key,request!.payload.brief[key]??null]))
   // An older unbound request may establish its first mandatory source. Once
   // pinned, retries keep that source and revision; other scope stays fixed.
   if(scope.artifact_id===null&&uuid(raw.artifact_id)&&request.payload.brief.construction_revision==null
    &&(!object(request.payload.draft)||!request.payload.draft.construction))scope.artifact_id=raw.artifact_id
   for(const key of Object.keys(scope))raw[key]??=scope[key]
   if(Object.keys(scope).some(key=>raw[key]!==scope[key]))return {
    status:'recovery_required',reason:'drawing_scope_changed',saved:false,request_id:request.id,scope,
    next_action:catalogText("feedback.cad-assistant.next-action.70c5149c2791")}
   const savedDraft=request.payload.draft
   if(request.payload.brief.construction_revision!=null){
    raw.construction_revision??=request.payload.brief.construction_revision
    if(raw.construction_revision!==request.payload.brief.construction_revision)return {status:'recovery_required',stage:'construction',reason:'construction_revision_changed',saved:false,request_id:request.id}
   }else if(raw.construction_revision===undefined&&object(savedDraft)&&object(savedDraft.construction)&&savedDraft.construction.revision!=null){
    raw.construction_revision=savedDraft.construction.revision
   }
  }
  if(raw.construction_revision!=null&&(!Number.isSafeInteger(raw.construction_revision)||raw.construction_revision<1||raw.construction_revision>999999999))return {status:'invalid',stage:'construction',saved:false,reason:'invalid_construction_revision'}
  if(raw.construction_revision!=null&&!uuid(raw.artifact_id))return {status:'invalid',stage:'construction',saved:false,reason:'construction_source_required'}
  if(used>=2)return {status:'budget_exhausted',saved:false}
  // Loading the claimed owner's new task opens its fresh SQL budget period.
  // Replays and automatic continuations retain the same period; no top-up.
  const earlier=request?parseDesignHandoff(request.payload.brief.handoff):null
  if(request&&!earlier)return {status:'recovery_required',saved:false,request_id:request.id,reason:'saved_handoff_unavailable'}
  const prepared=await prepareDesignHandoff(raw.handoff,earlier,raw.requirement_changes??[],!!request?.payload.restoration)
  if('reason' in prepared)return {status:'invalid',saved:false,reason:prepared.reason,request_id:request?.id??null,
   required:request?'Resume with handoff:null and requirement_changes:[]; changes must copy saved requirement IDs, while new requirements use requirement_id:null.':'Provide a structured handoff without requirement IDs; the server allocates them.',
   ...(earlier?{handoff:earlier}:{}),maximum:24}
  let handoff=prepared.handoff
  raw.handoff=structuredClone(handoff)
  delete raw.requirement_changes
  const dependencies=createDrawingDependencies(request?.payload.dependencies)
  const makeLookup=()=>{
   const source=opts.makeLookup()
   return {...source,get remaining(){return source.remaining},get partial(){return source.partial},search:async(args:unknown)=>{
    const result=await source.search(args);await dependencies.record('search_project_data',args,result);return result
   }}
  }
  const readArtifact=async(id:string,revision:number|null)=>{const result=await opts.readArtifact(id,revision);await dependencies.record('read_cad_artifact',{artifact_id:id,revision},result);return result}
  const lookup=makeLookup(),groundingLookup=makeLookup(),until=opts.durable?opts.deadline-20000:Math.min(opts.deadline-20000,Date.now()+300000)
  const ownerRequest=[request?.payload.owner_request,opts.ownerRequest].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join('\n')||null
  let payload:DrawingRequest['payload']={brief:structuredClone(raw),owner_request:ownerRequest,draft:request?.payload.draft,restoration:request?.payload.restoration,dependencies:request?.payload.dependencies,reference_refs:[...new Set([...(request?.payload.reference_refs??[]),...opts.referenceImageRefs?.()??[]])] }
  const persist=async(status:string,patch:Partial<DrawingRequest['payload']>={})=>{payload={...payload,...patch};if(opts.requestStore)request=await opts.requestStore.save(request?.id??null,request?.revision??0,status,payload)}
  const checkAuthority=async()=>{
   if(!await opts.hasAccess())return false
   if(request)await opts.requestStore?.assertActive?.(request.id)
   return true
  }
  let runtimeVersion:string|undefined
  let constructionDispatchGuard:(()=>Promise<void>)|undefined
  let designReadiness:DesignReadiness|null=null
  const requiredFeatureIds=new Set<string>()
  const readReadiness=async(targetRevision:number,purpose:'construction'|null,areaId:string|null,fresh=false)=>{
   try{return opts.readDesignReadiness?parseDesignReadiness(await opts.readDesignReadiness(targetRevision,purpose,areaId,fresh)):null}catch(error){
    rethrowContinuation(error)
    if(error instanceof Error&&error.message==='project_denied')throw error
    throw new Error('design_readiness_unavailable')
   }
  }
  const model=async(original:OpenAIServiceOptions)=>{
   const o=runtimeVersion?{...original,messages:[...(original.messages??[]),{role:'user' as const,content:JSON.stringify({runtime_configuration_revision:runtimeVersion})}]}:original
   const work=()=>opts.callModel(o,constructionDispatchGuard)
   const response=await(request&&opts.requestModel?opts.requestModel(request.id,o,work):work())
   if(!response.success&&response.error==='turn_budget_exhausted')throw new BobBudgetError(response,
    original.functionName==='cad-reviewer'?'review':original.functionName==='cad-research'?'intake':'design')
   return response
  }
  const executeRead=async(name:string,args:unknown):Promise<any>=>{
   let result:unknown
   if(name==='search_project_data')return lookup.search(args)
   if(name==='read_cad_artifact'&&object(args)&&uuid(args.artifact_id)&&(args.revision===null||Number.isSafeInteger(args.revision)&&args.revision>0))return readArtifact(args.artifact_id,args.revision)
   if(name==='calculate_project'&&opts.calculator)result=await opts.calculator.execute(args)
   else if(name==='search_building_knowledge'&&opts.knowledgeReader)result=await opts.knowledgeReader.execute(args)
   else if(opts.catalog?.tools.some(t=>t.function.name===name))result=await opts.catalog.read(name,args)
   else if(opts.context?.tools.some(t=>t.function.name===name))result=await opts.context.execute(name,args)
   else result={status:'invalid'}
   await dependencies.record(name,args,result);return result
  }
  let retryInputs:{evidence:Record<string,unknown>;images:unknown}|undefined
  const sourceFingerprint=async()=>retryInputs?drawingInputFingerprint(raw,{...retryInputs.evidence,dependencies:await dependencies.digest()},retryInputs.images):''
  const retryFingerprint=async()=>retryInputs?drawingInputFingerprint(raw,{...retryInputs.evidence,runtimeVersion,intake_contract:CAD_RESEARCH_CONTRACT,dependencies:await dependencies.digest()},retryInputs.images):''
  let expected=0
  let construction:Record<string,any>|null=null
  let legacyTransition:Record<string,any>|null=null
  let drawingArtifactId=raw.artifact_id
  if(raw.artifact_id){
   const old=await readArtifact(raw.artifact_id,null);if(!old)return {status:'unavailable',stage:'source'}
   if(old.source_kind==='construction'){
    construction=raw.construction_revision!=null&&raw.construction_revision!==old.revision?await readArtifact(raw.artifact_id,raw.construction_revision):old
    drawingArtifactId=null
   }
   else if(old.manifest?.bob_construction||old.construction_transition){
    if(!old.manifest?.bob_construction){
     const pin=old.construction_transition
     if(!object(pin)||pin.project_id!==opts.projectId||pin.drawing_artifact_id!==raw.artifact_id||pin.drawing_revision!==old.revision||!uuid(pin.artifact_id)||!Number.isSafeInteger(pin.revision)||pin.revision<1)return {status:'unavailable',stage:'construction',saved:false,reason:'legacy_transition_unavailable'}
     legacyTransition=pin
    }
    const sourceId=old.construction_source?.artifact_id??old.manifest?.bob_construction?.artifact_id??legacyTransition?.artifact_id
    let source=await readArtifact(sourceId,null)
    if(raw.construction_revision!=null&&source?.revision!==raw.construction_revision)source=await readArtifact(sourceId,raw.construction_revision)
    if(source?.source_kind!=='construction')return {status:'unavailable',stage:'construction',saved:false}
    construction=source
   }
   if(construction){
    if(raw.construction_revision===null)return {status:'needs_data',stage:'construction',saved:false,reason:'construction_revision_required',artifact_id:construction.artifact_id}
    if(construction.source_kind!=='construction'||raw.construction_revision!=null&&construction.revision!==raw.construction_revision)return {status:'conflict',stage:'construction',saved:false,reason:'construction_revision_changed'}
    // Old pinned manifests lacked the new input. Capture their server-read
    // version once and persist it; subsequent resumes cannot follow a new head.
    raw.construction_revision??=construction.revision
   }else if(raw.construction_revision!=null)return {status:'invalid',stage:'construction',saved:false,reason:'construction_source_required'}
   expected=drawingArtifactId?old.revision:0;raw.area_id??=old.area_id??null;raw.component_id??=old.component_id??null
   // Work links may have changed independently of the geometry revision.
   raw.step_id??=Array.isArray(old.current_step_ids)
    ?old.current_step_ids.length===1?old.current_step_ids[0]:null
    :old.step_id??null
  }
  // All project drawing entry points require the same saved construction.
  // Stop before intake/design models, draft reuse, rendering or paid review.
  if(!construction){
   requiredTools=['read_construction_draft','save_construction_draft','check_construction_draft',...(raw.artifact_id?['transition_legacy_drawing']:[])]
   return {status:'needs_data',stage:'construction',reason:'construction_required',saved:false,request_id:request?.id??null,
    artifact_id:raw.artifact_id??null,required_tools:requiredTools.slice(),next_action:catalogText('feedback.cad-assistant.next-action.facd61c3e829')}
  }
  payload.brief=structuredClone(raw)
  let renders=0,reviews=0,reviewPending=false
  const referencePixels:NonNullable<OpenAIServiceOptions['messages']>=[]
  let designImages:{image_id:string;source_version:string}[]=[]
  const researchEvidence:{tool:string;result:unknown}[]=[]
  const constructionFailure=async(checked:any)=>{
   partial=true
   const failure={status:checked?.status==='unavailable'?'unavailable':'needs_data',stage:'construction',saved:false,reason:'construction_not_ready',request_id:request?.id??null,
    artifact_id:construction?.artifact_id,revision:construction?.revision,check:checked?.checked??null,
    next_action:catalogText("feedback.cad-assistant.next-action.facd61c3e829")}
   await persist(failure.status==='unavailable'?'retrieval_failed':'needs_data',{reviewed_candidate:undefined})
   return failure
  }
  const attempt=async()=>{try{
   if(!await checkAuthority())throw new Error('project_denied')
   let target=await lookup.search({dataset:'target',query:null,status:null,area_id:raw.area_id,record_id:raw.area_id===null?'project':null,after_id:null})
   if(target.status==='empty'&&raw.area_id!==null)target=await lookup.search({dataset:'target',query:null,status:null,area_id:null,record_id:'project',after_id:null})
   if(target.status==='denied')throw new Error('project_denied')
   const targetReadable=['ok','empty'].includes(target.status)
   if(!targetReadable)return {status:'unavailable',stage:'target',saved:false}
   const selected=target.records[0]
   const hasTarget=!!selected?.solution_id&&Number.isSafeInteger(selected.revision)
   if(targetReadable&&!hasTarget)requiredTools=['save_project_solution','select_project_target']
   if(!hasTarget)return {status:'prerequisite_required',stage:'target',saved:false,required_tools:requiredTools}
   const readiness=await readReadiness(Number(selected.revision),construction?'construction':null,raw.area_id)
   if(!readiness||readiness.status!=='ready'||!readiness.pin||!readiness.design_intent){
    partial=true
    requiredTools=['save_project_solution','select_project_target']
    if(request)await persist(readiness&&readiness.status!=='unavailable'?'needs_data':'retrieval_failed',{reviewed_candidate:undefined})
    return {status:readiness?.status==='unavailable'||!readiness?'unavailable':'needs_data',stage:'design_readiness',saved:false,request_id:request?.id??null,reason:'design_intent_not_ready',readiness,
     required_tools:requiredTools}
   }
   if(readiness.pin.project_id!==opts.projectId||readiness.area_id!==raw.area_id||readiness.pin.target_revision!==selected.revision||readiness.pin.solution_id!==selected.solution_id
     ||construction&&readiness.pin.purpose!=='construction'
     ||selected.solution_revision!=null&&readiness.pin.solution_revision!==selected.solution_revision)
    return {status:'needs_data',stage:'design_readiness',saved:false,reason:'design_intent_changed'}
   if(new Set([...handoff.requirements.map(r=>r.id),...readiness.design_intent.features.map(f=>'intent_'+f.id)]).size>24)
    return {status:'needs_data',stage:'design_readiness',saved:false,reason:'design_requirement_limit',maximum:24}
   designReadiness=readiness
   try{handoff=designIntentHandoff(handoff,readiness.design_intent,readiness.pin)}catch(error){
    if(error instanceof Error&&['design_intent_requirement_limit','design_intent_unresolved_limit'].includes(error.message))return {status:'needs_data',stage:'design_readiness',saved:false,reason:error.message}
    throw error
   }
   readiness.design_intent.features.forEach(f=>requiredFeatureIds.add('intent_'+f.id))
   const refreshDesignReadiness=async(fresh=false)=>{
    if(!await checkAuthority()||opts.context&&!await opts.context.validate())throw new Error('project_denied')
    const current=await readReadiness(Number(selected.revision),construction?'construction':null,raw.area_id,fresh)
    if(!current||current.status==='unavailable')throw new Error('design_readiness_unavailable')
    if(current.status!=='ready'||!current.pin||current.area_id!==raw.area_id||JSON.stringify(stableJsonValue(current.pin))!==JSON.stringify(stableJsonValue(readiness.pin)))throw new Error('design_readiness_changed')
   }
   constructionDispatchGuard=()=>refreshDesignReadiness(true)
   payload.reference_refs=[...new Set([...payload.reference_refs,...readiness.design_intent.references.map(r=>'image:'+r.image_id)])]
   if(!request?.payload.retry)await persist('collecting')
   if(!opts.available){await persist('retrieval_failed');return {status:'unavailable',stage:'cad_engine',saved:false,request_id:request?.id??null,reason:'CAD service is not configured. This is an infrastructure issue, not a missing user approval.'}}
   const referenceRefs=payload.reference_refs
   const imageFailures:string[]=[]
   if(referenceRefs.length&&!opts.context)imageFailures.push(...referenceRefs)
   if(opts.context)for(let offset=0;offset<referenceRefs.length;offset+=CONTEXT_LIMITS.batch){
    const refs=referenceRefs.slice(offset,offset+CONTEXT_LIMITS.batch)
    const opened=await opts.context.execute('open_project_item',{refs})
    for(const ref of refs)if(!('items' in opened)||!opened.items?.some(item=>item.ref===ref&&item.status==='prepared'))imageFailures.push(ref)
   }
   designImages=readiness.design_intent.references.flatMap(r=>{
    const version=opts.context?.imageEvidence?.().get('image:'+r.image_id)
    if(!version){imageFailures.push('image:'+r.image_id);return []}
    return [{image_id:r.image_id,source_version:version}]
   })
   if(imageFailures.length){
    partial=true
    await persist('retrieval_failed',{reviewed_candidate:undefined,incomplete:[...new Set(imageFailures)].map(ref=>'image:'+ref.replace(/^image:/,''))})
    return {status:'unavailable',stage:'reference_images',saved:false,request_id:request?.id??null,reason:'design_reference_unavailable',reference_refs:[...new Set(imageFailures)]}
   }
   referencePixels.push(...opts.context?.carrier()??[])
   // Specialists need the same current-fact grounding as Bob when viewing pixels.
   // A visual reference supplies design intent, never updated measured dimensions.
   if(!opts.aiCatalog)throw new Error('ai_catalog_unavailable')
   const callModel=createGroundedModelCall({groundingInstruction:opts.aiCatalog.text('bob.grounding'),projectId:opts.projectId,message:raw.brief,lookup:groundingLookup,
    hasAccess:opts.hasAccess,validateImages:()=>opts.context?.validate()??Promise.resolve(true),deadline:until,callModel:model})
   const refreshConstruction=async(fresh=false)=>{
    if(!construction||!opts.checkConstruction)return construction?{status:'unavailable'}:null
    if(legacyTransition){
     const drawing=await opts.readArtifact(legacyTransition.drawing_artifact_id,null,fresh)
     if(!drawing)return {status:'unavailable'}
     if(drawing.revision!==expected||drawing.manifest?.bob_construction||drawing.construction_transition?.archived!==false
      ||drawing.construction_transition?.artifact_id!==construction.artifact_id||drawing.construction_transition?.drawing_revision!==legacyTransition.drawing_revision)return {status:'conflict'}
    }
    const current=await opts.checkConstruction(construction.artifact_id,construction.revision,fresh)
    if(current.status==='denied')throw new Error('project_denied')
    if(current.status!=='ready')return current
    for(const key of ['recipe','parameters','materials','joints','target_revision'])
     if(JSON.stringify(stableJsonValue(current.draft[key]))!==JSON.stringify(stableJsonValue(construction[key])))return {status:'conflict'}
    return current
   }
   // Recorded gates rebuild earlier replies. A missing render/model checkpoint
   // must still verify current sources inside its actual dispatch operation.
   constructionDispatchGuard=async()=>{
    await refreshDesignReadiness(true)
    if(construction){
     const current=await refreshConstruction(true)
     if(current?.status!=='ready')throw new Error(current?.status==='unavailable'?'checked_construction_unavailable':'checked_construction_changed')
    }
   }
   const reviewCurrentCandidate=async():Promise<Record<string,any>>=>{
     if(!candidate)throw new Error('missing_candidate')
     if(construction){const fresh=await refreshConstruction();if(fresh?.status!=='ready'){candidate=null;acceptedReview=null;return constructionFailure(fresh)}}
     if(!reviewPending){partial=true;candidate=null;return {status:'incomplete',stage:'review',reason:'no_progress',saved:false}}
     // Review uses a fresh conversation with the same pinned geometry and sources.
     const missingViews=handoff.views.filter(view=>!candidate!.packet.recipe.views.includes(view))
     if(!candidate.packet.previews||candidate.packet.recipe.views.some(view=>!candidate!.packet.previews?.[view])){
      candidate=null;partial=true;metrics.review_unavailable++
      return {status:'unavailable',stage:'review',reason:'preview_missing',saved:false}
     }
     if(reviews>=3||Date.now()+15000>=until){candidate=null;partial=true;return {status:'incomplete',stage:'review',reason:'review_budget',saved:false}}
     if(!await checkAuthority()||opts.context&&!await opts.context.validate())throw new Error('project_denied')
     const pinned=await candidateFingerprint(candidate)
     const reviewLookup=makeLookup()
     let independentEvidence
     try{independentEvidence=await collectDrawingReviewEvidence(reviewLookup,!!raw.step_id,[...physicalLineageSources(candidate.packet.manifest.bob_lineage),...cadParameterSources(candidate.packet.manifest.bob_parameters).filter(s=>s.kind==='space_measurement')].length>0)}
     finally{sources.push(...reviewLookup.sources)}
     if(!await checkAuthority())throw new Error('project_denied')
     // Required review reads are a server prerequisite, not advice that a
     // permissive model may waive. Both render paths reach this same gate.
     if(independentEvidence.incomplete_datasets.length){
      const incomplete=independentEvidence.incomplete_datasets
      candidate=null;acceptedReview=null;reviewPending=false;partial=true;metrics.review_unavailable++
      terminalFailure={status:'unavailable',stage:'review',reason:'review_sources_incomplete',saved:false,request_id:request?.id??null,incomplete_datasets:incomplete,
       next_action:catalogText("feedback.cad-assistant.next-action.5320ce97c15d")}
      // Keep the existing draft/assessment, but never persist an approval.
      // Even a failed checkpoint must leave the in-memory save gate closed.
      try{await persist('retrieval_failed',{incomplete})}catch(error){
       rethrowContinuation(error)
       if(error instanceof Error&&['project_denied','drawing_request_cancelled','drawing_context_cleared','drawing_request_complete','drawing_requirements_changed'].includes(error.message))throw error
       terminalFailure={...terminalFailure,request_state_saved:false}
      }
      if(!await checkAuthority())throw new Error('project_denied')
      return terminalFailure
     }
     // Readability is not freshness: an otherwise successful scan may now
     // describe a different revision than the exact rendered candidate.
     const currentMeasurements=independentEvidence.pages.filter(page=>page.dataset==='measurements').flatMap(page=>page.records)
     const changedPins=candidate.measurements.filter(pin=>{
      const found=currentMeasurements.filter(record=>record.id===pin.id)
      return found.length!==1||found[0].revision!==pin.revision||found[0].archived
     })
     const physicalPins=[...physicalLineageSources(candidate.packet.manifest.bob_lineage),...cadParameterSources(candidate.packet.manifest.bob_parameters).filter(s=>s.kind==='space_measurement')]
     const recordsFor=(dataset:string)=>independentEvidence.pages.filter(p=>p.dataset===dataset).flatMap(p=>p.records)
     const changedPhysical=physicalPins.filter(pin=>{
      const rows=recordsFor('physical_space_measurements').filter(r=>r.id===pin.id)
      const sp=recordsFor('physical_spaces').find(r=>r.id===pin.space_id),bu=recordsFor('physical_buildings').find(r=>r.id===pin.building_id)
      return rows.length!==1||rows[0].space_revision!==pin.space_revision||!sp||sp.revision!==pin.space_revision||sp.archived||!bu||bu.archived
     })
     if(changedPins.length||changedPhysical.length){
      candidate=null;acceptedReview=null;reviewPending=false;partial=true
      terminalFailure={status:'needs_data',stage:'review',reason:'review_sources_changed',saved:false,request_id:request?.id??null,changed_measurements:changedPins,changed_physical_sources:changedPhysical.map(p=>p.id),
       next_action:catalogText("feedback.cad-assistant.next-action.87ccd281850d")}
      try{await persist('needs_data')}catch(error){
       rethrowContinuation(error)
       if(error instanceof Error&&['project_denied','drawing_request_cancelled','drawing_context_cleared','drawing_request_complete','drawing_requirements_changed'].includes(error.message))throw error
       terminalFailure={...terminalFailure,request_state_saved:false}
      }
      if(!await checkAuthority())throw new Error('project_denied')
      return terminalFailure
     }
     reviews++;metrics.reviews++
     const checked=await callWithCalculator({app:'bob',coworkerId:'bob',functionName:'cad-reviewer',aiFunction:'cad-reviewer',module:'cad',userId:opts.userId,
      catalogRoleKey:'cad-reviewer',catalogSchemaKey:'bob_cad_review',catalogSchemaParameters:{requirement_ids:handoff.requirements.map(r=>r.id)},schemaName:'bob_cad_review',
      messages:[{role:'user',content:JSON.stringify({project_id:opts.projectId,step_id:raw.step_id,area_id:raw.area_id,artifact_id:raw.artifact_id,review_scope:CAD_REVIEW_SCOPE,independent_evidence:independentEvidence,owner_request:ownerRequest,handoff,current_target:selected,reference_refs:opts.context?.openedImageRefs()??[],
       candidate:{title:candidate.title,description:candidate.description,assumptions:candidate.assumptions,recipe:candidate.packet.recipe,manifest:candidate.packet.manifest,measurements:candidate.measurements},
       design_readiness:readiness,required_feature_ids:[...requiredFeatureIds],source_evidence:researchEvidence,evidence_truncated:false,deterministic_issues:missingViews.map(view=>({code:'missing_view',view}))})},
       ...referencePixels,{role:'user',content:Object.entries(candidate.packet.previews).flatMap(([view,png])=>[{type:'text' as const,text:catalogText('cad.preview.candidate-view',{view})},{type:'image_url' as const,image_url:{url:'data:image/png;base64,'+png,detail:'high' as const}}])}],
      // The calculator wrapper retains this schema while offering optional tools.
      // The governed setting includes reasoning tokens as well as the verdict.
      // Do not silently cap it at the former 5k value; two live reviews exhausted it.
      maxOutputTokens:5000,timeoutMs:Math.min(90000,until-Date.now())},{catalog:opts.aiCatalog,calculator:opts.calculator?{tools:opts.calculator.tools,offered:()=>opts.calculator!.offered(),get remaining(){return opts.calculator!.remaining},execute:raw=>executeRead('calculate_project',raw)}:undefined,hasAccess:async()=>await checkAuthority()&&(!opts.context||await opts.context.validate()),deadline:until,callModel})
     opts.context?.confirmDelivery()
     if(!await checkAuthority()||opts.context&&!await opts.context.validate())throw new Error('project_denied')
     if(!checked.success&&checked.error==='turn_budget_exhausted')throw new Error(checked.error)
     if(!checked.success&&['model_output_limit','model_reasoning_only'].includes(checked.error??'')){
      candidate=null;partial=true;metrics.review_unavailable++
      return terminalFailure={status:'unavailable',stage:'review',reason:checked.error,saved:false,
       user_message:'Granskaren nådde sin svarsgräns utan att lämna ett användbart resultat. Ritningen kunde därför inte godkännas eller sparas från det försöket. Jag stoppade försöket utan att starta om samma arbete.'}
     }
     const review=checked.success?parseCadReview(checked.data,handoff,requiredFeatureIds):null
     if(!review){candidate=null;partial=true;metrics.review_unavailable++;return {status:'unavailable',stage:'review',reason:'review_unavailable',saved:false}}
     reviewPending=false
     if(missingViews.length){review.verdict='revise';review.issues.push({severity:'error',code:'views',correction:'Render missing requested views: '+missingViews.join(', ')})}
     if(review.verdict==='pass'){
      if(construction){const fresh=await refreshConstruction();if(fresh?.status!=='ready'){candidate=null;acceptedReview=null;return constructionFailure(fresh)}}
      acceptedReview={fingerprint:pinned,review}
      await persist('reviewed',{reviewed_candidate:drawingCandidateCommitment(candidate)})
      if(request&&opts.requestStore?.atomicSave)candidate.drawing_request={id:request.id,revision:request.revision}
      savedRequest=opts.requestStore?.atomicSave?null:()=>persist('saved')
      return {status:'ready',request_id:request?.id??null,saved:false,summary:review.summary,quality:acceptedReview,candidate:{title:candidate.title,part_count:candidate.packet.recipe.instances.length,assumptions:candidate.assumptions}}
     }
     metrics.review_rejections++
     if(reviews>=3||renders>=4){candidate=null;partial=true;return {status:'incomplete',stage:'review',saved:false,review}}
     return {status:'revise',saved:false,review}
   }
   if(!construction)return constructionFailure({status:'unavailable'})
   const ready=await refreshConstruction()
   if(ready?.status!=='ready')return constructionFailure(ready)
   runtimeVersion=await opts.runtimeVersion?.()
   await dependencies.refresh(executeRead)
   retryInputs={evidence:{construction:ready.draft,check:ready.checked,current_target:selected,design_intent:readiness.pin,artifact_revision:expected},images:{refs:payload.reference_refs,versions:[...(opts.context?.imageEvidence?.()??new Map())].sort(([a],[b])=>a.localeCompare(b))}}
   const currentFingerprint=await retryFingerprint()
   if(request?.payload.retry?.fingerprint===currentFingerprint)return {...request.payload.retry.outcome,request_id:request.id,retry_suppressed:true,
    next_action:catalogText("feedback.cad-assistant.next-action.d7dc5f3db6a2")}
   used++;metrics.consultations++
   await persist('collecting',{retry:undefined})
   if(construction.target_revision!==selected.revision||raw.area_id!==(construction.area_id??null))return constructionFailure({status:'conflict'})
   const recipe=parseCadAssemblyRequest({...structuredClone(construction.recipe),views:[...handoff.views]})
   if(!recipe)return constructionFailure({status:'unavailable'})
   if(recipe.instances.length>24)return {status:'unsupported',stage:'annotations',saved:false,reason:'annotation_instance_limit',request_id:request?.id??null,
    next_action:catalogText("feedback.cad-assistant.next-action.c0e108a49e51")}
   const parameters=inheritCadParameters(opts.projectId,construction.recipe,construction.parameters,recipe)
   const measurements=parameterSourcePins(parameters).project
   const lineage=buildCadLineage(opts.projectId,recipe,[],new Map(),handoff.coordinates)
   const metadata={title:construction.title,description:construction.description,assumptions:('Concept drawing. '+(construction.open_questions??[]).join(' ')).slice(0,3500),target_revision:Number(selected.revision),measurements,
    source_artifact_id:null,source_revision:null,part_ids:[],area_id:raw.area_id,component_id:raw.component_id,step_id:raw.step_id,artifact_id:drawingArtifactId,expected_revision:expected}
   const pin={version:1,project_id:opts.projectId,artifact_id:construction.artifact_id,revision:construction.revision,check:ready.checked}
   researchEvidence.push({tool:'checked_construction',result:{...construction,check:ready.checked}})
   await persist('draft',{draft:{...metadata,recipe,lineage,parameters,construction:pin}})
   renders++;metrics.renders++
   let packet:CadPacket
   try{packet=await opts.render(recipe,{artifact_id:construction.artifact_id,revision:construction.revision},constructionDispatchGuard)}catch(error){
    rethrowContinuation(error)
    if(error instanceof Error&&['project_denied','drawing_request_cancelled','drawing_context_cleared','drawing_request_complete','drawing_requirements_changed','checked_construction_unavailable','checked_construction_changed','design_readiness_unavailable','design_readiness_changed'].includes(error.message))throw error
    return terminalFailure={status:'unavailable',stage:'cad_engine',saved:false,reason:'render_failed'}
   }
   if(packet.manifest.annotations?.coverage!=='complete'||packet.manifest.annotations?.version!==1)
    return terminalFailure={status:'unavailable',stage:'cad_engine',saved:false,reason:'annotations_unavailable',next_action:catalogText("feedback.cad-assistant.next-action.2015f7a2f7e9")}
   const bounds=packet.manifest.bounding_box_mm,expectedBounds=ready.checked.bounds_mm,collisions=packet.manifest.checks?.collisions
   const visibleIds=new Set(recipe.instances.map(i=>i.id)),referenceIds=new Set(ready.checked.reference_instance_ids??[])
   if(!bounds||!expectedBounds||['min','max','size'].some(key=>!Array.isArray(bounds[key])||bounds[key].length!==3||bounds[key].some((v:number,i:number)=>!Number.isFinite(v)||Math.abs(v-expectedBounds[key][i])>0.001))
    ||collisions?.status!=='complete'||!Array.isArray(collisions.overlaps)||collisions.overlaps.some((overlap:any)=>
     !visibleIds.has(overlap.first_id)||!visibleIds.has(overlap.second_id)||overlap.first_id===overlap.second_id
     ||(!referenceIds.has(overlap.first_id)&&!referenceIds.has(overlap.second_id))))
    return terminalFailure={status:'unavailable',stage:'cad_engine',saved:false,reason:'construction_geometry_disagrees',next_action:catalogText("feedback.cad-assistant.next-action.482e8923bc81")}
   packet={...packet,manifest:{...packet.manifest,bob_lineage:lineage,bob_parameters:parameters,bob_construction:pin,bob_design_intent:readiness.pin,bob_design_images:designImages}}
   candidate={...metadata,packet};reviewPending=true
   const checked=await reviewCurrentCandidate()
   if(checked.status==='revise'){
    candidate=null;acceptedReview=null;partial=true
    return {status:'needs_data',stage:'review',saved:false,request_id:request?.id??null,review:checked.review,
     next_action:catalogText("feedback.cad-assistant.next-action.dd56867affba")}
   }
   return checked
  }catch(error){
   rethrowContinuation(error);candidate=null;acceptedReview=null;partial=true
   if(error instanceof Error&&error.message==='project_denied')throw error
   if(error instanceof Error&&['design_readiness_unavailable','design_readiness_changed'].includes(error.message)){
    const outcome={status:error.message==='design_readiness_unavailable'?'unavailable':'needs_data',stage:'design_readiness',saved:false,reason:error.message,request_id:request?.id??null}
    if(request)await persist(outcome.status==='unavailable'?'retrieval_failed':'needs_data',{reviewed_candidate:undefined})
    return outcome
   }
   if(error instanceof Error&&['checked_construction_unavailable','checked_construction_changed'].includes(error.message))return constructionFailure({status:error.message==='checked_construction_unavailable'?'unavailable':'conflict'})
   if(error instanceof Error&&['drawing_request_cancelled','drawing_context_cleared','drawing_request_complete','drawing_requirements_changed'].includes(error.message)){
    candidate=null;acceptedReview=null;partial=true
    return {status:'stopped',saved:false,request_id:request?.id??null,reason:error.message,next_action:catalogText("feedback.cad-assistant.next-action.8837171e5549")}
   }
   if(error instanceof Error&&error.message.startsWith('drawing_request_reuse:'))return {status:'existing_request',saved:false,request_id:error.message.split(':')[1],next_action:catalogText("feedback.cad-assistant.next-action.9c82aa7ab11b")}
   const reason=error instanceof Error&&['provider_retry_exhausted','turn_budget_exhausted','model_output_limit','model_reasoning_only','model_unavailable','deadline','too_many_tool_calls'].includes(error.message)?error.message:'design_failed'
   if(request&&!retryInputs)await persist('retrieval_failed')
   const failure={status:'unavailable',stage:error instanceof BobBudgetError?error.stage:'design',saved:false,reason,renders:metrics.renders,...(reason==='turn_budget_exhausted'?{budget_stop:readBudgetStop(error),next_action:budgetResumeAction(readBudgetStop(error),opts.aiCatalog)}:{})}
   if(['model_output_limit','model_reasoning_only','model_unavailable','provider_retry_exhausted','turn_budget_exhausted'].includes(reason)){
    const message=reason==='turn_budget_exhausted'
     ?budgetStopMessage(readBudgetStop(error))
     :['model_output_limit','model_reasoning_only'].includes(reason)
      ?'Designern nådde sin svarsgräns utan att lämna ett användbart resultat.'
      :'Designerns modellanrop misslyckades.'
    return terminalFailure={...failure,user_message:message+' Ingen ny ritning sparades från det försöket. '+(metrics.renders===0?'CAD-motorn anropades aldrig. ':'')+'Jag stoppade försöket utan att starta om samma arbete.'}
   }
   return failure
  }
  finally{sources.push(...lookup.sources,...groundingLookup.sources)}
  }
  const finish=async()=>{
   const result=await attempt()
   const outcome=result
   if(request&&!candidate&&retryInputs&&dependencies.complete&&!['stopped','cancelled','paused','saved','existing_request'].includes(String(outcome.status))&&!('retry_suppressed' in outcome)){
    try{await persist(outcome.status==='needs_data'?'needs_data':'retrieval_failed',{reviewed_candidate:undefined,...(object(payload.draft)?{draft:{...payload.draft,source_fingerprint:await sourceFingerprint()}}:{}),dependencies:dependencies.plan(),retry:{fingerprint:await retryFingerprint(),outcome}})}catch(error){
     rethrowContinuation(error)
     if(error instanceof Error&&['project_denied','drawing_request_cancelled','drawing_context_cleared','drawing_request_complete','drawing_requirements_changed'].includes(error.message))throw error
     return {...outcome,request_state_saved:false}
    }
   }
   return outcome
  }
  // The persisted outcome keeps the stop diagnostics for recovery and logs;
  // Bob gets the pause and what to do next.
  return withoutBudgetDetails(await(opts.requestStore?.withReplayScope?opts.requestStore.withReplayScope(finish):finish()))
 }}
}
export type CadAssistant=ReturnType<typeof createCadAssistant>
