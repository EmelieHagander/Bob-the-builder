/** Small plan changes preserve the server-read remainder, rather than asking a
 * model to reproduce every identity, criterion and Task owner. Read-only: the
 * existing proposal/decision commands still own persistence and approval. */
const nullable={type:['string','null']}
export const EDIT_PLAN_TOOL={type:'function' as const,function:{name:'edit_project_plan',
 description:'Prepare a focused edit of the current plan without rewriting unrelated Steps. Read-only; returns an exact savable proposal. Actions: update_step (values: changed title/goal/state/area_id/phase/responsibility/notes); remove_step; move_step (after_step_id, null means first); update_requirement (changed criterion fields); remove_requirement; add_requirement (full criterion, new identity allocated by server); add_step (full Step fields and requirements, after_step_id); move_task (task_id to step_id). Use exact current IDs; unused IDs are null and unused values is {}. Completed history is immutable. Removing a Step preserves its Tasks as unorganised unless move_task changes explicitly rehome them. Save via save_compiled_project_plan, then apply via decide_project_plan only when the owner has authorised this exact edit. This never performs physical checks.',
 parameters:{type:'object',additionalProperties:false,properties:{summary:{type:'string'},reason:{type:'string'},changes:{type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['update_step','remove_step','move_step','update_requirement','remove_requirement','add_requirement','add_step','move_task']},step_id:nullable,requirement_id:nullable,after_step_id:nullable,task_id:nullable,values:{type:'object',additionalProperties:true}},required:['action','step_id','requirement_id','after_step_id','task_id','values']}}},required:['summary','reason','changes']}}}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const pick=(v:Record<string,any>,keys:string[])=>Object.fromEntries(keys.map(k=>[k,v[k]??null]))
const STEP_FIELDS=['title','goal','state','area_id','phase','responsible_kind','responsible_person_id','notes']
const REQUIREMENT_FIELDS=['type','title','description','resolution','responsible_kind','responsible_person_id','evidence_selector']
const fail=(message:string):never=>{throw new Error(message)}
function fields(value:unknown,allowed:string[]){
 if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('Unknown edit field; use only the advertised fields for this action.')
 return value as Record<string,any>
}
export function editPlanSnapshot(snapshot:Record<string,any>,input:unknown){
 if(!object(input)||Object.keys(input).sort().join(',')!=='changes,reason,summary'||!Array.isArray(input.changes)||input.changes.length<1||input.changes.length>32)fail('Use summary, reason and 1–32 changes.')
 const raw=input as Record<string,any>,current=snapshot.plan?.[0]
 if(!current?.revision)fail('There is no current plan to edit. Compile an initial plan instead.')
 const steps=(current.steps??[]).filter((s:any)=>s.state!=='completed').map((s:any)=>({step_id:s.id,...pick(s,STEP_FIELDS),requirements:(s.requirements??[]).map((q:any)=>({requirement_id:q.id,...pick(q,REQUIREMENT_FIELDS)}))}))
 const owners=new Map<string,string>()
 const editedTasks=new Set<string>()
 for(const c of raw.changes){
  if(!object(c)||Object.keys(c).sort().join(',')!=='action,after_step_id,requirement_id,step_id,task_id,values')fail('Each change needs the exact advertised fields; unused IDs are null.')
  if(!object(c.values))fail('values must be an object.')
  if(!['move_step','add_step'].includes(c.action)&&c.after_step_id!==null||!['update_requirement','remove_requirement'].includes(c.action)&&c.requirement_id!==null||c.action!=='move_task'&&c.task_id!==null)fail('An unused ID must be null.')
  const index=steps.findIndex((s:any)=>s.step_id===c.step_id),s=steps[index]
  if(c.action!=='add_step'&&(!s||c.step_id===null))fail('Step not found in the current unfinished plan; read its exact ID. Completed history cannot be edited.')
  if(c.action==='update_step'){
   if(c.values.state==='completed')fail('An edit cannot certify completion. Keep the Step open or explicitly remove obsolete work.')
   Object.assign(s,fields(c.values,STEP_FIELDS))
  }else if(c.action==='remove_step'){
   fields(c.values,[]);steps.splice(index,1)
  }else if(c.action==='move_step'||c.action==='add_step'){
   let row=s
   if(c.action==='move_step'){fields(c.values,[]);steps.splice(index,1)}
   else{
    if(c.step_id!==null)fail('A new Step uses null identity.')
    fields(c.values,[...STEP_FIELDS,'requirements'])
    if(c.values.state==='completed'||!Array.isArray(c.values.requirements)||c.values.requirements.some((q:any)=>!object(q)||q.requirement_id!==null))fail('New Steps must be unfinished and new requirements use null identities.')
    row={step_id:null,...structuredClone(c.values)}
   }
   const after=c.after_step_id===null?-1:steps.findIndex((x:any)=>x.step_id===c.after_step_id)
   if(c.after_step_id!==null&&after<0)fail('after_step_id must be another retained Step.')
   steps.splice(after+1,0,row)
  }else if(['update_requirement','remove_requirement','add_requirement'].includes(c.action)){
   const at=s.requirements.findIndex((q:any)=>q.requirement_id===c.requirement_id)
   if(c.action!=='add_requirement'&&(c.requirement_id===null||at<0))fail('Requirement not found under this exact Step.')
   if(c.action==='remove_requirement'){fields(c.values,[]);s.requirements.splice(at,1)}
   else if(c.action==='update_requirement')Object.assign(s.requirements[at],fields(c.values,REQUIREMENT_FIELDS))
   else s.requirements.push({requirement_id:null,...structuredClone(fields(c.values,REQUIREMENT_FIELDS))})
  }else if(c.action==='move_task'){
   fields(c.values,[])
   if(editedTasks.has(c.task_id)||!(snapshot.tasks??[]).some((t:any)=>t.id===c.task_id))fail('Each moved Task must be an exact current Task and appear once.')
   editedTasks.add(c.task_id);owners.set(c.task_id,c.step_id)
  }else fail('Unknown plan edit action.')
 }
 const task_candidates=[...owners].map(([id,sid])=>{
  const position=steps.findIndex((s:any)=>s.step_id===sid)+1
  if(!position)fail('A moved Task must belong to a retained Step.')
  return {step_position:position,task_id:id,task_name:snapshot.tasks.find((t:any)=>t.id===id).name,reason:raw.reason}
 })
 return {expected_revision:current.revision,summary:raw.summary,reason:raw.reason,steps,task_candidates,observations:[]}
}
