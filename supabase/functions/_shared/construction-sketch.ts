// Owner decision 2026-11-07 (sketchbook, design B): Konrad works on a
// construction in a sketch and saves it once per assignment. A sketch is the
// saved revision it starts from plus the changes made since, in the
// edit_construction_parts format, composed so that a later change to the same
// id replaces the earlier one. Pure code; the store is a private job table.

/** Identity of each edit collection, as the server merge uses it. */
export const SKETCH_KEYS = {
  definitions: 'id', instances: 'id', nodes: 'id', bindings: 'path',
  materials: 'definition_id', joints: 'id', roles: 'instance_id',
} as const
export type SketchCollection = keyof typeof SKETCH_KEYS
type Delta = { upsert: Record<string, any>[]; remove: string[] }
export type SketchChanges = Partial<Record<SketchCollection, Delta>>
export type SketchIssue = { code: string; path: string }
export type BaseKeys = Record<SketchCollection, string[]>
export type ConstructionSketch = {
  version: 1; base_revision: number; base_keys: BaseKeys; changes: SketchChanges; change_count: number
  text: Record<string, unknown> | null; target_revision: number | null; notes: string[]
}
/** The job's private sketch table, bound to the claimed turn by the runtime. */
export type ConstructionSketchStore = {
  read(artifactId: string): Promise<{ status: 'ok'; revision: number; sketch: unknown } | { status: 'unavailable' }>
  put(artifactId: string, expectedRevision: number, sketch: ConstructionSketch): Promise<{ status: 'stored'; revision: number } | { status: 'conflict' | 'unavailable' }>
  drop(artifactId: string): Promise<{ status: 'dropped' } | { status: 'unavailable' }>
  list(): Promise<{ status: 'ok'; sketches: { artifact_id: string; base_revision: number; change_count: number }[] } | { status: 'unavailable' }>
}

/** The store over the claimed caller's construction_sketch RPC. */
export function createConstructionSketchStore(call: (action: 'read' | 'put' | 'drop' | 'list', artifact: string | null, expected: number | null, sketch: ConstructionSketch | null) =>
  Promise<{ data: any; error: { code?: string } | null }>): ConstructionSketchStore {
  return {
    read: async id => {
      const { data, error } = await call('read', id, null, null)
      return !error && data?.status === 'ok' && Number.isSafeInteger(data.revision) ? { status: 'ok', revision: data.revision, sketch: data.sketch ?? null } : { status: 'unavailable' }
    },
    put: async (id, expected, sketch) => {
      const { data, error } = await call('put', id, expected, sketch)
      if (error) return { status: error.code === 'PT409' ? 'conflict' : 'unavailable' }
      return data?.status === 'stored' && Number.isSafeInteger(data.revision) ? { status: 'stored', revision: data.revision } : { status: 'unavailable' }
    },
    drop: async id => {
      const { data, error } = await call('drop', id, null, null)
      return !error && data?.status === 'dropped' ? { status: 'dropped' } : { status: 'unavailable' }
    },
    list: async () => {
      const { data, error } = await call('list', null, null, null)
      return !error && data?.status === 'ok' && Array.isArray(data.sketches) ? { status: 'ok', sketches: data.sketches } : { status: 'unavailable' }
    },
  }
}

const names = Object.keys(SKETCH_KEYS) as SketchCollection[]
const ids = (rows: unknown, key: string): string[] =>
  Array.isArray(rows) ? rows.map(r => (r as Record<string, unknown>)?.[key]).filter((v): v is string => typeof v === 'string') : []

/** The ids a saved construction (read_construction_draft) holds per collection,
 * the same way the server builds the original it merges into. */
export function baseKeysOf(draft: Record<string, any>): BaseKeys {
  const policy = draft?.instance_policy
  return {
    definitions: ids(draft?.recipe?.definitions, 'id'), instances: ids(draft?.recipe?.instances, 'id'),
    nodes: ids(draft?.parameters?.nodes, 'id'), bindings: ids(draft?.parameters?.bindings, 'path'),
    materials: ids(draft?.materials, 'definition_id'), joints: ids(draft?.joints, 'id'),
    roles: policy && typeof policy === 'object' && !Array.isArray(policy) ? ids(policy.instances, 'instance_id') : ids(draft?.recipe?.instances, 'id'),
  }
}

export const sketchChangeCount = (changes: SketchChanges) =>
  names.reduce((n, name) => n + (changes[name]?.upsert.length ?? 0) + (changes[name]?.remove.length ?? 0), 0)

/** Adds one call's changes to the sketch. A later upsert of an id replaces the
 * earlier one; removing an id the sketch added drops it; removing a saved id
 * is kept; upserting a removed saved id keeps it, changed. The server rule that
 * no id is both upserted and removed holds for each call and for the result. */
