import { BobContinuation, type BobJournal } from './bob-job-journal.ts'
import type { OpenAIServiceOptions } from './openai-service.ts'
import { createRecordDetailReader } from './project-record-detail.ts'
import { createProjectImageTools } from './project-image-tools.ts'
import { createCadAssistant } from './cad-assistant.ts'
import { createCadTransport } from './cad-transport.ts'
import { createMaterialCatalogReader } from './material-catalog.ts'
import { createToolPolicyReader } from './project-tools/policy-reader.ts'
import { createGroundedModelCall } from './project-grounding.ts'
import { createProjectContext } from './project-context/dispatcher.ts'
import { createMediaAdapter } from './project-context/media.ts'
import { createMediaTransport } from './project-context/media-transport.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { callOpenAIResponses, generateImage } from './openai-service.ts'
import { createBobConversationStore, type BobTurnClaim } from './bob-conversation.ts'
import { createProjectLookup, type LookupInput } from './project-lookup.ts'
import { createPlanAssistant } from './plan-assistant.ts'
import type { ProjectAnswer } from './project-answer.ts'
import { createProjectWriter } from './project-write.ts'
import { prepareWorkingContext } from './bob-working-context.ts'
import { runClaimedProjectTurn } from './project-turn.ts'

/** Project reads and writes use the caller JWT. Service access is restricted to shared AI
 * config/accounting plus Bob's private transcript/provider-state commands. */
