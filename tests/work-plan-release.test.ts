import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { verifyWorkPlan } from '../scripts/check-live-work-plan.mjs'

const source = (path: string) => readFile(new URL('../' + path, import.meta.url), 'utf8')

test('readiness hosted proof stays wired into the foundation runner and release gates', async () => {
  const runner = await source('scripts/check-live-foundations.mjs')
  assert.match(runner, /import \{ verifyWorkPlan \} from '\.\/check-live-work-plan\.mjs'/)
  assert.match(runner, /await verifyWorkPlan\(client, anonymous, project\.id\)/)
  const ci = await source('.github/workflows/ci.yml')
  assert(ci.includes('node --check scripts/check-live-work-plan.mjs'))
  const live = await source('.github/workflows/live-foundations.yml')
  assert(live.includes('- scripts/check-live-work-plan.mjs'))
  assert(live.includes('- supabase/migrations/20260915073000_executable_work_readiness.sql'))
  assert(live.includes('run: node scripts/check-live-foundations.mjs'))
})

test('readiness hosted proof refuses real projects before any mutation or authentication action', async () => {
  let writes = 0
  const query = {
    select() { return query },
    eq() { return query },
    async single() {
      return { data: { name: 'Real renovation project', type: 'Verification', description: 'Private project' }, error: null }
    },
  }
  const client = {
    from(table: string) { assert.equal(table, 'projects'); return query },
    rpc() { writes += 1; throw new Error('Unexpected mutation') },
    auth: { getUser() { throw new Error('Fixture guard must run first') } },
  }
  await assert.rejects(verifyWorkPlan(client, {}, 'real-project'), /Bob foundations verification/)
  assert.equal(writes, 0)
})
