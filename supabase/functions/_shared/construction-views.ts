import { countSerializedTokens } from './bob-token-budget.ts'
import { stableJsonValue } from './bob-job-journal.ts'
import type { FastenerSchedule } from './construction-fasteners.ts'
import { INSTANCE_ROLE_POLICY } from './construction-instance-policy.ts'

type Row = Record<string, any>
export type ConstructionViewItem = { collection: string; id: string; value: unknown }
type Item = ConstructionViewItem
/** Default page and the floor for every read. Jobs without the
 * constructionPageVersion pin keep exactly this size, so their replays match. */
export const CONSTRUCTION_VIEW_TOKENS = 2000
/** Owner decision A (2026-10-22, pinned per job): each page costs Bob a whole
 * model step, so one read may return up to this much of the selected view. */
export const CONSTRUCTION_VIEW_MAX_TOKENS = 6000
/** One complete work packet replaces several separate view/model round trips. */
export const CONSTRUCTION_WORK_MAX_TOKENS = 12000
/** Reads in the same model step share this, never below the default page, so
 * a step holds at most max(12,000, 2,000 x reads) tokens of construction pages. */
export const CONSTRUCTION_VIEW_STEP_TOKENS = 12000
export function constructionViewBudget(readsInStep:number):number{
 const reads=Number.isSafeInteger(readsInStep)&&readsInStep>0?readsInStep:1
 return Math.max(CONSTRUCTION_VIEW_TOKENS,Math.min(CONSTRUCTION_VIEW_MAX_TOKENS,Math.floor(CONSTRUCTION_VIEW_STEP_TOKENS/reads)))
}
const views = ['overview','parts','parameters','bindings','joints','materials','roles','notes','dependencies','result']
const nullable = (schema: Row) => ({ anyOf: [schema, { type: 'null' }] })
export const CONSTRUCTION_VIEW_TOOL = { type: 'function' as const, function: {
 name: 'read_construction_draft',
 description: 'Read a small construction overview, then exact revision-bound pages. Default view=overview; artifact_id:null lists drafts. parts shows definitions and placements; parameters includes exact formulas, normalized values and source pins; dependencies follows named part/node dependencies, bindings, joints and roles. ids:[] reads the whole selected view; named IDs select matching records (dependencies also follows ancestors/dependents). notes contains original description/questions. Result references reopen an earlier check/list/cut assessment without rerunning it: view=result, exact artifact/revision/result_id, section:null for all or a returned section name, ids:[]. Historical results do not prove current sources or grant write/drawing permission. Follow next_read and coverage before relying on omitted details. Each page preserves exact posts; an oversized post is explicitly split into JSON fragments with offsets. Never reconstruct a full construction merely to inspect or change one part.',
 parameters: { type:'object',additionalProperties:false,properties:{
  artifact_id:nullable({type:'string',format:'uuid'}),revision:nullable({type:'integer',minimum:1,maximum:999999999}),
  after:nullable({type:'string',maxLength:240}),view:{type:'string',enum:views},
  ids:{type:'array',maxItems:20,uniqueItems:true,items:{type:'string',minLength:1,maxLength:240}},
  result_id:nullable({type:'string',pattern:'^cs_[a-f0-9]{64}$'}),section:nullable({type:'string',minLength:1,maxLength:120}),
 },required:['artifact_id','revision','after','view','ids','result_id','section']},
} }
export const CONSTRUCTION_EVIDENCE_VIEW_TOOL={...CONSTRUCTION_VIEW_TOOL,function:{...CONSTRUCTION_VIEW_TOOL.function,
 description:CONSTRUCTION_VIEW_TOOL.function.description+' view=results lists saved check references for this exact revision across turns; follow next_read. view=result reopens those findings. Source/checker changes keep history readable and prevent reuse as current evidence.',
 parameters:{...CONSTRUCTION_VIEW_TOOL.function.parameters,properties:{...CONSTRUCTION_VIEW_TOOL.function.parameters.properties,view:{type:'string',enum:[...views,'results']}}}}}
