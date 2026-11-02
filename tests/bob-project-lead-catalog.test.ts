import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

const migration = readFileSync(new URL('../supabase/migrations/20261102100000_bob_project_lead_catalog.sql', import.meta.url), 'utf8')
const spec = JSON.parse(migration.match(/\$bob_project_lead_spec\$([\s\S]+?)\$bob_project_lead_spec\$/)![1])
// bob-drive-outcome-v1 (2026-11-02) later revised some of these texts; expect them as revised.
const drive = JSON.parse(readFileSync(new URL('../supabase/migrations/20261102183000_bob_drive_outcome_catalog.sql', import.meta.url), 'utf8').match(/\$bob_drive_outcome_spec\$([\s\S]+?)\$bob_drive_outcome_spec\$/)![1])
const revised = (key: string, text: string) => drive.filter((e: any) => e.key === key).reduce((t: string, e: any) => t.replace(e.old, () => e.new), ' ' + text).trim()

test('Bob is introduced as the project lead in one story, without the duplicated mandate fences', () => {
  const catalog = catalogFixture(), system = catalog.role('ask-bob').systemMessage
  assert(system.includes(revised('bob.persona', spec.persona)), 'the persona story reaches Bob whole')
  assert(!system.includes('Du driver uppdraget'))
  assert(!system.includes('med det viktigaste och nästa steg nära slutet'), 'communication.concise is absorbed by the story')
  for (const edit of spec.edits) {
    const text = catalog.text(edit.key)
    assert(!text.includes(edit.old) || edit.new.includes(edit.old), `${edit.key} no longer says: ${edit.old}`)
    if (edit.new && revised(edit.key, edit.new)) assert(text.includes(revised(edit.key, edit.new)), `${edit.key} says: ${edit.new}`)
  }
  assert(catalog.text('bob.contract').includes('Do not imply that work runs while the owner is away.'), 'the honesty fence stays')
})

test('the publication leaves communication.concise in place for the other roles', () => {
  const catalog = catalogFixture()
  assert(catalog.text('communication.concise').includes('nästa steg nära slutet'))
  assert(catalog.role('completion-gate').systemMessage.includes('nästa steg nära slutet'))
})

test('the publication is idempotent, guarded and activates all five keys at once', () => {
  assert.match(migration, /project_lead_version'='1'\) then return/)
  assert.match(migration, /bob_project_lead_unexpected_%/)
  assert.match(migration, /array\['bob\.persona','role\.ask-bob','bob\.contract','bob\.context-principles','bob\.method'\]/)
  assert.equal((migration.match(/activate_ai_catalog/g) ?? []).length, 1)
})
