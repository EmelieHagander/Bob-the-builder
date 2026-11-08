/** Owner decision 2026-11-06: Bob's construction tool schemas repeat the same
 * sub-schemas inline (one placement block seven times; 72 % of
 * `edit_construction_parts` is copies). JSON Schema can state a block once and
 * point at it, so the provider reads each block once. This is a pure, lossless
 * rewrite of the wire form: validators keep the inline schema. */
type Json = Record<string, unknown>

const stable = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v as Json).sort().map(k => [k, (v as Json)[k]])) : v)

/** A schema node worth sharing: an object/array/anyOf of some size. */
const isNode = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
  && ((v as Json).type === 'object' || (v as Json).type === 'array' || Array.isArray((v as Json).anyOf))

export const DEDUP_MIN_CHARS = 120
export const DEDUP_MIN_USES = 2

/** Replace every sub-schema that occurs at least twice (and is big enough to be
 * worth it) with `{$ref: '#/$defs/<name>'}`. Larger blocks are extracted first,
 * so a shared block can itself refer to smaller shared blocks. The root keeps
 * its own keys; `$defs` is added only when something was shared. */
export function dedupSchema(schema: unknown): unknown {
  if (!isNode(schema) && !(isNode(schema) || (schema && typeof schema === 'object'))) return schema
  const counts = new Map<string, { n: number; size: number; node: Json }>()
  const visit = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(visit); return }
    if (!v || typeof v !== 'object') return
    if (isNode(v) && v !== schema) {
      const key = stable(v)
      const entry = counts.get(key) ?? { n: 0, size: key.length, node: v as Json }
      entry.n++; counts.set(key, entry)
    }
    Object.values(v as Json).forEach(visit)
  }
  visit(schema)
  const shared = [...counts.entries()].filter(([, e]) => e.n >= DEDUP_MIN_USES && e.size >= DEDUP_MIN_CHARS)
    .sort((a, b) => b[1].size - a[1].size)
  if (!shared.length) return schema
  const names = new Map<string, string>()
  const defs: Json = {}
  const label = (node: Json, i: number) => {
    const hint = typeof node.title === 'string' ? node.title
      : node.type === 'object' && node.properties ? Object.keys(node.properties as Json).slice(0, 3).join('_')
      : node.type === 'array' ? 'list' : 'choice'
    return (hint.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'shared') + '_' + (i + 1)
  }
  shared.forEach(([key, e], i) => names.set(key, label(e.node, i)))
  // Rewrite bottom-up so each def body itself uses refs to smaller shared blocks.
  const rewrite = (v: unknown, isRoot = false): unknown => {
    if (Array.isArray(v)) return v.map(x => rewrite(x))
    if (!v || typeof v !== 'object') return v
    if (!isRoot && isNode(v)) {
      const name = names.get(stable(v))
      if (name) {
        if (!(name in defs)) { defs[name] = null; defs[name] = rewriteChildren(v as Json) }
        return { $ref: '#/$defs/' + name }
      }
    }
    return rewriteChildren(v as Json)
  }
  const rewriteChildren = (v: Json): Json => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]))
  const root = rewrite(schema, true) as Json
  return { ...root, $defs: defs }
}

/** Inverse of dedupSchema: inline every `$ref` so validators and old pins keep
 * the exact original shape. Used by tests to prove the rewrite is lossless. */
export function inlineSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema
  const defs = ((schema as Json).$defs ?? {}) as Json
  const expand = (v: unknown, depth = 0): unknown => {
    if (depth > 64) throw new Error('schema_ref_cycle')
    if (Array.isArray(v)) return v.map(x => expand(x, depth + 1))
    if (!v || typeof v !== 'object') return v
    const ref = (v as Json).$ref
    if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
      const target = defs[ref.slice('#/$defs/'.length)]
      if (!target) throw new Error('schema_ref_missing')
      return expand(target, depth + 1)
    }
    return Object.fromEntries(Object.entries(v as Json).filter(([k]) => k !== '$defs').map(([k, x]) => [k, expand(x, depth + 1)]))
  }
  return expand(schema)
}

export const schemaChars = (schema: unknown): number => JSON.stringify(schema).length
