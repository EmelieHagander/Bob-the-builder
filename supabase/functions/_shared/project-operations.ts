import type { WritePayload } from './project-write.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'

const nullable={type:['string','null']}
const tool=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function' as const,function:{name,description,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}}})
const common={record_id:nullable,expected_revision:{type:'integer',minimum:0},expected_updated_at:nullable,request_quote:{type:'string'}}
export const OPERATION_WRITE_TOOLS=[
  tool('derive_cad_material_requirement','Create/revise a deterministic material requirement from one definition in the current saved CAD drawing. Quantity comes from the saved recipe and instance count. Preserve the existing requirement identity when updating it. Use pieces, length_x/y/z or area_xy/xz/yz (box blank dimensions); tube/cylinder length is length_z. Holes/notches do not reduce purchased blank quantity. Check actual stock/reuse specification and fit before allocation. Publish via manage_project_material separately.',{
    ...common,data:{type:'object',additionalProperties:true,description:'name, category, area_id, task_id, waste_percent, purchase_increment, assumptions, artifact_id, artifact_revision, target_revision, definition_id, quantity_mode, stock_allocations:[{id,revision,quantity}], component_allocations:[{id,revision,quantity}], change_note. No quantity, unit, method or basis input: these are server-derived. New record_id=null/revision=0; revise exact requirement UUID/current revision. expected_updated_at=null.'},
  }),
  tool('manage_task_readiness','Record real task dependencies, tool/information needs or a readiness review. Read task_work first. Dependency checkpoint IDs refer to Task instructions, not Plan Steps. A need becomes ready only from actual evidence; adding a need starts it unresolved.',{
    ...common,task_id:{type:'string'},action:{type:'string',enum:['add_dependency','remove_dependency','add_need','revise_need','set_need_ready','remove_need','confirm_readiness']},
    data:{type:'object',description:'add_dependency: prerequisite_task_id, prerequisite_step_id (null or instruction UUID), note. add_need: kind (tool|information), label, notes. revise_need: label, notes, ready. set_need_ready: ready. confirm_readiness: note. Remove: {}. record_id=null for adds/review; exact dependency/need UUID for edits. expected_revision=0 for adds/dependencies/review, current need revision for edits. expected_updated_at=null.',additionalProperties:true},
  }),
  tool('manage_project_material','Create/revise/archive/restore stock or a material requirement, or publish a current requirement to Shopping. Uses the existing material arithmetic, allocations, version checks and explicit Shopping handoff. Read resources first. Never report purchase or delivery from a planned Shopping entry.',{
    ...common,resource:{type:'string',enum:['stock','requirement']},action:{type:'string',enum:['create','revise','archive','restore','publish']},
    data:{type:'object',additionalProperties:true,description:'stock create/revise: name, specification, quantity(decimal string), unit(pcs|m|m2|m3|kg|l), status(available|inspect|unavailable), area_id, notes, change_note. requirement create/revise: name, category, area_id, task_id, unit, required_quantity, waste_percent, purchase_increment, basis, assumptions, artifact_id, artifact_revision, target_revision, stock_allocations:[{id,revision,quantity}], component_allocations:[{id,revision,quantity}], change_note. These are full revisions: preserve existing allocations and fields. Other actions: {}. New record_id=null, expected_revision=0; otherwise exact UUID/current revision. expected_updated_at=null. Quantities supplied here have manual basis, never forged deterministic provenance.'},
  }),
  tool('save_project_build_day','Create/revise a build day and its explicit scheduled Tasks. Does not change anyone\'s RSVP or imply completed work. Read the existing event and preserve its task list when editing. Task IDs must belong to this project.',{
    ...common,title:{type:'string'},day:{type:'string'},time:{type:'string'},place:{type:'string'},food:{type:'string'},task_ids:{type:'array',maxItems:100,uniqueItems:true,items:{type:'string'}},
  }),
]
export const READ_OPERATIONS_TOOL=tool('read_project_work','Read current task readiness/dependencies/needs, stock, material requirements with allocations, Shopping, or build days with scheduled tasks. Project scope is bound by the server. Follow next_cursor; exact record_id reads detail.',{
  resource:{type:'string',enum:['task_work','stock','requirement','shopping','build_day']},record_id:nullable,after_id:nullable,
})
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const text=(v:unknown,n=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=n
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
export function parseOperationalWrite(name:string,v:Record<string,any>):WritePayload|null{
  if(!Number.isSafeInteger(v.expected_revision)||v.expected_revision<0||v.expected_revision>1e8)return null
  if(v.record_id!==null&&!text(v.record_id))return null
  const base:WritePayload={kind:'operational',record_id:v.record_id,expected_revision:v.expected_revision,expected_updated_at:v.expected_updated_at,request_quote:v.request_quote,data:{}}
  if(name==='save_project_build_day'){
    if(v.expected_revision!==0||!text(v.title,200)||![v.day,v.time,v.place,v.food].every(x=>typeof x==='string'&&x.length<=1000)
      ||!Array.isArray(v.task_ids)||v.task_ids.length>100||new Set(v.task_ids).size!==v.task_ids.length||v.task_ids.some((x:unknown)=>!text(x))
      ||(v.record_id===null?v.expected_updated_at!==null:typeof v.expected_updated_at!=='string'||!Number.isFinite(Date.parse(v.expected_updated_at))))return null
    base.data={resource:'build_day',action:v.record_id===null?'create':'revise',fields:Object.fromEntries(['title','day','time','place','food','task_ids'].map(k=>[k,v[k]]))}
  }else{
    if(v.expected_updated_at!==null||!object(v.data)||JSON.stringify(v.data).length>24000||v.record_id!==null&&!uuid(v.record_id))return null
    if(name==='derive_cad_material_requirement'){
      if(v.record_id===null?v.expected_revision!==0:v.expected_revision<1)return null
      base.data={resource:'cad_requirement',action:v.record_id===null?'create':'revise',fields:v.data}
    }else if(name==='manage_task_readiness'){
      if(!text(v.task_id)||!['add_dependency','remove_dependency','add_need','revise_need','set_need_ready','remove_need','confirm_readiness'].includes(v.action))return null
      const create=['add_dependency','add_need','confirm_readiness'].includes(v.action)
      if(create&&(v.record_id!==null||v.expected_revision!==0)||!create&&v.record_id===null)return null
      base.data={resource:'task_work',action:v.action,task_id:v.task_id,fields:v.data}
    }else if(name==='manage_project_material'){
      if(!['stock','requirement'].includes(v.resource)||!['create','revise','archive','restore','publish'].includes(v.action)||v.resource==='stock'&&v.action==='publish')return null
      if(v.action==='create'?(v.record_id!==null||v.expected_revision!==0):(v.record_id===null||v.expected_revision<1))return null
      base.data={resource:v.resource,action:v.action,fields:v.data}
    }else return null
  }
  return base
}
export function createOperationalReader(projectId:string,read:(v:Record<string,unknown>)=>Promise<{data:any;error:any}>,hasAccess:()=>Promise<boolean>,sources:ProjectSource[]){
  let used=0,partial=false
  return{tools:[READ_OPERATIONS_TOOL],get remaining(){return Math.max(0,16-used)},get partial(){return partial},async execute(v:unknown){
    if(++used>16)return{status:'budget_exhausted'}
    if(!object(v)||Object.keys(v).sort().join(',')!=='after_id,record_id,resource'||!['task_work','stock','requirement','shopping','build_day'].includes(v.resource)
      ||[v.record_id,v.after_id].some(x=>x!==null&&!text(x)))return{status:'invalid'}
    if(!await hasAccess())return{status:'denied'}
    try{
      const {data,error}=await read(v)
      if(error||!data||data.projectId!==projectId||!Array.isArray(data.records))throw new Error('unavailable')
      if(!await hasAccess())return{status:'denied'}
      for(const r of data.records)if(r.id&&!sources.some(s=>s.dataset===v.resource&&s.recordId===r.id))sources.push({projectId,dataset:v.resource,recordId:r.id,label:r.name??r.title??r.task_name??r.id,updatedAt:r.updated_at??r.recorded_at??null,retrievedAt:new Date().toISOString(),truth:'unknown'})
      partial ||= !!data.truncated
      return{status:data.records.length?'ok':'empty',...data}
    }catch(error){rethrowContinuation(error);partial=true;return{status:'unavailable'}}
  }}
}
export type OperationalReader=ReturnType<typeof createOperationalReader>
