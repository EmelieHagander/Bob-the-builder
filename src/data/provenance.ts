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
  dataset: 'project' | 'tasks' | 'measurements' | 'artifacts' | 'building_context' | 'catalog'
  recordId: string
  label: string
  /** reused is permitted only for an unchanged catalog definition. */
  operation: 'created' | 'updated' | 'reused'
  savedAt: string
  /** Drawing and catalog receipts pin an exact saved revision. */
  revision?: number
  areaId?: string | null
}

export interface AnswerEvidence {
  kind: 'ai_assessment'
  sources: ProjectSource[]
  partial: boolean
  writes?: ProjectWriteReceipt[]
}
