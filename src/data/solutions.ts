import type { SupabaseClient } from '@supabase/supabase-js'
import type { MeasurementTruth } from './projectFacts'

export interface Solution {
  id: string; projectId: string; areaId: string | null; revision: number
  title: string; description: string; assumptions: string; tradeoffs: string
  imageId: string | null; imageTitle: string; archived: boolean
  reason: string; actor: string; recordedAt: string
}
export interface SolutionMeasurement {
  id: string; revision: number; subject: string; value: string | null; unit: string
  truth: MeasurementTruth; source: string; latestRevision: number; archived: boolean
}
export interface SolutionVersion extends Solution { measurements: SolutionMeasurement[] }
export interface TargetDecision {
  projectId: string; revision: number; solutionId: string | null; solutionRevision: number | null
  reason: string; actor: string; recordedAt: string
}
export interface SelectedTarget { decision: TargetDecision; solution: SolutionVersion | null }
type Row = Record<string, any>
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}
function solution(r: Row): Solution {
  return { id: r.solution_id, projectId: r.project_id, areaId: r.area_id ?? null, revision: r.revision,
    title: r.title, description: r.description, assumptions: r.assumptions, tradeoffs: r.tradeoffs,
    imageId: r.source_media_id, imageTitle: r.source_media_title, archived: r.archived,
    reason: r.change_note, actor: r.actor_label, recordedAt: r.recorded_at }
}
function decision(r: Row): TargetDecision {
  return { projectId: r.project_id, revision: r.revision, solutionId: r.solution_id,
    solutionRevision: r.solution_revision, reason: r.reason, actor: r.actor_label, recordedAt: r.recorded_at }
}

export function createSolutions(client: SupabaseClient<any, any, any> | null, capture: (id: string) => () => void) {
  function connection(projectId: string) {
    const guard = capture(projectId); guard()
    if (!client) throw new Error('This demo does not save solutions. Open a connected project.')
    return { db: client, guard }
  }
  function scoped<T extends Row>(rows: T[], projectId: string): T[] {
    if (rows.some(r => r.project_id !== projectId)) throw new Error('Solution project mismatch.')
    return rows
  }
  async function version(projectId: string, id: string, revision: number): Promise<SolutionVersion> {
    const { db, guard } = connection(projectId)
    const r = checked(await db.from('solution_revisions').select('*').eq('project_id', projectId)
      .eq('solution_id', id).eq('revision', revision).single()) as Row
    guard()
    if (!r) throw new Error('Solution version unavailable. Reload to check access.')
    scoped([r], projectId)
    const refs = checked(await db.from('solution_measurement_details').select('*').eq('project_id', projectId)
      .eq('solution_id', id).eq('solution_revision', revision).order('measurement_id').limit(20)) as Row[]
    guard()
    return { ...solution(r), measurements: scoped(refs, projectId).map(m => ({ id: m.measurement_id,
      revision: m.measurement_revision, subject: m.subject, value: m.value, unit: m.unit, truth: m.truth,
      source: m.source, latestRevision: m.latest_revision, archived: m.currently_archived })) }
  }
  async function target(projectId: string): Promise<SelectedTarget> {
    const { db, guard } = connection(projectId)
    const r = checked(await db.from('current_target').select('*').eq('project_id', projectId).maybeSingle()) as Row | null
    guard()
    const d = r ? decision(scoped([r], projectId)[0]) : { projectId, revision: 0, solutionId: null, solutionRevision: null, reason: '', actor: '', recordedAt: '' }
    const s = d.solutionId && d.solutionRevision ? await version(projectId, d.solutionId, d.solutionRevision) : null
    guard()
    return { decision: d, solution: s }
  }
  return {
    version, target,
    async list(projectId: string, areaId = '', archived = false, offset = 0) {
      const { db, guard } = connection(projectId)
      let q = db.from('current_solutions').select('*').eq('project_id', projectId).eq('archived', archived)
      if (areaId) q = q.eq('area_id', areaId)
      const rows = checked(await q.order('recorded_at', { ascending: false }).order('id').range(offset, offset + 24)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 24), projectId).map(solution), hasMore: rows.length > 24 }
    },
    async history(projectId: string, id: string, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('solution_revisions').select('*').eq('project_id', projectId).eq('solution_id', id)
        .order('revision', { ascending: false }).range(offset, offset + 12)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 12), projectId).map(solution), hasMore: rows.length > 12 }
    },
    async decisions(projectId: string, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('target_revisions').select('*').eq('project_id', projectId)
        .order('revision', { ascending: false }).range(offset, offset + 12)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 12), projectId).map(decision), hasMore: rows.length > 12 }
    },
    async edit(projectId: string, action: 'create' | 'revise' | 'archive' | 'restore', id: string, expected: number, data: Record<string, unknown> = {}) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('solution_command', { p_project: projectId, p_action: action, p_solution: id, p_expected: expected, p_data: data })) as Row
      guard()
      return version(projectId, id, saved.revision)
    },
    async choose(projectId: string, selected: Solution | null, expected: number, reason: string) {
      const { db, guard } = connection(projectId)
      checked(await db.rpc('solution_command', { p_project: projectId, p_action: selected ? 'select' : 'clear',
        p_solution: selected?.id ?? null, p_expected: expected,
        p_data: { reason, ...(selected ? { solution_revision: selected.revision } : {}) } }))
      guard()
      return target(projectId)
    },
  }
}
