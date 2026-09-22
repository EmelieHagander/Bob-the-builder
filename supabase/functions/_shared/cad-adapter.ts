export type CadBoxDefinition = {
  id: string
  kind: 'box'
  size_mm: [number, number, number]
  catalog_part_id?: string
  catalog_part_revision?: number
}
export type CadTubeDefinition = {
  id: string
  kind: 'tube'
  outside_diameter_mm: number
  wall_thickness_mm: number
  length_mm: number
  catalog_part_id?: string
  catalog_part_revision?: number
}
export type CadDefinition = CadBoxDefinition | CadTubeDefinition
export type CadInstance = { id: string; definition_id: string; position_mm: [number, number, number]; rotation_deg: [number, number, number] }
export type CadView = 'front' | 'right' | 'top' | 'isometric'
export type CadConstructionV1 = {
  version: 1
  assembly_id: string
  units: 'mm'
  definitions: CadDefinition[]
  instances: CadInstance[]
  views: CadView[]
}
export type CadRenderResponse = {
  ok: true
  manifest: {
    version: 1; engine: 'build123d'; assembly_id: string; units: 'mm'
    bbox_mm: { min: [number, number, number]; max: [number, number, number] }
    definitions: Array<{ id: string; kind: string; catalog_part_id: string | null; catalog_part_revision: number | null }>
    instances: string[]
    files: { step: string; views: Record<string, string> }
  }
  step_base64: string
  views: Record<string, string>
}

const id = /^[A-Za-z0-9_.-]{1,80}$/
const finite = (value: unknown, positive = false) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000 && (!positive || value > 0)
const exact = (value: Record<string, unknown>, required: string[], optional: string[] = []) => {
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key))
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const vec3 = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(item => finite(item))
const pin = (value: Record<string, unknown>) => {
  const part = value.catalog_part_id
  const revision = value.catalog_part_revision
  if ((part === undefined) !== (revision === undefined)) return false
  return part === undefined || (typeof part === 'string' && id.test(part) && Number.isSafeInteger(revision) && Number(revision) > 0)
}

export function parseCadConstruction(value: unknown): CadConstructionV1 | null {
  if (!object(value) || !exact(value, ['version','assembly_id','units','definitions','instances','views'])
    || value.version !== 1 || value.units !== 'mm' || typeof value.assembly_id !== 'string' || !id.test(value.assembly_id)
    || !Array.isArray(value.definitions) || value.definitions.length < 1 || value.definitions.length > 256
    || !Array.isArray(value.instances) || value.instances.length < 1 || value.instances.length > 1024
    || !Array.isArray(value.views) || value.views.length < 1 || value.views.length > 4) return null
  const definitions = new Set<string>()
  for (const raw of value.definitions) {
    if (!object(raw) || typeof raw.id !== 'string' || !id.test(raw.id) || definitions.has(raw.id) || !pin(raw)) return null
    definitions.add(raw.id)
    if (raw.kind === 'box') {
      if (!exact(raw, ['id','kind','size_mm'], ['catalog_part_id','catalog_part_revision'])
        || !Array.isArray(raw.size_mm) || raw.size_mm.length !== 3 || !raw.size_mm.every(v => finite(v, true))) return null
    } else if (raw.kind === 'tube') {
      if (!exact(raw, ['id','kind','outside_diameter_mm','wall_thickness_mm','length_mm'], ['catalog_part_id','catalog_part_revision'])
        || !finite(raw.outside_diameter_mm, true) || !finite(raw.wall_thickness_mm, true) || !finite(raw.length_mm, true)
        || Number(raw.wall_thickness_mm) * 2 >= Number(raw.outside_diameter_mm)) return null
    } else return null
  }
  const instances = new Set<string>()
  for (const raw of value.instances) {
    if (!object(raw) || !exact(raw, ['id','definition_id','position_mm','rotation_deg'])
      || typeof raw.id !== 'string' || !id.test(raw.id) || instances.has(raw.id)
      || typeof raw.definition_id !== 'string' || !definitions.has(raw.definition_id)
      || !vec3(raw.position_mm) || !vec3(raw.rotation_deg)) return null
    instances.add(raw.id)
  }
  const views = new Set(['front','right','top','isometric'])
  if (new Set(value.views).size !== value.views.length || value.views.some(v => typeof v !== 'string' || !views.has(v))) return null
  return structuredClone(value) as CadConstructionV1
}

export function createCadAdapter(opts: { url: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  const base = opts.url.replace(/\/$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 20_000
  return {
    async render(value: unknown): Promise<CadRenderResponse> {
      const contract = parseCadConstruction(value)
      if (!contract) throw new Error('cad_invalid_contract')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(base + '/v1/render', {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.token },
          body: JSON.stringify(contract),
        })
        if (!response.ok) throw new Error('cad_unavailable')
        const raw: unknown = await response.json()
        if (!object(raw) || raw.ok !== true || !object(raw.manifest) || raw.manifest.engine !== 'build123d'
          || raw.manifest.assembly_id !== contract.assembly_id || raw.manifest.units !== 'mm'
          || typeof raw.step_base64 !== 'string' || raw.step_base64.length < 16 || raw.step_base64.length > 48_000_000
          || !object(raw.views) || Object.keys(raw.views).some(name => !contract.views.includes(name as CadView))
          || contract.views.some(name => typeof raw.views[name] !== 'string' || !(raw.views[name] as string).includes('<svg'))) throw new Error('cad_invalid_response')
        return raw as CadRenderResponse
      } finally { clearTimeout(timer) }
    },
  }
}
