import type {ToolSpec} from './project-tools/session.ts'
import type {ConstructionRef} from './drawing-work.ts'
import {fingerprint,rethrowContinuation} from './bob-job-journal.ts'

export type OperationRole='structure'|'materials'|'drawing'
type Kind='construction'|'drawing'|'shell'|'request'|'step'|'task'|'gap'|'requirement'|'plan_requirement'|'cut_plan'|'stock'|'product'
export type OperationEntry={ref:string;kind:Kind;id:string;revision:number;label:string;parent?:string;area_id?:string|null;target_revision?:number;component_id?:string|null;definition_id?:string;quantity_mode?:string}
/** stable (owner decision 2026-11-07, stable_tools_version 1): a reference field
 * has the same schema all job long; the server checks the value. Before, its
 * enum of current refs changed whenever a read or save added one, and every
 * such change made Claude read the whole input again uncached. */
export type OperationSurface={version:1;role:OperationRole;source:boolean;flexible?:boolean;stable?:boolean;explicitSave?:boolean;bindings?:OperationBindings;refs:Partial<Record<Kind,string[]>>}
export type OperationBindings=Record<string,{source?:{id:string;revision:string;ref:string;readOnly:boolean};schema:{path:string[];hide:string[];description?:string;refs:{field:string;kind:Kind;nullable:boolean;id?:string;revision?:string;when?:string;kinds?:Kind[]}[];role?:OperationRole}[]}>
type Scope={role:OperationRole;source:ConstructionRef|null;entries:OperationEntry[];completed:{source:string;key?:string;result:Record<string,any>}[];active?:{source:string;key:string};area_id:string|null}
export type WorkerOperationsState={version:1;projectId:string;scopes:Scope[]}
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const kinds:Kind[]=['construction','drawing','shell','request','step','task','gap','requirement','plan_requirement','cut_plan','stock','product']
const sourceTools=new Set(['read_construction_draft','read_construction_delivery','check_construction_draft','derive_construction_lists','check_construction_cut_fit','save_construction_cut_plan','read_construction_changes','continue_construction_change'])
const readSourceTools=new Set(['read_construction_draft','read_construction_delivery','check_construction_draft','derive_construction_lists','check_construction_cut_fit','read_construction_changes'])
const editTools=new Set(['save_construction_draft','edit_construction_parts','change_construction_parameters','change_construction_roles'])
function properties(node:any):any{return node?.properties??{}}
function hide(node:any,...fields:string[]){for(const f of fields)delete properties(node)[f];if(Array.isArray(node?.required))node.required=node.required.filter((f:string)=>!fields.includes(f))}
export const OPERATION_REF_PATTERN='^op_[0-9a-f]{32}$'
function refField(node:any,field:string,kind:Kind,s:OperationSurface,nullable=false){
 const values=kind==='drawing'?[...(s.refs.drawing??[]),...(s.refs.shell??[])]:s.refs[kind]??[]
 if(s.stable){
  properties(node)[field]={type:nullable?['string','null']:'string',pattern:OPERATION_REF_PATTERN,description:`Server-issued ${kind} reference from operation_context or returned operation_refs.`}
  if(Array.isArray(node.required)&&!node.required.includes(field))node.required.push(field)
  return
 }
 properties(node)[field]={...(nullable?{type:['string','null'],enum:[...values,null]}:values.length?{type:'string',enum:values}:{type:'string',pattern:'^unavailable_operation_reference$'}),description:`Server-issued ${kind} reference from operation_context or returned operation_refs.`}
 if(Array.isArray(node.required)&&!node.required.includes(field))node.required.push(field)
}
function pair(node:any,id:string,rev:string|undefined,ref:string,kind:Kind,s:OperationSurface,nullable=false){
 if(!Object.hasOwn(properties(node),id))return
 hide(node,id,...(rev?[rev]:[]));refField(node,ref,kind,s,nullable)
}
/** Changing entity identity requires a returned server selection. The pinned
 * construction source is omitted completely for Konrad/Mattias. */
/** Owner decision 2026-11-08 (with lean writing): a save names its target. The
 * construction's reference revises it whole; null saves a new construction,
 * also in a job bound to another (a second new construction once overwrote
 * the first). One text for bound and unbound jobs keeps the schema stable. */
