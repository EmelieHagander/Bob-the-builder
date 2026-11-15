import type { ModelCall } from './project-answer.ts'
import type { ProjectWriter } from './project-write.ts'
import { rethrowContinuation } from './bob-job-journal.ts'

/** Owner decision 2026-11-15 (thread "Make Bob move plans forward"): the plan
 * follows real work. After a Bob turn that saved something, a small separate
 * turn reads the open Steps and the saved records and owner answers that could
 * settle their requirements, and proposes links. The server checks every link,
 * pins revisions, closes Steps whose requirements are all met and moves focus
 * (bob_private.project_plan_record_progress). Bob no longer has to remember. */
export const PLAN_WEIGHER_ROLE = 'plan-weigher'

export const PLAN_EVIDENCE_KINDS = ['artifact', 'solution', 'material_requirement', 'task', 'measurement', 'media', 'message'] as const
type EvidenceKind = typeof PLAN_EVIDENCE_KINDS[number]
export interface PlanProgressContext {
  revision: number | null
  steps: { id: string; title: string; goal: string; state: string; focus: boolean; requirements: { id: string; type: string; title: string; description: string; responsible: string; state: string }[] }[]
  records: { kind: EvidenceKind; id: string; title: string; [key: string]: unknown }[]
}
export interface PlanWeigherOptions {
  userId: string; message: string; answer: string
  writer: ProjectWriter
  read: () => Promise<PlanProgressContext | null>
  callModel: ModelCall; hasAccess: () => Promise<boolean>; deadline: number
  yieldSegment?: () => never
}
export type PlanWeigherOutcome = 'skipped' | 'unchanged' | 'saved' | 'rejected' | 'failed'
interface Link { requirement_id: string; evidence_kind: EvidenceKind; evidence_id: string }

const clip = (text: string, max: number) => { const chars = Array.from(text); return chars.length > max ? chars.slice(0, max).join('') + '…' : text }
const MET = new Set(['satisfied', 'waived', 'not_applicable'])

/** Keeps only links the input itself offers: an open requirement and a listed record. */
export function checkPlanProgress(context: PlanProgressContext, data: unknown): { links: Link[]; complete: string[]; issues: string[] } {
  const issues: string[] = []
  const value = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  if (!value || !Array.isArray(value.links) || !Array.isArray(value.complete_steps)) return { links: [], complete: [], issues: ['Return links and complete_steps.'] }
  const open = new Map(context.steps.flatMap(s => s.requirements.filter(q => !MET.has(q.state)).map(q => [q.id, s.id] as const)))
  const records = new Set(context.records.map(r => r.kind + ':' + r.id))
  const seen = new Set<string>(), links: Link[] = []
  for (const raw of value.links) {
    const l = raw as Partial<Link>
    const key = `${l?.requirement_id}:${l?.evidence_kind}:${l?.evidence_id}`
    if (!l || typeof l.requirement_id !== 'string' || !open.has(l.requirement_id)) { issues.push(`Unknown or already met requirement ${String(l?.requirement_id)}.`); continue }
    if (!PLAN_EVIDENCE_KINDS.includes(l.evidence_kind as EvidenceKind) || typeof l.evidence_id !== 'string' || !records.has(l.evidence_kind + ':' + l.evidence_id)) { issues.push(`Record ${String(l.evidence_kind)} ${String(l.evidence_id)} is not in the input.`); continue }
    if (seen.has(key)) continue
    seen.add(key); links.push({ requirement_id: l.requirement_id, evidence_kind: l.evidence_kind as EvidenceKind, evidence_id: l.evidence_id })
  }
  const bare = new Set(context.steps.filter(s => s.requirements.length === 0).map(s => s.id))
  const complete = [...new Set(value.complete_steps.filter((id): id is string => typeof id === 'string'))].filter(id => {
    if (bare.has(id)) return true
    issues.push(`Step ${id} has requirements or is not open; link its requirements instead.`); return false
  })
  return { links: links.slice(0, 40), complete: complete.slice(0, 20), issues }
}

export async function weighPlanProgress(opts: PlanWeigherOptions): Promise<PlanWeigherOutcome> {
  const receipts = opts.writer.receipts
  if (!receipts.length || opts.writer.uncertain || opts.writer.remaining <= 0) return 'skipped'
  if (Date.now() + 40000 >= opts.deadline) { opts.yieldSegment?.(); return 'skipped' }
  try {
    const context = await opts.read()
    if (!context) return 'failed'
    if (context.revision === null || !context.steps.length) return 'skipped'
    const input = {
      plan: { steps: context.steps },
      records: context.records.map(r => ({ ...r, title: clip(String(r.title ?? ''), 400) })),
      turn: { request: clip(opts.message, 4000), answer: clip(opts.answer, 4000),
        saved: receipts.slice(-24).map(r => ({ dataset: r.dataset, label: clip(r.label, 120), operation: r.operation })) },
    }
    let checked: ReturnType<typeof checkPlanProgress> | undefined, feedback: string[] | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() + 20000 >= opts.deadline) { opts.yieldSegment?.(); return 'skipped' }
      const response = await opts.callModel({
        app: 'bob', coworkerId: 'bob', functionName: PLAN_WEIGHER_ROLE, aiFunction: PLAN_WEIGHER_ROLE, module: 'global', userId: opts.userId,
        catalogRoleKey: PLAN_WEIGHER_ROLE, catalogSchemaKey: 'bob_plan_progress', schemaName: 'bob_plan_progress',
        messages: [{ role: 'user', content: JSON.stringify({ ...input, ...(feedback ? { validationFeedback: feedback } : {}) }) }],
        maxOutputTokens: 3000, timeoutMs: Math.min(30000, opts.deadline - Date.now() - 5000),
      })
      if (!response.success || response.toolCalls?.length) return 'failed'
      let data: unknown = response.data
      try { if (typeof data === 'string') data = JSON.parse(data) } catch { data = null }
      checked = checkPlanProgress(context, data)
      if (!checked.issues.length) break
      feedback = checked.issues.slice(0, 20)
    }
    if (!checked || (!checked.links.length && !checked.complete.length)) return checked?.issues.length ? 'rejected' : 'unchanged'
    if (!await opts.hasAccess()) return 'skipped'
    // The owner's request of this turn authorised the work these links record.
    const result = await opts.writer.commit({ kind: 'plan_progress', record_id: null, expected_updated_at: null, expected_revision: context.revision,
      request_quote: Array.from(opts.message.trim()).slice(0, 400).join(''), data: { links: checked.links, complete_steps: checked.complete } })
    return result.status === 'saved' ? 'saved' : 'failed'
  } catch (error) {
    rethrowContinuation(error)
    return 'failed'
  }
}
