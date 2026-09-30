import type {DrawingDependency} from './drawing-dependencies.ts'
import { measurementMillimetres } from './cad-lineage.ts'
import type { DesignHandoff } from './cad-review.ts'
import type { LookupInput, createProjectLookup } from './project-lookup.ts'

export type IntakeCheck = { id:string; status:'known'|'assumption'|'missing'|'conflict'; blocking:boolean; source_refs:string[]; action:'none'|'bob_decision'|'measurement'|'owner_decision'; detail:string }
export type IntakeAssessment = { checks:IntakeCheck[]; additional_needs:IntakeCheck[] }
const checkSchema={type:'object',additionalProperties:false,properties:{id:{type:'string'},status:{type:'string',enum:['known','assumption','missing','conflict']},blocking:{type:'boolean'},source_refs:{type:'array',items:{type:'string'},maxItems:12},action:{type:'string',enum:['none','bob_decision','measurement','owner_decision']},detail:{type:'string',maxLength:1000}},required:['id','status','blocking','source_refs','action','detail']}
export const INTAKE_SCHEMA={type:'object',additionalProperties:false,properties:{checks:{type:'array',items:checkSchema,maxItems:24},additional_needs:{type:'array',items:checkSchema,maxItems:20}},required:['checks','additional_needs']}
export function parseIntakeAssessment(value:unknown,handoff:DesignHandoff,refs:Set<string>):IntakeAssessment|null{
 const v=value as IntakeAssessment
 if(!v||Object.keys(v).sort().join(',')!=='additional_needs,checks'||!Array.isArray(v.checks)||!Array.isArray(v.additional_needs)||v.checks.length!==handoff.requirements.length||v.additional_needs.length>20)return null
 const ids=new Set<string>()
 for(const c of [...v.checks,...v.additional_needs]){
  if(!c||Object.keys(c).sort().join(',')!=='action,blocking,detail,id,source_refs,status'||typeof c.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(c.id)||ids.has(c.id)||!['known','assumption','missing','conflict'].includes(c.status)||typeof c.blocking!=='boolean'||!['none','bob_decision','measurement','owner_decision'].includes(c.action)||typeof c.detail!=='string'||!c.detail.trim()||c.detail.length>1000||!Array.isArray(c.source_refs)||c.source_refs.length>12||c.source_refs.some(r=>!refs.has(r)))return null
  if(c.status==='known'&&(!c.source_refs.length||c.blocking||c.action!=='none'))return null
  if(c.status==='conflict'&&!c.blocking||c.blocking&&c.action==='none')return null
  ids.add(c.id)
 }
 if(handoff.requirements.some(r=>!v.checks.some(c=>c.id===r.id)))return null
 return structuredClone(v)
}
/** Fetch complete bounded pages without paying a model to discover dataset names.
 * Incomplete retrieval is a system problem, never proof that a measure is absent. */
