import { Link } from 'react-router-dom'
import type { ProjectWriteReceipt } from '../data/provenance'

/** Persisted server receipts, not a success inference from Bob's generated text. */
export function BobWriteReceipts({ receipts, onOpenDrawing }: { receipts?: ProjectWriteReceipt[]; onOpenDrawing?: () => void }) {
  if (!receipts?.length) return null
  const reuseOnly = receipts.every(receipt => receipt.dataset === 'catalog' && receipt.operation === 'reused')
  return <div aria-label="Saved project changes" style={{ marginTop: 10, padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 }}>
    <strong>{reuseOnly ? 'Reused existing definitions' : 'Saved to project'}</strong>
    <ul style={{ margin: '5px 0', paddingLeft: 17 }}>{receipts.map(receipt =>
      <li key={`${receipt.dataset}:${receipt.recordId}:${receipt.revision ?? ''}:${receipt.savedAt}`}><strong>{receipt.label}</strong> · {receipt.operation}
        {receipt.dataset === 'catalog' && receipt.revision && <span> · Definition v{receipt.revision}</span>}
        {receipt.dataset === 'building_context' && <span> · <Link onClick={onOpenDrawing} to={`/building?building=${encodeURIComponent(receipt.recordId)}`}>Open building context</Link></span>}
        {receipt.dataset === 'artifacts' && receipt.revision && <span> · <Link onClick={onOpenDrawing}
          to={`/artifacts?drawing=${encodeURIComponent(receipt.recordId)}&revision=${receipt.revision}${receipt.areaId ? `&area=${encodeURIComponent(receipt.areaId)}` : ''}`}>Open drawing · v{receipt.revision}</Link></span>}
      </li>,
    )}</ul>
    <div style={{ color: 'var(--ink-soft)', fontSize: 11.5 }}>Saved records are not a verification of measurements, safety or readiness.</div>
  </div>
}
