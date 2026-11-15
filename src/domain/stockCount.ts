import { constructionCutFit } from '../../supabase/functions/_shared/construction-cut-fit.ts'

/** Owner design 2026-11-08: the person enters the raw board length or sheet size
 * they see in the shop, with saw kerf and an edge margin, and code counts how
 * many to buy and which part comes from which board. Nothing is saved; the
 * defaults are editable starting points, not measured facts. */

export const DEFAULT_KERF_MM = 3
export const DEFAULT_MARGIN_MM = 10

export type StockPiece = { label: string; length: number }
export type Board = { pieces: StockPiece[]; offcut: number }
export type LinearCount =
  | { status: 'ok'; boards: Board[] }
  | { status: 'too_long'; labels: string[]; usable: number }
  | { status: 'invalid'; message: string }

const finite = (n: number) => Number.isFinite(n) && n >= 0

/** First fit, longest first: each board loses the margin at both ends and one
 * kerf per cut between parts. A simple, predictable rule, not an optimum. */
export function countBoards(pieces: StockPiece[], rawLength: number, kerf: number, margin: number): LinearCount {
  if (!finite(rawLength) || rawLength <= 0 || !finite(kerf) || !finite(margin)) return { status: 'invalid', message: 'Enter a raw length above zero and a kerf and margin of zero or more.' }
  const usable = rawLength - 2 * margin
  if (usable <= 0) return { status: 'invalid', message: 'The margins use the whole board.' }
  const tooLong = pieces.filter(p => p.length > usable).map(p => p.label)
  if (tooLong.length) return { status: 'too_long', labels: tooLong, usable }
  const boards: { pieces: StockPiece[]; used: number }[] = []
  for (const piece of [...pieces].sort((a, b) => b.length - a.length || a.label.localeCompare(b.label))) {
    const board = boards.find(b => b.used + kerf + piece.length <= usable)
    if (board) { board.pieces.push(piece); board.used += kerf + piece.length }
    else boards.push({ pieces: [piece], used: piece.length })
  }
  return { status: 'ok', boards: boards.map(b => ({ pieces: b.pieces, offcut: Math.max(0, usable - b.used) })) }
}

type Dimensions = { x: number; y: number; z: number }
const AXES = ['x', 'y', 'z'] as const

/** A board part's length: the axis left after the profile's thickness and width; else the longest. */
export function profileLength(d: Dimensions, thickness: number | null, width: number | null): number {
  const rest = AXES.map(a => d[a])
  for (const size of [thickness, width]) {
    if (size === null) continue
    const at = rest.findIndex(v => Math.abs(v - size) < 0.01)
    if (at >= 0 && rest.length > 1) rest.splice(at, 1)
  }
  return Math.max(...rest)
}

export type SheetPart = { definitionId: string; label: string; quantity: number; dimensions: Dimensions }
export type SheetCount =
  | { status: 'ok'; sheets: number; placements: { sheet: string; label: string; length: number; width: number }[] }
  | { status: 'not_found' | 'unsupported' | 'invalid'; message: string }

