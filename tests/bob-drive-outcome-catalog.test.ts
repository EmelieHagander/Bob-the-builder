import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { countContextTokens } from '../supabase/functions/_shared/bob-token-budget.ts'

const migration = readFileSync(new URL('../supabase/migrations/20261102183000_bob_drive_outcome_catalog.sql', import.meta.url), 'utf8')
const edits = JSON.parse(migration.match(/\$bob_drive_outcome_spec\$([\s\S]+?)\$bob_drive_outcome_spec\$/)![1])

test('a go-ahead hands Bob the whole outcome; replies no longer end on a next step to wait for', () => {
  const catalog = catalogFixture()
  for (const edit of edits) {
    const text = catalog.text(edit.key)
    assert(!text.includes(edit.old), `${edit.key} no longer says: ${edit.old}`)
    if (edit.new) assert(text.includes(edit.new), `${edit.key} says: ${edit.new}`)
  }
  const contract = catalog.text('bob.contract')
  assert(contract.includes('Do not imply that work runs while the owner is away.'), 'the honesty fence stays')
  assert(!/next step/i.test(contract.split('# Replying')[1].split('#')[0]), 'Replying no longer asks for a next step')
  assert(countContextTokens(catalog.role('ask-bob').systemMessage) <= 700, 'Bob\'s role prompt stays inside its budget')
})

test('the publication is idempotent, guarded and activates its keys at once', () => {
  assert.match(migration, /drive_outcome_version'='1'\) then return/)
  assert.match(migration, /bob_drive_outcome_unexpected_%/)
  assert.equal((migration.match(/activate_ai_catalog/g) ?? []).length, 1)
})
