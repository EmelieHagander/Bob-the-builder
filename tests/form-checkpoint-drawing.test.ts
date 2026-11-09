import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constructionFormCheckpoint, constructionBlockingIssues } from '../supabase/functions/_shared/construction-draft.ts'

const check = (issues: any[]) => ({ status: 'checked', concept_ready: issues.length === 0, issues, issue_count: issues.length,
  fabrication_gaps: [{ code: 'joint_product_and_capacity_unverified', ids: ['j1'] }], fabrication_gap_count: 121 })
const unverified = { code: 'form_refinement_unverified', ids: ['walls'], message: '' }
const pending = { code: 'form_components_pending', ids: ['roof', 'gable'], message: '' }

test('a walls-only FORM checkpoint is drawable as a labelled partial drawing', () => {
  assert.deepEqual(constructionFormCheckpoint(check([pending, unverified])), { version: 1, pending_component_ids: ['roof', 'gable'] })
  assert.deepEqual(constructionFormCheckpoint(check([unverified])), { version: 1, pending_component_ids: [] })
})

test('any other whole-check issue still stops the drawing', () => {
  assert.equal(constructionFormCheckpoint(check([pending, unverified, { code: 'disconnected_parts', ids: ['a'] }])), null)
  assert.equal(constructionFormCheckpoint(check([pending])), null)
  assert.equal(constructionFormCheckpoint(check([])), null)
  assert.equal(constructionFormCheckpoint({ ...check([pending, unverified]), issue_count: 250 }), null)
  assert.equal(constructionFormCheckpoint({ ...check([unverified]), status: 'unavailable' }), null)
})

test('the blocker names whole-check issues, never fabrication gaps', () => {
  const blocking = constructionBlockingIssues(check([pending, unverified, { code: 'disconnected_parts', ids: ['a'] }, { code: 'disconnected_parts', ids: ['b'] }]))
  assert.deepEqual(blocking.map(b => [b.code, b.count]), [['form_components_pending', 1], ['form_refinement_unverified', 1], ['disconnected_parts', 2]])
  assert.deepEqual(blocking[2].ids, ['a', 'b'])
  assert(!JSON.stringify(blocking).includes('joint_product'))
})
