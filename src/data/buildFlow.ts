import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, any>

/** The build guide drawing made from one exact construction version. */
export interface BuildGuideDrawing {
  projectId: string
  id: string
  revision: number
  title: string
  construction: { id: string; revision: number }
  recipe: Row
  manifest: Row
  files: Record<string, string>
}

const ITEM = /^(cut|page):[A-Za-z0-9_.:-]{1,200}$/

function checked<T>(result: { data: T | null; error: { message: string } | null }): T | null {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

/** Build-day reads and ticks (owner ask 2026-11-15). Ticks are shared through
 * bob.build_checks per exact saved version; bought stays on bob.materials. */
export function createBuildFlow(client: SupabaseClient<any, any, any> | null, capture: (projectId: string) => () => void) {
  function connection(projectId: string) {
    const guard = capture(projectId)
    guard()
    if (!client) throw new Error('Open a connected project.')
    return { db: client, guard }
  }

  return {
    /** The newest generated guide pinned to this exact construction version, or null. */
    async guide(projectId: string, construction: { id: string; revision: number; title: string }): Promise<BuildGuideDrawing | null> {
      if (!client) return null
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('artifact_cad_revisions').select('artifact_id,artifact_revision,recipe,manifest')
        .eq('project_id', projectId)
        .eq('manifest->build_guide->>status', 'generated')
        .eq('manifest->build_guide->construction->>artifact_id', construction.id)
        .eq('manifest->build_guide->construction->>revision', String(construction.revision))
        .order('artifact_revision', { ascending: false }).limit(1)) as Row[] | null
      guard()
      const row = rows?.[0]
      if (!row || typeof row.artifact_id !== 'string' || !Number.isSafeInteger(row.artifact_revision)) return null
      const guide = row.manifest?.build_guide
      if (guide?.construction?.artifact_id !== construction.id || guide.construction.revision !== construction.revision) return null
      // Older guides kept their pages inline with the drawing files.
      let files: Record<string, string> = {}
      if (guide.store !== 'pages') {
        const read = checked(await db.from('artifact_cad_revisions').select('files').eq('project_id', projectId)
          .eq('artifact_id', row.artifact_id).eq('artifact_revision', row.artifact_revision).maybeSingle()) as Row | null
        guard()
        files = read?.files && typeof read.files === 'object' ? read.files : {}
      }
      return { projectId, id: row.artifact_id, revision: row.artifact_revision, title: construction.title,
        construction: { id: construction.id, revision: construction.revision }, recipe: row.recipe ?? {}, manifest: row.manifest ?? {}, files }
    },

    async checks(projectId: string, artifactId: string, revision: number): Promise<Set<string>> {
      if (!client) return new Set()
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('build_checks').select('item').eq('project_id', projectId)
        .eq('artifact_id', artifactId).eq('revision', revision).limit(2000)) as { item: string }[] | null
      guard()
      return new Set((rows ?? []).map(row => row.item))
    },

    async setCheck(projectId: string, artifactId: string, revision: number, item: string, on: boolean): Promise<void> {
      if (!ITEM.test(item)) throw new Error('Invalid build check.')
      const { db, guard } = connection(projectId)
      const pin = { project_id: projectId, artifact_id: artifactId, revision, item }
      const result = on
        ? await db.from('build_checks').upsert(pin, { onConflict: 'project_id,artifact_id,revision,item', ignoreDuplicates: true })
        : await db.from('build_checks').delete().match(pin)
      guard()
      if (result.error) throw new Error(result.error.message)
    },
  }
}
