import { accountClient as bobDb } from './supabaseClient'
import type { ChatMessage } from './types'
import type { AnswerEvidence } from './provenance'
import { getActiveProjectId, PROJECT_CHANGED_EVENT } from './databaseCore'
import { isBobAnswerEvidence } from './bobEvidence'
import { readBobTranscript, readDrawingTurnRecovery, reconcileDrawingTurnRecovery } from './bobTranscript'
import { parseBobScreen, type BobScreenPointer } from '../domain/bobScreen'
import { BOB_HISTORY_PAGE_SIZE, readHistoryWindow } from './bobHistory'

const GUEST_EMAIL = 'guest@bob.local'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type AskBobResponse = {
  ok: boolean
  error?: string
  projectId?: string
  status?: string
  jobId?: string
  expiresAt?: string
  summary?: string
  evidence?: AnswerEvidence
}

/** Content-free progress of a background turn: stage, tool name, step, saved count. */
export interface BobProgress { stage: 'thinking' | 'tool' | 'finishing'; tool?: string; step: number; saved: number }
function parseProgress(value: unknown): BobProgress | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (!['thinking', 'tool', 'finishing'].includes(String(v.stage)) || !Number.isSafeInteger(v.step) || !Number.isSafeInteger(v.saved)) return undefined
  return { stage: v.stage as BobProgress['stage'], step: v.step as number, saved: v.saved as number,
    ...(typeof v.tool === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v.tool) ? { tool: v.tool } : {}) }
}
const TOOL_ACTIVITY: [RegExp, string][] = [
  [/^design_project_cad$/, 'Designing the drawing — this can take a few minutes'],
  [/^save_cad_design$|drawing|room_layout|building_plan|stair|projection/, 'Working on the drawings'],
  [/plan/, 'Working on the project plan'],
  [/task|build_day|readiness/, 'Updating tasks and build days'],
  [/material|catalog|shopping/, 'Working on materials'],
  [/image|project_item|project_category/, 'Working with images'],
  [/measurement|solution|target/, 'Recording measurements and design choices'],
  [/building_context/, 'Recording the building'],
  [/knowledge/, 'Checking building references'],
  [/area|settings|description/, 'Updating the project'],
  [/conversation_history/, 'Checking the earlier conversation'],
  [/^search_|^read_/, 'Reading project records'],
]
/** A short, honest status line for the chat while Bob works. */
export function describeBobProgress(progress: BobProgress | undefined): string {
  if (!progress) return 'Bob is working on the project…'
  const activity = progress.stage === 'finishing' ? 'Writing the reply'
    : progress.stage === 'tool' && progress.tool ? TOOL_ACTIVITY.find(([pattern]) => pattern.test(progress.tool!))?.[1] ?? 'Working on the project'
    : progress.step <= 1 ? 'Reading the project' : 'Thinking through the next step'
  const saved = progress.saved === 1 ? ' · 1 change saved' : progress.saved > 1 ? ` · ${progress.saved} changes saved` : ''
  return `${activity}…${saved}`
}

export interface BobConversationHistory {
  mode: 'server' | 'local'
  messages: ChatMessage[]
  retry?: { text: string; turnId: string; screen?: BobScreenPointer | null; imageIds?: string[] }
  pending?: { text: string; turnId: string; screen?: BobScreenPointer | null; imageIds?: string[]; jobId?: string; paused?: boolean; expiresAt: number; progress?: BobProgress; notice?: string }
  lastCompletedTurnId?: string
  threadId?: string
  ownerId?: string
  latestSeq?: number
  oldestSeq?: number
  hasMore?: boolean
}

// A small preview for this account/session only. No private transcript goes into
// persistent browser storage. Cached previews never establish job/write authority.
const recentHistory = new Map<string, BobConversationHistory>()
let historyEpoch = 0, historyOwner: string | undefined
bobDb?.auth.onAuthStateChange((event, session) => {
  const owner = session?.user.id
  if (event === 'SIGNED_OUT' || historyOwner !== undefined && owner !== historyOwner) {
    recentHistory.clear(); historyEpoch++
  }
  historyOwner = owner
})

interface HistoryOptions {
  beforeSeq?: number
  threadId?: string
  onCached?: (history: BobConversationHistory) => void
}

