import type { CurrentView } from '../../../src/domain/bobScreen.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'
import type { WriteReadback } from './project-write.ts'

type Row = Record<string, unknown>
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit = 240) => typeof value === 'string' ? value.slice(0, limit) : ''
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (object(value)) return Object.fromEntries(Object.entries(value).filter(([key, item]) => key !== 'retrievedAt' && item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  return value
}
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const sourceKey = (source: ProjectSource) => source.dataset + ':' + source.recordId
const slot = (view: CurrentView, dataset: string) => dataset === 'project' ? view.project
  : dataset === 'areas' ? view.focus.area : dataset === 'tasks' ? view.focus.task
  : dataset === 'events' ? view.focus.event : dataset === 'plan' ? view.focus.planStep : undefined

/** A successful readback may explain this turn's change, never a later edit.
 * Require all fields that the caller-hydrated view exposes, plus unchanged scope.
 * Unsupported/incomplete receipts conservatively retain the freshness stop. */
function proves(receipt: WriteReadback, source: ProjectSource, initial: CurrentView, fresh: CurrentView): boolean {
  const row = receipt.record
  const before = slot(initial, source.dataset), after = slot(fresh, source.dataset)
  if (!object(row) || !before || !after || before.id !== after.id || receipt.projectId !== initial.projectId || receipt.operation === 'deleted') return false
  if (source.projectId !== initial.projectId || source.truth !== 'unknown') return false
  const entity = (r: Row) => ({ id: String(r.id), name: text(r.name ?? r.title) })
  let projected: unknown
  let record: Row = row
  if (source.dataset === 'plan') {
    if (receipt.dataset !== 'plan' || receipt.recordId !== initial.projectId || row.id !== initial.projectId
      || row.project_id !== initial.projectId || !Number.isSafeInteger(row.revision) || row.revision !== receipt.revision
      || !Array.isArray(row.steps)) return false
    const matches = row.steps.filter((step: unknown) => object(step) && step.id === source.recordId)
    if (matches.length !== 1) return false
    record = matches[0]
    if (record.area_id !== (initial.focus.area?.id ?? null)
      || typeof record.title !== 'string' || typeof record.state !== 'string' || typeof record.goal !== 'string' || typeof record.notes !== 'string'
      || source.updatedAt !== null) return false
    projected = { ...before, id: String(record.id), name: text(record.title), state: text(record.state), planRevision: row.revision,
      goal: text(record.goal, 600), notes: text(record.notes, 600) }
    const responsible = (after as unknown as Row).responsible
    if (responsible !== undefined && (!object(responsible) || record.responsible_kind !== responsible.kind
      || record.responsible_person_id !== (object(responsible.person) ? responsible.person.id : null))) return false
  } else {
    if (receipt.dataset !== source.dataset || receipt.recordId !== source.recordId || row.id !== source.recordId
      || source.dataset !== 'project' && row.project_id !== initial.projectId
      || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at)) || source.updatedAt !== row.updated_at) return false
    if (source.dataset === 'project' || source.dataset === 'areas') {
      if (typeof row.name !== 'string') return false
      projected = entity(row)
    } else if (source.dataset === 'tasks') {
      if (row.area_id !== (initial.focus.area?.id ?? null) || row.primary_step_id !== (initial.focus.planStep?.id ?? null)
        || typeof row.name !== 'string' || typeof row.status !== 'string' || typeof row.instructions !== 'string') return false
      // Assignment/other related metadata stays frozen unless a future command
      // supplies its own exact complete readback. A Task edit proves its own fields.
      projected = { ...before, ...entity(row), status: text(row.status), instructions: text(row.instructions, 1200) }
    } else if (source.dataset === 'events') {
      if (['title','status','day','time','place'].some(key => typeof row[key] !== 'string')) return false
      projected = { ...entity(row), status: text(row.status), day: text(row.day), time: text(row.time), place: text(row.place) }
    } else return false
  }
  return source.label === text(record.name ?? record.title ?? source.recordId, 120) && equal(projected, after)
}

/** Entry context remains frozen for durable model replay. Only exact verified own
 * write readbacks may advance release evidence; unrelated changes still stop work.
 * The caller supplies receipts from the guarded writer, never model/browser data. */
export function createCurrentViewGuard(opts: { initial: CurrentView; read: () => Promise<CurrentView>;
  hasAccess: () => Promise<boolean>; receipts: () => WriteReadback[] }) {
  const initial = structuredClone(opts.initial)
  let accepted = structuredClone(initial)
  return {
    evidence: () => structuredClone(accepted),
    async validate(): Promise<boolean> {
      try {
        if (!await opts.hasAccess()) return false
        // No row facts entered the model, so absence of focus is not a freshness claim.
        if (initial.status !== 'ok') return true
        const fresh = await opts.read()
        if (!await opts.hasAccess() || fresh.status !== 'ok' || fresh.projectId !== initial.projectId || fresh.surface !== initial.surface
          || !equal(fresh.warnings, initial.warnings) || !equal(fresh.viewer, initial.viewer)
          || !equal(Object.keys(fresh.focus).sort(), Object.keys(initial.focus).sort())) return false
        if (Object.entries(initial.focus).some(([key, entity]) => entity?.id !== fresh.focus[key as keyof CurrentView['focus']]?.id)
          || initial.project?.id !== fresh.project?.id) return false
        const beforeSources = new Map(initial.sources.map(source => [sourceKey(source), source]))
        if (beforeSources.size !== initial.sources.length || fresh.sources.length !== initial.sources.length
          || new Set(fresh.sources.map(sourceKey)).size !== fresh.sources.length) return false
        const receipts = new Map<string, WriteReadback>()
        for (const receipt of opts.receipts()) receipts.set(receipt.dataset + ':' + receipt.recordId, receipt)
        const expected = structuredClone(initial)
        for (const source of fresh.sources) {
          const old = beforeSources.get(sourceKey(source))
          if (!old) return false
          const beforeEntity = slot(initial, source.dataset), afterEntity = slot(fresh, source.dataset)
          if (equal(old, source) && equal(beforeEntity, afterEntity)) continue
          const receipt = receipts.get(source.dataset + ':' + (source.dataset === 'plan' ? initial.projectId : source.recordId))
          if (!receipt || !proves(receipt, source, initial, fresh)) return false
          // Scope and every untouched field remain in expected; only the proven slot advances.
          if (source.dataset === 'project') expected.project = fresh.project
          else if (source.dataset === 'areas') expected.focus.area = fresh.focus.area
          else if (source.dataset === 'tasks') expected.focus.task = fresh.focus.task
          else if (source.dataset === 'events') expected.focus.event = fresh.focus.event
          else if (source.dataset === 'plan') expected.focus.planStep = fresh.focus.planStep
          expected.sources[expected.sources.findIndex(item => sourceKey(item) === sourceKey(source))] = source
        }
        if (!equal(expected, fresh)) return false
        accepted = structuredClone(fresh)
        return true
      } catch { return false }
    },
  }
}
