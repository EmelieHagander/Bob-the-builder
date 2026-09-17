import type { ProjectWriteReceipt } from '../data/provenance'

/** Persisted server receipts, not a success inference from Bob's generated text. */
export function BobWriteReceipts({ receipts }: { receipts?: ProjectWriteReceipt[] }) {
  if (!receipts?.length) return null
  return <div aria-label="Saved project changes" style={{ marginTop: 10, padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 }}>
    <strong>Saved to project</strong>
    <ul style={{ margin: '5px 0', paddingLeft: 17 }}>{receipts.map(receipt =>
      <li key={`${receipt.dataset}:${receipt.recordId}`}><strong>{receipt.label}</strong> · {receipt.operation}</li>,
    )}</ul>
    <div style={{ color: 'var(--ink-soft)', fontSize: 11.5 }}>Saved records are not a verification of measurements, safety or readiness.</div>
  </div>
}
