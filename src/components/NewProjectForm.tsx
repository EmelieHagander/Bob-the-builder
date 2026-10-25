import { useRef, useState, type FormEvent } from 'react'
import * as db from '../data/database'
import type { Project } from '../data/types'
import { scopeErrorMessage } from '../lib/physicalScope'
import { Field, FormError, inputStyle } from './form'
import { useAsync } from './ui'

const NEW_BUILDING = '__new__'
type Step = 'project' | 'building' | 'link'
const STEP_LABEL: Record<Step, string> = { project: 'Creating…', building: 'Saving building…', link: 'Linking building…' }

/**
 * Start with a name and, optionally, the building the project is in. The
 * existing project editor owns later details; rooms are marked on the
 * Building page. A failed building step never loses the created project.
 */
export function NewProjectForm({ onCreated, onCancel, onProjectSaved }: {
  onCreated: (project: Project) => void
  onCancel?: () => void
  /** The project exists, even if the building step has not finished. */
  onProjectSaved?: (project: Project) => void
}) {
  const connected = db.authEnabled()
  const [name, setName] = useState('')
  const [buildingChoice, setBuildingChoice] = useState('')
  const [buildingName, setBuildingName] = useState('')
  const [busy, setBusy] = useState<Step | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Project | null>(null)
  const [savedBuildingId, setSavedBuildingId] = useState<string | null>(null)
  const newBuildingId = useRef<string | null>(null)
  const [buildingsVersion, setBuildingsVersion] = useState(0)
  const { data: buildings, loading: buildingsLoading, error: buildingsError } = useAsync(
    () => connected ? db.buildingContext.editableBuildings('') : Promise.resolve([]),
    [connected, buildingsVersion],
  )
  const creatingBuilding = buildingChoice === NEW_BUILDING
  const chosenName = creatingBuilding ? buildingName.trim() : buildings?.find(building => building.id === buildingChoice)?.name ?? 'the building'
  const ready = (created || name.trim()) && (!creatingBuilding || buildingName.trim() || savedBuildingId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setError(null)
    let project = created
    let step: Step = 'project'
    try {
      if (!project) {
        setBusy(step)
        project = await db.createProject({ name: name.trim(), description: '', location: '', type: '', theme: 'birch', startLabel: '' })
        setCreated(project)
        onProjectSaved?.(project)
      }
      let buildingId = creatingBuilding ? savedBuildingId : buildingChoice || null
      if (creatingBuilding && !buildingId) {
        step = 'building'; setBusy(step)
        // Reuse one id across retries so a lost reply cannot create a second building.
        newBuildingId.current ??= crypto.randomUUID()
        await db.buildingContext.editBuilding('', 'create', newBuildingId.current, 0, { site_id: null, name: buildingName.trim(), notes: '' })
        buildingId = newBuildingId.current
        setSavedBuildingId(buildingId)
      }
      if (buildingId) {
        step = 'link'; setBusy(step)
        await db.buildingContext.linkCreatedProject(project.id, crypto.randomUUID(), buildingId)
      }
      onCreated(project)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setError(step === 'project' ? reason
        : step === 'building' ? `The building could not be saved: ${reason}`
          : `${chosenName} could not be linked: ${scopeErrorMessage(err, 'building')}`)
      setBusy(null)
    }
  }

  return <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--layout-gap)' }}>
    <Field label="Project name *">
      <input style={inputStyle} value={name} onChange={event => setName(event.target.value)} placeholder="Sommarstugan" required autoFocus readOnly={!!created} />
    </Field>
    {connected && <Field label="Building (optional)">
      <select style={inputStyle} value={buildingChoice} disabled={!!busy || buildingsLoading || !!savedBuildingId} onChange={event => setBuildingChoice(event.target.value)}>
        <option value="">{buildingsLoading ? 'Loading buildings…' : 'Choose later'}</option>
        {(buildings ?? []).map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
        <option value={NEW_BUILDING}>New building…</option>
      </select>
    </Field>}
    {connected && creatingBuilding && <Field label="Building name *">
      <input style={inputStyle} value={buildingName} onChange={event => setBuildingName(event.target.value)} placeholder="Main house" maxLength={200} required readOnly={!!savedBuildingId} />
    </Field>}
    {connected && buildingsError && <div className="cluster">
      <p className="foundation-hint" style={{ margin: 0, flex: 1 }}>Your buildings could not be loaded. You can add a new one or link one later.</p>
      <button type="button" className="btn" onClick={() => setBuildingsVersion(value => value + 1)}>Retry</button>
    </div>}
    <p className="foundation-hint" style={{ margin: 0 }}>
      {connected ? 'Only buildings you can edit are listed. You can add rooms, details and dates later.' : 'You can add details and dates later.'}
    </p>
    {busy && busy !== 'project' && <p className="foundation-hint" role="status" style={{ margin: 0 }}>{STEP_LABEL[busy]}</p>}
    {error && <div role="alert"><FormError>
      {created && <><strong>“{created.name}” was created.</strong>{' '}</>}{error}
      {created && <> You can try again, or open the project and link a building later from Building &amp; spaces.</>}
    </FormError></div>}
    <div className="cluster" style={{ justifyContent: 'flex-end' }}>
      {created
        ? buildingChoice && <button type="button" className="btn" onClick={() => onCreated(created)} disabled={!!busy}>Open project</button>
        : onCancel && <button type="button" className="btn" onClick={onCancel} disabled={!!busy}>Cancel</button>}
      <button type="submit" className="btn btn-primary" disabled={!ready || !!busy}>
        {busy ? STEP_LABEL[busy] : created ? buildingChoice ? 'Try again' : 'Open project' : 'Create project'}
      </button>
    </div>
  </form>
}
