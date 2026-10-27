import { parseCadAssemblyRequest, type CadAssemblyRequest } from '../../supabase/functions/_shared/cad-adapter.ts'
import { multiply, placementMatrix, shapeMatrix, transformPoint, type Mat4 } from '../lib/shell3d'
import type { ConstructionPreparationSource } from '../data/buildPreparation'
import { constructionInstancePolicy, type InstanceRole } from '../../supabase/functions/_shared/construction-instance-policy.ts'

export const CONSTRUCTION_RENDERER = 'construction-boxes-v1'
export const CONSTRUCTION_VIEWS = ['overview', 'front', 'back', 'left', 'right', 'top'] as const
export type ConstructionView = typeof CONSTRUCTION_VIEWS[number]
export interface ConstructionModelPart {
  id: string; definitionId: string; matrix: Mat4
  materialId: string; materialRevision: number; materialName: string
  color: string; colorIsSpecification: boolean
  role: InstanceRole
}
export interface ConstructionModel {
  artifactId: string; revision: number; renderer: typeof CONSTRUCTION_RENDERER
  recipe: CadAssemblyRequest; parts: ConstructionModelPart[]
  bounds: { min: number[]; max: number[] }; gaps: string[]
}
export type ConstructionModelResult =
  | { status: 'ready'; model: ConstructionModel }
  | { status: 'unavailable' | 'unsupported'; message: string }

/** Render the canonical saved recipe without adding, dropping or simplifying parts.
 * This first renderer supports exact box solids; cuts/bores require another renderer.
 * Geometry and camera changes do not create a second editable design. */
export function constructionModel(source: ConstructionPreparationSource): ConstructionModelResult {
  const { draft, catalog } = source
  const recipe = parseCadAssemblyRequest(draft.recipe)
  if (!recipe) return { status: 'unavailable', message: 'The saved construction geometry could not be read.' }
  if (recipe.definitions.some(d => d.primitive !== 'box' || d.cuts?.length)) {
    return { status: 'unsupported', message: 'This construction has shapes or cut details that this 3D view cannot show exactly yet.' }
  }
  const definitions = new Map(recipe.definitions.map(d => [d.id, d]))
  let roles: Map<string, InstanceRole>
  try { roles = new Map(constructionInstancePolicy(recipe, draft.instance_policy).instances.map(i => [i.instance_id, i.role])) }
  catch { return { status: 'unavailable', message: 'The saved meaning of these parts is unavailable. Reload this version.' } }
  const bindings = new Map(draft.materials.map(m => [m.definition_id, m]))
  const parts: ConstructionModelPart[] = []
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const instance of recipe.instances) {
    const definition = definitions.get(instance.definition_id)!
    const binding = bindings.get(definition.id)
    const material = binding && catalog.get(String(binding.material_id) + '@' + String(binding.material_revision))
    if (!binding || !material || typeof material.name !== 'string' || !material.name.trim()) {
      return { status: 'unavailable', message: 'The exact saved material specification is unavailable. Reload this version before opening its model.' }
    }
    const matrix = multiply(placementMatrix(instance.placement), shapeMatrix(definition).matrix)
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
      const corner = transformPoint(matrix, [x, y, z])
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], corner[axis]); max[axis] = Math.max(max[axis], corner[axis]) }
    }
    const color = material.properties?.color
    // Only a typed specification can claim a real colour. The neutral display
    // finish makes unknown appearance explicit instead of guessing from a name.
    const specified = color?.truth === 'provided_spec' && typeof color.value === 'string' && /^#[0-9a-f]{6}$/i.test(color.value)
    parts.push({ id: instance.id, definitionId: definition.id, matrix, role: roles.get(instance.id)!,
      materialId: String(binding.material_id), materialRevision: Number(binding.material_revision), materialName: material.name,
      color: specified ? color.value : '#c8b899', colorIsSpecification: specified })
  }
  if (!parts.length) return { status: 'unavailable', message: 'This version has no construction parts to show.' }
  const gaps = [...draft.open_questions]
  if (parts.some(part => !part.colorIsSpecification)) gaps.push('Neutral display finish; the actual colour and texture have not been specified.')
  if (draft.joints.length) gaps.push('Joint and fastener instructions do not add modeled screws, holes or glue to these saved solids.')
  if (parts.some(part => part.role === 'reference')) gaps.push('Outline boxes mark reference volumes, such as clearance space. They are not physical parts.')
  if (parts.some(part => part.role === 'unknown')) gaps.push('Some saved solids have no recorded part role. Their physical purpose remains unknown.')
  return { status: 'ready', model: { artifactId: draft.artifact_id, revision: draft.revision, renderer: CONSTRUCTION_RENDERER, recipe, parts, bounds: { min, max }, gaps } }
}
