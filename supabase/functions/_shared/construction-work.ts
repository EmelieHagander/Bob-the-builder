import { fingerprint, rethrowContinuation } from './bob-job-journal.ts'
import { constructionWorkItems, constructionWorkPage, type ConstructionViewQuery, type ConstructionViewItem } from './construction-views.ts'
import { PROJECT_EDIT_TOOLS } from './project-edits.ts'
import { validConstructionDelivery, type ConstructionDeliveryResource } from './construction-delivery.ts'

type Row=Record<string,any>
type Tool={type:'function';function:{name:string;description:string;parameters:any}}
const nullable=(schema:Row)=>({anyOf:[schema,{type:'null'}]})
export const CONSTRUCTION_WORK_VERSION=1
/** Invalid server-owned schema composition, never a caller geometry/read error. */
export class ConstructionToolContractError extends Error {
 constructor(){super('construction_tool_contract_invalid');this.name='ConstructionToolContractError'}
}
export const CONSTRUCTION_SOLUTION_EDIT_SCHEMA=nullable({type:'object',additionalProperties:false,required:['edit_ref','changes','reason'],properties:{
 edit_ref:{type:'string',description:'Exact selected Solution edit_ref from view=work or read_project_edit_context.'},
 changes:PROJECT_EDIT_TOOLS[1].function.parameters.properties.changes,
 reason:{type:'string',minLength:1,maxLength:1000},
}})
export function withConstructionWorkRead(base:Tool):Tool{
 const p=base.function.parameters
 if(!Array.isArray(p?.properties?.view?.enum)||!Array.isArray(p?.required))throw new ConstructionToolContractError()
 return {...base,function:{...base.function,description:base.function.description+
  ' view=work collects governing Solution/Step sources, editable inputs and the complete affected part/dependency subgraph in one packet. work_kind selects parameters, parts or inspect; step_id names a governing approved Step or null. Other views use work_kind:null and step_id:null. Follow coverage/next_read when a large packet needs more pages. solution_edit entries carry the ordinary server-bound content editor; they are not approval.',
  parameters:{...p,properties:{...p.properties,view:{type:'string',enum:[...p.properties.view.enum,'work']},
   step_id:{type:['string','null'],maxLength:200},work_kind:{type:['string','null'],enum:['parameters','parts','inspect',null]}},required:[...p.required,'step_id','work_kind']}}}
}
export function withConstructionWorkWrite(base:Tool):Tool{
 const p=base.function.parameters
 return {...base,function:{...base.function,description:base.function.description+
  ' solution_edit:null changes only the Construction. Otherwise supply the selected Solution edit_ref, content changes and reason to update that Solution/selection and this Construction atomically; target_revision must be null because the server binds the new selection. Uses the same content paths as edit_project_record, preserves sources/identities and resets design alignment to draft unless /design_intent/alignment is explicitly set. The whole change rolls back on failure and exact key replay returns the original receipts.',
  parameters:{...p,properties:{...p.properties,target_revision:nullable({type:'integer',minimum:1,maximum:999999999}),solution_edit:CONSTRUCTION_SOLUTION_EDIT_SCHEMA},
   required:[...new Set([...p.required,'target_revision','solution_edit'])]}}}
}
export function withConstructionWorkCheck(base:Tool):Tool{
 const p=base.function.parameters
 return {...base,function:{...base.function,description:base.function.description+
  ' Returns the full bounded control findings for this exact saved revision, with explicit coverage; valid previous checks can be reused after fresh source checks. outputs:[] checks the Construction only; name drawings, requirements or cut_plans when those saved outputs are part of the requested delivery. Saved outputs are reopened through their canonical readers. Missing, stale or unreadable outputs stay incomplete. No rendering or new model review is started by this check.',
  parameters:{...p,properties:{...p.properties,outputs:{type:'array',maxItems:3,uniqueItems:true,items:{type:'string',enum:['drawings','requirements','cut_plans']}}},required:[...p.required,'outputs']}}}
}

export type ConstructionWorkSources={packet:Row;solutionEdit:Row}
/** Cache only derived immutable rows. Governing sources and caller access are
 * still read afresh by the caller; cache loss/resume changes no journal reads. */
