import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { callOpenAIResponses } from './openai-service.ts'
import { createBobConversationStore, type BobTurnClaim } from './bob-conversation.ts'
import { createProjectLookup } from './project-lookup.ts'
import { runProjectAnswer, type ProjectAnswer } from './project-answer.ts'

/** Project reads use the caller JWT. Service access is restricted to shared AI
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
  const lookup = createProjectLookup(opts.projectId, (projectId, input, signal) =>
    client.rpc('search_project_data', {
      p_project_id: projectId, p_dataset: input.dataset, p_query: input.query,
      p_status: input.status, p_area_id: input.area_id, p_record_id: input.record_id,
    }).abortSignal(signal))
  const hasAccess = async () => {
    const { data, error } = await client.from('projects').select('id').eq('id', opts.projectId)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    return !error && data?.id === opts.projectId
  }

  // Access is checked with the caller JWT before the service-role conversation
  // helper sees a project/user id. The helper independently verifies membership.
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

  const persisted = claim.mode === 'server' && claim.status === 'claimed'
  const previousResponseId = persisted ? claim.previous_response_id ?? undefined : undefined
  const threadId = persisted ? claim.thread_id : null

  const failClaim = async () => {
    if (!threadId) return
    try { await conversations.fail(opts.projectId, opts.userId, threadId, opts.clientTurnId) } catch { /* stale lock recovery remains available */ }
  }

  const result = await runProjectAnswer({
    ...opts,
    lookup,
    hasAccess,
    previousResponseId,
    callModel: options => callOpenAIResponses<string>(options),
  })
  if (!result.ok) {
    await failClaim()
    return result
  }

  if (threadId) {
    if (!result.providerResponseId) {
      await failClaim()
      return { ok: false, error: 'provider_state_unavailable' }
    }
    try {
      await conversations.commit({
        projectId: opts.projectId,
        userId: opts.userId,
        threadId,
        turnId: opts.clientTurnId,
        answer: result.answer,
        evidence: result.evidence,
        providerResponseId: result.providerResponseId,
      })
    } catch (error) {
      await failClaim()
      return { ok: false, error: String(error).includes('project_denied') ? 'project_denied' : 'conversation_unavailable' }
    }
  }

  return result
}
