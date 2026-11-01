import type { WritePayload } from './project-write.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { schemaIssues } from './schema-issues.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'

/** Generic catalog API: material/form/profile are DATA, never object-name handlers. */
export type CatalogValue = { value: string | boolean | null; unit: string | null; truth: 'provided_spec' | 'estimated' | 'unknown'; parameter: string | null; note: string }
export type CatalogProperties = Record<string, CatalogValue>
const nullableText = { type: ['string', 'null'] }
const propertiesSchema = {
  type: 'object', description: 'Property keys come from read_material_catalog(profile). Each value has exactly value, unit, truth, parameter and note. Quantities are strings, not floats; decimal inputs have at most six decimals. Modern inch/tum uses unit=in and a separate value, e.g. 0.75, 0,75, 3/4, 1 1/2 or ¾. SQL converts exactly to mm before search/save; do not pre-round or put unit suffixes in value. Nominal trade sizes (2x4, R 1/2) belong in nominal_size text/aliases, NEVER in a numeric dimension; retain independently specified dimensions or explicit unknowns. A part may use value=null, truth=provided_spec and a named parameter; unknown requires a note.',
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
  'Browse categories/profiles, or search current reusable material/part definitions. Supply every required field. Unused profile_code and profile_revision may be omitted or null; code supplies null. Typed property filters require both exact profile fields. For entity=categories or profiles use categories=[], profile_code=null, profile_revision=null, properties={}. query=null browses all; never use an empty string. Copy returned codes/revisions, then read the exact profile before saving; do not guess vocabulary. Not inventory or a Shopping list. Follow next_cursor. A failed request is not absence.', {
    entity: { type: 'string', enum: ['categories', 'profiles', 'materials', 'parts'] }, query: nullableText,
    categories: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string' }, description: 'Exact category codes, e.g. wood and sheet. Parent categories include descendants. Empty for vocabulary browsing.' },
    profile_code: { ...nullableText, description: 'Exact profile code, or null/omitted for an untyped search.' }, profile_revision: { type: ['integer', 'null'] },
    properties: { ...propertiesSchema, description: propertiesSchema.description + ' Search filters must be known, non-parameter values. A profile and exact revision are required for typed property filters.' },
    after: { ...nullableText, description: 'Copy next_cursor or null.' },
  })
// Unused read filters have an unambiguous null meaning. Writes and typed
// property searches still require their exact profile identity/revision.
CATALOG_SEARCH_TOOL.function.parameters.required = CATALOG_SEARCH_TOOL.function.parameters.required.filter(k => !['profile_code', 'profile_revision'].includes(k))
export const CATALOG_READ_TOOL = tool('read_material_catalog',
  'Read one exact definition or profile, including full dynamic fields, units and parameter names. Null revision reads the current/latest published version. Definition data does not generate geometry or establish stock.', {
    entity: { type: 'string', enum: ['definition', 'profile'] }, id: { type: 'string' }, revision: { type: ['integer', 'null'] },
  })