export const EXPLICIT_SAVE_TARGET_TEXT='The construction this save revises whole: its reference from operation_context or operation_refs. null saves a new construction; a job working on another construction stays on that one.'
export function workerOperationSpec(spec:ToolSpec,s:OperationSurface):ToolSpec{
 const out=operationSpec(spec,s)
 if(s.explicitSave&&s.role==='structure'&&out.function.name==='save_construction_draft'){
  const p=out.function.parameters as any
  if(!Object.hasOwn(properties(p),'source_ref'))refField(p,'source_ref','construction',s,true)
  properties(p).source_ref.description=EXPLICIT_SAVE_TARGET_TEXT
 }
 return out
}
function operationSpec(spec:ToolSpec,s:OperationSurface):ToolSpec{
 if(s.version!==1||!['structure','materials','drawing'].includes(s.role))throw Error('worker_operation_surface_invalid')
 const out=structuredClone(spec),p=out.function.parameters as any,n=out.function.name
 if(s.bindings){
  const allowed=(when?:string)=>!when||when==='unbound'&&!s.source||when==='drawingOrUnbound'&&(s.role==='drawing'||!s.source)||when==='readable'
  for(const op of s.bindings[n]?.schema??[]){
   if(op.role&&op.role!==s.role)continue
   const node=op.path.reduce((o:any,k)=>o?.[k],p);if(!node)continue
   if(op.description!==undefined)node.description=op.description
   hide(node,...op.hide)
   for(const r of op.refs){
    // Stable: the field is always offered; where it does not apply now
    // (a bound job), null is accepted and the server keeps its own choice.
    if(s.stable?r.id&&!Object.hasOwn(properties(node),r.id):!allowed(r.when)||r.id&&!Object.hasOwn(properties(node),r.id))continue
    if(r.id)hide(node,r.id,...(r.revision?[r.revision]:[]))
    refField(node,r.field,r.kind,s,r.nullable||!!s.stable&&r.when!==undefined&&r.when!=='readable')
    if(r.kinds&&!s.stable)properties(node)[r.field].enum=[...r.kinds.flatMap(k=>s.refs[k]??[]),...(r.nullable?[null]:[])]
   }
  }
  return out
 }
 if(sourceTools.has(n)){
  hide(p,'artifact_id','revision')
  if(s.role==='drawing'||!s.source||s.flexible&&readSourceTools.has(n))refField(p,'source_ref','construction',s,true)
 }
 if(editTools.has(n)&&s.role==='structure'){hide(p,'record_id','expected_revision');if(!s.source)refField(p,'source_ref','construction',s,true)}
 if(n==='transition_legacy_drawing')pair(p,'record_id','expected_revision','drawing_ref','drawing',s)
 if(n==='derive_cad_material_requirement'){
  if(!s.source)refField(p,'source_ref','construction',s)
  pair(p,'record_id','expected_revision','record_ref','requirement',s,true)
  const d=properties(p).data;if(d)d.description=String(d.description??'')+' Construction source and target revision are supplied by the job; omit artifact_id, artifact_revision and target_revision.'
 }
 if(n==='save_construction_cut_plan'){
  pair(p,'record_id','expected_revision','record_ref','cut_plan',s,true)
  const item=properties(p).requirements?.items;if(item)pair(item,'id','revision','requirement_ref','requirement',s)
 }
 if(n==='manage_project_material'){
  hide(p,'record_id','expected_revision','expected_updated_at')
  refField(p,'record_ref','requirement',s,true)
  if(!s.stable)properties(p).record_ref.enum=[...['stock','requirement','cut_plan','product'].flatMap(k=>s.refs[k as Kind]??[]),null]
 }
 if(n==='design_project_cad'){
  hide(p,'request_id','artifact_id','construction_revision','area_id','component_id','step_id');refField(p,'source_ref','construction',s);refField(p,'drawing_ref','drawing',s,true);if(!s.stable)properties(p).drawing_ref.enum=[...(s.refs.drawing??[]),null]
  out.function.description='Draw the exact saved construction selected by source_ref from operation_context. Code supplies the saved destination and request; choose the views and drawing intent. Save a ready candidate with save_cad_design.'
 }
 if(n==='plan_cad_pieces'){
  hide(p,'area_id')
  const item=properties(p).pieces?.items
  if(item){hide(item,'artifact_id','construction_revision','component_id');refField(item,'source_ref','construction',s)}
 }
 if(n==='compose_cad_shell'){
  pair(p,'record_id','expected_revision','shell_ref','shell',s,true);hide(p,'area_id')
  for(const node of [properties(p).components?.items,properties(p).component])if(node)pair(node,'child_artifact_id','child_revision','drawing_ref','drawing',s)
 }
 if(n==='read_cad_shell')pair(p,'shell_id','revision','shell_ref','shell',s)
 if(n==='link_cad_shell_steps'){
  pair(p,'shell_id','expected_revision','shell_ref','shell',s)
  const item=properties(p).links?.items;if(item)pair(item,'step_id',undefined,'step_ref','step',s)
 }
 if(n==='link_project_drawing'){
  pair(p,'record_id','expected_revision','drawing_ref','drawing',s);pair(p,'step_id',undefined,'step_ref','step',s)
 }
 if(['read_drawing_requests','read_drawing_request_work','link_drawing_gap','ensure_drawing_gap_task'].includes(n)){
  pair(p,'request_id',Object.hasOwn(properties(p),'expected_revision')?'expected_revision':undefined,'request_ref','request',s,n==='read_drawing_requests')
  pair(p,'gap_id',undefined,'gap_ref','gap',s);pair(p,'task_id',undefined,'task_ref','task',s,true);pair(p,'step_id',undefined,'step_ref','step',s,true)
  if(n==='ensure_drawing_gap_task'){pair(p,'requirement_id','plan_revision','requirement_ref','plan_requirement',s)}
 }
 return out
}

