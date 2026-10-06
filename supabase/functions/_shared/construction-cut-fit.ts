/** Concrete guillotine layouts for explicit candidate sheets. This read-only
 * assessment is neither a stock reservation nor an optimal purchase count. */
export const CUT_FIT_VERSION = 'construction-sheet-guillotine-v1'
type Axis = 'x' | 'y' | 'z'
type Row = Record<string, any>
export type SheetCandidate = { id: string; material_id: string; material_revision: number;
 length_mm: number | null; width_mm: number | null; thickness_mm: number | null; count: number;
 kerf_mm: number | null; trim_mm: number | null; grain: 'length' | 'width' | 'none' | null;
 basis: 'design_choice' | 'provided_spec'; note: string }
export type BlankGrain = { definition_id: string; axis: Axis | 'none' | null }
type Rect = { sheet: string; x: number; y: number; w: number; h: number }
type Blank = { instance: string; definition: string; label: string; material: string; revision: number;
 thickness: number; a: Axis; b: Axis; w: number; h: number; grain: Axis | 'none' }
const SCALE = 1_000_000
// Integer geometry at the catalog's six-decimal working-mm precision. Area is
// used only to order the search, never to accept a layout or derive purchases.
function units(n: number) {
 const v = Math.round(n * SCALE)
 if (!Number.isFinite(n) || n < 0 || n > 1_000_000 || !Number.isSafeInteger(v)
  || Math.abs(n - v / SCALE) > Number.EPSILON * Math.max(1, Math.abs(n)) * 4) throw new Error('cut_fit_precision')
 return v
}
const mm = (n: number) => n / SCALE

