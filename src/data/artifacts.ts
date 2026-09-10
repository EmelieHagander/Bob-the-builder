import type { SupabaseClient } from '@supabase/supabase-js'

export const ARTIFACT_KINDS = { plan: 'Plan', elevation: 'Elevation', section: 'Section', detail: 'Detail', reference: 'Reference' } as const
export interface Artifact {
  id: string; projectId: string; areaId: string | null; revision: number; latestRevision: number
  title: string; kind: keyof typeof ARTIFACT_KINDS; notes: string; source: string; unresolved: string
  imageId: string | null; imageTitle: string; imageReady: boolean; archived: boolean; currentlyArchived: boolean
  targetRevision: number; solutionId: string; solutionRevision: number; solutionTitle: string
  targetChanged: boolean; evidenceChanged: boolean; reason: string; actor: string; recordedAt: string
  taskId?: string; linkedBy?: string; linkedAt?: string
}
type Row = Record<string, any>
function checked<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data
}
function map(r: Row): Artifact {
  return { id: r.artifact_id, projectId: r.project_id, areaId: r.area_id, revision: r.revision, latestRevision: r.latest_revision,
    title: r.title, kind: r.kind, notes: r.notes, source: r.source, unresolved: r.unresolved,
    imageId: r.source_media_id, imageTitle: r.source_media_title, imageReady: r.image_ready, archived: r.archived, currentlyArchived: r.currently_archived,
    targetRevision: r.target_revision, solutionId: r.solution_id, solutionRevision: r.solution_revision, solutionTitle: r.solution_title,
    targetChanged: r.target_changed, evidenceChanged: r.evidence_changed, reason: r.change_note, actor: r.actor_label, recordedAt: r.recorded_at,
    taskId: r.task_id, linkedBy: r.linked_by, linkedAt: r.linked_at }
}
export function createArtifacts(client: SupabaseClient<any, any, any> | null, capture: (id: string) => () => void) {
  function connection(projectId: string) {
    const guard = capture(projectId); guard()
    if (!client) throw new Error('This demo does not save drawings/references. Open a connected project.')
    return { db: client, guard }
  }
  function scoped(rows: Row[], projectId: string) {
    if (rows.some(r => r.project_id !== projectId)) throw new Error('Drawing/reference project mismatch.')
    return rows.map(map)
  }
  async function version(projectId: string, id: string, revision: number) {
    const { db, guard } = connection(projectId)
    const row = checked(await db.from('artifact_versions').select('*').eq('project_id', projectId).eq('artifact_id', id).eq('revision', revision).single()) as Row
    guard()
    if (!row) throw new Error('Drawing/reference version unavailable. Reload to check access.')
    return scoped([row], projectId)[0]
  }
  return {
    version,
    async list(projectId: string, areaId = '', archived = false, offset = 0) {
      const { db, guard } = connection(projectId)
      let q = db.from('current_artifacts').select('*').eq('project_id', projectId).eq('archived', archived)
      if (areaId) q = q.eq('area_id', areaId)
      const rows = checked(await q.order('recorded_at', { ascending: false }).order('id').range(offset, offset + 24)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 24), projectId), hasMore: rows.length > 24 }
    },
    async history(projectId: string, id: string, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('artifact_versions').select('*').eq('project_id', projectId).eq('artifact_id', id)
        .order('revision', { ascending: false }).range(offset, offset + 12)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 12), projectId), hasMore: rows.length > 12 }
    },
    async tasks(projectId: string, taskId: string, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('task_artifacts').select('*').eq('project_id', projectId).eq('task_id', taskId)
        .order('linked_at', { ascending: false }).order('id').range(offset, offset + 24)) as Row[]
      guard()
      if (rows.some(r => r.task_id !== taskId)) throw new Error('Drawing/reference task mismatch.')
      return { items: scoped(rows.slice(0, 24), projectId), hasMore: rows.length > 24 }
    },
    async edit(projectId: string, action: 'create' | 'revise' | 'archive' | 'restore', id: string, expected: number, data: Record<string, unknown> = {}) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('artifact_command', { p_project: projectId, p_action: action, p_artifact: id, p_expected: expected, p_data: data })) as Row
      guard()
      return version(projectId, id, saved.revision)
    },
    async link(projectId: string, taskId: string, value: Artifact, action: 'attach' | 'detach', expectedLink: number) {
      const { db, guard } = connection(projectId)
      if (value.projectId !== projectId) throw new Error('Drawing/reference project mismatch.')
      checked(await db.rpc('artifact_command', { p_project: projectId, p_action: action, p_artifact: value.id,
        p_expected: value.latestRevision, p_data: { task_id: taskId, expected_link_revision: expectedLink } }))
      guard()
    },
  }
}
