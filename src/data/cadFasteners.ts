import { fastenerKindLabel, fastenerNoteLabel } from '../lib/labels'

/** One grouped row of the construction's fastener schedule, numbered like the CAD sheet. */
export interface CadFastenerRow { number: string; fastener: string; size: string; quantity: number; basis: string }
export interface CadFastenerSummary { rows: CadFastenerRow[]; glue: string | null; unsized: number; notes: { label: string; joints: number }[] }

const MECHANICAL = ['screw', 'nail', 'bolt']
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
// Diameters read like the rule table (3.5, 4.0 … 6.0), as on the sheet.
const diameter = (d: number) => Math.abs(d * 10 - Math.round(d * 10)) < 1e-9 ? d.toFixed(1) : String(d)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The fastener schedule saved with this drawing version (annotations version
 * 2, owner decisions 2026-10-26): a rule-of-thumb proposal from the saved
 * construction, not a strength calculation. 'none' when the version carries no
 * schedule; 'unreadable' when it cannot be shown faithfully. F1, F2… follow the
 * saved totals, the order the CAD sheet uses.
 */
export function cadFastenerSummary(manifest: Record<string, any>): CadFastenerSummary | 'none' | 'unreadable' {
  const schedule = manifest.annotations?.fasteners
  if (schedule === undefined) return 'none'
  if (!schedule || !Array.isArray(schedule.joints) || !Array.isArray(schedule.totals)) return 'unreadable'
  const joints: any[] = schedule.joints, sources = new Map(joints.map(j => [j?.joint_id, j?.source]))
  const rows: CadFastenerRow[] = []
  for (const [index, total] of (schedule.totals as any[]).entries()) {
    if (!MECHANICAL.includes(total?.kind) || !finite(total.diameter_mm) || !finite(total.length_mm) || !Number.isSafeInteger(total.count) || !Array.isArray(total.joint_ids)) return 'unreadable'
    const basis = new Set(total.joint_ids.map((id: unknown) => sources.get(id)))
    rows.push({ number: `F${index + 1}`, fastener: fastenerKindLabel(total.kind), size: `Ø ${diameter(total.diameter_mm)} × ${total.length_mm}`, quantity: total.count,
      basis: basis.size === 1 && basis.has('rule') ? 'Rule of thumb' : basis.size === 1 && basis.has('override') ? 'Chosen instead of the rule' : 'Rule of thumb and chosen' })
  }
  const glued = joints.filter(j => j?.kind === 'glue').length
  const glue = finite(schedule.glue_packages) && schedule.glue_packages > 0
    ? `Glue: ${plural(schedule.glue_packages, 'package', 'packages')} for ${plural(glued, 'glued joint', 'glued joints')}.` : null
  const unsized = joints.filter(j => j?.source === 'no_rule' || MECHANICAL.includes(j?.kind) && [j.diameter_mm, j.length_mm, j.count].some(v => v === null)).length
  const counts = new Map<string, number>()
  for (const j of joints) for (const code of Array.isArray(j?.gaps) ? new Set<string>(j.gaps) : []) {
    const label = fastenerNoteLabel(String(code)); counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return { rows, glue, unsized, notes: [...counts].map(([label, count]) => ({ label, joints: count })) }
}
