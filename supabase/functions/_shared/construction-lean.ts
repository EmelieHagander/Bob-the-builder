import { FORMULA_STRING } from './cad-formulas.ts'
import { ZERO_ARRAYS_TEXT } from './cad-parameters.ts'
import { REPEAT_ARRAYS_TEXT } from './cad-arrays.ts'
import { JOINT_RULES_SCHEMA } from './construction-joint-rules.ts'
import { FORM_ASSIGN_SCHEMA } from './construction-form.ts'

/** Owner decision 2026-11-07 (lean_construction_version 1, pinned per
 * manifest on tools.save_construction_draft): Konrad writes the construction,
 * code writes what follows from it. Entry, 2026-11-07: an 11-part wall was
 * 26,590 characters Konrad typed in 75-120 s; three answers did not fit the
 * 120 s window, and four refusals threw away a whole written wall.
 *   formulas: a number in the recipe may be a formula over node names;
 *   joint_rules: one rule per pair of definitions writes their joints;
 *   FORM: code keeps the concept mapping in step with the parts;
 *   kept payloads: a refused construction write stays in the sketch. */

const SKIP = new Set(['count', 'contract_version'])
const numberish = (s: any) => !!s && typeof s === 'object' && (s.type === 'number' || Array.isArray(s.anyOf) && s.anyOf.some((x: any) => x?.type === 'number'))
/** Every number schema below this one also takes a formula string. */
export function withFormulaNumbers<T>(schema: T): T {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk)
    if (!v || typeof v !== 'object') return v
    const out: any = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'properties' ? x : walk(x)]))
    if (out.properties && typeof out.properties === 'object') {
      out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, p]: [string, any]) => {
        if (SKIP.has(k) || !numberish(p)) return [k, walk(p)]
        const { description, ...shape } = p
        const options = Array.isArray(shape.anyOf) ? shape.anyOf : [shape]
        return [k, { ...(description ? { description } : {}), anyOf: [...options, FORMULA_STRING] }]
      }))
    }
    return out
  }
  return walk(structuredClone(schema)) as T
}

const SPACING = { anyOf: [FORMULA_STRING, { type: 'null' }],
  description: 'Centre-to-centre step along axis as a formula over node names; null when arrays/<id>/spacing_mm is bound in parameter_plan.' }
function withArraySpacing(recipe: any): any {
  const items = recipe?.properties?.arrays?.items
  if (!items?.properties || 'spacing_mm' in items.properties) return recipe
  return { ...recipe, properties: { ...recipe.properties, arrays: { ...recipe.properties.arrays, items: {
    ...items, properties: { ...items.properties, spacing_mm: SPACING }, required: [...items.required, 'spacing_mm'] } } } }
}

export const LEAN_SAVE_NOTE = ' Lean writing: a number in the recipe may be a formula over parameter node names, with + - * / and parentheses and spaces around a minus sign; a number inside a formula needs its own named node with a reason. Code adds the formula\'s nodes and bindings, so bind by hand only fields written as numbers other than 0. joint_rules joins touching parts by definition pair; code writes those joints. Code completes form_refinement: a part no mapping names goes to the concept component whose envelope holds it, when exactly one does. A role\'s quantity_policy follows from the role; a repeat\'s parts take the role given for the repeat\'s id. A save refused only for a text, a formula or a joint rule is kept as a sketch under its key: send the correction with mode sketch and the same key, with the current title, description, area, refinement and open questions; parts you do not send stay as they are.'
export const LEAN_EDIT_NOTE = ' Lean writing: a number in an upserted definition or part may be a formula over parameter node names, with + - * / and parentheses and spaces around a minus sign; it replaces that field\'s binding. A number where code computes the field from a node is refused; write a formula or a node name to change it. Removing a part removes what only served it: its role, its joints, its bindings and formula nodes, and the material of a removed definition; the answer lists them. A node you wrote that only served it is removed in the same edit. In this edit, joint_rules joins the parts it adds or changes; an edit with only joint_rules applies them to every touching pair and restates the joints code wrote for them. Code maps an added part to the concept component whose envelope holds it, when exactly one does; with a part change, form_assign names the component for a part several hold. Joints code wrote follow their parts when they move. A role\'s quantity_policy follows from the role. A change refused only for a text, a formula or a joint rule is kept in a sketch when none is open: send only the correction with mode sketch, then commit it.'
const MAPPING_OLD = 'Small edits inherit the saved mapping; use a complete save to change the mapping.'
const MAPPING_NEW = 'Part edits keep the mapping in step with the parts.'
const CASCADE_OLD = 'Explicitly remove or update dependent joints, bindings, nodes, materials and roles when removing parts; no silent cascade.'
const CASCADE_NEW = 'Update dependent joints, nodes and bindings of parts you keep.'
const ARRAYS_LEAN = 'Repeat templates for evenly spaced identical parts. Each expands to instances <id>.1..<id>.<count>. Give start x, y and z and spacing_mm (centre-to-centre step along axis) as formulas or 0; do not bind the expanded instances. Copy N sits at start + (N-1) x spacing along axis.'
/** The role entry without quantity_policy, which follows from the role. */
function withoutQuantityPolicy<T>(schema: T): T {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk)
    if (!v || typeof v !== 'object') return v
    const out: any = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    if (out.properties?.quantity_policy && out.properties?.role && out.properties?.instance_id) {
      const { quantity_policy: _q, ...properties } = out.properties
      return { ...out, properties, required: (out.required ?? []).filter((k: string) => k !== 'quantity_policy') }
    }
    if (out.description === ZERO_ARRAYS_TEXT || out.description === REPEAT_ARRAYS_TEXT) out.description = ARRAYS_LEAN
    return out
  }
  return walk(structuredClone(schema)) as T
}

