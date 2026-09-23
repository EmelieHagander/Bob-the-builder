import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { PLAN_PROPOSAL_TOOL, parsePlanWrite } from './project-plan.ts'
import type { createProjectLookup } from './project-lookup.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'

type Lookup = ReturnType<typeof createProjectLookup>
export type PlanAssistantModelCall = (options: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<any>>

const MODES=['compile_plan','audit_plan'] as const
type Mode=typeof MODES[number]
const MAX_CALLS=2
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const text=(v:unknown,n:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=n

export const PLAN_ASSISTANT_TOOL={
  type:'function' as const,
  function:{
    name:'consult_plan_assistant',
    description:'Ask Bob\'s read-only planning assistant to ground/compile Bob\'s project-manager plan or audit the current living plan. The assistant never changes project strategy and never writes project data; task_candidates are suggestions, not saved Step↔Task links. Bob decides what to save.',
    parameters:{
      type:'object',additionalProperties:false,
      properties:{
        mode:{type:'string',enum:[...MODES],description:'compile_plan turns Bob\'s plan intent into a grounded proposal shape. audit_plan checks the current approved plan against project facts.'},
        expected_revision:{type:'integer',minimum:0,description:'Current approved living-plan revision, or 0 when none exists.'},
        plan_intent:{type:['string','null'],description:'Bob\'s own project-manager plan in plain text. Required for compile_plan; null for audit_plan.'},
      },
      required:['mode','expected_revision','plan_intent'],
    },
  },
}

const proposalSteps=(PLAN_PROPOSAL_TOOL.function.parameters.properties as Record<string,any>).steps
const compilationSchema={
  type:'object',additionalProperties:false,
  properties:{
    expected_revision:{type:'integer',minimum:0},
    summary:{type:'string'},
    reason:{type:'string'},
    steps:proposalSteps,
    task_candidates:{
      type:'array',maxItems:40,items:{
        type:'object',additionalProperties:false,
        properties:{
          step_position:{type:'integer',minimum:1,maximum:30},
          task_id:{type:'string'},
          task_name:{type:'string'},
          reason:{type:'string'},
        },
        required:['step_position','task_id','task_name','reason'],
      },
    },
    observations:{type:'array',maxItems:30,items:{type:'string'}},
  },
  required:['expected_revision','summary','reason','steps','task_candidates','observations'],
}

const reviewSchema={
  type:'object',additionalProperties:false,
  properties:{
    ready_to_save:{type:'boolean'},
    summary:{type:'string'},
    issues:{
      type:'array',maxItems:40,items:{
        type:'object',additionalProperties:false,
        properties:{
          severity:{type:'string',enum:['info','warning','error']},
          code:{type:'string'},
          step_position:{type:['integer','null']},
          requirement_position:{type:['integer','null']},
          evidence_id:{type:['string','null']},
          message:{type:'string'},
          suggestion:{type:'string'},
        },
        required:['severity','code','step_position','requirement_position','evidence_id','message','suggestion'],
      },
    },
  },
  required:['ready_to_save','summary','issues'],
}

const COMPILER_SYSTEM=`You are Bob's Plan Compiler. Bob is the project manager. Bob's PLAN INTENT owns the project strategy, sequence and goals. You do not invent a different workflow and you do not write project data.

Your job is to translate Bob's intent into Bob's exact living-plan representation using only the authorised PROJECT SNAPSHOT. In audit_plan mode there is no new PLAN INTENT: preserve the current plan's strategy and repair only representation/grounding problems.

Rules:
- Keep Bob's strategic Step sequence. Ground names, Areas, existing Tasks and evidence to exact current project records.
- For an unfinished plan, produce exactly one active Step: the current Step Bob should be working in. Future Steps are planned/blocked. Reuse stable Step/Requirement IDs only when the current plan shows the same identity; genuinely new identities are null. Completed Steps are omitted because the server preserves completed history.
- Step notes are the Step Brief: Bob's compact self-prompt for that Step (purpose, focus, important constraints, what matters). It is not project truth.
- Tasks are actions. Completion Requirements are finish criteria. Do not mirror every Task as a requirement.
- A Completion Requirement must be atomic enough that its evidence can decide the whole condition. If width and height are independently evidenced, split them. If several independent facts are needed, split them.
- An exact measurement selector may be used only when that one current measurement semantically proves the entire requirement. Do not let an unrelated dimension satisfy a roof/placement/check requirement just because it exists.
- If current evidence conflicts, expose that in observations and keep a resolution criterion unsatisfied rather than pretending one conflicting value proves it.
- When a requirement has no adequate current evidence, use kind=none unless Bob's intent clearly defines one future measurement subject. Never invent an already-known fact.
- task_candidates contain only exact existing Tasks from the snapshot that operationally belong in a Step. They are advisory links, not completion proof. Do not use a Task evidence selector in this first assistant slice; the current deterministic resolver must not treat Task existence as Task completion.
- Responsibility never grants authority. Use exact project person ids only if the snapshot actually provides them; otherwise bob or unassigned.
- Do not add false precision to distant Steps.

Return only the structured compilation.`

const REVIEWER_SYSTEM=`You are Bob's Plan Reviewer. Bob remains the project manager and the compiler does not own strategy. Review the COMPILED PLAN against the same authorised PROJECT SNAPSHOT. Do not write data and do not redesign the project.

Mark ready_to_save=false when there is a known semantic error. In particular flag:
- zero or multiple active Steps while unfinished work exists;
- a Completion Requirement that bundles independently verifiable conditions under one evidence selector;
- evidence whose subject/value does not actually prove the full criterion;
- existing conflicting facts being represented as satisfied or simply ignored when the criterion is about resolving that conflict;
- an exact id that is absent from the supplied snapshot/current plan;
- a Task treated as proof merely because it exists;
- a strategic Step/goal change not supported by Bob's PLAN INTENT.

Use warnings (not errors) for incomplete snapshot coverage or reasonable uncertainty that Bob can resolve with an exact project lookup. Return concise issues and suggested representation fixes. Return only the structured review.`

const pick=(row:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]))
function compact(dataset:string,row:Record<string,unknown>){
  const keys:Record<string,string[]>={
    project:['id','name','description','phase','working_plan','updated_at'],
    areas:['id','name','phase','updated_at'],
    tasks:['id','name','status','area_id','instructions','updated_at'],
    measurements:['id','subject','value','unit','truth','area_id','revision','source','notes','recorded_at','updated_at'],
    components:['id','name','type','area_id','truth','notes','updated_at'],
    solutions:['id','title','revision','area_id','status','description','assumptions','updated_at'],
    target:['id','solution_id','solution_revision','title','area_id','updated_at'],
    artifacts:['id','title','revision','kind','status','area_id','archived','target_revision','updated_at'],
    requirements:['id','name','revision','area_id','task_id','status','quantity','unit','updated_at'],
  }
  if(dataset==='plan') return row
  return pick(row,keys[dataset]??['id','name','title','updated_at'])
}

