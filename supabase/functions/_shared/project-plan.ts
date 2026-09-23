import type { WritePayload } from './project-write.ts'

const nullableText = { type: ['string','null'] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown,n:number,empty=false): v is string => typeof v === 'string' && v.length<=n && (empty || v.trim().length>0)
const revision = (v: unknown,zero=false): v is number => Number.isSafeInteger(v) && Number(v)>=(zero?0:1) && Number(v)<1_000_000_000
const exact = (v: Record<string,unknown>, keys:string[]) => Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k))

function tool(name:string,description:string,properties:Record<string,unknown>) {
  return { type:'function' as const, function:{ name,description,parameters:{
    type:'object',additionalProperties:false,properties,required:Object.keys(properties),
  }}}
}
const responsibilityProperties = {
  responsible_kind: { type:'string', enum:['bob','person','unassigned'],
    description:'Who owns the work, not who is authorized to approve it. person uses an exact project person ID.' },
  responsible_person_id: { ...nullableText, description:'Exact bob.people ID when responsible_kind=person; otherwise null.' },
}
const selectorSchema = {
  type:'object',additionalProperties:false,
  properties:{
    kind:{ type:'string',enum:['none','measurement','media','artifact','material_requirement','solution','task'] },
    id:nullableText,
    subject:nullableText,
    area_id:nullableText,
  },
  required:['kind','id','subject','area_id'],
  description:'Optional dynamic evidence selector. measurement may use exact measurement id, or exact subject plus optional Area. Other kinds require exact id. none has all nullable fields null.',
}
const requirementSchema = {
  type:'object',additionalProperties:false,
  properties:{
    requirement_id:{ type:['string','null'],description:'Stable UUID from the current plan when preserving identity; null for a new requirement.' },
    type:{ type:'string',enum:['measurement','photo','decision','drawing','material_requirement','material_delivery','task','approval','check','other'] },
    title:{ type:'string' }, description:{ type:'string' },
    resolution:{ type:'string',enum:['open','waived','not_applicable'] },
    ...responsibilityProperties,
    evidence_selector: selectorSchema,
  },
  required:['requirement_id','type','title','description','resolution','responsible_kind','responsible_person_id','evidence_selector'],
}
const taskSchema = {
  type:'object',additionalProperties:false,
  properties:{
    task_key:{ type:'string',description:'Short Step-local key (letters/numbers/_/-) used to connect Completion Requirements to this Task, including before a new Task has a project ID.' },
    task_id:{ type:['string','null'],description:'Exact existing project Task ID to reuse, or null for a task blueprint that remains inside the proposal until approval.' },
    area_id:{ type:'string',description:'Exact project Area ID for this Task. When the Step has an Area, the Task must use the same Area.' },
    title:{ type:'string' },
    instructions:{ type:'string',description:'Practical Task instructions. For an existing Task these must match its current saved instructions.' },
  },
  required:['task_key','task_id','area_id','title','instructions'],
}
const stepSchema = {
  type:'object',additionalProperties:false,
  properties:{
    step_id:{ type:['string','null'],description:'Stable UUID from current plan when this is the same active/future Step; null for a new Step.' },
    title:{type:'string'}, goal:{type:'string'},
    brief:{type:'string',description:'Concise working note to future Bob: what this Step is, what matters, and how to think about it. It is not evidence.'},
    state:{type:'string',enum:['planned','active','blocked','completed']},
    area_id:nullableText,
    ...responsibilityProperties,
    notes:{type:'string'},
    tasks:{type:'array',maxItems:20,items:taskSchema,description:'Actions belonging to this Step. Existing Task IDs are reused; null IDs stay as proposal-only blueprints until approval.'},
    requirements:{type:'array',minItems:1,maxItems:20,items:requirementSchema,description:'Conditions that must be true before this Step can be considered complete. Tasks are actions, not completion criteria.'},
  },
  required:['step_id','title','goal','brief','state','area_id','responsible_kind','responsible_person_id','notes','tasks','requirements'],
}

