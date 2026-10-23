import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, any>

export interface ConstructionHead {
  id: string
  title: string
  revision: number
  areaId: string | null
  recordedAt: string
}

export interface ProjectTargetScope {
  areaId: string | null
  revision: number
  solutionId: string | null
}

export interface ConstructionDraftSnapshot {
  status: 'ok'
  projectId: string
  artifact_id: string
  revision: number
  current_revision: number
  area_id: string | null
  title: string
  archived: boolean
  source_state: 'current' | 'changed' | 'unavailable'
  recipe: { definitions: Row[]; instances: Row[] }
  materials: Row[]
  joints: Row[]
  open_questions: string[]
  instance_policy: unknown
}

export interface ConstructionPreparationSource {
  draft: ConstructionDraftSnapshot
  catalog: Map<string, Row>
}

function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('The saved construction could not be read.')
  return result.data
}

/** Read existing, member-scoped construction facts. No second BOM or purchase store. */
export function createBuildPreparation(client: SupabaseClient<any, any, any> | null, capture: (projectId: string) => () => void) {
  function connection(projectId: string) {
    const guard = capture(projectId)
    guard()
    if (!client) throw new Error('Open a connected project to read its construction.')
    return { db: client, guard }
  }

  return {
    async targets(projectId: string): Promise<ProjectTargetScope[]> {
      if (!client) return []
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_target').select('area_id,revision,solution_id')
        .eq('project_id', projectId)) as Row[]
      guard()
      return rows.filter(row => row.solution_id).map(row => ({
        areaId: row.area_id ?? null, revision: row.revision, solutionId: row.solution_id,
      }))
    },

    async constructions(projectId: string): Promise<ConstructionHead[]> {
      if (!client) return []
      const { db, guard } = connection(projectId)
      const heads: { id: string; title: string; revision: number }[] = []
      let cursor: string | null = null
      const visited = new Set<string>()
      do {
        const page = checked(await db.rpc('read_construction_draft', {
          p_project: projectId, p_artifact: null, p_revision: null, p_after: cursor,
        })) as Row
        guard()
        if (page.status !== 'ok' || page.projectId !== projectId || !Array.isArray(page.items)) {
          throw new Error('Construction list unavailable. Reopen the project.')
        }
        for (const item of page.items as Row[]) {
          if (typeof item.id !== 'string' || visited.has(item.id)) throw new Error('Overlapping construction list pages.')
          visited.add(item.id)
          heads.push({ id: item.id, title: String(item.title), revision: Number(item.revision) })
        }
        if (!page.truncated) break
        if (typeof page.next_cursor !== 'string' || page.next_cursor === cursor || heads.length >= 240) {
          throw new Error('Construction list is incomplete. Narrow the project before preparing lists.')
        }
        cursor = page.next_cursor
      } while (true)

      if (!heads.length) return []
      const current = checked(await db.from('current_artifacts').select('id,area_id,recorded_at')
        .eq('project_id', projectId).in('id', heads.map(head => head.id))) as Row[]
      guard()
      const byId = new Map(current.map(row => [row.id, row]))
      if (heads.some(head => !byId.has(head.id))) throw new Error('Construction identity changed. Reload the project.')
      return heads.map(head => ({
        ...head, areaId: byId.get(head.id)?.area_id ?? null,
        recordedAt: byId.get(head.id)?.recorded_at ?? '',
      })).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id))
    },

    async source(projectId: string, artifactId: string, revision: number): Promise<ConstructionPreparationSource> {
      const { db, guard } = connection(projectId)
      const draft = checked(await db.rpc('read_construction_draft', {
        p_project: projectId, p_artifact: artifactId, p_revision: revision, p_after: null,
      })) as Row
      guard()
      if (draft.status !== 'ok' || draft.projectId !== projectId
        || draft.artifact_id !== artifactId || draft.revision !== revision
        || !draft.recipe || !Array.isArray(draft.recipe.instances) || !Array.isArray(draft.recipe.definitions)
        || !Array.isArray(draft.materials) || !Array.isArray(draft.joints)) {
        throw new Error('The exact saved construction version is unavailable. Reload before using its lists.')
      }

      const materialIds = [...new Set((draft.materials as Row[]).map(row => String(row.material_id)))]
      const catalog = new Map<string, Row>()
      if (materialIds.length) {
        const records = checked(await db.from('catalog_item_revisions').select('item_id,revision,name,properties')
          .in('item_id', materialIds)) as Row[]
        guard()
        for (const item of records) catalog.set(String(item.item_id) + '@' + String(item.revision), item)
      }
      return { draft: draft as ConstructionDraftSnapshot, catalog }
    },
  }
}
