import type { MaterialCutPlan } from '../data/materialPlanning'

export interface SavedCutSheet {
  id: string
  number: number
  length: number
  width: number
  thickness: number
  kerf: number
  trim: number
  grain: 'length' | 'width' | 'none'
  kind: 'hypothetical' | 'stock' | 'catalog_part'
  note: string
  parts: { label: string; x: number; y: number; length: number; width: number }[]
  cuts: { axis: 'length' | 'width'; position: number; start: number; end: number; kerf: number }[]
  offcuts: { x: number; y: number; length: number; width: number }[]
}

const dimension = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000000
const distance = (v: unknown): v is number => v === 0 || dimension(v)
const unavailable = () => { throw new Error('The saved cutting layout is unavailable.') }

/** Present saved coordinates, never rerun fitting or silently omit an unknown sheet. */
export function savedCutSheets(plan: MaterialCutPlan, source?: { id: string; revision: number } | null): SavedCutSheet[] {
  if (plan.saved !== true || !['current', 'changed'].includes(plan.source_state)
    || !Number.isSafeInteger(plan.current_revision) || plan.current_revision < plan.revision
    || source && (plan.artifact_id !== source.id || plan.artifact_revision !== source.revision)) return unavailable()
  const layout = plan.layout
  if (!layout || !Array.isArray(layout.used_sheets) || !layout.used_sheets.length || layout.used_sheets.length > 16
    || new Set(layout.used_sheets).size !== layout.used_sheets.length
    || !Array.isArray(plan.candidates) || !Array.isArray(plan.candidate_sources)
    || !Array.isArray(layout.placements) || !layout.placements.length || layout.placements.length > 24
    || !Array.isArray(layout.cuts) || !Array.isArray(layout.offcuts)) return unavailable()
  const sheets = layout.used_sheets.map((id, index): SavedCutSheet => {
    if (typeof id !== 'string') return unavailable()
    // Candidate IDs may themselves contain colons. Match the entire generated ID.
    const candidates = plan.candidates.filter(c => c && Number.isSafeInteger(c.count) && c.count > 0 && c.count <= 16
      && Array.from({ length: c.count }, (_, i) => `${c.id}:${i + 1}`).includes(id))
    if (candidates.length !== 1) return unavailable()
    const c = candidates[0], sources = plan.candidate_sources.filter(s => s?.candidate_id === c.id)
    if (sources.length !== 1 || !['hypothetical', 'stock', 'catalog_part'].includes(sources[0].kind)
      || !dimension(c.length_mm) || !dimension(c.width_mm) || !dimension(c.thickness_mm)
      || !distance(c.kerf_mm) || !distance(c.trim_mm) || !['length', 'width', 'none'].includes(c.grain)
      || typeof c.note !== 'string') return unavailable()
    return { id, number: index + 1, length: c.length_mm, width: c.width_mm, thickness: c.thickness_mm,
      kerf: c.kerf_mm, trim: c.trim_mm, grain: c.grain, kind: sources[0].kind, note: c.note, parts: [], cuts: [], offcuts: [] }
  })
  const byId = new Map(sheets.map(s => [s.id, s]))
  const rectangle = (r: Record<string, any>, sheet: SavedCutSheet) => distance(r.x_mm) && distance(r.y_mm)
    && dimension(r.length_mm) && dimension(r.width_mm)
    && r.x_mm + r.length_mm <= sheet.length + 0.000001 && r.y_mm + r.width_mm <= sheet.width + 0.000001
  const instances = new Set<string>()
  for (const p of layout.placements) {
    const sheet = byId.get(p?.sheet_id)
    if (!sheet || !rectangle(p, sheet) || typeof p.instance_id !== 'string' || instances.has(p.instance_id)
      || p.thickness_mm !== sheet.thickness || typeof p.label !== 'string' || !p.label.trim()) return unavailable()
    instances.add(p.instance_id)
    sheet.parts.push({ label: p.label, x: p.x_mm, y: p.y_mm, length: p.length_mm, width: p.width_mm })
  }
  for (const c of layout.cuts) {
    const sheet = byId.get(c?.sheet_id)
    if (!sheet || !['length', 'width'].includes(c.axis) || !distance(c.position_mm)
      || !distance(c.span_start_mm) || !dimension(c.span_end_mm) || c.span_end_mm <= c.span_start_mm
      || !distance(c.kerf_mm) || c.position_mm > (c.axis === 'length' ? sheet.length : sheet.width)
      || c.span_end_mm > (c.axis === 'length' ? sheet.width : sheet.length)) return unavailable()
    sheet.cuts.push({ axis: c.axis, position: c.position_mm, start: c.span_start_mm, end: c.span_end_mm, kerf: c.kerf_mm })
  }
  for (const o of layout.offcuts) {
    const sheet = byId.get(o?.sheet_id)
    if (!sheet || !rectangle(o, sheet)) return unavailable()
    sheet.offcuts.push({ x: o.x_mm, y: o.y_mm, length: o.length_mm, width: o.width_mm })
  }
  if (sheets.some(sheet => !sheet.parts.length)) return unavailable()
  return sheets
}
