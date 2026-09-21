import type { WritePayload } from './project-write.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'

/** Generic catalog API: material/form/profile are DATA, never object-name handlers. */
export type CatalogValue = { value: string | boolean | null; unit: string | null; truth: 'provided_spec' | 'estimated' | 'unknown'; parameter: string | null; note: string }
export type CatalogProperties = Record<string, CatalogValue>
const nullableText = { type: ['string', 'null'] }
const propertiesSchema = {
  type: 'object', description: 'Property keys come from read_material_catalog(profile). Each value has exactly value, unit, truth, parameter and note. Quantities are decimal strings (up to six decimals), not floats. A part may use value=null, truth=provided_spec and a named parameter; unknown requires a note.',
  additionalProperties: { type: 'object', additionalProperties: false, properties: {
    value: { type: ['string', 'boolean', 'null'] }, unit: nullableText,
    truth: { type: 'string', enum: ['provided_spec', 'estimated', 'unknown'] }, parameter: nullableText, note: { type: 'string' },
  }, required: ['value', 'unit', 'truth', 'parameter', 'note'] },
}
function tool(name: string, description: string, properties: Record<string, unknown>) {
  return { type: 'function' as const, function: { name, description, parameters: {
    type: 'object', additionalProperties: false, properties, required: Object.keys(properties),
  } } }
}
export const CATALOG_SEARCH_TOOL = tool('search_material_catalog',
  'Browse categories/profiles, or search current reusable material/part definitions. Metadata first, read exact definitions/profiles next. Not inventory or a Shopping list. Follow next_cursor. A failed request is not absence.', {
    entity: { type: 'string', enum: ['categories', 'profiles', 'materials', 'parts'] }, query: nullableText,
    categories: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string' }, description: 'Exact category codes, e.g. wood and sheet. Parent categories include descendants. Empty for vocabulary browsing.' },
    profile_code: nullableText, profile_revision: { type: ['integer', 'null'] },
    properties: { ...propertiesSchema, description: propertiesSchema.description + ' Search filters must be known, non-parameter values. A profile and exact revision are required for typed property filters.' },
    after: { ...nullableText, description: 'Copy next_cursor or null.' },
  })
export const CATALOG_READ_TOOL = tool('read_material_catalog',
  'Read one exact definition or profile, including full dynamic fields, units and parameter names. Null revision reads the current/latest published version. Definition data does not generate geometry or establish stock.', {
    entity: { type: 'string', enum: ['definition', 'profile'] }, id: { type: 'string' }, revision: { type: ['integer', 'null'] },
  })
export const CATALOG_WRITE_TOOL = tool('save_catalog_definition',
  'Ensure/reuse or revise a material/part definition in this project. Read the profile first. Complete equivalents are reused atomically; uncertain definitions are not automatically equivalent. No stock, drawing, order or global publication.', {
    action: { type: 'string', enum: ['ensure', 'revise'] },
    key: { type: 'string', description: 'Stable short operation key for this intended definition in this turn; reuse for an exact retry. Letters, numbers, _ and - only.' },
    kind: { type: 'string', enum: ['material', 'part'] },
    record_id: nullableText, expected_revision: { type: 'integer', description: '0 for ensure; exact current revision for revise.' },
    name: { type: 'string' }, aliases: { type: 'array', maxItems: 12, items: { type: 'string' } },
    profile_code: { type: 'string' }, profile_revision: { type: 'integer' },
    categories: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string' }, description: 'Exactly one material and one form category, plus optional function categories. Reuse codes returned by search.' },
    properties: propertiesSchema,
    material_id: { ...nullableText, description: 'Exact catalog material ID for a part; null for a material.' }, material_revision: { type: ['integer', 'null'] }, notes: { type: 'string' },
    source_kind: { type: 'string', enum: ['user_statement', 'design_choice'], description: 'design_choice for delegated design decisions; no invented measured/manufacturer evidence.' },
    source_quote: { type: 'string', description: 'Exact excerpt from a current or earlier user message. For design_choice it records the design request, not proof the user measured the values.' },
    source_seq: { type: ['integer', 'null'], description: 'Earlier user-message seq from this conversation, or null for the current message.' },
    request_quote: { type: 'string', description: 'Exact quote from the CURRENT user request authorising this definition change. Earlier source text is not new authority.' },
  })
