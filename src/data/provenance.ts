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
  dataset: 'project' | 'areas' | 'tasks' | 'measurements' | 'artifacts' | 'building_context' | 'catalog' | 'plan' | 'solutions' | 'target' | 'media' | 'stock' | 'requirements' | 'cut_plans' | 'materials' | 'events'
  recordId: string
  label: string
  /** reused is permitted only for an unchanged catalog definition. */
  operation: 'created' | 'updated' | 'reused' | 'deleted'
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
  references?: ReferenceEvidence[]
  /** Caller-hydrated entry focus; retained with the owner's answer, never shared chat. */
  currentView?: import('../domain/bobScreen.ts').CurrentView
}
export interface ReferenceEvidence { id:string;title:string;url:string;version:string;reviewedAt:string }