/**
 * Normal signed-in members use Bob-owned Supabase history. The deliberately
 * shared guest Auth identity remains device-local so one guest cannot read
 * another person's private conversation.
 */
export async function getAskBobConversation(projectId: string, options: HistoryOptions = {}): Promise<BobConversationHistory> {
  if (!bobDb) return { mode: 'local', messages: [] }
  const { data: auth, error: authError } = await bobDb.auth.getSession()
  if (authError) throw new Error('Could not check the signed-in account.')
  const user = auth.session?.user
  if (!user || user.email?.toLowerCase() === GUEST_EMAIL) return { mode: 'local', messages: [] }
  const epoch = historyEpoch, cacheKey = `${user.id}/${projectId}`
  const cached = recentHistory.get(cacheKey)
  if (options.beforeSeq === undefined && cached) options.onCached?.(structuredClone(cached))
  const current = () => {
    if (epoch !== historyEpoch || projectId !== getActiveProjectId()) throw new Error('Conversation scope changed.')
  }

  const threadResult = await bobDb.from('bob_threads').select('id')
    .eq('project_id', projectId).eq('owner_user_id', user.id).eq('status', 'active').abortSignal(AbortSignal.timeout(12000)).maybeSingle()
  current()
  if (threadResult.error) throw new Error(`database: ${threadResult.error.message}`)
  if (!threadResult.data) { recentHistory.delete(cacheKey); return { mode: 'server', messages: [], ownerId: user.id } }
  if (options.threadId && options.threadId !== threadResult.data.id) throw new Error('The conversation changed. Reopen Bob.')

  let request = bobDb.from('bob_messages')
    .select('role,text,evidence,delivery_state,seq,turn_id,updated_at,image_ids')
    .eq('thread_id', threadResult.data.id)
    .order('seq', { ascending: false }).limit(BOB_HISTORY_PAGE_SIZE + 1)
  if (options.beforeSeq !== undefined) {
    if (!Number.isSafeInteger(options.beforeSeq) || options.beforeSeq < 1) throw new Error('Invalid history cursor.')
    request = request.lt('seq', options.beforeSeq)
  }
  const rows = await request.abortSignal(AbortSignal.timeout(12000))
  current()
  if (rows.error) throw new Error(`database: ${rows.error.message}`)
  const page = readHistoryWindow(rows.data ?? [])

  const turnIds = [...new Set(page.rows.map(row => row.turn_id).filter((id): id is string => !!id))]
  const [notices, latestUser] = await Promise.all([
    turnIds.length ? bobDb.from('bob_delegation_notices').select('turn_id,text').eq('thread_id', threadResult.data.id)
      .in('turn_id', turnIds).abortSignal(AbortSignal.timeout(12000)) : Promise.resolve({ data: [], error: null }),
    // Event replies can outnumber the window. The latest owner turn still owns
    // pending/retry state even when its text is on an older page.
    options.beforeSeq === undefined && !page.rows.some(row => row.role === 'user')
      ? bobDb.from('bob_messages').select('role,text,delivery_state,seq,turn_id,updated_at,image_ids')
        .eq('thread_id', threadResult.data.id).eq('role', 'user').order('seq', { ascending: false }).limit(1)
        .abortSignal(AbortSignal.timeout(12000)) : Promise.resolve({ data: [], error: null }),
  ])
  current()
  if (notices.error || latestUser.error) throw new Error('Could not read the conversation state.')
  const byTurn = new Map<string, string>((notices.data ?? []).map(row => [row.turn_id, row.text]))
  let transcript = readBobTranscript(page.rows, projectId, byTurn)
  if (options.beforeSeq !== undefined) return { mode: 'server', messages: transcript.messages,
    threadId: threadResult.data.id, ownerId: user.id, oldestSeq: page.oldestSeq, hasMore: page.hasMore }
  const { latestSeq, lastCompletedTurnId } = transcript
  const turn = latestUser.data?.length
    ? readBobTranscript([...latestUser.data, ...page.rows].sort((a, b) => a.seq - b.seq), projectId, byTurn).unfinished
    : transcript.unfinished
  let pending: BobConversationHistory['pending'] = turn?.pending ? { text: turn.text, turnId: turn.turnId, imageIds: turn.imageIds, expiresAt: turn.expiresAt } : undefined
  let retry: BobConversationHistory['retry'] = turn && !turn.pending ? { text: turn.text, turnId: turn.turnId, imageIds: turn.imageIds } : undefined
  const unfinished = pending ?? retry
  if (unfinished) {
    const job = await bobDb.rpc('bob_job_status', { p_project: projectId, p_turn: unfinished.turnId })
    if (job.error) throw new Error('Could not check Bob’s background job. Reconnecting…')
    const jobId = typeof job.data?.jobId === 'string' && UUID.test(job.data.jobId) ? job.data.jobId : undefined
    const drawingRecovery = readDrawingTurnRecovery(job.data?.drawingRecovery)
    const recoveredBudgetStop = drawingRecovery?.status === 'completed' && job.data?.status === 'failed' && job.data?.error === 'turn_budget_exhausted'
    transcript = reconcileDrawingTurnRecovery(transcript, unfinished.turnId, drawingRecovery, recoveredBudgetStop)
    // Older jobs have no pointer. Never replace a recovered turn with this page.
    try { unfinished.screen = parseBobScreen(job.data?.screen) } catch { unfinished.screen = null }
    if (job.data?.status === 'cancelled') {
      pending = undefined; retry = undefined
      const evidence = { kind: 'ai_assessment', sources: [], partial: true, writes: job.data.writes }
      transcript.messages.push({ from: 'bob', turnId: unfinished.turnId, text: 'Stopped at your request. Changes already saved remain in the project. The request was not completed.',
        ...(Array.isArray(job.data.writes) && isBobAnswerEvidence(evidence, projectId) ? { evidence } : {}) })
    } else if (recoveredBudgetStop) {
      pending = undefined; retry = undefined
    } else if (drawingRecovery && drawingRecovery.status !== 'completed') {
      pending = { ...unfinished, expiresAt: drawingRecovery.expiresAt, progress: parseProgress(drawingRecovery.progress), notice: byTurn.get(unfinished.turnId) }; retry = undefined
    } else if (job.data && ['queued', 'running', 'paused'].includes(job.data.status)) {
      const expiresAt = Date.parse(job.data.expiresAt)
      if (!Number.isFinite(expiresAt)) throw new Error('Invalid background job status')
      pending = { ...unfinished, jobId, paused: job.data.status === 'paused', expiresAt, progress: parseProgress(job.data.progress), notice: byTurn.get(unfinished.turnId) }; retry = undefined
    } else if (job.data?.status === 'failed') {
      pending = undefined
      if (job.data.error === 'turn_budget_exhausted') {
        retry = undefined
        transcript.messages.push({ from: 'bob', text: 'Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.' })
      } else retry = unfinished
    }
  }
  current()
  const history: BobConversationHistory = { mode: 'server', messages: transcript.messages, retry, pending, lastCompletedTurnId,
    threadId: threadResult.data.id, ownerId: user.id, latestSeq, oldestSeq: page.oldestSeq, hasMore: page.hasMore }
  recentHistory.delete(cacheKey)
  recentHistory.set(cacheKey, structuredClone(history))
  if (recentHistory.size > 8) recentHistory.delete(recentHistory.keys().next().value!)
  return history
}

