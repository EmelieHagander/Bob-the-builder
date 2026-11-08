import { test } from 'node:test'
import assert from 'node:assert/strict'
import { followConstructionChanges, followUpNote, savedConstructionTargets } from '../supabase/functions/_shared/construction-follow-up.ts'

// Review of #508: a row left for lack of time is not a decision, and the note
// never says nothing was needed while rows are unread, unrun or failed.
const target = { artifact_id: '10000000-0000-4000-8000-000000000001', revision: 26 }
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (n: number, kind = 'requirement') => ({ id: id(n), kind, output_id: id(100 + n), state: 'pending' })
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ ...target, status: 'pending', items, truncated: false, next_cursor: null, ...extra })

test('left rows say what they need: calculation, an expert decision, a review or a retry', async () => {
  const statuses: Record<string, unknown> = { [id(2)]: { status: 'needs_requirement_model' }, [id(3)]: { status: 'needs_allocation_review' }, [id(4)]: { status: 'conflict', reason: 'construction_changed' } }
  const [r] = await followConstructionChanges({ targets: [target], hasAccess: async () => true, deadline: Date.now() + 60_000,
    read: async () => page([item(1), item(2), item(3), item(4), item(5, 'cut_plan')]),
    recalculate: async (_t, it) => statuses[it.id] ?? { status: 'saved' } })
  assert.equal(r.recalculated, 1); assert.deepEqual(r.other_pending, { cut_plan: 1 })
  assert.deepEqual(r.left.map(x => [x.status, x.next]), [['needs_requirement_model', 'needs_expert_decision'], ['needs_allocation_review', 'needs_review'], ['conflict', 'unavailable']])
  assert.deepEqual(r.remaining, { needs_calculation: 0, needs_expert_decision: 1, needs_review: 1, unavailable: 1 })
  const note = followUpNote([r])
  assert.match(note, /recalculated 1 material row/); assert.match(note, /Mattias chooses/); assert.match(note, /review before they change/); assert.match(note, /could not be recalculated now/)
})

test('rows not run in time need only calculation, and the note says so instead of "nothing needed"', async () => {
  let calls = 0
  const [r] = await followConstructionChanges({ targets: [target], hasAccess: async () => true, deadline: Date.now() + 5_000,
    read: async () => page([item(1), item(2)]), recalculate: async () => { calls++; return { status: 'saved' } } })
  assert.equal(calls, 0); assert.equal(r.recalculated, 0)
  assert.deepEqual(r.left.map(x => [x.status, x.next, x.reason]), [['not_run', 'needs_calculation', 'time_or_row_limit'], ['not_run', 'needs_calculation', 'time_or_row_limit']])
  const note = followUpNote([r])
  assert.doesNotMatch(note, /No material row needed/); assert.match(note, /2 not run in time: ask Konrad to continue the construction change; no decision is needed/)
})

test('an unread page is reported; a list longer than the limit keeps every count and lists twenty', async () => {
  const [unread] = await followConstructionChanges({ targets: [target], hasAccess: async () => true, deadline: Date.now() + 60_000,
    read: async (_t, after) => after ? null : page([item(1)], { truncated: true, next_cursor: id(1) }), recalculate: async () => ({ status: 'saved' }) })
  assert.equal(unread.complete, false); assert.equal(unread.recalculated, 1)
  assert.match(followUpNote([unread]), /could not be read in full; rows not read are still pending/)
  const many = Array.from({ length: 30 }, (_, n) => item(n + 1))
  const [long] = await followConstructionChanges({ targets: [target], hasAccess: async () => true, deadline: Date.now() + 60_000,
    read: async () => page(many), recalculate: async () => ({ status: 'needs_commitment_review' }) })
  assert.equal(long.left.length, 20); assert.equal(long.left_not_listed, 10); assert.equal(long.remaining.needs_review, 30)
  const [none] = await followConstructionChanges({ targets: [target], hasAccess: async () => true, deadline: Date.now() + 60_000,
    read: async () => page([], { status: 'complete' }), recalculate: async () => ({ status: 'saved' }) })
  assert.equal(followUpNote([none]), 'No material row needed recalculation.')
})

test('targets are the latest saved revision of each construction; checks and change follow-ups are not saves', () => {
  assert.deepEqual(savedConstructionTargets([{ tool: 'edit_construction_parts', record_id: 'c', revision: 25 }, { tool: 'commit_construction_sketch', record_id: 'c', revision: 26 },
    { tool: 'check_construction_draft', artifact_id: 'c', revision: 27, status: 'checked' }, { tool: 'continue_construction_change', record_id: 'need', revision: 3 }]), [{ artifact_id: 'c', revision: 26 }])
})