async function page(lookup:Lookup,dataset:any,maxPages:number){
  const rows:Record<string,unknown>[]=[]
  let after:string|null=null,partial=false,status='empty'
  for(let i=0;i<maxPages;i++){
    const result=await lookup.search({dataset,query:null,status:null,area_id:null,record_id:null,after_id:after})
    status=result.status
    if(result.status==='denied') return {status:'denied',rows,partial:true}
    if(!['ok','empty'].includes(result.status)){partial=true;break}
    rows.push(...result.records.map(r=>compact(dataset,r)))
    if(!result.next_cursor) { partial ||= result.truncated; break }
    after=result.next_cursor; partial=true
  }
  return {status,rows,partial}
}

async function buildSnapshot(lookup:Lookup){
  const out:Record<string,unknown>={}
  let partial=false
  const singles=['project','areas','plan','target','components','solutions','artifacts','requirements'] as const
  for(const dataset of singles){
    const r=await page(lookup,dataset,1)
    if(r.status==='denied') throw new Error('project_denied')
    out[dataset]=r.rows; partial ||= r.partial
  }
  for(const dataset of ['tasks','measurements'] as const){
    const r=await page(lookup,dataset,2)
    if(r.status==='denied') throw new Error('project_denied')
    out[dataset]=r.rows; partial ||= r.partial
  }
  return {data:out,partial,sources:lookup.sources.slice()}
}