export const CATALOG_WRITE_TOOL = tool('save_catalog_definition',
  'Ensure/reuse or revise a material/part definition in this project. Browse profiles/categories and read the exact published profile first; never invent profile codes. Select exactly one category with axis=material and one with axis=form, matching the exact profile record.form. Parts pin an exact material revision; compatible material properties used by the part profile are inherited server-side. Supply remaining required properties explicitly. Complete equivalents are reused atomically; uncertain definitions are not automatically equivalent. No stock, drawing, order or global publication.', {
    action: { type: 'string', enum: ['ensure', 'revise'] },
    key: { type: 'string', description: 'Stable short operation key for this intended definition in this turn; reuse for an exact retry. Letters, numbers, _ and - only.' },
    kind: { type: 'string', enum: ['material', 'part'] },
    record_id: nullableText, expected_revision: { type: 'integer', description: '0 for ensure; exact current revision for revise.' },
    name: { type: 'string' }, aliases: { type: ['array', 'null'], maxItems: 12, items: { type: 'string' }, description: 'For revise, null preserves existing aliases exactly; [] explicitly clears them. For ensure, supply an array.' },
    profile_code: { type: 'string' }, profile_revision: { type: 'integer' },
    categories: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string' }, description: 'Exactly one material and one form category, plus optional function categories. Reuse codes returned by search.' },
    properties: { ...propertiesSchema, description: propertiesSchema.description + ' For a part, put user-specified dimensions in the exact required profile keys. Compatible keys already present on the pinned material revision are inherited server-side; omitted required keys must therefore exist either on the material or in this object. Never put dimensions only in notes.' },
    material_id: { ...nullableText, description: 'Exact catalog material ID for a part; null for a material. Read that exact revision before saving the part.' }, material_revision: { type: ['integer', 'null'] }, notes: { type: ['string','null'], description: 'Descriptive notes only. Do not encode required dimensions here instead of properties. For revise, null preserves existing notes exactly; for ensure, supply a string.' },
    source_kind: { type: 'string', enum: ['user_statement', 'design_choice'], description: 'design_choice for delegated design decisions; no invented measured/manufacturer evidence.' },
    source_quote: { type: 'string', description: 'Exact excerpt from a current or earlier user message. For design_choice it records the design request, not proof the user measured the values.' },
    source_seq: { type: ['integer', 'null'], description: 'Earlier user-message seq from this conversation, or null for the current message.' },
    request_quote: { type: 'string', description: 'Exact quote from the CURRENT user request authorising this definition change. Earlier source text is not new authority.' },
  })
