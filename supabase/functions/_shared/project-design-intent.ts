export type DesignPurpose='illustration'|'concept'|'construction'
export type DesignIntent={
 version:1
 purpose:DesignPurpose
 summary:string
 references:{image_id:string;role:'appearance'|'layout'|'context';note:string}[]
 features:{id:string;description:string;basis:'user_request'|'project_record'|'working_assumption';source_ref:string|null}[]
 choices:{id:string;question:string;alternatives:string[];recommendation:string;basis:string;consequences:string;geometry_dependency:boolean;status:'open'|'resolved'|'deferred';selected_direction:string|null;decision_authority:'owner'|'bob';decision_basis:string;deferral:{scope:'illustration'|'concept';reason:string}|null}[]
 alignment:{status:'draft'|'aligned';basis:string}
}
export type DesignIntentPin={version:1;project_id:string;area_id:string|null;target_revision:number;solution_id:string;solution_revision:number;purpose:DesignPurpose}
export type DesignReadiness={
 status:'ready'|'needs_data'|'conflict'|'unavailable'
 project_id:string
 area_id:string|null
 target_revision:number|null
 solution_id:string|null
 solution_revision:number|null
 purpose:DesignPurpose|null
 design_intent:DesignIntent|null
 issues:{code:string;choice_id:string|null;message:string}[]
 deferred_choice_ids:string[]
 pin:DesignIntentPin|null
}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const text=(maxLength:number,minLength=0)=>({type:'string',minLength,maxLength})
const nullableText=(maxLength:number)=>({type:['string','null'],minLength:1,maxLength})
const purpose={type:'string',enum:['illustration','concept','construction']}
export const DESIGN_INTENT_SCHEMA=object({
 version:{type:'integer',enum:[1]},purpose,summary:text(2000,1),
 references:{type:'array',maxItems:8,items:object({image_id:{type:'string',format:'uuid'},role:{type:'string',enum:['appearance','layout','context']},note:text(1000)})},
 features:{type:'array',maxItems:24,items:object({id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,32}$'},description:text(1000,1),basis:{type:'string',enum:['user_request','project_record','working_assumption']},source_ref:nullableText(200)})},
 choices:{type:'array',maxItems:16,items:object({
  id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,40}$'},question:text(1000,1),
  alternatives:{type:'array',maxItems:4,items:text(1000,1)},
  recommendation:text(2000),basis:text(2000),consequences:text(2000),
  geometry_dependency:{type:'boolean'},status:{type:'string',enum:['open','resolved','deferred']},
  selected_direction:nullableText(2000),decision_authority:{type:'string',enum:['owner','bob']},decision_basis:text(2000),
  deferral:{anyOf:[{type:'null'},object({scope:{type:'string',enum:['illustration','concept']},reason:text(2000,1)})]},
 })},
 alignment:object({status:{type:'string',enum:['draft','aligned']},basis:text(2000)}),
})
const exact=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',')
const string=(v:unknown,max:number,empty=false):v is string=>typeof v==='string'&&Array.from(v).length<=max&&(empty||!!v.trim())
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const oneOf=(v:unknown,values:string[])=>typeof v==='string'&&values.includes(v)
const nullable=(v:unknown,max:number)=>v===null||string(v,max)
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0
// Postgres jsonb text includes one space after separators. Account for that
// storage representation before accepting the same 48 kB database boundary.
const jsonbSpaces=(v:unknown):number=>Array.isArray(v)
 ?Math.max(0,v.length-1)+v.reduce((n,item)=>n+jsonbSpaces(item),0)
 :v&&typeof v==='object'
  ?Object.keys(v).length+Math.max(0,Object.keys(v).length-1)+Object.values(v).reduce<number>((n,item)=>n+jsonbSpaces(item),0)
  :0
/** Shape/consistency validation is separate from canonical caller-scoped readiness.
 * A well-formed draft may retain unanswered advisory questions. */
