import { CAD_RECIPE_SCHEMA } from './cad-schema.ts'
import { CAD_PARAMETERS_SCHEMA } from './cad-parameters.ts'
import { INSTANCE_POLICY_ENTRY_SCHEMA } from './construction-instance-policy.ts'

const id = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$' }
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const endpoint = obj({ instance_id: id, face: { type: 'string', enum: ['x_min', 'x_max', 'y_min', 'y_max', 'z_min', 'z_max'] } })
const uuid = { type: 'string', format: 'uuid' }
const revision = { type: 'integer', minimum: 1, maximum: 999999999 }
const delta = (items: unknown, limit: number, key: Record<string, unknown> = id) => obj({
  upsert: { type: 'array', maxItems: limit, items }, remove: { type: 'array', maxItems: limit, items: key },
})
export const CONSTRUCTION_EDIT_TOOL = { type: 'function' as const, function: {
  name: 'edit_construction_parts',
  description: 'Change only named parts and their dependencies in an exact saved construction. Omit unchanged collections and posts. Each included collection has upsert (complete changed/new posts) and remove (existing IDs, or binding paths); no ID may appear in both. The server merges with the saved revision and preserves everything else. Explicitly remove or update dependent joints, bindings, nodes, materials and roles when removing parts; no silent cascade. Keep stable identity: a joint with different endpoints needs a new ID. New instance roles need evidence, or explicit unknown/unknown. For existing numeric input values use change_construction_parameters; for role-only changes use change_construction_roles. Reuse key only for an exact retry; corrected input needs a new key. After saving check the receipt revision and complete its affected outputs; this is not a drawing receipt.',
  parameters: obj({
    key: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, record_id: uuid, expected_revision: revision,
    change_note: { type: 'string', minLength: 1, maxLength: 1000 }, request_quote: { type: 'string', minLength: 1, maxLength: 500 },
    changes: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
      definitions: delta((CAD_RECIPE_SCHEMA.properties.definitions as {items: unknown}).items, 128),
      instances: delta((CAD_RECIPE_SCHEMA.properties.instances as {items: unknown}).items, 512),
      nodes: delta((CAD_PARAMETERS_SCHEMA.properties.nodes as {items: unknown}).items, 1024),
      bindings: delta((CAD_PARAMETERS_SCHEMA.properties.bindings as {items: unknown}).items, 8192, { type: 'string', minLength: 1, maxLength: 240 }),
      materials: delta(obj({ definition_id: id, material_id: uuid, material_revision: revision,
        part_id: { anyOf: [uuid, { type: 'null' }] }, part_revision: { anyOf: [revision, { type: 'null' }] } }), 128),
      joints: delta(obj({ id, method: { type: 'string', enum: ['screwed_butt', 'glued_butt', 'dowel', 'bolted', 'unresolved'] },
        first: endpoint, second: endpoint, reason: { type: 'string', minLength: 1, maxLength: 2000 } }), 1024),
      roles: delta(INSTANCE_POLICY_ENTRY_SCHEMA, 512),
    } },
  }),
} }

export type ConstructionEditIssue = { code: string; path: string }
/** Content-free relationship diagnostics before compilation/SQL. SQL remains authoritative. */
export function constructionEditIssues(data: Record<string, any>, original?: Record<string, any>): ConstructionEditIssue[] {
  const issues: ConstructionEditIssue[] = []
  const add = (code: string, path: string) => { if (issues.length < 12) issues.push({ code, path }) }
  const definitions = new Set((data.recipe?.definitions ?? []).map((d: any) => d.id))
  const instances = new Set((data.recipe?.instances ?? []).map((i: any) => i.id))
  const nodes = new Set((data.parameter_plan?.nodes ?? []).map((n: any) => n.id))
  for (const i of data.recipe?.instances ?? []) if (!definitions.has(i.definition_id)) add('definition_missing', `instances/${i.id}/definition_id`)
  for (const i of data.recipe?.instances ?? []) {
    const prior = original?.recipe?.instances?.find((p: any) => p.id === i.id)
    if (prior && prior.definition_id !== i.definition_id) add('instance_identity_reused', `instances/${i.id}/definition_id`)
  }
  for (const d of data.recipe?.definitions ?? []) {
    const prior = original?.recipe?.definitions?.find((p: any) => p.id === d.id)
    if (prior && prior.primitive !== d.primitive) add('definition_identity_reused', `definitions/${d.id}/primitive`)
  }
  for (const j of data.joints ?? []) {
    const prior = original?.joints?.find((p: any) => p.id === j.id)
    if (prior && ['first', 'second'].some(end => prior[end].instance_id !== j[end].instance_id || prior[end].face !== j[end].face)) add('joint_identity_reused', `joints/${j.id}`)

    if (j.first.instance_id === j.second.instance_id) add('joint_self_connection', `joints/${j.id}`)
    for (const end of ['first', 'second']) if (!instances.has(j[end].instance_id)) add('joint_endpoint_missing', `joints/${j.id}/${end}/instance_id`)
  }
  for (const b of data.parameter_plan?.bindings ?? []) if (!nodes.has(b.node)) add('parameter_node_missing', `bindings/${b.path}`)
  for (const n of data.parameter_plan?.nodes ?? []) if (n.role === 'derived') for (const operand of n.operands) {
    if (!nodes.has(operand)) add('parameter_operand_missing', `nodes/${n.id}/operands`)
  }
  for (const d of definitions) if (!(data.materials ?? []).some((m: any) => m.definition_id === d)) add('material_missing', `materials/${d}`)
  for (const m of data.materials ?? []) if (!definitions.has(m.definition_id)) add('material_definition_missing', `materials/${m.definition_id}`)
  for (const i of instances) if (!(data.instance_policy?.instances ?? []).some((r: any) => r.instance_id === i)) add('instance_role_missing', `roles/${i}`)
  for (const r of data.instance_policy?.instances ?? []) if (!instances.has(r.instance_id)) add('role_instance_missing', `roles/${r.instance_id}`)
  return issues
}