type Spec = { type: 'function'; function: { name: string; description: string; parameters: any } }
/** save_construction_draft under lean_construction_version 1. */
export function withLeanSave<T extends Spec>(spec: T): T {
  const p = spec.function.parameters
  // A sketch call may carry only a correction, and formulas bring their own
  // bindings, so these lists may be empty; a save is still checked whole.
  const empty = (s: any) => s && typeof s === 'object' ? { ...s, minItems: 0 } : s
  const r = withArraySpacing(withFormulaNumbers(p.properties.recipe))
  const recipe = { ...r, properties: { ...r.properties, definitions: empty(r.properties.definitions) } }
  const plan = p.properties.parameter_plan
  const parameter_plan = { ...plan, properties: { ...plan.properties, nodes: empty(plan.properties.nodes), bindings: empty(plan.properties.bindings) } }
  const policy = p.properties.instance_policy
  const instance_policy = Array.isArray(policy?.anyOf) ? { ...policy, anyOf: policy.anyOf.map((o: any) => o?.properties?.instances
    ? { ...o, properties: { ...o.properties, instances: empty(o.properties.instances) } } : o) } : policy
  return { ...spec, function: { ...spec.function, description: spec.function.description.replace(MAPPING_OLD, MAPPING_NEW) + LEAN_SAVE_NOTE,
    parameters: { ...p, required: [...p.required, 'joint_rules'], properties: { ...p.properties, recipe: withoutQuantityPolicy(recipe), parameter_plan, materials: empty(p.properties.materials), instance_policy: withoutQuantityPolicy(instance_policy), joint_rules: JOINT_RULES_SCHEMA } } } }
}
/** edit_construction_parts under lean_construction_version 1. */
export function withLeanEdit<T extends Spec>(spec: T): T {
  const p = spec.function.parameters, c = p.properties.changes
  const changes = { ...c, properties: { ...c.properties,
    definitions: withFormulaNumbers(c.properties.definitions), instances: withFormulaNumbers(c.properties.instances),
    ...(c.properties.roles ? { roles: withoutQuantityPolicy(c.properties.roles) } : {}) } }
  return { ...spec, function: { ...spec.function, description: spec.function.description.replace(CASCADE_OLD, CASCADE_NEW) + LEAN_EDIT_NOTE,
    parameters: { ...p, required: [...p.required, 'joint_rules', 'form_assign'], properties: { ...p.properties, changes, joint_rules: JOINT_RULES_SCHEMA, form_assign: FORM_ASSIGN_SCHEMA } } } }
}

const COMMIT_OLD = 'For a new construction new_key is the key its save_construction_draft sketch used; otherwise new_key is null.'
const COMMIT_NEW = 'new_key is the key of a sketch made with save_construction_draft (a new construction, or a whole revision of a saved one); for a sketch made with edit_construction_parts new_key is null.'
const REBASE_OLD = 'rebase moves a sketch of an existing construction onto its current saved revision'
const REBASE_NEW = 'rebase moves an edit_construction_parts sketch onto the current saved revision'
/** commit_construction_sketch under lean_construction_version 1: a keyed
 * sketch may also be a whole revision of a saved construction. */
export function withLeanCommit<T extends Spec>(spec: T): T {
  const p = spec.function.parameters, key = p.properties.new_key
  if (!spec.function.description.includes(COMMIT_OLD) || !spec.function.description.includes(REBASE_OLD)) throw new Error('lean_commit_text_unexpected')
  return { ...spec, function: { ...spec.function, description: spec.function.description.replace(COMMIT_OLD, COMMIT_NEW).replace(REBASE_OLD, REBASE_NEW),
    parameters: { ...p, properties: { ...p.properties, new_key: { ...key, description: 'The key of a save_construction_draft sketch; null for an edit_construction_parts sketch.' } } } } }
}
