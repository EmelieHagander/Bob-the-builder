import { readPhysicalCadSources } from './cad-physical-lineage.ts'
import { parameterSourcePins } from './cad-parameters.ts'
import { createConstructionTools, checkedConstructionForDrawing } from './construction-draft.ts'
import { readBudgetStop } from './bob-budget-stop.ts'
import {drawingResumeReply} from './drawing-resume-reply.ts'
import {drawingRuntimeVersion} from './drawing-runtime.ts'
import { hydrateCurrentView, createCurrentViewReader, type CurrentViewClient } from './current-view.ts'
import { createCurrentViewGuard } from './current-view-guard.ts'
import { parseBobScreen, type BobScreenPointer, type CurrentView } from '../../../src/domain/bobScreen.ts'
import {createDrawingBudget} from './drawing-budget.ts'
import {createDrawingRequestStore} from './drawing-request-store.ts'
import { createBobModelBudget } from './bob-model-budget.ts'
import { createExecutionMetrics } from './execution-metrics.ts'
import { AIBackgroundPending } from './ai-background.ts'
import { hasImageContent } from './openai-content.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { createKnowledgeReader } from './building-knowledge.ts'
import { createOperationalReader } from './project-operations.ts'
import { BobContinuation, type BobJournal, type JournalIdentity } from './bob-job-journal.ts'
export const RESEND_NOTICE = 'Obs: ett modellanrop tappade kontakten innan svaret kom fram och skickades om en gång. Det första försöket kan ha debiterats, så den här turen kan ha kostat något mer än vanligt.'
import type { OpenAIServiceOptions } from './openai-service.ts'
import { createRecordDetailReader } from './project-record-detail.ts'
import { createProjectImageTools } from './project-image-tools.ts'
import { createCadAssistant } from './cad-assistant.ts'
import { createCadTransport } from './cad-transport.ts'
import { createMaterialCatalogReader } from './material-catalog.ts'
import { createToolPolicyReader } from './project-tools/policy-reader.ts'
import { createGroundedModelCall } from './project-grounding.ts'
import { createProjectContext, type Opened } from './project-context/dispatcher.ts'
import { createMediaAdapter, resolveMediaImage } from './project-context/media.ts'
import { createMediaTransport } from './project-context/media-transport.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { callOpenAIResponses, generateImage } from './openai-service.ts'
import { createBobConversationStore, type BobTurnClaim } from './bob-conversation.ts'
import { createProjectLookup, type LookupInput } from './project-lookup.ts'
import { createPlanAssistant } from './plan-assistant.ts'
import type { ProjectAnswer, TurnProgress } from './project-answer.ts'
import { createProjectWriter } from './project-write.ts'
import { prepareWorkingContext } from './bob-working-context.ts'
import { runClaimedProjectTurn } from './project-turn.ts'

/** Project reads and writes use the caller JWT. Service access is restricted to shared AI
 * config/accounting, content-free execution diagnostics and Bob's private transcript/provider-state commands. */
