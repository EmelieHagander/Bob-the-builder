import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type { Area, ProjectFact, FactKind, ExistingComponent } from '../data/types'
import { describeMeasurement, INTENT_LABELS, TRUTH_LABELS, parseLength } from '../data/projectFacts'
import type { LengthUnit, MeasurementTruth, ComponentIntent } from '../data/projectFacts'
import { Field, FormError, inputStyle } from '../components/form'
import { Modal } from '../components/Modal'
import { Icon, Loading, useAsync } from '../components/ui'
import { ProjectImages, StoredImage } from '../components/ProjectImages'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const name = (record: ProjectFact) => record.kind === 'measurement' ? record.subject : record.name

function SourceImage({ projectId, imageId, title }: { projectId: string; imageId: string | null; title: string }) {
  const [open, setOpen] = useState(false)
  if (!imageId) return title ? <p className="foundation-hint">Source image removed: {title}</p> : null
  return <>
    <button type="button" className="btn" onClick={() => setOpen(true)}>View source image</button>
    {open && <Modal title={title} wide onClose={() => setOpen(false)}>
      <StoredImage projectId={projectId} image={{ id: imageId, title }} original />
    </Modal>}
  </>
}

function FactSummary({ record }: { record: ProjectFact }) {
  return <div className="fact-summary">
    {record.kind === 'measurement' ? <>
      <strong>{describeMeasurement(record)}</strong>
      <span className="image-purpose">{TRUTH_LABELS[record.truth]}</span>
      {record.required && <span className="image-purpose">Required</span>}
    </> : <>
      <strong>{record.quantity === null ? 'Count unknown' : record.quantity + ' item' + (record.quantity === 1 ? '' : 's')}</strong>
      <span className="image-purpose">{INTENT_LABELS[record.intent]}</span>
      {record.componentKind && <span>{record.componentKind}</span>}
    </>}
    {record.archived && <span className="image-purpose">Archived</span>}
  </div>
}

function FactDetails({ record }: { record: ProjectFact }) {
  return <div className="fact-details">
    {record.kind === 'measurement' ? <p><strong>Source:</strong> {record.source || 'Not recorded'}</p> : <>
      <p><strong>Observed condition:</strong> {record.condition || 'Unknown'}</p>
      <p><strong>Specification:</strong> {record.specification || 'Not recorded'}</p>
    </>}
    {record.notes && <p><strong>Notes:</strong> {record.notes}</p>}
    <p className="foundation-hint">Recorded by {record.actor} · {new Date(record.recordedAt).toLocaleString()}</p>
    <SourceImage projectId={record.projectId} imageId={record.sourceImageId} title={record.sourceImageTitle} />
  </div>
}

