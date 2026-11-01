import { rethrowContinuation } from './bob-job-journal.ts'
import { countSerializedTokens } from './bob-token-budget.ts'
import type { DesignReadiness } from './project-design-intent.ts'

/** Owner decision 2026-10-29: a write returns the state it produced, so Bob
 * does not spend a model round re-reading what the server already knows.
 * Pinned per catalog manifest (bob.tools write_state_version 1). */
export const WRITE_STATE_VERSION = 1

type Row = Record<string, any>
const CHECK_TOKENS = 1500

const findings = (check: Row, collection: 'issues' | 'fabrication_gaps'): Row[] => Array.isArray(check[collection]) ? check[collection]
  : Array.isArray(check.findings) ? check.findings.filter((item: Row) => item?.collection === collection && item.id !== 'empty_array').map((item: Row) => item.value) : []

/** The check of the exact saved revision, small enough to stay in context.
 * Findings that do not fit are counted and left at the returned read pointer;
 * a check that did not run is reported as such, never as a pass. */
export function compactConstructionCheck(check: Row | undefined): Row {
  if (!check || check.status !== 'checked') {
    return { status: typeof check?.status === 'string' ? check.status : 'unavailable',
      ...(typeof check?.reason === 'string' ? { reason: check.reason } : {}),
      ...(Number.isSafeInteger(check?.current_revision) ? { current_revision: check!.current_revision } : {}),
      message: 'The write is saved, but its check did not complete. Call check_construction_draft for this exact revision before relying on it.' }
  }
  const issues = findings(check, 'issues'), gaps = findings(check, 'fabrication_gaps')
  const result: Row = { status: 'checked', concept_ready: check.concept_ready === true, fabrication_ready: false,
    issue_count: Number.isSafeInteger(check.issue_count) ? check.issue_count : issues.length,
    fabrication_gap_count: Number.isSafeInteger(check.fabrication_gap_count) ? check.fabrication_gap_count : gaps.length,
    part_count: check.part_count ?? null, joint_count: check.joint_count ?? null, bounds_mm: check.bounds_mm ?? null,
    result_id: check.result?.result_id ?? null, details_read: check.result?.read ?? check.next_read ?? null,
    coverage_complete: check.coverage?.complete === true, issues: [], fabrication_gaps: [] }
  for (const [key, values] of [['issues', issues], ['fabrication_gaps', gaps]] as const) {
    for (const value of values) {
      result[key].push(value)
      if (countSerializedTokens(result) > CHECK_TOKENS) { result[key].pop(); break }
    }
  }
  // Chosen joint fasteners (2026-11-01): only checks that carry them, after the
  // findings and within the same budget.
  const facts = check.fastener_facts
  if (facts && typeof facts === 'object' && !Array.isArray(facts)) {
    const rows: unknown[] = Array.isArray(facts.rows) ? facts.rows : [], shown: Row = { ...facts, rows: [] }
    result.fastener_facts = shown
    for (const row of rows) {
      shown.rows.push(row)
      if (countSerializedTokens(result) > CHECK_TOKENS) { shown.rows.pop(); break }
    }
    if (shown.rows.length < rows.length) shown.rows_omitted = rows.length - shown.rows.length
  }
  const shown = result.issues.length + result.fabrication_gaps.length
  if (shown < result.issue_count + result.fabrication_gap_count) {
    result.findings_omitted = result.issue_count + result.fabrication_gap_count - shown
    result.coverage_complete = false
  }
  return result
}

/** Canonical construction readiness for a selected target, as the work view
 * reports it. An unreadable gate is reported, never guessed. */
export async function constructionReadiness(read: ((targetRevision: number, areaId: string | null) => Promise<DesignReadiness>) | undefined,
  projectId: string, target: { revision: number; area_id: string | null; solution_id?: string; solution_revision?: number }): Promise<Row> {
  const unavailable = { status: 'unavailable', message: 'Readiness could not be read; read_construction_draft view=work reports it.' }
  if (!read || !Number.isSafeInteger(target.revision)) return unavailable
  try {
    const r = await read(target.revision, target.area_id)
    if (!r || r.project_id !== projectId || r.area_id !== target.area_id || r.purpose !== 'construction' || r.target_revision !== target.revision
      || target.solution_id !== undefined && r.solution_id !== target.solution_id
      || target.solution_revision !== undefined && r.solution_revision !== target.solution_revision) return unavailable
    return { purpose: 'construction', status: r.status, creation_state: r.status, issues: r.issues, deferred_choice_ids: r.deferred_choice_ids,
      target_revision: r.target_revision, solution_revision: r.solution_revision }
  } catch (error) { rethrowContinuation(error); return unavailable }
}

/** Only construction-purpose solutions carry the construction gate. */
export const constructionPurpose = (record: Row | undefined | null) => record?.design_intent?.purpose === 'construction'
