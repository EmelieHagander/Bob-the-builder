import { useState } from 'react'
import { Modal } from './Modal'
import { inputStyle } from './form'
import { countBoards, countSheets, DEFAULT_KERF_MM, DEFAULT_MARGIN_MM, profileLength, type SheetPart } from '../domain/stockCount'

/** Owner design 2026-11-08: count boards or sheets in the shop from the raw size
 * the person sees there. Before that, an estimate from a common size, clearly
 * labelled. Nothing is saved to the project; the entered sizes are remembered
 * in this browser only. */

/** A starting point for the estimate only, replaced by what the person enters. */
const COMMON_BOARD_MM = 3600
const UNITS = { mm: 1, cm: 10, m: 1000 } as const
type Unit = keyof typeof UNITS

export type StockGroup = {
  key: string
  materialId: string
  materialRevision: number
  name: string
  profile: string
  thickness: number | null
  width: number | null
  /** Sheet size from the saved material, when it states one. */
  sheet: { length: number; width: number } | null
  parts: SheetPart[]
}

type Entry = { raw: string; rawWidth: string; unit: Unit; kerf: string; margin: string }
const storageKey = (group: StockGroup) => 'bob.stock-count.' + group.materialId
function remembered(group: StockGroup): Entry | null {
  try { const value = JSON.parse(localStorage.getItem(storageKey(group)) ?? 'null'); return value && typeof value.raw === 'string' ? value : null } catch { return null }
}
function remember(group: StockGroup, entry: Entry) { try { localStorage.setItem(storageKey(group), JSON.stringify(entry)) } catch { /* convenience only */ } }

const isSheet = (group: StockGroup) => group.profile === 'sheet_stock'
const number = (text: string) => text.trim() === '' ? NaN : Number(text.replace(',', '.'))
const metres = (mm: number) => (mm / 1000).toLocaleString('sv-SE', { maximumFractionDigits: 2 }) + ' m'
const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many)

function boardPieces(group: StockGroup) {
  return group.parts.flatMap(part => {
    const length = profileLength(part.dimensions, group.thickness, group.width)
    return Array.from({ length: part.quantity }, (_, i) => ({ label: part.quantity > 1 ? `${part.label} ${i + 1}` : part.label, length }))
  })
}

function compute(group: StockGroup, entry: Entry) {
  const scale = UNITS[entry.unit], kerf = number(entry.kerf), margin = number(entry.margin)
  if (isSheet(group)) {
    if (group.thickness === null) return { kind: 'sheet' as const, result: { status: 'unsupported' as const, message: 'The saved material has no thickness.' } }
    return { kind: 'sheet' as const, result: countSheets(group.parts, { id: group.materialId, revision: group.materialRevision, thickness: group.thickness },
      { length: number(entry.raw) * scale, width: number(entry.rawWidth) * scale }, kerf, margin) }
  }
  return { kind: 'board' as const, result: countBoards(boardPieces(group), number(entry.raw) * scale, kerf, margin) }
}

function defaults(group: StockGroup): Entry {
  return { raw: String(isSheet(group) ? group.sheet?.length ?? '' : COMMON_BOARD_MM), rawWidth: String(group.sheet?.width ?? ''),
    unit: 'mm', kerf: String(DEFAULT_KERF_MM), margin: String(DEFAULT_MARGIN_MM) }
}

function summary(group: StockGroup, entry: Entry) {
  const { kind, result } = compute(group, entry)
  if (result.status !== 'ok') return null
  return kind === 'sheet' ? plural((result as { sheets: number }).sheets, 'sheet', 'sheets') : plural((result as { boards: unknown[] }).boards.length, 'board', 'boards')
}

export function StockCountRow({ group }: { group: StockGroup }) {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<Entry | null>(() => remembered(group))
  const entry = saved ?? defaults(group)
  const count = summary(group, entry)
  const size = isSheet(group) ? `${entry.raw} × ${entry.rawWidth} ${entry.unit}` : `${entry.raw} ${entry.unit}`
  return <>
    <div className="foundation-actions" style={{ alignItems: 'center' }}>
      <span>{count ? <><strong>{saved ? '' : '≈ '}{count}</strong> {saved ? `of ${size}` : `(estimate with ${size} ${isSheet(group) ? 'sheets' : 'boards'})`}</> : <span className="foundation-hint">Enter the raw size to count</span>}</span>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{saved ? 'Change size' : 'Count in the shop'}</button>
    </div>
    {open && <StockCountModal group={group} initial={entry} onClose={() => setOpen(false)} onUse={next => { remember(group, next); setSaved(next); setOpen(false) }} />}
  </>
}

