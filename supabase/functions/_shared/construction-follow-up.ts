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
export type FollowUpRow = { item_id: string; output_id: string | null; status: string; reason?: string; revision?: number }
export type FollowUpResult = { artifact_id: string; revision: number; status: string; recalculated: number; left: FollowUpRow[]; other_pending: Record<string, number>; note?: string }

const PAGE_LIMIT = 8
const ROW_LIMIT = 60
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
    const out: FollowUpResult = { ...target, status: 'unavailable', recalculated: 0, left: [], other_pending: {} }
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
    if (out.status !== 'pending') continue
    if (!complete) out.note = 'Not every change item could be read; the rest stay pending.'
    for (const item of items) {
      if (item?.state !== 'pending' || !uuid(item.id)) continue
      if (item.kind !== 'requirement') { out.other_pending[String(code(item.kind) ?? 'other')] = (out.other_pending[String(code(item.kind) ?? 'other')] ?? 0) + 1; continue }
      const row: FollowUpRow = { item_id: item.id, output_id: uuid(item.output_id) ? item.output_id : null, status: 'not_run' }
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
      const reason = code(result?.reason) ?? code(result?.validation?.code)
      if (reason) row.reason = reason
      out.left.push(row)
    }
    if (out.left.length) out.note = (out.note ? out.note + ' ' : '') + 'Rows in left were not recalculated by code; each needs its own decision (for example a requirement model, or an allocation or commitment review).'
  }
  return results
}