function FactEditor({ projectId, kind, record, areas, initialArea, component, onClose, onSaved }: {
  projectId: string; kind: FactKind; record?: ProjectFact; areas: Area[]; initialArea: string
  component?: ExistingComponent; onClose: () => void; onSaved: () => void
}) {
  const measurement = record?.kind === 'measurement' ? record : undefined
  const part = record?.kind === 'component' ? record : undefined
  const [id] = useState(() => record?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(record ? name(record) : '')
  const [areaId, setAreaId] = useState(record ? record.areaId ?? '' : component ? component.areaId ?? '' : initialArea)
  const [length, setLength] = useState(measurement?.value ?? '')
  const [unit, setUnit] = useState<LengthUnit>(measurement?.unit ?? 'mm')
  const [truth, setTruth] = useState<MeasurementTruth>(measurement?.truth ?? 'unknown')
  const [source, setSource] = useState(measurement?.source ?? '')
  const [required, setRequired] = useState(measurement?.required ?? false)
  const [componentKind, setComponentKind] = useState(part?.componentKind ?? '')
  const [quantity, setQuantity] = useState(part?.quantity?.toString() ?? '')
  const [condition, setCondition] = useState(part?.condition ?? '')
  const [specification, setSpecification] = useState(part?.specification ?? '')
  const [intent, setIntent] = useState<ComponentIntent>(part?.intent ?? 'inspect')
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [reason, setReason] = useState('')
  const [sourceImage, setSourceImage] = useState({ id: record?.sourceImageId ?? null, title: record?.sourceImageTitle ?? '' })
  const [chooseImage, setChooseImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = kind === 'measurement' ? 'measurement' : 'existing part'
  return <Modal title={(record ? 'Update ' : 'Add ') + label} onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      setBusy(true); setError('')
      try {
        if (kind === 'component' && quantity && (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 100000)) {
          throw new Error('Enter a whole count from 1 to 100,000, or leave it blank if unknown.')
        }
        const data: Record<string, unknown> = {
          notes, source_media_id: sourceImage.id,
          ...(record ? { change_note: reason } : { area_id: areaId || null }),
          ...(kind === 'measurement' ? {
            subject: title, value: truth === 'unknown' ? null : parseLength(length), unit, truth, source, required,
            ...(!record && component ? { component_id: component.id } : {}),
          } : { name: title, kind: componentKind, quantity: quantity || null, condition, specification, intent }),
        }
        await db.editProjectFact(projectId, kind, record ? 'revise' : 'create', id, record?.revision ?? 0, data)
        onSaved()
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <fieldset disabled={busy} className="foundation-form fact-fieldset">
        <Field label={kind === 'measurement' ? 'What does it measure?' : 'Part name'}>
          <input style={inputStyle} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
        </Field>
        {!record && !component ? <Field label="Area">
          <select style={inputStyle} value={areaId} onChange={e => setAreaId(e.target.value)}>
            <option value="">Project as a whole</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field> : <p className="foundation-hint">
          {component ? 'Part: ' + component.name + ' · ' : ''}{areas.find(a => a.id === areaId)?.name ?? 'Project as a whole'}
        </p>}
        {kind === 'measurement' ? <>
          <Field label="How certain is this value?"><select style={inputStyle} value={truth} onChange={e => setTruth(e.target.value as MeasurementTruth)}>
            {Object.entries(TRUTH_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></Field>
          <div className="fact-form-row">
            <Field label="Value"><input style={inputStyle} inputMode="decimal" required={truth !== 'unknown'} disabled={truth === 'unknown'}
              value={truth === 'unknown' ? '' : length} placeholder={truth === 'unknown' ? 'Unknown' : 'e.g. 1250,5'} onChange={e => setLength(e.target.value)} /></Field>
            <Field label="Unit"><select style={inputStyle} value={unit} onChange={e => setUnit(e.target.value as LengthUnit)}>
              <option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
            </select></Field>
          </div>
          <Field label="How was it obtained?"><textarea style={inputStyle} rows={2} required={truth !== 'unknown'} maxLength={2000}
            value={source} placeholder="Who measured it, method, or specification source" onChange={e => setSource(e.target.value)} /></Field>
          <label className="fact-checkbox"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required measurement</label>
          <p className="foundation-hint">Unknown and estimated values stay on the To measure list. Lengths accept up to three decimal places.</p>
        </> : <>
          <div className="fact-form-row">
            <Field label="Kind of part"><input style={inputStyle} maxLength={80} value={componentKind} placeholder="Window, door, beam…" onChange={e => setComponentKind(e.target.value)} /></Field>
            <Field label="Count"><input style={inputStyle} inputMode="numeric" value={quantity} placeholder="Unknown" onChange={e => setQuantity(e.target.value)} /></Field>
          </div>
          <Field label="Observed condition"><textarea style={inputStyle} rows={2} maxLength={2000} value={condition}
            placeholder="Leave blank if not inspected" onChange={e => setCondition(e.target.value)} /></Field>
          <Field label="Intended action"><select style={inputStyle} value={intent} onChange={e => setIntent(e.target.value as ComponentIntent)}>
            {Object.entries(INTENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></Field>
          <p className="foundation-hint">Reuse is an intention, not confirmation that a part is structurally suitable.</p>
          <Field label="Specification"><textarea style={inputStyle} rows={2} maxLength={4000} value={specification} onChange={e => setSpecification(e.target.value)} /></Field>
          <p className="foundation-hint">Add dimensions from the part's Measurements button after saving.</p>
        </>}
        <Field label="Notes"><textarea style={inputStyle} rows={2} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        <div className="fact-source">
          <strong>Source image</strong>
          <p className="foundation-hint">{sourceImage.title || 'No image selected'}</p>
          <div className="foundation-actions">
            <button type="button" className="btn" onClick={() => setChooseImage(true)}>Choose source image</button>
            {sourceImage.title && <button type="button" className="btn" onClick={() => setSourceImage({ id: null, title: '' })}>Clear image</button>}
          </div>
        </div>
        {record && <>
          <Field label="Reason for change"><input style={inputStyle} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <p className="foundation-hint">Saving keeps the previous value and source in history.</p>
        </>}
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        {busy && <p role="status">Saving and reading back…</p>}
        <div className="foundation-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">{busy ? 'Saving…' : record ? 'Save new version' : 'Save ' + label}</button>
        </div>
      </fieldset>
    </form>
    {chooseImage && <Modal title="Choose a source image" onClose={() => setChooseImage(false)}>
      <p className="foundation-hint">New uploads stay in the project gallery even if you cancel this form.</p>
      <ProjectImages projectId={projectId} target={{ kind: 'project', id: projectId }} allowUpload
        selectImage={async image => { setSourceImage({ id: image.id, title: image.title }); setChooseImage(false) }} />
    </Modal>}
  </Modal>
}

function FactHistory({ record, onClose }: { record: ProjectFact; onClose: () => void }) {
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(() => db.getProjectFactHistory(record.projectId, record.kind, record.id, offset), [record.id, offset, attempt])
  return <Modal title={'History: ' + name(record)} onClose={onClose}>
    {loading ? <Loading /> : error ? <div role="alert"><FormError>{error.message}</FormError>
      <button className="btn" onClick={() => setAttempt(n => n + 1)}>Reload history</button></div> : <>
      {!data?.items.length && <p>No history is available. Your access may have changed.</p>}
      <ol className="fact-history">{data?.items.map(item => <li key={item.revision} className="card fact-card">
        <h4>Version {item.revision} · {item.changeNote}</h4>
        <p>{name(item)}</p><FactSummary record={item} /><FactDetails record={item} />
      </li>)}</ol>
      <div className="foundation-actions">
        {offset > 0 && <button className="btn" onClick={() => setOffset(n => Math.max(0, n - 12))}>Newer versions</button>}
        {data?.hasMore && <button className="btn" onClick={() => setOffset(n => n + 12)}>Older versions</button>}
      </div>
    </>}
  </Modal>
}

function FactLifecycle({ record, onClose, onSaved }: { record: ProjectFact; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const action = record.archived ? 'restore' : 'archive'
  return <Modal title={(record.archived ? 'Restore ' : 'Archive ') + name(record) + '?'} onClose={() => { if (!busy) onClose() }}>
    <p>{record.archived ? 'Return this record to the active list.' : 'Move this record out of the active list. Its history stays available.'}</p>
    {record.kind === 'component' && <p className="foundation-hint">Its measurements keep their own state and history.</p>}
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    <div className="foundation-actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError('')
        try { await db.editProjectFact(record.projectId, record.kind, action, record.id, record.revision); onSaved() }
        catch (err) { setError(message(err)) } finally { setBusy(false) }
      }}>{busy ? 'Saving…' : record.archived ? 'Restore record' : 'Archive record'}</button>
    </div>
  </Modal>
}

export function ProjectFacts() {
  const projectId = db.getActiveProjectId() ?? ''
  const [params, setParams] = useSearchParams()
  const kind: FactKind = params.get('kind') === 'component' ? 'component' : 'measurement'
  const areaId = params.get('area') ?? ''
  const componentId = kind === 'measurement' ? params.get('part') ?? '' : ''
  const [status, setStatus] = useState<'active' | 'missing' | 'archived'>('active')
  const [offset, setOffset] = useState(0)
  const [version, setVersion] = useState(0)
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit' | 'history' | 'lifecycle'; record: ProjectFact } | null>(null)
  const { data: areas, error: areasError } = useAsync(() => db.getAreas(), [projectId])
  const { data: selected, error: partError, loading: partLoading } = useAsync(
    () => componentId ? db.getProjectFact(projectId, 'component', componentId) : Promise.resolve(null), [projectId, componentId, version])
  const component = selected?.kind === 'component' ? selected : undefined
  const { data, loading, error } = useAsync(() => db.getProjectFacts(projectId, kind, { areaId, componentId, status }, offset),
    [projectId, kind, areaId, componentId, status, offset, version])
  useEffect(() => { setOffset(0); setModal(null) }, [areaId, componentId, kind])
  function navigateFilter(nextKind: FactKind, area: string, part = '') {
    setOffset(0); setStatus('active')
    setParams({ kind: nextKind, ...(area ? { area } : {}), ...(part ? { part } : {}) })
  }
  const saved = () => { setModal(null); setOffset(0); setVersion(n => n + 1) }
  return <div className="page project-facts">
    <Link to="/" className="btn"><Icon name="arrow-left" size={16} /> Dashboard</Link>
    <div className="page-head">
      <div><h1 className="page-title">Measurements & existing parts</h1>
        <p className="page-sub">Keep what you know, what needs measuring and what may be reused.</p></div>
      <button className="btn btn-primary" disabled={!db.authEnabled() || Boolean(areasError) || !areas || Boolean(componentId && (partLoading || !component || component.archived))}
        onClick={() => setModal({ mode: 'create' })}>Add {kind === 'measurement' ? 'measurement' : 'existing part'}</button>
    </div>
    {!db.authEnabled() && <p className="card fact-card">This demo does not save measurements or existing parts. Open a connected project to use them.</p>}
    <div className="foundation-actions fact-tabs" role="group" aria-label="Project fact type">
      <button className={'btn' + (kind === 'measurement' ? ' btn-primary' : '')} aria-pressed={kind === 'measurement'} onClick={() => navigateFilter('measurement', areaId)}>Measurements</button>
      <button className={'btn' + (kind === 'component' ? ' btn-primary' : '')} aria-pressed={kind === 'component'} onClick={() => navigateFilter('component', areaId)}>Existing parts</button>
    </div>
    <div className="fact-filters">
      <Field label="Filter by area"><select style={inputStyle} value={areaId} disabled={Boolean(componentId)} onChange={e => navigateFilter(kind, e.target.value)}>
        <option value="">All areas</option>{areas?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></Field>
      <Field label="Show records"><select style={inputStyle} value={status} onChange={e => { setOffset(0); setStatus(e.target.value as typeof status) }}>
        <option value="active">Active</option>{kind === 'measurement' && <option value="missing">To measure</option>}<option value="archived">Archived</option>
      </select></Field>
    </div>
    {componentId && <div className="card fact-card">
      <p>{component ? 'Measurements for ' + component.name + (component.archived ? ' (archived part)' : '') : 'Loading selected part…'}</p>
      {partError && <p role="alert">This part is unavailable in the current project.</p>}
      <button className="btn" onClick={() => navigateFilter('measurement', areaId)}>Show all measurements</button>
    </div>}
    {areasError && <p role="alert">Areas could not be loaded. Reload the project before adding records.</p>}
    {loading ? <Loading /> : error ? <div role="alert"><FormError>{error.message}</FormError>
      <button className="btn" onClick={() => setVersion(n => n + 1)}>Reload records</button></div> : <>
      {!data?.items.length && <p className="card fact-card">
        {status === 'archived' ? 'No archived records in this selection.' : kind === 'measurement' ? 'No measurements in this selection. Add a known length or an unknown one to collect later.' : 'No existing parts in this selection. Record what you already have.'}
      </p>}
      <div className="fact-list">{data?.items.map(record => <article key={record.id} className="card fact-card" aria-label={name(record)}>
        <h3>{name(record)}</h3><FactSummary record={record} />
        <p className="foundation-hint">{areas?.find(a => a.id === record.areaId)?.name ?? 'Project as a whole'} · Version {record.revision}
          {record.kind === 'measurement' && record.componentId ? ' · Linked to an existing part' : ''}</p>
        <details><summary>Source and notes</summary><FactDetails record={record} /></details>
        <div className="foundation-actions">
          {!record.archived && <button className="btn" onClick={() => setModal({ mode: 'edit', record })}>Update</button>}
          <button className="btn" onClick={() => setModal({ mode: 'history', record })}>History</button>
          {record.kind === 'component' && <button className="btn" onClick={() => navigateFilter('measurement', record.areaId ?? '', record.id)}>Measurements for part</button>}
          <button className="btn" onClick={() => setModal({ mode: 'lifecycle', record })}>{record.archived ? 'Restore' : 'Archive'}</button>
        </div>
      </article>)}</div>
      <div className="foundation-actions">
        {offset > 0 && <button className="btn" onClick={() => setOffset(n => Math.max(0, n - 24))}>Previous records</button>}
        {data?.hasMore && <button className="btn" onClick={() => setOffset(n => n + 24)}>Next records</button>}
      </div>
    </>}
    {(modal?.mode === 'create' || modal?.mode === 'edit') && <FactEditor projectId={projectId} kind={kind}
      record={modal.mode === 'edit' ? modal.record : undefined} areas={areas ?? []} initialArea={areaId}
      component={modal.mode === 'create' ? component : undefined} onClose={() => setModal(null)} onSaved={saved} />}
    {modal?.mode === 'history' && <FactHistory record={modal.record} onClose={() => setModal(null)} />}
    {modal?.mode === 'lifecycle' && <FactLifecycle record={modal.record} onClose={() => setModal(null)} onSaved={saved} />}
  </div>
}
