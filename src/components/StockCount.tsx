import { useState } from 'react'
import { inputStyle } from './form'
import { countBoards, countSheets, DEFAULT_KERF_MM, DEFAULT_MARGIN_MM, profileLength, type StockGroup } from '../domain/stockCount'

/** Owner design 2026-11-08: count boards or sheets right in the list from the raw
 * size seen in the shop. Only the count and the size show; kerf, margin and the
 * cut list sit under expands. The card colour tells the state (estimate, exact,
 * problem), with no legend. Nothing is saved to the project; the entered size is
 * remembered in this browser only. */

export type { StockGroup }

/** A starting point for the estimate only, replaced by what the person enters. */
const COMMON_BOARD_MM = 3600
const UNITS = { mm: 1, cm: 10, m: 1000 } as const
type Unit = keyof typeof UNITS

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

export type StockState = 'estimate' | 'exact' | 'problem'

export function StockCountRow({ group }: { group: StockGroup }) {
  const [entered, setEntered] = useState(() => remembered(group) !== null)
  const [entry, setEntry] = useState<Entry>(() => remembered(group) ?? defaults(group))
  const sheet = isSheet(group)
  const { kind, result } = compute(group, entry)
  const state: StockState = result.status !== 'ok' ? 'problem' : entered ? 'exact' : 'estimate'
  const set = (field: keyof Entry) => (event: { target: { value: string } }) => {
    const next = { ...entry, [field]: event.target.value }
    setEntry(next); setEntered(true); remember(group, next)
  }
  const count = result.status === 'ok' ? ('sheets' in result ? plural(result.sheets, 'sheet', 'sheets') : 'boards' in result ? plural(result.boards.length, 'board', 'boards') : '') : null
  const small = { ...inputStyle, width: '6.5em', minWidth: 0 }
  return <div className="stock-row shop-state" data-state={state}>
    <div className="stock-row-line">
      <strong className="stock-row-name">{group.name}</strong>
      <span className="stock-row-count">{count ? (state === 'estimate' ? '≈ ' : '') + count : '?'}</span>
      <span className="stock-row-size">
        <input style={small} inputMode="decimal" aria-label={sheet ? 'Sheet length' : 'Raw board length'} value={entry.raw} onChange={set('raw')} />
        {sheet && <>×<input style={small} inputMode="decimal" aria-label="Sheet width" value={entry.rawWidth} onChange={set('rawWidth')} /></>}
        <select style={{ ...inputStyle, width: 'auto' }} aria-label="Unit" value={entry.unit} onChange={set('unit')}>{Object.keys(UNITS).map(unit => <option key={unit}>{unit}</option>)}</select>
      </span>
    </div>
    {result.status === 'too_long' && <p role="alert" className="stock-row-alert">Longer than {result.usable} mm: {result.labels.join(', ')}</p>}
    {result.status !== 'ok' && result.status !== 'too_long' && 'message' in result && <p role="alert" className="stock-row-alert">{result.message}</p>}
    {result.status === 'ok' && <details className="ui-row-details stock-row-more">
      <summary>Cut list</summary>
      <ol>{kind === 'board' && 'boards' in result ? result.boards.map((board, index) => <li key={index}>
        {board.pieces.map(piece => `${piece.label} ${piece.length}`).join(' · ')} <span className="foundation-hint">· offcut {metres(board.offcut)}</span>
      </li>) : 'placements' in result ? [...new Set(result.placements.map(p => p.sheet))].map(id => <li key={id}>
        {result.placements.filter(p => p.sheet === id).map(p => `${p.label} ${p.length}×${p.width}`).join(' · ')}
      </li>) : null}</ol>
      <p className="foundation-hint">mm · longest first, not an optimised layout.</p>
    </details>}
    <details className="ui-row-details stock-row-more">
      <summary>Kerf and margin</summary>
      <div className="stock-row-fields">
        <label>Kerf (mm) <input style={small} inputMode="decimal" value={entry.kerf} onChange={set('kerf')} /></label>
        <label>{sheet ? 'Edge' : 'End'} margin (mm) <input style={small} inputMode="decimal" value={entry.margin} onChange={set('margin')} /></label>
      </div>
    </details>
  </div>
}
