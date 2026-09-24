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
  const lookupTransport = (projectId: string, input: LookupInput, signal: AbortSignal) =>
    client.rpc('search_bob_project_data_v8', {
      p_project_id: projectId, p_dataset: input.dataset, p_query: input.query,
      p_status: input.status, p_area_id: input.area_id, p_record_id: input.record_id, p_after_id: input.after_id ?? null,
    }).abortSignal(signal)
  const lookup = createProjectLookup(opts.projectId, lookupTransport, 10_000, 12)
  const hasAccess = async () => {
    const { data, error } = await client.from('projects').select('id').eq('id', opts.projectId)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    return !error && data?.id === opts.projectId
  }

  if (!await hasAccess()) return { ok: false, error: 'project_denied' }
  let claim: BobTurnClaim
  try {
    claim = await conversations.claim(opts.projectId, opts.userId, opts.clientTurnId, opts.message)
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
  const deadline = Date.now() + 215000
  const threadId = claimedServer?.thread_id ?? null
  const binding = { p_project: opts.projectId, p_thread: threadId, p_turn: opts.clientTurnId, p_generation: claimedServer?.generation }
  // The v8 wrapper preserves all older write kinds and the same claimed-turn ledger.
  const writer = claimedServer ? createProjectWriter(opts.projectId, opts.message,
    payload => client.rpc('bob_project_write_v10', { ...binding, p_payload: payload }).abortSignal(AbortSignal.timeout(12_000)),
    () => client.rpc('bob_read_write_receipts', binding).abortSignal(AbortSignal.timeout(12_000)),
    () => client.rpc('bob_settle_project_writes', binding).abortSignal(AbortSignal.timeout(12_000)),
  ) : undefined
  const projectContext = createProjectContext({
    adapters: [createMediaAdapter(opts.projectId, createMediaTransport(client, { ...opts, url, key }))],
    hasAccess, sources: lookup.sources,
  })
  const catalogReader = createMaterialCatalogReader(opts.projectId,
    (input, signal) => client.rpc('catalog_read', { p_project: opts.projectId, p_input: input }).abortSignal(signal),
    hasAccess, lookup.sources)
  const planAssistant = createPlanAssistant({
    projectId: opts.projectId, userId: opts.userId, hasAccess, deadline,
    makeLookup: () => createProjectLookup(opts.projectId, async(projectId,input,signal)=>{
      if(input.dataset!=='plan')return lookupTransport(projectId,input,signal)
      const {data,error}=await client.rpc('project_plan_read',{p_project:projectId,p_revision:null}).abortSignal(signal)
      return {data:{records:data?.record?[data.record]:[],related:[],truncated:false},error}
    }, 10_000, 128, 512*1024),
    callModel: options => callOpenAIResponses(options),
  })
  const cadAssistant = createCadAssistant({
    projectId:opts.projectId,userId:opts.userId,hasAccess,deadline,
    available:!!Deno.env.get('BOB_CAD_URL')&&!!Deno.env.get('BOB_CAD_TOKEN'),
    makeLookup:()=>createProjectLookup(opts.projectId,lookupTransport,10000,40),
    callModel:options=>callOpenAIResponses<string>(options),
    render:createCadTransport(Deno.env.get('BOB_CAD_URL'),Deno.env.get('BOB_CAD_TOKEN')),
    readArtifact:async(id,revision)=>{
      const {data,error}=await client.rpc('read_cad_artifact',{p_project:opts.projectId,p_artifact:id,p_revision:revision}).abortSignal(AbortSignal.timeout(10000));
      if(error)throw new Error('cad_read_unavailable');return data
    },
    catalog:createMaterialCatalogReader(opts.projectId,(input,signal)=>client.rpc('catalog_read',{p_project:opts.projectId,p_input:input}).abortSignal(signal),hasAccess,lookup.sources),
    context:createProjectContext({adapters:[createMediaAdapter(opts.projectId,createMediaTransport(client,{...opts,url,key}))],hasAccess,sources:lookup.sources}),
  })
  const imageTools=writer?createProjectImageTools({projectId:opts.projectId,message:opts.message,writer,hasAccess,deadline,
    generate:prompt=>generateImage({app:'bob',coworkerId:'bob',functionName:'project-image',userId:opts.userId,prompt,timeoutMs:Math.min(120000,Math.max(1000,deadline-Date.now()-20000))}),
    upload:async(id,bytes)=>{const {error}=await client.storage.from('bob-project-media').upload(`${opts.projectId}/${id}`,bytes,{contentType:'image/png',upsert:false,cacheControl:'0'});if(error)throw new Error('upload_failed')},
  }):undefined
  const recordReader=createRecordDetailReader(async(dataset,id,revision)=>{
    const {data,error}=dataset==='plan'
      ?await client.rpc('project_plan_read',{p_project:opts.projectId,p_revision:Number(id)}).abortSignal(AbortSignal.timeout(10000))
      :await client.rpc('read_cad_artifact',{p_project:opts.projectId,p_artifact:id,p_revision:revision}).abortSignal(AbortSignal.timeout(10000));
    if(error)throw new Error('record_unavailable');return dataset==='plan'?data?.record:data
  },hasAccess)
  return runClaimedProjectTurn({
    ...opts, lookup, hasAccess, writer, projectContext, catalogReader, planAssistant, cadAssistant, imageTools, recordReader, generation: claimedServer?.generation, deadline,
    readToolPolicy: createToolPolicyReader(client, opts.projectId),
    ...(claimedServer && threadId ? { prepareContext: () => prepareWorkingContext({
      projectId: opts.projectId, userId: opts.userId, threadId, generation: claimedServer.generation, message: opts.message,
      store: conversations.workingContext({ projectId: opts.projectId, userId: opts.userId, threadId, turnId: opts.clientTurnId, generation: claimedServer.generation }),
      callModel: options => callOpenAIResponses<string>(options), hasAccess, deadline: Math.min(deadline - 60000, Date.now() + 105000),
    }) } : {}),
    // The main answer/continuation model gets the evidence policy. The older-history
    // summarizer above is deliberately separate: it must not fetch project images.
    callModel: createGroundedModelCall({
      projectId: opts.projectId, message: opts.message, lookup, hasAccess, deadline,
      validateImages: () => projectContext.validate(),
      callModel: options => callOpenAIResponses<string>(options),
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
