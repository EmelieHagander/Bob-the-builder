import { FORMULA_STRING } from './cad-formulas.ts'
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

export const LEAN_SAVE_NOTE = ' Lean writing: a number in the recipe may be a formula over parameter node names, with + - * / and parentheses and spaces around a minus sign; code adds its nodes and bindings, so bind by hand only fields written as numbers. joint_rules joins touching parts by definition pair; code writes those joints. Code completes form_refinement: a part no mapping names goes to the concept component whose envelope holds it. A refused save is kept as a sketch under its key: send only the corrections with mode sketch and the same key, then commit it.'
export const LEAN_EDIT_NOTE = ' Lean writing: a number in an upserted definition or part may be a formula over parameter node names; code adds its nodes and bindings and removes formula nodes nothing uses any more. joint_rules joins touching parts by definition pair; code writes the joints for touching pairs that have none. Code maps added parts to the concept component whose envelope holds them and drops removed ones; form_assign moves a part to another component. A refused change is kept in your sketch: send only the corrections with mode sketch, then commit it.'
const MAPPING_OLD = 'Small edits inherit the saved mapping; use a complete save to change the mapping.'
const MAPPING_NEW = 'Part edits keep the mapping in step with the parts.'

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
    parameters: { ...p, required: [...p.required, 'joint_rules'], properties: { ...p.properties, recipe, parameter_plan, materials: empty(p.properties.materials), instance_policy, joint_rules: JOINT_RULES_SCHEMA } } } }
}
/** edit_construction_parts under lean_construction_version 1. */
export function withLeanEdit<T extends Spec>(spec: T): T {
  const p = spec.function.parameters, c = p.properties.changes
  const changes = { ...c, properties: { ...c.properties,
    definitions: withFormulaNumbers(c.properties.definitions), instances: withFormulaNumbers(c.properties.instances) } }
  return { ...spec, function: { ...spec.function, description: spec.function.description + LEAN_EDIT_NOTE,
    parameters: { ...p, required: [...p.required, 'joint_rules', 'form_assign'], properties: { ...p.properties, changes, joint_rules: JOINT_RULES_SCHEMA, form_assign: FORM_ASSIGN_SCHEMA } } } }
}
