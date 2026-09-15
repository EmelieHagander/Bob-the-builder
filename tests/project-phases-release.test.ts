import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyTodayPhaseProjection } from '../scripts/check-live-project-phases.mjs'

function fixture(overrides: Record<string, unknown> = {}, insertError: string | null = null) {
  let inserted: Record<string, unknown> | null = null
  let reads = 0
  const filters = new Map<string, unknown>()
  const query = {
    select(columns: string) { assert.equal(columns, 'id,project_id,area_id,area_phase,status'); return query },
    eq(key: string, value: unknown) { filters.set(key, value); return query },
    async single() {
      reads += 1
      assert(inserted, 'The verifier must create its own open task before reading Today')
      assert.equal(filters.get('id'), inserted.id)
      assert.equal(filters.get('project_id'), 'fixture-project')
      assert.equal(filters.get('area_id'), 'fixture-area')
      return { data: { id: inserted.id, project_id: 'fixture-project', area_id: 'fixture-area', area_phase: 'complete', status: 'todo', ...overrides }, error: null }
    },
  }
  const client = {
    from(table: string) {
      if (table === 'tasks') return {
        async insert(row: Record<string, unknown>) {
          assert.equal(inserted, null, 'Create only one dedicated fixture')
          inserted = row
          assert.match(String(row.id), /^t_phase_verification_[0-9a-f-]{36}$/)
          assert.equal(row.area_id, 'fixture-area')
          assert.equal(row.status, 'todo')
          return { data: null, error: insertError ? { message: insertError } : null }
        },
      }
      assert.equal(table, 'today_tasks')
      return query
    },
  }
  return { client, getReads: () => reads }
}

test('hosted Today phase proof creates its own open task when previous proof tasks are complete', async () => {
  const { client, getReads } = fixture()
  await verifyTodayPhaseProjection(client, 'fixture-project', 'fixture-area')
  assert.equal(getReads(), 1)
})

test('hosted Today phase proof rejects foreign or stale projection responses', async () => {
  for (const overrides of [{ project_id: 'foreign' }, { area_id: 'foreign' }, { area_phase: 'build' }, { status: 'done' }]) {
    await assert.rejects(verifyTodayPhaseProjection(fixture(overrides).client, 'fixture-project', 'fixture-area'))
  }
})

test('hosted Today phase proof fails closed when its task cannot be created', async () => {
  const { client, getReads } = fixture({}, 'permission denied')
  await assert.rejects(verifyTodayPhaseProjection(client, 'fixture-project', 'fixture-area'), /permission denied/)
  assert.equal(getReads(), 0)
})
