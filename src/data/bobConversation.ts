import { createClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import type { AnswerEvidence } from './provenance'
import { getActiveProjectId } from './databaseCore'

function resolveSupabaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  const url = /^[a-z0-9]{16,}$/.test(value) ? `https://${value}.supabase.co` : value
  try { new globalThis.URL(url); return url } catch { return null }
}

const SUPABASE_URL = resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
const bobDb = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'bob' },
  auth: { flowType: 'pkce', detectSessionInUrl: true, autoRefreshToken: true, persistSession: true },
}) : null

const GUEST_EMAIL = 'guest@bob.local'

type AskBobResponse = {
  ok: boolean
  error?: string
  projectId?: string
  status?: string
  summary?: string
  evidence?: AnswerEvidence
}

export interface BobConversationHistory {
  mode: 'server' | 'local'
  messages: ChatMessage[]
}

function validEvidence(value: unknown): value is AnswerEvidence {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Partial<AnswerEvidence>
  return evidence.kind === 'ai_assessment' && Array.isArray(evidence.sources)
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
  if (!threadResult.data) return { mode: 'server', messages: [] }

  const rows = await bobDb.from('bob_messages')
    .select('role,text,evidence,delivery_state,seq')
    .eq('thread_id', threadResult.data.id)
    .eq('delivery_state', 'completed')
    .order('seq')
  if (rows.error) throw new Error(`database: ${rows.error.message}`)

  const messages: ChatMessage[] = []
  for (const row of rows.data ?? []) {
    if (row.role === 'user' && typeof row.text === 'string') {
      messages.push({ from: 'user', text: row.text })
    } else if (row.role === 'assistant' && typeof row.text === 'string') {
      messages.push({ from: 'bob', text: row.text, ...(validEvidence(row.evidence) ? { evidence: row.evidence } : {}) })
    }
  }
  return { mode: 'server', messages }
}

async function callAskBob(body: Record<string, unknown>): Promise<AskBobResponse> {
  if (!bobDb) return { ok: false, error: 'not_configured' }
  try {
    const { data, error } = await bobDb.functions.invoke('ask-bob', { body })
    if (error) {
      const response = (error as { context?: Response }).context
      if (response instanceof Response) {
        if (response.status === 401) return { ok: false, error: 'unauthorized' }
        if (response.status === 403) return { ok: false, error: 'project_denied' }
        if (response.status === 409) return { ok: false, error: 'turn_in_flight' }
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
): Promise<{ answer: string; evidence: AnswerEvidence } | { unavailable: string }> {
  if (projectId !== getActiveProjectId()) return { unavailable: 'project_changed' }
  const res = await callAskBob({ action: 'send', projectId, message, clientTurnId })
  if (projectId !== getActiveProjectId()) return { unavailable: 'project_changed' }
  if (res.ok && res.projectId !== projectId) return { unavailable: 'project_mismatch' }
  if (res.ok && res.status === 'completed' && res.summary && validEvidence(res.evidence)
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
