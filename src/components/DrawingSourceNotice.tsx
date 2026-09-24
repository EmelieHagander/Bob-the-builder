import type { DrawingSourceStatus } from '../data/drawingSources'

const reasons: Record<string, string> = {
  target_changed: 'Selected design changed',
  measurements_changed: 'Linked measurements changed',
  physical_source_changed: 'Physical sources changed or await review',
  drawing_source_changed: 'Source drawing changed',
}

export function DrawingSourceNotice({ source }: { source?: DrawingSourceStatus }) {
  if (source?.source_state === 'current') return null
  return <div className="solution-attention" role="status">
    <strong>{source?.source_state === 'changed' ? 'Sources changed — review drawing' : 'Sources unavailable — check before use'}</strong>
    <p className="foundation-hint">{source?.source_reasons?.map(code => reasons[code]).filter(Boolean).join('. ') || 'Source freshness could not be confirmed.'} The saved classification describes this revision when it was recorded.</p>
  </div>
}