const code = /^[a-z][a-z0-9_]{0,63}$/
const category = /^[a-z][a-z0-9_.]{0,63}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** Combined material lookup cursor: '<combination>:<store article>' or '<combination>:-'. */
const lookupCursor = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|-))?$/i
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
    || !text(v.name, 200)
    || (v.action === 'ensure'
      ? (!text(v.notes, 2000, true) || !Array.isArray(v.aliases))
      : !((v.notes === null || text(v.notes, 2000, true)) && (v.aliases === null || Array.isArray(v.aliases))))
    || (Array.isArray(v.aliases) && (v.aliases.length > 12 || v.aliases.some(x => !text(x, 200))))
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
export function parseCatalogRead(name: string, value: unknown, options: { lookupCursor?: boolean } = {}): Record<string, unknown> | null {
  if (!isObject(value)) return null
  const base = { action: '', kind: null as string | null, query: null as string | null, after: null as string | null,
    id: null as string | null, revision: null as number | null, profile_code: null as string | null, categories: [] as string[], properties: {} as CatalogProperties }
  const v = name === CATALOG_SEARCH_TOOL.function.name ? { profile_code: null, profile_revision: null, ...value } : value
  if (name === CATALOG_READ_TOOL.function.name) {
    if (!exactKeys(v, CATALOG_READ_TOOL.function.parameters.required) || !text(v.id, 200) || (v.revision !== null && !revision(v.revision))) return null
    if (v.entity === 'definition' ? !uuid.test(v.id) : v.entity !== 'profile' || !code.test(v.id)) return null
    return { ...base, action: v.entity === 'profile' ? 'profile' : 'read', id: v.id, revision: v.revision }
  }
  if (name !== CATALOG_SEARCH_TOOL.function.name || !exactKeys(v, Object.keys(CATALOG_SEARCH_TOOL.function.parameters.properties))
    || !['categories','profiles','materials','parts'].includes(String(v.entity))
    || (v.query !== null && !text(v.query,200)) || (v.after !== null && !text(v.after,200))
    || (v.profile_code !== null && (typeof v.profile_code !== 'string' || !code.test(v.profile_code)))
    || (v.profile_revision !== null && (!revision(v.profile_revision) || v.profile_code === null))
    || !Array.isArray(v.categories) || v.categories.length > 12 || new Set(v.categories).size !== v.categories.length
    || v.categories.some(x => typeof x !== 'string' || !category.test(x))
    || !propertiesValid(v.properties, false, true)) return null
  const dictionary = v.entity === 'categories' || v.entity === 'profiles'
  if (dictionary && (v.profile_code !== null || v.profile_revision !== null || v.categories.length || Object.keys(v.properties).length)) return null
  if (!dictionary && v.after !== null && !(options.lookupCursor ? lookupCursor : uuid).test(v.after as string)) return null
  if (Object.keys(v.properties).length && (v.profile_code === null || v.profile_revision === null)) return null
  return { ...base, action: dictionary ? v.entity : 'search', kind: dictionary ? null : v.entity === 'materials' ? 'material' : 'part',
    query: v.query, after: v.after, profile_code: v.profile_code, revision: v.profile_revision, categories: v.categories, properties: v.properties }
}
/** Diagnose a rejected call without accepting defaults or exposing field values. */
function catalogReadIssue(name: string, value: unknown): Record<string, unknown> {
  const spec = name === CATALOG_READ_TOOL.function.name ? CATALOG_READ_TOOL : CATALOG_SEARCH_TOOL
  const issues = schemaIssues(spec.function.parameters, value)
  const invalid = (fields: string[], message: string) => ({ status: 'invalid', validation: { code: 'domain_fields', fields }, message })
  if (issues.length) return { ...invalid(issues.map(i => i.path), 'Supply every required field and remove unsupported fields. Use null for unused nullable filters, [] for categories, and {} for properties. Correct the reported fields and retry.'), issues }
  if (isObject(value) && name === CATALOG_SEARCH_TOOL.function.name) {
    if (value.query !== null && !text(value.query, 200)) return invalid(['query'], 'Use query=null to browse all entries, or a non-empty search string of at most 200 characters. Empty or whitespace-only query is invalid.')
    if (value.entity === 'categories' || value.entity === 'profiles') return invalid(['categories','profile_code','profile_revision','properties'], 'Vocabulary browsing requires categories=[], profile_code=null, profile_revision=null, properties={}. Use query=null to browse all categories/profiles, then copy exact codes and revisions from the result.')
    if (isObject(value.properties) && Object.keys(value.properties).length && (value.profile_code == null || value.profile_revision == null)) return invalid(['profile_code','profile_revision'], 'Typed property filters require both profile_code and profile_revision from an exact published profile. Browse profiles and read that profile first, or use properties={} for an untyped search.')
    if (value.after !== null && (typeof value.after !== 'string' || !uuid.test(value.after))) return invalid(['after'], 'For materials/parts, after must be the exact next_cursor UUID from the previous result, or null for the first page.')
  }
  return invalid([], 'Use the loaded schema and exact profile, category or item references. Property filters must have known non-parameter values; read the exact profile for valid fields and units.')
}
/** Fixed public guidance only. Never forward raw database messages or details. */
export function catalogRejection(message = ''): { fields: string[]; message: string } | null {
  if (/\bcatalog_invalid_categories\b/.test(message)) return { fields: ['categories','profile_code','profile_revision'], message: 'No change made: category/profile combination is invalid. Use search_material_catalog with entity=categories and entity=profiles, then read_material_catalog with entity=profile and the returned code/revision. Choose exactly one category with axis=material and one with axis=form matching that profile record.form; optional extras must have axis=function. Do not invent codes; use the returned category axes and profile form. Correct the same intended definition and retry.' }
  if (/\bcatalog_invalid_profile_or_properties\b/.test(message)) return { fields: ['profile_code','profile_revision','properties'], message: 'No change made: profile or properties are invalid. Use search_material_catalog with entity=profiles, then read_material_catalog with entity=profile and its returned code/revision. Use only that published profile and its exact fields, required properties, types and units; do not invent profile codes. Correct the same intended definition and retry.' }
  if (/\bcatalog_(unknown_property|missing_property)\b/.test(message)) return { fields: ['properties'], message: 'No change made: a profile property is missing or unsupported. Read the exact profile and use its field keys, required properties, types and units. For parts, read the pinned material revision; compatible material properties are inherited, while remaining part dimensions must be in properties, never only notes. Correct and retry.' }
  if (/\bmaterial_lookup_cursor_stale\b/.test(message)) return { fields: ['after'], message: 'Nothing read: the results changed since the previous page. Search again with after=null.' }
  if (/\bcatalog_unknown_category\b/.test(message)) return { fields: ['categories'], message: 'No change made: an unknown category was supplied. Browse search_material_catalog with entity=categories and copy returned codes; do not guess category names.' }
  return null
}
export type CatalogTransport = ((input: Record<string, unknown>, signal: AbortSignal) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>) & { checkpointed?: boolean }
export type MaterialCatalogReaderState = { version: 1; projectId: string; used: number; partial: boolean; sources: ProjectSource[] }
/** Pinned per manifest (tools.search_material_catalog material_lookup_version 1):
 * an untyped material search reads bob.material_lookup, one row per combination
 * and purchase place with household stock and latest prices. Older manifests
 * keep the definition-only catalog_read search. */
