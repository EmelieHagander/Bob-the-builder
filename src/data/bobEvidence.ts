import type { AnswerEvidence, ProjectWriteReceipt } from './provenance.ts'

export function isProjectWriteReceipt(value: unknown, projectId: string): value is ProjectWriteReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Partial<ProjectWriteReceipt>
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return r.projectId === projectId && ['project', 'tasks', 'measurements', 'artifacts', 'building_context', 'catalog', 'plan', 'solutions', 'target', 'media'].includes(r.dataset ?? '')
    && typeof r.recordId === 'string' && r.recordId.length > 0 && r.recordId.length <= 200
    && typeof r.label === 'string' && r.label.length > 0 && r.label.length <= 300
    && (['created', 'updated'].includes(r.operation ?? '') || (r.dataset === 'catalog' && r.operation === 'reused'))
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
    && Array.isArray(evidence.sources) && evidence.sources.every(s => s && s.projectId === projectId
      && typeof s.recordId === 'string' && typeof s.label === 'string' && typeof s.dataset === 'string')
    && (evidence.writes === undefined || (Array.isArray(evidence.writes) && evidence.writes.length <= 8
      && evidence.writes.every(r => isProjectWriteReceipt(r, projectId))))
}
