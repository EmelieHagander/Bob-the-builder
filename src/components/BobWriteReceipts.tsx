import { Link } from 'react-router-dom'
import type { ProjectWriteReceipt } from '../data/provenance'

/** Useful navigation from verified receipts; save diagnostics stay out of chat. */
export function BobWriteReceipts({ receipts, onOpenDrawing }: { receipts?: ProjectWriteReceipt[]; onOpenDrawing?: () => void }) {
  const links = receipts?.filter(receipt => receipt.dataset === 'building_context' || (receipt.dataset === 'artifacts' && receipt.revision))
  if (!links?.length) return null
  return <div className="bob-saved-links">{links.map(receipt =>
    <Link key={`${receipt.dataset}:${receipt.recordId}:${receipt.revision ?? ''}:${receipt.savedAt}`}
      onClick={onOpenDrawing} title={receipt.label}
      to={receipt.dataset === 'building_context'
        ? `/building?building=${encodeURIComponent(receipt.recordId)}`
        : `/artifacts?drawing=${encodeURIComponent(receipt.recordId)}&revision=${receipt.revision}${receipt.areaId ? `&area=${encodeURIComponent(receipt.areaId)}` : ''}`}>
      {receipt.dataset === 'building_context' ? 'Open building context' : `Open drawing · v${receipt.revision}`}
    </Link>,
  )}</div>
}