export async function collectIntakeFacts(lookup:ReturnType<typeof createProjectLookup>){
 const datasets:LookupInput['dataset'][]=['project','plan','tasks','requirements','solutions','measurements','components','physical_spaces','physical_elements','physical_space_measurements','physical_relationships']
 const evidence:{tool:string;result:unknown}[]=[],incomplete:string[]=[];let bytes=0
 for(const dataset of datasets){
  let after_id:string|null=null;const seen=new Set<string>()
  for(let page=0;page<4;page++){
   const result=await lookup.search({dataset,query:null,status:null,area_id:null,record_id:null,after_id})
   if(result.status==='denied')throw new Error('project_denied')
   const entry={tool:'search_project_data',result};const size=new TextEncoder().encode(JSON.stringify(entry)).length
   if(bytes+size>120000){incomplete.push(dataset);break}
   bytes+=size;evidence.push(entry)
   if(!['ok','empty'].includes(result.status)){incomplete.push(dataset);break}
   if(!result.truncated&&!result.next_cursor)break
   if(!result.next_cursor||seen.has(result.next_cursor)||page===3){incomplete.push(dataset);break}
   after_id=result.next_cursor;seen.add(after_id)
  }
 }
 return {evidence,incomplete,bytes}
}
export function evidenceRefs(evidence:{tool:string;result:unknown}[],handoff:DesignHandoff){
 const refs=new Set(handoff.requirements.filter(r=>r.basis==='user_request').map(r=>'requirement:'+r.id))
 const walk=(value:unknown)=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return}const v=value as Record<string,unknown>;if(typeof v.id==='string')refs.add(v.id);if(typeof v.ref==='string')refs.add(v.ref);Object.values(v).forEach(walk)}
 evidence.forEach(e=>walk(e.result));return refs
}
export type DrawingRequest={id:string;revision:number;status:string;reason?:string|null;payload:{dependencies?:DrawingDependency[];brief:Record<string,any>;owner_request:string|null;reference_refs:string[];restoration?:{plan_revision:number;step_id:string};assessment?:IntakeAssessment|null;incomplete?:string[];evidence?:unknown;draft?:unknown;retry?:{fingerprint:string;outcome:Record<string,any>};reviewed_candidate?:unknown};receipt?:unknown}
export type DrawingRequestStore={ensureGapTask?:(id:string,expected:number,gap:string,requirement:string,plan:number)=>Promise<any>;work?:(id:string)=>Promise<any>;linkGap?:(id:string,expected:number,gap:string,task:string|null,step:string|null)=>Promise<any>;atomicSave?:boolean;restore?:(id:string,expected:number,planRevision:number,step:string,quote:string)=>Promise<DrawingRequest>;read?:(id:string|null,after?:string|null)=>Promise<unknown>;cancel?:(id:string,expected:number)=>Promise<any>;assertActive?:(id:string)=>Promise<void>;list:()=>Promise<unknown>;load:(id:string)=>Promise<DrawingRequest|null>;save:(id:string|null,expected:number,status:string,payload:DrawingRequest['payload'])=>Promise<DrawingRequest>}

const dimensions={type:'string',enum:['x_mm','y_mm','z_mm','diameter_mm','length_mm','outside_diameter_mm','wall_thickness_mm']}
export const DIMENSION_BINDINGS_SCHEMA={type:'array',maxItems:32,description:'Bind a part dimension to an exact project measurement OR an accepted physical space-measurement snapshot. Never copy a room snapshot into this project to fake source identity. Read physical_space_measurements and use its id and space_revision. The server supplies mm; keep original truth classes. Unbound dimensions remain design choices.',items:{anyOf:[
 {type:'object',additionalProperties:false,properties:{definition_id:{type:'string'},dimension:dimensions,measurement_id:{type:'string'},revision:{type:'integer',minimum:1}},required:['definition_id','dimension','measurement_id','revision']},
 {type:'object',additionalProperties:false,properties:{definition_id:{type:'string'},dimension:dimensions,space_measurement_id:{type:'string'},space_revision:{type:'integer',minimum:1}},required:['definition_id','dimension','space_measurement_id','space_revision']}
]}}
/** AI maps a source to a part dimension; deterministic code supplies its value. */
export function bindMeasuredDimensions(recipe:any,bindings:unknown,records:Map<string,Record<string,any>>){
 if(!Array.isArray(bindings)||bindings.length>32)throw new Error('invalid_dimension_bindings')
 const result=structuredClone(recipe),seen=new Set<string>()
 for(const b of bindings){
  if(!b||Object.keys(b).sort().join(',')!=='definition_id,dimension,measurement_id,revision'||typeof b.definition_id!=='string'||typeof b.measurement_id!=='string'||!Number.isSafeInteger(b.revision))throw new Error('invalid_dimension_bindings')
  const m=records.get(b.measurement_id),d=result?.definitions?.find((v:any)=>v.id===b.definition_id),key=b.definition_id+':'+b.dimension
  if(!m||m.revision!==b.revision||m.archived||typeof m.value!=='number'&&!(typeof m.value==='string'&&/^[0-9]+(?:\.[0-9]+)?$/.test(m.value))||!d||!Object.hasOwn(d,b.dimension)||!['x_mm','y_mm','z_mm','diameter_mm','length_mm','outside_diameter_mm','wall_thickness_mm'].includes(b.dimension)||seen.has(key))throw new Error('unusable_measurement_binding')
  const value=measurementMillimetres(m)
  if(!Number.isFinite(value)||value<=0)throw new Error('unusable_measurement_binding')
  d[b.dimension]=value;seen.add(key)
 }
 return result
}