export function createWorkerOperations(opts:{version?:1|2;bindings?:OperationBindings;projectId:string;hasAccess:()=>Promise<boolean>;
 /** Pinned per job (stable_tools_version 1): reference fields keep one schema. */
 stableRefs?:boolean;
 /** Pinned with joint_rule_store_version 1: a save names its target (see EXPLICIT_SAVE_TARGET_TEXT). */
 explicitSaveTarget?:boolean;
 load:(role:OperationRole,sources:ConstructionRef[],focus?:ConstructionRef)=>Promise<{status:string;source:ConstructionRef|null;entries:Omit<OperationEntry,'ref'>[];area_id?:string|null;reason?:string}>;
 validateMany?:(entries:OperationEntry[])=>Promise<boolean>;
 prepareDrawing:(source:ConstructionRef,focus?:ConstructionRef)=>Promise<Record<string,any>>;
 drawingArguments:(raw:unknown)=>Record<string,unknown>|null;
 drawingWork:()=>{construction:ConstructionRef;request_id:string|null}|undefined;
}){
 const scopes=new Map<OperationRole,Scope>()
 const put=async(scope:Scope,value:Omit<OperationEntry,'ref'>)=>{
  if(!kinds.includes(value.kind)||typeof value.id!=='string'||!value.id||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('worker_operation_entry_invalid')
  const ref='op_'+(await fingerprint({projectId:opts.projectId,kind:value.kind,id:value.id,revision:value.revision,parent:value.parent??null})).slice(0,32)
  const entry={...value,label:String(value.label??value.kind).slice(0,200),ref}
  scope.entries=scope.entries.filter(e=>e.kind!==value.kind||e.id!==value.id||e.revision===value.revision)
  if(!scope.entries.some(e=>e.ref===ref))scope.entries.push(entry)
  return entry
 }
 const get=(role:OperationRole)=>{const s=scopes.get(role);if(!s)throw Error('worker_operation_not_prepared');return s}
 const selection=(scope:Scope,ref:unknown,kind:Kind)=>scope.entries.find(e=>e.ref===ref&&(e.kind===kind||kind==='drawing'&&e.kind==='shell'))
 const source=(scope:Scope,ref:unknown)=>selection(scope,ref,'construction')
 return {
 exportState():WorkerOperationsState{return structuredClone({version:1,projectId:opts.projectId,scopes:[...scopes.values()]})},
 restoreState(state:WorkerOperationsState){
  if(state?.version!==1||state.projectId!==opts.projectId||!Array.isArray(state.scopes))throw Error('worker_operations_checkpoint_invalid')
  for(const s of state.scopes)if(!['structure','materials','drawing'].includes(s.role)||!Array.isArray(s.entries)||!Array.isArray(s.completed)
   ||s.source!==null&&(!object(s.source)||typeof s.source.artifact_id!=='string'||!Number.isSafeInteger(s.source.revision))
   ||s.entries.some(e=>!object(e)||!/^op_[0-9a-f]{32}$/.test(e.ref)||!kinds.includes(e.kind)||typeof e.id!=='string'||!Number.isSafeInteger(e.revision)||e.revision<0))throw Error('worker_operations_checkpoint_invalid')
  if(new Set(state.scopes.map(s=>s.role)).size!==state.scopes.length||state.scopes.some(s=>
   new Set(s.entries.map(e=>e.ref)).size!==s.entries.length||s.source&&!s.entries.some(e=>e.kind==='construction'&&e.id===s.source!.artifact_id&&e.revision===s.source!.revision)
   ||s.completed.some(c=>!object(c)||!s.entries.some(e=>e.kind==='construction'&&e.ref===c.source)||!object(c.result)||c.result.receipt?.projectId!==opts.projectId||c.key!==undefined&&!/^[0-9a-f]{64}$/.test(c.key))))throw Error('worker_operations_checkpoint_invalid')
  if(state.scopes.some(s=>s.active&&(!/^op_[0-9a-f]{32}$/.test(s.active.source)||!s.entries.some(e=>e.kind==='construction'&&e.ref===s.active!.source)||!/^[0-9a-f]{64}$/.test(s.active.key))))throw Error('worker_operations_checkpoint_invalid')
  scopes.clear();for(const s of structuredClone(state.scopes))scopes.set(s.role,s)
 },
 async prepare(role:OperationRole,sources:ConstructionRef[],focus?:ConstructionRef){
  if(!await opts.hasAccess())throw Error('project_denied')
  const read=await opts.load(role,sources,focus)
  if(!await opts.hasAccess())throw Error('project_denied')
  if(read.status!=='ready')return {status:read.status,reason:read.reason??'worker_operation_unavailable',saved:false}
  const scope:Scope={role,source:read.source,entries:[],completed:[],area_id:read.area_id??null}
  for(const e of read.entries)await put(scope,e)
  scopes.set(role,scope)
  return {status:'ready'}
 },
 surface(role:OperationRole):OperationSurface{const s=get(role);return {version:1,role,source:!!s.source,flexible:opts.version!==1,...(opts.version!==1&&opts.bindings?{bindings:opts.bindings}:{}),...(opts.stableRefs?{stable:true}:{}),...(opts.explicitSaveTarget?{explicitSave:true}:{}),refs:Object.fromEntries(kinds.map(kind=>[kind,s.entries.filter(e=>e.kind===kind).map(e=>e.ref)]))}},
 describe(role:OperationRole){const s=get(role);return {projectId:opts.projectId,source:s.source?{ref:s.entries.find(e=>e.kind==='construction'&&e.id===s.source!.artifact_id&&e.revision===s.source!.revision)?.ref}:null,
  selections:s.entries.map(({ref,kind,label})=>({ref,kind,label}))}},
 /** The construction a structure job can only mean: its bound source, else the
  * only construction in scope. Null when the job could mean several. */
 startRef(role:OperationRole):string|null{const s=get(role)
  const bound=s.source&&s.entries.find(e=>e.kind==='construction'&&e.id===s.source!.artifact_id&&e.revision===s.source!.revision)
  if(bound)return bound.ref
  const all=s.entries.filter(e=>e.kind==='construction');return all.length===1?all[0].ref:null
 },
 /** Initial catalog knowledge reads are server-originated; discard their old
  * routing placeholders before passing the same native handler fence. */
 knowledgeArgs(role:OperationRole,name:string,raw:Record<string,unknown>){const args=structuredClone(raw),s=get(role)
  if(sourceTools.has(name)){delete args.artifact_id;delete args.revision;if(role==='drawing'||!s.source)args.source_ref=null}
  if(name==='read_drawing_requests'){delete args.request_id;args.request_ref=null}
  return args
 },
 /** Trusted automatic checks still select the exact saved receipt, then enter
  * the same handler/reference fence; they cannot silently check another source. */
 serverArgs(role:OperationRole,name:string,raw:Record<string,unknown>){
  const args=structuredClone(raw),s=get(role)
  if(sourceTools.has(name)&&typeof args.artifact_id==='string'){
   const e=s.entries.find(e=>e.kind==='construction'&&e.id===args.artifact_id&&e.revision===args.revision)
   if(!e||s.source&&(s.source.artifact_id!==e.id||s.source.revision!==e.revision))throw Error('operation_scope_changed')
   delete args.artifact_id;delete args.revision
   if(role==='drawing'||!s.source)args.source_ref=e.ref
  }else if(sourceTools.has(name)){
   delete args.artifact_id;delete args.revision;if(role==='drawing'||!s.source)args.source_ref=null
  }
  return args
 },
 async before(role:OperationRole,name:string,raw:unknown):Promise<{status:string;args?:Record<string,any>;reason?:string;result?:any;available_refs?:{ref:string;kind:Kind;label:string}[]}>{
  if(!object(raw))return {status:'invalid',reason:'operation_arguments_invalid'}
  if(!await opts.hasAccess())throw Error('project_denied')
  const s=get(role),priorSource=s.source?{...s.source}:null,v=structuredClone(raw),used:OperationEntry[]=[]
  // The rows an ambiguous match found; they go back with the refusal (Våningssäng 2,
  // 2026-11-08: two refusals named no rows, so Mattias searched for them again).
  let candidates:OperationEntry[]=[]
  const ambiguous=(matches:OperationEntry[])=>{candidates=matches;return Error('operation_scope_ambiguous')}
  const check=async(e:OperationEntry|undefined)=>{if(!e)throw Error('operation_reference_required');used.push(e);return e}
  const validate=async()=>{if(opts.validateMany&&!await opts.validateMany([...new Map(used.map(e=>[e.ref,e])).values()]))throw Error('operation_reference_changed')}
  const bind=async(id:string,rev:string|undefined,ref:string,kind:Kind,nullable=false)=>{
   if(Object.hasOwn(v,id)||rev&&Object.hasOwn(v,rev))throw Error('operation_identity_is_server_owned')
   const value=v[ref];delete v[ref]
   if(value===null&&nullable){v[id]=null;if(rev)v[rev]=0;return undefined}
   const e=await check(selection(s,value,kind));v[id]=e.id;if(rev)v[rev]=e.revision;return e
  }
  try{
   const sourceBinding=opts.version!==1?opts.bindings?.[name]?.source:undefined
   if(sourceTools.has(name)||sourceBinding){
    const id=sourceBinding?.id??'artifact_id',rev=sourceBinding?.revision??'revision',field=sourceBinding?.ref??'source_ref'
    if(Object.hasOwn(v,id)||Object.hasOwn(v,rev))throw Error('operation_identity_is_server_owned')
    const readOnly=opts.version!==1&&(sourceBinding?.readOnly??readSourceTools.has(name))
    const explicit=v[field]!==undefined&&v[field]!==null?source(s,v[field]):undefined
    if(v[field]!=null&&!explicit)throw Error('operation_reference_required')
    if(!readOnly&&s.source&&explicit&&explicit.id!==s.source.artifact_id)throw Error('operation_scope_changed')
    // A read with no reference in an unbound job reads the construction the
    // job can only mean: Rita's drawing work, else the only one in scope (owner
    // runs 2026-11-08: five reads refused for a reference the server knew).
    // A read never binds the job; an overview stays a list.
    const implicit=()=>{
     if(!readOnly||name==='read_construction_draft'&&['overview','work'].includes(v.view))return undefined
     const work=role==='drawing'?opts.drawingWork():undefined
     const bound=work&&s.entries.find(e=>e.kind==='construction'&&e.id===work.construction.artifact_id&&e.revision===work.construction.revision)
     if(bound)return bound
     const all=s.entries.filter(e=>e.kind==='construction');return all.length===1?all[0]:undefined
    }
    const e=readOnly&&explicit?explicit:s.source?s.entries.find(e=>e.kind==='construction'&&e.id===s.source!.artifact_id&&e.revision===s.source!.revision):explicit??implicit()
    delete v[field]
    if(!e&&name==='read_construction_draft'&&['overview','work'].includes(v.view)){v[id]=null;v[rev]=null}
    else{const selected=await check(e);v[id]=selected.id;v[rev]=selected.revision;if(!readOnly&&role!=='drawing'&&!s.source)s.source={artifact_id:selected.id,revision:selected.revision}}
   }
   if(editTools.has(name)&&role==='structure'){
    if(Object.hasOwn(v,'record_id')||Object.hasOwn(v,'expected_revision'))throw Error('operation_identity_is_server_owned')
    // An explicit null saves a new construction, even in a bound job; the
    // job's construction is revised only when the save names it.
    const fresh=opts.explicitSaveTarget&&name==='save_construction_draft'&&v.source_ref===null
    if(fresh){delete v.source_ref;v.record_id=null;v.expected_revision=0}
    else{
    if(!s.source&&v.source_ref!=null){const e=await check(source(s,v.source_ref));s.source={artifact_id:e.id,revision:e.revision}}
    else if(s.source&&v.source_ref!==undefined&&v.source_ref!==null&&source(s,v.source_ref)?.id!==s.source.artifact_id)throw Error('operation_scope_changed')
    delete v.source_ref
    if(s.source){const e=await check(s.entries.find(e=>e.kind==='construction'&&e.id===s.source!.artifact_id&&e.revision===s.source!.revision));v.record_id=e.id;v.expected_revision=e.revision}
    else if(name==='save_construction_draft'){v.record_id=null;v.expected_revision=0}
    else throw Error('operation_source_required')
    }
   }
   // Owner decision 2026-11-07: saving a sketch names its construction by the
   // job's source like any part edit; null with no bound source is a new one.
   if(name==='commit_construction_sketch'&&role==='structure'&&opts.bindings?.commit_construction_sketch){
    if(Object.hasOwn(v,'record_id'))throw Error('operation_identity_is_server_owned')
    if(!s.source&&v.source_ref!=null){const e=await check(source(s,v.source_ref));s.source={artifact_id:e.id,revision:e.revision}}
    else if(s.source&&v.source_ref!=null&&source(s,v.source_ref)?.id!==s.source.artifact_id)throw Error('operation_scope_changed')
    delete v.source_ref
    v.record_id=s.source?s.source.artifact_id:null
   }
   if(name==='transition_legacy_drawing'){
    const e=await bind('record_id','expected_revision','drawing_ref','drawing')
    if(s.source&&s.source.artifact_id!==e?.id)throw Error('operation_scope_changed')
   }
   if(name==='derive_cad_material_requirement'){
    if(!s.source){const e=await check(source(s,v.source_ref));s.source={artifact_id:e.id,revision:e.revision}}
    else if(v.source_ref!==undefined&&source(s,v.source_ref)?.id!==s.source.artifact_id)throw Error('operation_scope_changed')
    delete v.source_ref
    if(v.record_ref===null&&object(v.data)){
     const matches=s.entries.filter(e=>e.kind==='requirement'&&e.parent===s.source?.artifact_id&&e.definition_id===v.data.definition_id&&e.quantity_mode===v.data.quantity_mode)
     if(matches.length>1)throw ambiguous(matches);if(matches[0])v.record_ref=matches[0].ref
    }
    const output=await bind('record_id','expected_revision','record_ref','requirement',true)
    if(output?.parent&&output.parent!==s.source?.artifact_id)throw Error('operation_scope_changed')
    if(!s.source)throw Error('operation_source_required')
    const e=await check(s.entries.find(e=>e.kind==='construction'&&e.id===s.source!.artifact_id&&e.revision===s.source!.revision))
    if(!object(v.data)||['artifact_id','artifact_revision','target_revision'].some(k=>Object.hasOwn(v.data,k)))throw Error('operation_identity_is_server_owned')
    v.data={...v.data,artifact_id:e.id,artifact_revision:e.revision,target_revision:e.target_revision}
   }
   if(name==='save_construction_cut_plan'){
    if(v.record_ref===null){const matches=s.entries.filter(e=>e.kind==='cut_plan'&&e.parent===s.source?.artifact_id);if(matches.length>1)throw ambiguous(matches);if(matches[0])v.record_ref=matches[0].ref}
    const output=await bind('record_id','expected_revision','record_ref','cut_plan',true)
    if(output?.parent&&output.parent!==v.artifact_id)throw Error('operation_scope_changed')
    for(const p of Array.isArray(v.requirements)?v.requirements:[]){
     if(!object(p)||Object.hasOwn(p,'id')||Object.hasOwn(p,'revision'))throw Error('operation_identity_is_server_owned')
     const e=await check(selection(s,p.requirement_ref,'requirement'));if(e.parent&&e.parent!==v.artifact_id)throw Error('operation_scope_changed')
     delete p.requirement_ref;p.id=e.id;p.revision=e.revision
    }
   }
   if(name==='manage_project_material'){
    if(Object.hasOwn(v,'expected_updated_at'))throw Error('operation_identity_is_server_owned')
    const kind:Kind|undefined=({stock:'stock',requirement:'requirement',cut_plan:'cut_plan',product:'product',pack_purchase:'product'} as Record<string,Kind>)[v.resource]
    if(!kind)throw Error('operation_resource_invalid')
    const output=await bind('record_id','expected_revision','record_ref',kind,v.action==='create');v.expected_updated_at=null
    if(output?.parent&&s.source&&output.parent!==s.source.artifact_id)throw Error('operation_scope_changed')
    if(v.resource==='requirement'&&object(v.data)&&['artifact_id','artifact_revision','target_revision'].some(k=>Object.hasOwn(v.data,k)&&v.data[k]!==null))throw Error('operation_identity_is_server_owned')
   }
   if(name==='design_project_cad'){
    if(['request_id','artifact_id','construction_revision','area_id','component_id','step_id'].some(k=>Object.hasOwn(v,k)))throw Error('operation_identity_is_server_owned')
    const e=await check(source(s,v.source_ref));delete v.source_ref
    const destination=v.drawing_ref===null||v.drawing_ref===undefined?undefined:await check(selection(s,v.drawing_ref,'drawing'));delete v.drawing_ref
    if(destination&&(destination.kind!=='drawing'||destination.parent!==e.id))throw Error('operation_scope_changed')
    await validate()
    const legacyDone=opts.version===1?s.completed.find(x=>x.source===e.ref):undefined
    if(legacyDone)return {status:'complete',result:legacyDone.result}
    const intent=await fingerprint({source:e.ref,arguments:v})
    const done=s.completed.find(x=>x.source===e.ref&&x.key===intent&&(!destination||x.result.receipt?.recordId===destination.id)&&s.entries.some(r=>r.kind==='drawing'&&r.id===x.result.receipt?.recordId&&r.revision===x.result.receipt?.revision))
    if(done){
     // The receipt identifies the code-resolved destination, including a drawing
     // created during this job. Recheck its saved revision before replay; do not
     // create another request merely to rediscover an already committed result.
     await check(s.entries.find(x=>x.kind==='drawing'&&x.id===done.result.receipt?.recordId&&x.revision===done.result.receipt?.revision));await validate()
     return {status:'complete',result:done.result}
    }
    if(s.completed.some(x=>x.source===e.ref&&!x.key))return {status:'needs_verification',reason:'saved_drawing_intent_unavailable'}
    const ready=await opts.prepareDrawing({artifact_id:e.id,revision:e.revision},destination?{artifact_id:destination.id,revision:destination.revision}:undefined)
    if(ready.status!=='ready')return {status:String(ready.status??'unavailable'),reason:ready.reason}
    const bound=opts.drawingArguments(v);if(!bound)throw Error('operation_reference_required')
    s.active={source:e.ref,key:intent}
    return {status:'ready',args:bound}
   }
   if(name==='plan_cad_pieces'){
    if(Object.hasOwn(v,'area_id')||!Array.isArray(v.pieces))throw Error('operation_identity_is_server_owned')
    const areas=new Set<string|null>()
    for(const p of v.pieces){if(!object(p)||['artifact_id','construction_revision','component_id'].some(k=>Object.hasOwn(p,k)))throw Error('operation_identity_is_server_owned')
     const e=await check(selection(s,p.source_ref,'construction'));delete p.source_ref;p.artifact_id=e.id;p.construction_revision=e.revision;p.component_id=e.component_id??null;areas.add(e.area_id??null)}
    if(areas.size>1)throw Error('operation_scope_ambiguous');v.area_id=[...areas][0]??s.area_id
   }
   if(name==='compose_cad_shell'){
    await bind('record_id','expected_revision','shell_ref','shell',true)
    if(Object.hasOwn(v,'area_id'))throw Error('operation_identity_is_server_owned');v.area_id=null;const childAreas=new Set<string|null>()
    for(const p of [...(Array.isArray(v.components)?v.components:[]),...(object(v.component)?[v.component]:[])]){
     if(['child_artifact_id','child_revision'].some(k=>Object.hasOwn(p,k)))throw Error('operation_identity_is_server_owned')
     const e=await check(selection(s,p.drawing_ref,'drawing'));delete p.drawing_ref;p.child_artifact_id=e.id;p.child_revision=e.revision;childAreas.add(e.area_id??null)
    }
    if(v.action==='create'&&childAreas.size===1)v.area_id=[...childAreas][0]
   }
   if(name==='read_cad_shell')await bind('shell_id','revision','shell_ref','shell')
   if(name==='link_cad_shell_steps'){
    await bind('shell_id','expected_revision','shell_ref','shell')
    for(const p of Array.isArray(v.links)?v.links:[]){if(Object.hasOwn(p,'step_id'))throw Error('operation_identity_is_server_owned');const e=await check(selection(s,p.step_ref,'step'));delete p.step_ref;p.step_id=e.id}
   }
   if(name==='link_project_drawing'){await bind('record_id','expected_revision','drawing_ref','drawing');await bind('step_id',undefined,'step_ref','step')}
   if(['read_drawing_requests','read_drawing_request_work','link_drawing_gap','ensure_drawing_gap_task'].includes(name)){
    const request=await bind('request_id',name==='link_drawing_gap'||name==='ensure_drawing_gap_task'?'expected_revision':undefined,'request_ref','request',name==='read_drawing_requests')
    if(name==='link_drawing_gap'||name==='ensure_drawing_gap_task'){
     const gap=await bind('gap_id',undefined,'gap_ref','gap');if(gap?.parent!==request?.id)throw Error('operation_scope_changed')
     if(name==='link_drawing_gap'){await bind('task_id',undefined,'task_ref','task',true);await bind('step_id',undefined,'step_ref','step',true)}
     else await bind('requirement_id','plan_revision','requirement_ref','plan_requirement')
    }
   }
   await validate()
   return {status:'ready',args:v}
  }catch(error){s.source=priorSource;rethrowContinuation(error);if(error instanceof Error&&error.message==='project_denied')throw error
   const reason=error instanceof Error?error.message:'operation_reference_invalid'
   return {status:error instanceof Error&&error.message.endsWith('_unavailable')?'unavailable':'invalid',reason,
    ...(opts.stableRefs&&reason==='operation_reference_required'?{available_refs:s.entries.slice(-20).map(({ref,kind,label})=>({ref,kind,label}))}:{}),
    ...(reason==='operation_scope_ambiguous'&&candidates.length?{candidates:candidates.slice(0,12).map(({ref,kind,label,revision,definition_id,quantity_mode})=>({ref,kind,label,revision,
     ...(definition_id!==undefined?{definition_id}:{}),...(quantity_mode!==undefined?{quantity_mode}:{})})),
     message:'More than one row matches. Send record_ref with the reference of the row this change is for.'}:{})}}
 },
 async observe(role:OperationRole,name:string,args:Record<string,any>,result:any){
  const s=get(role),before=new Set(s.entries.map(e=>e.ref))
  if(name==='design_project_cad'&&result?.status!=='ready')delete s.active
  if(!await opts.hasAccess())throw Error('project_denied')
  const receipt=result?.status==='saved'?result.receipt:undefined
  if(receipt?.projectId===opts.projectId&&typeof receipt.recordId==='string'&&Number.isSafeInteger(receipt.revision)){
   const kind:Kind|undefined=editTools.has(name)||name==='transition_legacy_drawing'||name==='commit_construction_sketch'?'construction':name==='save_cad_design'?'drawing':name==='compose_cad_shell'?'shell':name==='save_construction_cut_plan'?'cut_plan':name==='derive_cad_material_requirement'?'requirement':name==='manage_project_material'?({stock:'stock',requirement:'requirement',cut_plan:'cut_plan',product:'product'} as Record<string,Kind>)[args.resource]:undefined
   if(kind){const e=await put(s,{kind,id:receipt.recordId,revision:receipt.revision,label:receipt.label??kind,...(kind==='requirement'?{parent:s.source?.artifact_id,definition_id:args.data?.definition_id,quantity_mode:args.data?.quantity_mode}:kind==='cut_plan'?{parent:s.source?.artifact_id}:kind==='drawing'?{parent:opts.drawingWork()?.construction.artifact_id}:kind==='shell'?{area_id:args.action==='create'?args.area_id:s.entries.find(e=>e.kind==='shell'&&e.id===receipt.recordId)?.area_id}:{}),...(kind==='construction'?{area_id:s.area_id,target_revision:receipt.record?.target_revision??args.target_revision??s.entries.find(x=>x.kind==='construction'&&x.id===s.source?.artifact_id)?.target_revision}: {})})
    // A bound job stays on its own construction: a new one saved in it (an
    // explicit null target) is listed but does not take the job over (review
    // of #505: an edit meant for the handed-over construction landed on it).
    if(kind==='construction'&&(!s.source||s.source.artifact_id===e.id))s.source={artifact_id:e.id,revision:e.revision}
    if(kind==='drawing'){const work=opts.drawingWork(),ref=s.entries.find(e=>e.kind==='construction'&&e.id===work?.construction.artifact_id&&e.revision===work?.construction.revision)?.ref
     if(ref)s.completed.push({source:ref,...(s.active?.source===ref?{key:s.active.key}:{}),result:{status:'already_saved',saved:true,receipt:structuredClone(Object.fromEntries(Object.entries(receipt).filter(([key])=>key!=='record')))}});delete s.active}
   }
  }
  if(name==='read_drawing_request_work'&&result?.request?.project_id===opts.projectId){
   const r=result.request;await put(s,{kind:'request',id:r.id,revision:r.revision,label:'Drawing request · '+r.status})
   for(const row of result.gaps??[])if(typeof row.id==='string')await put(s,{kind:'gap',id:row.id,revision:0,label:row.requirement_key??'Drawing gap',parent:r.id})
  }
  if(name==='read_drawing_requests'&&Array.isArray(result?.requests))for(const row of result.requests)if(row.project_id===opts.projectId)await put(s,{kind:'request',id:row.id,revision:row.revision,label:'Drawing request · '+row.status})
  if(result?.status==='ok'){
   if(opts.version===1&&role!=='drawing'&&!s.source&&sourceTools.has(name)&&result.projectId===opts.projectId&&result.artifact_id===args.artifact_id&&result.revision===args.revision){
    const entry=s.entries.find(e=>e.kind==='construction'&&e.id===result.artifact_id&&e.revision===result.revision)
    if(entry)s.source={artifact_id:entry.id,revision:entry.revision}
   }
   if(name==='read_construction_draft'&&result.projectId===opts.projectId&&Array.isArray(result.items)&&!result.artifact_id)
    for(const row of result.items)if(typeof row.id==='string'&&Number.isSafeInteger(row.revision))await put(s,{kind:'construction',id:row.id,revision:row.revision,label:row.title??'Construction'})
   if(name==='read_drawing_requests')for(const row of result.requests??[])if(row.project_id===opts.projectId&&typeof row.id==='string')await put(s,{kind:'request',id:row.id,revision:row.revision,label:row.status??'Drawing request'})
   if(name==='read_drawing_request_work')for(const row of result.gaps??[])if(typeof row.id==='string')await put(s,{kind:'gap',id:row.id,revision:0,label:row.label??row.title??'Drawing gap',parent:args.request_id})
   if(name==='search_project_data'){
    const kind:Kind|undefined=result.dataset==='tasks'?'task':undefined
    if(kind)for(const row of result.records??[])if(typeof row.id==='string')await put(s,{kind,id:row.id,revision:Number(row.revision??0),label:row.title??row.name??kind})
   }
  }
  if(name==='read_project_work'&&result?.projectId===opts.projectId&&Array.isArray(result.records)){
   const kind:Kind|undefined=({stock:'stock',requirement:'requirement',cut_plan:'cut_plan',product:'product'} as Record<string,Kind>)[args.resource]
   if(kind)for(const row of result.records){const revision=row.revision??row.current_revision;if(typeof row.id==='string'&&Number.isSafeInteger(revision)){
    const old=s.entries.find(e=>e.kind===kind&&e.id===row.id)
    await put(s,{...old,kind,id:row.id,revision,label:row.name??row.title??old?.label??kind})
   }}
  }
  // Put the reference next to the actual returned record, so duplicate titles
  // or request statuses never require guessing a handle from a separate list.
  let out=result
  const mark=(row:any,kind:Kind)=>{if(!object(row))return row;const e=s.entries.find(e=>e.kind===kind&&e.id===(row.id??row.artifact_id??row.recordId)&&e.revision===(row.revision??row.current_revision??0));return e?{...row,operation_ref:e.ref}:row}
  if(object(out)){
   out={...out}
   if(name==='read_construction_draft'&&Array.isArray(out.items))out.items=out.items.map((r:any)=>mark(r,'construction'))
   if(name==='read_drawing_requests'&&Array.isArray(out.requests))out.requests=out.requests.map((r:any)=>mark(r,'request'))
   if(name==='read_drawing_request_work'){out.request=mark(out.request,'request');if(Array.isArray(out.gaps))out.gaps=out.gaps.map((r:any)=>mark({...r,revision:0},'gap'))}
   if(name==='read_project_work'&&Array.isArray(out.records))out.records=out.records.map((r:any)=>mark(r,args.resource as Kind))
  }
  const added=s.entries.filter(e=>!before.has(e.ref)).map(({ref,kind,label})=>({ref,kind,label}))
  return object(out)&&added.length?{...out,operation_refs:added}:out
 },
 }
}
export type WorkerOperations=ReturnType<typeof createWorkerOperations>
