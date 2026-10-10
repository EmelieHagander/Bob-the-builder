import { accountClient as bobDb } from './supabaseClient'
import type { ChatMessage } from './types'
import type { AnswerEvidence } from './provenance'
import { getActiveProjectId, PROJECT_CHANGED_EVENT } from './databaseCore'
import { isBobAnswerEvidence } from './bobEvidence'
import { readBobTranscript, readDrawingTurnRecovery, reconcileDrawingTurnRecovery } from './bobTranscript'
import { parseBobScreen, type BobScreenPointer } from '../domain/bobScreen'

const GUEST_EMAIL = 'guest@bob.local'

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
  pending?: { text: string; turnId: string; screen?: BobScreenPointer | null; imageIds?: string[]; expiresAt: number; progress?: BobProgress; notice?: string }
  lastCompletedTurnId?: string
  threadId?: string
  ownerId?: string
  latestSeq?: number
}

/**
 * Normal signed-in members use Bob-owned Supabase history. The deliberately
 * shared guest Auth identity remains device-local so one guest cannot read
 * another person's private conversation.
 */
export async function getAskBobConversation(projectId: string): Promise<BobConversationHistory> {
  if (!bobDb) return { mode: 'local', messages: [] }
  const { data: auth, error: authError } = await bobDb.auth.getUser()
  if (authError || !auth.user) return { mode: 'local', messages: [] }
  if (auth.user.email?.toLowerCase() === GUEST_EMAIL) return { mode: 'local', messages: [] }

  const threadResult = await bobDb.from('bob_threads').select('id')
    .eq('project_id', projectId).eq('owner_user_id', auth.user.id).eq('status', 'active').maybeSingle()
  if (threadResult.error) throw new Error(`database: ${threadResult.error.message}`)
  if (!threadResult.data) return { mode: 'server', messages: [], ownerId: auth.user.id }

  const rows = await bobDb.from('bob_messages')
    .select('role,text,evidence,delivery_state,seq,turn_id,updated_at,image_ids')
    .eq('thread_id', threadResult.data.id)
    .order('seq')
  if (rows.error) throw new Error(`database: ${rows.error.message}`)

  const notices = await bobDb.from('bob_delegation_notices').select('turn_id,text').eq('thread_id', threadResult.data.id)
  const byTurn = new Map<string, string>((notices.data ?? []).map(row => [row.turn_id, row.text]))
  let transcript = readBobTranscript(rows.data ?? [], projectId, byTurn)
  const { latestSeq, lastCompletedTurnId } = transcript
  const turn = transcript.unfinished
  let pending: BobConversationHistory['pending'] = turn?.pending ? { text: turn.text, turnId: turn.turnId, imageIds: turn.imageIds, expiresAt: turn.expiresAt } : undefined
  let retry: BobConversationHistory['retry'] = turn && !turn.pending ? { text: turn.text, turnId: turn.turnId, imageIds: turn.imageIds } : undefined
  const unfinished = pending ?? retry
  if (unfinished) {
    const job = await bobDb.rpc('bob_job_status', { p_project: projectId, p_turn: unfinished.turnId })
    if (job.error) throw new Error('Could not check Bob’s background job. Reconnecting…')
    const drawingRecovery = readDrawingTurnRecovery(job.data?.drawingRecovery)
    const recoveredBudgetStop = drawingRecovery?.status === 'completed' && job.data?.status === 'failed' && job.data?.error === 'turn_budget_exhausted'
    transcript = reconcileDrawingTurnRecovery(transcript, unfinished.turnId, drawingRecovery, recoveredBudgetStop)
    // Older jobs have no pointer. Never replace a recovered turn with this page.
    try { unfinished.screen = parseBobScreen(job.data?.screen) } catch { unfinished.screen = null }
    if (recoveredBudgetStop) {
      pending = undefined; retry = undefined
    } else if (drawingRecovery && drawingRecovery.status !== 'completed') {
      pending = { ...unfinished, expiresAt: drawingRecovery.expiresAt, progress: parseProgress(drawingRecovery.progress), notice: byTurn.get(unfinished.turnId) }; retry = undefined
    } else if (job.data && ['queued', 'running'].includes(job.data.status)) {
      const expiresAt = Date.parse(job.data.expiresAt)
      if (!Number.isFinite(expiresAt)) throw new Error('Invalid background job status')
      pending = { ...unfinished, expiresAt, progress: parseProgress(job.data.progress), notice: byTurn.get(unfinished.turnId) }; retry = undefined
    } else if (job.data?.status === 'failed') {
      pending = undefined
      if (job.data.error === 'turn_budget_exhausted') {
        retry = undefined
        transcript.messages.push({ from: 'bob', text: 'Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.' })
      } else retry = unfinished
    }
  }
  return { mode: 'server', messages: transcript.messages, retry, pending, lastCompletedTurnId, threadId: threadResult.data.id, ownerId: auth.user.id, latestSeq }
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

/** A background turn runs for up to twenty minutes on the sender's access token.
 * Refresh a token that would expire first, so long work is not cut short. */
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
    if (body.background === true) await ensureFreshSession()
    const { data, error } = await bobDb.functions.invoke('ask-bob', { body })
    if (error) {
      const response = (error as { context?: Response }).context
      if (response instanceof Response) {
        if (response.status === 401) return { ok: false, error: 'unauthorized' }
        if (response.status === 403) return { ok: false, error: 'project_denied' }
        if (response.status === 409) return { ok: false, error: 'turn_in_flight' }
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
): Promise<{ answer: string; evidence: AnswerEvidence } | { unavailable: string } | { pending: true; expiresAt: number }> {
  if (projectId !== getActiveProjectId()) return { unavailable: 'project_changed' }
  const res = await callAskBob({ action: 'send', projectId, message, clientTurnId, background: true, ...(screen !== undefined ? { screen } : {}), ...(imageIds !== undefined ? { imageIds } : {}) })
  if (projectId !== getActiveProjectId()) return { unavailable: 'project_changed' }
  if (res.ok && res.projectId !== projectId) return { unavailable: 'project_mismatch' }
  if (res.ok && res.status === 'accepted' && res.jobId && Number.isFinite(Date.parse(res.expiresAt ?? ''))) return { pending: true, expiresAt: Date.parse(res.expiresAt!) }
  if (res.ok && res.status === 'completed' && res.summary && isBobAnswerEvidence(res.evidence, projectId)
    && res.evidence.sources.every(source => source.projectId === projectId)) {
    return { answer: res.summary, evidence: res.evidence }
  }
  return { unavailable: res.error ?? 'unsupported_response' }
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
  return 'server'
}

/** Refresh mounted project screens after closing Bob, not in the middle of a
 * reply: the existing project-version event deliberately remounts the shell. */
export function refreshAskBobProject(projectId: string): void {
  if (projectId === getActiveProjectId()) window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT))
}

/** Refresh existing delegated authority from the normal current Auth session.
 * This endpoint cannot create work, change its instruction or increase budget. */
export async function renewDrawingRequests(projectId:string):Promise<void>{
 if(!bobDb||getActiveProjectId()!==projectId)return
 const {data}=await bobDb.auth.getSession()
 if(!data.session||data.session.user.email?.toLowerCase()===GUEST_EMAIL)return
 const result=await bobDb.functions.invoke('ask-bob',{body:{action:'renew_requests',projectId}})
 if(getActiveProjectId()!==projectId)return
 if(result.error||!result.data?.ok)throw new Error('Drawing requests could not reconnect. Sign in again if your session expired.')
}
