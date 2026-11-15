import { useEffect, useState } from 'react'
import { Icon } from './ui'
import type { ShareOutcome } from '../lib/share'

const NOTICE: Partial<Record<ShareOutcome, string>> = { copied: 'Copied', saved: 'Saved', failed: 'Could not share' }

/** One share action: the phone's share sheet, or the fallback the helper chose, confirmed in a word. */
export function ShareButton({ label, onShare, compact = false }: { label: string; onShare: () => Promise<ShareOutcome>; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null)
  useEffect(() => { if (!outcome) return; const t = setTimeout(() => setOutcome(null), 2500); return () => clearTimeout(t) }, [outcome])
  const notice = outcome ? NOTICE[outcome] : undefined
  return <button type="button" className="btn" disabled={busy} aria-label={compact ? label : undefined}
    onClick={async () => { setBusy(true); try { setOutcome(await onShare()) } finally { setBusy(false) } }}>
    <Icon name="share-network" size={15} />{!compact && ' Share'}
    <span aria-live="polite">{notice ? ` ${notice}` : ''}</span>
  </button>
}
