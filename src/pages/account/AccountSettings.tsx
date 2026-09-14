/*
 * The existing shared account and its notes belong to one explicitly selected
 * household. Project invitations never grant access to these settings.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../../data/database'
import { Icon, Loading, useAsync } from '../../components/ui'
import { Field, FormError, inputStyle } from '../../components/form'
import { InstallSettingsCard } from '../../components/InstallSettingsCard'

export function AccountSettings() {
  const [version, setVersion] = useState(0)
  const { data: account, loading, error: loadError } = useAsync(() => db.getAccount(), [version])
  const [form, setForm] = useState<db.AccountUpdate | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setForm(account ? { name: account.name, ownerName: account.ownerName, email: account.email } : null)
  }, [account])

  const set = (patch: Partial<db.AccountUpdate>) => {
    setSaved(false)
    setForm((current) => (current ? { ...current, ...patch } : current))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form || !form.name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await db.updateAccount({ name: form.name.trim(), ownerName: form.ownerName.trim(), email: form.email.trim() })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Account settings</h1>
          <p className="page-sub">Household details and shared account notes.</p>
        </div>
        <div className="cluster no-print">
          <Link to="/account" className="btn">
            <Icon name="arrow-left" size={15} /> Account
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 520, marginTop: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <InstallSettingsCard />
        <div className="card" style={{ padding: 20 }}>
          {loading ? (
            <Loading />
          ) : loadError ? <div role="alert"><p>Could not load household settings.</p><button className="btn" onClick={() => setVersion(value => value + 1)}>Try again</button></div>
          : !form ? <HouseholdAccountSetup onBound={() => setVersion(value => value + 1)} /> : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Account name *">
                <input style={inputStyle} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Skogsfolket" />
              </Field>
              <Field label="Your name">
                <input style={inputStyle} value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />
              </Field>
              <Field label="Email">
                <input style={inputStyle} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
              </Field>
              {error && <FormError>{error}</FormError>}
              <div className="cluster" style={{ justifyContent: 'flex-end' }}>
                {saved && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: 'var(--leaf)' }}>
                    <Icon name="check-circle" weight="fill" size={16} /> Saved
                  </span>
                )}
                <button type="submit" className="btn btn-primary" disabled={!form.name.trim() || busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="card" style={{ padding: 16, display: 'flex', gap: 10 }}>
          <Icon name="info" weight="fill" size={18} color="var(--accent-2)" style={{ marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            {db.authEnabled()
              ? 'These account settings and notes are shared only with the selected household. A project invitation gives access to that project and its building context.'
              : ' Right now the app is running on demo data, so changes last until you reload the page.'}
          </div>
        </div>
      </div>
    </div>
  )
}

function HouseholdAccountSetup({ onBound }: { onBound: () => void }) {
  const [retry, setRetry] = useState(0)
  const { data, loading, error: directoryError } = useAsync(() => db.sharing.directory(), [retry])
  const [householdId, setHouseholdId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function bind(event: FormEvent) {
    event.preventDefault()
    if (!householdId || busy) return
    setBusy(true); setError('')
    try {
      await db.bindAccountHousehold(householdId)
      onBound()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }
  if (loading) return <Loading label="Loading your households…" />
  if (directoryError) return <div role="alert"><p>{directoryError.message}</p><button className="btn" onClick={() => setRetry(value => value + 1)}>Try again</button></div>
  return <form onSubmit={bind} className="grid">
    <h2>Household account</h2>
    <p className="foundation-hint">You do not currently have access to shared account settings. If this account has not been set up, choose which of your households should own its settings and notes. This choice does not share any buildings or projects.</p>
    {(data?.households.length ?? 0) > 0 ? <>
      <Field label="Household for account settings">
        <select style={inputStyle} value={householdId} disabled={busy} onChange={event => setHouseholdId(event.target.value)} required>
          <option value="">Choose a household</option>
          {data!.households.map(household => <option key={household.id} value={household.id}>{household.name}</option>)}
        </select>
      </Field>
      <p className="foundation-hint">An existing household account cannot be reassigned here. Project collaborators can still use their own projects.</p>
      <button className="btn btn-primary" type="submit" disabled={!householdId || busy}>{busy ? 'Saving…' : 'Set up household account'}</button>
    </> : <p className="foundation-hint">No active household is connected to this login. You can still collaborate on projects you are invited to.</p>}
    {error && <FormError>{error}</FormError>}
  </form>
}
