/** A fastener-rules-v1 schedule shaped as bob.read_construction_fasteners
 * returns it (owner decisions 2026-10-26); synthetic joints only. Drawings no
 * longer carry fasteners (owner decision 2026-10-26), so CAD tests use it only
 * to show that a version 2 answer from the dormant worker path is refused. */
type Joint = { joint_id: string; method: string | null; source: 'rule' | 'override' | 'no_rule' | 'existing'; kind: 'screw' | 'nail' | 'bolt' | 'glue' | 'none' | null;
  diameter_mm: number | null; length_mm: number | null; count: number | null; spacing_mm: number | null; through_instance_id: string | null; through_mm: number | null;
  embed_mm: number | null; contact_length_mm: number | null; contact_width_mm: number | null; proposal: Record<string, unknown> | null; gaps: string[] }
export type FastenerScheduleFixture = { rule_version: string; complete: boolean; glue_packages: 0 | 1; joints: Joint[];
  totals: { kind: 'screw' | 'nail' | 'bolt'; diameter_mm: number; length_mm: number; count: number; joint_ids: string[] }[] }

export function fastenerSchedule(): FastenerScheduleFixture {
  const joint = (joint_id: string, kind: Joint['kind'], d: number | null, length: number | null, count: number | null,
    source: Joint['source'] = 'rule', gaps: string[] = [], method = 'screwed_butt'): Joint =>
    ({ joint_id, method, source, kind, diameter_mm: d, length_mm: length, count, spacing_mm: null, through_instance_id: 'left', through_mm: 45,
      embed_mm: 900, contact_length_mm: 70, contact_width_mm: 45, proposal: null, gaps })
  return { rule_version: 'fastener-rules-v1', complete: false, glue_packages: 1,
    joints: [joint('left_rail', 'screw', 5, 120, 2), joint('right_rail', 'screw', 5, 120, 2), joint('glued', 'glue', null, null, null, 'rule', [], 'glued_butt'),
      joint('dowel', null, null, null, null, 'no_rule', ['no_rule_for_method'], 'dowel'),
      { ...joint('nailed', 'nail', 2.8, 50, 3, 'override', ['narrow_contact']), proposal: { kind: 'screw', diameter_mm: 4, length_mm: 45, count: 3, spacing_mm: 130 } }],
    totals: [{ kind: 'nail', diameter_mm: 2.8, length_mm: 50, count: 3, joint_ids: ['nailed'] },
      { kind: 'screw', diameter_mm: 5, length_mm: 120, count: 4, joint_ids: ['left_rail', 'right_rail'] }] }
}
