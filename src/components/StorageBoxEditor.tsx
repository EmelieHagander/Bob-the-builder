import { useMemo, useState } from 'react'
import * as db from '../data/database'
import type { ArtifactVersion, SelectedTarget } from '../data/types'
import { storageBoxGeometry, BOX_LIMITS, type StorageBoxRecipe } from '../lib/storageBox'
import { Field, FormError, inputStyle } from './form'
import { Modal } from './Modal'
import { StorageBoxDrawing } from './StorageBoxDrawing'

export function StorageBoxEditor({ projectId, areaId, target, value, onClose, onSaved }: {
  projectId: string; areaId: string; target: SelectedTarget; value?: ArtifactVersion; onClose: () => void; onSaved: (saved: ArtifactVersion) => void
}) {
  const previous = value?.parametricRecipe
  const [id] = useState(() => value?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(value?.title ?? 'Storage box')
  const [width, setWidth] = useState(String(previous?.width_mm ?? 800))
  const [height, setHeight] = useState(String(previous?.height_mm ?? 350))
  const [depth, setDepth] = useState(String(previous?.depth_mm ?? 600))
  const [thickness, setThickness] = useState(String(previous?.thickness_mm ?? 18))
  const [notes, setNotes] = useState(value?.assumptions ?? 'Starting design dimensions; confirm the material, fixing method and available space before cutting.')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const result = useMemo(() => {
    const recipe: StorageBoxRecipe = { generator: 'storage_box_v1', version: 1,
      width_mm: Number(width), height_mm: Number(height), depth_mm: Number(depth), thickness_mm: Number(thickness) }
    try { return { recipe: storageBoxGeometry(recipe).recipe, error: '' } }
    catch (err) { return { recipe: null, error: err instanceof Error ? err.message : 'Invalid dimensions.' } }
  }, [width, height, depth, thickness])
  return <Modal title={value ? 'Edit storage box dimensions' : 'Draw a storage box'} wide onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (busy || !result.recipe || !target.solution) return
      setBusy(true); setError('')
      try {
        const saved = await db.editProjectArtifact(projectId, value ? 'regenerate_box' : 'generate_box', id, value?.revision ?? 0, {
          title, description: value?.description ?? 'Parametric open-top storage box: front elevation, plan, section A–A and finished part dimensions.',
          assumptions: notes, target_revision: target.decision.revision, recipe: result.recipe,
          measurements: (value?.measurements ?? []).map(m => ({ id: m.id, revision: m.revision })),
          ...(value ? { change_note: reason } : { area_id: areaId || null }),
        })
        onSaved(saved)
      } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the drawing.') }
      finally { setBusy(false) }
    }}>
      <fieldset className="foundation-form fact-fieldset" disabled={busy}>
        <p>Based on {target.solution?.title ?? 'no selected target'} · target decision {target.decision.revision}.
          A changed target or drawing version will reject the save rather than overwrite somebody else's work.</p>
        <Field label="Drawing title"><input style={inputStyle} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></Field>
        <p className="foundation-hint">These are proposed outside dimensions, not room measurements. The initial numbers are editable example dimensions.</p>
        <div className="fact-filters">{([
          ['Outside width (mm)', width, setWidth, 10000], ['Outside height (mm)', height, setHeight, 10000],
          ['Outside depth (mm)', depth, setDepth, 10000], ['Sheet thickness (mm)', thickness, setThickness, 100],
        ] as const).map(([label, number, set, max]) => <Field label={label} key={label}>
          <input style={inputStyle} required type="number" inputMode="decimal" min={0.001} max={max} step={0.001} value={number} onChange={e => set(e.target.value)} />
        </Field>)}</div>
        <Field label="Material, source and assumptions"><textarea style={inputStyle} rows={3} maxLength={3500} required value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        <p className="foundation-hint">{BOX_LIMITS}</p>
        {result.error && <div role="alert"><FormError>{result.error}</FormError></div>}
        {result.recipe && <StorageBoxDrawing recipe={result.recipe} stamp={{ title }} preview />}
        {value && <Field label="Reason for change"><input style={inputStyle} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
        <p className="foundation-hint">A new drawing revision is saved as Concept. It does not alter building measurements, buy materials or approve the construction.</p>
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        <div className="foundation-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!result.recipe || !target.solution}>{busy ? 'Saving and reading back…' : value ? 'Save new drawing version' : 'Save drawing'}</button></div>
      </fieldset>
    </form>
  </Modal>
}
