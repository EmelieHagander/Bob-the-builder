import { drawingErrorCode } from './drawing-errors.ts'
import { createPlanLinks } from './project-plan-links.ts'
import { buildingLinkFact, createBuildingScope } from './project-building-scope.ts'
import { projectFactsPacket } from './project-facts.ts'
import { createWorkRecords } from './project-work-records.ts'
import { createSolutionActions } from './project-solution-actions.ts'
import { createProjectEdits } from './project-edits.ts'
import { readTaskSources } from './task-sources.ts'
import { createConstructionViews } from './construction-views.ts'
import {createProjectCalculator,hasCalculatorContract} from './project-calculator.ts'
import { readPhysicalCadSources } from './cad-physical-lineage.ts'
import { parameterSourcePins } from './cad-parameters.ts'
import { bobCompleteRequestVersions } from './bob-complete-request.ts'
import { createConstructionTools, checkedConstructionForDrawing, constructionCurrentReader, constructionChangeReaders } from './construction-draft.ts'
import {parseDesignReadiness,type DesignPurpose,type DesignReadiness} from './project-design-intent.ts'
import { readBudgetStop } from './bob-budget-stop.ts'
import {drawingResumeReply,confirmedDrawingReceipt} from './drawing-resume-reply.ts'
import {drawingRuntimeVersion} from './drawing-runtime.ts'
import { hydrateCurrentView, createCurrentViewReader, type CurrentViewClient } from './current-view.ts'
import { createCurrentViewGuard } from './current-view-guard.ts'
import { parseBobScreen, type BobScreenPointer, type CurrentView } from '../../../src/domain/bobScreen.ts'
import {createDrawingBudget} from './drawing-budget.ts'
import {createDrawingRequestStore} from './drawing-request-store.ts'
import { createBobModelBudget, isDrawingModelCall, type DrawingBudgetAuthority } from './bob-model-budget.ts'
import { createExecutionMetrics } from './execution-metrics.ts'
import { AIBackgroundPending } from './ai-background.ts'
import { pinBobModelDeadline } from './bob-model-deadline.ts'
import { hasImageContent } from './openai-content.ts'
import { fingerprint, rethrowContinuation } from './bob-job-journal.ts'
import { createKnowledgeReader } from './building-knowledge.ts'
import { createOperationalReader } from './project-operations.ts'
import { BobContinuation, type BobJournal, type JournalIdentity } from './bob-job-journal.ts'
import type { BobTurnCheckpointStore } from './bob-turn-checkpoint.ts'
export const RESEND_NOTICE = 'Obs: ett modellanrop tappade kontakten innan svaret kom fram och skickades om en gång. Det första försöket kan ha debiterats, så den här turen kan ha kostat något mer än vanligt.'
import type { OpenAIServiceOptions } from './openai-service.ts'
import { createRecordDetailReader } from './project-record-detail.ts'
import { createProjectImageTools } from './project-image-tools.ts'
import { createCadAssistant, cadRenderInput } from './cad-assistant.ts'
import { createCadTransport } from './cad-transport.ts'
import { createMaterialCatalogReader } from './material-catalog.ts'
import { createToolPolicyReader } from './project-tools/policy-reader.ts'
import { createGroundedModelCall } from './project-grounding.ts'
import { createProjectContext, type Opened } from './project-context/dispatcher.ts'
import { createMediaAdapter, resolveMediaImage, resolveMediaImageFile, type ProviderImageFiles } from './project-context/media.ts'
import { prepareChatImages } from './project-context/chat-images.ts'
import { createMediaTransport } from './project-context/media-transport.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { callOpenAIResponses, callOpenAIEmbeddings, generateImage, uploadOpenAIVisionFile } from './openai-service.ts'
import { createBobContextContinuation, type ContextSurface } from './bob-context-continuation.ts'
import { BOB_RESULT_WINDOW_TOKENS, BOB_CONSTRUCTION_RESULT_TOKENS } from './bob-result-references.ts'
import { CONSTRUCTION_VIEW_TOOL, constructionViewBudget } from './construction-views.ts'
import { readWithStatementRetry, withStatementRetry } from './read-retry.ts'
import { createMemoryRetrieval, journalMemoryStore } from './bob-memory-retrieval.ts'
import { createJournalledMemoryEmbedder } from './bob-memory-embedding.ts'
import { createBobConversationStore, type BobTurnClaim } from './bob-conversation.ts'
import { createProjectLookup, type LookupInput } from './project-lookup.ts'
import { createLookupReuse, createLookupTransport, lookupPin, type LookupPin } from './lookup-rpc.ts'
import { createPlanAssistant } from './plan-assistant.ts'
import { createSourceReader } from './source-reader.ts'
import type { BobAnswerState, ProjectAnswer, TurnProgress } from './project-answer.ts'
import { compactReceipts, createProjectWriter } from './project-write.ts'
import { prepareWorkingContext, restoreWorkingContext, type WorkingContextSession, type WorkingContextState } from './bob-working-context.ts'
import { runClaimedProjectTurn } from './project-turn.ts'
import { createAiCatalogSession, applyCatalogModelOptions, type AiCatalogSession } from './ai-catalog.ts'

/** Project reads and writes use the caller JWT. Service access is restricted to shared AI
 * config/accounting, content-free execution diagnostics, Bob's private transcript/provider-state
 * commands and claim-guarded derived caches (image provider links and code-produced FORM observations). */
/** Journal replay re-runs every recorded step's access, tool-policy and image
 * freshness checks within milliseconds (hundreds of round trips per claim).
 * Reuse a successful live answer for a few seconds; a failure is never reused,
 * and writes stay enforced by RLS and the domain commands at their boundary. */
