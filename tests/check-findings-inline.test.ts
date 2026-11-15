import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constructionCheckFindings, createConstructionViews } from '../supabase/functions/_shared/construction-views.ts'

// Shaped like the entré check of 2026-11-09: 9 issues among 139 repeated gaps and 119 joint checks.
const issue = (code: string, ids: string[]) => ({ code, ids, message: 'Explain ' + code })
const output = () => ({ status: 'checked', projectId: 'p', concept_ready: false, issue_count: 9,
  issues: [...['a', 'b', 'c', 'd'].map(id => issue('contact_without_joint', [id, 'wall'])), issue('joint_faces_do_not_meet', ['j1']), issue('joint_faces_do_not_meet', ['j2']),
    issue('form_components_pending', ['roof', 'gable']), issue('form_refinement_unverified', ['walls']), issue('requirement_interpretation_unverified', ['f1'])],
  fabrication_gaps: Array.from({ length: 139 }, (_, i) => ({ code: i < 119 ? 'joint_product_and_capacity_unverified' : 'product_specification_unverified', ids: ['j' + i], message: 'Chosen, not proven: '.repeat(10) })),
  joint_checks: Array.from({ length: 119 }, (_, i) => ({ id: 'j' + i, fit: true, method: 'butt', reference: { id: 'timber.fasteners', version: 'v', content_sha256: 'x'.repeat(64) } })) })

test('check findings group issues by code and count gaps without their repeated text', () => {
  const f = constructionCheckFindings(output())
  assert.deepEqual(f.issues.map((r: any) => [r.code, r.count]), [['contact_without_joint', 4], ['joint_faces_do_not_meet', 2], ['form_components_pending', 1], ['form_refinement_unverified', 1], ['requirement_interpretation_unverified', 1]])
  assert.deepEqual(f.issues[0].ids, ['a', 'wall', 'b', 'c', 'd'])
  assert.deepEqual(f.fabrication_gaps, [{ code: 'joint_product_and_capacity_unverified', count: 119 }, { code: 'product_specification_unverified', count: 20 }])
  assert(JSON.stringify(f).length < 3000, String(JSON.stringify(f).length))
})

test('a pinned check reply carries its findings, so no section read is needed', async () => {
  const pinned = await createConstructionViews('p', () => new Date('2026-11-09T12:00:00Z'), false, true).observe('check', 'a1', 3, output())
  assert.equal(pinned.findings.issues.length, 5); assert.equal(pinned.details_omitted, undefined)
  const old = await createConstructionViews('p', () => new Date('2026-11-09T12:00:00Z')).observe('check', 'a1', 3, output())
  assert.equal(old.findings, undefined); assert.equal(old.details_omitted, true)
  // The result reference is the same either way: findings do not change the observation.
  assert.equal(pinned.result.id ?? JSON.stringify(pinned.result), old.result.id ?? JSON.stringify(old.result))
})