export type ConstructionObservation = { id:string; projectId:string; artifact_id:string; revision:number; kind:string; observed_at:string; output:Row }
export type ConstructionViewQuery = {artifact_id:string|null;revision:number|null;after:string|null;view:string;ids:string[];result_id:string|null;section:string|null;step_id?:string|null;work_kind?:string|null}
const arr = (value:any):any[] => Array.isArray(value)?value:[]
async function exactHash(value:unknown){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stableJsonValue(value))))
 return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')
}
const items = (collection:string, values:any[], key='id'):Item[] => values.map((value,index)=>({collection,id:String(value?.[key]??index),value}))
const reference = (o:ConstructionObservation) => ({result_id:o.id,kind:o.kind,revision:o.revision,observed_at:o.observed_at,
 status:o.output.status,concept_ready:o.output.concept_ready??o.output.checked?.concept_ready??null,
 issue_count:o.output.issue_count??o.output.checked?.issue_count??null,observation:'historical',
 read:{artifact_id:o.artifact_id,revision:o.revision,after:null,view:'result',ids:[],result_id:o.id,section:null}})

/** Pure selection: canonical records are never replaced by an AI summary. */
export function constructionViewItems(draft:Row,view:string,ids:string[]):{items:Item[];missing_ids:string[]} {
 const recipe=draft.recipe??{},graph=draft.parameters??{},definitions=arr(recipe.definitions),instances=arr(recipe.instances),nodes=arr(graph.nodes),bindings=arr(graph.bindings)
 const roles=arr(draft.instance_policy?.instances),materials=arr(draft.materials),joints=arr(draft.joints)
 const wanted=new Set(ids),all=ids.length===0,missing=new Set(ids)
 const match=(id:string)=>{if(wanted.has(id))missing.delete(id);return all||wanted.has(id)}
 let out:Item[]=[]
 if(view==='parts'){
  const selectedInstances=instances.filter(i=>{const direct=match(i.id);return direct||wanted.has(i.definition_id)})
  const definitionIds=new Set(selectedInstances.map(i=>i.definition_id))
  out=[...items('definitions',definitions.filter(d=>match(d.id)||definitionIds.has(d.id))),...items('instances',selectedInstances)]
 }else if(view==='parameters')out=[...items('nodes',nodes.filter(n=>match(n.id))),...items('frames',all?arr(graph.frames):[])]
 else if(view==='bindings')out=items('bindings',bindings.filter(b=>match(b.path)||wanted.has(b.node)),'path')
 else if(view==='joints')out=items('joints',joints.filter(j=>match(j.id)||wanted.has(j.first.instance_id)||wanted.has(j.second.instance_id)))
 else if(view==='materials')out=items('materials',materials.filter(m=>match(m.definition_id)),'definition_id')
 else if(view==='roles')out=items('roles',roles.filter(r=>match(r.instance_id)),'instance_id')
 else if(view==='notes')out=[{collection:'description',id:'description',value:draft.description??''},...items('open_questions',arr(draft.open_questions)),
  ...(draft.form_refinement?[...items('form_mappings',arr(draft.form_refinement.mappings),'component_id'),{collection:'form_scope',id:'form_scope',value:draft.form_scope},
   ...items('form_features',arr(draft.design_intent?.features)),...items('form_choices',arr(draft.design_intent?.choices))]:[])]
 else if(view==='dependencies'){
  const partIds=new Set(instances.filter(i=>match(i.id)||wanted.has(i.definition_id)).map(i=>i.id))
  const definitionIds=new Set(definitions.filter(d=>match(d.id)).map(d=>d.id))
  for(const i of instances)if(partIds.has(i.id))definitionIds.add(i.definition_id)
  const selectedNodes=new Set(nodes.filter(n=>match(n.id)).map(n=>n.id))
  const attached=(b:Row)=>{const [kind,id]=b.path.split('/');return kind==='definitions'?definitionIds.has(id):kind==='instances'&&partIds.has(id)}
  for(const b of bindings)if(attached(b)||wanted.has(b.path)){selectedNodes.add(b.node);missing.delete(b.path)}
  // Upstream sources/formulas and downstream values affected by an edited node.
  const downstream=new Set(selectedNodes)
  let changed=true
  while(changed){changed=false;for(const n of nodes)if(arr(n.operands).some(id=>downstream.has(id))&&!downstream.has(n.id)){downstream.add(n.id);changed=true}}
  for(const id of downstream)selectedNodes.add(id)
  const byId=new Map(nodes.map(n=>[n.id,n])),pending=[...selectedNodes]
  for(let index=0;index<pending.length;index++)for(const operand of arr(byId.get(pending[index])?.operands))if(!selectedNodes.has(operand)){selectedNodes.add(operand);pending.push(operand)}
  const selectedBindings=bindings.filter(b=>selectedNodes.has(b.node)||attached(b))
  for(const b of selectedBindings){const [kind,id]=b.path.split('/');if(kind==='definitions')definitionIds.add(id);if(kind==='instances')partIds.add(id)}
  for(const i of instances)if(definitionIds.has(i.definition_id))partIds.add(i.id)
  const selectedJoints=joints.filter(j=>partIds.has(j.first.instance_id)||partIds.has(j.second.instance_id)||wanted.has(j.id))
  for(const j of selectedJoints){missing.delete(j.id);partIds.add(j.first.instance_id);partIds.add(j.second.instance_id)}
  for(const i of instances)if(partIds.has(i.id))definitionIds.add(i.definition_id)
  out=[...items('nodes',nodes.filter(n=>selectedNodes.has(n.id))),...items('bindings',selectedBindings,'path'),
   ...items('definitions',definitions.filter(d=>definitionIds.has(d.id))),...items('instances',instances.filter(i=>partIds.has(i.id))),
   ...items('joints',selectedJoints),...items('materials',materials.filter(m=>definitionIds.has(m.definition_id)),'definition_id'),
   ...items('roles',roles.filter(r=>partIds.has(r.instance_id)),'instance_id'),...items('frames',arr(graph.frames))]
 }
 // Endpoint and node selectors also count as found in their relevant views.
 if(view==='bindings')for(const b of bindings)if(wanted.has(b.node))missing.delete(b.node)
 if(view==='joints')for(const j of joints)for(const end of ['first','second'])if(wanted.has(j[end].instance_id))missing.delete(j[end].instance_id)
 return {items:out,missing_ids:[...missing]}
}

