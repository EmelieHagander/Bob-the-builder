import type { CadFastenerSchedule, CadFastenerJoint } from '../../supabase/functions/_shared/cad-adapter.ts'

/** A fastener-rules-v1 schedule shaped as bob.read_construction_fasteners
 * returns it (owner decisions 2026-10-26); synthetic joints only. */
export function fastenerSchedule(): CadFastenerSchedule {
  const joint = (joint_id: string, kind: CadFastenerJoint['kind'], d: number | null, length: number | null, count: number | null,
    source: CadFastenerJoint['source'] = 'rule', gaps: string[] = [], method = 'screwed_butt'): CadFastenerJoint =>
    ({ joint_id, method, source, kind, diameter_mm: d, length_mm: length, count, spacing_mm: null, through_instance_id: 'left', through_mm: 45,
      embed_mm: 900, contact_length_mm: 70, contact_width_mm: 45, proposal: null, gaps })
  return { rule_version: 'fastener-rules-v1', complete: false, glue_packages: 1,
    joints: [joint('left_rail', 'screw', 5, 120, 2), joint('right_rail', 'screw', 5, 120, 2), joint('glued', 'glue', null, null, null, 'rule', [], 'glued_butt'),
      joint('dowel', null, null, null, null, 'no_rule', ['no_rule_for_method'], 'dowel'),
      { ...joint('nailed', 'nail', 2.8, 50, 3, 'override', ['narrow_contact']), proposal: { kind: 'screw', diameter_mm: 4, length_mm: 45, count: 3, spacing_mm: 130 } }],
    totals: [{ kind: 'nail', diameter_mm: 2.8, length_mm: 50, count: 3, joint_ids: ['nailed'] },
      { kind: 'screw', diameter_mm: 5, length_mm: 120, count: 4, joint_ids: ['left_rail', 'right_rail'] }] }
}
