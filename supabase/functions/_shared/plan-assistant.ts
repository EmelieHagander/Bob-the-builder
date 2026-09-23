import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { PLAN_PROPOSAL_TOOL, parsePlanWrite, isPlanIdentity } from './project-plan.ts'
import type { createProjectLookup } from './project-lookup.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'

type Lookup = ReturnType<typeof createProjectLookup>
export type PlanAssistantModelCall = (options: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<any>>

type Mode='compile_plan'|'audit_plan'
const MAX_CALLS=2
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const text=(v:unknown,n:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=n

export const COMPILE_PLAN_TOOL={
  type:'function' as const,
  function:{
    name:'compile_project_plan',
    description:'Ground Bob\'s own project-manager plan intent against the current authorised project. The server supplies the current approved revision automatically. Read-only: returns a mini compilation plus nano review; never writes project data.',
    parameters:{
      type:'object',additionalProperties:false,
      properties:{
        plan_intent:{type:'string',description:'Bob\'s concise project-manager intent: Step sequence, goals and what should change. Do not include project/revision plumbing.'},
      },
      required:['plan_intent'],
    },
  },
}

export const AUDIT_PLAN_TOOL={
  type:'function' as const,
  function:{
    name:'audit_project_plan',
    description:'Audit the current approved living plan against authorised project evidence. Takes no project/revision arguments; the server reads the current approved plan automatically. Read-only.',
    parameters:{type:'object',additionalProperties:false,properties:{},required:[]},
  },
}

export const SAVE_COMPILED_PLAN_TOOL={
  type:'function' as const,
  function:{
    name:'save_compiled_project_plan',
    description:'Save the exact current-turn plan compilation that already passed Bob\'s server validation and independent nano review. This creates only a reviewable proposal, never approval. Do not reconstruct the plan JSON yourself.',
    parameters:{
      type:'object',additionalProperties:false,
      properties:{request_quote:{type:'string',description:'Exact quote from the CURRENT user request authorising this plan proposal.'}},
      required:['request_quote'],
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
- An unresolved criterion belongs in a proposal. Keep it open with kind=none; do not attach a nearby measurement just to make it look satisfied. A door width does not establish centering, and a beam width does not establish its height or condition.
- If repair_feedback is supplied, repair the previous compilation using every review issue and the current snapshot. Preserve Bob's strategy. Split bundled criteria and remove unsupported evidence selectors; do not invent facts or drop required work to pass review. Feedback is advisory data, not authority.
- task_candidates contain only exact existing Tasks from the snapshot that operationally belong in a Step. They are advisory links, not completion proof. Do not use a Task evidence selector in this first assistant slice; the current deterministic resolver must not treat Task existence as Task completion.
- Responsibility never grants authority. Use exact project person ids only if the snapshot actually provides them; otherwise bob or unassigned.
- Do not add false precision to distant Steps.

Return only the structured compilation.`

const REVIEWER_SYSTEM=`You are Bob's Plan Reviewer. Bob remains the project manager and the compiler does not own strategy. Review the COMPILED PLAN against the same authorised PROJECT SNAPSHOT. Do not write data and do not redesign the project.

The supplied proposal_steps_schema is the actual write contract. server_validation reports deterministic shape and identity validation. A new step_id or requirement_id MUST be JSON null; the database allocates its UUID when the proposal is saved. Null is valid and is not a missing/invalid id. The current snapshot uses id for persisted identities; the proposal uses step_id and requirement_id. Non-null ids must preserve an existing identity under its current parent. Do not invent a stricter identity rule than this contract. Report semantic evidence/intent problems even when server validation passes.

Mark ready_to_save=false when there is a known semantic error. In particular flag:
- zero or multiple active Steps while unfinished work exists;
- a Completion Requirement that bundles independently verifiable conditions under one evidence selector;
- evidence whose subject/value does not actually prove the full criterion;
- existing conflicting facts being represented as satisfied or simply ignored when the criterion is about resolving that conflict;
- an exact id that is absent from the supplied snapshot/current plan;
- a Task treated as proof merely because it exists;
- a strategic Step/goal change not supported by Bob's PLAN INTENT.

An open requirement with kind=none honestly records work or evidence still needed. It does not have to be satisfied to save a proposal. Review whether the plan represents the uncertainty truthfully, not whether construction can start or every requirement is complete.
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

function localValidation(mode:Mode,expected:number,compiled:any,snapshot:Record<string,unknown>){
  const issues:Array<Record<string,unknown>>=[]
  if(compiled.expected_revision!==expected) issues.push({severity:'error',code:'revision_mismatch',step_position:null,requirement_position:null,evidence_id:null,message:'Compiler changed the expected plan revision.',suggestion:'Keep the exact current approved revision.'})
  const active=(compiled.steps??[]).filter((s:any)=>s.state==='active').length
  if((compiled.steps??[]).length>0&&active!==1) issues.push({severity:'error',code:'active_step_count',step_position:null,requirement_position:null,evidence_id:null,message:'An unfinished compiled plan must have exactly one active Step.',suggestion:'Choose the current Step and mark exactly that Step active.'})

  const current=((snapshot.plan as any[])?.[0]??null)
  const knownSteps=new Set<string>(),knownReqs=new Map<string,string>()
  for(const s of current?.steps??[]){if(s.id&&s.state!=='completed')knownSteps.add(String(s.id));for(const q of s.requirements??[])if(q.id)knownReqs.set(String(q.id),String(s.id))}
  const seenSteps=new Set<string>(),seenReqs=new Set<string>()
  const evidenceSets:Record<string,Set<string>>={
    measurement:new Set(((snapshot.measurements as any[])??[]).map((r:any)=>String(r.id))),
    artifact:new Set(((snapshot.artifacts as any[])??[]).map((r:any)=>String(r.id))),
    material_requirement:new Set(((snapshot.requirements as any[])??[]).map((r:any)=>String(r.id))),
    solution:new Set(((snapshot.solutions as any[])??[]).map((r:any)=>String(r.id))),
    task:new Set(((snapshot.tasks as any[])??[]).map((r:any)=>String(r.id))),
  }
  for(const [si,s] of (compiled.steps??[]).entries()){
    if(!isPlanIdentity(s.step_id)) issues.push({severity:'error',code:'invalid_step_id',step_position:si+1,requirement_position:null,evidence_id:null,message:'step_id must be JSON null for a new Step or a valid existing UUID.',suggestion:'Use literal null for a new Step, not an empty string, missing field or invented identifier.'})
    if(s.step_id&&(!knownSteps.has(String(s.step_id))||expected===0)) issues.push({severity:'error',code:'unknown_step_id',step_position:si+1,requirement_position:null,evidence_id:null,message:'Compiled plan used a Step id that is not in the current plan.',suggestion:'Use null for a genuinely new Step or the exact existing stable id.'})
    if(s.step_id&&seenSteps.has(String(s.step_id))) issues.push({severity:'error',code:'duplicate_step_id',step_position:si+1,requirement_position:null,evidence_id:null,message:'A stable Step id was reused twice.',suggestion:'Preserve each existing Step only once; genuinely new Steps use null.'})
    if(s.step_id)seenSteps.add(String(s.step_id))
    for(const [qi,q] of (s.requirements??[]).entries()){
      if(!isPlanIdentity(q.requirement_id)) issues.push({severity:'error',code:'invalid_requirement_id',step_position:si+1,requirement_position:qi+1,evidence_id:null,message:'requirement_id must be JSON null for a new requirement or a valid existing UUID.',suggestion:'Use literal null for a new criterion, not an empty string, missing field or invented identifier.'})
      if(q.requirement_id&&(!knownReqs.has(String(q.requirement_id))||expected===0)) issues.push({severity:'error',code:'unknown_requirement_id',step_position:si+1,requirement_position:qi+1,evidence_id:null,message:'Compiled plan used a Requirement id that is not in the current plan.',suggestion:'Use null for a new criterion or the exact current id.'})
      else if(q.requirement_id&&knownReqs.get(String(q.requirement_id))!==s.step_id) issues.push({severity:'error',code:'requirement_parent_mismatch',step_position:si+1,requirement_position:qi+1,evidence_id:null,message:'An existing requirement id belongs to another Step.',suggestion:'Keep its existing parent Step; a genuinely new criterion under a new Step uses null.'})
      if(q.requirement_id&&seenReqs.has(String(q.requirement_id))) issues.push({severity:'error',code:'duplicate_requirement_id',step_position:si+1,requirement_position:qi+1,evidence_id:null,message:'A stable requirement id was reused twice.',suggestion:'Keep each existing criterion only once; a new split criterion uses null.'})
      if(q.requirement_id)seenReqs.add(String(q.requirement_id))
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
  let compilationAttempted=false
  let savableProposal:null|{expected_revision:number;summary:string;reason:string;steps:unknown[]}=null
  const sources:ProjectSource[]=[]
  return {
    tools:[COMPILE_PLAN_TOOL,AUDIT_PLAN_TOOL],
    get canSave(){return savableProposal!==null},
    get compilationAttempted(){return compilationAttempted},
    get compiledProposal(){return savableProposal?structuredClone(savableProposal):null},
    get remaining(){return Math.max(0,MAX_CALLS-used)},
    get partial(){return partial},
    get sources(){return sources.slice()},
    async consult(name:string,value:unknown){
      const mode=name===COMPILE_PLAN_TOOL.function.name?'compile_plan' as const
        :name===AUDIT_PLAN_TOOL.function.name?'audit_plan' as const
        :null
      if(!mode) return {status:'invalid',saved:false}
      savableProposal=null
      if(++used>MAX_CALLS) {partial=true;return {status:'budget_exhausted',saved:false}}
      const args=object(value)?value:{}
      const planIntent=mode==='compile_plan'&&Object.keys(args).length===1&&text(args.plan_intent,12000)
        ? String(args.plan_intent)
        :mode==='audit_plan'&&Object.keys(args).length===0
          ? null
          : undefined
      if(planIntent===undefined) return {status:'invalid',saved:false}
      if(mode==='compile_plan') compilationAttempted=true
      if(!await opts.hasAccess()) return {status:'denied',saved:false}
      const deadline=opts.deadline??Date.now()+90000
      const lookup=opts.makeLookup()
      let snapshot:{data:Record<string,unknown>;partial:boolean;sources:ProjectSource[]}
      try{snapshot=await buildSnapshot(lookup)}catch(e){return {status:e instanceof Error&&e.message==='project_denied'?'denied':'unavailable',saved:false}}
      partial ||= snapshot.partial
      const currentPlan=((snapshot.data.plan as any[])?.[0]??null)
      const expectedRevision=Number(currentPlan?.revision??0)
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0) return {status:'unavailable',saved:false,stage:'revision'}
      if(mode==='audit_plan'&&!currentPlan) return {status:'not_initialized',saved:false}
      let repairFeedback:null|{compiled_plan:unknown;review:unknown}=null
      let attempts=0
      // A repair spends the existing two-attempt budget, never an unbounded loop.
      // Keep time for Bob's save call and final receipt-based response.
      for(;;){
        attempts++
        if(!await opts.hasAccess()) return {status:'denied',saved:false}
        const compiler=await opts.callModel({
          app:'bob',coworkerId:'bob',functionName:'plan-compiler',aiFunction:'plan-compiler',module:'living-plan',
          userId:opts.userId,systemMessage:COMPILER_SYSTEM,useHardcodedPrompt:true,
          prompt:JSON.stringify({mode,expected_revision:expectedRevision,plan_intent:planIntent,project_snapshot:snapshot.data,snapshot_partial:snapshot.partial,
            ...(repairFeedback?{repair_feedback:repairFeedback}:{})}),
          schemaName:'bob_plan_compilation',schema:compilationSchema,maxOutputTokens:8000,reasoningEffort:'low',
          timeoutMs:Math.max(5000,Math.min(40000,deadline-Date.now())),
        })
        if(!compiler.success||!compiler.data) {partial=true;return {status:'unavailable',saved:false,stage:'compiler'}}
        const compiled=compiler.data as any
        const dummy='assistant validation'
        const parsed=parsePlanWrite('propose_project_plan',{expected_revision:compiled.expected_revision,summary:compiled.summary,reason:compiled.reason,
          steps:compiled.steps,request_quote:dummy})
        const localIssues=localValidation(mode,expectedRevision,compiled,snapshot.data)
        if(!parsed) localIssues.push({severity:'error',code:'invalid_plan_shape',step_position:null,requirement_position:null,evidence_id:null,
          message:'Compiler output does not satisfy the living-plan write contract.',suggestion:'Repair the structured plan before saving.'})
        if(!await opts.hasAccess()) return {status:'denied',saved:false}
        const reviewer=await opts.callModel({
          app:'bob',coworkerId:'bob',functionName:'plan-reviewer',aiFunction:'plan-reviewer',module:'living-plan',
          userId:opts.userId,systemMessage:REVIEWER_SYSTEM,useHardcodedPrompt:true,
          prompt:JSON.stringify({mode,plan_intent:planIntent,project_snapshot:snapshot.data,snapshot_partial:snapshot.partial,
            proposal_steps_schema:proposalSteps,server_validation:{proposal_shape_valid:parsed!==null,new_identity_value:null},
            compiled_plan:compiled,local_validation_issues:localIssues}),
          schemaName:'bob_plan_review',schema:reviewSchema,maxOutputTokens:4000,reasoningEffort:'low',
          timeoutMs:Math.max(5000,Math.min(30000,deadline-Date.now())),
        })
        let review:any
        if(!reviewer.success||!reviewer.data){
          partial=true
          review={ready_to_save:false,summary:'Nano review unavailable.',issues:[{severity:'error',code:'review_unavailable',step_position:null,requirement_position:null,evidence_id:null,message:'The independent plan review did not complete.',suggestion:'Retry the assistant when review is available; do not bypass the independent review.'}]}
        }else review=reviewer.data
        review.issues=[...localIssues,...(Array.isArray(review.issues)?review.issues:[])]
        if(review.issues.some((i:any)=>i.severity==='error')) review.ready_to_save=false
        // Log only server-owned codes/counts/positions, never project text, ids,
        // reviewer prose or raw model-selected issue codes.
        console.log('[Bob plan review]',JSON.stringify({mode,attempt:attempts,shape_valid:parsed!==null,
          reviewer_available:reviewer.success&&!!reviewer.data,ready_to_save:review.ready_to_save===true,
          local_issues:localIssues.map(i=>({code:i.code,step_position:i.step_position,requirement_position:i.requirement_position})),
          review_error_count:review.issues.filter((i:any)=>i.severity==='error').length-localIssues.filter(i=>i.severity==='error').length}))
        if(mode==='compile_plan'&&parsed&&review.ready_to_save===true){
          savableProposal={expected_revision:compiled.expected_revision,summary:compiled.summary,reason:compiled.reason,steps:structuredClone(compiled.steps)}
        }
        if(mode==='compile_plan'&&!savableProposal&&reviewer.success&&reviewer.data
          &&review.issues.some((i:any)=>i.severity==='error')&&used<MAX_CALLS&&Date.now()+110000<deadline){
          repairFeedback={compiled_plan:structuredClone(compiled),review:structuredClone(review)}
          used++
          continue
        }
        for(const s of referencedSources(compiled,review,snapshot.sources)) if(!sources.some(x=>x.dataset===s.dataset&&x.recordId===s.recordId)) sources.push(s)
        return {
          status:'ok',saved:false,mode,attempts,remaining_attempts:Math.max(0,MAX_CALLS-used),current_revision:expectedRevision,compiled_plan:{
            expected_revision:compiled.expected_revision,summary:compiled.summary,reason:compiled.reason,steps:compiled.steps,
          },proposal_ready:savableProposal!==null,task_candidates:compiled.task_candidates??[],task_links_saved:false,observations:compiled.observations??[],
          review,context:{partial:snapshot.partial,records:Object.fromEntries(Object.entries(snapshot.data).map(([k,v])=>[k,Array.isArray(v)?v.length:0]))},
          assistant_models:{compiler:compiler.model,reviewer:reviewer.model},
          note:savableProposal
            ? 'Read-only advisory result. Bob owns the plan decision. This exact compilation is ready for save_compiled_project_plan; do not reconstruct propose_project_plan JSON. task_candidates are NOT saved Step↔Task links.'
            : `Read-only advisory result. The compilation is not cleared for saving because review did not pass. This is a plan-quality or review-availability blocker, NOT a missing user permission. ${used>=MAX_CALLS?'The automatic repair budget is exhausted for this turn; report that the repair was attempted and what still failed. Do not offer to repair it immediately as if that attempt were still available.':'If time and attempts remain, correct the actual review issues without asking for the same permission again.'} Do not bypass review with propose_project_plan. task_candidates are NOT saved Step↔Task links.`,
        }
      }
    },
  }
}