export type MaterialLookupInput = { query: string | null; categories: string[]; after: string | null; id: null }
/** Owner decision 2026-11-01 (pinned per manifest: tools.find_catalog_materials).
 * The structural designer names what he needs in words. A small model matches
 * each need against the project's material list and may answer only with IDs
 * from it; code returns each item's own catalog values. */
export const CATALOG_FIND_TOOL = tool('find_catalog_materials',
  'Find exact catalog materials for needs stated in words, for example a board size or a fastener size. Returns, per need, the matching items with their exact IDs, revisions and catalog sizes, or none. Only items in the catalog are returned.', {
    needs: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 200 } },
  })
export type MaterialShortlistRow = { id: string; revision: number; name: string; profile: string; fastener: string | null; own: boolean; sizes: Record<string, string> }
export type MaterialShortlist = { rows: MaterialShortlistRow[]; complete: boolean }
export function parseMaterialShortlist(value: unknown): MaterialShortlist | null {
  const v = value as { items?: unknown; complete?: unknown } | null
  if (!v || typeof v !== 'object' || !Array.isArray(v.items) || v.items.length > 500 || typeof v.complete !== 'boolean') return null
  const ok = v.items.every(r => r && typeof r === 'object' && typeof r.id === 'string' && Number.isSafeInteger(r.revision) && typeof r.name === 'string'
    && typeof r.profile === 'string' && (r.fastener === null || typeof r.fastener === 'string') && typeof r.own === 'boolean'
    && r.sizes && typeof r.sizes === 'object' && !Array.isArray(r.sizes))
  return ok ? { rows: v.items as MaterialShortlistRow[], complete: v.complete } : null
}
/** The small model sees each item by a short list reference, never its ID:
 * fewer tokens, and an answer can only name a reference that is on the list.
 * Sizes are the catalog's own text. */
export const shortlistRef = (index: number) => 'm' + (index + 1)
export const shortlistLine = (r: MaterialShortlistRow, index: number) => ({ ref: shortlistRef(index), name: r.name, profile: r.profile,
  ...(r.fastener ? { fastener: r.fastener } : {}), sizes: r.sizes, ...(r.own ? { own: true } : {}) })
/** Turn the small model's answer into the tool result. A reference that is not
 * on the list is dropped, never passed on; a need without a valid match is none.
 * A cut list says so, because then none is not proof of absence. */
export function materialFindResult(needs: string[], list: MaterialShortlist, answer: unknown): Record<string, unknown> {
  const byRef = new Map(list.rows.map((r, i) => [shortlistRef(i), r]))
  const found = (answer as { needs?: unknown } | null)?.needs
  const entries = Array.isArray(found) ? found : []
  return { status: Array.isArray(found) ? 'ok' : 'unavailable', ...(list.complete ? {} : { list_complete: false }), needs: needs.map((need, index) => {
    const entry = entries.find(e => e && typeof e === 'object' && (e as Record<string, unknown>).index === index) as Record<string, unknown> | undefined
    const refs = Array.isArray(entry?.item_refs) ? [...new Set(entry!.item_refs.filter((ref): ref is string => typeof ref === 'string' && byRef.has(ref)))].slice(0, 5) : []
    const match = refs.length && (entry?.match === 'exact' || entry?.match === 'close') ? entry.match : 'none'
    return { need, match, items: match === 'none' ? [] : refs.map(ref => { const r = byRef.get(ref)!
      return { material_id: r.id, material_revision: r.revision, name: r.name, profile: r.profile, fastener: r.fastener, sizes: r.sizes, project_own: r.own } }) }
  }) }
}

