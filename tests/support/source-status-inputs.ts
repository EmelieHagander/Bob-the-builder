import type { PGlite } from './pglite.ts'

/** Base tables the drawing source assessment can read, found by walking the
 * current function and view definitions (not a hand-kept list). */
export async function sourceAssessmentInputs(pg: PGlite, root = 'bob_private.artifact_source_assessment') {
  const seen = new Set<string>(), tables = new Set<string>(), queue = [root]
  const pattern = /\b(bob|bob_private)\.([a-z_0-9]+)\b/g
  while (queue.length) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    const [schema, object] = name.split('.')
    const rel = (await pg.query<{ relkind: string; def: string | null }>(
      `select c.relkind, case when c.relkind in ('v','m') then pg_get_viewdef(c.oid, true) end def
       from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2`, [schema, object])).rows[0]
    let text = ''
    if (rel) {
      if (rel.relkind === 'r' || rel.relkind === 'p') { tables.add(name); continue }
      text = rel.def ?? ''
    } else {
      const fns = (await pg.query<{ src: string }>(
        `select p.prosrc src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2`, [schema, object])).rows
      text = fns.map(f => f.src).join('\n')
    }
    for (const match of text.matchAll(pattern)) queue.push(`${match[1]}.${match[2]}`)
  }
  return [...tables].sort()
}