/** Counts whole sheets with the existing guillotine check, trying 1 to 16 sheets. */
export function countSheets(parts: SheetPart[], material: { id: string; revision: number; thickness: number },
  sheet: { length: number; width: number }, kerf: number, margin: number): SheetCount {
  if (![sheet.length, sheet.width].every(v => finite(v) && v > 0) || !finite(kerf) || !finite(margin)) return { status: 'invalid', message: 'Enter a sheet size above zero and a kerf and margin of zero or more.' }
  const cuts: Record<string, unknown>[] = []
  for (const part of parts) {
    const thicknessAxes = AXES.filter(a => Math.abs(part.dimensions[a] - material.thickness) < 0.01)
    if (thicknessAxes.length !== 1) return { status: 'unsupported', message: `Part ${part.label} has no single side matching the sheet thickness.` }
    for (let i = 0; i < part.quantity; i++) cuts.push({ instance_id: `${part.definitionId}:${i + 1}`, definition_id: part.definitionId,
      label: part.quantity > 1 ? `${part.label} ${i + 1}` : part.label, material_id: material.id, material_revision: material.revision,
      blank_mm: part.dimensions, thickness_axes: [thicknessAxes[0]] })
  }
  if (cuts.length > 24) return { status: 'unsupported', message: 'This check handles at most 24 sheet parts at a time.' }
  const lists = { source: null, bom: parts.map(p => ({ definition_id: p.definitionId, material_id: material.id, material_revision: material.revision })), cuts }
  const grains = parts.map(p => ({ definition_id: p.definitionId, axis: 'none' as const }))
  for (let count = 1; count <= 16; count++) {
    const fit: Record<string, any> = constructionCutFit(lists, [{ id: 's', material_id: material.id, material_revision: material.revision,
      length_mm: sheet.length, width_mm: sheet.width, thickness_mm: material.thickness, count, kerf_mm: kerf, trim_mm: margin,
      grain: 'none', basis: 'design_choice', note: 'Entered in the shop' }], grains)
    if (fit.status === 'feasible') return { status: 'ok', sheets: new Set(fit.placements.map((p: any) => p.sheet_id)).size,
      placements: fit.placements.map((p: any) => ({ sheet: p.sheet_id, label: p.label, length: p.length_mm, width: p.width_mm })) }
    if (fit.status === 'infeasible' || fit.status === 'invalid' || fit.status === 'unsupported') return { status: fit.status === 'infeasible' ? 'not_found' : fit.status, message: fit.reason ?? 'These parts do not fit this sheet.' }
  }
  return { status: 'not_found', message: 'No layout was found within 16 sheets.' }
}

/** One material to buy, with every part cut from it. Sizes come from the saved
 * catalog record; the sheet size only when the material states one. */
export type StockGroup = {
  key: string
  materialId: string
  materialRevision: number
  name: string
  profile: string
  thickness: number | null
  width: number | null
  sheet: { length: number; width: number } | null
  parts: SheetPart[]
}

type CatalogRecord = Record<string, any> | undefined
type PreviewPart = { definitionId: string; materialId: string; materialRevision: number; materialName: string; quantity: number; dimensions: Dimensions }

const sizeValue = (record: CatalogRecord, key: string) => {
  const value = Number(record?.properties?.[key]?.value)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** The sheet size a saved sheet material states, from its length/width or its nominal size "15 × 1220 × 2440". */
export function sheetSize(record: CatalogRecord, thickness: number | null) {
  const length = sizeValue(record, 'length'), width = sizeValue(record, 'width')
  if (length && width) return { length: Math.max(length, width), width: Math.min(length, width) }
  const numbers = String(record?.properties?.nominal_size?.value ?? '').match(/\d+(?:[.,]\d+)?/g)?.map(n => Number(n.replace(',', '.'))) ?? []
  const rest = numbers.length === 3 && thickness !== null && numbers.includes(thickness) ? numbers.filter((_, i) => i !== numbers.indexOf(thickness)) : []
  return rest.length === 2 ? { length: Math.max(...rest), width: Math.min(...rest) } : null
}

const partName = (id: string) => id.replace(/^d_/, '').replace(/[_-]+/g, ' ')

/** Groups preview parts by exact material version; `into` lets several constructions share one list. */
export function stockGroups(parts: PreviewPart[], catalog: Map<string, CatalogRecord>, from: { id: string; title: string } | null = null, into = new Map<string, StockGroup>()) {
  for (const part of parts) {
    const key = part.materialId + '@' + part.materialRevision
    const sheetPart: SheetPart = { definitionId: (from ? from.id + ':' : '') + part.definitionId,
      label: (from ? from.title + ' · ' : '') + partName(part.definitionId), quantity: part.quantity, dimensions: part.dimensions }
    const existing = into.get(key)
    if (existing) { existing.parts.push(sheetPart); continue }
    const record = catalog.get(key), thickness = sizeValue(record, 'thickness')
    into.set(key, { key, materialId: part.materialId, materialRevision: part.materialRevision, name: part.materialName,
      profile: String(record?.profile_code ?? ''), thickness, width: sizeValue(record, 'width'),
      sheet: record?.profile_code === 'sheet_stock' ? sheetSize(record, thickness) : null, parts: [sheetPart] })
  }
  return into
}
