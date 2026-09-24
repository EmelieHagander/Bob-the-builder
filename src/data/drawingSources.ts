/** Freshness is separate from the saved Concept/Measured/Build ready decision. */
export interface DrawingSourceStatus {
  source_state: 'current' | 'changed' | 'unavailable'
  source_reasons: string[]
}
