import type { AnswerEvidence, ProjectWriteReceipt } from './provenance.ts'
import { BOB_SCREEN_SURFACES, isBobOpaqueId, type CurrentView } from '../domain/bobScreen.ts'

export function isBobCurrentView(value: unknown, projectId: string): value is CurrentView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as CurrentView
  if (Object.keys(v).some(k => !['status','projectId','surface','project','viewer','focus','sources','warnings','retrievedAt'].includes(k))) return false
  if (v.projectId !== projectId || !['ok','not_found','unavailable','unsupported'].includes(v.status)
    || v.surface !== null && !BOB_SCREEN_SURFACES.includes(v.surface)
    || typeof v.retrievedAt !== 'string' || !Number.isFinite(Date.parse(v.retrievedAt))
    || !v.focus || typeof v.focus !== 'object' || Array.isArray(v.focus)
    || !Array.isArray(v.sources) || v.sources.length > 16 || !v.sources.every(s => s && s.projectId === projectId && typeof s.recordId === 'string' && typeof s.label === 'string' && typeof s.dataset === 'string')
    || !Array.isArray(v.warnings) || v.warnings.length > 32 || !v.warnings.every(w => typeof w === 'string' && w.length <= 200)) return false
  const entity = (e: unknown): e is {id:string;name:string} => !!e && typeof e === 'object' && !Array.isArray(e)
    && isBobOpaqueId((e as {id:unknown}).id) && typeof (e as {name:unknown}).name === 'string' && String((e as {name:unknown}).name).length <= 240
  if (v.status !== 'ok') return Object.keys(v.focus).length === 0 && v.sources.length === 0 && v.project === undefined && v.viewer === undefined
  if (!entity(v.project) || v.project.id !== projectId || v.viewer !== undefined && !entity(v.viewer)) return false
  const fields: Record<string, string[]> = { area: [], task: ['status','instructions'], planStep: ['state','planRevision','goal','notes'],
    instruction: ['revision','instructions','required','completedAt'], solution: ['revision','archived'], drawing: ['revision','status','archived','sourceState'], event: ['status','day','time','place'] }
  const publicPerson = (e: unknown) => entity(e) && Object.keys(e).every(k => k === 'id' || k === 'name')
  return Object.entries(v.focus).every(([key,e]) => {
    if (!Object.prototype.hasOwnProperty.call(fields,key) || !entity(e)) return false
    const row = e as unknown as Record<string,unknown>
    const optional = key === 'task' ? ['assignees'] : key === 'planStep' ? ['responsible'] : []
    if (Object.keys(row).some(k => !['id','name',...fields[key],...optional].includes(k))) return false
    if ('assignees' in row && (!Array.isArray(row.assignees) || row.assignees.length > 8 || !row.assignees.every(publicPerson))) return false
    if ('responsible' in row) {
      const responsible = row.responsible
      if (!responsible || typeof responsible !== 'object' || Array.isArray(responsible)) return false
      const r = responsible as Record<string,unknown>
      if (Object.keys(r).some(k => k !== 'kind' && k !== 'person') || !['bob','person','unassigned'].includes(String(r.kind))) return false
      if (r.kind === 'person' ? !publicPerson(r.person) : 'person' in r) return false
    }
    return fields[key].every(k => k === 'revision' || k === 'planRevision' ? Number.isSafeInteger(row[k]) && Number(row[k]) > 0
      : k === 'archived' || k === 'required' ? typeof row[k] === 'boolean'
      : k === 'completedAt' ? row[k] === null || typeof row[k] === 'string' && Number.isFinite(Date.parse(row[k]))
      : k === 'sourceState' ? ['current','changed','unavailable'].includes(String(row[k]))
      : typeof row[k] === 'string' && String(row[k]).length <= 1200)
  })
}

export const BOB_WRITE_LIMIT = 32

export function isProjectWriteReceipt(value: unknown, projectId: string): value is ProjectWriteReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Partial<ProjectWriteReceipt>
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return r.projectId === projectId && ['project', 'areas', 'tasks', 'measurements', 'artifacts', 'building_context', 'catalog', 'plan', 'solutions', 'target', 'media', 'stock', 'requirements', 'materials', 'events'].includes(r.dataset ?? '')
    && typeof r.recordId === 'string' && r.recordId.length > 0 && r.recordId.length <= 200
    && typeof r.label === 'string' && r.label.length > 0 && r.label.length <= 300
    && (['created', 'updated', 'deleted'].includes(r.operation ?? '') || (r.dataset === 'catalog' && r.operation === 'reused'))
    && typeof r.savedAt === 'string' && Number.isFinite(Date.parse(r.savedAt))
    && (r.dataset !== 'building_context' || uuid.test(r.recordId))
    && (r.dataset !== 'catalog' || (uuid.test(r.recordId) && Number.isSafeInteger(r.revision) && Number(r.revision) > 0))
    && (r.dataset !== 'plan' || (Number.isSafeInteger(r.revision) && Number(r.revision) > 0))
    && (r.dataset !== 'artifacts' || (uuid.test(r.recordId)
      && Number.isSafeInteger(r.revision) && Number(r.revision) > 0
      && (r.areaId === null || (typeof r.areaId === 'string' && r.areaId.length > 0 && r.areaId.length <= 200))))
}
export function isBobAnswerEvidence(value: unknown, projectId: string): value is AnswerEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const evidence = value as Partial<AnswerEvidence>
  return evidence.kind === 'ai_assessment' && typeof evidence.partial === 'boolean'
    && (evidence.currentView === undefined || isBobCurrentView(evidence.currentView, projectId))
    && Array.isArray(evidence.sources) && evidence.sources.every(s => s && s.projectId === projectId
      && typeof s.recordId === 'string' && typeof s.label === 'string' && typeof s.dataset === 'string')
    && (evidence.writes === undefined || (Array.isArray(evidence.writes) && evidence.writes.length <= BOB_WRITE_LIMIT
      && evidence.writes.every(r => isProjectWriteReceipt(r, projectId))))
    && (evidence.references === undefined || (Array.isArray(evidence.references) && evidence.references.length<=32
      && evidence.references.every(r=>r&&typeof r.id==='string'&&typeof r.title==='string'&&typeof r.version==='string'
        &&typeof r.reviewedAt==='string'&&Number.isFinite(Date.parse(r.reviewedAt))&&typeof r.url==='string'&&/^https:\/\//.test(r.url))))
}