/** Follow every newly reached part/node/joint until the selected subgraph is
 * closed. A view intended for editing cannot stop at the first neighbor. */
export function constructionWorkItems(draft:Row,ids:string[]):{items:Item[];missing_ids:string[]} {
 const all=['parameters','bindings','parts','joints','materials','roles'].flatMap(view=>constructionViewItems(draft,view,[]).items)
 if(!ids.length)return {items:[...constructionViewItems(draft,'notes',[]).items,...all],missing_ids:[]}
 const known=new Set(all.map(item=>item.id)),selected=new Set(ids),records=new Map<string,Item>()
 let prior=-1
 while(prior!==selected.size){
  prior=selected.size
  const part=constructionViewItems(draft,'dependencies',[...selected])
  for(const item of part.items){
   records.set(item.collection+':'+item.id,item)
   if(['nodes','definitions','instances','joints','bindings'].includes(item.collection))selected.add(item.id)
  }
 }
 return {items:[...constructionViewItems(draft,'notes',[]).items,...all.filter(item=>records.has(item.collection+':'+item.id))],missing_ids:ids.filter(id=>!known.has(id))}
}

/** Reuses exact-row/fragment paging. Every page is bound to governing source
 * revisions too, so changing a Solution/Step cannot silently splice pages. */
export function constructionWorkPage(query:ConstructionViewQuery,header:Row,rows:Item[],binding:Row,budget=CONSTRUCTION_WORK_MAX_TOKENS){
 return page(query,header,rows,budget,{scope:'construction_work',binding:{...binding,step_id:query.step_id??null,work_kind:query.work_kind??null}})
}

/** Compact construction table (owner decision 2026-10-26, pinned per job).
 * Headers once, then row arrays of exact saved values; no AI summary. */