export async function answerWithOpenAi(opts: {
  authHeader: string; userId: string; projectId: string; message: string; clientTurnId: string;
  screen?: BobScreenPointer | null;
  background?: { drawingRequestId?:string; jobId?: string; asyncModels?: boolean; claim: Extract<BobTurnClaim, { status: 'claimed'; mode: 'server' }>; journal: BobJournal; deadline: number; replay: boolean; progress?: (value: TurnProgress) => void };
}): Promise<ProjectAnswer> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || !serviceKey) return { ok: false, error: 'not_configured' }

  const client = createClient(url, key, {
    db: { schema: 'bob' }, global: { headers: { Authorization: opts.authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const internal = createClient(url, serviceKey, {
    db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false },
  })
  const conversations = createBobConversationStore(internal)
  const journal = opts.background?.journal
  // The owner chose to hear about possibly double-billed re-sends (K5, 2026-10-07).
  const withResendNotice = (answer: string) => journal && journal.uncertainResends() > 0 && !answer.includes(RESEND_NOTICE)
    ? answer + '\n\n' + RESEND_NOTICE : answer
  const memo = async <T>(stream: string, input: unknown, work: (identity?: JournalIdentity) => Promise<T>, reserve = 0): Promise<T> =>
    journal ? journal.run(stream, input, work, reserve) : work()
  const rpc = async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
    const { p_generation: _generation, ...stable } = args
    return memo('rpc:' + name, stable, async () => {
      const { data, error } = await client.rpc(name, args).abortSignal(signal)
      return { data, error }
    })
  }
  let metrics:ReturnType<typeof createExecutionMetrics>|undefined
  const mediaTransport = createMediaTransport(client, { ...opts, url, key })
  const imageRefs = new Map<string, Opened>()
  const resolveImage = async (ref: string) => {
    const record = imageRefs.get(ref)
    if (!record) throw new Error('image_not_opened')
    return resolveMediaImage(opts.projectId, mediaTransport, record, AbortSignal.timeout(12000))
  }
  // Background workers live ~150 s. Reserve a realistic duration per role, not the
  // full timeout, so several calls share one segment; a call cut off at the segment
  // wall yields into a fresh segment, consuming the same bounded retry budget
  // as other dispatched failures. Durable AI waiting does not consume retries.
  const RESERVE_MS: Record<string, number> = { 'ask-bob': 75000, 'cad-designer': 75000, 'cad-reviewer': 60000, 'plan-compiler': 45000, 'plan-reviewer': 30000, 'context-summary': 30000, 'bob-delivery-language': 15000 }
  let drawingRequestId:string|null=null
  let drawingBudget:ReturnType<typeof createDrawingBudget>|undefined
  const modelBudget = createBobModelBudget()
  const callModel = async (options: OpenAIServiceOptions, beforeDispatch?:()=>Promise<void>) => modelBudget.run(async () => {
   const timeout = options.timeoutMs ?? 120000
   const asyncModels = !!(opts.background?.asyncModels && opts.background.jobId)
   try{return await memo('model:' + options.functionName, options, async identity => {
    await beforeDispatch?.()
    const started = performance.now()
    const wall = journal ? journal.remaining() + 8000 : Infinity
    const allowed = Math.max(1000, Math.min(timeout, wall))
    let result
    try {
      const invoke=(recovery?:{key:string;context:Record<string,unknown>;expiresAt:string})=>callOpenAIResponses<string>({ ...options, timeoutMs: allowed, resolveImage,
        ...(asyncModels && identity ? { background: {
          key: opts.background!.jobId + '/' + identity.key, fingerprint: identity.fingerprint, receiver: 'bob',
          context: { jobId: opts.background!.jobId, role: options.aiFunction },
          expiresAt: new Date(opts.background!.deadline).toISOString(),
          ...recovery,
        } } : {}),
      })
      result=drawingRequestId&&drawingBudget?await drawingBudget(drawingRequestId,options,invoke):await invoke()
    } catch (error) {
      if (error instanceof AIBackgroundPending) throw new BobContinuation('yield', 'ai_wait', { id: error.jobId, accepted: error.accepted, role: options.aiFunction })
      throw error
    }
    await metrics?.model({...options,timeoutMs:allowed},result,performance.now()-started,{step:identity?.key??null,attempt:identity?.attempt??0})
    console.log('[Bob model]', JSON.stringify({ role:options.aiFunction, success:result.success, elapsed_ms:Math.round(performance.now()-started), input_tokens:result.usage.input_tokens, output_tokens:result.usage.output_tokens }))
    if (journal && !result.success && allowed < timeout && performance.now() - started >= allowed - 1500) throw new BobContinuation('yield', 'segment_wall')
    // A definite provider rejection produced no billable output; a lost
    // connection may have been billed, so the journal re-sends it once and reports it.
    if (journal && !result.success && /OpenAI API error: (429|5[0-9]{2})/.test(result.error ?? '')) throw new BobContinuation('yield', 'provider_retry')
    if (journal && !result.success && /Network error/.test(result.error ?? '')) throw new BobContinuation('yield', 'provider_uncertain')
    return result
   }, asyncModels ? (options.images?.length || hasImageContent(options.messages) ? 45000 : 25000)
     : Math.min(timeout, RESERVE_MS[options.aiFunction] ?? 45000))}catch(error){
    if(error instanceof Error&&error.message==='provider_retry_exhausted')return {success:false,data:null,model:'unavailable',usage:{input_tokens:0,output_tokens:0,total_tokens:0},error:'provider_retry_exhausted'}
    throw error
   }
  },options.aiFunction).then(result=>{
   const stop=readBudgetStop(result)
   if(stop)console.warn('[Bob budget stop]',JSON.stringify({role:options.aiFunction,job_id:opts.background?.jobId??null,...stop}))
   return result
  })
  const mediaAdapter = () => {
    const adapter = createMediaAdapter(opts.projectId, mediaTransport, true)
    return { ...adapter,
      count: (signal: AbortSignal) => memo('media:count', {}, () => adapter.count(signal)),
      list: (...args: Parameters<typeof adapter.list>) => memo('media:list', args[0], () => adapter.list(...args)),
      open: async (...args: Parameters<typeof adapter.open>) => {
        const opened = await memo('media:open', args[0], () => adapter.open(...args))
        // Rebuild the resolver registry from compact checkpoints on every resume.
        if (opened.image.image_url.startsWith('private-image:')) imageRefs.set(opened.image.image_url, opened)
        return opened
      },
      // current() remains LIVE, including for already-replayed image evidence.
    }
  }
  const lookupTransport = (projectId: string, input: LookupInput, signal: AbortSignal) =>
    rpc('search_bob_project_data_v8', {
      p_project_id: projectId, p_dataset: input.dataset, p_query: input.query,
      p_status: input.status, p_area_id: input.area_id, p_record_id: input.record_id, p_after_id: input.after_id ?? null,
    }, signal)
  const projectLookup = createProjectLookup(opts.projectId, lookupTransport, 10_000, 32)
  const groundingLookup = createProjectLookup(opts.projectId, lookupTransport, 10_000, 48)
  const lookup = { ...projectLookup, get remaining() { return projectLookup.remaining }, get partial() { return projectLookup.partial || groundingLookup.partial }, sources: projectLookup.sources }
  const imageGrounding = { async search(input: LookupInput) {
    const result = await groundingLookup.search(input)
    for (const source of groundingLookup.sources) if (!lookup.sources.some(s => s.dataset===source.dataset && s.recordId===source.recordId)) lookup.sources.push(source)
    return result
  } }
  const hasAccess = async () => {
    const { data, error } = await client.from('projects').select('id').eq('id', opts.projectId)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    return !error && data?.id === opts.projectId
  }

  if (!await hasAccess()) return { ok: false, error: 'project_denied' }
  let claim: BobTurnClaim
  try {
    claim = opts.background?.claim ?? await conversations.claim(opts.projectId, opts.userId, opts.clientTurnId, opts.message)
  } catch (error) {
    return { ok: false, error: String(error).includes('project_denied') ? 'project_denied' : 'conversation_unavailable' }
  }
  if (claim.mode === 'server' && claim.status === 'completed') {
    return { ok: true, answer: claim.answer, projectId: opts.projectId, evidence: claim.evidence }
  }
  if (claim.mode === 'server' && (claim.status === 'in_flight' || claim.status === 'thread_busy')) {
    return { ok: false, error: 'turn_in_flight' }
  }
  const claimedServer = claim.mode === 'server' && claim.status === 'claimed' ? claim : null
  const deadline = opts.background?.deadline ?? Date.now() + 215000
  const execution=await memo('execution:identity',{},async()=>({id:crypto.randomUUID(),startedAt:Date.now()}))
  metrics=createExecutionMetrics({runId:execution.id,turnId:opts.clientTurnId,startedAt:execution.startedAt,write:async event=>{
    const {error}=await internal.from('execution_events').upsert(event,{onConflict:'run_id,event_key'}).abortSignal(AbortSignal.timeout(3000))
    if(error)throw new Error('metrics_unavailable')
  }})
  const threadId = claimedServer?.thread_id ?? null
  const binding = { p_project: opts.projectId, p_thread: threadId, p_turn: opts.clientTurnId, p_generation: claimedServer?.generation }
  let currentView: CurrentView | undefined
  let validateCurrentView: (() => Promise<boolean>) | undefined
  let getCurrentViewEvidence: (() => CurrentView) | undefined
  if (!opts.background?.drawingRequestId) {
    try {
      const screen = claimedServer && threadId
        ? await conversations.captureScreen({ projectId: opts.projectId, userId: opts.userId, threadId,
          turnId: opts.clientTurnId, generation: claimedServer.generation }, opts.screen)
        : parseBobScreen(opts.screen)
      if (screen) {
        // Erase the SDK's recursive schema inference at this fixed-query seam.
        // The reader validates unknown results and preserves this caller client.
        const reader = createCurrentViewReader(client as unknown as CurrentViewClient, opts.userId)
        const read = () => hydrateCurrentView({ projectId: opts.projectId, screen, reader })
        // A lease replay rebuilds the same model input; only fresh caller reads
        // can authorize its reuse. Never journal the freshness check itself.
        currentView = await memo('context:current_view', screen, read)
        const guard = createCurrentViewGuard({ initial: currentView, read, hasAccess,
          receipts: () => writer?.receipts ?? [] })
        validateCurrentView = guard.validate
        getCurrentViewEvidence = guard.evidence
        lookup.sources.push(...currentView.sources)
      }
    } catch (error) {
      rethrowContinuation(error)
      if (threadId && claimedServer) {
        try { await conversations.fail(opts.projectId, opts.userId, threadId, opts.clientTurnId, claimedServer.generation) } catch { /* normal lease recovery */ }
      }
      return { ok: false, error: 'context_unavailable' }
    }
  }
  // The v16 wrapper preserves all older write kinds and the same claimed-turn ledger.
  const writer = claimedServer ? createProjectWriter(opts.projectId, opts.message,
    payload => rpc('bob_project_write_v16', { ...binding, p_payload: payload }, AbortSignal.timeout(12_000)),
    () => client.rpc('bob_read_write_receipts', binding).abortSignal(AbortSignal.timeout(12_000)),
    () => client.rpc('bob_settle_project_writes', binding).abortSignal(AbortSignal.timeout(12_000)),
  ) : undefined
  const projectContext = createProjectContext({
    adapters: [mediaAdapter()],
    hasAccess, sources: lookup.sources,
    ...(claimedServer ? { describe: (record: Opened, description: string) => memo('media:describe', { ref: record.item.ref, version: record.version, description }, async () => {
      const { error } = await internal.rpc('bob_describe_image', { ...binding, p_user: opts.userId,
        p_media: record.source.recordId, p_version: record.version, p_updated_at: record.source.updatedAt, p_description: description,
      }).abortSignal(AbortSignal.timeout(10000))
      if (error) throw new Error('description_unavailable')
      return true
    }) } : {}),
  })
  const knowledgeReader = createKnowledgeReader(hasAccess)
  const operationalReader = createOperationalReader(opts.projectId, input=>rpc('read_project_work', {p_project:opts.projectId,p_input:input}, AbortSignal.timeout(12000)),hasAccess,lookup.sources)
  const catalogReader = createMaterialCatalogReader(opts.projectId,
    (input, signal) => rpc('catalog_read', { p_project: opts.projectId, p_input: input }, signal),
    hasAccess, lookup.sources)
  const constructionOptions = {projectId:opts.projectId,message:opts.message,writer,hasAccess,
    // Earlier RPC results reconstruct a resumed turn. A current-source gate
    // must bypass that journal before it calls a list/check result current.
    readCurrent:async(id:string)=>{
      const {data,error}=await client.rpc('read_construction_draft',{p_project:opts.projectId,p_artifact:id,p_revision:null,p_after:null}).abortSignal(AbortSignal.timeout(12000))
      if(error)throw new Error('construction_read_unavailable');return data
    },
    read:async(id:string|null,revision:number|null,after:string|null)=>{
      const {data,error}=await rpc('read_construction_draft',{p_project:opts.projectId,p_artifact:id,p_revision:revision,p_after:after},AbortSignal.timeout(12000))
      if(error)throw new Error('construction_read_unavailable');return data
    },
    readCatalog:async(id:string,revision:number)=>{
      const {data,error}=await rpc('catalog_read',{p_project:opts.projectId,p_input:{action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}},AbortSignal.timeout(12000))
      if(error)throw new Error('construction_source_unavailable');return data
    },
    readSources:async (pins:ReturnType<typeof parameterSourcePins>)=>{
      const project=new Map<string,Record<string,any>>()
      if(pins.project.length){
        const {data,error}=await client.from('current_measurements').select('*').eq('project_id',opts.projectId).in('id',pins.project.map(p=>p.id)).abortSignal(AbortSignal.timeout(10000))
        if(error)throw new Error('construction_source_unavailable');for(const row of data??[])project.set(row.id,row)
      }
      const physical=await readPhysicalCadSources(()=>createProjectLookup(opts.projectId,lookupTransport,10000,64),pins.physical,lookup.sources)
      return {project,physical}
    },
  }
  const constructionTools = createConstructionTools(constructionOptions)
  const planAssistant = createPlanAssistant({
    projectId: opts.projectId, userId: opts.userId, hasAccess, deadline,
    makeLookup: () => createProjectLookup(opts.projectId, async(projectId,input,signal)=>{
      if(input.dataset!=='plan')return lookupTransport(projectId,input,signal)
      const {data,error}=await rpc('project_plan_read',{p_project:projectId,p_revision:null},signal)
      return {data:{records:data?.record?[data.record]:[],related:[],truncated:false},error}
    }, 10_000, 128, 512*1024),
    callModel,
  })
  const drawingRequestCall=async(raw:Record<string,unknown>)=>{
   // Read timestamps change during replay; record revisions and values do not.
   const input=JSON.parse(JSON.stringify(raw,(key,value)=>key==='retrievedAt'?undefined:value))
   return memo('cad:request',input,async(identity)=>{
    const {data,error}=await internal.rpc('bob_drawing_request',{...binding,p_user:opts.userId,...input,p_write_key:(opts.background?.drawingRequestId?opts.background.jobId:opts.clientTurnId)+':'+(identity?.key??crypto.randomUUID())}).abortSignal(AbortSignal.timeout(12000))
    if(error)throw new Error(['drawing_request_cancelled','drawing_context_cleared','drawing_request_complete','drawing_request_changed','drawing_request_denied','drawing_request_not_paused','drawing_scope_changed','drawing_requirements_changed','drawing_requirements_unavailable','drawing_restore_conflict','request_quote_required','drawing_request_pixels_forbidden','project_denied'].find(code=>error.message?.includes(code))??'drawing_request_unavailable')
    return data
   })
  }
  drawingBudget=createDrawingBudget({executionId:opts.background?.jobId??opts.clientTurnId,command:async input=>{
      const {data,error}=await internal.rpc('bob_drawing_budget',{...binding,p_user:opts.userId,...input}).abortSignal(AbortSignal.timeout(12000))
      if(error)throw new Error('drawing_budget_unavailable')
      return data
  }})

  const cadAssistant = createCadAssistant({
    runtimeVersion:()=>memo('cad:runtime',{},()=>drawingRuntimeVersion(internal,{model:!!Deno.env.get('OPENAI_API_KEY'),cad:!!Deno.env.get('BOB_CAD_URL')&&!!Deno.env.get('BOB_CAD_TOKEN')})),
    requestModel:async(id,_options,work)=>{
      const previous=drawingRequestId;drawingRequestId=id
      try{return await work()}finally{drawingRequestId=previous}
    },
    ...(claimedServer?{requestStore:createDrawingRequestStore({projectId:opts.projectId,binding,journal,
      privateCall:drawingRequestCall,
      // One stable id per piece key; the unkeyed id keeps its existing journal identity.
      newId:key=>memo('cad:project_request_id',key?{key}:{},async()=>crypto.randomUUID()),
      release:async ids=>{
        const {data,error}=await internal.rpc('release_drawing_pieces',{...binding,p_user:opts.userId,p_ids:ids}).abortSignal(AbortSignal.timeout(12000))
        if(error)throw new Error(error.message?.includes('project_denied')?'project_denied':'drawing_pieces_unavailable')
        return {released:Array.isArray(data?.released)?data.released:[]}
      },
      caller:async(name,args)=>{
        const {data,error}=await client.rpc(name,args).abortSignal(AbortSignal.timeout(10000))
        if(error)throw new Error(['drawing_request_cancelled','drawing_context_cleared','drawing_request_complete','drawing_request_changed','drawing_request_denied','drawing_request_not_paused','drawing_request_inactive','drawing_scope_changed','drawing_requirements_changed','drawing_requirements_unavailable','drawing_restore_conflict','request_quote_required','drawing_request_pixels_forbidden','budget_remaining','budget_outcome_unknown','budget_changed','budget_unavailable','project_denied'].find(code=>error.message?.includes(code))??'drawing_request_unavailable')
        return data
      },
    })}:{}),
    projectId:opts.projectId,userId:opts.userId,hasAccess,deadline,knowledgeReader,ownerRequest:opts.message,durable:!!opts.background?.asyncModels,
    available:!!Deno.env.get('BOB_CAD_URL')&&!!Deno.env.get('BOB_CAD_TOKEN'),
    makeLookup:()=>createProjectLookup(opts.projectId,lookupTransport,10000,40),
    callModel,
    render:(recipe,source,beforeDispatch)=>memo('cad:render',source?{recipe,drawing_source:source}:recipe,async()=>{
      await beforeDispatch?.()
      return createCadTransport(Deno.env.get('BOB_CAD_URL'),Deno.env.get('BOB_CAD_TOKEN'))(recipe,source)
    },45000),
    checkConstruction:async(id,revision,fresh)=>{
     const check=()=>checkedConstructionForDrawing({...constructionOptions,
      // The actual operation reads fresh caller data. Recorded gate outcomes
      // reconstruct earlier replies; render/review dispatch guards bypass them.
      read:async(artifact,rev,after)=>{
        const {data,error}=await client.rpc('read_construction_draft',{p_project:opts.projectId,p_artifact:artifact,p_revision:rev,p_after:after}).abortSignal(AbortSignal.timeout(12000))
        if(error)throw new Error('construction_read_unavailable');return data
      },
      readCatalog:async(artifact,rev)=>{
        const {data,error}=await client.rpc('catalog_read',{p_project:opts.projectId,p_input:{action:'read',id:artifact,revision:rev,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}}).abortSignal(AbortSignal.timeout(12000))
        if(error)throw new Error('construction_source_unavailable');return data
      },
     },id,revision)
     return fresh?check():memo('cad:construction_check',{id,revision},check)
    },
    readShell:async(id,revision)=>{
      const {data,error}=await rpc('read_cad_shell',{p_project:opts.projectId,p_shell:id,p_revision:revision},AbortSignal.timeout(10000))
      if(error)throw new Error('cad_shell_read_unavailable');return data
    },
    readArtifact:async(id,revision)=>{
      const {data,error}=await rpc('read_cad_artifact',{p_project:opts.projectId,p_artifact:id,p_revision:revision},AbortSignal.timeout(10000));
      if(error)throw new Error('cad_read_unavailable');
      if(!data){
        const draft=await constructionOptions.read(id,revision,null) as Record<string,any>
        return draft?.status==='ok'?{...draft,source_kind:'construction'}:null
      }
      const links=await memo('cad:work_scope',{id,revision},async()=>{
        const result=await client.from('current_drawing_steps').select('step_id')
          .eq('project_id',opts.projectId).eq('artifact_id',id).abortSignal(AbortSignal.timeout(10000))
        if(result.error)throw new Error('drawing_links_unavailable');return result.data.map(row=>row.step_id)
      })
      return {...data,current_step_ids:links}
    },
    catalog:createMaterialCatalogReader(opts.projectId,(input,signal)=>rpc('catalog_read',{p_project:opts.projectId,p_input:input},signal),hasAccess,lookup.sources),
    context:createProjectContext({adapters:[mediaAdapter()],hasAccess,sources:lookup.sources}),
    referenceImageRefs:()=>projectContext.openedImageRefs(),
  })
  if(opts.background?.drawingRequestId){
    // This is an audited domain-event execution of the original instruction.
    // No invented user turn, model-written mandate or generic project tool loop.
    const request=await drawingRequestCall({p_operation:'load',p_id:opts.background.drawingRequestId})
    if(!request)return {ok:false,error:'drawing_request_unavailable'}
    if(request.status==='saved')return {ok:true,projectId:opts.projectId,answer:'Ritningen är redan sparad.',evidence:{kind:'ai_assessment',references:[],sources:[],partial:false,writes:request.receipt?[request.receipt]:[]}}
    if(['paused','cancelled'].includes(request.status))return {ok:false,error:'drawing_request_inactive'}
    const outcome:Record<string,any>=await cadAssistant.consult({...request.payload.brief,request_id:request.id})
    const candidate=cadAssistant.candidate
    let saved=false
    if(candidate&&writer){
      const receipt=await writer.commit({kind:'cad',record_id:candidate.artifact_id,expected_updated_at:null,expected_revision:candidate.expected_revision,request_quote:opts.message.slice(0,500),data:candidate})
      if(receipt.status!=='saved')return {ok:false,error:'drawing_save_unconfirmed'}
      await cadAssistant.markSaved()
      saved=true
    }
    journal?.check()
    const answer=await drawingResumeReply({message:opts.message,userId:opts.userId,outcome,saved,hasAccess,callModel})
    await metrics.finish({ok:true,partial:!saved,writes:writer?.receipts.length??0,cad:cadAssistant.metrics})
    return {ok:true,projectId:opts.projectId,answer,evidence:{kind:'ai_assessment',references:[],sources:cadAssistant.sources,partial:!saved,writes:writer?.receipts??[]}}
  }
  const imageTools=writer?createProjectImageTools({projectId:opts.projectId,message:opts.message,writer,hasAccess,deadline,
    newId: () => memo('image:id', {}, async () => crypto.randomUUID()),
    generate: async prompt => {
      const result = await memo('image:generate', prompt, async () => {
        const generated = await generateImage({app:'bob',coworkerId:'bob',functionName:'project-image',userId:opts.userId,prompt,timeoutMs:100000})
        if (!generated.ok) return generated
        let encoded = ''; for (let i=0;i<generated.image.length;i+=8192) encoded+=String.fromCharCode(...generated.image.subarray(i,i+8192))
        return {ok:true as const,image:btoa(encoded)}
      },100000)
      return result.ok ? {ok:true,image:Uint8Array.from(atob(result.image),c=>c.charCodeAt(0))} : result
    },
    upload:async(id,bytes)=>{await memo('image:upload',id,async()=>{
      const storage=client.storage.from('bob-project-media'),path=`${opts.projectId}/${id}`
      const {error}=await storage.upload(path,bytes,{contentType:'image/png',upsert:false,cacheControl:'0'})
      if(error){const existing=await storage.download(path);if(existing.error||!existing.data)throw new Error('upload_failed')
        const saved=new Uint8Array(await existing.data.arrayBuffer());if(saved.length!==bytes.length||saved.some((v,i)=>v!==bytes[i]))throw new Error('upload_failed')}
      return true
    })},
  }):undefined
  const recordReader=createRecordDetailReader(async(dataset,id,revision)=>{
    if(dataset==='drawing') {
      const {data,error}=await client.from('current_drawing_overview')
        .select('id,project_id,revision,title,status,area_id,steps,source_state,source_reasons').eq('project_id',opts.projectId)
        .eq('id',id).eq('revision',revision).abortSignal(AbortSignal.timeout(10000)).maybeSingle()
      if(error)throw new Error('record_unavailable');return data
    }
    const {data,error}=dataset==='plan'
      ?await rpc('project_plan_read',{p_project:opts.projectId,p_revision:Number(id)},AbortSignal.timeout(10000))
      :await rpc('read_cad_artifact',{p_project:opts.projectId,p_artifact:id,p_revision:revision},AbortSignal.timeout(10000));
    if(error)throw new Error('record_unavailable');return dataset==='plan'?data?.record:data
  },hasAccess)
  try {
  const result=await runClaimedProjectTurn({
    observe:value=>metrics!.observe(value), onTool:value=>metrics!.tool(value), onProgress:opts.background?.progress,
    // A fresh explicit retry of a failed durable job has receipts but no old
    // journal. Continue from current records as well as during journal replay;
    // receipt-only recovery would abandon the unfinished part of the request.
    ...opts, currentView, validateCurrentView, getCurrentViewEvidence, resume: !!opts.background, beforeSettle: () => journal?.check(), modelTimeoutMs: opts.background ? 100000 : 45000, lookup, hasAccess, writer, knowledgeReader, operationalReader, projectContext, catalogReader, constructionTools, planAssistant, cadAssistant, imageTools, recordReader, generation: claimedServer?.generation, deadline,
    readToolPolicy: createToolPolicyReader(client, opts.projectId),
    ...(claimedServer && threadId ? { prepareContext: () => prepareWorkingContext({
      projectId: opts.projectId, userId: opts.userId, threadId, generation: claimedServer.generation, message: opts.message,
      store: (() => {
        const store = conversations.workingContext({ projectId: opts.projectId, userId: opts.userId, threadId, turnId: opts.clientTurnId, generation: claimedServer.generation })
        return {
          load: async () => ({ ...await memo('context:load', {}, store.load) as object, generation: claimedServer.generation }),
          save: (expected: number, through: number, summary: string) => memo('context:save', { expected, through, summary }, async () => {
            try { return await store.save(expected, through, summary) }
            catch (error) {
              // Summary CAS may have committed immediately before a checkpoint
              // was lost. Read back that exact summary instead of folding twice.
              const current = await store.load() as { lastFoldedSeq?: number; summary?: string }
              if (current.lastFoldedSeq === through && current.summary === summary) return { lastFoldedSeq: through }
              throw error
            }
          }),
          search: (query: string, before: number | null) => memo('context:search', { query, before }, () => store.search(query, before)),
        }
      })(),
      callModel, hasAccess, deadline: Math.min(deadline - 60000, Date.now() + 105000),
    }) } : {}),
    // The main answer/continuation model gets the evidence policy. The older-history
    // summarizer above is deliberately separate: it must not fetch project images.
    callModel: createGroundedModelCall({
      projectId: opts.projectId, message: opts.message, lookup: imageGrounding, hasAccess, deadline,
      validateImages: () => projectContext.validate(),
      callModel,
    }),
    fail: async generation => {
      if (threadId) await conversations.fail(opts.projectId, opts.userId, threadId, opts.clientTurnId, generation)
    },
    ...(threadId ? { commit: async (result: Extract<ProjectAnswer, { ok: true }>, generation: number) => {
      await conversations.commit({ projectId: opts.projectId, userId: opts.userId, threadId,
        turnId: opts.clientTurnId, answer: withResendNotice(result.answer), evidence: result.evidence,
        providerResponseId: result.providerResponseId ?? null, generation })
    } } : {}),
  })
  await metrics.finish({ok:result.ok,error:result.ok?undefined:result.error,partial:result.ok&&result.evidence.partial,uncertain:writer?.uncertain,
    recovered:result.ok&&!result.providerResponseId,writes:writer?.receipts.length??0,cad:cadAssistant.metrics,uncertainResends:journal?.uncertainResends()??0,reusedModelCalls:journal?.reusedModelCalls()??0})
  return result.ok ? { ...result, answer: withResendNotice(result.answer) } : result
  }catch(error){
    rethrowContinuation(error)
    await metrics.finish({ok:false,writes:writer?.receipts.length??0,uncertain:writer?.uncertain,cad:cadAssistant.metrics})
    throw error
  }
}
