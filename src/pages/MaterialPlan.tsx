import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type { Area, ExistingComponent, ProjectArtifact, SelectedTarget, Task } from '../data/types'
import type {
  MaterialRequirement,
  MaterialRequirementVersion,
  QuantityUnit,
  RequirementShoppingState,
  StockItem,
  StockStatus,
} from '../data/materialPlanning'
import { Field, FormError, inputStyle } from '../components/form'
import { Modal } from '../components/Modal'
import { Loading, useAsync } from '../components/ui'

const UNIT_LABELS: Record<QuantityUnit, string> = { pcs: 'pcs', m: 'm', m2: 'm²', m3: 'm³', kg: 'kg', l: 'l' }
const STOCK_LABELS: Record<StockStatus, string> = { available: 'Available', inspect: 'Inspect first', unavailable: 'Unavailable' }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const numberText = (value: string) => value.replace('.', ',')

function Retry({ error, retry, label = 'Reload' }: { error: Error; retry: () => void; label?: string }) {
  return <div role="alert"><FormError>{error.message}</FormError><button className="btn" onClick={retry}>{label}</button></div>
}

function Pager({ offset, more, move, size = 24 }: { offset: number; more: boolean; move: (next: number) => void; size?: number }) {
  return <div className="foundation-actions">
    {offset > 0 && <button className="btn" onClick={() => move(Math.max(0, offset - size))}>Previous page</button>}
    {more && <button className="btn" onClick={() => move(offset + size)}>Next page</button>}
  </div>
}

function formatQuantity(value: string, unit: QuantityUnit) {
  return `${numberText(value)} ${UNIT_LABELS[unit]}`
}

function StaleNotice({ value }: { value: MaterialRequirement }) {
  const reasons = [
    value.targetChanged && 'project target',
    value.artifactChanged && 'drawing',
    value.stockChanged && 'stock',
    value.componentChanged && 'reusable component',
  ].filter(Boolean) as string[]
  if (!reasons.length) return null
  return <p className="solution-attention">Review needed: {reasons.join(', ')} changed after this material version was saved. Its recorded quantities are retained.</p>
}

function Calculation({ value }: { value: MaterialRequirement }) {
  const available = Number(value.stockQuantity) + Number(value.componentQuantity)
  return <div className="fact-details">
    <div className="fact-source"><strong>Manual base requirement</strong><span>{formatQuantity(value.requiredQuantity, value.unit)}</span><p>{value.basis}</p></div>
    <div className="fact-source"><strong>Allowance</strong><span>{numberText(value.wastePercent)}%</span><p>Requirement with allowance: {formatQuantity(value.requiredWithWaste, value.unit)}</p></div>
    <div className="fact-source"><strong>Confirmed available</strong><span>{formatQuantity(String(available), value.unit)}</span><p>Material stock {formatQuantity(value.stockQuantity, value.unit)} · reusable components {formatQuantity(value.componentQuantity, value.unit)}</p></div>
    <div className="fact-source"><strong>Purchase need</strong><span>{formatQuantity(value.purchaseQuantity, value.unit)}</span><p>Rounded up in increments of {formatQuantity(value.purchaseIncrement, value.unit)}.</p></div>
  </div>
}

