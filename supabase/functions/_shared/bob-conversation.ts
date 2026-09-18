import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2'
import type { ContextStore } from './bob-working-context.ts'
import type { AnswerEvidence } from '../../../src/data/provenance.ts'

export type BobTurnClaim =
  | { mode: 'local_only'; status: 'claimed' }
  | { mode: 'server'; status: 'claimed'; thread_id: string; previous_response_id?: string | null; generation: number }
  | { mode: 'server'; status: 'completed'; thread_id: string; answer: string; evidence: AnswerEvidence }
  | { mode: 'server'; status: 'in_flight' | 'thread_busy'; thread_id: string }

type RpcResult<T> = { data: T | null; error: { message: string; code?: string } | null }

function checked<T>(result: RpcResult<T>, operation: string): T {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`)
  if (result.data === null || result.data === undefined) throw new Error(`${operation}: empty response`)
  return result.data
}

/**
 * Service-role adapter for Bob-owned transcript/provider metadata ONLY.
 * It must never be used for project truth: project reads stay on the caller-JWT
 * client and are rechecked by runProjectAnswer before lookup/release.
 */
export function createBobConversationStore(client: SupabaseClient<any, 'bob', any>) {
  return {
    workingContext(binding: { projectId: string; userId: string; threadId: string; turnId: string; generation: number }): ContextStore {
      const args = { p_project: binding.projectId, p_user: binding.userId, p_thread: binding.threadId, p_turn: binding.turnId, p_generation: binding.generation }
      const rpc = async (name: string, extra = {}) => checked(await client.rpc(name, { ...args, ...extra }).abortSignal(AbortSignal.timeout(12000)) as RpcResult<unknown>, 'conversation context')
      return {
        load: () => rpc('bob_load_context'),
        save: (expected, through, summary) => rpc('bob_save_context_summary', { p_expected_seq: expected, p_through_seq: through, p_summary: summary }),
        search: (query, before) => rpc('bob_search_context_history', { p_query: query, p_before_seq: before }),
      }
    },
    async claim(projectId: string, userId: string, turnId: string, message: string): Promise<BobTurnClaim> {
      return checked(await client.rpc('bob_claim_turn', {
        p_project: projectId,
        p_user: userId,
        p_turn: turnId,
        p_message: message,
      }) as RpcResult<BobTurnClaim>, 'conversation claim')
    },

    async commit(input: {
      projectId: string
      userId: string
      threadId: string
      turnId: string
      answer: string
      evidence: AnswerEvidence
      providerResponseId: string | null
      generation: number
    }): Promise<void> {
      checked(await client.rpc('bob_commit_turn_v2', {
        p_project: input.projectId,
        p_user: input.userId,
        p_thread: input.threadId,
        p_turn: input.turnId,
        p_generation: input.generation,
        p_answer: input.answer,
        p_evidence: input.evidence,
        p_provider_response_id: input.providerResponseId,
      }) as RpcResult<unknown>, 'conversation commit')
    },

    async fail(projectId: string, userId: string, threadId: string, turnId: string, generation: number): Promise<void> {
      checked(await client.rpc('bob_fail_turn_v2', {
        p_project: projectId,
        p_user: userId,
        p_thread: threadId,
        p_turn: turnId,
        p_generation: generation,
      }) as RpcResult<unknown>, 'conversation fail')
    },
  }
}
