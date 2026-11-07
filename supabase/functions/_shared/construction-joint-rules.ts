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
export type RuleJoint = { id: string; parts: [string, string]; rule: string | null }
export type RuleIssue = { code: string; path: string; message: string }
type Row = Record<string, any>

const ID = '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
export const JOINT_RULES_SCHEMA = {
  type: 'array', maxItems: 32,
  description: 'Your joining decision for two definitions, existing parts included: code writes one joint, with these fasteners and reason, for each pair of their parts that touch face to face and have no joint. In a part edit it joins the parts the edit adds or changes; an edit with only rules applies them to every touching pair and restates the joints code wrote for them. A pair of the same definition is ["stud","stud"]. Touching parts that must not be joined this way go in except and stay unjoined until they get a joint. Empty for none.',
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
/** A stable joint id for one pair, the same in every save and edit. Part ids
 * may hold dots, so a pair with one gets a short hash of the exact pair. */
export function ruleJointId(a: string, b: string): string {
  const [x, y] = [a, b].sort(), id = x.includes('.') || y.includes('.') ? `jr.${x}.${y}.${fnv(`${x}|${y}`).slice(0, 4)}` : `jr.${x}.${y}`
  return id.length <= 80 ? id : 'jr.' + fnv(`${x}|${y}`)
}
export const RULE_JOINT_PREFIX = 'jr.'
/** touched: in a part edit, only pairs with a part the edit adds or changes get
 * a new joint, so an except from an earlier save still holds for the others.
 * rewrite: an edit sending only rules restates the decision, so code's joints
 * of covered pairs take the rule's fasteners and reason. */
export type RuleScope = { touched?: Set<string>; rewrite?: boolean }

/** Joints for the touching pairs the rules cover. recipe holds computed
 * numbers; joints are the joints already declared or saved. A joint code wrote
 * earlier (id jr.) is code's to keep in step: written again when its parts
 * moved and its faces no longer meet, and named in stale when its parts no
 * longer touch or are gone. */
export function ruleJoints(recipe: CadAssemblyRequest, joints: Row[], rules: JointRule[], roles: Map<string, string>, scope: RuleScope = {}): { joints: Row[]; made: RuleJoint[]; issues: RuleIssue[]; stale: string[] } {
  const issues: RuleIssue[] = [], out: Row[] = [], made: RuleJoint[] = []
  const definitions = new Map(recipe.definitions.map(d => [d.id, d as Row]))
  const seen = new Set<string>()
  rules.forEach((r, i) => {
    if (seen.has(r.id)) issues.push({ code: 'joint_rule_duplicate', path: `joint_rules/${i}`, message: 'Give each rule its own id.' })
    seen.add(r.id)
    for (const d of r.between) if (!definitions.has(d)) issues.push({ code: 'joint_rule_unknown_definition', path: `joint_rules/${i}/between`, message: `No definition ${d} in this construction.` })
  })
  if (issues.length) return { joints: out, made, issues, stale: [] }
  const excluded = new Set(rules.flatMap(r => (r.except ?? []).map(p => `${r.id}|${pair(p[0], p[1])}`)))
  const byPair = new Map<string, JointRule[]>()
  for (const r of rules) byPair.set(pair(...r.between), [...(byPair.get(pair(...r.between)) ?? []), r])
  const jointOf = new Map<string, Row>()
  for (const j of joints) jointOf.set(pair(j?.first?.instance_id, j?.second?.instance_id), j)
  const taken = new Set(joints.map(j => j?.id))
  const boxes = recipe.instances.flatMap(i => {
    if (roles.get(i.id) === 'reference') return []
    const box = constructionBox(i as Row, definitions.get(i.definition_id)!)
    return box ? [{ box, definition: i.definition_id }] : []
  })
  const boxOf = new Map(boxes.map(b => [b.box.id, b.box]))
  // The checker's test: local faces opposed on one plane with positive contact area.
  const meets = (j: Row) => {
    const a = boxOf.get(j?.first?.instance_id), b = boxOf.get(j?.second?.instance_id)
    const fa = a?.faces.get(j.first.face), fb = b?.faces.get(j.second.face)
    return !!a && !!b && !!fa && !!fb && a.id !== b.id && fa.axis === fb.axis && fa.sign === -fb.sign && Math.abs(fa.plane - fb.plane) <= tolerance
      && [0, 1, 2].every(k => k === fa.axis || Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > tolerance)
  }
  const touching = new Set<string>()
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    const overlap = [0, 1, 2].map(k => Math.min(a.box.max[k], b.box.max[k]) - Math.max(a.box.min[k], b.box.min[k]))
    if (overlap.filter(v => Math.abs(v) <= tolerance).length !== 1 || overlap.filter(v => v > tolerance).length !== 2) continue
    const key = pair(a.box.id, b.box.id), earlier = jointOf.get(key)
    touching.add(key)
    const code = typeof earlier?.id === 'string' && earlier.id.startsWith(RULE_JOINT_PREFIX)
    const matched = (byPair.get(pair(a.definition, b.definition)) ?? []).filter(r => !excluded.has(`${r.id}|${key}`))
    const restated = code && scope.rewrite && matched.length === 1
      && (earlier!.reason !== matched[0].reason || JSON.stringify(earlier!.fasteners ?? []) !== JSON.stringify(matched[0].fasteners))
    if (earlier && (!code || meets(earlier)) && !restated) continue
    if (!earlier && scope.touched && !scope.touched.has(a.box.id) && !scope.touched.has(b.box.id)) continue
    // A code joint whose parts moved keeps its fasteners and reason unless a rule is sent again.
    if (!matched.length && !earlier) continue
    if (matched.length > 1) { issues.push({ code: 'joint_rule_ambiguous', path: `joint_rules/${matched.map(r => r.id).join(',')}`, message: `Several rules join ${a.definition} and ${b.definition}; keep one.` }); continue }
    const axis = overlap.findIndex(v => Math.abs(v) <= tolerance)
    // a below b along the contact axis, or the other way round.
    const [low, high] = Math.abs(a.box.max[axis] - b.box.min[axis]) <= tolerance ? [a.box, b.box] : [b.box, a.box]
    const face = (box: typeof a.box, sign: number) => [...box.faces].find(([, f]) => f.axis === axis && f.sign === sign)?.[0]
    const first = face(low, 1), second = face(high, -1)
    if (!first || !second) continue
    const id = earlier ? earlier.id as string : ruleJointId(low.id, high.id)
    if (!earlier && taken.has(id)) { issues.push({ code: 'joint_rule_id_taken', path: `joints/${id}`, message: 'A declared joint already uses the id code gives this pair.' }); continue }
    taken.add(id)
    // Existing parts are joined as the rule says; except is where they are not.
    const rule = matched[0] ?? null
    out.push({ id, first: { instance_id: low.id, face: first }, second: { instance_id: high.id, face: second },
      reason: rule ? rule.reason : earlier!.reason, fasteners: structuredClone(rule ? rule.fasteners : earlier!.fasteners ?? []) })
    made.push({ id, parts: [low.id, high.id], rule: rule?.id ?? null })
  }
  // Code's joints whose parts are gone, or both still checkable as boxes and
  // no longer touching. A part that became a cut, turned or other shape is not
  // checked here, so its joints stay (audit round 2).
  const present = new Set(recipe.instances.map(i => i.id))
  const stale = joints.filter(j => {
    if (typeof j?.id !== 'string' || !j.id.startsWith(RULE_JOINT_PREFIX)) return false
    const a = j.first?.instance_id, b = j.second?.instance_id
    if (!present.has(a) || !present.has(b)) return true
    return boxOf.has(a) && boxOf.has(b) && !touching.has(pair(a, b))
  }).map(j => j.id as string)
  return { joints: out, made, issues, stale }
}
