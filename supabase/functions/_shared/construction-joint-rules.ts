import { constructionBox } from './construction-checks.ts'
import { JOINT_CHOSEN_FASTENERS_SCHEMA } from './construction-fasteners.ts'
import type { CadAssemblyRequest } from './cad-adapter.ts'

/** Owner decision 2026-11-07 (lean_construction_version 1): Konrad states how
 * two kinds of part are joined once, as a rule between two definitions, and
 * code writes the joint for every pair of such parts that touch face to face.
 * The rule is the declaration; contact alone still declares nothing, so a
 * touching pair without a rule or a joint stays contact_without_joint.
 * Entry, 2026-11-07: 21 joints of ~320 characters each, a quarter of the
 * wall Konrad typed in one answer. */
export type JointRule = { id: string; between: [string, string]; reason: string; fasteners: Record<string, unknown>[]; except?: [string, string][] }
/** What code wrote, for the answer: each joint, its parts and its rule. */
export type RuleJoint = { id: string; parts: [string, string]; rule: string }
export type RuleIssue = { code: string; path: string; message: string }
type Row = Record<string, any>

const ID = '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
export const JOINT_RULES_SCHEMA = {
  type: 'array', maxItems: 32,
  description: 'Your joining decision for two definitions: code writes one joint, with these fasteners and reason, for every pair of their parts that touch face to face and have no joint in joints. A pair of the same definition is ["stud","stud"]. Touching parts that must not be joined this way go in except; they stay unjoined until you give them a joint. Empty for none.',
  items: { type: 'object', additionalProperties: false, required: ['id', 'between', 'reason', 'fasteners', 'except'], properties: {
    id: { type: 'string', pattern: ID },
    between: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string', pattern: ID } },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    fasteners: JOINT_CHOSEN_FASTENERS_SCHEMA,
    except: { type: 'array', maxItems: 64, description: 'Part id pairs this rule does not join, e.g. a part that rests, slides or is removable.',
      items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string', pattern: ID } } },
  } },
}

const tolerance = 0.000001
const pair = (a: string, b: string) => JSON.stringify([a, b].sort())
function fnv(text: string): string {
  let h = 0xcbf29ce484222325n
  for (const ch of new TextEncoder().encode(text)) { h ^= BigInt(ch); h = (h * 0x100000001b3n) & 0xffffffffffffffffn }
  return h.toString(16).padStart(16, '0').slice(0, 12)
}
/** A stable joint id for one pair, the same in every save and edit. */
export function ruleJointId(a: string, b: string): string {
  const [x, y] = [a, b].sort(), id = `jr.${x}.${y}`
  return id.length <= 80 ? id : 'jr.' + fnv(`${x}|${y}`)
}

/** Joints for the touching pairs the rules cover. recipe holds computed
 * numbers; joints are the joints already declared or saved. */
export function ruleJoints(recipe: CadAssemblyRequest, joints: Row[], rules: JointRule[], roles: Map<string, string>): { joints: Row[]; made: RuleJoint[]; issues: RuleIssue[] } {
  const issues: RuleIssue[] = [], out: Row[] = [], made: RuleJoint[] = []
  if (!rules.length) return { joints: out, made, issues }
  const definitions = new Map(recipe.definitions.map(d => [d.id, d as Row]))
  const seen = new Set<string>()
  rules.forEach((r, i) => {
    if (seen.has(r.id)) issues.push({ code: 'joint_rule_duplicate', path: `joint_rules/${i}`, message: 'Give each rule its own id.' })
    seen.add(r.id)
    for (const d of r.between) if (!definitions.has(d)) issues.push({ code: 'joint_rule_unknown_definition', path: `joint_rules/${i}/between`, message: `No definition ${d} in this construction.` })
  })
  if (issues.length) return { joints: out, made, issues }
  const excluded = new Set(rules.flatMap(r => (r.except ?? []).map(p => `${r.id}|${pair(p[0], p[1])}`)))
  const byPair = new Map<string, JointRule[]>()
  for (const r of rules) byPair.set(pair(...r.between), [...(byPair.get(pair(...r.between)) ?? []), r])
  const joined = new Set(joints.map(j => pair(j?.first?.instance_id, j?.second?.instance_id)))
  const taken = new Set(joints.map(j => j?.id))
  const boxes = recipe.instances.flatMap(i => {
    if (roles.get(i.id) === 'reference') return []
    const box = constructionBox(i as Row, definitions.get(i.definition_id)!)
    return box ? [{ box, definition: i.definition_id, existing: roles.get(i.id) === 'existing_part' }] : []
  })
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    if (a.existing && b.existing) continue // Two parts that already exist are already joined.
    if (joined.has(pair(a.box.id, b.box.id))) continue
    const overlap = [0, 1, 2].map(k => Math.min(a.box.max[k], b.box.max[k]) - Math.max(a.box.min[k], b.box.min[k]))
    if (overlap.filter(v => Math.abs(v) <= tolerance).length !== 1 || overlap.filter(v => v > tolerance).length !== 2) continue
    const matched = (byPair.get(pair(a.definition, b.definition)) ?? []).filter(r => !excluded.has(`${r.id}|${pair(a.box.id, b.box.id)}`))
    if (!matched.length) continue
    if (matched.length > 1) { issues.push({ code: 'joint_rule_ambiguous', path: `joint_rules/${matched.map(r => r.id).join(',')}`, message: `Several rules join ${a.definition} and ${b.definition}; keep one.` }); continue }
    const axis = overlap.findIndex(v => Math.abs(v) <= tolerance)
    // a below b along the contact axis, or the other way round.
    const [low, high] = Math.abs(a.box.max[axis] - b.box.min[axis]) <= tolerance ? [a.box, b.box] : [b.box, a.box]
    const face = (box: typeof a.box, sign: number) => [...box.faces].find(([, f]) => f.axis === axis && f.sign === sign)?.[0]
    const first = face(low, 1), second = face(high, -1)
    if (!first || !second) continue
    const id = ruleJointId(low.id, high.id)
    if (taken.has(id)) { issues.push({ code: 'joint_rule_id_taken', path: `joints/${id}`, message: 'A declared joint already uses the id code gives this pair.' }); continue }
    taken.add(id)
    out.push({ id, first: { instance_id: low.id, face: first }, second: { instance_id: high.id, face: second }, reason: matched[0].reason, fasteners: structuredClone(matched[0].fasteners) })
    made.push({ id, parts: [low.id, high.id], rule: matched[0].id })
  }
  return { joints: out, made, issues }
}
