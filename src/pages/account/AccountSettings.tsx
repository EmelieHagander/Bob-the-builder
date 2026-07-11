/*
 * Account settings: who this account is. One account per install — there is
 * no auth yet, so this is identity for the crew, not access control.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../../data/database'
import { Icon, Loading, useAsync } from '../../components/ui'
import { Field, FormError, inputStyle } from '../../components/form'

export function AccountSettings() {
  const { data: account, loading } = useAsync(() => db.getAccount(), [])
  const [form, setForm] = useState<db.AccountUpdate | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (account) setForm({ name: account.name, ownerName: account.ownerName, email: account.email })
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
          <p className="page-sub">Who this account is — shown across the account level.</p>
        </div>
        <div className="cluster no-print">
          <Link to="/account" className="btn">
            <Icon name="arrow-left" size={15} /> Account
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 520, marginTop: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          {loading || !form ? (
            <Loading />
          ) : (
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
            Everyone on the crew shares this one account.
            {db.authEnabled()
              ? ' Changes here need a signed-in member — anyone with the link can join from the sign-in page.'
              : ' Right now the app is running on demo data, so changes last until you reload the page.'}
          </div>
        </div>
      </div>
    </div>
  )
}