/** Active work polling needs only status/progress; fetch the transcript at settlement. */
export async function getAskBobTurnProgress(projectId: string, turnId: string) {
  if (!bobDb || projectId !== getActiveProjectId()) return null
  const { data, error } = await bobDb.rpc('bob_job_status', { p_project: projectId, p_turn: turnId })
    .abortSignal(AbortSignal.timeout(12000))
  if (error) throw new Error('Could not check Bob’s background job.')
  if (projectId !== getActiveProjectId() || !data || !['queued', 'running', 'paused'].includes(data.status)) return null
  const expiresAt = Date.parse(data.expiresAt)
  if (!Number.isFinite(expiresAt)) throw new Error('Invalid background job status')
  return { paused: data.status === 'paused', expiresAt, progress: parseProgress(data.progress) }
}

/** Content-free exact-turn recovery check for a stopped, already-open drawer. */
export async function getAskBobDrawingRecovery(projectId: string, turnId: string) {
  if (!bobDb || projectId !== getActiveProjectId()) return undefined
  const result = await bobDb.rpc('bob_job_status', { p_project: projectId, p_turn: turnId })
  if (result.error) throw new Error('Could not check drawing recovery')
  if (projectId !== getActiveProjectId()) return undefined
  return readDrawingTurnRecovery(result.data?.drawingRecovery)
}