export function parseDesignIntent(v:unknown):DesignIntent|null{
 const x=v as DesignIntent
 if(!exact(x,['version','purpose','summary','references','features','choices','alignment'])||x.version!==1||!oneOf(x.purpose,['illustration','concept','construction'])||!string(x.summary,2000)
  ||!Array.isArray(x.references)||x.references.length>8||!Array.isArray(x.features)||x.features.length>24||!Array.isArray(x.choices)||x.choices.length>16
  ||!exact(x.alignment,['status','basis'])||!oneOf(x.alignment.status,['draft','aligned'])||!string(x.alignment.basis,2000,true)
  ||x.alignment.status==='aligned'&&!x.alignment.basis.trim())return null
 const refs=new Set<string>(),features=new Set<string>(),choices=new Set<string>()
 for(const r of x.references){
  if(!exact(r,['image_id','role','note'])||!uuid(r.image_id)||refs.has(r.image_id)||!oneOf(r.role,['appearance','layout','context'])||!string(r.note,1000,true))return null
  refs.add(r.image_id)
 }
 for(const f of x.features){
  if(!exact(f,['id','description','basis','source_ref'])||!string(f.id,32)||!/^[a-zA-Z0-9_-]+$/.test(f.id)||features.has(f.id)||!string(f.description,1000)||!oneOf(f.basis,['user_request','project_record','working_assumption'])||!nullable(f.source_ref,200))return null
  features.add(f.id)
 }
 for(const c of x.choices){
  if(!exact(c,['id','question','alternatives','recommendation','basis','consequences','geometry_dependency','status','selected_direction','decision_authority','decision_basis','deferral'])
   ||!string(c.id,40)||!/^[a-zA-Z0-9_-]+$/.test(c.id)||choices.has(c.id)||!string(c.question,1000)||!Array.isArray(c.alternatives)||c.alternatives.length>4||c.alternatives.some(a=>!string(a,1000))
   ||!string(c.recommendation,2000,true)||!string(c.basis,2000,true)||!string(c.consequences,2000,true)||typeof c.geometry_dependency!=='boolean'
   ||!oneOf(c.status,['open','resolved','deferred'])||!nullable(c.selected_direction,2000)||!oneOf(c.decision_authority,['owner','bob'])||!string(c.decision_basis,2000,true))return null
  if(c.status==='resolved'){
   if(!c.alternatives.length||c.selected_direction===null||![c.recommendation,c.basis,c.consequences,c.decision_basis].every(s=>s.trim())||c.deferral!==null)return null
  }else{
   if(c.selected_direction!==null)return null
   if(c.status==='open'&&c.deferral!==null)return null
   if(c.status==='deferred'&&(!exact(c.deferral,['scope','reason'])||!oneOf(c.deferral?.scope,['illustration','concept'])||!string(c.deferral?.reason,2000)))return null
  }
  choices.add(c.id)
 }
 if(new TextEncoder().encode(JSON.stringify(x)).length+jsonbSpaces(x)>48000)return null
 return structuredClone(x)
}
export function parseDesignIntentPin(v:unknown):DesignIntentPin|null{
 const x=v as DesignIntentPin
 if(!exact(x,['version','project_id','area_id','target_revision','solution_id','solution_revision','purpose'])||x.version!==1||!string(x.project_id,200)||!nullable(x.area_id,200)||!positive(x.target_revision)||!uuid(x.solution_id)||!positive(x.solution_revision)||!oneOf(x.purpose,['illustration','concept','construction']))return null
 return structuredClone(x)
}
/** Only a complete canonical ready packet can be consumed as readiness proof. */
export function parseDesignReadiness(v:unknown):DesignReadiness|null{
 const x=v as DesignReadiness
 if(!x||typeof x!=='object'||Array.isArray(x)||!oneOf(x.status,['ready','needs_data','conflict','unavailable'])||!string(x.project_id,200)||!nullable(x.area_id,200)
  ||!(x.target_revision===null||positive(x.target_revision))||!(x.solution_id===null||uuid(x.solution_id))||!(x.solution_revision===null||positive(x.solution_revision))
  ||!(x.purpose===null||oneOf(x.purpose,['illustration','concept','construction']))||!Array.isArray(x.issues)||x.issues.length>40
  ||x.issues.some(i=>!exact(i,['code','choice_id','message'])||!string(i.code,100)||!nullable(i.choice_id,40)||!string(i.message,2000))
  ||!Array.isArray(x.deferred_choice_ids)||x.deferred_choice_ids.length>16||x.deferred_choice_ids.some(i=>!string(i,40)))return null
 const intent=x.design_intent===null?null:parseDesignIntent(x.design_intent)
 const pin=x.pin===null?null:parseDesignIntentPin(x.pin)
 if(x.design_intent!==null&&!intent||x.pin!==null&&!pin)return null
 if(x.status==='ready'){
  if(!intent||!pin||x.issues.length||intent.alignment.status!=='aligned'||intent.purpose!==x.purpose
   ||pin.project_id!==x.project_id||(pin.area_id!==null&&pin.area_id!==x.area_id)||pin.target_revision!==x.target_revision||pin.solution_id!==x.solution_id||pin.solution_revision!==x.solution_revision||pin.purpose!==x.purpose
   ||intent.references.some(r=>r.role!=='context')&&!intent.features.length
   ||intent.choices.some(c=>c.status==='open'||c.status==='deferred'&&(x.purpose==='construction'||c.deferral?.scope!==x.purpose)))return null
  const deferred=intent.choices.filter(c=>c.status==='deferred').map(c=>c.id).sort()
  if(new Set(x.deferred_choice_ids).size!==x.deferred_choice_ids.length||JSON.stringify(deferred)!==JSON.stringify(x.deferred_choice_ids.slice().sort()))return null
 }
 return structuredClone({...x,design_intent:intent,pin})
}
/** Required visual/function features come from the selected immutable Solution,
 * rather than relying on a caller to remember them in a new handoff. */
export function designIntentHandoff<T extends {requirements:{id:string;requirement:string;basis:'user_request'|'project_record'|'working_assumption';source_ref:string|null}[];unresolved:string[]}>(base:T,intent:DesignIntent,pin:DesignIntentPin):T{
 const canonical=intent.features.map(f=>({id:'intent_'+f.id,requirement:f.description,basis:'project_record' as const,source_ref:pin.solution_id}))
 const ids=new Set(canonical.map(f=>f.id))
 const requirements=[...base.requirements.filter(r=>!ids.has(r.id)),...canonical]
 if(requirements.length>24)throw new Error('design_intent_requirement_limit')
 const unresolved=[...new Set([...base.unresolved,...intent.choices.filter(c=>c.status==='deferred').map(c=>c.question+' — '+c.deferral!.reason)])]
 if(unresolved.length>20)throw new Error('design_intent_unresolved_limit')
 return {...structuredClone(base),requirements,unresolved}
}