const TABLE_SIZES:Record<string,string[]>={box:['x_mm','y_mm','z_mm'],cylinder:['diameter_mm','length_mm'],tube:['outside_diameter_mm','wall_thickness_mm','length_mm']}
const TABLE_SECTIONS:Record<string,Row>={
 definitions:{columns:['id','primitive','size_mm','material_ref']},
 parts:{columns:['id','definition_id','role']},
 joints:{columns:['id','method','first','second','fastener'],first:'instance_id.face',second:'instance_id.face',fastener:['source','kind','diameter_mm','length_mm','count','gaps']},
 fastener_totals:{columns:['kind','diameter_mm','length_mm','count','joint_ids']},
}
const TABLE_MESSAGE='Compact table of exact saved values. Placements, formulas, materials, reasons and notes are in the named views: open exact records by ID. Role unknown means not recorded. Fasteners are the server rule-of-thumb proposal with its rule gaps, not verified strength. No current check is inferred from a saved draft or historical result.'
export type ConstructionTableOption={table:true;fasteners?:FastenerSchedule|null}

/** Fixed row order: definitions, parts, joints, then the server fastener totals.
 * Fasteners come only from the SQL schedule, with its rule gaps (for example
 * narrow_contact) kept visible; roles only from the saved policy. */
function tableRows(draft:Row,fasteners:FastenerSchedule|null):Item[]{
 const roles=new Map<unknown,unknown>(arr(draft.instance_policy?.instances).map(r=>[r?.instance_id,r?.role]))
 const role=(id:unknown)=>{const r=roles.get(id);return typeof r==='string'&&Object.hasOwn(INSTANCE_ROLE_POLICY,r)?r:'unknown'}
 const schedule=new Map<unknown,Row>(fasteners?arr(fasteners.joints).map(f=>[f?.joint_id,f]):[])
 const fastener=(id:unknown)=>{const f=schedule.get(id);return f?[f.source??null,f.kind??null,f.diameter_mm??null,f.length_mm??null,f.count??null,f.gaps??null]:null}
 const end=(e:Row)=>`${e?.instance_id}.${e?.face}`
 const size=(d:Row)=>Object.hasOwn(TABLE_SIZES,d.primitive)?TABLE_SIZES[d.primitive].map(k=>d[k]??null):null
 return [
  ...arr(draft.recipe?.definitions).map(d=>({collection:'definitions',id:String(d.id),value:[d.id,d.primitive,size(d),d.material_ref??null]})),
  ...arr(draft.recipe?.instances).map(i=>({collection:'parts',id:String(i.id),value:[i.id,i.definition_id,role(i.id)]})),
  ...arr(draft.joints).map(j=>({collection:'joints',id:String(j.id),value:[j.id,j.method,end(j.first),end(j.second),fastener(j.id)]})),
  ...(fasteners?arr(fasteners.totals).map((t,n)=>({collection:'fastener_totals',id:String(n),value:[t.kind,t.diameter_mm,t.length_mm,t.count,t.joint_ids]})):[]),
 ]
}
/** One page of the table. A section appears when this page holds its rows, or
 * when it is empty overall: an absent section means "on another page", never "none". */
function presentTable(records:Row[],all:Item[],fasteners:FastenerSchedule|null,openQuestions:number):Row{
 const filled=new Set(all.map(r=>r.collection)),out:Row={}
 const section=(name:string)=>{
  const rows=records.filter(r=>r.collection===name&&!('fragment'in r)).map(r=>r.value as unknown[])
  if(!rows.length&&filled.has(name))return null
  const sizes=name==='definitions'?{size_mm:Object.fromEntries(Object.entries(TABLE_SIZES).filter(([p])=>rows.some(r=>r[1]===p)))}:{}
  return {...TABLE_SECTIONS[name],...sizes,rows}
 }
 for(const name of ['definitions','parts','joints']){const s=section(name);if(s)out[name]=s}
 const totals=fasteners&&section('fastener_totals')
 out.fasteners=fasteners?{complete:fasteners.complete,...(totals?{totals}:{}),glue_packages:fasteners.glue_packages,basis:'rule_of_thumb_proposal'}:{status:'unavailable'}
 out.open_questions=openQuestions
 const fragments=records.filter(r=>'fragment'in r)
 if(fragments.length)out.fragments=fragments
 return out
}
/** The whole table in one value: definitions, parts (roles), joints (server
 * fasteners) and the fastener summary, or fasteners {status:'unavailable'}. */