export interface BobInbox { threadId: string; latestSeq: number; readSeq: number; unread: boolean }
export const BOB_INBOX_EVENT = 'bob:inbox-changed'
export async function getBobInbox(projectId: string): Promise<BobInbox | null> {
  if (!bobDb) return null
  const { data: auth } = await bobDb.auth.getUser()
  if (!auth.user || auth.user.email?.toLowerCase() === GUEST_EMAIL) return null
  const { data, error } = await bobDb.rpc('bob_chat_inbox', { p_project: projectId })
  if (error) throw new Error('Could not check new messages')
  return data && typeof data.threadId === 'string' && Number.isSafeInteger(data.latestSeq) && typeof data.unread === 'boolean' ? data : null
}
export async function markBobChatRead(projectId: string, threadId: string, seq: number): Promise<void> {
  if (!bobDb) return
  const { error } = await bobDb.rpc('bob_mark_chat_read', { p_project: projectId, p_thread: threadId, p_seq: seq })
  if (error) throw new Error('Could not mark the answer as read')
  window.dispatchEvent(new Event(BOB_INBOX_EVENT))
}

/** Refresh a session nearing expiry before lending its current authority to Bob.
 * Long-running jobs can renew this same authority without creating new work. */
async function ensureFreshSession(): Promise<void> {
  if (!bobDb) return
  try {
    const { data } = await bobDb.auth.getSession()
    const expiresAt = data.session?.expires_at
    if (data.session && expiresAt && expiresAt * 1000 - Date.now() < 25 * 60_000) await bobDb.auth.refreshSession()
  } catch { /* the request below reports a real auth failure */ }
}

async function callAskBob(body: Record<string, unknown>): Promise<AskBobResponse> {
  if (!bobDb) return { ok: false, error: 'not_configured' }
  try {
    if (body.background === true || body.action === 'renew_requests') await ensureFreshSession()
    const { data, error } = await bobDb.functions.invoke('ask-bob', { body })
    if (error) {
      const response = (error as { context?: Response }).context
      if (response instanceof Response) {
        if (response.status === 401) return { ok: false, error: 'unauthorized' }
        if (response.status === 403) return { ok: false, error: 'project_denied' }
        if (response.status === 409) {
          const detail = await response.clone().json().catch(() => null)
          return { ok: false, error: body.action === 'cancel' && detail?.error === 'turn_not_in_flight' ? 'turn_not_in_flight' : 'turn_in_flight' }
        }
        if (response.status === 503) {
          const detail = await response.clone().json().catch(() => null)
          if (['context_preparing', 'context_unavailable', 'turn_budget_exhausted'].includes(detail?.error)) return { ok: false, error: detail.error }
        }
      }
      return { ok: false, error: 'seam_unreachable' }
    }
    return data ?? { ok: false, error: 'seam_unreachable' }
  } catch { return { ok: false, error: 'seam_unreachable' } }
}

export async function askBob(
  projectId: string,
  message: string,
  clientTurnId: string = crypto.randomUUID(),
  screen?: BobScreenPointer | null,
  imageIds?: string[],
): Promise<{ answer: string; evidence: AnswerEvidence } | { unavailable: string } | { pending: true; jobId: string; expiresAt: number }> {
  if (projectId !== getActiveProjectId()) return { unavailable: 'project_changed' }
  const res = await callAskBob({ action: 'send', projectId, message, clientTurnId, background: true, ...(screen !== undefined ? { screen } : {}), ...(imageIds !== undefined ? { imageIds } : {}) })
  if (projectId !== getActiveProjectId()) return { unavailable: 'project_changed' }
  if (res.ok && res.projectId !== projectId) return { unavailable: 'project_mismatch' }
  if (res.ok && res.status === 'accepted' && res.jobId && UUID.test(res.jobId) && Number.isFinite(Date.parse(res.expiresAt ?? ''))) return { pending: true, jobId: res.jobId, expiresAt: Date.parse(res.expiresAt!) }
  if (res.ok && res.status === 'completed' && res.summary && isBobAnswerEvidence(res.evidence, projectId)
    && res.evidence.sources.every(source => source.projectId === projectId)) {
    return { answer: res.summary, evidence: res.evidence }
  }
  return { unavailable: res.error ?? 'unsupported_response' }
}