function localValidation(mode:Mode,input:Record<string,unknown>,compiled:any,snapshot:Record<string,unknown>){
  const issues:Array<Record<string,unknown>>=[]
  const expected=Number(input.expected_revision)
  if(compiled.expected_revision!==expected) issues.push({severity:'error',code:'revision_mismatch',step_position:null,requirement_position:null,evidence_id:null,message:'Compiler changed the expected plan revision.',suggestion:'Keep the exact current approved revision.'})
  const active=(compiled.steps??[]).filter((s:any)=>s.state==='active').length
  if((compiled.steps??[]).length>0&&active!==1) issues.push({severity:'error',code:'active_step_count',step_position:null,requirement_position:null,evidence_id:null,message:'An unfinished compiled plan must have exactly one active Step.',suggestion:'Choose the current Step and mark exactly that Step active.'})

  const current=((snapshot.plan as any[])?.[0]??null)
  const knownSteps=new Set<string>(),knownReqs=new Set<string>()
  for(const s of current?.steps??[]){if(s.id)knownSteps.add(String(s.id));for(const q of s.requirements??[])if(q.id)knownReqs.add(String(q.id))}
  const evidenceSets:Record<string,Set<string>>={
    measurement:new Set(((snapshot.measurements as any[])??[]).map((r:any)=>String(r.id))),
    artifact:new Set(((snapshot.artifacts as any[])??[]).map((r:any)=>String(r.id))),
    material_requirement:new Set(((snapshot.requirements as any[])??[]).map((r:any)=>String(r.id))),
    solution:new Set(((snapshot.solutions as any[])??[]).map((r:any)=>String(r.id))),
    task:new Set(((snapshot.tasks as any[])??[]).map((r:any)=>String(r.id))),
  }
  for(const [si,s] of (compiled.steps??[]).entries()){
    if(s.step_id&&(!knownSteps.has(String(s.step_id))||expected===0)) issues.push({severity:'error',code:'unknown_step_id',step_position:si+1,requirement_position:null,evidence_id:null,message:'Compiled plan used a Step id that is not in the current plan.',suggestion:'Use null for a genuinely new Step or the exact existing stable id.'})
    for(const [qi,q] of (s.requirements??[]).entries()){
      if(q.requirement_id&&(!knownReqs.has(String(q.requirement_id))||expected===0)) issues.push({severity:'error',code:'unknown_requirement_id',step_position:si+1,requirement_position:qi+1,evidence_id:null,message:'Compiled plan used a Requirement id that is not in the current plan.',suggestion:'Use null for a new criterion or the exact current id.'})
      const sel=q.evidence_selector
      if(sel?.kind==='task'&&sel.id) issues.push({severity:'error',code:'task_selector_not_completion_safe',step_position:si+1,requirement_position:qi+1,evidence_id:String(sel.id),message:'A Task selector cannot currently prove completion merely from Task existence.',suggestion:'Keep the Task as an operational Step link and use an independently verifiable completion criterion.'})
      else if(sel?.kind==='media'&&sel.id) issues.push({severity:'warning',code:'media_not_in_assistant_snapshot',step_position:si+1,requirement_position:qi+1,evidence_id:String(sel.id),message:'This assistant snapshot does not verify project media ids.',suggestion:'Bob should inspect the exact project image before saving this evidence selector.'})
      else if(sel?.id&&sel.kind!=='none'&&evidenceSets[String(sel.kind)]&&!evidenceSets[String(sel.kind)].has(String(sel.id))) {
        issues.push({severity:'error',code:'unknown_evidence_id',step_position:si+1,requirement_position:qi+1,evidence_id:String(sel.id),message:'Compiled plan used an exact evidence id absent from the authorised snapshot.',suggestion:'Use an exact current project record or leave the selector unresolved.'})
      }
    }
  }
  const tasks=new Map(((snapshot.tasks as any[])??[]).map((t:any)=>[String(t.id),t]))
  for(const c of compiled.task_candidates??[]){
    const task=tasks.get(String(c.task_id))
    if(!task) issues.push({severity:'error',code:'unknown_task_id',step_position:c.step_position,requirement_position:null,evidence_id:c.task_id,message:'Task candidate is absent from the authorised snapshot.',suggestion:'Use an exact existing Task id or omit the candidate.'})
    else if(String(task.name)!==String(c.task_name)) issues.push({severity:'warning',code:'task_name_mismatch',step_position:c.step_position,requirement_position:null,evidence_id:c.task_id,message:'Task candidate name does not match the current Task record.',suggestion:'Use the current Task name from project data.'})
  }
  if(mode==='audit_plan'&&!current) issues.push({severity:'error',code:'plan_missing',step_position:null,requirement_position:null,evidence_id:null,message:'There is no readable current plan to audit.',suggestion:'Compile an initial plan instead.'})
  return issues
}

