import type { WritePayload, WriteValidationIssue } from './project-write.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'

const nullable={type:['string','null']}
const tool=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function' as const,function:{name,description,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}}})
const common={record_id:nullable,expected_revision:{type:'integer',minimum:0},expected_updated_at:nullable,request_quote:{type:'string'}}
export const OPERATION_WRITE_TOOLS=[
  tool('derive_cad_material_requirement','Create/revise a deterministic material requirement from one definition in a current saved CAD drawing or construction checkpoint. Quantity comes from the saved recipe and instance count. Preserve the existing requirement identity when updating it. Use pieces, length_x/y/z or area_xy/xz/yz (box blank dimensions); tube/cylinder length is length_z. Holes/notches do not reduce purchased blank quantity. Check actual stock/reuse specification and fit before allocation. Construction blank needs are concept quantities: stock/reuse allocation and Shopping are blocked until raw-stock fit is supported. CAD requirements retain the existing separate publish path.',{
    ...common,data:{type:'object',additionalProperties:true,description:'name, category, area_id, task_id, waste_percent, purchase_increment, assumptions, artifact_id (drawing or construction), artifact_revision, target_revision, definition_id, quantity_mode, stock_allocations:[{id,revision,quantity}], component_allocations:[{id,revision,quantity}], change_note. No quantity, unit, method or basis input: these are server-derived. New record_id=null/revision=0; revise exact requirement UUID/current revision. expected_updated_at=null.'},
  }),
  tool('manage_task_readiness','Record real task dependencies, tool/information needs or a readiness review. Read task_work first. Dependency checkpoint IDs refer to Task instructions, not Plan Steps. A need becomes ready only from actual evidence; adding a need starts it unresolved.',{
    ...common,task_id:{type:'string'},action:{type:'string',enum:['add_dependency','remove_dependency','add_need','revise_need','set_need_ready','remove_need','confirm_readiness']},
    data:{type:'object',description:'add_dependency: prerequisite_task_id, prerequisite_step_id (null or instruction UUID), note. add_need: kind (tool|information), label, notes. revise_need: label, notes, ready. set_need_ready: ready. confirm_readiness: note. Remove: {}. record_id=null for adds/review; exact dependency/need UUID for edits. expected_revision=0 for adds/dependencies/review, current need revision for edits. expected_updated_at=null.',additionalProperties:true},
  }),
  tool('manage_project_material','Manage stock or material requirements, reserve/release whole sheets for an exact saved cut plan, or publish catalog-bound cut plans and supported ordinary requirements to Shopping. Uses the existing material arithmetic, allocations, version checks and explicit Shopping handoff. Read resources first. Record versioned supplier products (resource=product) and publish whole-pack purchases aggregated from exact needs (resource=pack_purchase). Never report purchase or delivery from a planned Shopping entry.',{
    ...common,resource:{type:'string',enum:['stock','requirement','cut_plan','product','pack_purchase']},action:{type:'string',enum:['create','revise','archive','restore','publish','withdraw','reserve','release']},
    data:{type:'object',additionalProperties:true,description:'stock create/revise: name, specification, quantity(decimal string), unit(pcs|m|m2|m3|kg|l), status(available|inspect|unavailable), area_id, notes, change_note, optional sheet_format:{material_id,material_revision,length_mm,width_mm,thickness_mm,grain(length|width|none),basis(measured|provided_spec|estimated),note}. Sheet stock uses whole pcs; omitted format preserves an existing one on revise, explicit null clears it. Never invent physical stock/inspection. requirement create/revise: name, category, area_id, task_id, unit, required_quantity, waste_percent, purchase_increment, basis, assumptions, artifact_id, artifact_revision, target_revision, stock_allocations:[{id,revision,quantity}], component_allocations:[{id,revision,quantity}], change_note. These are full revisions: preserve existing allocations and fields. cut_plan reserve/release: {reservation_revision(integer >=0),change_note}; read the same current plan first, use exact plan UUID/current expected_revision. Reserve only the actually used stock-bound sheets; catalog-bound used sheets are handled by publish. The server derives used whole-sheet quantities and aggregates aliases; no client quantity/stock allocation fields. Explicit release frees the reservation even after source changes. cut_plan publish/withdraw: {shopping_revision(integer >=0),change_note}; exact plan UUID/current expected_revision. Publish only the actually used catalog-bound sheets; stock-bound used sheets are handled by reserve. Actual used whole sheets aggregate by exact part revision/grain; every used sheet must bind current stock or catalog_part, with at least one sheet of the requested kind; used hypothetical sheets are rejected. Mixed plans keep independent reservation and Shopping revisions. Either operation may run first; after partial success reopen supply and retry only the missing operation. Release/withdraw affects only its own portion. A catalog format is not a verified supplier product or pack. Read plan.supply and Shopping after publishing; commitments_current requires both portions for mixed plans and is not fabrication approval. Withdraw before revising a published plan; edited, deleted or ordered/delivered rows block quantity changes. Construction blank requirements still cannot publish individually. Other actions: {}. New record_id=null, expected_revision=0; otherwise exact UUID/current revision. expected_updated_at=null. Quantities supplied here have manual basis, never forged deterministic provenance. product create/revise: {catalog_item_id,catalog_item_revision,title,supplier,manufacturer,article_number,variant,source_url|null,source_document,source_version,source_date(YYYY-MM-DD|null),supported_fields[],purchase_unit(pack|box|bag|pcs|sheet|roll|bucket|length),content_per_purchase_unit(decimal string|null),content_unit(pcs|m|m2|m3|kg|l),notes,change_note}; withdraw: {change_note}. Only fields the cited source states: an unstated text field is "", an unstated source_url/source_date/pack size is null. article_number is required and must be one the source shows for the chosen variant. pack_purchase publish/withdraw: record_id=article UUID, expected_revision=article revision, data {purchase_revision,needs:[{id,revision}],change_note}; withdraw uses needs []. The server derives pack count and surplus.'},
  }),
  tool('save_project_build_day','Create/revise a build day and its explicit scheduled Tasks. Does not change anyone\'s RSVP or imply completed work. Read the existing event and preserve its task list when editing. Task IDs must belong to this project.',{
    ...common,title:{type:'string'},day:{type:'string'},time:{type:'string'},place:{type:'string'},food:{type:'string'},task_ids:{type:'array',maxItems:100,uniqueItems:true,items:{type:'string'}},
  }),
]
export const READ_OPERATIONS_TOOL=tool('read_project_work','Read current task readiness/dependencies/needs, stock, material requirements with allocations, saved cut plans with current source/capacity checks, supplier products, pack purchases, Shopping, or build days with scheduled tasks. Project scope is bound by the server. Follow next_cursor; exact record_id reads detail.',{
  resource:{type:'string',enum:['task_work','stock','requirement','cut_plan','product','pack_purchase','shopping','build_day']},record_id:nullable,after_id:nullable,
})
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const text=(v:unknown,n=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=n
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const ARTICLE_TEXT=['manufacturer','variant','source_document','source_version','notes','supplier']
const ARTICLE_KEYS=['catalog_item_id','catalog_item_revision','title','supplier','manufacturer','article_number','variant','source_url','source_document','source_version','source_date','supported_fields','purchase_unit','content_per_purchase_unit','content_unit','notes','change_note']
type ArticleIssue=Pick<WriteValidationIssue,'fields'|'message'>
/** The SQL contract wants all 17 keys with strings for unstated text. "Only
 * fields the source states" makes a model omit or null them instead, so an
 * unstated text field becomes '' and an unstated URL/date/pack size null. Every
 * other rule is checked here with the exact field, never guessed or filled in. */
export function supplierArticleFields(action:string,d:Record<string,any>):{fields:Record<string,unknown>}|{issue:ArticleIssue}{
  const bad=(fields:string[],message:string)=>({issue:{fields:fields.map(f=>'data.'+f),message}})
  if(action==='withdraw')return Object.keys(d).join(',')==='change_note'&&text(d.change_note,1000)?{fields:{change_note:d.change_note}}:bad(['change_note'],'Withdraw takes only data.change_note.')
  const extra=Object.keys(d).filter(k=>!ARTICLE_KEYS.includes(k))
  if(extra.length)return bad(extra,'Remove fields the product schema does not have.')
  const f:Record<string,any>={...d}
  for(const k of ARTICLE_TEXT)if(f[k]===undefined||f[k]===null)f[k]=''
  for(const k of ['source_url','source_date','content_per_purchase_unit'])if(f[k]===undefined||f[k]==='')f[k]=null
  if(typeof f.content_per_purchase_unit==='number'&&Number.isFinite(f.content_per_purchase_unit))f.content_per_purchase_unit=String(f.content_per_purchase_unit)
  if(f.supported_fields===undefined)f.supported_fields=[]
  if(!uuid(f.catalog_item_id)||!Number.isSafeInteger(f.catalog_item_revision)||f.catalog_item_revision<1)return bad(['catalog_item_id','catalog_item_revision'],'Bind the exact catalog item UUID and its integer revision, read or saved earlier in this turn.')
  for(const k of ['title','article_number','change_note'])if(!text(f[k],k==='change_note'?1000:k==='title'?200:120))return bad([k],k==='article_number'?'An article number is required and must be the one the source shows. If the chosen variant shows none, choose a variant whose article number the source states, or keep the product unsaved and say why.':`${k} is required text.`)
  const wrong=ARTICLE_TEXT.filter(k=>typeof f[k]!=='string')
  if(wrong.length)return bad(wrong,'These fields are text; use "" when the source does not state them.')
  if(!f.supplier.trim()&&!f.manufacturer.trim())return bad(['supplier','manufacturer'],'Give the supplier or the manufacturer the source names.')
  if(f.source_url!==null&&(typeof f.source_url!=='string'||f.source_url.length>2000||!/^https?:\/\/\S+$/.test(f.source_url)))return bad(['source_url'],'source_url must be the http(s) address of the cited source, or null.')
  if(f.source_url===null&&!f.source_document.trim())return bad(['source_url','source_document'],'Cite the source: a URL or a named source document.')
  if(f.source_date!==null&&(typeof f.source_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(f.source_date)))return bad(['source_date'],'source_date is YYYY-MM-DD or null.')
  if(!['pack','box','bag','pcs','sheet','roll','bucket','length'].includes(f.purchase_unit))return bad(['purchase_unit'],'purchase_unit is one of pack|box|bag|pcs|sheet|roll|bucket|length.')
  if(!['pcs','m','m2','m3','kg','l'].includes(f.content_unit))return bad(['content_unit'],'content_unit is one of pcs|m|m2|m3|kg|l.')
  if(!Array.isArray(f.supported_fields)||f.supported_fields.length>10||f.supported_fields.some((x:unknown)=>typeof x!=='string'||!ARTICLE_KEYS.includes(x)))return bad(['supported_fields'],'supported_fields lists up to 10 product field names the source states.')
  const c=f.content_per_purchase_unit
  if(c!==null&&(typeof c!=='string'||!/^\d{1,10}(\.\d{1,4})?$/.test(c)||Number(c)<=0))return bad(['content_per_purchase_unit'],'content_per_purchase_unit is a positive decimal string, or null when the source states no pack size.')
  if(c!==null&&!(f.supported_fields.includes('content_per_purchase_unit')&&f.supported_fields.includes('purchase_unit')))return bad(['supported_fields'],'A pack size counts only when the source states it: list both content_per_purchase_unit and purchase_unit in supported_fields, or set the pack size to null.')
  if(c!==null&&f.content_unit==='pcs'&&!/^\d+(\.0+)?$/.test(c))return bad(['content_per_purchase_unit'],'Piece content must be whole pieces.')
  return{fields:Object.fromEntries(ARTICLE_KEYS.map(k=>[k,f[k]]))}
}
export function parseOperationalWrite(name:string,v:Record<string,any>,report?:(issue:WriteValidationIssue)=>void):WritePayload|null{
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
      if(v.resource==='product'){
        if(!['create','revise','withdraw'].includes(v.action)||(v.action==='create'?(v.record_id!==null||v.expected_revision!==0):(!uuid(v.record_id)||v.expected_revision<1)))return null
        const checked=supplierArticleFields(v.action,v.data)
        if('issue' in checked){report?.({code:'domain_fields',...checked.issue});return null}
        return{...base,kind:'supplier_article',data:{action:v.action,fields:checked.fields}}
      }
      if(v.resource==='pack_purchase'){
        if(!['publish','withdraw'].includes(v.action)||!uuid(v.record_id)||v.expected_revision<1||Object.keys(v.data).sort().join(',')!=='change_note,needs,purchase_revision'
          ||!Number.isSafeInteger(v.data.purchase_revision)||v.data.purchase_revision<0||v.data.purchase_revision>1e8||!text(v.data.change_note,1000)
          ||!Array.isArray(v.data.needs)||v.data.needs.length>24||(v.action==='withdraw'&&v.data.needs.length>0)
          ||v.data.needs.some((n:unknown)=>!object(n)||Object.keys(n).sort().join(',')!=='id,revision'||!uuid(n.id)||!Number.isSafeInteger(n.revision)||n.revision<1))return null
        return{...base,kind:'pack_purchase',data:{action:v.action,purchase_revision:v.data.purchase_revision,needs:v.data.needs,change_note:v.data.change_note}}
      }
      if(v.resource==='cut_plan'){
        if(['publish','withdraw'].includes(v.action)){
          if(!uuid(v.record_id)||v.expected_revision<1||Object.keys(v.data).sort().join(',')!=='change_note,shopping_revision'
            ||!Number.isSafeInteger(v.data.shopping_revision)||v.data.shopping_revision<0||v.data.shopping_revision>1e8||!text(v.data.change_note,1000))return null
          return{...base,kind:'cut_plan_shopping',data:{action:v.action,shopping_revision:v.data.shopping_revision,change_note:v.data.change_note}}
        }
        if(!['reserve','release'].includes(v.action)||v.record_id===null||v.expected_revision<1
          ||Object.keys(v.data).sort().join(',')!=='change_note,reservation_revision'||!Number.isSafeInteger(v.data.reservation_revision)
          ||v.data.reservation_revision<0||v.data.reservation_revision>1e8||!text(v.data.change_note,1000))return null
        return{...base,kind:'cut_plan_stock',data:{action:v.action,reservation_revision:v.data.reservation_revision,change_note:v.data.change_note}}
      }
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
    if(!object(v)||Object.keys(v).sort().join(',')!=='after_id,record_id,resource'||!['task_work','stock','requirement','cut_plan','product','pack_purchase','shopping','build_day'].includes(v.resource)
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
