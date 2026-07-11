import { useState, type FormEvent } from 'react'
import * as db from '../data/database'
import type { ThemeName } from '../data/types'
import { Icon } from '../components/ui'
import { Field, FormError, inputStyle } from '../components/form'

const THEMES: { name: ThemeName; label: string }[] = [
  { name: 'birch', label: 'Birch' },
  { name: 'forest', label: 'Forest' },
  { name: 'dusk', label: 'Dusk' },
]

/**
 * Shown when the database has no project yet (fresh install, or right after
 * removing the demo data). Creating one is only possible while the database
 * is empty — see db/migrations/0004.
 */
export function StartProject({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [type, setType] = useState('')
  const [theme, setTheme] = useState<ThemeName>('birch')
  const [startLabel, setStartLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const project = await db.createProject({
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
        type: type.trim(),
        theme,
        startLabel: startLabel.trim(),
      })
      db.setActiveProject(project.id)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 480, padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="tree-evergreen" weight="fill" size={26} color="var(--accent)" />
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Welcome to bob</h1>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '2px 0 0' }}>
              No project here yet — let's start yours.
            </p>
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
          <Field label="Project name *">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sommarstugan" autoFocus />
          </Field>
          <Field label="What are you building?">
            <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A one-sentence description" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Location">
              <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Town, Country" />
            </Field>
            <Field label="Type">
              <input style={inputStyle} value={type} onChange={(e) => setType(e.target.value)} placeholder="House extension" />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="First build day">
              <input style={inputStyle} value={startLabel} onChange={(e) => setStartLabel(e.target.value)} placeholder="Sat 1 Aug" />
            </Field>
            <Field label="Theme">
              <div style={{ display: 'flex', gap: 6 }}>
                {THEMES.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      setTheme(t.name)
                      document.documentElement.setAttribute('data-theme', t.name)
                    }}
                    className="btn"
                    style={{
                      flex: 1,
                      padding: '9px 0',
                      fontSize: 12.5,
                      border: theme === t.name ? '2px solid var(--accent)' : '1px solid var(--line)',
                      fontWeight: theme === t.name ? 800 : 600,
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {error && <FormError>{error}</FormError>}

          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy} style={{ padding: '12px 0', fontSize: 14.5 }}>
            {busy ? 'Creating…' : 'Start the project'}
          </button>
        </form>
      </div>
    </div>
  )
}
