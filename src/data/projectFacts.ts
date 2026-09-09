import type { SupabaseClient } from '@supabase/supabase-js'
import type { TruthState } from './provenance'

export type FactKind = 'measurement' | 'component'
export type LengthUnit = 'mm' | 'cm' | 'm'
export type MeasurementTruth = Exclude<TruthState, 'ai_assessment'>
export type ComponentIntent = 'inspect' | 'reuse' | 'remove' | 'replace'
export interface FactBase {
  id: string; projectId: string; areaId: string | null; revision: number
  sourceImageId: string | null; sourceImageTitle: string
  archived: boolean; notes: string; changeNote: string; actor: string; recordedAt: string
}
export interface Measurement extends FactBase {
  kind: 'measurement'; subject: string; componentId: string | null
  value: string | null; unit: LengthUnit; millimetres: string | null
  truth: MeasurementTruth; source: string; required: boolean
}
export interface ExistingComponent extends FactBase {
  kind: 'component'; name: string; componentKind: string; quantity: number | null
  condition: string; specification: string; intent: ComponentIntent
}
export type ProjectFact = Measurement | ExistingComponent
export interface FactPage { items: ProjectFact[]; hasMore: boolean }
export interface FactFilter { areaId?: string; componentId?: string; status?: 'active' | 'missing' | 'archived' }
type Row = Record<string, any> // Mapped PostgREST boundary; never passed raw to UI.

export const TRUTH_LABELS: Record<MeasurementTruth, string> = {
  measured: 'Measured', provided_spec: 'Specification', estimated: 'Estimated', unknown: 'Unknown',
}
export const INTENT_LABELS: Record<ComponentIntent, string> = {
  inspect: 'Inspect before reuse', reuse: 'Plan to reuse', remove: 'Remove', replace: 'Replace',
}
/** Decimal strings avoid browser arithmetic/rounding. The database normalises units exactly. */
export function parseLength(input: string): string {
  const text = input.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,3})?$/.test(text) || Number(text) > 1000000) {
    throw new Error('Enter a length from 0 to 1,000,000 with up to three decimal places. A decimal comma is accepted.')
  }
  return text
}
export function describeMeasurement(record: Measurement): string {
  return record.value === null ? 'Not measured yet' : record.value + ' ' + record.unit
}
function value<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('Record unavailable. Reload the project to check access.')
  return result.data
}
function map(row: Row, kind: FactKind): ProjectFact {
  const base: FactBase = {
    id: row.measurement_id ?? (kind === 'component' ? row.component_id : null) ?? row.id,
    projectId: row.project_id, areaId: row.area_id ?? null, revision: row.revision,
    sourceImageId: row.source_media_id, sourceImageTitle: row.source_media_title,
    archived: row.archived, notes: row.notes, changeNote: row.change_note,
    actor: row.actor_label, recordedAt: row.recorded_at,
  }
  return kind === 'measurement' ? {
    ...base, kind, subject: row.subject, componentId: row.component_id ?? null,
    value: row.value === null ? null : String(row.value), unit: row.unit,
    millimetres: row.millimetres ?? null, truth: row.truth, source: row.source, required: row.required,
  } : {
    ...base, kind, name: row.name, componentKind: row.kind, quantity: row.quantity,
    condition: row.condition, specification: row.specification, intent: row.intent,
  }
}
const view = (kind: FactKind) => kind === 'measurement' ? 'current_measurements' : 'current_components'
const history = (kind: FactKind) => kind === 'measurement' ? 'measurement_revisions' : 'component_revisions'

export function createProjectFacts(client: SupabaseClient<any, any, any> | null, capture: (projectId: string) => () => void) {
  function connection(projectId: string) {
    const assertCurrent = capture(projectId)
    assertCurrent()
    if (!client) throw new Error('This demo does not save project facts. Open a connected project.')
    return { db: client, assertCurrent }
  }
  function page(rows: Row[], kind: FactKind, projectId: string, size: number): FactPage {
    if (rows.some(r => r.project_id !== projectId)) throw new Error('Project fact mismatch.')
    return { items: rows.slice(0, size).map(r => map(r, kind)), hasMore: rows.length > size }
  }
  return {
    async list(projectId: string, kind: FactKind, filter: FactFilter = {}, offset = 0): Promise<FactPage> {
      if (!client) return { items: [], hasMore: false }
      const { db, assertCurrent } = connection(projectId)
      let query = db.from(view(kind)).select('*').eq('project_id', projectId).eq('archived', filter.status === 'archived')
      if (filter.areaId) query = query.eq('area_id', filter.areaId)
      if (kind === 'measurement' && filter.componentId) query = query.eq('component_id', filter.componentId)
      if (kind === 'measurement' && filter.status === 'missing') query = query.in('truth', ['unknown', 'estimated'])
      const rows = value(await query.order('recorded_at', { ascending: false }).order('id').range(offset, offset + 24)) as Row[]
      assertCurrent()
      return page(rows, kind, projectId, 24)
    },
    async get(projectId: string, kind: FactKind, id: string): Promise<ProjectFact> {
      const { db, assertCurrent } = connection(projectId)
      const row = value(await db.from(view(kind)).select('*').eq('project_id', projectId).eq('id', id).single()) as Row
      assertCurrent()
      if (row.project_id !== projectId) throw new Error('Project fact mismatch.')
      return map(row, kind)
    },
    async history(projectId: string, kind: FactKind, id: string, offset = 0): Promise<FactPage> {
      const { db, assertCurrent } = connection(projectId)
      const rows = value(await db.from(history(kind)).select('*').eq('project_id', projectId).eq(kind + '_id', id)
        .order('revision', { ascending: false }).range(offset, offset + 12)) as Row[]
      assertCurrent()
      return page(rows, kind, projectId, 12)
    },
    async command(projectId: string, kind: FactKind, action: 'create' | 'revise' | 'archive' | 'restore',
      id: string, expected: number, data: Record<string, unknown> = {}): Promise<ProjectFact> {
      const { db, assertCurrent } = connection(projectId)
      value(await db.rpc('evidence_command', {
        p_project: projectId, p_kind: kind, p_action: action, p_record: id, p_expected: expected, p_data: data,
      }))
      assertCurrent()
      const row = value(await db.from(view(kind)).select('*').eq('project_id', projectId).eq('id', id).single()) as Row
      assertCurrent()
      if (row.project_id !== projectId) throw new Error('Project fact mismatch.')
      return map(row, kind)
    },
  }
}
