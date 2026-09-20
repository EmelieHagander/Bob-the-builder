import type { ProjectContext } from './project-context/dispatcher.ts'
import type { WorkingContext } from './bob-working-context.ts'
import type { AnswerEvidence } from '../../../src/data/provenance.ts'
import { runProjectAnswer, type ModelCall, type ProjectAnswer } from './project-answer.ts'
import type { createProjectLookup } from './project-lookup.ts'
import { compactReceipts, savedWriteSummary, type ProjectWriter } from './project-write.ts'

/** Production orchestration, injected for failure/retry tests without an AI key. */
export async function runClaimedProjectTurn(opts: {
  projectId: string; userId: string; message: string; generation?: number; previousResponseId?: string;
  lookup: ReturnType<typeof createProjectLookup>; writer?: ProjectWriter; callModel: ModelCall;
  hasAccess: () => Promise<boolean>;
  projectContext?: ProjectContext;
  prepareContext?: () => Promise<WorkingContext>;
  deadline?: number;
  commit?: (result: Extract<ProjectAnswer, { ok: true }>, generation: number) => Promise<void>;
  fail: (generation: number) => Promise<void>;
}): Promise<ProjectAnswer> {
  let generation = opts.generation ?? 0
  const fail = async () => { try { await opts.fail(generation) } catch { /* lease expiry remains a recovery path */ } }
  let result: ProjectAnswer = { ok: false, error: 'ai_unavailable' }
  let recovered = false
  try {
    if (opts.writer) recovered = (await opts.writer.recover()).length > 0
    if (!recovered) {
      const context = opts.prepareContext ? await opts.prepareContext() : undefined
      result = await runProjectAnswer({ ...opts, context })
    }
  } catch (error) {
    // Still settle committed writes; never substitute a context-less answer.
    const code = error instanceof Error ? error.message : ''
    result = { ok: false, error: ['context_preparing', 'context_unavailable', 'project_denied'].includes(code) ? code : 'ai_unavailable' }
  }

  if (opts.writer) {
    const uncertain = opts.writer.uncertain
    try {
      // Serialize with writes and advance generation. Even a delayed HTTP write
      // cannot arrive after recovery and commit against the earlier generation.
      generation = await opts.writer.settle()
    } catch {
      await fail()
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      return { ok: true, projectId: opts.projectId, answer: savedWriteSummary(opts.writer.receipts, true),
        evidence: { kind: 'ai_assessment', sources: [], partial: true, writes: compactReceipts(opts.writer.receipts) } }
    }
    if (!await opts.hasAccess()) { await fail(); return { ok: false, error: 'project_denied' } }
    const evidence: AnswerEvidence = { kind: 'ai_assessment', sources: opts.lookup.sources,
      partial: opts.lookup.partial || !!opts.projectContext?.partial || !result.ok, writes: compactReceipts(opts.writer.receipts) }
    if (opts.writer.receipts.length && (recovered || uncertain || !result.ok || !result.providerResponseId)) {
      result = { ok: true, projectId: opts.projectId, answer: savedWriteSummary(opts.writer.receipts), evidence }
    } else if (uncertain && !opts.writer.receipts.length) {
      result = { ok: false, error: 'write_not_saved' }
    } else if (result.ok) {
      // Receipts come from the database settlement, never from generated prose.
      result = { ...result, evidence }
    }
  }
  if (!result.ok) { await fail(); return result }
  if (opts.projectContext && !await opts.projectContext.validate()) {
    if (!await opts.hasAccess()) { await fail(); return { ok: false, error: 'project_denied' } }
    // A revoked photo cannot be cited or carried forward via a provider cursor.
    // But a committed domain write is still committed: preserve its truthful receipt.
    if (opts.writer?.receipts.length) {
      result = { ok: true, projectId: opts.projectId, answer: savedWriteSummary(opts.writer.receipts),
        evidence: { kind: 'ai_assessment', sources: [], partial: true, writes: compactReceipts(opts.writer.receipts) } }
    } else { await fail(); return { ok: false, error: 'context_unavailable' } }
  }
  if (opts.commit) {
    if (!result.providerResponseId && !result.evidence.writes?.length) {
      await fail(); return { ok: false, error: 'provider_state_unavailable' }
    }
    try { await opts.commit(result, generation) }
    catch {
      await fail()
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      if (!result.evidence.writes?.length) return { ok: false, error: 'conversation_unavailable' }
      return { ...result, answer: result.answer + '\n\nProjektändringarna är sparade, men chattsvaret kunde inte synkroniseras. Upprepa inte ändringarna.' }
    }
  }
  return result
}
