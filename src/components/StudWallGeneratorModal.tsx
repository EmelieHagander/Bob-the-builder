import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { Area, ArtifactMeasurement, ArtifactVersion, PhysicalSpace, SelectedTarget } from '../data/types'
import { describeMeasurement, TRUTH_LABELS } from '../data/projectFacts'
import { generateStudWallGeometry, STUD_WALL_ROLES, type StudWallInputs, type StudWallRole } from '../lib/artifactGeometry'
import { Field, FormError, inputStyle } from './form'
import { Modal } from './Modal'
import { Loading, useAsync } from './ui'
import { STUD_WALL_ROLE_LABELS, StudWallPreview } from './StudWallPreview'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

function MeasurementPicker({ projectId, role, onPick, onClose }: {
  projectId: string
  role: StudWallRole
  onPick: (measurement: ArtifactMeasurement) => void
  onClose: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(() => db.getProjectFacts(projectId, 'measurement', {}, offset), [projectId, offset, attempt])
  return <Modal title={`Choose ${STUD_WALL_ROLE_LABELS[role].toLowerCase()}`} onClose={onClose}>
    {loading ? <Loading /> : error ? <div role="alert"><FormError>{error.message}</FormError>
      <button className="btn" onClick={() => setAttempt(value => value + 1)}>Reload measurements</button></div> : <>
      {!data?.items.length && <p>No active measurements here. Record them in Measurements & existing parts first.</p>}
      <div className="fact-list">{data?.items.map(item => item.kind === 'measurement' && <article className="card fact-card" key={item.id}>
        <h4>{item.subject}</h4>
        <p>{describeMeasurement(item)} · {TRUTH_LABELS[item.truth]} · Version {item.revision}</p>
        <p className="foundation-hint">{item.source || 'No source recorded'}</p>
        <button className="btn" disabled={item.truth === 'unknown' || item.value === null} onClick={() => onPick({
          id: item.id, revision: item.revision, subject: item.subject, value: item.value, unit: item.unit,
          truth: item.truth, source: item.source, latestRevision: item.revision, archived: item.archived,
        })}>{item.truth === 'unknown' || item.value === null ? 'Needs a value first' : 'Use measurement'}</button>
      </article>)}</div>
      <div className="foundation-actions">
        {offset > 0 && <button className="btn" onClick={() => setOffset(value => Math.max(0, value - 24))}>Previous page</button>}
        {data?.hasMore && <button className="btn" onClick={() => setOffset(value => value + 24)}>Next page</button>}
      </div>
    </>}
  </Modal>
}

function buildInputMap(items: ArtifactMeasurement[]): Partial<Record<StudWallRole, ArtifactMeasurement>> {
  const mapped: Partial<Record<StudWallRole, ArtifactMeasurement>> = {}
  for (const item of items) {
    const role = (item as ArtifactMeasurement & { role?: StudWallRole }).role
    if (role) mapped[role] = item
  }
  return mapped
}

export function StudWallGeneratorModal({ projectId, target, areas, initialArea, value, onClose, onSaved }: {
  projectId: string
  target: SelectedTarget
  areas: Area[]
  initialArea: string
  value?: ArtifactVersion
  onClose: () => void
  onSaved: () => void
}) {
  const generated = value?.generation ?? null
  const [id] = useState(() => value?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(value?.title ?? 'Stud wall elevation')
  const [description, setDescription] = useState(value?.description ?? 'Deterministic wall elevation from pinned project measurements.')
  const [assumptions, setAssumptions] = useState(value?.assumptions ?? 'Opening-edge framing is conceptual. Header capacity and load paths require project-specific judgement.')
  const [area, setArea] = useState(value?.areaId ?? initialArea)
  const [spaceId, setSpaceId] = useState(generated?.spaceId ?? '')
  const [spacing, setSpacing] = useState(String(generated?.studSpacingMm ?? 600))
  const [status, setStatus] = useState<ArtifactVersion['status']>(value?.status ?? 'concept')
  const [reason, setReason] = useState('')
  const [inputs, setInputs] = useState<Partial<Record<StudWallRole, ArtifactMeasurement>>>(() => generated ? buildInputMap(generated.inputs) : {})
  const [picker, setPicker] = useState<StudWallRole | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const selectedTarget = target.solution

  const physical = useAsync(async () => {
    const [buildings, spaces] = await Promise.all([
      db.buildingContext.projectBuildings(projectId),
      db.buildingContext.projectSpaces(projectId),
    ])
    return { buildings, spaces }
  }, [projectId, attempt])

  const spaces = physical.data?.spaces ?? []
  const buildingNames = new Map((physical.data?.buildings ?? []).map(building => [building.id, building.name]))
  const selectedSpace = spaces.find(space => space.id === spaceId) ?? null
  const anyEstimate = STUD_WALL_ROLES.some(role => inputs[role]?.truth === 'estimated')
  const complete = STUD_WALL_ROLES.every(role => Boolean(inputs[role]))

  const preview = useMemo(() => {
    if (!complete) return { geometry: null, error: '' }
    const studSpacing = Number(spacing)
    try {
      const mapped = Object.fromEntries(STUD_WALL_ROLES.map(role => [role, inputs[role]!])) as StudWallInputs
      return { geometry: generateStudWallGeometry(mapped, studSpacing), error: '' }
    } catch (err) { return { geometry: null, error: message(err) } }
  }, [complete, inputs, spacing])

  const choose = (role: StudWallRole, measurement: ArtifactMeasurement) => {
    setInputs(current => {
      const next = { ...current }
      for (const other of STUD_WALL_ROLES) if (other !== role && next[other]?.id === measurement.id) delete next[other]
      next[role] = measurement
      return next
    })
    if (measurement.truth === 'estimated') setStatus('concept')
    setPicker(null)
  }

  return <Modal title={value ? 'Regenerate wall elevation' : 'Generate wall elevation'} wide onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (busy || !selectedTarget || !selectedSpace || !preview.geometry || !complete) return
      setBusy(true); setError('')
      try {
        await db.editProjectArtifact(projectId, value ? 'regenerate' : 'generate', id, value?.revision ?? 0, {
          title,
          description,
          status: anyEstimate ? 'concept' : status,
          assumptions,
          source_media_id: value?.imageId ?? null,
          target_revision: target.decision.revision,
          building_id: selectedSpace.buildingId,
          space_id: selectedSpace.id,
          space_revision: selectedSpace.revision,
          stud_spacing_mm: Number(spacing),
          inputs: Object.fromEntries(STUD_WALL_ROLES.map(role => [role, { id: inputs[role]!.id, revision: inputs[role]!.revision }])),
          ...(value ? { change_note: reason } : { area_id: area || null }),
        })
        onSaved()
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <fieldset className="foundation-form fact-fieldset" disabled={busy}>
        <div className="fact-source">
          <strong>Selected project target</strong>
          <p>{selectedTarget ? `${selectedTarget.title} · Version ${selectedTarget.revision}` : 'No target selected'}</p>
          <span>Target decision {target.decision.revision}. The server rejects the save if that decision changes while this form is open.</span>
        </div>

        <Field label="Drawing title"><input style={inputStyle} required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></Field>
        {!value && <Field label="Area"><select style={inputStyle} value={area} onChange={event => setArea(event.target.value)}>
          <option value="">Project as a whole</option>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        <Field label="What this drawing shows"><textarea style={inputStyle} required rows={2} maxLength={6000} value={description} onChange={event => setDescription(event.target.value)} /></Field>
        <Field label="Assumptions and limits"><textarea style={inputStyle} rows={3} maxLength={4000} value={assumptions} onChange={event => setAssumptions(event.target.value)} /></Field>

        <div className="fact-source">
          <strong>Physical target</strong>
          {physical.loading ? <Loading /> : physical.error ? <div role="alert"><FormError>{physical.error.message}</FormError>
            <button className="btn" type="button" onClick={() => setAttempt(value => value + 1)}>Reload building context</button></div> : <>
            <Field label="Space"><select style={inputStyle} required value={spaceId} onChange={event => setSpaceId(event.target.value)}>
              <option value="">Choose a project space</option>
              {spaces.map(space => <option key={space.id} value={space.id}>{buildingNames.get(space.buildingId) ?? 'Building'} · {space.name}</option>)}
            </select></Field>
            {!spaces.length && <p>No project-scoped Space is available. <Link to="/building">Open Building & spaces</Link> to create/link one first.</p>}
            {selectedSpace && <p className="foundation-hint">Accepted Space version {selectedSpace.revision}{selectedSpace.hasProposal ? ' · a newer proposal also exists, but generation uses accepted truth only' : ''}.</p>}
          </>}
        </div>

        <div className="fact-source">
          <strong>Geometry inputs</strong>
          <p className="foundation-hint">Map each role to one exact saved measurement version. A measurement cannot fill two roles.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            {STUD_WALL_ROLES.map(role => {
              const item = inputs[role]
              return <div key={role} className="card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}><strong>{STUD_WALL_ROLE_LABELS[role]}</strong>
                    {item ? <><div>{item.subject} · {item.value} {item.unit} · {TRUTH_LABELS[item.truth]} · v{item.revision}</div>
                      {item.latestRevision !== item.revision && <p className="solution-attention">A newer measurement version exists. This selection still pins version {item.revision}.</p>}</>
                      : <div className="foundation-hint">Not mapped yet</div>}</div>
                  <button type="button" className="btn" onClick={() => setPicker(role)}>{item ? 'Change' : 'Choose'}</button>
                </div>
              </div>
            })}
          </div>
        </div>

        <div className="fact-filters">
          <Field label="Stud spacing (mm)"><input style={inputStyle} type="number" inputMode="numeric" min={200} max={1200} step={1}
            required value={spacing} onChange={event => setSpacing(event.target.value)} /></Field>
          <Field label="Drawing status"><select style={inputStyle} value={anyEstimate ? 'concept' : status}
            onChange={event => setStatus(event.target.value as ArtifactVersion['status'])}>
            <option value="concept">Concept</option>
            <option value="measured" disabled={anyEstimate}>Measured</option>
            <option value="build_ready" disabled={anyEstimate}>Build ready</option>
          </select></Field>
        </div>
        <p className="foundation-hint">Stud spacing is an explicit project design parameter. Bob does not choose it from generic construction knowledge.</p>
        {anyEstimate && <p className="solution-attention">At least one geometry input is estimated, so this generated version must remain Concept until those dimensions are verified.</p>}

        <div className="fact-source"><strong>Deterministic preview</strong>
          {!complete ? <p>Choose all six geometry inputs to preview the elevation.</p>
            : preview.error ? <div role="alert"><FormError>{preview.error}</FormError></div>
              : preview.geometry && <StudWallPreview geometry={preview.geometry} />}
        </div>

        {value && <Field label="Reason for regeneration"><input style={inputStyle} required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></Field>}
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        <div className="foundation-actions"><button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!selectedTarget || !selectedSpace || !preview.geometry || Boolean(preview.error)}>
            {busy ? 'Saving and reading back…' : value ? 'Save regenerated version' : 'Save generated drawing'}
          </button></div>
      </fieldset>
    </form>
    {picker && <MeasurementPicker projectId={projectId} role={picker} onClose={() => setPicker(null)} onPick={measurement => choose(picker, measurement)} />}
  </Modal>
}

export function currentSpaceForGeneration(spaces: PhysicalSpace[], value: ArtifactVersion) {
  const generation = value.generation
  return generation ? spaces.find(space => space.id === generation.spaceId) ?? null : null
}