function referencedSources(compiled:any,review:any,sources:ProjectSource[]){
  const ids=new Set<string>()
  for(const c of compiled?.task_candidates??[]) ids.add(String(c.task_id))
  for(const s of compiled?.steps??[]) for(const q of s.requirements??[]) if(q.evidence_selector?.id) ids.add(String(q.evidence_selector.id))
  for(const i of review?.issues??[]) if(i.evidence_id) ids.add(String(i.evidence_id))
  const chosen=sources.filter(s=>ids.has(s.recordId))
  return chosen.slice(0,24)
}

export function createPlanAssistant(opts:{
  projectId:string;userId:string;hasAccess:()=>Promise<boolean>;
  makeLookup:()=>Lookup;callModel:PlanAssistantModelCall;deadline?:number;
}){
  let used=0,partial=false
  const sources:ProjectSource[]=[]
  return {
    tools:[PLAN_ASSISTANT_TOOL],
    get remaining(){return Math.max(0,MAX_CALLS-used)},
    get partial(){return partial},
    get sources(){return sources.slice()},
    async consult(name:string,value:unknown){
      if(name!==PLAN_ASSISTANT_TOOL.function.name) return {status:'invalid',saved:false}
      if(++used>MAX_CALLS) {partial=true;return {status:'budget_exhausted',saved:false}}
      if(!object(value)||Object.keys(value).length!==3||!MODES.includes(value.mode as Mode)
        ||!Number.isSafeInteger(value.expected_revision)||Number(value.expected_revision)<0
        ||!(value.plan_intent===null||text(value.plan_intent,12000))
        ||(value.mode==='compile_plan'&&!text(value.plan_intent,12000))
        ||(value.mode==='audit_plan'&&value.plan_intent!==null)) return {status:'invalid',saved:false}
      if(!await opts.hasAccess()) return {status:'denied',saved:false}
      const deadline=opts.deadline??Date.now()+90000
      const lookup=opts.makeLookup()
      let snapshot:{data:Record<string,unknown>;partial:boolean;sources:ProjectSource[]}
      try{snapshot=await buildSnapshot(lookup)}catch(e){return {status:e instanceof Error&&e.message==='project_denied'?'denied':'unavailable',saved:false}}
      partial ||= snapshot.partial
      if(!await opts.hasAccess()) return {status:'denied',saved:false}
      const compiler=await opts.callModel({
        app:'bob',coworkerId:'bob',functionName:'plan-compiler',aiFunction:'plan-compiler',module:'living-plan',
        userId:opts.userId,systemMessage:COMPILER_SYSTEM,useHardcodedPrompt:true,
        prompt:JSON.stringify({mode:value.mode,expected_revision:value.expected_revision,plan_intent:value.plan_intent,project_snapshot:snapshot.data,snapshot_partial:snapshot.partial}),
        schemaName:'bob_plan_compilation',schema:compilationSchema,maxOutputTokens:8000,reasoningEffort:'low',
        timeoutMs:Math.max(5000,Math.min(40000,deadline-Date.now())),
      })
      if(!compiler.success||!compiler.data) {partial=true;return {status:'unavailable',saved:false,stage:'compiler'}}
      const compiled=compiler.data as any
      const dummy='assistant validation'
      const parsed=parsePlanWrite('propose_project_plan',{expected_revision:compiled.expected_revision,summary:compiled.summary,reason:compiled.reason,
        steps:compiled.steps,request_quote:dummy})
      const localIssues=localValidation(value.mode as Mode,value,compiled,snapshot.data)
      if(!parsed) localIssues.push({severity:'error',code:'invalid_plan_shape',step_position:null,requirement_position:null,evidence_id:null,
        message:'Compiler output does not satisfy the living-plan write contract.',suggestion:'Repair the structured plan before saving.'})
      if(!await opts.hasAccess()) return {status:'denied',saved:false}
      const reviewer=await opts.callModel({
        app:'bob',coworkerId:'bob',functionName:'plan-reviewer',aiFunction:'plan-reviewer',module:'living-plan',
        userId:opts.userId,systemMessage:REVIEWER_SYSTEM,useHardcodedPrompt:true,
        prompt:JSON.stringify({mode:value.mode,plan_intent:value.plan_intent,project_snapshot:snapshot.data,snapshot_partial:snapshot.partial,
          compiled_plan:compiled,local_validation_issues:localIssues}),
        schemaName:'bob_plan_review',schema:reviewSchema,maxOutputTokens:4000,reasoningEffort:'low',
        timeoutMs:Math.max(5000,Math.min(30000,deadline-Date.now())),
      })
      let review:any
      if(!reviewer.success||!reviewer.data){
        partial=true
        review={ready_to_save:false,summary:'Nano review unavailable.',issues:[{severity:'error',code:'review_unavailable',step_position:null,requirement_position:null,evidence_id:null,message:'The independent plan review did not complete.',suggestion:'Do not save the compiled plan without reviewing it yourself or retrying the assistant.'}]}
      }else review=reviewer.data
      review.issues=[...localIssues,...(Array.isArray(review.issues)?review.issues:[])]
      if(review.issues.some((i:any)=>i.severity==='error')) review.ready_to_save=false
      for(const s of referencedSources(compiled,review,snapshot.sources)) if(!sources.some(x=>x.dataset===s.dataset&&x.recordId===s.recordId)) sources.push(s)
      return {
        status:'ok',saved:false,mode:value.mode,compiled_plan:{
          expected_revision:compiled.expected_revision,summary:compiled.summary,reason:compiled.reason,steps:compiled.steps,
        },task_candidates:compiled.task_candidates??[],observations:compiled.observations??[],
        review,context:{partial:snapshot.partial,records:Object.fromEntries(Object.entries(snapshot.data).map(([k,v])=>[k,Array.isArray(v)?v.length:0]))},
        assistant_models:{compiler:compiler.model,reviewer:reviewer.model},
        note:'Read-only advisory result. Bob owns the plan decision. Use the normal living-plan write tools only after Bob judges this compilation represents the intended project strategy.',
      }
    },
  }
}