export function createMaterialCatalogReader(projectId: string, transport: CatalogTransport, hasAccess: () => Promise<boolean>, sources: ProjectSource[], timeoutMs = 10000, options: { unlimitedWork?: boolean; lookup?: CatalogTransport; find?: (needs: string[]) => Promise<Record<string, unknown>> } = {}) {
  let used = 0, partial = false
  return {
    tools: options.find ? [CATALOG_SEARCH_TOOL, CATALOG_READ_TOOL, CATALOG_FIND_TOOL] : [CATALOG_SEARCH_TOOL, CATALOG_READ_TOOL],
    exportState(): MaterialCatalogReaderState {
      return JSON.parse(JSON.stringify({ version: 1, projectId, used, partial, sources }))
    },
    restoreState(state: MaterialCatalogReaderState) {
      if (!state || state.version !== 1 || state.projectId !== projectId || !Number.isSafeInteger(state.used) || state.used < 0 || typeof state.partial !== 'boolean'
        || !Array.isArray(state.sources) || state.sources.some(source => source?.projectId !== projectId)) throw new Error('invalid_material_catalog_reader_state')
      const saved = structuredClone(state)
      sources.splice(0, sources.length, ...saved.sources)
      used = saved.used; partial = saved.partial
    },
    get remaining() { return options.unlimitedWork ? Infinity : Math.max(0, 12 - used) }, get partial() { return partial },
    async read(name: string, value: unknown): Promise<Record<string, unknown>> {
      if (++used > 12 && !options.unlimitedWork) { partial = true; return { status: 'budget_exhausted' } }
      if (name === CATALOG_FIND_TOOL.function.name && options.find) {
        if (schemaIssues(CATALOG_FIND_TOOL.function.parameters, value).length) return { status: 'invalid', issues: schemaIssues(CATALOG_FIND_TOOL.function.parameters, value) }
        if (!await hasAccess()) return { status: 'denied' }
        try { return await options.find((value as { needs: string[] }).needs) }
        catch (error) { rethrowContinuation(error); partial = true; return { status: 'unavailable', message: 'Could not match the materials. A failed lookup does not mean they are absent.' } }
      }
      const input = parseCatalogRead(name, value, { lookupCursor: !!options.lookup })
      if (!input) { partial = true; return catalogReadIssue(name, value) }
      if (!await hasAccess()) return { status: 'denied' }
      const combined = !!options.lookup && input.action === 'search' && input.kind === 'material' && input.profile_code === null
        && Object.keys(input.properties as Record<string, unknown>).length === 0
      const reader = combined ? options.lookup! : transport
      const request: Record<string, unknown> = combined
        ? { query: input.query, categories: input.categories, after: input.after, id: null } satisfies MaterialLookupInput : input
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const { data, error } = await Promise.race([
          Promise.resolve(reader(request, controller.signal)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); if(!reader.checkpointed)reject(new Error('unavailable')) }, timeoutMs) }),
        ])
        if (!await hasAccess()) return { status: 'denied' }
        if (error?.code === '42501') return { status: 'denied' }
        if (error?.code === '22023' || error?.code === '22P02') {
          partial = true
          const issue = catalogRejection(error.message)
          return { status: 'invalid', ...(issue ? { message: issue.message, validation: { code: 'domain_fields', fields: issue.fields } } : { message: 'Invalid catalog filter, field, unit or reference. Read the profile before supplying properties.' }) }
        }
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
      } catch (error) { rethrowContinuation(error); partial = true; return { status: 'unavailable', message: 'Catalog read failed; this is not proof a definition is missing.' } }
      finally { if (timer) clearTimeout(timer) }
    },
  }
}
export type MaterialCatalogReader = ReturnType<typeof createMaterialCatalogReader>