export function constructionTable(draft:Row,fasteners?:FastenerSchedule|null):Row{
 const rows=tableRows(draft,fasteners??null)
 return presentTable(rows,rows,fasteners??null,arr(draft.open_questions).length)
}

function resultItems(output:Row):Item[]{
 const result:Item[]=[]
 const visit=(value:any,path:string)=>{
  if(Array.isArray(value)){result.push(...(value.length?items(path,value):[{collection:path,id:'empty_array',value:[]} ]));return}
  if(value&&typeof value==='object'){
   const metadata:Row={}
   for(const [key,child] of Object.entries(value)){
    if(child&&typeof child==='object')visit(child,path?path+'.'+key:key)
    else metadata[key]=child
   }
   if(Object.keys(metadata).length||!Object.keys(value).length)result.push({collection:path||'metadata',id:'metadata',value:metadata})
  }
 }
 visit(output,'');return result
}

/** A cursor binds the immutable record selection, not the latest project head.
 * Whole rows are preferred. Oversized rows expose exact Unicode JSON fragments,
 * never an unlabeled truncation or a fabricated shortened fact. A layout may
 * bind extra selection inputs, present the page's rows differently and name the
 * read after the last page; without one, pages are unchanged. */
type PageLayout={binding?:Row;scope?:string;present?:(records:Row[])=>Row;last?:Row}
async function page(query:ConstructionViewQuery,header:Row,rows:Item[],budget:number,layout:PageLayout={}):Promise<Row>{
 if(!Number.isSafeInteger(budget)||budget<CONSTRUCTION_VIEW_TOKENS||budget>(query.view==='work'?CONSTRUCTION_WORK_MAX_TOKENS:CONSTRUCTION_VIEW_MAX_TOKENS))throw new Error('construction_view_budget_invalid')
 const binding=(await exactHash({artifact_id:query.artifact_id,revision:query.revision,view:query.view,ids:query.ids,result_id:query.result_id,section:query.section,...layout.binding})).slice(0,24)
 let index=0,offset=0
 if(query.after){const m=/^cv1:([a-f0-9]{24}):(\d+):(\d+)$/.exec(query.after);if(!m||m[1]!==binding)throw new Error('construction_view_cursor_invalid');index=Number(m[2]);offset=Number(m[3])}
 if(!Number.isSafeInteger(index)||index<0||index>rows.length||!Number.isSafeInteger(offset)||offset<0||index===rows.length&&offset!==0)throw new Error('construction_view_cursor_invalid')
 const startOffset=offset
 const token=(i:number,o:number)=>i<rows.length?`cv1:${binding}:${i}:${o}`:null
 const envelope=(records:Row[],i:number,o:number)=>({...header,view:query.view,...(layout.present?layout.present(records):{items:records}),
  coverage:{total_items:rows.length,start_index:index,start_offset:startOffset,next_index:i,fragment_offset:o,
   end_of_selection:i===rows.length,complete:index===0&&startOffset===0&&i===rows.length,scope:layout.scope??'selected_view_only'},
  next_read:i<rows.length?{...query,after:token(i,o)}:layout.last??null})
 const records:Row[]=[];let next=index
 if(countSerializedTokens(envelope([],next,offset))>budget)throw new Error('construction_view_header_too_large')
 while(next<rows.length){
  const row=rows[next]
  if(offset===0&&countSerializedTokens(envelope([...records,row],next+1,0))<=budget){records.push(row);next++;continue}
  if(records.length)break
  const chars=Array.from(JSON.stringify(stableJsonValue(row.value)))
  if(offset>=chars.length)throw new Error('construction_view_cursor_invalid')
  const fragment=(end:number)=>({collection:row.collection,id:row.id,fragment:{encoding:'json',offset,total_characters:chars.length,text:chars.slice(offset,end).join(''),complete:end===chars.length}})
  // Four characters per token: exactly the former 8,000 at the default page.
  let low=offset,high=Math.min(chars.length,offset+budget*4)
  while(low<high){const end=Math.ceil((low+high)/2);if(countSerializedTokens(envelope([fragment(end)],end===chars.length?next+1:next,end===chars.length?0:end))<=budget)low=end;else high=end-1}
  if(low===offset)throw new Error('construction_view_page_unavailable')
  records.push(fragment(low));if(low===chars.length){next++;offset=0}else offset=low
  break
 }
 return envelope(records,next,offset)
}

