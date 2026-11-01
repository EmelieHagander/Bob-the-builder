import type { SupabaseClient } from '@supabase/supabase-js'
import { validConstructionDelivery, type ConstructionDeliveryResource } from '../../supabase/functions/_shared/construction-delivery'

type Row = Record<string, any>

export interface ConstructionDeliveryPage {
  artifact_id: string
  revision: number
  current_revision: number
  source_state: 'current' | 'changed' | 'unavailable'
  description: string
  resource: ConstructionDeliveryResource
  records: { id: string; revision: number; current_revision: number; title?: string; name?: string; archived?: boolean;
    step_links?: { step_id: string; in_current_plan: boolean }[] }[]
  truncated: boolean
  next_after: string | null
}

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
  solutionRevision: number | null
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
  solution_id: string
  solution_revision: number
  recipe: { definitions: Row[]; instances: Array<Row & { id: string; definition_id: string }> }
  materials: Row[]
  joints: Row[]
  open_questions: string[]
  instance_policy: unknown
}

export interface ConstructionPreparationSource {
  draft: ConstructionDraftSnapshot
  catalog: Map<string, Row>
}

/** Exact screw, nail, bolt and glue counts from the server fastener schedule
 * (owner decisions 2026-10-26): a rule-of-thumb proposal with no waste added,
 * never a strength calculation. */
export interface ConstructionFasteners {
  complete: boolean
  totals: { kind: 'screw' | 'nail' | 'bolt'; diameterMm: number; lengthMm: number; count: number; joints: number }[]
  gluePackages: number
  /** Joints the rule could not size, and sized joints with rule warnings. */
  unsizedJoints: number
  flaggedJoints: number
}

export function parseConstructionFasteners(value: unknown, artifactId: string, revision: number): ConstructionFasteners | null {
  const v = value as Row | null
  if (!v || v.status !== 'ok' || v.artifact_id !== artifactId || v.revision !== revision || v.rule_version !== 'fastener-rules-v1'
    || typeof v.complete !== 'boolean' || !Array.isArray(v.totals) || !Array.isArray(v.joints) || !Number.isSafeInteger(v.glue_packages)) return null
  const totals: ConstructionFasteners['totals'] = []
  for (const t of v.totals as Row[]) {
    if (!['screw', 'nail', 'bolt'].includes(t?.kind) || !Number.isFinite(t.diameter_mm) || !Number.isFinite(t.length_mm)
      || !Number.isSafeInteger(t.count) || !Array.isArray(t.joint_ids)) return null
    totals.push({ kind: t.kind, diameterMm: t.diameter_mm, lengthMm: t.length_mm, count: t.count, joints: t.joint_ids.length })
  }
  const mechanical = (j: Row) => ['screw', 'nail', 'bolt'].includes(j?.kind)
  // Chosen catalog items (2026-11-01) give one row per item: count joints, not rows.
  const open = (j: Row) => j?.source === 'no_rule' || j?.source === 'none' || mechanical(j) && [j.diameter_mm, j.length_mm, j.count].some(x => x === null)
    || Array.isArray(j?.gaps) && j.gaps.some((g: unknown) => g === 'count_unknown' || g === 'fastener_unknown')
  const unsized = new Set((v.joints as Row[]).filter(open).map(j => j.joint_id))
  const flagged = new Set((v.joints as Row[]).filter(j => Array.isArray(j?.gaps) && j.gaps.length && !unsized.has(j.joint_id)).map(j => j.joint_id))
  return { complete: v.complete, totals, gluePackages: v.glue_packages, unsizedJoints: unsized.size, flaggedJoints: flagged.size }
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
    async delivery(projectId: string, artifactId: string, revision: number, resource: ConstructionDeliveryResource, after: string | null = null): Promise<ConstructionDeliveryPage> {
      const { db, guard } = connection(projectId)
      const value = checked(await db.rpc('read_construction_delivery', {
        p_project: projectId, p_artifact: artifactId, p_revision: revision, p_resource: resource, p_after: after,
      })) as Row
      guard()
      if (!validConstructionDelivery(value, projectId, artifactId, revision, resource)
        || typeof value.description !== 'string' || !['current', 'changed', 'unavailable'].includes(value.source_state)
        || value.records.some((r: Row) => !Number.isSafeInteger(r.current_revision) || r.current_revision < r.revision
          || r.title !== undefined && typeof r.title !== 'string' || r.name !== undefined && typeof r.name !== 'string'
          || r.archived !== undefined && typeof r.archived !== 'boolean'
          || r.step_links !== undefined && (!Array.isArray(r.step_links)
            || r.step_links.some((link: Row) => typeof link?.step_id !== 'string' || typeof link.in_current_plan !== 'boolean')))
        || value.truncated && (!value.records.length || value.next_after !== value.records.at(-1).id || value.next_after === after)) {
        throw new Error('The saved output references could not be read.')
      }
      return value as ConstructionDeliveryPage
    },

    async targets(projectId: string): Promise<ProjectTargetScope[]> {
      if (!client) return []
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_target').select('area_id,revision,solution_id,solution_revision')
        .eq('project_id', projectId)) as Row[]
      guard()
      return rows.filter(row => row.solution_id).map(row => ({
        areaId: row.area_id ?? null, revision: row.revision,
        solutionId: row.solution_id, solutionRevision: row.solution_revision ?? null,
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

    async fasteners(projectId: string, artifactId: string, revision: number): Promise<ConstructionFasteners | null> {
      const { db, guard } = connection(projectId)
      const data = checked(await db.rpc('read_construction_fasteners', { p_project: projectId, p_artifact: artifactId, p_revision: revision }))
      guard()
      return parseConstructionFasteners(data, artifactId, revision)
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

      if (draft.materials.length > 128 || draft.materials.some((row: Row) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.material_id)
        || !Number.isSafeInteger(row.material_revision) || row.material_revision < 1)) {
        throw new Error('The saved construction has unavailable material versions.')
      }
      const pins = [...new Map((draft.materials as Row[]).map(row =>
        [row.material_id + '@' + row.material_revision, { id: row.material_id, revision: row.material_revision }])).values()]
      const catalog = new Map<string, Row>()
      // Exact pairs in bounded requests: unrelated history must not consume
      // the PostgREST row limit or substitute a newer material revision.
      for (let offset = 0; offset < pins.length; offset += 32) {
        const selected = pins.slice(offset, offset + 32)
        const records = checked(await db.from('catalog_item_revisions').select('item_id,revision,name,properties')
          .or(selected.map(pin => `and(item_id.eq.${pin.id},revision.eq.${pin.revision})`).join(','))
          .limit(selected.length)) as Row[]
        guard()
        for (const item of records) {
          if (!selected.some(pin => pin.id === item.item_id && pin.revision === item.revision)) throw new Error('The material read returned an unexpected version.')
          catalog.set(String(item.item_id) + '@' + String(item.revision), item)
        }
      }
      return { draft: draft as ConstructionDraftSnapshot, catalog }
    },
  }
}
