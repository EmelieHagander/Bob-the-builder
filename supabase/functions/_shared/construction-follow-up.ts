import { rethrowContinuation } from './bob-job-journal.ts'

/** Owner runs 2026-11-08 (Våningssäng 2): every construction revision makes each
 * material row that pins an older revision a pending item of change work, also
 * when the geometry is unchanged (revision 25 → 26 changed joints only). The
 * server already recomputes such a row from its saved recipe, without AI, under
 * the same identity (continue_construction_change, action recalculate). Mattias
 * redid them by hand instead, row by row and twice. With material_follow_version
 * 1, code runs that recalculation for the material rows of each construction
 * revision Konrad's job saved, after the job, through Konrad's own session
 * (same fence, quote and writer). It approves nothing: a recalculated row is the
 * canonical quantity of the saved construction, and a row that needs a model,
 * an allocation review or a commitment review is left pending and listed. */
export type FollowUpTarget = { artifact_id: string; revision: number }
/** Why a row is left (review of #508: a row left for time is not a decision):
 * needs_calculation: not run in this pass; the same recalculation finishes it.
 * needs_expert_decision: no recorded model; someone chooses how it is calculated.
 * needs_review: it has allocations, commitments or other outputs to review first.
 * unavailable: the recalculation failed or was refused; try again or report it. */
export type FollowUpNext = 'needs_calculation' | 'needs_expert_decision' | 'needs_review' | 'unavailable'
export type FollowUpRow = { item_id: string; output_id: string | null; status: string; next: FollowUpNext; reason?: string }
export type FollowUpResult = { artifact_id: string; revision: number; status: string; complete: boolean; recalculated: number;
  left: FollowUpRow[]; left_not_listed?: number; remaining: Record<FollowUpNext, number>; other_pending: Record<string, number> }
const NEXT: Record<string, FollowUpNext> = { not_run: 'needs_calculation', needs_requirement_model: 'needs_expert_decision',
  needs_allocation_review: 'needs_review', needs_commitment_review: 'needs_review', needs_work_review: 'needs_review',
  needs_requirements: 'needs_review', needs_outputs: 'needs_review' }