export function createConstructionWorkPackets(projectId:string){
 const rows=new Map<string,ConstructionViewItem[]>()
 return {async read(draft:Row,query:ConstructionViewQuery,sources:ConstructionWorkSources):Promise<Row>{
  const {packet,solutionEdit}=sources
  if(packet.status!=='ok')return packet
  if(solutionEdit.status==='denied')return {status:'denied'}
  const expected=packet.solution
  if(solutionEdit.status==='ok'&&(solutionEdit.target?.solution_id!==expected.solution_id
   ||solutionEdit.target?.solution_revision!==expected.solution_revision||solutionEdit.target?.revision!==expected.target_revision))
   return {status:'conflict',reason:'work_sources_changed'}
  const selection=constructionWorkItems(draft,query.ids)
  const governing={...packet,construction:undefined,solution:solutionEdit.status==='ok'?{...expected,summary:undefined,features:undefined,choices:undefined}:expected}
  const key=await fingerprint({draft,ids:query.ids,governing,solutionEdit})
  let items=rows.get(key);const reused=!!items
  if(!items){
   items=[{collection:'governing_sources',id:'sources',value:governing},
    {collection:'solution_edit',id:'selected',value:solutionEdit},...selection.items]
   rows.set(key,items);if(rows.size>4)rows.delete(rows.keys().next().value!)
  }
  const page=await constructionWorkPage({...query,revision:draft.revision},{status:'ok',projectId,artifact_id:draft.artifact_id,revision:draft.revision,
   current_revision:draft.current_revision,source_state:draft.source_state,archived:draft.archived,target_revision:draft.target_revision,
   work_operation:query.work_kind,work_context_key:key,selection:query.ids,missing_ids:selection.missing_ids,
   source_coverage:packet.coverage,source_conflicts:packet.conflicts,
   limits:'Exact project sources and a closed dependency selection. Missing/unreadable governing sources remain gaps. No interpretation, rendering or manufacturing approval.'},items,{work_context_key:key})
  // Worker-local telemetry cannot influence exact page boundaries on replay.
  return {...page,diagnostics:{operation:'work_read',reused,revision:draft.revision}}
 }}
}

/** Complete bounded delivery check, including every index page and canonical
 * reopening. The result never promotes an index or partial traversal to pass. */
export async function checkConstructionWorkOutputs(projectId:string,id:string,revision:number,resources:ConstructionDeliveryResource[],readers:{
 read:(id:string,revision:number,resource:ConstructionDeliveryResource,after:string|null)=>Promise<Row>;
 open:(resource:ConstructionDeliveryResource,id:string,revision:number)=>Promise<Row>;
 hasAccess:()=>Promise<boolean>;
}):Promise<Row>{
 const results:Row[]=[]
 for(const resource of resources){
  const records:Row[]=[],seen=new Set<string>();let after:string|null=null,complete=false,error:string|null=null,recordCount=0,allCurrent=true
  for(let page=0;page<32;page++){
   if(!await readers.hasAccess())return {status:'denied'}
   let value:Row
   try{value=await readers.read(id,revision,resource,after)}catch(e){rethrowContinuation(e);error='unavailable';break}
   if(!validConstructionDelivery(value,projectId,id,revision,resource)){error='unavailable';break}
   for(const r of value.records){
    if(seen.has(r.id)){error='inconsistent_index';break}seen.add(r.id)
    let opened:Row|null=null
    try{opened=await readers.open(resource,r.id,r.revision)}catch(e){rethrowContinuation(e)}
    if(!await readers.hasAccess())return {status:'denied'}
    const actual=opened?.record??opened?.data??opened
    const same=actual?.id===r.id&&actual?.revision===r.revision
    // The index pins immutable output lineage; reopening the SAME identity and
    // revision proves freshness. A current projection need not duplicate pins.
    const sourceMatches=r.source.artifact_id===id&&r.source.revision===revision
    const current=same&&r.current_revision===r.revision&&r.archived!==true&&actual?.archived!==true&&actual?.source_state==='current'&&sourceMatches
    recordCount++;allCurrent=allCurrent&&current
    if(records.length<48)records.push({id:r.id,revision:r.revision,status:current?'current':!opened||opened.status==='unavailable'?'unavailable':'not_current',reopened:same,source_matches:sourceMatches})
   }
   if(error)break
   if(!value.truncated){complete=true;break}
   if(value.next_after===after){error='inconsistent_index';break}after=value.next_after
  }
  results.push({resource,complete,status:!complete?'incomplete':!recordCount?'missing':allCurrent?'current':'incomplete',records,record_count:recordCount,
   details_omitted:recordCount>records.length,...(recordCount>records.length?{details_read:{tool:'read_construction_delivery',artifact_id:id,revision,resource,after:null}}:{}),...(error?{reason:error}:{})})
 }
 return {status:!resources.length?'not_requested':results.every(r=>r.status==='current')?'current':'incomplete',resources:results,
  limits:'Requested saved output categories reopened for this exact Construction. This does not establish semantic requirement coverage, manufacturing readiness or that every promised output identity was specified.'}
}