export function constructionCutFit(lists: Row, candidates: SheetCandidate[], grains: BlankGrain[]) {
 const common = { calculation_version: CUT_FIT_VERSION, source: lists.source,
  candidate_inputs: structuredClone(candidates), grain_inputs: structuredClone(grains),
  saved: false, fabrication_ready: false, stock_reserved: false, shopping_ready: false,
  input_evidence_verified: false, message: 'Geometric assessment of explicit candidate specifications/design choices only. Physical stock, condition, product suitability and reservations are not verified. Keep the existing saved blank requirements; this result cannot unlock allocation or Shopping.' }
 const result = (status: string, extra: Row = {}) => ({ ...common, status, ...extra })
 const definitions = new Set<string>(lists.bom.map((r: Row) => r.definition_id))
 if (new Set(candidates.map(c => c.id)).size !== candidates.length || new Set(grains.map(g => g.definition_id)).size !== grains.length
  || grains.length !== definitions.size || grains.some(g => !definitions.has(g.definition_id)))
  return result('invalid', { reason: 'Name each used definition exactly once for grain, and use distinct candidate IDs.' })
 if (lists.cuts.length > 24 || candidates.reduce((n, c) => n + c.count, 0) > 16)
  return result('unsupported', { reason: 'This bounded assessment supports at most 24 blanks and 16 candidate sheets.' })
 const materialKeys = new Set(lists.bom.map((r: Row) => `${r.material_id}@${r.material_revision}`))
 if (candidates.some(c => !materialKeys.has(`${c.material_id}@${c.material_revision}`)))
  return result('invalid', { reason: 'Each candidate must pin an exact material revision used by this construction.' })
 const missing = candidates.filter(c => [c.length_mm, c.width_mm, c.thickness_mm, c.kerf_mm, c.trim_mm, c.grain].some(v => v === null)).map(c => c.id)
 const missingGrain = grains.filter(g => g.axis === null).map(g => g.definition_id)
 if (missing.length || missingGrain.length) return result('needs_data', { reason: 'Supply raw format, thickness, kerf, edge trim and grain explicitly; unknown is not zero or unrestricted rotation.', candidate_ids: missing, definition_ids: missingGrain })
 try {
  const blankRows: Blank[] = []
  for (const cut of lists.cuts as Row[]) {
   if (cut.thickness_axes.length !== 1) return result('unsupported', { reason: 'Each sheet blank needs exactly one unambiguous thickness axis.', definition_id: cut.definition_id })
   const thicknessAxis = cut.thickness_axes[0] as Axis
   const [a, b] = (['x', 'y', 'z'] as Axis[]).filter(axis => axis !== thicknessAxis)
   const grain = grains.find(g => g.definition_id === cut.definition_id)!.axis!
   if (grain === thicknessAxis) return result('invalid', { reason: 'Blank grain must lie in its sheet plane.', definition_id: cut.definition_id })
   blankRows.push({ instance: cut.instance_id, definition: cut.definition_id, label: cut.label, material: cut.material_id, revision: cut.material_revision,
    thickness: units(cut.blank_mm[thicknessAxis]), a, b, w: units(cut.blank_mm[a]), h: units(cut.blank_mm[b]), grain })
  }
  const sheets = candidates.flatMap(c => Array.from({ length: c.count }, (_, i) => ({ ...c, sheet: `${c.id}:${i + 1}`,
   w: units(c.length_mm!), h: units(c.width_mm!), thickness: units(c.thickness_mm!), kerf: units(c.kerf_mm!), trim: units(c.trim_mm!) })))
  if (sheets.some(s => s.w <= 2 * s.trim || s.h <= 2 * s.trim)) return result('invalid', { reason: 'Edge trim leaves no usable sheet.' })
  const sheetById = new Map(sheets.map(s => [s.sheet, s]))
  const orientations = (b: Blank, r: Rect) => {
   const s = sheetById.get(r.sheet)!
   if (b.material !== s.material_id || b.revision !== s.material_revision || b.thickness !== s.thickness) return []
   return [false, true].filter(rotated => {
    const [w, h] = rotated ? [b.h, b.w] : [b.w, b.h]
    const lengthAxis = rotated ? b.b : b.a
    const widthAxis = rotated ? b.a : b.b
    return w <= r.w && h <= r.h && (b.grain === 'none'
     || (s.grain === 'length' && b.grain === lengthAxis) || (s.grain === 'width' && b.grain === widthAxis))
   })
  }
  const initial: Rect[] = sheets.map(s => ({ sheet: s.sheet, x: s.trim, y: s.trim, w: s.w - 2 * s.trim, h: s.h - 2 * s.trim }))
  const impossible = blankRows.filter(b => !initial.some(r => orientations(b, r).length)).map(b => b.instance)
  if (impossible.length) return result('infeasible', { reason: 'These blanks cannot fit any matching candidate sheet with the specified thickness, trim and grain, regardless of total area.', instance_ids: impossible })
  const ordered = [...blankRows].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h || a.instance.localeCompare(b.instance))
  let states = 0, exhausted = false
  const search = (index: number, free: Rect[], placements: Row[], cuts: Row[]): Row | null => {
   if (++states > 20_000) { exhausted = true; return null }
   if (index === ordered.length) return { placements, cuts, offcuts: free.map(r => ({ sheet_id: r.sheet, x_mm: mm(r.x), y_mm: mm(r.y), length_mm: mm(r.w), width_mm: mm(r.h) })) }
   const b = ordered[index]
   for (let j = 0; j < free.length; j++) {
    const r = free[j], s = sheetById.get(r.sheet)!
    for (const rotated of orientations(b, r)) for (const first of ['length', 'width']) {
     const [w, h] = rotated ? [b.h, b.w] : [b.w, b.h]
     // Conservative full-kerf clearance unless the blank uses an existing edge.
     if ((w < r.w && r.w - w < s.kerf) || (h < r.h && r.h - h < s.kerf)) continue
     const rw = r.w - w - s.kerf, rh = r.h - h - s.kerf
     const rest: Rect[] = []
     if (rw > 0) rest.push({ sheet: r.sheet, x: r.x + w + s.kerf, y: r.y, w: rw, h: first === 'length' ? r.h : h })
     if (rh > 0) rest.push({ sheet: r.sheet, x: r.x, y: r.y + h + s.kerf, w: first === 'width' ? r.w : w, h: rh })
     const operations: Row[] = []
     const cut = (axis: string, position: number, start: number, end: number) => operations.push({ sheet_id: r.sheet, before_instance_id: b.instance, axis, position_mm: mm(position), span_start_mm: mm(start), span_end_mm: mm(end), kerf_mm: mm(s.kerf) })
     if (first === 'length') {
      if (w < r.w) cut('length', r.x + w, r.y, r.y + r.h)
      if (h < r.h) cut('width', r.y + h, r.x, r.x + w)
     } else {
      if (h < r.h) cut('width', r.y + h, r.x, r.x + r.w)
      if (w < r.w) cut('length', r.x + w, r.y, r.y + h)
     }
     const placement = { instance_id: b.instance, definition_id: b.definition, label: b.label, sheet_id: r.sheet,
      x_mm: mm(r.x), y_mm: mm(r.y), length_mm: mm(w), width_mm: mm(h), thickness_mm: mm(b.thickness),
      length_axis: rotated ? b.b : b.a, width_axis: rotated ? b.a : b.b, grain_axis: b.grain }
     const found = search(index + 1, [...free.slice(0, j), ...free.slice(j + 1), ...rest], [...placements, placement], [...cuts, ...operations])
     if (found) return found
     if (exhausted) return null
    }
   }
   return null
  }
  const layout = search(0, initial, [], [])
  if (!layout) return result(exhausted ? 'search_limit' : 'no_layout_found', { reason: 'No layout found in this bounded, fixed-order guillotine search. This is not a proof of impossibility for other cutting strategies.', search_states: states })
  return result('feasible', { ...layout, search_states: states, used_sheets: [...new Set<string>(layout.placements.map((p: Row) => p.sheet_id))],
   layout_scope: 'Uncut rectangular blanks, exact material/thickness, explicit grain and conservative full-kerf guillotine cuts. Edge trim is pre-removed; trim-cut kerf lies outside the usable rectangle. Not an optimal sheet count.' })
 } catch {
  return result('unsupported', { reason: 'Working dimensions must be finite nonnegative mm within the six-decimal catalog precision and 1,000,000 mm bound.' })
 }
}
