import type { AnswerEvidence, ProjectWriteReceipt } from './provenance'

export function isProjectWriteReceipt(value: unknown, projectId: string): value is ProjectWriteReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Partial<ProjectWriteReceipt>
  return r.projectId === projectId && ['project', 'tasks', 'measurements'].includes(r.dataset ?? '')
    && typeof r.recordId === 'string' && r.recordId.length > 0 && r.recordId.length <= 200
    && typeof r.label === 'string' && r.label.length > 0 && r.label.length <= 300
    && ['created', 'updated'].includes(r.operation ?? '')
    && typeof r.savedAt === 'string' && Number.isFinite(Date.parse(r.savedAt))
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
