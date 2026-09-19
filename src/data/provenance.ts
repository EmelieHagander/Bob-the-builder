/** Vocabulary for V1 evidence. Existing display text has no verified provenance. */
export type TruthState = 'measured' | 'provided_spec' | 'estimated' | 'ai_assessment' | 'unknown'

export interface ProjectSource {
  projectId: string
  dataset: string
  recordId: string
  label: string
  retrievedAt: string
  updatedAt: string | null
  /** Legacy values must not be promoted to measured/specification evidence. */
  truth: TruthState
}

export interface ProjectWriteReceipt {
  projectId: string
  dataset: 'project' | 'tasks' | 'measurements' | 'artifacts' | 'building_context'
  recordId: string
  label: string
  operation: 'created' | 'updated'
  savedAt: string
  /** Drawing receipts pin an exact saved revision and its immutable Area scope. */
  revision?: number
  areaId?: string | null
}

export interface AnswerEvidence {
  kind: 'ai_assessment'
  sources: ProjectSource[]
  partial: boolean
  writes?: ProjectWriteReceipt[]
}
