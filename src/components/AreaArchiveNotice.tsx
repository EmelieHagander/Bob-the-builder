import { useState } from 'react'
import * as db from '../data/database'
import type { Area } from '../data/types'
import { FormError } from './form'

export function AreaArchiveNotice({ area, onChanged }: { area: Area; onChanged: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (!area.archivedAt) return null
  async function restore() {
    setBusy(true); setError('')
    try { await db.setAreaArchived(area, false); onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <section className="solution-attention" aria-label="Archived Area">
    <strong>Archived Area</strong>
    <p>Completed work and reference records are kept. Restore this Area before adding or reopening work.</p>
    <button className="btn" disabled={busy} onClick={() => void restore()}>{busy ? 'Restoring…' : 'Restore Area'}</button>
    {error && <FormError>{error}</FormError>}
  </section>
}