function StockEditor({ projectId, areas, value, onClose, onSaved }: {
  projectId: string
  areas: Area[]
  value?: StockItem
  onClose: () => void
  onSaved: () => void
}) {
  const [id] = useState(() => value?.id ?? crypto.randomUUID())
  const [name, setName] = useState(value?.name ?? '')
  const [specification, setSpecification] = useState(value?.specification ?? '')
  const [quantity, setQuantity] = useState(value?.quantity ?? '')
  const [unit, setUnit] = useState<QuantityUnit>(value?.unit ?? 'pcs')
  const [status, setStatus] = useState<StockStatus>(value?.status ?? 'available')
  const [area, setArea] = useState(value?.areaId ?? '')
  const [notes, setNotes] = useState(value?.notes ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return <Modal title={value ? 'Revise material stock' : 'Add material stock'} onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return
      setBusy(true); setError('')
      try {
        await db.editMaterialStock(projectId, value ? 'revise' : 'create', id, value?.revision ?? 0, {
          name, specification, quantity: quantity.trim().replace(',', '.'), unit, status, area_id: area || null, notes,
          ...(value ? { change_note: reason } : {}),
        })
        onSaved()
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <fieldset className="foundation-form fact-fieldset" disabled={busy}>
        <p className="foundation-hint">Stock is separate from Shopping. Only confirmed Available stock can reduce a purchase requirement.</p>
        <Field label="Stock item"><input style={inputStyle} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field>
        <Field label="Specification"><input style={inputStyle} maxLength={4000} value={specification} onChange={event => setSpecification(event.target.value)} /></Field>
        <div className="fact-filters">
          <Field label="Quantity"><input style={inputStyle} inputMode="decimal" required value={quantity} onChange={event => setQuantity(event.target.value)} /></Field>
          <Field label="Unit"><select style={inputStyle} value={unit} disabled={Boolean(value)} onChange={event => setUnit(event.target.value as QuantityUnit)}>
            {Object.entries(UNIT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        </div>
        <Field label="Stock state"><select style={inputStyle} value={status} onChange={event => setStatus(event.target.value as StockStatus)}>
          {Object.entries(STOCK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label="Area"><select style={inputStyle} value={area} onChange={event => setArea(event.target.value)}><option value="">Project as a whole</option>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Notes"><textarea style={inputStyle} rows={2} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
        {value && <Field label="Reason for change"><input style={inputStyle} required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></Field>}
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        <div className="foundation-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">{busy ? 'Saving and reading back…' : value ? 'Save new version' : 'Save stock'}</button></div>
      </fieldset>
    </form>
  </Modal>
}

function AllocationInput({ label, max, value, unit, disabled, onChange }: {
  label: string; max: string | number; value: string; unit: QuantityUnit; disabled?: boolean; onChange: (value: string) => void
}) {
  return <label style={{ display: 'grid', gridTemplateColumns: '1fr minmax(100px, 150px)', gap: 10, alignItems: 'center' }}>
    <span>{label}<small style={{ display: 'block', color: 'var(--ink-soft)' }}>Available {max} {UNIT_LABELS[unit]}</small></span>
    <input aria-label={`Allocate ${label}`} style={inputStyle} inputMode="decimal" placeholder="0" disabled={disabled} value={value} onChange={event => onChange(event.target.value)} />
  </label>
}

function RequirementEditor({ projectId, target, value, areas, tasks, artifacts, stock, components, onClose, onSaved }: {
  projectId: string
  target: SelectedTarget
  value?: MaterialRequirementVersion
  areas: Area[]
  tasks: Task[]
  artifacts: ProjectArtifact[]
  stock: StockItem[]
  components: ExistingComponent[]
  onClose: () => void
  onSaved: () => void
}) {
  const [id] = useState(() => value?.id ?? crypto.randomUUID())
  const [name, setName] = useState(value?.name ?? '')
  const [category, setCategory] = useState(value?.category ?? 'Timber')
  const [area, setArea] = useState(value?.areaId ?? '')
  const [task, setTask] = useState(value?.taskId ?? '')
  const [unit, setUnit] = useState<QuantityUnit>(value?.unit ?? 'pcs')
  const [required, setRequired] = useState(value?.requiredQuantity ?? '')
  const [waste, setWaste] = useState(value?.wastePercent ?? '0')
  const [increment, setIncrement] = useState(value?.purchaseIncrement ?? '1')
  const [basis, setBasis] = useState(value?.basis ?? '')
  const [assumptions, setAssumptions] = useState(value?.assumptions ?? '')
  const [artifactRef, setArtifactRef] = useState(value?.artifactId ? `${value.artifactId}:${value.artifactRevision}` : '')
  const [stockQty, setStockQty] = useState<Record<string, string>>(() => Object.fromEntries((value?.stock ?? []).map(item => [item.id, item.quantity])))
  const [componentQty, setComponentQty] = useState<Record<string, string>>(() => Object.fromEntries((value?.components ?? []).map(item => [item.id, String(item.quantity)])))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = target.solution
  const taskOptions = tasks.filter(item => !area || item.areaId === area)
  const stockOptions = stock.filter(item => !item.archived && item.status === 'available' && item.unit === unit)
  const componentOptions = components.filter(item => !item.archived && item.intent === 'reuse' && item.quantity !== null)

  const expected = useMemo(() => {
    const base = Number(required.replace(',', '.')) || 0
    const allowance = Number(waste.replace(',', '.')) || 0
    const raw = Math.ceil(base * (1 + allowance / 100) * 10000) / 10000
    const stockUsed = Object.values(stockQty).reduce((sum, item) => sum + (Number(item.replace(',', '.')) || 0), 0)
    const componentsUsed = unit === 'pcs' ? Object.values(componentQty).reduce((sum, item) => sum + (Number(item.replace(',', '.')) || 0), 0) : 0
    const step = Number(increment.replace(',', '.')) || 0
    const purchase = step > 0 ? Math.ceil(Math.max(raw - stockUsed - componentsUsed, 0) / step) * step : 0
    return { raw, stockUsed, componentsUsed, purchase }
  }, [required, waste, increment, stockQty, componentQty, unit])

  return <Modal title={value ? 'Revise material requirement' : 'Add material requirement'} wide onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || !selected) return
      setBusy(true); setError('')
      try {
        const [artifactId, artifactRevision] = artifactRef ? artifactRef.split(':') : ['', '']
        await db.editMaterialRequirement(projectId, value ? 'revise' : 'create', id, value?.revision ?? 0, {
          name, category, area_id: area || null, task_id: task || null, unit,
          required_quantity: required.trim().replace(',', '.'), waste_percent: waste.trim().replace(',', '.'), purchase_increment: increment.trim().replace(',', '.'),
          basis, assumptions, artifact_id: artifactId || null, artifact_revision: artifactRevision ? Number(artifactRevision) : null,
          target_revision: target.decision.revision,
          stock_allocations: stockOptions.flatMap(item => {
            const quantity = stockQty[item.id]?.trim().replace(',', '.')
            return quantity && Number(quantity) > 0 ? [{ id: item.id, revision: item.revision, quantity }] : []
          }),
          component_allocations: unit === 'pcs' ? componentOptions.flatMap(item => {
            const quantity = componentQty[item.id]?.trim()
            return quantity && Number(quantity) > 0 ? [{ id: item.id, revision: item.revision, quantity: Number(quantity) }] : []
          }) : [],
          ...(value ? { change_note: reason } : {}),
        })
        onSaved()
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <fieldset className="foundation-form fact-fieldset" disabled={busy}>
        <div className="fact-source"><strong>Selected project target</strong><p>{selected ? `${selected.title} · Version ${selected.revision}` : 'No target selected'}</p><span>Target decision {target.decision.revision}. A changed target rejects this save.</span></div>
        <p className="foundation-hint">The base quantity below is a human-entered project value in 4B2a. Bob is not deriving geometry yet.</p>
        <Field label="Material / requirement"><input style={inputStyle} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field>
        <Field label="Category"><input style={inputStyle} required maxLength={120} value={category} onChange={event => setCategory(event.target.value)} /></Field>
        <div className="fact-filters">
          <Field label="Area"><select style={inputStyle} value={area} onChange={event => { setArea(event.target.value); setTask('') }}><option value="">Project as a whole</option>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Task"><select style={inputStyle} value={task} onChange={event => setTask(event.target.value)}><option value="">No task yet</option>{taskOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        </div>
        <Field label="Drawing basis"><select style={inputStyle} value={artifactRef} onChange={event => setArtifactRef(event.target.value)}><option value="">No drawing linked</option>{artifacts.map(item => <option key={item.id} value={`${item.id}:${item.revision}`}>{item.title} · Version {item.revision}</option>)}</select></Field>
        <div className="fact-filters">
          <Field label="Base required quantity"><input style={inputStyle} inputMode="decimal" required value={required} onChange={event => setRequired(event.target.value)} /></Field>
          <Field label="Unit"><select style={inputStyle} value={unit} onChange={event => { setUnit(event.target.value as QuantityUnit); setStockQty({}); setComponentQty({}) }}>{Object.entries(UNIT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        </div>
        <div className="fact-filters">
          <Field label="Waste / allowance %"><input style={inputStyle} inputMode="decimal" required value={waste} onChange={event => setWaste(event.target.value)} /></Field>
          <Field label="Purchase increment"><input style={inputStyle} inputMode="decimal" required value={increment} onChange={event => setIncrement(event.target.value)} /></Field>
        </div>
        <Field label="Basis for the base quantity"><textarea style={inputStyle} rows={3} required maxLength={6000} value={basis} onChange={event => setBasis(event.target.value)} /></Field>
        <Field label="Assumptions and limits"><textarea style={inputStyle} rows={2} maxLength={4000} value={assumptions} onChange={event => setAssumptions(event.target.value)} /></Field>

        <div className="fact-details"><h4>Use confirmed material stock</h4>{!stockOptions.length && <p>No Available stock uses {UNIT_LABELS[unit]}. Add stock outside this form first.</p>}{stockOptions.map(item => <AllocationInput key={item.id} label={item.name} max={item.quantity} unit={item.unit} value={stockQty[item.id] ?? ''} onChange={quantity => setStockQty(current => ({ ...current, [item.id]: quantity }))} />)}</div>
        {unit === 'pcs' && <div className="fact-details"><h4>Use reusable existing components</h4>{!componentOptions.length && <p>No current component is marked Plan to reuse with a known count.</p>}{componentOptions.map(item => <AllocationInput key={item.id} label={item.name} max={item.quantity ?? 0} unit="pcs" value={componentQty[item.id] ?? ''} onChange={quantity => setComponentQty(current => ({ ...current, [item.id]: quantity }))} />)}</div>}

        <div className="fact-source"><strong>Preview of deterministic arithmetic</strong><p>{expected.raw.toLocaleString('sv-SE')} {UNIT_LABELS[unit]} after allowance − {expected.stockUsed.toLocaleString('sv-SE')} stock − {expected.componentsUsed.toLocaleString('sv-SE')} reusable = <strong>{expected.purchase.toLocaleString('sv-SE')} {UNIT_LABELS[unit]} to buy</strong>.</p><span>The server recalculates this from saved inputs. This browser preview is not the source of truth.</span></div>
        {value && <Field label="Reason for change"><input style={inputStyle} required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></Field>}
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        <div className="foundation-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!selected}>{busy ? 'Saving and reading back…' : value ? 'Save new version' : 'Save requirement'}</button></div>
      </fieldset>
    </form>
  </Modal>
}

function RequirementVersionDialog({ projectId, id, revision, target, edit, areas, tasks, artifacts, stock, components, onClose, onSaved }: {
  projectId: string; id: string; revision: number; target: SelectedTarget; edit?: boolean; areas: Area[]; tasks: Task[]; artifacts: ProjectArtifact[]; stock: StockItem[]; components: ExistingComponent[]; onClose: () => void; onSaved: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(() => db.getMaterialRequirementVersion(projectId, id, revision), [projectId, id, revision, attempt])
  if (data && !loading && !error && edit) return <RequirementEditor projectId={projectId} target={target} value={data} areas={areas} tasks={tasks} artifacts={artifacts} stock={stock} components={components} onClose={onClose} onSaved={onSaved} />
  return <Modal title={data ? `${data.name} · Version ${data.revision}` : 'Material requirement version'} onClose={onClose}>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(value => value + 1)} /> : data && <>
      <Calculation value={data} />
      <div className="fact-source"><strong>Lineage</strong><p>{data.solutionTitle} · solution version {data.solutionRevision} · target decision {data.targetRevision}</p>{data.artifactTitle && <p>Drawing: {data.artifactTitle} · Version {data.artifactRevision}</p>}<span>{data.actor} · {new Date(data.recordedAt).toLocaleString()} · {data.reason}</span></div>
      {data.assumptions && <p><strong>Assumptions:</strong> {data.assumptions}</p>}
      <StaleNotice value={data} />
      <div className="fact-details"><h4>Saved allocations</h4>{!data.stock.length && !data.components.length && <p>No stock or reusable component allocated.</p>}{data.stock.map(item => <p key={item.id}>{item.name}: {formatQuantity(item.quantity, item.unit)} from stock version {item.revision}{item.latestRevision !== item.revision ? ' · newer stock version exists' : ''}</p>)}{data.components.map(item => <p key={item.id}>{item.name}: {item.quantity} pcs from component version {item.revision}{item.latestRevision !== item.revision ? ' · newer component version exists' : ''}</p>)}</div>
    </>}
  </Modal>
}

function History({ projectId, record, onClose, onVersion }: { projectId: string; record: MaterialRequirement; onClose: () => void; onVersion: (revision: number) => void }) {
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(() => db.getMaterialRequirementHistory(projectId, record.id, offset), [projectId, record.id, offset, attempt])
  return <Modal title="Material requirement history" onClose={onClose}>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(value => value + 1)} /> : <><ol className="fact-history">{data?.items.map(item => <li key={item.revision} className="card fact-card"><h4>{item.name} · Version {item.revision}</h4><p>{formatQuantity(item.purchaseQuantity, item.unit)} to buy · {item.reason}</p><p className="foundation-hint">{item.actor} · {new Date(item.recordedAt).toLocaleString()}</p><button className="btn" onClick={() => onVersion(item.revision)}>View version</button></li>)}</ol><Pager offset={offset} size={12} more={Boolean(data?.hasMore)} move={setOffset} /></>}
  </Modal>
}

function ArchiveDialog({ projectId, record, onClose, onSaved }: { projectId: string; record: MaterialRequirement; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const action = record.archived ? 'Restore requirement' : 'Archive requirement'
  return <Modal title={action} onClose={() => { if (!busy) onClose() }}><p>{record.name} · Version {record.revision}</p><p className="foundation-hint">History and any existing Shopping row stay intact.</p>{error && <FormError>{error}</FormError>}<div className="foundation-actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await db.editMaterialRequirement(projectId, record.archived ? 'restore' : 'archive', record.id, record.revision); onSaved() } catch (err) { setError(message(err)); setBusy(false) } }}>{busy ? 'Saving…' : action}</button></div></Modal>
}

function PublishDialog({ projectId, record, state, onClose, onSaved }: { projectId: string; record: MaterialRequirement; state?: RequirementShoppingState; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = Boolean(state?.materialId && !state.materialMissing)
  return <Modal title={update ? 'Update Shopping' : 'Send to Shopping'} onClose={() => { if (!busy) onClose() }}>
    <Calculation value={record} /><StaleNotice value={record} />
    <p>This deliberately writes the saved purchase need to Bob's existing Shopping list. Supplier, cost and current shopping status are preserved on updates.</p>
    {state?.shoppingEdited && <p className="solution-attention">The linked Shopping row was edited since the last sync. Updating will refresh its name, quantity, area and category while preserving supplier, cost and status.</p>}
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    <div className="foundation-actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await db.publishMaterialRequirement(projectId, record.id, record.revision); onSaved() } catch (err) { setError(message(err)); setBusy(false) } }}>{busy ? 'Saving to Shopping…' : update ? 'Update Shopping' : 'Send to Shopping'}</button></div>
  </Modal>
}

function StockSection({ projectId, areas, version, bump }: { projectId: string; areas: Area[]; version: number; bump: () => void }) {
  const [offset, setOffset] = useState(0)
  const [archived, setArchived] = useState(false)
  const [editor, setEditor] = useState<StockItem | 'new' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(() => db.getMaterialStock(projectId, archived, offset), [projectId, archived, offset, version, attempt])
  return <section className="card" style={{ padding: 18 }}><div className="foundation-actions" style={{ justifyContent: 'space-between' }}><div><h2 style={{ margin: 0 }}>Existing material stock</h2><p className="foundation-hint">Confirmed stock is separate from Shopping and reusable components.</p></div><button className="btn" onClick={() => setEditor('new')}>Add stock</button></div>
    <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><span>Show stock</span><select style={inputStyle} value={archived ? 'archived' : 'active'} onChange={event => { setArchived(event.target.value === 'archived'); setOffset(0) }}><option value="active">Active</option><option value="archived">Archived</option></select></label>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(value => value + 1)} /> : !data?.items.length ? <p>No {archived ? 'archived' : 'active'} material stock.</p> : <div className="fact-list">{data.items.map(item => <article key={item.id} className="card fact-card" aria-label={item.name}><h3>{item.name}</h3><p><strong>{formatQuantity(item.quantity, item.unit)}</strong> · {STOCK_LABELS[item.status]}{item.areaTitle ? ` · ${item.areaTitle}` : ''}</p>{item.specification && <p>{item.specification}</p>}<p className="foundation-hint">Version {item.revision} · {item.actor}</p><div className="foundation-actions">{!item.archived && <button className="btn" onClick={() => setEditor(item)}>Revise</button>}<button className="btn" onClick={async () => { try { await db.editMaterialStock(projectId, item.archived ? 'restore' : 'archive', item.id, item.revision); bump() } catch (err) { alert(message(err)) } }}>{item.archived ? 'Restore' : 'Archive'}</button></div></article>)}</div>}
    <Pager offset={offset} more={Boolean(data?.hasMore)} move={setOffset} />
    {editor && <StockEditor projectId={projectId} areas={areas} value={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); bump() }} />}
  </section>
}

export function MaterialPlan() {
  const projectId = db.getActiveProjectId() ?? ''
  const [params] = useSearchParams()
  const initialArea = params.get('area') ?? ''
  const [version, setVersion] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [offset, setOffset] = useState(0)
  const [archived, setArchived] = useState(false)
  const [areaFilter, setAreaFilter] = useState(initialArea)
  const [editor, setEditor] = useState<'new' | { id: string; revision: number } | null>(null)
  const [detail, setDetail] = useState<{ id: string; revision: number; edit?: boolean } | null>(null)
  const [history, setHistory] = useState<MaterialRequirement | null>(null)
  const [archive, setArchive] = useState<MaterialRequirement | null>(null)
  const [publish, setPublish] = useState<MaterialRequirement | null>(null)
  const bump = () => setVersion(value => value + 1)

  const { data, loading, error } = useAsync(async () => {
    const [target, areas, tasks, artifactsPage, stockPage, componentsPage, requirements, shopping] = await Promise.all([
      db.getSelectedTarget(projectId), db.getAreas(), db.getTasks(), db.getProjectArtifacts(projectId, '', false, 0),
      db.getMaterialStock(projectId, false, 0), db.getProjectFacts(projectId, 'component', {}, 0),
      db.getMaterialRequirements(projectId, areaFilter, archived, offset), db.getMaterialShoppingSources(projectId),
    ])
    return {
      target, areas, tasks, artifacts: artifactsPage.items, stock: stockPage.items,
      components: componentsPage.items.filter((item): item is ExistingComponent => item.kind === 'component'), requirements, shopping,
    }
  }, [projectId, areaFilter, archived, offset, version, attempt])

  const shoppingByRequirement = new Map((data?.shopping ?? []).map(item => [item.requirementId, item]))
  const selected = data?.target.solution

  return <div className="page material-plan foundation-actions">
    <div className="page-head"><div><Link to="/shopping" className="back-link">Shopping</Link><h1 className="page-title">Material plan</h1><p className="page-sub">Keep required, already available and still-to-buy quantities connected to the exact project target.</p></div><button className="btn btn-primary" disabled={!selected} onClick={() => setEditor('new')}>Add requirement</button></div>
    {loading && !data ? <Loading /> : error && !data ? <Retry error={error} retry={() => setAttempt(value => value + 1)} label="Reload material plan" /> : data && <>
      <div className="card" style={{ padding: 18, marginTop: 16 }}><h2 style={{ marginTop: 0 }}>Material target</h2>{selected ? <><p><strong>{selected.title} · Version {selected.revision}</strong></p><p>Target decision {data.target.decision.revision}. New material versions pin this exact decision.</p><Link className="btn" to="/solutions">Review target</Link></> : <><p>Choose a project target before recording material requirements.</p><Link className="btn btn-primary" to="/solutions">Choose target</Link></>}</div>

      <StockSection projectId={projectId} areas={data.areas} version={version} bump={bump} />

      <section style={{ marginTop: 20 }}><div className="page-head"><div><h2 style={{ margin: 0 }}>Material requirements</h2><p className="foundation-hint">Base quantity is manual in 4B; allowance, allocation and purchase rounding are deterministic.</p></div></div>
        <div className="fact-filters"><Field label="Filter by area"><select style={inputStyle} value={areaFilter} onChange={event => { setAreaFilter(event.target.value); setOffset(0) }}><option value="">All areas</option>{data.areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Show requirements"><select style={inputStyle} value={archived ? 'archived' : 'active'} onChange={event => { setArchived(event.target.value === 'archived'); setOffset(0) }}><option value="active">Active</option><option value="archived">Archived</option></select></Field></div>
        {!data.requirements.items.length ? <div className="card" style={{ padding: 18 }}><p>No {archived ? 'archived' : 'active'} material requirements in this selection.</p></div> : <div className="fact-list">{data.requirements.items.map(item => {
          const sync = shoppingByRequirement.get(item.id)
          const stale = item.targetChanged || item.artifactChanged || item.stockChanged || item.componentChanged
          return <article key={item.id} className="card fact-card" aria-label={item.name}><div className="foundation-actions"><span className="image-purpose">Manual base</span>{sync && <span className="image-purpose">Shopping linked</span>}{stale && <span className="image-purpose">Review needed</span>}</div><h3>{item.name}</h3><p>{item.areaTitle || 'Project'}{item.taskTitle ? ` · ${item.taskTitle}` : ''}</p><p><strong>{formatQuantity(item.purchaseQuantity, item.unit)} to buy</strong> · Version {item.revision}</p><Calculation value={item} /><StaleNotice value={item} />{sync?.sourceOutdated && <p className="solution-attention">Shopping still reflects material requirement version {sync.syncedRevision}. Update it when this version is reviewed.</p>}{sync?.shoppingEdited && <p className="solution-attention">The linked Shopping row was edited independently after the last sync.</p>}<p className="foundation-hint">Based on {item.solutionTitle} · solution version {item.solutionRevision} · target decision {item.targetRevision}{item.artifactTitle ? ` · ${item.artifactTitle} v${item.artifactRevision}` : ''}</p><div className="foundation-actions"><button className="btn" onClick={() => setDetail({ id: item.id, revision: item.revision })}>View basis</button><button className="btn" onClick={() => setHistory(item)}>History</button>{!item.archived && <button className="btn" onClick={() => setDetail({ id: item.id, revision: item.revision, edit: true })}>Revise</button>}<button className="btn" onClick={() => setArchive(item)}>{item.archived ? 'Restore' : 'Archive'}</button>{!item.archived && <button className="btn btn-primary" disabled={stale} onClick={() => setPublish(item)}>{sync?.materialId && !sync.materialMissing ? 'Update Shopping' : 'Send to Shopping'}</button>}</div></article>
        })}</div>}
        <Pager offset={offset} more={data.requirements.hasMore} move={setOffset} />
      </section>
    </>}
    {data && editor === 'new' && selected && <RequirementEditor projectId={projectId} target={data.target} areas={data.areas} tasks={data.tasks} artifacts={data.artifacts} stock={data.stock} components={data.components} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); bump() }} />}
    {data && detail && <RequirementVersionDialog projectId={projectId} id={detail.id} revision={detail.revision} edit={detail.edit} target={data.target} areas={data.areas} tasks={data.tasks} artifacts={data.artifacts} stock={data.stock} components={data.components} onClose={() => setDetail(null)} onSaved={() => { setDetail(null); bump() }} />}
    {data && history && <History projectId={projectId} record={history} onClose={() => setHistory(null)} onVersion={revision => { setHistory(null); setDetail({ id: history.id, revision }) }} />}
    {archive && <ArchiveDialog projectId={projectId} record={archive} onClose={() => setArchive(null)} onSaved={() => { setArchive(null); bump() }} />}
    {publish && <PublishDialog projectId={projectId} record={publish} state={shoppingByRequirement.get(publish.id)} onClose={() => setPublish(null)} onSaved={() => { setPublish(null); bump() }} />}
  </div>
}