export const PLAN_PROPOSAL_TOOL = tool('propose_project_plan',
  'Create a reviewable living-plan proposal. Each Step has a concise working brief, Tasks/actions and Completion Requirements. New Task blueprints do not become real project Tasks until explicit plan approval.', {
    expected_revision:{type:'integer',description:'Current approved living-plan revision, or 0 when none exists.'},
    summary:{type:'string',description:'Compact description of the proposed working plan.'},
    reason:{type:'string',description:'Why this plan or replan is appropriate now, including material new evidence.'},
    steps:{type:'array',maxItems:30,items:stepSchema},
    request_quote:{type:'string',description:'Exact quote from the CURRENT user request authorising planning/replanning.'},
  })

export const PLAN_DECISION_TOOL = tool('decide_project_plan',
  'Approve or reject one exact living-plan proposal. Approval makes it current and materializes new Task blueprints for active/blocked work; rejection creates no Tasks.', {
    action:{type:'string',enum:['approve','reject']},
    proposal_revision:{type:'integer'},
    expected_revision:{type:'integer',description:'Current approved revision, or 0 when approving the first plan.'},
    decision_note:{type:'string'},
    request_quote:{type:'string',description:'Exact quote from the CURRENT user request that clearly approves or rejects this proposal.'},
  })

export const PLAN_EVIDENCE_TOOL = tool('link_project_plan_evidence',
  'Link exact current project evidence to a Completion Requirement in the current approved plan. This records why a requirement is resolved, conflicted, refined or superseded; it does not change the source record itself.', {
    plan_revision:{type:'integer'},
    requirement_id:{type:'string'},
    relation:{type:'string',enum:['resolves','conflicts','refines','supersedes']},
    evidence_kind:{type:'string',enum:['measurement','media','artifact','material_requirement','solution','task']},
    evidence_id:{type:'string'},
    evidence_revision:{type:['integer','null'],description:'Exact revision for revisioned evidence; null for task/media.'},
    request_quote:{type:'string',description:'Exact quote from the CURRENT user request authorising this evidence link.'},
  })

export const PLAN_WRITE_TOOLS=[PLAN_PROPOSAL_TOOL,PLAN_DECISION_TOOL,PLAN_EVIDENCE_TOOL]

function responsibility(v:Record<string,unknown>) {
  if(!['bob','person','unassigned'].includes(String(v.responsible_kind))) return false
  return v.responsible_kind==='person'
    ? text(v.responsible_person_id,200)
    : v.responsible_person_id===null
}
function selector(v:unknown) {
  if(!object(v)||!exact(v,['kind','id','subject','area_id'])||!['none','measurement','media','artifact','material_requirement','solution','task'].includes(String(v.kind))) return false
  for(const k of ['id','subject','area_id']) if(v[k]!==null&&!text(v[k],300)) return false
  if(v.kind==='none') return v.id===null&&v.subject===null&&v.area_id===null
  if(v.kind==='measurement') {
    if(v.id!==null) return uuid.test(String(v.id))&&v.subject===null
    return text(v.subject,200)
  }
  return text(v.id,200)&&v.subject===null&&v.area_id===null
}
function requirement(v:unknown) {
  if(!object(v)||!exact(v,['requirement_id','type','title','description','resolution','responsible_kind','responsible_person_id','evidence_selector'])) return false
  return (v.requirement_id===null||(typeof v.requirement_id==='string'&&uuid.test(v.requirement_id)))
    && ['measurement','photo','decision','drawing','material_requirement','material_delivery','task','approval','check','other'].includes(String(v.type))
    && text(v.title,240)&&text(v.description,2000,true)
    && ['open','waived','not_applicable'].includes(String(v.resolution))
    && responsibility(v)&&selector(v.evidence_selector)
}
function plannedTask(v:unknown) {
  if(!object(v)||!exact(v,['task_key','task_id','area_id','title','instructions'])) return false
  return text(v.task_key,64)&&/^[a-z][a-z0-9_-]{0,63}$/i.test(String(v.task_key))
    && (v.task_id===null||text(v.task_id,200))
    && text(v.area_id,200)&&text(v.title,300)&&text(v.instructions,12000,true)
}
function step(v:unknown) {
  if(!object(v)||!exact(v,['step_id','title','goal','brief','state','area_id','responsible_kind','responsible_person_id','notes','tasks','requirements'])) return false
  if(!Array.isArray(v.tasks)||v.tasks.length>20||!v.tasks.every(plannedTask)
    ||!Array.isArray(v.requirements)||v.requirements.length<1||v.requirements.length>20||!v.requirements.every(requirement)) return false
  const keys=new Set((v.tasks as Record<string,unknown>[]).map(t=>String(t.task_key)))
  if(keys.size!==v.tasks.length) return false
  for(const r of v.requirements as Record<string,unknown>[]) {
    const s=r.evidence_selector as Record<string,unknown>
    if(s.kind==='task'&&typeof s.id==='string'&&s.id.startsWith('@task:')&&!keys.has(s.id.slice(6))) return false
  }
  return (v.step_id===null||(typeof v.step_id==='string'&&uuid.test(v.step_id)))
    && text(v.title,240)&&text(v.goal,4000)&&text(v.brief,1600)&&['planned','active','blocked','completed'].includes(String(v.state))
    && (v.area_id===null||text(v.area_id,200))&&responsibility(v)&&text(v.notes,4000,true)
}

