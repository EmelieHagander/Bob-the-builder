import type { SolutionMeasurement } from '../data/types'
import { TRUTH_LABELS } from '../data/projectFacts'

export function SolutionEvidence({ items }: { items: SolutionMeasurement[] }) {
  return <div className="fact-details"><h4>Measurements used by this version</h4>
    {!items.length && <p>No measurements linked. Dimensions remain unspecified.</p>}
    {items.map(m => <div key={m.id} className="fact-source">
      <strong>{m.subject} · {m.value === null ? 'Unknown' : m.value + ' ' + m.unit}</strong>
      <span>{TRUTH_LABELS[m.truth]} · Measurement version {m.revision}</span>
      <p>Source: {m.source || 'Not recorded'}</p>
      {(m.latestRevision !== m.revision || m.archived) && <p className="solution-attention">Measurement changed since this version{m.archived ? ' and is now archived' : ''}. The recorded value above is retained.</p>}
    </div>)}
  </div>
}
