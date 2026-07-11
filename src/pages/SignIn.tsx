import { useState, type FormEvent } from 'react'
import * as db from '../data/database'
import { Icon } from '../components/ui'
import { Field, FormError, inputStyle } from '../components/form'

/**
 * The sign-in screen. Stands alone — the app renders it INSTEAD of the shell
 * while signed out, so there is no sidebar or menu to wander off into.
 *
 * Three ways in, all ending on the account dashboard:
 *   * magic link (recommended for the crew)
 *   * email + password
 *   * the shared guest account, one click, no email
 * Invited emails claim their person on the crew list; anyone else joins as a
 * fresh Volunteer — both handled server-side by bob.join_project().
 */
export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function magicLink(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    void run(async () => {
      await db.signInWithMagicLink(email.trim())
      setNotice(`Link sent! Check ${email.trim()} and click it to sign in.`)
    })
  }

  // Successful sign-ins need no navigation here: the session change flips the
  // gate in App, which lands on /account.
  const passwordSignIn = () => void run(() => db.signInWithPassword(email.trim(), password))
  const guestSignIn = () => void run(() => db.signInAsGuest())

  function passwordSignUp() {
    void run(async () => {
      const ready = await db.signUpWithPassword(email.trim(), password)
      if (!ready) setNotice(`Account created — check ${email.trim()} to confirm it, then sign in.`)
    })
  }

  const divider = (label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0', color: 'var(--ink-faint)', fontSize: 12 }}>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} /> {label}{' '}
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, marginBottom: 18 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="tree-evergreen" weight="fill" size={25} color="var(--accent)" />
          </div>
          <div style={{ lineHeight: 1 }}>
            <div className="font-display" style={{ fontWeight: 800, fontSize: 28 }}>bob</div>
            <div style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginTop: 3 }}>build crew</div>
          </div>
        </div>

        <div className="card" style={{ padding: 26 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Sign in</h1>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '4px 0 0' }}>
            Invited? Use the email your organiser has for you and your profile is waiting. New? You'll join the crew as a volunteer.
          </p>

          <form onSubmit={magicLink} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
            <Field label="Email">
              <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.se" autoFocus />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={!email.trim() || busy} style={{ padding: '11px 0', fontSize: 14, justifyContent: 'center' }}>
              <Icon name="paper-plane-tilt" size={15} /> Send me a magic link
            </button>
          </form>

          {divider('or with a password')}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Password">
              <input
                style={inputStyle}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email.trim() && password) passwordSignIn()
                }}
              />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" disabled={!email.trim() || !password || busy} onClick={passwordSignIn} style={{ flex: 1, padding: '11px 0', fontSize: 14, justifyContent: 'center' }}>
                Sign in
              </button>
              <button type="button" className="btn" disabled={!email.trim() || !password || busy} onClick={passwordSignUp} style={{ flex: 1, padding: '11px 0', fontSize: 14, justifyContent: 'center' }}>
                Create account
              </button>
            </div>
          </div>

          {divider('or')}

          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={guestSignIn}
            style={{ width: '100%', padding: '11px 0', fontSize: 14, justifyContent: 'center' }}
          >
            <Icon name="footprints" size={16} /> Continue as guest
          </button>
          <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '8px 0 0', textAlign: 'center' }}>
            One shared guest profile — have a look around without an email.
          </p>

          {notice && (
            <div style={{ marginTop: 14, background: 'var(--leaf-bg)', border: '1px solid #c4d6ab', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#3f5c22' }}>
              {notice}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 14 }}>
              <FormError>{error}</FormError>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
