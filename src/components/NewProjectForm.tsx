import { useState, type FormEvent } from 'react'
import * as db from '../data/database'
import type { Project } from '../data/types'
import { Field, FormError, inputStyle } from './form'

/** Start with a name; the existing project editor owns later details. */
export function NewProjectForm({ onCreated, onCancel }: {
  onCreated: (project: Project) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const project = await db.createProject({ name: name.trim(), description: '', location: '', type: '', theme: 'birch', startLabel: '' })
      onCreated(project)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <Field label="Project name *">
      <input style={inputStyle} value={name} onChange={event => setName(event.target.value)} placeholder="Sommarstugan" required autoFocus />
    </Field>
    <p className="foundation-hint" style={{ margin: 0 }}>You can add details and dates later from the project’s menu.</p>
    {error && <FormError>{error}</FormError>}
    <div className="cluster" style={{ justifyContent: 'flex-end' }}>
      {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>}
      <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>{busy ? 'Creating…' : 'Create project'}</button>
    </div>
  </form>
}