/** Stop the exact owned background job; a lost response is not proof of a stop. */
export async function cancelAskBobTurn(projectId: string, jobId: string): Promise<'cancelled' | 'not_in_flight'> {
  if (projectId !== getActiveProjectId()) throw new Error('The active project changed. Reopen Bob before stopping this request.')
  const result = await callAskBob({ action: 'cancel', projectId, jobId })
  if (projectId !== getActiveProjectId()) throw new Error('The active project changed. Check the request in its project.')
  if (result.ok && result.status === 'cancelled' && result.projectId === projectId && result.jobId === jobId) return 'cancelled'
  if (result.error === 'turn_not_in_flight') return 'not_in_flight'
  if (result.error === 'unauthorized') throw new Error('Sign in again to stop this request. Its stop has not been confirmed.')
  if (result.error === 'project_denied') throw new Error('Your access to this request could not be confirmed. Check your project access.')
  throw new Error('Could not confirm the stop. Bob may still be working; reconnect and try Stop again.')
}

/** Clear only the caller's active conversation; never fall back to a fake local
 * success when a signed-in member's server reset fails. */
export async function resetAskBobConversation(projectId: string): Promise<'server' | 'local'> {
  const checkProject = () => {
    if (projectId !== getActiveProjectId()) throw new Error('The active project changed. Reopen Bob in the project you want to clear.')
  }
  checkProject()
  if (!bobDb) return 'local'
  const { data: auth, error: authError } = await bobDb.auth.getUser()
  checkProject()
  if (authError || !auth.user) throw new Error('Please sign in again before clearing your conversation.')
  if (auth.user.email?.toLowerCase() === GUEST_EMAIL) return 'local'
  const thread = await bobDb.from('bob_threads').select('id,next_seq')
    .eq('project_id', projectId).eq('owner_user_id', auth.user.id).eq('status', 'active').maybeSingle()
  checkProject()
  if (thread.error) throw new Error('Could not check your conversation. Nothing has been cleared. Try again.')
  const { data, error } = await bobDb.rpc('bob_reset_conversation', {
    p_project: projectId,
    p_expected_thread: thread.data?.id ?? null,
    p_expected_next_seq: thread.data?.next_seq ?? null,
  })
  checkProject()
  if (error) {
    if (error.message.includes('turn_in_flight')) throw new Error('Bob is still answering in this conversation. Try again when the answer finishes.')
    if (error.message.includes('conversation_changed')) throw new Error('The conversation changed on another tab or device. Reopen Bob and try again.')
    if (error.code === '42501') throw new Error('Your access to this project could not be confirmed. Nothing has been cleared.')
    throw new Error('Could not confirm the reset. Your chat is still shown; check your connection and try again.')
  }
  if (data?.status !== 'cleared' || data.projectId !== projectId || data.mode !== 'server') {
    throw new Error('Could not confirm that the conversation was cleared. Reopen Bob before trying again.')
  }
  recentHistory.clear(); historyEpoch++
  return 'server'
}

/** Refresh mounted project screens after closing Bob, not in the middle of a
 * reply: the existing project-version event deliberately remounts the shell. */
export function refreshAskBobProject(projectId: string): void {
  if (projectId === getActiveProjectId()) window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT))
}

/** Refresh existing delegated authority from the normal current Auth session.
 * This endpoint cannot create work or change its instruction. */
export async function renewDrawingRequests(projectId:string):Promise<void>{
 if(!bobDb||getActiveProjectId()!==projectId)return
 const {data}=await bobDb.auth.getSession()
 if(!data.session||data.session.user.email?.toLowerCase()===GUEST_EMAIL)return
 const result=await callAskBob({action:'renew_requests',projectId})
 if(getActiveProjectId()!==projectId)return
 if(!result.ok)throw new Error('Bob could not reconnect. Sign in again if your session expired; saved work is retained.')
}
