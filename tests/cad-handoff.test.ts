import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareDesignHandoff } from '../supabase/functions/_shared/cad-handoff.ts'
import { handoff } from './support/cad-review-fixture.ts'

const requirement = (n: number) => ({ requirement: 'Retain dimension ' + n, basis: 'user_request' as const, source_ref: null })
const original = { ...handoff, requirements: Array.from({ length: 15 }, (_, n) => ({ id: 'saved_' + n, ...requirement(n) })) }
const prepared = async (...args: Parameters<typeof prepareDesignHandoff>) => {
  const result = await prepareDesignHandoff(...args)
  assert(!('reason' in result), JSON.stringify(result))
  return result
}

test('new requirements have bounded server IDs, ignore legacy invented IDs and replay identically', async () => {
  const input = { ...handoff, requirements: [requirement(1), requirement(2)] }
  const first = await prepared(input)
  assert(first.handoff.requirements.every(r => /^req_[a-f0-9]{32}$/.test(r.id)))
  assert.equal(new Set(first.handoff.requirements.map(r => r.id)).size, 2)
  assert.deepEqual(await prepared(input), first)
  assert.deepEqual(await prepared({ ...input, requirements: input.requirements.map((r, n) => ({ ...r, id: 'model_' + n })) }), first)
})

test('15 saved requirements plus 10 rewritten model IDs resume the same 15 requirements', async () => {
  const rewritten = { ...original, requirements: original.requirements.slice(0, 10).map((r, n) => ({ ...r, id: 'invented_' + n, requirement: 'Reworded requirement ' + n })) }
  const result = await prepared(rewritten, original)
  assert.deepEqual(result.handoff.requirements, original.requirements)
  assert.equal(result.ignored_legacy_ids.length, 10)
  assert.deepEqual((await prepared(null, original)).handoff, original)
  assert.deepEqual(original.requirements.map(r => r.id), Array.from({ length: 15 }, (_, n) => 'saved_' + n))
})

test('explicit updates retain their database identity and repeated additions reuse even historical IDs', async () => {
  const changes = [{ requirement_id: 'saved_0', ...requirement(100) }, { requirement_id: null, ...requirement(30) }, { requirement_id: null, ...requirement(1) }]
  const result = await prepared(null, original, changes)
  assert.equal(result.handoff.requirements.length, 16)
  assert.deepEqual(result.handoff.requirements[0], { id: 'saved_0', ...requirement(100) })
  assert.equal(result.handoff.requirements[1].id, 'saved_1')
  assert.deepEqual((await prepared(null, result.handoff, changes)).handoff, result.handoff)
  assert.deepEqual(await prepareDesignHandoff(null, original, [{ requirement_id: 'another_request', ...requirement(1) }]), { reason: 'unknown_requirement_id' })
})

test('restoration cannot overwrite canonical requirements, and genuine additions keep the 24 requirement limit', async () => {
  const legacy = { ...original, requirements: [{ ...original.requirements[0], requirement: 'Overwrite restored decision' }] }
  assert.deepEqual((await prepared(legacy, original, [], true)).handoff.requirements, original.requirements)
  assert.deepEqual(await prepareDesignHandoff(null, original, [{ requirement_id: 'saved_0', ...requirement(100) }], true), { reason: 'restored_requirements_immutable' })
  const additions = Array.from({ length: 10 }, (_, n) => ({ requirement_id: null, ...requirement(100 + n) }))
  assert.deepEqual(await prepareDesignHandoff(null, original, additions), { reason: 'drawing_requirement_limit' })
})

test('malformed input and new handoffs cannot substitute for a saved request', async () => {
  assert.deepEqual(await prepareDesignHandoff(null), { reason: 'invalid_handoff' })
  assert.deepEqual(await prepareDesignHandoff({ ...handoff, requirements: [{ ...requirement(1), hidden: true }] }), { reason: 'invalid_handoff' })
  assert.deepEqual(await prepareDesignHandoff({ ...handoff, requirements: [requirement(1)] }, original), { reason: 'saved_handoff_required' })
  assert.deepEqual(await prepareDesignHandoff(handoff, null, [{ requirement_id: null, ...requirement(1) }]), { reason: 'saved_request_required' })
})
