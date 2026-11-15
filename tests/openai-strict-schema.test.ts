import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { schemaIssues } from '../supabase/functions/_shared/schema-issues.ts'
import { COHERENT_EDIT_TOOLS } from '../supabase/functions/_shared/project-edits.ts'

// The shared service imports Edge-only modules; load it like tests/ai-catalog.test.ts does.
async function sanitizer() {
  let source = await readFile(new URL('../supabase/functions/_shared/openai-service.ts', import.meta.url), 'utf8')
  source = source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/, 'const createClient = null as any;')
  for (const module of ['openai-content', 'ai-background', 'ai-catalog', 'schema-issues', 'anthropic-service'])
    source = source.replace("'./" + module + ".ts'", JSON.stringify(new URL('../supabase/functions/_shared/' + module + '.ts', import.meta.url).href))
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return (await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))).sanitizeJsonSchema as (s: Record<string, unknown>, strict: boolean) => Record<string, unknown>
}
const keys = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach(v => keys(v, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); keys(v, out) }
  return out
}

test('strict OpenAI tools never carry keywords OpenAI refuses, also inside anyOf (live 400, 2026-11-09)', async () => {
  const sanitizeJsonSchema = await sanitizer()
  const edit = COHERENT_EDIT_TOOLS.find(t => t.function.name === 'edit_project_record')!
  assert(keys(edit.function.parameters).has('uniqueItems'), 'the source schema keeps its rule')
  const wire = sanitizeJsonSchema(edit.function.parameters as Record<string, unknown>, true)
  assert(!keys(wire).has('uniqueItems'))
  assert(keys(wire).has('maxItems'), 'supported bounds stay')
})

test('the dropped rule is still enforced by Bob\'s own check', () => {
  const schema = { type: 'array', uniqueItems: true, items: { type: 'string' } }
  assert.deepEqual(schemaIssues(schema, ['a', 'b']), [])
  assert.equal(schemaIssues(schema, ['a', 'a'])[0].expected, 'array without duplicate items')
})
