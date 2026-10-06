import { checkConstruction } from './construction-checks.ts'
import { constructionLists } from './construction-lists.ts'
import { constructionCutFit } from './construction-cut-fit.ts'
import { CAD_RECIPE_SCHEMA } from './cad-schema.ts'
import { parseCadAssemblyRequest } from './cad-adapter.ts'
import { CAD_PARAMETERS_SCHEMA, CadParameterBindingGap, compileCadParameters, parseParameterPlan, parameterSourcePins } from './cad-parameters.ts'
import { schemaIssues } from './schema-issues.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { ProjectWriter } from './project-write.ts'

const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'}
const uuid={type:'string',format:'uuid'}
const nullableUuid={anyOf:[uuid,{type:'null'}]}
const rev={type:'integer',minimum:1,maximum:999999999}
const nullableRev={anyOf:[rev,{type:'null'}]}
const endpoint=obj({instance_id:id,face:{type:'string',enum:['x_min','x_max','y_min','y_max','z_min','z_max']}})
const tool=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function' as const,function:{name,description,parameters:obj(properties)}})
export const CONSTRUCTION_SAVE_TOOL=tool('save_construction_draft',
 'Create or revise the requested construction concept: you choose its parts and typed joints, save this shared checkpoint, then check its exact revision. Use this path when no drawing is requested; a CAD drawing is not a substitute for the material/joint construction. Read current drafts and exact catalog materials first. Complete snapshot replaces only this draft revision; preserve stable IDs and unrelated parts. CAD parameter bindings compute all dimensions and placements server-side in mm/deg. material_ref must be null; materials pins each definition. Joints name box faces in LOCAL part coordinates; methods/reasons are unverified design choices. Keep missing hardware/knowledge in open_questions. Then call check_construction_draft and correct reported geometry/material/joint issues. No strength, drawing or purchase approval is implied.',{
 key:{type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$',description:'Unique key for this intended write in the turn. Reuse only for exact retry; a new revision needs a new key.'},
 record_id:nullableUuid,expected_revision:{type:'integer',minimum:0,maximum:999999999},
 title:{type:'string',minLength:1,maxLength:200},description:{type:'string',minLength:1,maxLength:5500},area_id:{type:['string','null']},target_revision:rev,
 change_note:{type:'string',minLength:1,maxLength:1000},recipe:CAD_RECIPE_SCHEMA,parameter_plan:CAD_PARAMETERS_SCHEMA,
 materials:{type:'array',minItems:1,maxItems:128,items:obj({definition_id:id,material_id:uuid,material_revision:rev,part_id:nullableUuid,part_revision:nullableRev})},
 joints:{type:'array',maxItems:1024,items:obj({id,method:{type:'string',enum:['screwed_butt','glued_butt','dowel','bolted','unresolved']},first:endpoint,second:endpoint,reason:{type:'string',minLength:1,maxLength:2000}})},
 open_questions:{type:'array',maxItems:40,items:{type:'string',minLength:1,maxLength:1000}},
 request_quote:{type:'string',minLength:1,maxLength:500},
})
export const CONSTRUCTION_READ_TOOL=tool('read_construction_draft','List current construction drafts, or read exact saved geometry, parameters, material revisions and joints. A draft is not a reviewed/rendered drawing. Historical revisions retain their original values; inspect source_state.',{
 artifact_id:nullableUuid,revision:nullableRev,after:nullableUuid,
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
export function createConstructionTools(opts:{projectId:string;message:string;writer?:ProjectWriter;hasAccess:()=>Promise<boolean>;
 read:(id:string|null,revision:number|null,after:string|null)=>Promise<unknown>;
 readCurrent?:(id:string)=>Promise<unknown>;
 readCatalog?:(id:string,revision:number)=>Promise<Record<string,any>>;now?:()=>Date;
 readSources:(pins:ReturnType<typeof parameterSourcePins>)=>Promise<{project:Map<string,Record<string,any>>;physical:Map<string,Record<string,any>>}>}){
 let used=0
 return {tools:[CONSTRUCTION_READ_TOOL,CONSTRUCTION_CHECK_TOOL,CONSTRUCTION_LIST_TOOL,CONSTRUCTION_CUT_FIT_TOOL,...(opts.writer?[CONSTRUCTION_SAVE_TOOL]:[])],get remaining(){return Math.max(0,12-used)},
 async execute(name:string,raw:unknown):Promise<Record<string,any>>{
  if(++used>12)return {status:'budget_exhausted'}
  const spec=name===CONSTRUCTION_READ_TOOL.function.name?CONSTRUCTION_READ_TOOL:name===CONSTRUCTION_SAVE_TOOL.function.name?CONSTRUCTION_SAVE_TOOL:name===CONSTRUCTION_CHECK_TOOL.function.name?CONSTRUCTION_CHECK_TOOL:name===CONSTRUCTION_LIST_TOOL.function.name?CONSTRUCTION_LIST_TOOL:name===CONSTRUCTION_CUT_FIT_TOOL.function.name?CONSTRUCTION_CUT_FIT_TOOL:null
  if(!spec)return {status:'invalid'}
  const issues=schemaIssues(spec.function.parameters,raw)
  if(issues.length)return {status:'invalid',issues}
  const v=raw as any
  if(!await opts.hasAccess())return {status:'denied'}
  try{
   if(name===CONSTRUCTION_READ_TOOL.function.name){
    const result=await opts.read(v.artifact_id,v.revision,v.after) as Record<string,any>
    if(!await opts.hasAccess())return {status:'denied'}
    if(!result||result.projectId!==opts.projectId||!['ok','not_found'].includes(result.status)||JSON.stringify(result).length>600000)throw new Error('construction_read_unavailable')
    return result
   }
   if(name===CONSTRUCTION_CHECK_TOOL.function.name||name===CONSTRUCTION_LIST_TOOL.function.name||name===CONSTRUCTION_CUT_FIT_TOOL.function.name){
    if(!opts.readCatalog)return {status:'unavailable'}
    const draft=await opts.read(v.artifact_id,v.revision,null) as Record<string,any>
    if(!draft||draft.projectId!==opts.projectId||draft.status!=='ok'||draft.artifact_id!==v.artifact_id||draft.revision!==v.revision)return {status:'unavailable'}
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
    const checked=checkConstruction(draft,catalog,(opts.now?.()??new Date()).toISOString().slice(0,10))
    if(name===CONSTRUCTION_CHECK_TOOL.function.name)return {projectId:opts.projectId,...checked}
    if(!checked.concept_ready)return {status:'needs_data',checked,message:'Correct the same construction before deriving lists; no quantities or fabrication approval returned.'}
    if(name===CONSTRUCTION_CUT_FIT_TOOL.function.name){
     if([...catalog.values()].some(r=>r.kind==='material'&&r.profile_code!=='sheet_stock'))return {status:'unsupported',message:'This cutting assessment supports sheet_stock material only; profile/bar cutting needs a separate capability.'}
     return {projectId:opts.projectId,...constructionCutFit(constructionLists(draft,catalog,[]),v.candidates,v.blank_grain),checked}
    }
    return {projectId:opts.projectId,...constructionLists(draft,catalog,v.assembly_dependencies),checked}
   }
   if(!opts.writer)return {status:'denied'}
   if(!opts.message.includes(v.request_quote)||!v.request_quote.trim()||(v.record_id===null?v.expected_revision!==0:v.expected_revision<1))return {status:'invalid',message:'Use the current request and exact expected revision.'}
   const recipe=parseCadAssemblyRequest(structuredClone(v.recipe))
   if(!recipe)return {status:'invalid',message:'Invalid CAD recipe or referenced part IDs.'}
   const plan=parseParameterPlan(v.parameter_plan)
   // Image-oriented construction checkpoints need a canonical image carrier;
   // never accept model-supplied image hashes as read evidence.
   if(plan.frames.some(f=>f.kind==='image'))return {status:'invalid',message:'Image frames are not supported by the construction checkpoint yet. Keep that orientation as an open question.'}
   const sources=await opts.readSources(parameterSourcePins(plan))
   const parameters=compileCadParameters(opts.projectId,recipe,plan,sources.project,sources.physical)
   if(!parseCadAssemblyRequest(recipe))return {status:'invalid',message:'Computed dimensions or placement are outside the supported geometry contract.'}
   if(!await opts.hasAccess())return {status:'denied'}
   const {record_id,expected_revision,request_quote,parameter_plan,...data}=v
   return await opts.writer.commit({kind:'construction',record_id,expected_revision,expected_updated_at:null,request_quote,data:{...data,recipe,parameters}})
  }catch(error){
   rethrowContinuation(error)
   if(error instanceof CadParameterBindingGap)return {status:'invalid',message:'Bind every path in unbound to a parameter node using these exact slash-separated paths. Keep the same construction IDs and correct the parameter plan; no source lookup retry is needed.',unbound:error.unbound}
   const message=error instanceof Error?error.message:''
   const known=/^(invalid_parameter_[a-z_]+|parameter_[a-z_]+|unknown_required_parameters|coordinate_[a-z_]+)$/
   return known.test(message)?{status:'invalid',message}:{status:'unavailable',message:'Could not verify construction data. Read again; a failed lookup does not mean data is absent.'}
  }
 }}
}
export type ConstructionTools=ReturnType<typeof createConstructionTools>

/** The drawing desk uses the same checker and exact caller reads, without
 * trusting a model's earlier assertion that a checkpoint passed. */
export async function checkedConstructionForDrawing(opts:Parameters<typeof createConstructionTools>[0],id:string,revision:number) {
 const tools=createConstructionTools(opts)
 const checked=await tools.execute('check_construction_draft',{artifact_id:id,revision})
 if(checked.status!=='checked'||!checked.concept_ready)return {status:checked.status==='checked'?'needs_data':checked.status,checked}
 const draft=await opts.read(id,revision,null) as Record<string,any>
 if(!await opts.hasAccess())return {status:'denied',checked}
 if(draft?.projectId!==opts.projectId||draft.status!=='ok'||draft.artifact_id!==id||draft.revision!==revision
  ||draft.current_revision!==revision||draft.source_state!=='current'||draft.archived)return {status:'conflict',checked}
 return {status:'ready',draft,checked}
}