const FRESH_MS = 3000
/** Drawing-store calls that only read; every other one ends lookup reuse. */
const DRAWING_STORE_READS = new Set(['project_drawing_requests', 'drawing_request_work', 'check_drawing_request'])
function reuseFresh<A extends unknown[], T>(read: (...args: A) => Promise<T>, reusable: (value: T) => boolean, key: (...args: A) => string = () => '') {
  const seen = new Map<string, { at: number; value: T }>()
  return async (...args: A): Promise<T> => {
    const id = key(...args), hit = seen.get(id)
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.value
    const value = await read(...args)
    if (reusable(value)) seen.set(id, { at: Date.now(), value }); else seen.delete(id)
    return value
  }
}
export async function answerWithOpenAi(opts: {
  authHeader: string; userId: string; projectId: string; message: string; clientTurnId: string;
  screen?: BobScreenPointer | null;
  imageIds?: string[];
  background?: { checkpoint?: BobTurnCheckpointStore; /** Claim-fenced read of this job's successful cad:render results; never journaled. */ loadRenderFiles?: (renderFingerprint: string) => Promise<unknown>; workAllowanceVersion?: number; catalogManifestId?: string; authorityExpiresAt?: string; drawingRequestId?:string; jobId?: string; asyncModels?: boolean; claim: Extract<BobTurnClaim, { status: 'claimed'; mode: 'server' }>; journal: BobJournal; deadline: number; replay: boolean; progress?: (value: TurnProgress) => void };
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
  const shared = createClient(url, serviceKey, {
    db: { schema: 'shared' }, auth: { persistSession: false, autoRefreshToken: false },
  })
  let aiCatalog: AiCatalogSession
  const conversations = createBobConversationStore(internal)
  const journal = opts.background?.journal
  const checkpoint = opts.background?.checkpoint
  const restart = checkpoint?.current()
  if (checkpoint && opts.background?.drawingRequestId) throw new Error('turn_checkpoint_scope_invalid')
  let workingContext: WorkingContextSession | undefined
  // The owner chose to hear about possibly double-billed re-sends (K5, 2026-10-07).
  let priorDrawingAttemptUncertain = false
  let memoryEmbeddingOutcomeUncertain = false
  const priorDrawingNotice='Utfallet för ett tidigare AI-försök var okänt när ett nytt försök startades. Kostnader kan därför finnas för båda försöken.'
  const withResendNotice = (answer: string) => {
    const notice=journal&&journal.uncertainResends()>0?RESEND_NOTICE:priorDrawingAttemptUncertain?priorDrawingNotice:null
    const embeddingNotice = memoryEmbeddingOutcomeUncertain ? 'Ett anrop för minnessökningen tappade kontakten. Det kan ha debiterats, men skickades inte om. Textsökning i samtalet finns fortfarande tillgänglig.' : null
    return [notice, embeddingNotice].reduce<string>((text, value) => value && !text.includes(value) ? text + '\n\n' + value : text, answer)
  }
  const memo = async <T>(stream: string, input: unknown, work: (identity?: JournalIdentity) => Promise<T>, reserve = 0, signal?:AbortSignal): Promise<T> =>
    journal ? journal.run(stream, input, work, reserve, signal) : work()
  const checkpointed = <T extends (...args:any[])=>any>(read:T) => Object.assign(read,{checkpointed:!!journal})
  const rpc = async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
    const { p_generation: _generation, ...stable } = args
    return memo('rpc:' + name, stable, async () => {
      const { data, error } = await client.rpc(name, args).abortSignal(signal)
      return { data, error }
    },0,signal)
  }
  const readWithRetry = (name: string, args: Record<string, unknown>, outer?: AbortSignal) =>
    // Keep the recorded journal value { data, error } exactly as before.
    readWithStatementRetry(name, signal => client.rpc(name, args).abortSignal(signal), outer).then(({ data, error }) => ({ data, error }))
  // Journaled variant: the retry happens inside the recorded operation, so a
  // resumed turn replays the final outcome and the journal input is unchanged.
  const readRpc = async (name: string, args: Record<string, unknown>) => {
    const { p_generation: _generation, ...stable } = args
    const signal = AbortSignal.timeout(26000)
    return memo('rpc:' + name, stable, () => readWithRetry(name, args, signal), 0, signal)
  }
  // Project writes keep their journal stream and recorded { data, error }. A
  // write the database cancelled at the statement timeout saved nothing, so it
  // is sent once more inside the same recorded operation.
  // Identical project reads within this turn (lookupReuseVersion). Every
  // write of this turn, replayed or live, ends all reuse before and after it.
  const lookupReuse = createLookupReuse()
  // Image descriptions, construction observations and drawing-request packets
  // live in tables the lookup never reads, so they keep reuse.
  const writing = async <T>(work: () => Promise<T>): Promise<T> => {
    lookupReuse.invalidate()
    try { return await work() } finally { lookupReuse.invalidate() }
  }
  const writeRpc = async (name: string, args: Record<string, unknown>) => {
    const { p_generation: _generation, ...stable } = args
    const signal = AbortSignal.timeout(26000)
    return writing(() => memo('rpc:' + name, stable, () => withStatementRetry(name, attempt => client.rpc(name, args).abortSignal(attempt), signal,
      { label: 'Write', slowMs: 3000 }).then(({ data, error }) => ({ data, error })), 0, signal))
  }
  let metrics:ReturnType<typeof createExecutionMetrics>|undefined
  const mediaTransport = createMediaTransport(client, { ...opts, url, key })
  const imageRefs = new Map<string, Opened>()
  const resolveImage = async (ref: string) => {
    const record = imageRefs.get(ref)
    if (!record) throw new Error('image_not_opened')
    // Claimed server turns reuse one stored provider file per image revision
    // instead of re-sending pixels; the image itself stays in bob storage.
    if (claimedServer) return resolveMediaImageFile(opts.projectId, mediaTransport, record, ref, imageFiles, AbortSignal.timeout(30000))
    return resolveMediaImage(opts.projectId, mediaTransport, record, AbortSignal.timeout(12000))
  }
  const imageFiles: ProviderImageFiles = {
    async find(mediaId, revision, signal) {
      const { data, error } = await client.rpc('bob_image_provider_file', { p_project: opts.projectId, p_media: mediaId, p_revision: revision }).abortSignal(signal)
      if (error) throw new Error('unavailable')
      return typeof data === 'string' ? data : null
    },
    upload: (bytes, contentType, signal) => uploadOpenAIVisionFile(bytes, contentType as 'image/png' | 'image/jpeg' | 'image/webp', signal),
    async save(entry, signal) {
      const { error } = await internal.rpc('bob_record_image_provider_file', { ...binding, p_user: opts.userId, p_media: entry.mediaId,
        p_revision: entry.revision, p_updated_at: entry.updatedAt, p_sha256: entry.sha256, p_file_id: entry.fileId, p_expires_at: entry.expiresAt,
      }).abortSignal(signal)
      if (error) throw new Error('unavailable')
    },
  }
  // Background workers live ~150 s. Reserve a realistic duration per role, not the
  // full timeout, so several calls share one segment; a call cut off at the segment
  // wall yields into a fresh segment, consuming the same bounded retry budget
  // as other dispatched failures. Durable AI waiting does not consume retries.
  const RESERVE_MS: Record<string, number> = { 'ask-bob': 75000, 'cad-reviewer': 60000, 'plan-compiler': 45000, 'plan-reviewer': 30000, 'context-summary': 30000, 'completion-gate': 15000, 'bob-delivery-language': 15000 }
  let drawingRequestId:string|null=null
  let drawingBudget:ReturnType<typeof createDrawingBudget>|undefined
  let modelBudget: ReturnType<typeof createBobModelBudget>
  // Set once the thread is known; see the invoke closure below.
  let promptCacheKey: string | undefined
  // Construction reads in the model step being executed (page budget share).
  let constructionReadsInStep = 1
  const dispatchModel = async (requested: OpenAIServiceOptions, beforeDispatch?:()=>Promise<void>) => {
   const options = applyCatalogModelOptions(aiCatalog, requested)
   const drawingAuthority:DrawingBudgetAuthority|undefined=drawingRequestId&&drawingBudget
    ?{requestId:drawingRequestId,options}:undefined
   const boundDrawing=isDrawingModelCall(drawingAuthority,options.aiFunction)
   return modelBudget.run(async () => {
   const timeout = options.timeoutMs ?? 120000
   const asyncModels = !!(opts.background?.asyncModels && opts.background.jobId)
   // Localisation has its own journal stream. Existing jobs may contain the old
   // free-form drawing answer at work-router's next position; do not replay it
   // as a phrasebook or collide with its fingerprint during a release.
   const modelStream=options.catalogSchemaKey==='bob_delivery_language'?'model:delivery-language-v1':'model:'+options.functionName
   try{return await memo(modelStream, options, async identity => {
    await beforeDispatch?.()
    const expiresAt = opts.background?.workAllowanceVersion === 1 ? opts.background.authorityExpiresAt! : new Date(opts.background?.deadline ?? 0).toISOString()
    // A refreshed owner JWT must not alter an already accepted model job's
    // immutable reservation. Old execution manifests retain their call order.
    const modelExpiresAt = asyncModels && identity && execution.modelDeadlineVersion === 1
      ? await pinBobModelDeadline(memo, identity, expiresAt) : expiresAt
    const started = performance.now()
    const wall = journal ? journal.remaining() + 8000 : Infinity
    const allowed = Math.max(1000, Math.min(timeout, wall))
    let result
    try {
      const invoke=(recovery?:{key?:string;context?:Record<string,unknown>;expiresAt?:string;fingerprint?:string})=>callOpenAIResponses<string>({ ...options, timeoutMs: allowed, resolveImage,
        // Routing hint only, added after the journal, job and drawing-budget
        // fingerprints so recorded steps of in-flight jobs still match.
        ...(promptCacheKey && (options.catalogRoleKey ?? options.functionName) === 'ask-bob' ? { promptCacheKey } : {}),
        ...(asyncModels && identity ? { background: {
          key: opts.background!.jobId + '/' + identity.key, fingerprint: identity.fingerprint, receiver: 'bob',
          context: { jobId: opts.background!.jobId, role: options.aiFunction },
          expiresAt: modelExpiresAt,
          ...recovery,
        } } : {}),
      })
      result=boundDrawing&&drawingAuthority&&drawingBudget?await drawingBudget(drawingAuthority.requestId,options,invoke):await invoke()
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
  },options.aiFunction,boundDrawing?drawingAuthority:undefined).then(result=>{
   if(result.priorAttemptUncertain)priorDrawingAttemptUncertain=true
   const stop=readBudgetStop(result)
   if(stop)console.warn('[Bob budget stop]',JSON.stringify({role:options.aiFunction,job_id:opts.background?.jobId??null,...stop}))
   return result
  })
  }
  let contextContinuation: ReturnType<typeof createBobContextContinuation> | undefined
  let refreshMainContextSurface: (() => Promise<ContextSurface>) | undefined
  const specialistContextSurfaces = new Map<string, () => Promise<ContextSurface>>()
  const registerSpecialistContextSurface = (role: string, refresh: () => Promise<ContextSurface>) => {
    if (specialistContextSurfaces.has(role)) throw new Error('specialist_context_already_registered')
    specialistContextSurfaces.set(role, refresh)
    return () => {
      if (specialistContextSurfaces.get(role) === refresh) specialistContextSurfaces.delete(role)
    }
  }
  let mainContextEpoch = 0
  const callModel = (requested: OpenAIServiceOptions, beforeDispatch?: () => Promise<void>) =>
    contextContinuation ? contextContinuation.call(requested, beforeDispatch) : dispatchModel(requested, beforeDispatch)
  const mediaAdapter = () => {
    const adapter = createMediaAdapter(opts.projectId, mediaTransport, true)
    return { ...adapter,checkpointed:!!journal,
      count: (signal: AbortSignal) => memo('media:count', {}, () => adapter.count(signal),0,signal),
      list: (...args: Parameters<typeof adapter.list>) => memo('media:list', args[0], () => adapter.list(...args),0,args[1]),
      open: async (...args: Parameters<typeof adapter.open>) => {
        const opened = await memo('media:open', args[0], () => adapter.open(...args),0,args[1])
        // Rebuild the resolver registry from compact checkpoints on every resume.
        if (opened.image.image_url.startsWith('private-image:')) imageRefs.set(opened.image.image_url, opened)
        return opened
      },
      // current() remains live, including for already-replayed image evidence;
      // a replay re-checks every opened image per step within milliseconds.
      current: checkpoint ? adapter.current : reuseFresh(adapter.current, unchanged => unchanged, (ref, expected) => ref + '\u0000' + expected),
    }
  }
  // Jobs pinned with roomDimensionsVersion read v9 (adds room_dimensions); other journals keep v8.
  // Jobs pinned with exactLookupVersion read v10 and retry a statement timeout once (2026-10-29).
  let lookupPinned: LookupPin = lookupPin({})
  const lookupTransport = checkpointed(createLookupTransport(() => lookupPinned,
    (name, args, signal) => client.rpc(name, args).abortSignal(signal), memo, lookupReuse))
  const readAccess = async () => {
    const { data, error } = await client.from('projects').select('id').eq('id', opts.projectId)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    return !error && data?.id === opts.projectId
  }
  const hasAccess = checkpoint ? readAccess : reuseFresh(readAccess, granted => granted)
  const policyReader = createToolPolicyReader(client, opts.projectId)
  const readToolPolicy = checkpoint ? policyReader : reuseFresh(policyReader, () => true)

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
  try {
    // The private job journal pins configuration, not project authority. Fresh
    // caller reads and live enabled checks still guard each execution boundary.
    const manifest = await memo('ai-catalog', { app: 'bob' }, () => createAiCatalogSession(shared, { app: 'bob', ...(opts.background?.catalogManifestId ? { manifestId: opts.background.catalogManifestId } : {}) }).load())
    aiCatalog = createAiCatalogSession(shared, { app: 'bob', manifest, unlimitedWork: opts.background?.workAllowanceVersion === 1 })
    await aiCatalog.load()
  } catch (error) {
    rethrowContinuation(error)
    if (claimedServer) {
      try { await conversations.fail(opts.projectId, opts.userId, claimedServer.thread_id, opts.clientTurnId, claimedServer.generation) } catch { /* lease recovery */ }
    }
    return { ok: false, error: 'ai_catalog_unavailable' }
  }
  const contract = aiCatalog.definition('agent-contract.ask-bob', 'agent_contract').metadata
  const unlimitedWork = opts.background?.workAllowanceVersion === 1 && contract.work_allowance_version === 1
  const deadline = opts.background?.deadline ?? Date.now() + 215000
  const execution: { id: string; startedAt: number; constructionReplayVersion: number; memoryManagementVersion?: 1 | 2; contextStrategyVersion?: 1; lookupObservationVersion?: 1; contextPagingVersion?: 1; toolCarryVersion?: 1; rolloverVersion?: 1; groundingReadOrderVersion?: 1; modelDeadlineVersion?: 1; completeRequestVersion?: 1; resultReferenceVersion?: 1; resultWindowVersion?: 1 | 2; constructionPageVersion?: 1; corePreloadVersion?: 1; buildingLinkVersion?: 1; roomDimensionsVersion?: 1; projectFactsVersion?: 1; exactLookupVersion?: 1; lookupReuseVersion?: 1; turnUsdStop?: number } =
    await memo('execution:identity', {}, async () => ({ id: crypto.randomUUID(), startedAt: Date.now(), constructionReplayVersion: 2,
      lookupObservationVersion: 1 as const, contextPagingVersion: 1 as const, toolCarryVersion: 1 as const, rolloverVersion: 1 as const,
      // Larger construction pages (decision A). Jobs without this pin keep 2,000.
      constructionPageVersion: 1 as const,
      // Core reading tools loaded from the first step. Jobs without this pin keep on-demand loading.
      corePreloadVersion: 1 as const,
      // Building links read once at turn start. Jobs without this pin read nothing extra.
      buildingLinkVersion: 1 as const,
      // Room dimensions read through search v9. Jobs without this pin keep v8.
      roomDimensionsVersion: 1 as const,
      // Pure project facts at turn start and the compact construction table (2026-10-26). Jobs without this pin keep both as before.
      projectFactsVersion: 1 as const,
      // Search v10 (exact artifact reads) with one statement-timeout retry (2026-10-29). Jobs without this pin keep v8/v9.
      exactLookupVersion: 1 as const,
      // Identical reads reused within the turn until it writes (2026-10-29). Jobs without this pin read every time.
      lookupReuseVersion: 1 as const,
      ...(checkpoint ? { groundingReadOrderVersion: 1 as const, modelDeadlineVersion: 1 as const } : {}),
      ...bobCompleteRequestVersions(!!checkpoint, contract),
      // Window 2 (2026-10-29): superseded repeat reads leave first; the latest result per record stays whole.
      ...(checkpoint && contract.result_reference_version === 1 ? { resultWindowVersion: contract.result_window_version === 2 ? 2 as const : 1 as const } : {}),
      // Owner-set spending stop, pinned when the job starts (2026-10-20).
      ...(typeof contract.turn_usd_stop === 'number' && Number.isFinite(contract.turn_usd_stop) && contract.turn_usd_stop > 0 ? { turnUsdStop: contract.turn_usd_stop } : {}),
      memoryManagementVersion: contract.context_strategy_version === 1 ? 2 as const : 1 as const,
      ...(contract.context_strategy_version === 1 ? { contextStrategyVersion: 1 as const } : {}),
    }))
  if (execution.turnUsdStop !== undefined && !(typeof execution.turnUsdStop === 'number' && Number.isFinite(execution.turnUsdStop) && execution.turnUsdStop > 0)) throw new Error('turn_usd_stop_invalid')
  modelBudget = createBobModelBudget(undefined, undefined, undefined, { unlimitedWork, ...(execution.turnUsdStop !== undefined ? { usdStop: execution.turnUsdStop } : {}) })
  if (execution.lookupObservationVersion !== undefined && execution.lookupObservationVersion !== 1) throw new Error('lookup_observation_version_invalid')
  if (execution.rolloverVersion !== undefined && execution.rolloverVersion !== 1) throw new Error('rollover_version_invalid')
  if (execution.groundingReadOrderVersion !== undefined && execution.groundingReadOrderVersion !== 1) throw new Error('grounding_read_order_version_invalid')
  if (execution.modelDeadlineVersion !== undefined && execution.modelDeadlineVersion !== 1) throw new Error('model_deadline_version_invalid')
  if (execution.completeRequestVersion !== undefined && execution.completeRequestVersion !== 1) throw new Error('complete_request_version_invalid')
  if (execution.resultReferenceVersion !== undefined && (execution.resultReferenceVersion !== 1 || execution.completeRequestVersion !== 1)) throw new Error('result_reference_version_invalid')
  if (execution.resultWindowVersion !== undefined && (![1, 2].includes(execution.resultWindowVersion) || execution.resultReferenceVersion !== 1)) throw new Error('result_window_version_invalid')
  if (execution.constructionPageVersion !== undefined && execution.constructionPageVersion !== 1) throw new Error('construction_page_version_invalid')
  if (execution.corePreloadVersion !== undefined && execution.corePreloadVersion !== 1) throw new Error('core_preload_version_invalid')
  if (execution.buildingLinkVersion !== undefined && execution.buildingLinkVersion !== 1) throw new Error('building_link_version_invalid')
  if (execution.roomDimensionsVersion !== undefined && execution.roomDimensionsVersion !== 1) throw new Error('room_dimensions_version_invalid')
  if (execution.projectFactsVersion !== undefined && execution.projectFactsVersion !== 1) throw new Error('project_facts_version_invalid')
  if (execution.exactLookupVersion !== undefined && execution.exactLookupVersion !== 1) throw new Error('exact_lookup_version_invalid')
  lookupPinned = lookupPin(execution)
  const lookupOptions = { unlimitedWork,
    // Existing in-flight journals retain their recorded clock policy. New
    // work pins each observation, including invalid/failed reads, before its
    // RPC. A separate checkpoint preserves nested operation order on replay.
    ...(execution.lookupObservationVersion === 1 ? { observationTime: (input: unknown) =>
      memo('lookup:observed_at', { projectId: opts.projectId, input }, async () => new Date().toISOString()) } : {}),
  }
  const projectLookup = createProjectLookup(opts.projectId, lookupTransport, lookupPinned.timeoutMs, 32, undefined, lookupOptions)
  const groundingLookup = createProjectLookup(opts.projectId, lookupTransport, lookupPinned.timeoutMs, 48, undefined, lookupOptions)
  const lookup = { ...projectLookup, get remaining() { return projectLookup.remaining }, get partial() { return projectLookup.partial || groundingLookup.partial }, sources: projectLookup.sources }
  const imageGrounding = { async search(input: LookupInput) {
    const result = await groundingLookup.search(input)
    for (const source of groundingLookup.sources) if (!lookup.sources.some(s => s.dataset===source.dataset && s.recordId===source.recordId)) lookup.sources.push(source)
    return result
  } }
  const contextStrategy = execution.contextStrategyVersion === 1 && contract.context_strategy_version === 1
  if (contextStrategy) contextContinuation = createBobContextContinuation({ version: 1, aiCatalog, callModel: dispatchModel,
    ...(execution.resultReferenceVersion === 1 ? { mainResultReferences: 1 } : {}),
    ...(execution.resultWindowVersion === 1 ? { resultWindowTokens: BOB_RESULT_WINDOW_TOKENS } : {}),
    ...(execution.resultWindowVersion === 2 ? { resultWindowTokens: BOB_RESULT_WINDOW_TOKENS, resultWindowVersion: 2 as const } : {}),
    ...(execution.constructionPageVersion === 1 ? { literalResultTokens: { [CONSTRUCTION_VIEW_TOOL.function.name]: BOB_CONSTRUCTION_RESULT_TOKENS } } : {}),
    ...(execution.rolloverVersion === 1 ? { rolloverVersion: 1 as const } : {}),
    // Older in-flight journals keep their recorded call sequence and re-page.
    ...(execution.contextPagingVersion === 1 && journal ? { pageBoundaries: (source: string, compute: () => Promise<(number | null)[]>) =>
      memo('context:pages', { source }, compute) } : {}),
    onRollover: ({ role }) => { if (role === 'ask-bob') mainContextEpoch++ },
    refreshSurface: async ({ role }) => role === 'ask-bob'
      ? refreshMainContextSurface?.()
      : specialistContextSurfaces.get(role)?.(),
    snapshot: ({ role }) => role === 'ask-bob' ? {
      // Only receipts reached at this replay position, never writes restored
      // from a later checkpoint or another colleague's private conversation.
      confirmed_writes: compactReceipts((writer?.executedReceipts ?? []).slice(-16)),
      earlier_confirmed_writes: Math.max(0, (writer?.executedReceipts.length ?? 0) - 16),
      unresolved_tools: writer?.unresolvedTools ?? [],
      unsaved_plan_candidate_available: planAssistant.canSave,
      unsaved_drawing_candidate_available: !!cadAssistant.candidate,
    } : undefined,
  })
  metrics=createExecutionMetrics({runId:execution.id,turnId:opts.clientTurnId,startedAt:execution.startedAt,write:async event=>{
    const {error}=await internal.from('execution_events').upsert(event,{onConflict:'run_id,event_key'}).abortSignal(AbortSignal.timeout(3000))
    if(error)throw new Error('metrics_unavailable')
  }})
  const threadId = claimedServer?.thread_id ?? null
  // One routing key per conversation thread (guest/local turns: per run), so
  // a turn's steps and the thread's next turn reach the provider machine that
  // holds their cached prefix. A hash: no project or user identity is sent.
  promptCacheKey = 'bob-ask-' + (await fingerprint({ v: 1, scope: threadId ?? execution.id })).slice(0, 32)
  const binding = { p_project: opts.projectId, p_thread: threadId, p_turn: opts.clientTurnId, p_generation: claimedServer?.generation }
  let currentView: CurrentView | undefined
  let validateCurrentView: (() => Promise<boolean>) | undefined
  let getCurrentViewEvidence: (() => CurrentView) | undefined
  let currentViewGuard: ReturnType<typeof createCurrentViewGuard> | undefined
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
        const guard = currentViewGuard = createCurrentViewGuard({ initial: currentView, read, hasAccess,
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
  // Route new bound actions separately; pinned older journals retain their RPC names.
  const writer = claimedServer ? createProjectWriter(opts.projectId, opts.message,
    payload => writeRpc(payload.kind === 'construction_work' ? 'commit_construction_work' : payload.kind === 'form_feedback' ? 'record_model_feedback' : payload.kind === 'bound_building_scope' ? 'bob_project_write_v21' : payload.kind === 'bound_plan_link' ? 'bob_project_write_v20' : payload.kind === 'bound_work' ? 'bob_project_write_v19' : ['bound_solution_create', 'bound_solution_target', 'bound_solution_evidence'].includes(payload.kind) ? 'bob_project_write_v18' : ['bound_project', 'bound_solution'].includes(payload.kind) ? 'bob_project_write_v17' : 'bob_project_write_v16', { ...binding, p_payload: payload }),
    () => client.rpc('bob_read_write_receipts', binding).abortSignal(AbortSignal.timeout(12_000)),
    () => client.rpc('bob_settle_project_writes', binding).abortSignal(AbortSignal.timeout(12_000)),
    { unlimitedWork, taskWorkDiagnostics: [1, 2, 3].includes(contract.work_completion_version as number) },
  ) : undefined
  const planLinks = createPlanLinks({ unlimitedWork, projectId: opts.projectId, writer, hasAccess,
    read: input => rpc('read_bob_plan_link_context', { p_project: opts.projectId, p_resource: input.resource, p_query: input.query, p_after: input.after }, AbortSignal.timeout(12000)),
  })
  const buildingScope = createBuildingScope({ unlimitedWork, projectId: opts.projectId, writer, hasAccess,
    read: input => rpc('read_bob_building_scope_context', { p_project: opts.projectId, p_resource: input.resource, p_building: input.building, p_query: input.query, p_after: input.after }, AbortSignal.timeout(12000)),
  })
  const workRecords = createWorkRecords({ unlimitedWork, projectId: opts.projectId, writer, hasAccess,
    readSnapshot: input => rpc('read_bob_work_snapshot', { p_project: opts.projectId, p_resource: input.resource, p_id: input.key }, AbortSignal.timeout(12000)),
    read: input => rpc('read_bob_work_context', { p_project: opts.projectId, p_resource: input.resource, p_query: input.query, p_after: input.after }, AbortSignal.timeout(12000)),
  })
  // Owner decision 2026-10-29: writes return the state they produced. Pinned
  // per manifest; older jobs keep receipts only and their original reads.
  const writeState = aiCatalog.manifest().definitions.some(row => row.prompt_key === 'bob.tools' && row.metadata?.write_state_version === 1)
  const constructionReadinessReader = (targetRevision: number, areaId: string | null) => readDesignReadiness(targetRevision, 'construction', areaId)
  // Owner decision 2026-10-29: one create call may also select the new alternative.
  const createSelect = writeState && aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.create_solution_alternative' && row.metadata?.create_select_version === 1)
  const solutionActions = createSolutionActions({ unlimitedWork, projectId: opts.projectId, writer, hasAccess,
    ...(writeState ? { writeState: { readiness: constructionReadinessReader, selectedEdit: (areaId: string | null) => projectEdits.readSelected(areaId) } } : {}),
    ...(createSelect ? { createSelect: true } : {}),
    ...(claimedServer ? { modelFeedback: { message: opts.message, read: before => rpc('read_model_feedback', { ...binding, p_before: before }, AbortSignal.timeout(12000)) } } : {}),
    read: input => rpc('read_bob_solution_context', { p_project: opts.projectId, p_resource: input.resource, p_query: input.query, p_after: input.after }, AbortSignal.timeout(12000)),
  })
  const projectEdits = createProjectEdits({ unlimitedWork, projectId: opts.projectId, writer, hasAccess, sources: lookup.sources,
    ...(writeState ? { writeState: { readiness: constructionReadinessReader } } : {}),
    read: input => rpc('read_bob_edit_context', { p_project: opts.projectId, p_resource: input.resource, p_query: input.query, p_after: input.after }, AbortSignal.timeout(12000)),
    readSelected: areaId => rpc('read_bob_selected_edit_context', { p_project: opts.projectId, p_area: areaId }, AbortSignal.timeout(12000)),
  })
  const projectContext = createProjectContext({ unlimitedWork,
    reviewInstruction: aiCatalog.text('drawing-review.instruction'),
    imageEvidenceInstruction: aiCatalog.text('images.evidence-intro'), reviewLabel: aiCatalog.text('images.review-label'),
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
  let attachedImageIds:string[]=[]
  if (!opts.background?.drawingRequestId) {
    try {
      attachedImageIds=claimedServer&&threadId
        ?await conversations.captureImages({projectId:opts.projectId,userId:opts.userId,threadId,turnId:opts.clientTurnId,generation:claimedServer.generation},opts.imageIds)
        :opts.imageIds??[]
      await prepareChatImages(projectContext,attachedImageIds)
    } catch(error){
      rethrowContinuation(error)
      if(claimedServer&&threadId)try{await conversations.fail(opts.projectId,opts.userId,threadId,opts.clientTurnId,claimedServer.generation)}catch{/* lease recovery */}
      return {ok:false,error:'context_unavailable'}
    }
  }
  const knowledgeReader = createKnowledgeReader(hasAccess, undefined, { unlimitedWork })
  const operationalReader = createOperationalReader(opts.projectId, input=>rpc('read_project_work', {p_project:opts.projectId,p_input:input}, AbortSignal.timeout(12000)),hasAccess,lookup.sources,{unlimitedWork})
  // Pinned per manifest (material_lookup_version 1): untyped material searches
  // return the combined lookup with household stock and latest store prices.
  const materialLookup = aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.search_material_catalog' && row.metadata?.material_lookup_version === 1)
  const catalogReader = createMaterialCatalogReader(opts.projectId,
    checkpointed((input:Record<string,unknown>, signal:AbortSignal) => rpc('catalog_read', { p_project: opts.projectId, p_input: input }, signal)),
    hasAccess, lookup.sources, undefined, { unlimitedWork,
      ...(materialLookup ? { lookup: checkpointed((input:Record<string,unknown>, signal:AbortSignal) => rpc('material_lookup', { p_project: opts.projectId, p_input: input }, signal)) } : {}) })
  const readDesignReadiness=async(targetRevision:number,purpose:DesignPurpose|null,areaId:string|null=null,fresh=false):Promise<DesignReadiness>=>{
    const args={p_project:opts.projectId,p_area:areaId,p_target_revision:targetRevision,p_purpose:purpose}
    // Replaying a recorded gate reconstructs an earlier completed operation.
    // Fresh dispatch guards use the caller directly, before new provider work.
    const {data,error}=await(fresh
      ?client.rpc('read_design_readiness',args).abortSignal(AbortSignal.timeout(12000))
      :rpc('read_design_readiness',args,AbortSignal.timeout(12000)))
    if(error)throw new Error('design_readiness_unavailable')
    const result=parseDesignReadiness(data)
    if(!result||result.project_id!==opts.projectId||result.area_id!==areaId)throw new Error('design_readiness_unavailable')
    return result
  }
  const constructionOptions = {unlimitedWork,projectId:opts.projectId,message:opts.message,writer,hasAccess,
    ...(execution.constructionPageVersion === 1 ? { viewPageTokens: () => constructionViewBudget(constructionReadsInStep) } : {}),
    ...(execution.projectFactsVersion === 1 ? { constructionTable: true } : {}),
    readDesignReadiness,
    formRefinement:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.save_construction_draft'&&row.metadata?.form_refinement_version===1),
    formEvidence:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.check_construction_draft'&&row.metadata?.construction_evidence_version===1),
    constructionSourceRefresh:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.change_construction_parameters'&&row.metadata?.construction_source_refresh_version===1),
    coherentWork:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.read_construction_draft'&&row.metadata?.construction_work_version===1),
    creationPreparation:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.read_construction_draft'&&row.metadata?.creation_preparation_version===1),
    writeState,
    // Owner decision 2026-10-29: changes carry corrected title/description; stale stated sizes are rejected.
    constructionText:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.change_construction_parameters'&&row.metadata?.construction_text_version===1),
    prepareSolutionEdit:projectEdits.prepare,
    prepareWork:async(payload:import('./project-write.ts').WritePayload)=>{
      const {data,error}=await rpc('prepare_construction_work',{...binding,p_payload:payload},AbortSignal.timeout(12000))
      if(error)return {status:error.code==='42501'?'denied':['PT409','40001'].includes(error.code??'')?'conflict':error.code==='22023'?'invalid':'unavailable',reason:'construction_work_preparation_failed'}
      return data
    },
    readWorkSources:async(draft:Record<string,any>|null,stepId:string|null)=>{
      const packet=await readTaskSources({area_id:draft?.area_id??null,step_id:stepId,construction:draft?{artifact_id:draft.artifact_id,revision:draft.revision}:null},
        {projectId:opts.projectId,search:q=>lookup.search(q as any),construction:draft?q=>createConstructionViews(opts.projectId).read(draft,q as any):undefined})
      const solutionEdit=packet.solution?.status==='ok'
        ?await projectEdits.readSelected(packet.solution.inherited_from_project?null:draft?.area_id??null):{status:'not_requested'}
      return {packet,solutionEdit}
    },
    openDelivery:async(resource:import('./construction-delivery.ts').ConstructionDeliveryResource,id:string,revision:number)=>{
      if(resource==='drawings'){
        const {data,error}=await memo('construction:delivery_current',{id,revision},async()=>{
          const result=await client.from('current_drawing_overview').select('id,project_id,revision,source_state,source_reasons,steps')
            .eq('project_id',opts.projectId).eq('id',id).eq('revision',revision).abortSignal(AbortSignal.timeout(10000)).maybeSingle()
          return {data:result.data,error:result.error}
        })
        if(error||data?.project_id!==opts.projectId)return {status:'unavailable'}
        return {status:'ok',record:data}
      }
      const result=await operationalReader.execute({resource:resource==='requirements'?'requirement':'cut_plan',record_id:id,after_id:null})
      const record=result.status==='ok'&&result.records?.find((r:Record<string,any>)=>r.id===id&&r.revision===revision)
      return record?{status:'ok',record}:{status:'unavailable'}
    },
    saveObservation:async(observation:import('./construction-views.ts').ConstructionObservation)=>{
      if(!claimedServer)throw new Error('construction_observation_unavailable')
      const {p_generation:_generation,...stable}=binding
      const result=await memo('construction:save_observation',{...stable,observation},async()=>{
        const {data,error}=await internal.rpc('bob_record_construction_observation',{...binding,p_user:opts.userId,p_observation:observation}).abortSignal(AbortSignal.timeout(12000))
        return {data,error}
      })
      if(result.error||!result.data)throw new Error('construction_observation_unavailable')
      return result.data as import('./construction-views.ts').ConstructionObservation
    },
    readObservations:async(id:string,revision:number,resultId:string|null,after:string|null)=>{
      const {data,error}=await readRpc('read_construction_results',{p_project:opts.projectId,p_artifact:id,p_revision:revision,p_result:resultId,p_after:after})
      if(error)throw new Error('construction_observation_unavailable')
      return data as Record<string,any>
    },
    readConstructionReadiness:async(targetRevision:number,areaId:string|null,refinement:import('./construction-form.ts').FormRefinement)=>{
      const {data,error}=await rpc('read_construction_readiness',{p_project:opts.projectId,p_area:areaId,p_target_revision:targetRevision,p_form_refinement:refinement},AbortSignal.timeout(12000))
      if(error)throw new Error('construction_readiness_unavailable')
      return data
    },
    ...constructionChangeReaders({
    prepareRoleChange:async(payload:import('./project-write.ts').WritePayload)=>{
      const {data,error}=await client.rpc('prepare_construction_role_change',{...binding,p_payload:payload}).abortSignal(AbortSignal.timeout(12000))
      if(error)return {status:error.code==='42501'?'denied':['PT409','40001'].includes(error.code??'')?'conflict':error.code==='22023'?'invalid':'unavailable',reason:'construction_role_preparation_failed'}
      return data
    },
    prepareConsequence:async(payload:import('./project-write.ts').WritePayload)=>{
      // Progress/source gates are live reads, not replayed segment snapshots.
      const {data,error}=await client.rpc('prepare_construction_consequence',{...binding,p_payload:payload}).abortSignal(AbortSignal.timeout(12000))
      if(error)return {status:error.code==='42501'?'denied':['PT409','40001'].includes(error.code??'')?'conflict':error.code==='22023'?'invalid':'unavailable',reason:'construction_consequence_preparation_failed'}
      return data
    },
    readChanges:async(id:string,revision:number,after:string|null)=>{
      const {data,error}=await client.rpc('read_construction_changes',{p_project:opts.projectId,p_artifact:id,p_revision:revision,p_after:after}).abortSignal(AbortSignal.timeout(12000))
      if(error)throw new Error('construction_changes_unavailable');return data
    },
    },journal,execution.constructionReplayVersion),
    prepareLegacyTransition:async(payload:import('./project-write.ts').WritePayload)=>{
      const {data,error}=await rpc('prepare_legacy_construction_transition',{...binding,p_payload:payload},AbortSignal.timeout(12000))
      if(error)return {status:error.code==='42501'?'denied':['PT409','40001'].includes(error.code??'')?'conflict':error.code==='22023'?'invalid':'unavailable',reason:'legacy_transition_preparation_failed'}
      return data
    },
    preciseEditDiagnostics:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.edit_construction_parts'),
    constructionViews:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.read_construction_draft'&&row.metadata?.construction_view_version===1),
    constructionRepeats:aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.save_construction_draft'&&row.metadata?.construction_repeat_version===1),
    observationTime:(input:unknown)=>memo('construction:observation',input,async()=>new Date().toISOString()),
    prepareEdit:async(payload:import('./project-write.ts').WritePayload)=>{
      const {data,error}=await rpc('prepare_construction_edit',{...binding,p_payload:payload},AbortSignal.timeout(12000))
      if(error)return {status:error.code==='42501'?'denied':['PT409','40001'].includes(error.code??'')?'conflict':error.code==='22023'?'invalid':'unavailable',reason:'construction_edit_preparation_failed'}
      return data
    },
    prepareParameterChange:async(payload:import('./project-write.ts').WritePayload)=>{
      const {data,error}=await rpc('prepare_construction_parameter_change',{...binding,p_payload:payload},AbortSignal.timeout(12000))
      if(error)return {status:error.code==='42501'?'denied':['PT409','40001'].includes(error.code??'')?'conflict':error.code==='22023'?'invalid':'unavailable',reason:'construction_change_preparation_failed'}
      return data
    },
    // Each new check observes current sources once. Resuming reconstructs that
    // historical check, even after this job revised one of its catalog sources.
    // Older execution identities retain their original journal call sequence.
    // CAD dispatch independently uses fresh reads below, before paid work.
    readCurrent:constructionCurrentReader(async(id:string)=>{
      const {data,error}=await readWithRetry('read_construction_draft',{p_project:opts.projectId,p_artifact:id,p_revision:null,p_after:null})
      if(error)throw new Error('construction_read_unavailable');return data
    },journal,execution.constructionReplayVersion),
    read:async(id:string|null,revision:number|null,after:string|null)=>{
      const {data,error}=await readRpc('read_construction_draft',{p_project:opts.projectId,p_artifact:id,p_revision:revision,p_after:after})
      if(error)throw new Error('construction_read_unavailable');return data
    },
    // New manifests alone add this read; old checkpoint/journal sequences and
    // tool contracts remain unchanged. No speculative whole-project scan.
    ...(aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.read_construction_delivery')?{
      readDelivery:async(id:string,revision:number,resource:import('./construction-delivery.ts').ConstructionDeliveryResource,after:string|null)=>{
        const {data,error}=await readRpc('read_construction_delivery',{p_project:opts.projectId,p_artifact:id,p_revision:revision,p_resource:resource,p_after:after})
        if(error)throw new Error('construction_delivery_unavailable');return data as Record<string,any>
      }}:{}),
    readCatalog:async(id:string,revision:number)=>{
      const {data,error}=await readRpc('catalog_read',{p_project:opts.projectId,p_input:{action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}})
      if(error)throw new Error('construction_source_unavailable');return data
    },
    // Jobs pinned to the joint-fasteners catalog read the server schedule in
    // derive_construction_lists; earlier manifests keep their journal sequence.
    ...(aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.derive_construction_lists'&&row.metadata?.joint_fastener_version===1)?{
      readFasteners:async(id:string,revision:number)=>{
        const {data,error}=await readRpc('read_construction_fasteners',{p_project:opts.projectId,p_artifact:id,p_revision:revision})
        return error?null:data
      }}:{}),
    readSources:async (pins:ReturnType<typeof parameterSourcePins>)=>{
      const project=new Map<string,Record<string,any>>()
      if(pins.project.length){
        const {data,error}=await client.from('current_measurements').select('*').eq('project_id',opts.projectId).in('id',pins.project.map(p=>p.id)).abortSignal(AbortSignal.timeout(10000))
        if(error)throw new Error('construction_source_unavailable');for(const row of data??[])project.set(row.id,row)
      }
      const physical=await readPhysicalCadSources(()=>createProjectLookup(opts.projectId,lookupTransport,lookupPinned.timeoutMs,64,undefined,{unlimitedWork}),pins.physical,lookup.sources,{unlimitedWork})
      return {project,physical}
    },
  }
  const constructionTools = createConstructionTools(constructionOptions)
  const calculator=hasCalculatorContract(aiCatalog)?createProjectCalculator({ unlimitedWork,projectId:opts.projectId,hasAccess,
    isEnabled:async()=>{const policy=await readToolPolicy();return policy.tools.some(t=>t.name==='calculate_project'&&t.active&&t.schema_version===1)},
    readSources:constructionOptions.readSources,
    readConstruction:async(id,revision)=>{
      const {data,error}=await client.rpc('read_construction_draft',{p_project:opts.projectId,p_artifact:id,p_revision:revision,p_after:null}).abortSignal(AbortSignal.timeout(12000))
      if(error)throw new Error('calculation_source_unavailable');return data
    },
    readSource:async(kind,id,revision)=>{
      const {data,error}=await client.rpc('read_calculation_source',{p_project:opts.projectId,p_kind:kind,p_id:id,p_revision:revision}).abortSignal(AbortSignal.timeout(12000))
      if(error)throw new Error('calculation_source_unavailable');return data
    },
    quotePacks:async(id,revision,needs)=>{
      const {data,error}=await client.rpc('pack_purchase_quote',{p_project:opts.projectId,p_article:id,p_article_revision:revision,p_needs:needs}).abortSignal(AbortSignal.timeout(12000))
      if(error)throw new Error('calculation_source_unavailable')
      const article=await client.rpc('read_supplier_article',{p_project:opts.projectId,p_article:id,p_revision:revision}).abortSignal(AbortSignal.timeout(12000))
      if(article.error||article.data?.id!==id||article.data?.revision!==revision)throw new Error('calculation_source_unavailable')
      return {...data,source_state:article.data.source_state==='current'&&!article.data.catalog_changed?'current':'changed'}
    },
  }):undefined
  // FORM package 3 reader: inactive until a publication enables its role and policy.
  const sourceReader = createSourceReader({ aiCatalog, userId: opts.userId, projectId: opts.projectId, hasAccess, deadline, callModel })
  const planAssistant = createPlanAssistant({ unlimitedWork,
    aiCatalog,calculator,
    ...(contextStrategy ? { registerContextSurface: registerSpecialistContextSurface } : {}),
    projectId: opts.projectId, userId: opts.userId, hasAccess, deadline,
    makeLookup: () => createProjectLookup(opts.projectId, checkpointed(async(projectId:string,input:LookupInput,signal:AbortSignal)=>{
      if(input.dataset!=='plan')return lookupTransport(projectId,input,signal)
      const {data,error}=await rpc('project_plan_read',{p_project:projectId,p_revision:null},signal)
      return {data:{records:data?.record?[data.record]:[],related:[],truncated:false},error}
    }), lookupPinned.timeoutMs, 128, 512*1024, lookupOptions),
    callModel,
  })
  const drawingRequestCall=async(raw:Record<string,unknown>)=>{
   // Read timestamps change during replay; record revisions and values do not.
   const input=JSON.parse(JSON.stringify(raw,(key,value)=>key==='retrievedAt'?undefined:value))
   return memo('cad:request',input,async(identity)=>{
    const {data,error}=await internal.rpc('bob_drawing_request',{...binding,p_user:opts.userId,...input,p_write_key:(opts.background?.drawingRequestId?opts.background.jobId:opts.clientTurnId)+':'+(identity?.key??crypto.randomUUID())}).abortSignal(AbortSignal.timeout(12000))
    if(error)throw new Error(drawingErrorCode(error)??'drawing_request_unavailable')
    return data
   })
  }
  drawingBudget=createDrawingBudget({executionId:opts.background?.jobId??opts.clientTurnId,command:async input=>{
      const {data,error}=await internal.rpc('bob_drawing_budget',{...binding,p_user:opts.userId,...input}).abortSignal(AbortSignal.timeout(12000))
      if(error)throw new Error(drawingErrorCode(error)??'drawing_budget_unavailable')
      return data
  }})

  const requestStore = claimedServer ? createDrawingRequestStore({aiCatalog,projectId:opts.projectId,binding,journal,
      privateCall:drawingRequestCall,
      // One stable id per piece key; the unkeyed id keeps its existing journal identity.
      newId:key=>memo('cad:project_request_id',key?{key}:{},async()=>crypto.randomUUID()),
      release:ids=>writing(async()=>{
        const {data,error}=await internal.rpc('release_drawing_pieces',{...binding,p_user:opts.userId,p_ids:ids}).abortSignal(AbortSignal.timeout(12000))
        if(error)throw new Error(error.message?.includes('project_denied')?'project_denied':'drawing_pieces_unavailable')
        return {released:Array.isArray(data?.released)?data.released:[]}
      }),
      // Gap Tasks, links, restore and cancel change what lookups return; the
      // three reads do not.
      caller:(name,args)=>{
        const call=async()=>{
          const {data,error}=await client.rpc(name,args).abortSignal(AbortSignal.timeout(10000))
          if(error)throw new Error(drawingErrorCode(error)??'drawing_request_unavailable')
          return data
        }
        return DRAWING_STORE_READS.has(name)?call():writing(call)
      },
    }) : undefined

  const cadAssistant = createCadAssistant({ unlimitedWork,
    // Same fixed grounding read order as Bob's own call: parallel reads can swap journal positions on resume.
    groundingReadOrder: execution.groundingReadOrderVersion === 1 ? 'serial' : 'parallel',
    allowSourceRenewal:execution.constructionReplayVersion===2,
    aiCatalog,calculator,
    ...(contextStrategy ? { registerContextSurface: registerSpecialistContextSurface } : {}),
    runtimeVersion:()=>memo('cad:runtime',{},()=>drawingRuntimeVersion(internal,{model:!!Deno.env.get('OPENAI_API_KEY'),cad:!!Deno.env.get('BOB_CAD_URL')&&!!Deno.env.get('BOB_CAD_TOKEN')},aiCatalog)),
    requestModel:async(id,_options,work)=>{
      const previous=drawingRequestId;drawingRequestId=id
      try{return await work()}finally{drawingRequestId=previous}
    },
    ...(requestStore ? { requestStore } : {}),
    projectId:opts.projectId,userId:opts.userId,hasAccess,deadline,knowledgeReader,ownerRequest:opts.message,durable:!!opts.background?.asyncModels,
    // Checkpoints name a reviewed candidate's render step instead of copying its files.
    ...(checkpoint && opts.background?.loadRenderFiles ? { loadRenderFiles: opts.background.loadRenderFiles } : {}),
    readDesignReadiness,
    // Used only by the catalog-gated targeted review; the full review never reads it.
    readConstructionObservations:constructionOptions.readObservations,
    available:!!Deno.env.get('BOB_CAD_URL')&&!!Deno.env.get('BOB_CAD_TOKEN'),
    makeLookup:()=>createProjectLookup(opts.projectId,lookupTransport,lookupPinned.timeoutMs,40,undefined,lookupOptions),
    callModel,
    render:(recipe,source,beforeDispatch)=>{
     if(!source)throw new Error('checked_construction_source_required')
     return memo('cad:render',cadRenderInput(recipe,source),async()=>{
      await beforeDispatch?.()
      // Drawings carry no fasteners (owner decision 2026-10-26): they live in
      // Bob's construction lists and the material list only.
      return createCadTransport(Deno.env.get('BOB_CAD_URL'),Deno.env.get('BOB_CAD_TOKEN'))(recipe,source)
     },45000)
    },
    checkConstruction:async(id,revision,fresh)=>{
     // One check reads the same exact revision twice (the check itself and
     // the final pin comparison). Within one check those reads observe the
     // same moment, so the second is served from the first.
     const seen=new Map<string,Promise<unknown>>()
     const check=()=>checkedConstructionForDrawing({...constructionOptions,
      // New CAD dispatch must not consume an interactive historical check.
      readCurrent:undefined,
      // The actual operation reads fresh caller data. Recorded gate outcomes
      // reconstruct earlier replies; render/review dispatch guards bypass them.
      read:(artifact,rev,after)=>{
        const key=JSON.stringify([artifact,rev,after])
        if(rev!==null&&!seen.has(key))seen.set(key,(async()=>{
          const {data,error}=await readWithRetry('read_construction_draft',{p_project:opts.projectId,p_artifact:artifact,p_revision:rev,p_after:after})
          if(error)throw new Error('construction_read_unavailable');return data
        })())
        if(rev!==null)return seen.get(key)!.then(value=>structuredClone(value))
        return readWithRetry('read_construction_draft',{p_project:opts.projectId,p_artifact:artifact,p_revision:rev,p_after:after}).then(({data,error})=>{
          if(error)throw new Error('construction_read_unavailable');return data
        })
      },
      readCatalog:async(artifact,rev)=>{
        const {data,error}=await readWithRetry('catalog_read',{p_project:opts.projectId,p_input:{action:'read',id:artifact,revision:rev,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}})
        if(error)throw new Error('construction_source_unavailable');return data
      },
     },id,revision)
     return fresh?check():memo('cad:construction_check',{id,revision},check)
    },
    readShell:async(id,revision)=>{
      const {data,error}=await rpc('read_cad_shell',{p_project:opts.projectId,p_shell:id,p_revision:revision},AbortSignal.timeout(10000))
      if(error)throw new Error('cad_shell_read_unavailable');return data
    },
    readArtifact:async(id,revision,fresh)=>{
      const args={p_project:opts.projectId,p_artifact:id,p_revision:revision}
      const {data,error}=await(fresh?client.rpc('read_cad_artifact',args).abortSignal(AbortSignal.timeout(10000)):rpc('read_cad_artifact',args,AbortSignal.timeout(10000)));
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
    catalog:createMaterialCatalogReader(opts.projectId,checkpointed((input:Record<string,unknown>,signal:AbortSignal)=>rpc('catalog_read',{p_project:opts.projectId,p_input:input},signal)),hasAccess,lookup.sources,undefined,{unlimitedWork}),
    context:createProjectContext({ unlimitedWork,adapters:[mediaAdapter()],hasAccess,sources:lookup.sources,reviewInstruction:aiCatalog.text('drawing-review.instruction'),imageEvidenceInstruction:aiCatalog.text('images.evidence-intro'),reviewLabel:aiCatalog.text('images.review-label')}),
    referenceImageRefs:()=>projectContext.openedImageRefs(),
  })
  if(opts.background?.drawingRequestId){
    // This is an audited domain-event execution of the original instruction.
    // No invented user turn, model-written mandate or generic project tool loop.
    const request=await drawingRequestCall({p_operation:'load',p_id:opts.background.drawingRequestId})
    if(!request)return {ok:false,error:'drawing_request_unavailable'}
    if(request.status==='saved'){
      if(!confirmedDrawingReceipt(request.receipt,opts.projectId))return {ok:false,error:'drawing_save_unconfirmed'}
      const answer=await drawingResumeReply({projectId:opts.projectId,message:opts.message,userId:opts.userId,outcome:{status:'already_saved'},drawingReceipt:request.receipt,hasAccess,callModel})
      return {ok:true,projectId:opts.projectId,answer,evidence:{kind:'ai_assessment',references:[],sources:[],partial:false,writes:[request.receipt]}}
    }
    if(['paused','cancelled'].includes(request.status))return {ok:false,error:'drawing_request_inactive'}
    const outcome:Record<string,any>=await cadAssistant.consult({...request.payload.brief,request_id:request.id})
    const ready=await cadAssistant.candidateForSave()
    const candidate=ready.status==='ready'?ready.candidate:null
    let drawingReceipt
    if(candidate&&writer){
      const receipt=await writer.commit({kind:'cad',record_id:candidate.artifact_id,expected_updated_at:null,expected_revision:candidate.expected_revision,request_quote:opts.message.slice(0,500),data:candidate})
      if(receipt.status!=='saved'||!confirmedDrawingReceipt(receipt.receipt,opts.projectId))return {ok:false,error:'drawing_save_unconfirmed'}
      await cadAssistant.markSaved()
      drawingReceipt=receipt.receipt
    }
    journal?.check()
    const saved=!!drawingReceipt
    const answer=await drawingResumeReply({projectId:opts.projectId,message:opts.message,userId:opts.userId,outcome,drawingReceipt,receipts:writer?.receipts,hasAccess,callModel})
    await metrics.finish({ok:true,partial:!saved,writes:writer?.receipts.length??0,cad:cadAssistant.metrics})
    return {ok:true,projectId:opts.projectId,answer,evidence:{kind:'ai_assessment',references:[],sources:cadAssistant.sources,partial:!saved,writes:writer?.receipts??[]}}
  }
  const imageTools=writer?createProjectImageTools({ unlimitedWork,projectId:opts.projectId,message:opts.message,writer,hasAccess,deadline,defaultImageIds:attachedImageIds,
    newId: () => memo('image:id', {}, async () => crypto.randomUUID()),
    generate: async (prompt,referenceIds) => {
      const role = aiCatalog.role('project-image')
      const unopened=referenceIds.filter(id=>!projectContext.openedImageRefs().includes('image:'+id))
      await prepareChatImages(projectContext,unopened)
      // Compact, exact-version checkpoints; re-authorise/download original
      // bytes only inside a fresh provider dispatch. Missing photos never turn
      // a requested photo edit into an unrelated text-only generation.
      const references=await Promise.all(referenceIds.map(id=>mediaAdapter().open('image:'+id,AbortSignal.timeout(12000))))
      const inputReferences=references.map(r=>({id:r.source.recordId,version:r.version}))
      if(references.reduce((total,r)=>total+r.bytes,0)>16*1024*1024)return {ok:false as const,error:'unsupported_image_references'}
      if(!await projectContext.validate())throw new Error('context_changed')
      const result = await memo('image:generate', { prompt, references:inputReferences, manifestId: role.manifestId, roleVersionId: role.roleVersionId }, async () => {
        if(!await hasAccess())throw new Error('project_denied')
        const referenceImages=await Promise.all(references.map(async r=>{
          const data=await resolveMediaImage(opts.projectId,mediaTransport,r,AbortSignal.timeout(12000))
          const match=data.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
          if(!match)throw new Error('unsupported_image')
          const binary=atob(match[2]),bytes=new Uint8Array(binary.length)
          for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)
          return {contentType:match[1] as 'image/png'|'image/jpeg'|'image/webp',bytes}
        }))
        const generated = await generateImage({app:'bob',coworkerId:'bob',functionName:'project-image',userId:opts.userId,prompt,referenceImages,timeoutMs:100000,aiDefinition:role})
        if (!generated.ok) return generated
        if(!await hasAccess()||!await projectContext.validate())throw new Error('context_changed')
        let encoded = ''; for (let i=0;i<generated.image.length;i+=8192) encoded+=String.fromCharCode(...generated.image.subarray(i,i+8192))
        return {ok:true as const,image:btoa(encoded)}
      },100000)
      if (!result.ok) return result
      // Runs on every replay of the journaled image: a plain loop, not a per-byte mapper.
      const binary = atob(result.image), image = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) image[i] = binary.charCodeAt(i)
      return {ok:true,image}
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
  },hasAccess,{unlimitedWork})
  // Only the active operation replays. These components own the exact refs,
  // receipts, candidates and evidence that completed operations already made.
  const components: Record<string, { exportState(): unknown; restoreState(state: any): void } | undefined> = {
    projectLookup, groundingLookup, writer, projectContext, currentViewGuard, knowledgeReader, operationalReader,
    catalogReader, constructionTools, calculator, planAssistant, cadAssistant, imageTools, recordReader,
    planLinks, buildingScope, workRecords, solutionActions, projectEdits, requestStore, modelBudget, contextContinuation, metrics, sourceReader,
  }
  // Added after earlier checkpoints were written: absent state restores as an
  // unused component, and unused state is not saved.
  const optionalComponents = new Set(['buildingScope', 'sourceReader'])
  if (restart) {
    const state = restart.state
    if (state.version !== 1 || !state.answer || !state.components || typeof state.components !== 'object'
      || !state.runtime || typeof state.runtime !== 'object') throw new Error('turn_checkpoint_invalid')
    const saved = state.components as Record<string, unknown>
    if (Object.keys(saved).some(name => !components[name])) throw new Error('turn_checkpoint_component_missing')
    for (const [name, component] of Object.entries(components)) {
      if (!component) continue
      if (!(name in saved)) { if (optionalComponents.has(name)) continue; throw new Error('turn_checkpoint_component_missing') }
      component.restoreState(saved[name])
    }
    const runtime = state.runtime as { imageRefs: [string, Opened][]; mainContextEpoch: number; priorDrawingAttemptUncertain: boolean; memoryEmbeddingOutcomeUncertain: boolean }
    if (!Array.isArray(runtime.imageRefs) || !Number.isSafeInteger(runtime.mainContextEpoch) || runtime.mainContextEpoch < 0
      || typeof runtime.priorDrawingAttemptUncertain !== 'boolean' || typeof runtime.memoryEmbeddingOutcomeUncertain !== 'boolean') throw new Error('turn_checkpoint_invalid')
    imageRefs.clear()
    for (const [ref, record] of runtime.imageRefs) {
      if (typeof ref !== 'string' || !ref.startsWith('private-image:') || !record?.source || record.source.projectId !== opts.projectId) throw new Error('turn_checkpoint_invalid')
      imageRefs.set(ref, structuredClone(record))
    }
    mainContextEpoch = runtime.mainContextEpoch
    priorDrawingAttemptUncertain = runtime.priorDrawingAttemptUncertain
    memoryEmbeddingOutcomeUncertain = runtime.memoryEmbeddingOutcomeUncertain
    // Bootstrap used its original positions above. Restore the durable cursor
    // only now, before the pending action and its nested operation journal run.
    journal!.restoreState(restart.journalState)
  }
  const answerCheckpoint = checkpoint ? {
    state: restart?.state.answer as BobAnswerState | undefined,
    save: async (answer: BobAnswerState) => {
      await checkpoint.commit({ version: 1, answer,
        components: Object.fromEntries(Object.entries(components).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => !!entry[1])
          .filter(([name]) => (name !== 'buildingScope' || buildingScope.used) && (name !== 'sourceReader' || sourceReader.used > 0)).map(([name, component]) => [name, component.exportState()])),
        workingContext: workingContext?.exportState(),
        runtime: { imageRefs: [...imageRefs], mainContextEpoch, priorDrawingAttemptUncertain, memoryEmbeddingOutcomeUncertain },
      })
    },
  } : undefined
  // Its own journal stream, read before the first step only: a turn resumed
  // from a checkpoint already holds the facts and preloaded tools.
  const buildingLinks = execution.buildingLinkVersion === 1 && !restart && writer
    && aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.read_building_scope')
    ? await memo('building:links', { project: opts.projectId }, async () => {
      const { data, error } = await client.rpc('read_bob_building_scope_context', { p_project: opts.projectId, p_resource: 'buildings', p_building: null, p_query: null, p_after: null })
        .abortSignal(AbortSignal.timeout(12000))
      return error ? null : buildingLinkFact(data)
    }).catch(error => { rethrowContinuation(error); return null })
    : null
  // One bounded read of saved project facts before the first step. A failed
  // read degrades to unavailable; access is still checked at every step. A
  // turn resumed from a checkpoint already holds them in its first messages.
  const projectFacts = execution.projectFactsVersion === 1 && !restart
    ? await readRpc('read_project_facts', { p_project: opts.projectId })
      .then(({ data, error }) => projectFactsPacket(data, !!error, opts.projectId))
      .catch(error => { rethrowContinuation(error); return projectFactsPacket(null, true, opts.projectId) })
    : null
  try {
  const result=await runClaimedProjectTurn({
    aiCatalog,
    observe:value=>metrics!.observe(value), onTool:value=>metrics!.tool(value), onProgress:opts.background?.progress,
    onToolBatch:names=>{ constructionReadsInStep = names.filter(name => name === CONSTRUCTION_VIEW_TOOL.function.name).length },
    // A fresh explicit retry of a failed durable job has receipts but no old
    // journal. Continue from current records as well as during journal replay;
    // receipt-only recovery would abandon the unfinished part of the request.
    ...opts, unlimitedWork, currentView, validateCurrentView, getCurrentViewEvidence, resume: !!opts.background, beforeSettle: () => journal?.check(), modelTimeoutMs: opts.background ? 100000 : 45000, lookup, hasAccess, writer, knowledgeReader, operationalReader, projectContext, catalogReader, constructionTools, projectEdits, solutionActions, workRecords, planLinks, buildingScope, calculator, planAssistant, cadAssistant, imageTools, recordReader, sourceReader, generation: claimedServer?.generation, deadline,
    readToolPolicy,
    checkpoint: answerCheckpoint,
    // Older in-flight journals keep their recorded post-rollover requests.
    carryLoadedTools: execution.toolCarryVersion === 1,
    ...(execution.corePreloadVersion === 1 ? { corePreload: true } : {}),
    ...(buildingLinks ? { buildingLinks } : {}),
    ...(execution.projectFactsVersion === 1 ? { pureFacts: true, ...(projectFacts ? { projectFacts } : {}) } : {}),
    ...(execution.completeRequestVersion === 1 ? { completeRequest: true } : {}),
    ...(execution.resultReferenceVersion === 1 ? { resultReferences: true } : {}),
    ...(contextStrategy ? { contextEpoch: () => mainContextEpoch,
      registerContextSurface: (refresh: () => Promise<ContextSurface>) => { refreshMainContextSurface = refresh },
    } : {}),
    ...(claimedServer && threadId ? { prepareContext: async () => {
      const sourceStore = conversations.workingContext({ projectId: opts.projectId, userId: opts.userId, threadId, turnId: opts.clientTurnId, generation: claimedServer.generation })
      const journalled = contextStrategy ? journalMemoryStore(sourceStore, memo) : undefined
      const store = journalled ? { ...journalled,
        load: async () => ({ ...await journalled.load() as object, generation: claimedServer.generation }),
      } : {
        load: async () => ({ ...await memo('context:load', {}, sourceStore.load) as object, generation: claimedServer.generation }),
        save: (expected: number, through: number, summary: string) => memo('context:save', { expected, through, summary }, async () => {
          try { return await sourceStore.save(expected, through, summary) }
          catch (error) {
            const current = await sourceStore.load() as { lastFoldedSeq?: number; summary?: string }
            if (current.lastFoldedSeq === through && current.summary === summary) return { lastFoldedSeq: through }
            throw error
          }
        }),
        search: (query: string, before: number | null) => memo('context:search', { query, before }, () => sourceStore.search(query, before)),
      }
      const embeddingRole = contextStrategy ? aiCatalog.role('memory-embedding') : undefined
      const retrieval = embeddingRole ? createMemoryRetrieval({ projectId: opts.projectId, threadId, store, hasAccess,
        embedder: createJournalledMemoryEmbedder({ model: embeddingRole.model.model_name, identity: embeddingRole, memo, hasAccess,
          onUncertain: () => { memoryEmbeddingOutcomeUncertain = true },
          invoke: texts => callOpenAIEmbeddings({ app: 'bob', coworkerId: 'bob', module: 'global', functionName: 'memory-embedding', aiFunction: 'memory-embedding',
            userId: opts.userId, aiDefinition: embeddingRole, input: texts, timeoutMs: Math.max(1000, Math.min(15000, deadline - Date.now(), journal ? journal.remaining() - 3000 : Infinity)),
          }),
        }),
      }) : undefined
      if (restart) {
        const saved = restart.state.workingContext as WorkingContextState | undefined
        if (!saved) throw new Error('context_checkpoint_invalid')
        return workingContext = restoreWorkingContext(saved, { projectId: opts.projectId, threadId, message: opts.message, store, hasAccess, unlimitedWork, retrieval })
      }
      return workingContext = await prepareWorkingContext({
      projectId: opts.projectId, userId: opts.userId, threadId, generation: claimedServer.generation, message: opts.message,
      memoryManagementVersion: execution.memoryManagementVersion,
      ...(contextStrategy && aiCatalog.definition('schema.bob_conversation_brief_v2').metadata.memory_pointer_scope_version === 1
        ? { memoryPointerScopeVersion: 1 as const } : {}),
      ...(contextStrategy && aiCatalog.definition('schema.bob_conversation_brief_v2').metadata.memory_gist_only_version === 1
        ? { memoryGistOnlyVersion: 1 as const } : {}),
      store, ...(retrieval ? { retrieval } : {}),
      callModel, hasAccess, unlimitedWork, deadline: unlimitedWork ? deadline : Math.min(deadline - 60000, Date.now() + 105000),
    }) } } : {}),
    // The main answer/continuation model gets the evidence policy. The older-history
    // summarizer above is deliberately separate: it must not fetch project images.
    callModel: createGroundedModelCall({
      groundingInstruction: aiCatalog.text('bob.grounding'),
      readOrder: execution.groundingReadOrderVersion === 1 ? 'serial' : 'parallel',
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