const PAGE_LIMIT = 8
const ROW_LIMIT = 60
/** Rows listed by ID in the result; the counts in remaining cover every row. */
const LIST_LIMIT = 20
const code = (value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

/** The latest saved revision of each construction a job saved (checks are not saves). */
export function savedConstructionTargets(receipts: Record<string, unknown>[]): FollowUpTarget[] {
  const saves = new Set(['save_construction_draft', 'edit_construction_parts', 'commit_construction_sketch', 'change_construction_parameters',
    'change_construction_roles', 'continue_construction_change', 'transition_legacy_drawing'])
  const latest = new Map<string, number>()
  for (const r of receipts) {
    if (!saves.has(String(r.tool)) || r.status !== undefined) continue
    // continue_construction_change saves an output, not a construction revision.
    if (r.tool === 'continue_construction_change') continue
    const id = typeof r.artifact_id === 'string' ? r.artifact_id : typeof r.record_id === 'string' ? r.record_id : null
    const revision = typeof r.revision === 'number' && Number.isSafeInteger(r.revision) && r.revision > 0 ? r.revision : null
    if (id && revision !== null) latest.set(id, Math.max(latest.get(id) ?? 0, revision))
  }
  return [...latest].map(([artifact_id, revision]) => ({ artifact_id, revision }))
}

/** Recalculates the pending material rows of each target, in order, one call at
 * a time (the journal replays by position). Idempotent: each row has its own
 * key, an exact retry returns its receipt, and a done row is no longer pending. */
export async function followConstructionChanges(opts: {
  targets: FollowUpTarget[]
  read: (target: FollowUpTarget, after: string | null) => Promise<any>
  recalculate: (target: FollowUpTarget, item: { id: string }, key: string) => Promise<any>
  hasAccess: () => Promise<boolean>
  deadline: number
}): Promise<FollowUpResult[]> {
  const results: FollowUpResult[] = []
  for (const target of opts.targets) {
    const out: FollowUpResult = { ...target, status: 'unavailable', complete: false, recalculated: 0, left: [],
      remaining: { needs_calculation: 0, needs_expert_decision: 0, needs_review: 0, unavailable: 0 }, other_pending: {} }
    results.push(out)
    const items: any[] = []
    let after: string | null = null, complete = false
    try {
      for (let page = 0; page < PAGE_LIMIT; page++) {
        const read = await opts.read(target, after)
        if (!await opts.hasAccess()) throw new Error('project_denied')
        if (!read || read.artifact_id !== target.artifact_id || read.revision !== target.revision || !Array.isArray(read.items)) break
        out.status = String(read.status ?? 'unavailable')
        if (!['pending', 'complete'].includes(out.status)) break
        items.push(...read.items)
        if (!read.truncated) { complete = true; break }
        after = uuid(read.next_cursor) ? read.next_cursor : null
        if (!after) break
      }
    } catch (error) {
      rethrowContinuation(error)
      if (error instanceof Error && error.message === 'project_denied') throw error
      out.status = 'unavailable'
    }
    out.complete = complete
    // complete and superseded count every item themselves; nothing is left to run.
    if (out.status !== 'pending') continue
    for (const item of items) {
      if (item?.state !== 'pending' || !uuid(item.id)) continue
      if (item.kind !== 'requirement') { out.other_pending[String(code(item.kind) ?? 'other')] = (out.other_pending[String(code(item.kind) ?? 'other')] ?? 0) + 1; continue }
      const row: FollowUpRow = { item_id: item.id, output_id: uuid(item.output_id) ? item.output_id : null, status: 'not_run', next: 'needs_calculation' }
      if (Date.now() + 15_000 >= opts.deadline || out.recalculated + out.left.length >= ROW_LIMIT) { row.reason = 'time_or_row_limit'; out.left.push(row); continue }
      let result: any
      try { result = await opts.recalculate(target, item, 'follow_' + item.id.replace(/-/g, '')) }
      catch (error) {
        rethrowContinuation(error)
        if (error instanceof Error && error.message === 'project_denied') throw error
        result = { status: 'unavailable' }
      }
      if (!await opts.hasAccess()) throw new Error('project_denied')
      if (result?.status === 'saved') { out.recalculated++; continue }
      row.status = code(result?.status) ?? 'unavailable'
      row.next = NEXT[row.status] ?? 'unavailable'
      const reason = code(result?.reason) ?? code(result?.validation?.code)
      if (reason) row.reason = reason
      out.left.push(row)
    }
    for (const row of out.left) out.remaining[row.next]++
    if (out.left.length > LIST_LIMIT) { out.left_not_listed = out.left.length - LIST_LIMIT; out.left = out.left.slice(0, LIST_LIMIT) }
  }
  return results
}

/** What the follow-up did, in words that match its counts. Never says that
 * nothing was needed while rows are unread, unrun or failed. */
export function followUpNote(results: FollowUpResult[]): string {
  const sum = (key: keyof FollowUpResult['remaining']) => results.reduce((n, r) => n + r.remaining[key], 0)
  const done = results.reduce((n, r) => n + r.recalculated, 0)
  const unread = results.some(r => !r.complete || r.status === 'unavailable')
  const parts: string[] = []
  parts.push(done ? `Code recalculated ${done} material row${done === 1 ? '' : 's'} of the saved construction from their recorded recipes, keeping each row.` : 'Code recalculated no material row.')
  if (unread) parts.push('The change work could not be read in full; rows not read are still pending.')
  if (sum('needs_calculation')) parts.push(`${sum('needs_calculation')} not run in time: ask Konrad to continue the construction change; no decision is needed.`)
  if (sum('needs_expert_decision')) parts.push(`${sum('needs_expert_decision')} have no recorded calculation: Mattias chooses how each is calculated.`)
  if (sum('needs_review')) parts.push(`${sum('needs_review')} have allocations, commitments or other outputs to review before they change.`)
  if (sum('unavailable')) parts.push(`${sum('unavailable')} could not be recalculated now.`)
  if (!done && !unread && !results.some(r => r.left.length)) parts[0] = 'No material row needed recalculation.'
  // The change items in the database are the place to continue from: a later
  // Konrad hand-over recalculates what is still pending, without listing it again.
  return parts.join(' ')
}
