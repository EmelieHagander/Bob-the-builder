import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createLookupTransport, lookupPin, RETRY_LOOKUP_TIMEOUT_MS, type LookupPin } from '../supabase/functions/_shared/lookup-rpc.ts'
import { createProjectLookup, LIMITS } from '../supabase/functions/_shared/project-lookup.ts'

const input = { dataset: 'artifacts', query: null, status: null, area_id: null, record_id: '83e8bb90-bc86-4279-a187-e094d5071af8', after_id: null }
const page = { records: [{ id: input.record_id, title: 'Box', revision: 3 }], related: [], truncated: false, next_cursor: null }
const timeout = { code: '57014', message: 'canceling statement due to statement timeout' }

/** A fake caller-JWT client with scripted results, plus the journal stream/input each call used. */
function harness(pin: LookupPin, results: { data: unknown; error: { code?: string; message?: string } | null }[]) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const journal: { stream: string; input: unknown }[] = []
  const transport = createLookupTransport(() => pin, async (name, args) => {
    calls.push({ name, args })
    return results.shift() ?? { data: null, error: { code: 'XX000' } }
  }, async (stream, journalInput, work) => { journal.push({ stream, input: journalInput }); return work() })
  return { calls, journal, lookup: createProjectLookup('p1', transport, pin.timeoutMs, 10) }
}

test('pins: no pin v8, room dimensions v9, exact lookup v10 with retry and a longer allowance', () => {
  assert.deepEqual(lookupPin({}), { rpc: 'search_bob_project_data_v8', retry: false, timeoutMs: LIMITS.timeoutMs, reuse: false })
  assert.deepEqual(lookupPin({ roomDimensionsVersion: 1 }), { rpc: 'search_bob_project_data_v9', retry: false, timeoutMs: LIMITS.timeoutMs, reuse: false })
  assert.deepEqual(lookupPin({ roomDimensionsVersion: 1, exactLookupVersion: 1 }), { rpc: 'search_bob_project_data_v10', retry: true, timeoutMs: RETRY_LOOKUP_TIMEOUT_MS, reuse: false })
  assert.throws(() => lookupPin({ exactLookupVersion: 1 }), /exact_lookup_version_invalid/)
})

test('v10: one statement timeout is retried inside the same journaled read', async () => {
  const h = harness(lookupPin({ roomDimensionsVersion: 1, exactLookupVersion: 1 }), [{ data: null, error: timeout }, { data: page, error: null }])
  const result = await h.lookup.search(input)
  assert.equal(result.status, 'ok')
  assert.equal(result.records[0].id, input.record_id)
  assert.equal(h.calls.length, 2)
  assert.ok(h.calls.every(c => c.name === 'search_bob_project_data_v10'))
  assert.deepEqual(h.journal, [{ stream: 'rpc:search_bob_project_data_v10', input: h.calls[0].args }])
  assert.equal(h.lookup.partial, false)
})

test('v10: a second statement timeout stays unavailable and the exact read stays unresolved', async () => {
  const h = harness(lookupPin({ roomDimensionsVersion: 1, exactLookupVersion: 1 }), [{ data: null, error: timeout }, { data: null, error: timeout }, { data: page, error: null }])
  const result = await h.lookup.search(input)
  assert.equal(result.status, 'unavailable')
  assert.equal(h.calls.length, 2, 'retried at most once')
  assert.equal(h.journal.length, 1)
  assert.equal(h.lookup.partial, true)
})

test('v10: other errors are not retried', async () => {
  for (const [code, status] of [['42501', 'denied'], ['22023', 'invalid'], ['XX000', 'unavailable']] as const) {
    const h = harness(lookupPin({ roomDimensionsVersion: 1, exactLookupVersion: 1 }), [{ data: null, error: { code } }, { data: page, error: null }])
    assert.equal((await h.lookup.search(input)).status, status)
    assert.equal(h.calls.length, 1, code)
  }
})

test('older pins keep one attempt, their RPC and their journal stream', async () => {
  for (const [pin, name] of [[lookupPin({}), 'search_bob_project_data_v8'], [lookupPin({ roomDimensionsVersion: 1 }), 'search_bob_project_data_v9']] as const) {
    const h = harness(pin, [{ data: null, error: timeout }, { data: page, error: null }])
    assert.equal((await h.lookup.search(input)).status, 'unavailable')
    assert.equal(h.calls.length, 1)
    assert.deepEqual(h.journal, [{ stream: 'rpc:' + name, input: { p_project_id: 'p1', p_dataset: 'artifacts', p_query: null, p_status: null, p_area_id: null, p_record_id: input.record_id, p_after_id: null } }])
  }
})

test('new executions pin exactLookupVersion; old journals without it keep v8/v9', async () => {
  const code = await readFile(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  const identity = code.slice(code.indexOf("memo('execution:identity'"), code.indexOf('modelBudget = createBobModelBudget'))
  assert.match(identity, /exactLookupVersion: 1 as const,/)
  assert.match(code, /execution\.exactLookupVersion !== 1\) throw new Error\('exact_lookup_version_invalid'\)/)
  assert.match(code, /lookupPinned = lookupPin\(execution\)/)
  // Every lookup created after the pin gets the pinned time allowance.
  assert.doesNotMatch(code, /createProjectLookup\(opts\.projectId, ?lookupTransport, ?10_?000/)
})
