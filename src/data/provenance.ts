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

export interface AnswerEvidence {
  kind: 'ai_assessment'
  sources: ProjectSource[]
  partial: boolean
}