function StockCountModal({ group, initial, onClose, onUse }: { group: StockGroup; initial: Entry; onClose: () => void; onUse: (entry: Entry) => void }) {
  const [entry, setEntry] = useState<Entry>(initial)
  const set = (field: keyof Entry) => (event: { target: { value: string } }) => setEntry(value => ({ ...value, [field]: event.target.value }))
  const sheet = isSheet(group)
  const { kind, result } = compute(group, entry)
  const field = { display: 'grid', gap: 4 } as const
  return <Modal title={'Count ' + group.name} onClose={onClose}>
    <p className="foundation-hint">Enter the size you see in the shop. Code counts how many to buy; nothing is saved to the project.</p>
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: sheet ? '1fr 1fr auto' : '1fr auto', gap: 8, alignItems: 'end' }}>
        <label style={field}><strong>{sheet ? 'Sheet length' : 'Raw board length'}</strong>
          <input style={inputStyle} inputMode="decimal" value={entry.raw} onChange={set('raw')} /></label>
        {sheet && <label style={field}><strong>Sheet width</strong>
          <input style={inputStyle} inputMode="decimal" value={entry.rawWidth} onChange={set('rawWidth')} /></label>}
        <label style={field}><strong>Unit</strong>
          <select style={inputStyle} value={entry.unit} onChange={set('unit')}>{Object.keys(UNITS).map(unit => <option key={unit}>{unit}</option>)}</select></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={field}><strong>Saw kerf (mm)</strong>
          <input style={inputStyle} inputMode="decimal" value={entry.kerf} onChange={set('kerf')} /></label>
        <label style={field}><strong>{sheet ? 'Edge margin (mm)' : 'End margin (mm)'}</strong>
          <input style={inputStyle} inputMode="decimal" value={entry.margin} onChange={set('margin')} /></label>
      </div>
      <p className="foundation-hint" style={{ margin: 0 }}>{sheet ? 'The edge margin is trimmed off every side of each sheet.' : 'The end margin is cut off both ends of each board, for split or uneven ends.'} {DEFAULT_KERF_MM} mm kerf and {DEFAULT_MARGIN_MM} mm margin are common starting points; change them to suit your saw and the wood.</p>
    </div>
    <section aria-live="polite" style={{ marginTop: 'var(--space-3)' }}>
      {result.status === 'ok' && kind === 'board' && 'boards' in result && <>
        <h4 style={{ margin: '0 0 8px' }}>You need {plural(result.boards.length, 'board', 'boards')}</h4>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{result.boards.map((board, index) => <li key={index}>
          {board.pieces.map(piece => `${piece.label} ${piece.length} mm`).join(' · ')} <span className="foundation-hint">· offcut {metres(board.offcut)}</span>
        </li>)}</ol>
      </>}
      {result.status === 'ok' && kind === 'sheet' && 'sheets' in result && <>
        <h4 style={{ margin: '0 0 8px' }}>You need {plural(result.sheets, 'sheet', 'sheets')}</h4>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{[...new Set(result.placements.map(p => p.sheet))].map(id => <li key={id}>
          {result.placements.filter(p => p.sheet === id).map(p => `${p.label} ${p.length} × ${p.width} mm`).join(' · ')}
        </li>)}</ol>
      </>}
      {result.status === 'too_long' && <p role="alert">These parts are longer than one board after the margins ({result.usable} mm): {result.labels.join(', ')}. Choose a longer board.</p>}
      {result.status !== 'ok' && result.status !== 'too_long' && 'message' in result && <p role="alert">{result.message}</p>}
      <p className="foundation-hint">A simple longest-first count, not an optimised layout. Check the wood for knots and cracks before cutting.</p>
    </section>
    <div className="foundation-actions">
      <button type="button" className="btn btn-primary" disabled={result.status !== 'ok'} onClick={() => onUse(entry)}>Use this size</button>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
    </div>
  </Modal>
}