export async function answerWithOpenAi(opts: {
  authHeader: string; userId: string; projectId: string; message: string; clientTurnId: string;
  background?: { claim: Extract<BobTurnClaim, { status: 'claimed'; mode: 'server' }>; journal: BobJournal; deadline: number; replay: boolean };
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
  const memo = async <T>(stream: string, input: unknown, work: () => Promise<T>, reserve = 0): Promise<T> =>
    journal ? journal.run(stream, input, work, reserve) : work()
  const rpc = async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
    const { p_generation: _generation, ...stable } = args
    return memo('rpc:' + name, stable, async () => {
      const { data, error } = await client.rpc(name, args).abortSignal(signal)
      return { data, error }
    })
  }
  const callModel = (options: OpenAIServiceOptions) => memo('model:' + options.functionName, options, async () => {
    const result = await callOpenAIResponses<string>(options)
    if (journal && !result.success && /Network error|OpenAI API error: (429|5[0-9]{2})/.test(result.error ?? '')) throw new BobContinuation('yield', 'provider_retry')
    return result
  }, options.timeoutMs ?? 120000)
  const mediaAdapter = () => {
    const adapter = createMediaAdapter(opts.projectId, createMediaTransport(client, { ...opts, url, key }))
    return { ...adapter,
      count: (signal: AbortSignal) => memo('media:count', {}, () => adapter.count(signal)),
      list: (...args: Parameters<typeof adapter.list>) => memo('media:list', args[0], () => adapter.list(...args)),
      open: (...args: Parameters<typeof adapter.open>) => memo('media:open', args[0], () => adapter.open(...args)),
      // current() remains LIVE, including for already-replayed image evidence.
    }
  }
  const lookupTransport = (projectId: string, input: LookupInput, signal: AbortSignal) =>
    rpc('search_bob_project_data_v8', {
      p_project_id: projectId, p_dataset: input.dataset, p_query: input.query,
      p_status: input.status, p_area_id: input.area_id, p_record_id: input.record_id, p_after_id: input.after_id ?? null,
    }, signal)
  const lookup = createProjectLookup(opts.projectId, lookupTransport, 10_000, 12)
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
  const threadId = claimedServer?.thread_id ?? null
  const binding = { p_project: opts.projectId, p_thread: threadId, p_turn: opts.clientTurnId, p_generation: claimedServer?.generation }
  // The v8 wrapper preserves all older write kinds and the same claimed-turn ledger.
  const writer = claimedServer ? createProjectWriter(opts.projectId, opts.message,
    payload => rpc('bob_project_write_v11', { ...binding, p_payload: payload }, AbortSignal.timeout(12_000)),
    () => client.rpc('bob_read_write_receipts', binding).abortSignal(AbortSignal.timeout(12_000)),
    () => client.rpc('bob_settle_project_writes', binding).abortSignal(AbortSignal.timeout(12_000)),
  ) : undefined
  const projectContext = createProjectContext({
    adapters: [mediaAdapter()],
    hasAccess, sources: lookup.sources,
  })
  const catalogReader = createMaterialCatalogReader(opts.projectId,
    (input, signal) => rpc('catalog_read', { p_project: opts.projectId, p_input: input }, signal),
    hasAccess, lookup.sources)
  const planAssistant = createPlanAssistant({
    projectId: opts.projectId, userId: opts.userId, hasAccess, deadline,
    makeLookup: () => createProjectLookup(opts.projectId, async(projectId,input,signal)=>{
      if(input.dataset!=='plan')return lookupTransport(projectId,input,signal)
      const {data,error}=await rpc('project_plan_read',{p_project:projectId,p_revision:null},signal)
      return {data:{records:data?.record?[data.record]:[],related:[],truncated:false},error}
    }, 10_000, 128, 512*1024),
    callModel,
  })
  const cadAssistant = createCadAssistant({
    projectId:opts.projectId,userId:opts.userId,hasAccess,deadline,
    available:!!Deno.env.get('BOB_CAD_URL')&&!!Deno.env.get('BOB_CAD_TOKEN'),
    makeLookup:()=>createProjectLookup(opts.projectId,lookupTransport,10000,40),
    callModel,
    render:recipe=>memo('cad:render',recipe,()=>createCadTransport(Deno.env.get('BOB_CAD_URL'),Deno.env.get('BOB_CAD_TOKEN'))(recipe),45000),
    readArtifact:async(id,revision)=>{
      const {data,error}=await rpc('read_cad_artifact',{p_project:opts.projectId,p_artifact:id,p_revision:revision},AbortSignal.timeout(10000));
      if(error)throw new Error('cad_read_unavailable');if(!data)return null
      const links=await memo('cad:work_scope',{id,revision},async()=>{
        const result=await client.from('current_drawing_steps').select('step_id')
          .eq('project_id',opts.projectId).eq('artifact_id',id).abortSignal(AbortSignal.timeout(10000))
        if(result.error)throw new Error('drawing_links_unavailable');return result.data.map(row=>row.step_id)
      })
      return {...data,current_step_ids:links}
    },
    catalog:createMaterialCatalogReader(opts.projectId,(input,signal)=>rpc('catalog_read',{p_project:opts.projectId,p_input:input},signal),hasAccess,lookup.sources),
    context:createProjectContext({adapters:[mediaAdapter()],hasAccess,sources:lookup.sources}),
  })
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
  return runClaimedProjectTurn({
    ...opts, resume: opts.background?.replay, beforeSettle: () => journal?.check(), modelTimeoutMs: opts.background ? 100000 : 45000, lookup, hasAccess, writer, projectContext, catalogReader, planAssistant, cadAssistant, imageTools, recordReader, generation: claimedServer?.generation, deadline,
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
      projectId: opts.projectId, message: opts.message, lookup, hasAccess, deadline,
      validateImages: () => projectContext.validate(),
      callModel,
    }),
    fail: async generation => {
      if (threadId) await conversations.fail(opts.projectId, opts.userId, threadId, opts.clientTurnId, generation)
    },
    ...(threadId ? { commit: async (result: Extract<ProjectAnswer, { ok: true }>, generation: number) => {
      await conversations.commit({ projectId: opts.projectId, userId: opts.userId, threadId,
        turnId: opts.clientTurnId, answer: result.answer, evidence: result.evidence,
        providerResponseId: result.providerResponseId ?? null, generation })
    } } : {}),
  })
}
