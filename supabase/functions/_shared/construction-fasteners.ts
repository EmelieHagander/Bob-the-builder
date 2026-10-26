/** Joint fasteners (owner decisions 2026-10-26). The database owns the rule
 * (bob_private.construction_fastener_schedule, fastener-rules-v1): screws by
 * board thickness, glue for glued joints. A joint may carry an explicit
 * override chosen with the owner, for example nails. Null means "use the rule".
 * The schedule is a rule-of-thumb proposal, not a strength calculation. */
const size = { anyOf: [{ type: 'number', minimum: 0.1, maximum: 2000 }, { type: 'null' }] }
export const JOINT_FASTENER_SCHEMA = {
  description: 'Null uses the fixed rule: screwed_butt gets a screw sized from the board thickness, glued_butt gets glue. Set only when the owner chose another fastener (for example nails): kind plus diameter and length in mm; leave count and spacing null to spread them by rule.',
  anyOf: [{ type: 'null' }, {
    type: 'object', additionalProperties: false, required: ['kind', 'diameter_mm', 'length_mm', 'count', 'spacing_mm', 'reason'],
    properties: {
      kind: { type: 'string', enum: ['screw', 'nail', 'bolt', 'glue', 'none'] },
      diameter_mm: size, length_mm: size,
      count: { anyOf: [{ type: 'integer', minimum: 1, maximum: 10000 }, { type: 'null' }] },
      spacing_mm: size,
      reason: { type: 'string', minLength: 1, maxLength: 500 },
    },
  }],
}

type Row = Record<string, any>
const isObject = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)

/** Older pinned tool schemas have no fastener field: treat it as "use the rule". */
export function withRuleFasteners(joints: unknown): unknown {
  return Array.isArray(joints) ? joints.map(j => isObject(j) && !('fastener' in j) ? { ...j, fastener: null } : j) : joints
}
/** Only explicit overrides are stored; every other joint keeps its five fields. */
export function storedJoints<T>(joints: T): T {
  return (Array.isArray(joints) ? joints.map(j => isObject(j) && j.fastener == null ? (({ fastener: _f, ...rest }) => rest)(j) : j) : joints) as T
}

export type FastenerSchedule = { status?: string; rule_version: string; complete: boolean; glue_packages: number;
  joints: Row[]; totals: Row[] }
export function parseFastenerSchedule(value: unknown, artifactId: string, revision: number): FastenerSchedule | null {
  if (!isObject(value) || value.status !== 'ok' || value.artifact_id !== artifactId || value.revision !== revision
    || value.rule_version !== 'fastener-rules-v1' || !Array.isArray(value.joints) || !Array.isArray(value.totals)
    || typeof value.complete !== 'boolean' || typeof value.glue_packages !== 'number') return null
  return value as FastenerSchedule
}

/** Publications before 2026-10-26 predate joint fasteners. Rebuild their exact
 * joint schema (field order included) from the current one. */
export function withoutJointFasteners<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (!isObject(v)) return v
    const out: Row = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    const props = out.properties
    if (isObject(props) && 'fastener' in props && ['id', 'method', 'first', 'second', 'reason'].every(k => k in props)) {
      const { fastener: _f, ...rest } = props
      out.properties = rest
      if (Array.isArray(out.required)) out.required = out.required.filter((k: unknown) => k !== 'fastener')
    }
    return out
  }
  return walk(value) as T
}