export function createConstructionViews(projectId:string,now:()=>Date=()=>new Date()){
 let observations:ConstructionObservation[]=[]
 const seen=new Map<string,ConstructionObservation>()
 function restore(value:unknown){
  if(!Array.isArray(value))throw new Error('construction_observations_checkpoint_invalid')
  const next=value as ConstructionObservation[],ids=new Set<string>()
  for(const o of next){if(!o||!/^cs_[a-f0-9]{64}$/.test(o.id)||ids.has(o.id)||o.projectId!==projectId||typeof o.artifact_id!=='string'||!Number.isSafeInteger(o.revision)||o.revision<1
   ||!['check','lists','cut_fit'].includes(o.kind)||typeof o.observed_at!=='string'||!Number.isFinite(Date.parse(o.observed_at))||!o.output||Array.isArray(o.output)||o.output.projectId!==projectId)throw new Error('construction_observations_checkpoint_invalid');ids.add(o.id)}
  observations=stableJsonValue(next);seen.clear();for(const o of observations)seen.set(o.id,o)
 }
 async function observe(kind:string,artifact_id:string,revision:number,output:Row,observedAt=now().toISOString()){
  const canonical=stableJsonValue({...output,projectId})
  const id='cs_'+await exactHash({projectId,artifact_id,revision,kind,output:canonical})
  let observation=seen.get(id)
  if(!observation){observation={id,projectId,artifact_id,revision,kind,observed_at:observedAt,output:canonical};observations.push(observation);seen.set(id,observation)}
  return {...summary(observation),observation:'fresh_check',checked_at:observedAt}
 }
 async function importObservation(value:ConstructionObservation){
  const id='cs_'+await exactHash({projectId:value.projectId,artifact_id:value.artifact_id,revision:value.revision,kind:value.kind,output:stableJsonValue(value.output)})
  if(id!==value.id)throw Error('construction_observation_mismatch')
  restore([...observations.filter(o=>o.id!==value.id),value])
 }
 function summary(o:ConstructionObservation){
  const output=o.output,checked=output.checked??output
  return {projectId,status:output.status,artifact_id:o.artifact_id,revision:o.revision,result:reference(o),
   checker_version:checked.checker_version??null,concept_ready:checked.concept_ready??null,fabrication_ready:false,rendered:false,reviewed:false,
   issue_count:checked.issue_count??0,fabrication_gap_count:checked.fabrication_gap_count??0,
   bounds_mm:checked.bounds_mm??null,part_count:checked.part_count??null,
   reason:output.reason??null,sections:sections(resultItems(output)),
   details_omitted:true,message:'Open the exact result sections for findings and constraints before relying on this assessment. A construction result is not a drawing or manufacturing approval.'}
 }
 function sections(rows:Item[]){const counts=new Map<string,number>();for(const row of rows)counts.set(row.collection,(counts.get(row.collection)??0)+1);return [...counts].map(([name,count])=>({name,count}))}
 /** table (pinned per job) adds the compact construction table to the overview;
  * without it the overview stays exactly as before. */
 async function read(draft:Row,query:ConstructionViewQuery,budget=CONSTRUCTION_VIEW_TOKENS,table?:ConstructionTableOption,extraHeader:Row={}):Promise<Row>{
  if(query.view==='result'){
   const o=query.result_id&&seen.get(query.result_id)
   if(!o||o.artifact_id!==query.artifact_id||o.revision!==query.revision)return {status:'not_found',projectId,message:'No observed result for this exact construction revision in this turn.'}
   if(query.ids.length)return {status:'invalid',message:'Use a returned result section name, with ids:[], to reopen all of its exact findings.'}
   const rows=resultItems(o.output),selected=query.section?rows.filter(r=>r.collection===query.section):rows
   if(query.section&&!selected.length)return {status:'not_found',projectId,sections:sections(rows)}
   return page(query,{projectId,status:'ok',artifact_id:o.artifact_id,revision:o.revision,result_id:o.id,observed_at:o.observed_at,
    observation:'historical',current_revision:draft.current_revision??draft.revision,source_state:draft.source_state,archived:draft.archived,
    sections:sections(rows),message:'Exact earlier observation. Current source status is shown separately; this does not rerun the check or renew approval.',...extraHeader},selected,budget)
  }
  if(query.result_id!==null||query.section!==null)return {status:'invalid',message:'result_id and section are only used with view=result.'}
  if(query.view==='notes'&&query.ids.length)return {status:'invalid',message:'Read notes without an ID filter; all original questions remain available.'}
  const header={projectId,status:'ok',artifact_id:draft.artifact_id,revision:draft.revision,current_revision:draft.current_revision,source_state:draft.source_state,archived:draft.archived,roles_recorded:draft.instance_policy!=null,...extraHeader}
  if(query.view==='overview'){
   if(table?.table===true&&query.ids.length)return {status:'invalid',message:'Overview has no ID filter. Open exact records by ID in a detail view.'}
   if(table?.table!==true&&(query.after||query.ids.length))return {status:'invalid',message:'Overview has no item cursor or ID filter. Choose a detail view.'}
   const recent=[...observations].reverse().filter(o=>o.artifact_id===draft.artifact_id&&o.revision===draft.revision)
   const kinds=new Set<string>(),refs=recent.filter(o=>{if(kinds.has(o.kind))return false;kinds.add(o.kind);return true}).map(reference)
   const overview={...header,title:draft.title,area_id:draft.area_id,target_revision:draft.target_revision,construction_status:'draft',rendered:false,reviewed:false,
    ...(draft.form_refinement?{form:{verification:'unverified',solution_id:draft.solution_id,solution_revision:draft.solution_revision,mapped_components:arr(draft.form_scope?.component_ids).length,pending_components:arr(draft.form_scope?.pending_component_ids).length,pending_choices:arr(draft.form_scope?.pending_choice_ids).length,details_view:'notes'}}:{}),
    counts:{definitions:arr(draft.recipe?.definitions).length,instances:arr(draft.recipe?.instances).length,nodes:arr(draft.parameters?.nodes).length,
     bindings:arr(draft.parameters?.bindings).length,joints:arr(draft.joints).length,materials:arr(draft.materials).length,
     unknown_roles:draft.instance_policy==null?arr(draft.recipe?.instances).length:arr(draft.instance_policy.instances).filter(r=>r.role==='unknown').length,roles_recorded:draft.instance_policy!=null,open_questions:arr(draft.open_questions).length},
    previous_results:refs,views:views.filter(v=>!['overview','result'].includes(v)),details_omitted:true}
   if(table?.table!==true)return {...overview,next_read:{...query,revision:draft.revision,view:'notes'},message:'Description, questions, parts and dependencies are available in the named views. No current check is inferred from a saved draft or historical result.'}
   // The cursor also binds whether the server schedule was present: its rows differ.
   const fasteners=table.fasteners??null,rows=tableRows(draft,fasteners),openQuestions=arr(draft.open_questions).length
   return page({...query,revision:draft.revision},{...overview,message:TABLE_MESSAGE},rows,budget,{binding:{table:1,fasteners:fasteners!==null},scope:'overview_table',
    present:records=>({table:presentTable(records,rows,fasteners,openQuestions)}),last:{...query,revision:draft.revision,view:'notes',after:null}})
  }
  const selected=constructionViewItems(draft,query.view,query.ids)
  return page({...query,revision:draft.revision},{...header,missing_ids:selected.missing_ids,selection:query.ids,
   dependency_scope:query.view==='dependencies'?'parameter ancestors/dependents, bound parts and directly attached joints; newly reached neighboring parts may have further dependencies':'selected view; use dependencies for formulas, sources and affected parts',
   open_question_count:arr(draft.open_questions).length,notes_view:'notes'},selected.items,budget)
 }
 return {read,observe,importObservation,observation:(id:string)=>structuredClone(seen.get(id)),exportState:()=>structuredClone(observations),restoreState:restore}
}
