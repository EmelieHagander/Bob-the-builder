import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSolutions } from '../src/data/solutions.ts'
import { designIntent } from './support/design-intent-fixture.ts'

const id = '11111111-1111-4111-8111-111111111111'
const row = (revision = 1, intent: unknown = designIntent()) => ({ solution_id: id, id, project_id: 'A', area_id: null,
  revision, title: 'Shared cabinet', description: 'Original solution text', assumptions: 'Product checks remain open', tradeoffs: '',
  source_media_id: null, source_media_title: '', archived: false, change_note: 'Supported design choice', actor_label: 'Bob',
  recorded_at: '2026-10-09T20:00:00.000Z', design_intent: intent })
function client(versionRows: Record<string, unknown>[], wrongProject = false) {
  return { from(table: string) {
    const filters = new Map<string, unknown>()
    const result = (single = false) => {
      let records: Record<string, unknown>[] = table === 'current_target' ? [{ project_id: 'A', area_id: null, revision: 4,
        solution_id: id, solution_revision: 1, reason: 'Keep the earlier selected direction', actor_label: 'Owner', recorded_at: '2026-10-09T20:01:00.000Z' }]
        : table === 'current_solutions' ? [versionRows.at(-1)!] : table === 'solution_revisions' ? versionRows : []
      if (!wrongProject) for (const [key, value] of filters) records = records.filter(record => record[key] === value)
      return { data: single ? records[0] ?? null : records, error: null }
    }
    const query: any = { select: () => query, eq: (key: string, value: unknown) => { filters.set(key, value); return query },
      is: (key: string, value: unknown) => { filters.set(key, value); return query }, order: () => query, limit: () => query, range: () => query,
      single: async () => result(true), maybeSingle: async () => result(true),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject) }
    return query
  } } as any
}

test('selected target and history expose expert advice from their exact saved version after a newer alternative exists', async () => {
  const old = designIntent(), newer = designIntent()
  newer.choices[0].selected_direction = 'A newer unselected cabinet direction'
  const data = createSolutions(client([row(1, old), row(2, newer)]), () => () => {})
  const target = await data.target('A')
  assert.equal(target.solution?.revision, 1)
  assert.equal(target.solution?.designIntentState, 'available')
  assert.deepEqual(target.solution?.designIntent, old)
  assert.equal((await data.list('A')).items[0].designIntent?.choices[0].selected_direction, newer.choices[0].selected_direction)
  const history = await data.history('A', id)
  assert.deepEqual(history.items.map(item => item.designIntent?.choices[0].selected_direction), [old.choices[0].selected_direction, newer.choices[0].selected_direction])
})

test('legacy or unreadable expert advice keeps ordinary solution content without claiming a direction', async () => {
  for (const [intent, state] of [[undefined, 'missing'], [null, 'missing'], [{ ...designIntent(), approved: true }, 'invalid']] as const) {
    const value = await createSolutions(client([{ ...row(), design_intent: intent }]), () => () => {}).version('A', id, 1)
    assert.equal(value.description, 'Original solution text')
    assert.equal(value.designIntent, null)
    assert.equal(value.designIntentState, state)
  }
})

test('a wrong-project response cannot expose another project’s expert choices or reference images', async () => {
  const data = createSolutions(client([{ ...row(), project_id: 'B' }], true), () => () => {})
  await assert.rejects(data.version('A', id, 1), /Solution project mismatch/)
  await assert.rejects(data.list('A'), /Solution project mismatch/)
})

test('an unexpected same-project version cannot replace the requested historical advice', async () => {
  const data = createSolutions(client([row(2)], true), () => () => {})
  await assert.rejects(data.version('A', id, 1), /Solution version mismatch/)
})
