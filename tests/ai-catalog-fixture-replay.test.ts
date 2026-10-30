import test from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { projectSchema } from './support/project-schema.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

// The catalog fixture is a hand-written replay of the SQL publications. If it
// drifts from what the migrations produce, tests prove a catalog no database holds.
test('the catalog fixture equals the SQL migration replay for every active Bob definition', async () => {
  const pg = await projectSchema()
  const rows: any[] = (await pg.query(`select p.prompt_key as key,v.definition_kind as kind,v.version,v.content,v.definition,v.metadata,v.available_variables as variables
    from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.retired_at is null`)).rows
  const fixture = new Map(catalogFixture().manifest().definitions.map(d => [d.prompt_key, d]))
  assert.deepEqual([...fixture.keys()].sort(), rows.map(r => r.key).sort())
  const differ: string[] = []
  for (const r of rows) {
    const f = fixture.get(r.key)!
    // Tests supply the database-owned image model name themselves.
    const definition = r.key === 'tier.image' ? { ...r.definition, model_name: f.definition.model_name } : r.definition
    const parts: [string, unknown, unknown][] = [['kind', r.kind, f.definition_kind], ['version', r.version, f.version], ['content', r.content, f.content],
      ['definition', definition, f.definition], ['metadata', r.metadata, f.metadata], ['variables', r.variables, f.available_variables]]
    for (const [part, sql, fx] of parts) if (!isDeepStrictEqual(sql, fx)) differ.push(`${r.key}.${part}`)
  }
  assert.deepEqual(differ, [])
})