const code = /^[a-z][a-z0-9_]{0,63}$/
const category = /^[a-z][a-z0-9_.]{0,63}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0)
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) < 1_000_000_000
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const cleanKey = (v: string) => code.test(v) && !['constructor', 'prototype', '__proto__'].includes(v)
function propertiesValid(value: unknown, allowParameters: boolean, filter = false): value is CatalogProperties {
  if (!isObject(value) || Object.keys(value).length > 32 || JSON.stringify(value).length > 16000) return false
  return Object.entries(value).every(([key, v]) => {
    if (!cleanKey(key) || !isObject(v) || !exactKeys(v, ['value','unit','truth','parameter','note'])
      || !text(v.note, 400, true) || (v.unit !== null && !text(v.unit, 32))
      || !['provided_spec','estimated','unknown'].includes(String(v.truth))) return false
    if (v.parameter !== null) return !filter && allowParameters && typeof v.parameter === 'string' && cleanKey(v.parameter)
      && v.value === null && v.truth === 'provided_spec'
    if (v.truth === 'unknown') return !filter && v.value === null && v.note.trim().length > 0
    return typeof v.value === 'boolean' || text(v.value, 200)
  })
}
/** The compact source label must not promote an estimated or incomplete definition.
 * Full per-property provenance remains in the returned exact revision. */
