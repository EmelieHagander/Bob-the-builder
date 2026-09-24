/** Generic project actions. Domain commands remain the authority boundary. */
const str={type:'string'},nullable={type:['string','null']},integer={type:'integer'}
const quote={type:'string',description:'Exact quote from the current request; its scope includes delegated ordinary prerequisites.'}
const refs={type:'array',maxItems:20,items:{type:'object',additionalProperties:false,properties:{id:str,revision:integer},required:['id','revision']}}
function tool(name:string,description:string,properties:Record<string,unknown>){return {type:'function' as const,function:{name,description,parameters:{type:'object',additionalProperties:false,properties:{...properties,request_quote:quote},required:[...Object.keys(properties),'request_quote']}}}}
export const EXPERT_TOOLS=[
 tool('archive_project_measurement','Archive or restore an exact measurement revision. Archive removes it from active use while retaining history and drawing lineage. Read current measurement and affected evidence first.',{record_id:str,expected_revision:integer,action:{type:'string',enum:['archive','restore']}}),
 tool('save_project_solution','Create or revise a solution alternative. This records a design choice and assumptions; it does not select the project target or certify construction.',{record_id:nullable,expected_revision:integer,area_id:nullable,title:str,description:str,assumptions:str,tradeoffs:str,measurements:refs,change_note:str}),
 tool('select_project_target','Select an exact saved solution revision as the project target within the owner\'s delegated design intent. Read the current target and solution first. Selection records intent, never measured truth or structural approval.',{record_id:str,expected_revision:integer,solution_revision:integer,area_id:nullable,reason:str}),
 tool('update_project_task_work','Update the status and assigned project people of an existing Task. Preserve the desired full assignee list. Done records reported work, not independent verification of the plan\'s completion criteria.',{record_id:str,expected_updated_at:str,status:{type:'string',enum:['todo','doing','done','blocked']},person_ids:{type:'array',maxItems:40,uniqueItems:true,items:str}}),
]
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const text=(v:unknown,n:number,empty=false)=>typeof v==='string'&&v.length<=n&&(empty||v.trim().length>0)
export function parseExpertWrite(name:string,v:Record<string,any>){
 const base={record_id:v.record_id,expected_updated_at:null as string|null,expected_revision:v.expected_revision??null,request_quote:v.request_quote}
 if(name==='update_project_task_work'){
  if(!text(v.record_id,200)||typeof v.expected_updated_at!=='string'||!Number.isFinite(Date.parse(v.expected_updated_at))||!['todo','doing','done','blocked'].includes(v.status)||!Array.isArray(v.person_ids)||v.person_ids.length>40||v.person_ids.some((p:unknown)=>!text(p,200))||new Set(v.person_ids).size!==v.person_ids.length)return null
  return {...base,kind:'task_work' as const,expected_updated_at:v.expected_updated_at,data:{status:v.status,person_ids:v.person_ids}}
 }
 if(!Number.isSafeInteger(v.expected_revision)||v.expected_revision<0||v.record_id!==null&&!uuid(v.record_id))return null
 if(name==='archive_project_measurement')return v.record_id&&v.expected_revision>0&&['archive','restore'].includes(v.action)?{...base,kind:'measurement_state' as const,data:{action:v.action}}:null
 if(name==='select_project_target')return v.record_id&&(v.area_id===null||text(v.area_id,200))&&Number.isSafeInteger(v.solution_revision)&&v.solution_revision>0&&text(v.reason,2000)?{...base,kind:'target' as const,data:{solution_revision:v.solution_revision,area_id:v.area_id,reason:v.reason}}:null
 if(name!=='save_project_solution'||v.record_id!==null&&v.area_id!==null||(v.record_id===null?v.expected_revision!==0:v.expected_revision<1)||v.area_id!==null&&!text(v.area_id,200)
   ||!text(v.title,200)||!text(v.description,6000)||!text(v.assumptions,4000,true)||!text(v.tradeoffs,4000,true)||!text(v.change_note,1000)
   ||!Array.isArray(v.measurements)||v.measurements.length>20||v.measurements.some((m:any)=>!m||!uuid(m.id)||!Number.isSafeInteger(m.revision)||m.revision<1))return null
 return {...base,kind:'solution' as const,data:{title:v.title,description:v.description,assumptions:v.assumptions,tradeoffs:v.tradeoffs,measurements:v.measurements,...(v.record_id===null?{area_id:v.area_id}:{change_note:v.change_note})}}
}
