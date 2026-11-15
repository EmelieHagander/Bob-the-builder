import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { conceptFixture } from './support/solution-concept-fixtures.ts'
import { evaluateConcept } from '../supabase/functions/_shared/solution-concept.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'

// Owner decision 2026-11-09 (entré floor): solid concept components may touch
// but not share space. Live, "supports" (z 0-300) covered the "floor"
// (z 130-300), so every joist lay in both and the floor could never be mapped.
function withSupports(x: number) {
  const intent = conceptFixture('box') as any
  intent.model.nodes.push({ id: 'support_x', role: 'decision', value: x, unit: 'mm', reason: 'Synthetic support place' })
  intent.model.nodes.push({ id: 'support_l', role: 'decision', value: 100, unit: 'mm', reason: 'Synthetic support length' })
  intent.model.components.push({ id: 'supports', label: 'Supports', kind: 'solid', active: true, position: ['support_x', 'zero', 'zero'], size: ['support_l', 'width', 'wall'], features: ['fixture_form'], choices: ['fixture_design'] })
  return intent
}

test('solid concept components may touch but never overlap: TS issue, SQL issue and a named refusal on save', async t => {
  const touching = withSupports(600), overlapping = withSupports(550)
  assert.deepEqual(evaluateConcept(touching).issues.filter(i => i.code === 'component_overlap'), [])
  const local = evaluateConcept(overlapping).issues.filter(i => i.code === 'component_overlap')
  assert.deepEqual(local.map(i => i.ids), [['bottom', 'supports']])

  const pg = await projectSchema(); t.after(() => pg.close())
  const owner = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'overlap@example.test'])
  const call = async (name: string, args: unknown[]): Promise<any> => (await asProjectUser(pg, owner, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result
  const project = (await call('bob.create_project', [JSON.stringify({ name: 'Overlap' })])).id
  const body = (intent: unknown) => JSON.stringify({ title: 'Box', description: 'Synthetic', assumptions: 'Not measured', tradeoffs: '', measurements: [], design_intent: intent })

  const sql = await call('bob_private.solution_concept_result', [JSON.stringify(overlapping)])
  assert.deepEqual(sql.issues.filter((i: any) => i.code === 'component_overlap').map((i: any) => i.ids), [['bottom', 'supports']], 'SQL and TS agree')

  await call('bob.solution_command', [project, 'create', randomUUID(), 0, body(touching)])
  await assert.rejects(call('bob.solution_command', [project, 'create', randomUUID(), 0, body(overlapping)]), /^error: concept_components_overlap:bottom\+supports$|concept_components_overlap:bottom\+supports/)

  const writer = createProjectWriter(project, 'Spara lådan.', async () => ({ data: null, error: { code: '22023', message: 'concept_components_overlap:bottom+supports' } }), async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const refused: any = await writer.commit({ kind: 'solution', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: 'Spara lådan.', data: {} } as any)
  assert.equal(refused.reason, 'concept_components_overlap', JSON.stringify(refused))
  assert.deepEqual(refused.overlapping, [['bottom', 'supports']])
})