export function catalogSourceTruth(record: Record<string, unknown>): ProjectSource['truth'] {
  if (record.source_kind === 'design_choice') return 'ai_assessment'
  if (record.source_kind !== 'user_statement' || record.has_unknown !== false || !isObject(record.properties)) return 'unknown'
  const values = Object.values(record.properties)
  if (!values.length || values.some(v => !isObject(v) || !['provided_spec', 'estimated'].includes(String(v.truth)))) return 'unknown'
  if (values.some(v => (v as Record<string, unknown>).truth === 'estimated')) return 'estimated'
  return 'provided_spec'
}
export function parseCatalogWrite(value: unknown): WritePayload | null {
  if (!isObject(value) || !exactKeys(value, CATALOG_WRITE_TOOL.function.parameters.required)) return null
  const v = value
  if (!['material','part'].includes(String(v.kind)) || !['ensure','revise'].includes(String(v.action))
    || typeof v.key !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.key)
    || !text(v.name, 200) || !text(v.notes, 2000, true)
    || !Array.isArray(v.aliases) || v.aliases.length > 12 || v.aliases.some(x => !text(x, 200))
    || typeof v.profile_code !== 'string' || !code.test(v.profile_code) || !revision(v.profile_revision)
    || !Array.isArray(v.categories) || v.categories.length < 2 || v.categories.length > 12
    || new Set(v.categories).size !== v.categories.length || v.categories.some(x => typeof x !== 'string' || !category.test(x))
    || !propertiesValid(v.properties, v.kind === 'part')
    || !['user_statement','design_choice'].includes(String(v.source_kind)) || !text(v.source_quote, 1000)
    || (v.source_seq !== null && !revision(v.source_seq)) || !text(v.request_quote, 500)) return null
  if (v.action === 'ensure' ? v.record_id !== null || v.expected_revision !== 0
    : typeof v.record_id !== 'string' || !uuid.test(v.record_id) || !revision(v.expected_revision)) return null
  if (v.kind === 'material' ? v.material_id !== null || v.material_revision !== null
    : typeof v.material_id !== 'string' || !uuid.test(v.material_id) || !revision(v.material_revision)) return null
  const { record_id, expected_revision, request_quote, ...data } = v
  return { kind: 'catalog', record_id: record_id as string | null, expected_revision: expected_revision as number,
    expected_updated_at: null, request_quote: request_quote as string, data }
}
export function parseCatalogRead(name: string, value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null
  const base = { action: '', kind: null as string | null, query: null as string | null, after: null as string | null,
    id: null as string | null, revision: null as number | null, profile_code: null as string | null, categories: [] as string[], properties: {} as CatalogProperties }
  const v = value
  if (name === CATALOG_READ_TOOL.function.name) {
    if (!exactKeys(v, CATALOG_READ_TOOL.function.parameters.required) || !text(v.id, 200) || (v.revision !== null && !revision(v.revision))) return null
    if (v.entity === 'definition' ? !uuid.test(v.id) : v.entity !== 'profile' || !code.test(v.id)) return null
    return { ...base, action: v.entity === 'profile' ? 'profile' : 'read', id: v.id, revision: v.revision }
  }
  if (name !== CATALOG_SEARCH_TOOL.function.name || !exactKeys(v, CATALOG_SEARCH_TOOL.function.parameters.required)
    || !['categories','profiles','materials','parts'].includes(String(v.entity))
    || (v.query !== null && !text(v.query,200)) || (v.after !== null && !text(v.after,200))
    || (v.profile_code !== null && (typeof v.profile_code !== 'string' || !code.test(v.profile_code)))
    || (v.profile_revision !== null && !revision(v.profile_revision))
    || !Array.isArray(v.categories) || v.categories.length > 12 || new Set(v.categories).size !== v.categories.length
    || v.categories.some(x => typeof x !== 'string' || !category.test(x))
    || !propertiesValid(v.properties, false, true)) return null
  const dictionary = v.entity === 'categories' || v.entity === 'profiles'
  if (dictionary && (v.profile_code !== null || v.profile_revision !== null || v.categories.length || Object.keys(v.properties).length)) return null
  if (!dictionary && v.after !== null && !uuid.test(v.after as string)) return null
  if (Object.keys(v.properties).length && (v.profile_code === null || v.profile_revision === null)) return null
  return { ...base, action: dictionary ? v.entity : 'search', kind: dictionary ? null : v.entity === 'materials' ? 'material' : 'part',
    query: v.query, after: v.after, profile_code: v.profile_code, revision: v.profile_revision, categories: v.categories, properties: v.properties }
}
export type CatalogTransport = (input: Record<string, unknown>, signal: AbortSignal) => PromiseLike<{ data: unknown; error: { code?: string } | null }>
export function createMaterialCatalogReader(projectId: string, transport: CatalogTransport, hasAccess: () => Promise<boolean>, sources: ProjectSource[], timeoutMs = 10000) {
  let used = 0, partial = false
  return {
    tools: [CATALOG_SEARCH_TOOL, CATALOG_READ_TOOL],
    get remaining() { return Math.max(0, 12 - used) }, get partial() { return partial },
    async read(name: string, value: unknown): Promise<Record<string, unknown>> {
      if (++used > 12) { partial = true; return { status: 'budget_exhausted' } }
      const input = parseCatalogRead(name, value)
      if (!input) { partial = true; return { status: 'invalid', message: 'Use the loaded schema and exact profile, category or item references.' } }
      if (!await hasAccess()) return { status: 'denied' }
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const { data, error } = await Promise.race([
          Promise.resolve(transport(input, controller.signal)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('unavailable')) }, timeoutMs) }),
        ])
        if (!await hasAccess()) return { status: 'denied' }
        if (error?.code === '42501') return { status: 'denied' }
        if (error?.code === '22023' || error?.code === '22P02') { partial = true; return { status: 'invalid', message: 'Invalid catalog filter, field, unit or reference. Read the profile before supplying properties.' } }
        if (error || !isObject(data) || data.projectId !== projectId || !['ok','empty','not_found'].includes(String(data.status))
          || new TextEncoder().encode(JSON.stringify(data)).length > 32000) throw new Error('unavailable')
        if (Array.isArray(data.items)) {
          if (data.items.length > 12 || typeof data.truncated !== 'boolean' || (data.next_cursor !== null && !text(data.next_cursor,200))) throw new Error('invalid_result')
        } else if (isObject(data.record) && input.action === 'read') {
          const r = data.record
          if (!text(r.id,200) || r.id !== input.id || !revision(r.revision) || !text(r.name,200)
            || (input.revision !== null && r.revision !== input.revision) || !text(r.recorded_at,80)) throw new Error('invalid_result')
          const recordId = `${r.id}@${r.revision}`
          if (!sources.some(s => s.dataset === 'catalog' && s.recordId === recordId)) sources.push({ projectId, dataset: 'catalog', recordId,
            label: `${r.name} · v${r.revision}`, retrievedAt: new Date().toISOString(), updatedAt: r.recorded_at, truth: catalogSourceTruth(r) })
        } else if (data.status === 'ok' && !isObject(data.record)) throw new Error('invalid_result')
        return data
      } catch { partial = true; return { status: 'unavailable', message: 'Catalog read failed; this is not proof a definition is missing.' } }
      finally { if (timer) clearTimeout(timer) }
    },
  }
}
export type MaterialCatalogReader = ReturnType<typeof createMaterialCatalogReader>