export function parsePlanWrite(name:string,value:unknown):WritePayload|null {
  if(!object(value)) return null
  const v=value
  if(name===PLAN_PROPOSAL_TOOL.function.name) {
    if(!exact(v,PLAN_PROPOSAL_TOOL.function.parameters.required)||!revision(v.expected_revision,true)
      ||!text(v.summary,4000)||!text(v.reason,4000)||!text(v.request_quote,500)
      ||!Array.isArray(v.steps)||v.steps.length<1||v.steps.length>30||!v.steps.every(step)
      ||v.steps.filter(s=>object(s)&&s.state==='active').length>1) return null
    return {kind:'plan_proposal',record_id:null,expected_updated_at:null,expected_revision:v.expected_revision as number,
      request_quote:v.request_quote as string,data:{summary:v.summary,reason:v.reason,steps:v.steps}}
  }
  if(name===PLAN_DECISION_TOOL.function.name) {
    if(!exact(v,PLAN_DECISION_TOOL.function.parameters.required)||!['approve','reject'].includes(String(v.action))
      ||!revision(v.proposal_revision)||!revision(v.expected_revision,true)||!text(v.decision_note,2000,true)||!text(v.request_quote,500)) return null
    return {kind:'plan_decision',record_id:null,expected_updated_at:null,expected_revision:v.expected_revision as number,
      request_quote:v.request_quote as string,data:{action:v.action,proposal_revision:v.proposal_revision,decision_note:v.decision_note}}
  }
  if(name===PLAN_EVIDENCE_TOOL.function.name) {
    if(!exact(v,PLAN_EVIDENCE_TOOL.function.parameters.required)||!revision(v.plan_revision)
      ||typeof v.requirement_id!=='string'||!uuid.test(v.requirement_id)
      ||!['resolves','conflicts','refines','supersedes'].includes(String(v.relation))
      ||!['measurement','media','artifact','material_requirement','solution','task'].includes(String(v.evidence_kind))
      ||!text(v.evidence_id,200)||(v.evidence_revision!==null&&!revision(v.evidence_revision))||!text(v.request_quote,500)) return null
    if(['measurement','artifact','material_requirement','solution'].includes(String(v.evidence_kind))
      ? v.evidence_revision===null : v.evidence_revision!==null) return null
    return {kind:'plan_evidence',record_id:null,expected_updated_at:null,expected_revision:v.plan_revision as number,
      request_quote:v.request_quote as string,data:{requirement_id:v.requirement_id,relation:v.relation,evidence_kind:v.evidence_kind,
        evidence_id:v.evidence_id,evidence_revision:v.evidence_revision}}
  }
  return null
}
