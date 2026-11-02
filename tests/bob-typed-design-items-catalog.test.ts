import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { CONTENT_CHANGE_ITEM, PROJECT_EDIT_TOOLS } from '../supabase/functions/_shared/project-edits.ts'

const migration = readFileSync(new URL('../supabase/migrations/20261102180000_bob_typed_design_items_catalog.sql', import.meta.url), 'utf8')
const spec = JSON.parse(migration.match(/\$bob_typed_items_spec\$([\s\S]+?)\$bob_typed_items_spec\$/)![1])

test('both Solution write tools are strict and offer the typed feature and choice changes', () => {
  assert.deepEqual(spec.items, JSON.parse(JSON.stringify(CONTENT_CHANGE_ITEM)), 'the publication carries the server schema')
  const catalog = catalogFixture()
  for (const name of ['edit_project_record', 'create_solution_alternative']) {
    const tool = catalog.tool(name).function
    assert.equal(tool.strict, true, name)
    assert.deepEqual(tool.parameters.properties.changes.items, spec.items, name)
  }
  const description = catalog.tool('edit_project_record').function.description
  assert(description.includes(spec.description.new)); assert(!description.includes('/design_intent/features/-'))
  assert.equal(PROJECT_EDIT_TOOLS[1].function.description.includes(spec.description.new), true, 'the code fallback says the same')
})

test('the publication is idempotent, guarded and activates both tools at once', () => {
  assert.match(migration, /typed_items_version'='1' then continue/)
  assert.match(migration, /bob_typed_items_unexpected_schema/)
  assert.match(migration, /bob_typed_items_unexpected_description/)
  assert.equal((migration.match(/activate_ai_catalog/g) ?? []).length, 1)
})