export function composeSketchChanges(prior: SketchChanges, next: SketchChanges, base: BaseKeys): { changes: SketchChanges } | { issues: SketchIssue[] } {
  const out = structuredClone(prior), issues: SketchIssue[] = []
  for (const name of names) {
    const delta = next[name]
    if (!delta) continue
    const key = SKETCH_KEYS[name], saved = new Set(base[name] ?? [])
    const upserted = new Set(delta.upsert.map(u => u?.[key]))
    for (const r of delta.remove) if (upserted.has(r)) issues.push({ code: 'upsert_and_remove', path: `${name}/${r}` })
    const target = out[name] ?? { upsert: [], remove: [] }
    for (const r of delta.remove) {
      const at = target.upsert.findIndex(u => u?.[key] === r)
      if (at >= 0) target.upsert.splice(at, 1)
      if (saved.has(r)) { if (!target.remove.includes(r)) target.remove.push(r) }
      else if (at < 0) issues.push({ code: 'remove_missing', path: `${name}/${r}` })
    }
    for (const u of delta.upsert) {
      const k = u?.[key]
      target.remove = target.remove.filter(r => r !== k)
      const at = target.upsert.findIndex(x => x?.[key] === k)
      if (at >= 0) target.upsert[at] = structuredClone(u); else target.upsert.push(structuredClone(u))
    }
    if (target.upsert.length || target.remove.length) out[name] = target; else delete out[name]
  }
  return issues.length ? { issues: issues.slice(0, 12) } : { changes: out }
}

/** Which ids the sketch adds/changes and removes, bounded for the model. */
export function sketchSummary(changes: SketchChanges, limit = 200) {
  const summary: Record<string, { upserted: string[]; removed: string[] }> = {}
  let shown = 0, total = 0
  for (const name of names) {
    const delta = changes[name]
    if (!delta) continue
    const row = summary[name] = { upserted: [] as string[], removed: [] as string[] }
    for (const [list, values] of [[row.upserted, delta.upsert.map(u => String(u?.[SKETCH_KEYS[name]]))], [row.removed, delta.remove]] as const)
      for (const v of values) { total++; if (shown < limit) { list.push(v); shown++ } }
  }
  return { collections: summary, complete: shown === total }
}

const isDelta = (v: unknown): v is Delta => !!v && typeof v === 'object' && !Array.isArray(v)
  && Array.isArray((v as Delta).upsert) && (v as Delta).upsert.every(u => !!u && typeof u === 'object' && !Array.isArray(u))
  && Array.isArray((v as Delta).remove) && (v as Delta).remove.every(r => typeof r === 'string')

/** A stored sketch read back from the table, or null when it is not one. */
export function parseSketch(value: unknown): ConstructionSketch | null {
  const s = value as ConstructionSketch
  if (!s || typeof s !== 'object' || s.version !== 1 || !Number.isSafeInteger(s.base_revision) || s.base_revision < 1) return null
  if (!s.base_keys || names.some(n => !Array.isArray(s.base_keys[n]) || s.base_keys[n].some(k => typeof k !== 'string'))) return null
  if (!s.changes || typeof s.changes !== 'object' || Object.keys(s.changes).some(k => !names.includes(k as SketchCollection) || !isDelta((s.changes as any)[k]))) return null
  if (s.change_count !== sketchChangeCount(s.changes) || !Array.isArray(s.notes) || s.notes.some(n => typeof n !== 'string')) return null
  if (s.text !== null && (typeof s.text !== 'object' || Array.isArray(s.text))) return null
  if (s.target_revision !== null && !Number.isSafeInteger(s.target_revision)) return null
  return s
}

// Tool texts. Published with the catalog (construction_sketch_version 1); the
// code schemas below validate the same shape.
export const CONSTRUCTION_SKETCH_NOTE = ' mode sketch keeps this change in your sketch of the construction instead of saving it: it is merged with the changes already sketched (a later change to the same id replaces the earlier one), checked as a whole like a saved revision, and saves nothing. expected_revision stays the saved revision the sketch started from. mode save saves at once. Build a construction in the sketch and save it once with commit_construction_sketch when the assignment is done, or at a step the owner should see.'
export const CONSTRUCTION_SKETCH_COMMIT_TOOL = { type: 'function' as const, function: {
  name: 'commit_construction_sketch',
  description: 'Save, read or discard your sketch of one construction. commit saves all sketched changes as one new revision through the same checks as edit_construction_parts, with the whole-model check of that revision. read shows what the sketch adds, changes and removes. discard drops it without saving. rebase moves the sketch onto the current saved revision when the construction changed after the sketch began, and checks it there. A sketch lasts for this request only.',
  parameters: { type: 'object', additionalProperties: false, required: ['record_id', 'action', 'key', 'change_note', 'request_quote'], properties: {
    record_id: { type: 'string', format: 'uuid', description: 'The construction the sketch belongs to.' },
    action: { type: 'string', enum: ['commit', 'read', 'discard', 'rebase'] },
    key: { anyOf: [{ type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, { type: 'null' }], description: 'commit and rebase: names this change; a corrected retry needs a new key. null for read and discard.' },
    change_note: { anyOf: [{ type: 'string', minLength: 1, maxLength: 1000 }, { type: 'null' }], description: 'commit and rebase: what the saved change does, in plain words. null for read and discard.' },
    request_quote: { type: 'string', minLength: 1, maxLength: 500 },
  } },
} }
/** edit_construction_parts with mode sketch|save. */
export function withConstructionSketch<T extends { type: 'function'; function: { name: string; description: string; parameters: any } }>(spec: T): T {
  const p = spec.function.parameters
  return { ...spec, function: { ...spec.function, description: spec.function.description + CONSTRUCTION_SKETCH_NOTE,
    parameters: { ...p, required: [...p.required, 'mode'], properties: { ...p.properties, mode: { type: 'string', enum: ['sketch', 'save'] } } } } }
}
