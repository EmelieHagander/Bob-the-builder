import { parseCadAssemblyRequest, type CadAssemblyRequest, type CadPlacement } from './cad-adapter.ts'

// Display derivatives never replace the saved recipe, STEP or measured dimensions.
export const CAD_WIREFRAME_PROFILE = 'kernel-edges-v1'
export const CAD_WIREFRAME_BYTES = 4 * 1024 * 1024
export const CAD_WIREFRAME_SEGMENTS = 60000
export const CAD_WIREFRAME_DRAW_SEGMENTS = 200000
export type CadViewerPin = { project_id: string; artifact_id: string; revision: number }
export type CadWireframe = {
  version: 1; profile: typeof CAD_WIREFRAME_PROFILE; units: 'mm'; engine: 'build123d-0.13.0'
  source_hash: string; assembly_id: string; tolerance_mm: 0.25
  bounds: { min: number[]; max: number[] }
  definitions: { id: string; positions: number[] }[]
  instances: { id: string; definition_id: string; placement: CadPlacement }[]
}
export type CadViewerResult =
  | { status: 'ready'; source: CadViewerPin; geometry: CadWireframe }
  | { status: 'pending' }
  | { status: 'failed'; retry_allowed: boolean }

const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k))
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(v)
export const hashPattern = /^[0-9a-f]{64}$/
export function parseCadViewerPin(v: unknown): CadViewerPin | null {
  if (!obj(v) || typeof v.project_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(v.project_id)
    || typeof v.artifact_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v.artifact_id)
    || !Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > 999999999) return null
  return { project_id: v.project_id, artifact_id: v.artifact_id.toLowerCase(), revision: v.revision }
}
export function stableCadJson(v: unknown): string {
  return JSON.stringify(v, (_key, value) => obj(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value)
}
export async function cadViewerSourceHash(recipe: CadAssemblyRequest) {
  const bytes = new TextEncoder().encode(stableCadJson({ profile: CAD_WIREFRAME_PROFILE, recipe }))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}
export function parseCadWireframe(v: unknown, recipe?: CadAssemblyRequest, sourceHash?: string): CadWireframe | null {
  if (!obj(v) || !exact(v, ['version','profile','units','engine','source_hash','assembly_id','tolerance_mm','bounds','definitions','instances'])
    || v.version !== 1 || v.profile !== CAD_WIREFRAME_PROFILE || v.units !== 'mm' || v.engine !== 'build123d-0.13.0'
    || v.tolerance_mm !== 0.25 || !id(v.assembly_id) || typeof v.source_hash !== 'string' || !hashPattern.test(v.source_hash)
    || (sourceHash !== undefined && v.source_hash !== sourceHash) || !obj(v.bounds) || !exact(v.bounds, ['min','max'])
    || !Array.isArray(v.definitions) || v.definitions.length < 1 || v.definitions.length > 128
    || !Array.isArray(v.instances) || v.instances.length < 1 || v.instances.length > 512) return null
  const vec = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1.2e7)
  if (!vec(v.bounds.min) || !vec(v.bounds.max) || v.bounds.min.some((n: number, i: number) => n > v.bounds.max[i])) return null
  let segments = 0
  const ids = new Set<string>()
  for (const d of v.definitions) {
    if (!obj(d) || !exact(d, ['id','positions']) || !id(d.id) || ids.has(d.id) || !Array.isArray(d.positions) || !d.positions.length || d.positions.length % 6
      || d.positions.length > CAD_WIREFRAME_SEGMENTS * 6 || d.positions.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e6)) return null
    ids.add(d.id); segments += d.positions.length / 6
    if (segments > CAD_WIREFRAME_SEGMENTS) return null
  }
  // Reuse the established placement and identity contract, without accepting model code.
  const request = parseCadAssemblyRequest({ contract_version: 1, units: 'mm', assembly_id: v.assembly_id,
    definitions: v.definitions.map((d: { id: string }) => ({ id: d.id, primitive: 'box', material_ref: null, x_mm: 1, y_mm: 1, z_mm: 1 })),
    instances: v.instances, views: ['isometric'] })
  if (!request || new Set(v.instances.map((i: any) => i.definition_id)).size !== ids.size) return null
  if (recipe && (v.assembly_id !== recipe.assembly_id || stableCadJson(v.instances) !== stableCadJson(recipe.instances)
    || [...ids].some(key => !recipe.definitions.some(d => d.id === key)))) return null
  return v as CadWireframe
}
