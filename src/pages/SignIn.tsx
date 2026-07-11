import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../data/database'
import { Icon } from '../components/ui'

const inputStyle = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 10,
  background: 'var(--surface)',
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--ink)',
  outline: 'none',
} as const

/**
 * Sign in with a magic link (recommended for the crew) or email + password.
 * Invited emails claim their person on the crew list; anyone else joins as a
 * fresh Volunteer — both handled server-side by bob.join_project().
 */
export function SignIn() {
  const navigate = useNavigate()
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
    run(async () => {
      await db.signInWithMagicLink(email.trim())
      setNotice(`Link sent! Check ${email.trim()} and click it to sign in.`)
    })
  }

  function passwordSignIn() {
    run(async () => {
      await db.signInWithPassword(email.trim(), password)
      navigate('/')
    })
  }

  function passwordSignUp() {
    run(async () => {
      const ready = await db.signUpWithPassword(email.trim(), password)
      if (ready) navigate('/')
      else setNotice(`Account created — check ${email.trim()} to confirm it, then sign in.`)
    })
  }

  return (
    <div className="page" style={{ display: 'flex', justifyContent: 'center' }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, padding: 26, marginTop: 40, height: 'fit-content' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="hand-waving" weight="fill" size={24} color="var(--accent)" />
          <div>
            <h1 style={{ fontSize: 20, margin: 0 }}>Sign in to bob</h1>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '2px 0 0' }}>
              Invited? Use the email your organiser has for you and your profile is waiting.
              New? You'll join the crew as a volunteer.
            </p>
          </div>
        </div>

        <form onSubmit={magicLink} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 5 }}>Email</div>
            <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.se" autoFocus />
          </div>
          <button type="submit" className="btn btn-primary" disabled={!email.trim() || busy} style={{ padding: '11px 0', fontSize: 14 }}>
            <Icon name="paper-plane-tilt" size={15} /> Send me a magic link
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0', color: 'var(--ink-faint)', fontSize: 12 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--line)' }} /> or with a password <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 5 }}>Password</div>
            <input
              style={inputStyle}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={(e) => { if (e.key === 'Enter' && email.trim() && password) passwordSignIn() }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={!email.trim() || !password || busy} onClick={passwordSignIn} style={{ flex: 1, padding: '11px 0', fontSize: 14 }}>
              Sign in
            </button>
            <button type="button" className="btn" disabled={!email.trim() || !password || busy} onClick={passwordSignUp} style={{ flex: 1, padding: '11px 0', fontSize: 14 }}>
              Create account
            </button>
          </div>
        </div>

        {notice && (
          <div style={{ marginTop: 14, background: 'var(--leaf-bg, #e6efdc)', border: '1px solid #c4d6ab', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#3f5c22' }}>
            {notice}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 14, background: 'var(--clay-bg)', border: '1px solid #e0b3a8', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#8a3b2b' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
