import type { ModelCall } from './project-answer.ts'
import type { ProjectWriter } from './project-write.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { PROJECT_DESCRIPTION_MAX, projectDescriptionIssue } from '../../../src/domain/projectDescription.ts'

/** Owner decision 2026-11-02: a small separate turn keeps the project
 * description tight and consistent. It runs after a Bob turn that saved
 * something, sees what the turn changed, and rewrites the one description only
 * as much as that requires. It is the description's single steady author;
 * measurements stay out (they live in measurements, solutions and drawings). */
export const DESCRIPTION_WEIGHER_ROLE = 'description-weigher'

export interface WeigherProject { name: string; type: string | null; phase: string | null; description: string; updatedAt: string }
export interface WeigherOptions {
  projectId: string; userId: string; message: string; answer: string
  writer: ProjectWriter
  read: () => Promise<{ project: WeigherProject; plan: { title: string; state: string | null }[] } | null>
  callModel: ModelCall; hasAccess: () => Promise<boolean>; deadline: number
  /** Durable jobs continue in a fresh segment instead of skipping the weigh. */
  yieldSegment?: () => never
}
export type WeigherOutcome = 'skipped' | 'unchanged' | 'saved' | 'rejected' | 'failed'

const clip = (text: string, max: number) => { const chars = Array.from(text); return chars.length > max ? chars.slice(0, max).join('') + '…' : text }

export async function weighProjectDescription(opts: WeigherOptions): Promise<WeigherOutcome> {
  const receipts = opts.writer.receipts
  // Only a turn that changed the project can change its description. A turn in
  // which Bob already saved the description itself is left as Bob wrote it.
  if (!receipts.length || opts.writer.uncertain || opts.writer.remaining <= 0 || receipts.some(r => r.dataset === 'project')) return 'skipped'
  if (Date.now() + 40000 >= opts.deadline) { opts.yieldSegment?.(); return 'skipped' }
  try {
    const current = await opts.read()
    if (!current) return 'failed'
    const input = {
      max_characters: PROJECT_DESCRIPTION_MAX,
      project: { name: current.project.name, type: current.project.type, phase: current.project.phase, description: current.project.description },
      plan: current.plan.slice(0, 40),
      turn: { request: clip(opts.message, 4000), answer: clip(opts.answer, 4000),
        saved: receipts.slice(-24).map(r => ({ dataset: r.dataset, label: clip(r.label, 120), operation: r.operation })) },
    }
    let text: string | undefined, feedback: Record<string, unknown> | undefined
    for (let attempt = 0; attempt < 2 && text === undefined; attempt++) {
      if (Date.now() + 20000 >= opts.deadline) { opts.yieldSegment?.(); return 'skipped' }
      const response = await opts.callModel({
        app: 'bob', coworkerId: 'bob', functionName: DESCRIPTION_WEIGHER_ROLE, aiFunction: DESCRIPTION_WEIGHER_ROLE, module: 'global', userId: opts.userId,
        catalogRoleKey: DESCRIPTION_WEIGHER_ROLE, catalogSchemaKey: 'bob_project_description', schemaName: 'bob_project_description',
        messages: [{ role: 'user', content: JSON.stringify({ ...input, ...(feedback ? { validationFeedback: feedback } : {}) }) }],
        maxOutputTokens: 2000, timeoutMs: Math.min(30000, opts.deadline - Date.now() - 5000),
      })
      if (!response.success || response.toolCalls?.length) return 'failed'
      let data: unknown = response.data
      try { if (typeof data === 'string') data = JSON.parse(data) } catch { data = null }
      const candidate = data && typeof data === 'object' && !Array.isArray(data) && typeof (data as { description?: unknown }).description === 'string'
        ? ((data as { description: string }).description).trim() : ''
      const issue = projectDescriptionIssue(candidate)
      if (issue) feedback = { issue, max_characters: PROJECT_DESCRIPTION_MAX, length: candidate.length }
      else text = candidate
    }
    if (text === undefined) return 'rejected'
    if (text === current.project.description.trim()) return 'unchanged'
    if (!await opts.hasAccess()) return 'skipped'
    // The owner's request of this turn authorised the changes the description
    // now reflects; the quote binds the write to that same turn.
    const result = await opts.writer.commit({ kind: 'project', record_id: opts.projectId, expected_updated_at: current.project.updatedAt,
      expected_revision: null, request_quote: Array.from(opts.message.trim()).slice(0, 400).join(''), data: { description: text } })
    return result.status === 'saved' ? 'saved' : 'failed'
  } catch (error) {
    rethrowContinuation(error)
    return 'failed'
  }
}
