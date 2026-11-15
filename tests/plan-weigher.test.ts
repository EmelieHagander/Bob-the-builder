import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'
import { weighPlanProgress, type PlanWeigherOptions, type PlanProgressContext } from '../supabase/functions/_shared/plan-weigher.ts'
import type { ProjectWriter, WritePayload } from '../supabase/functions/_shared/project-write.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-11-15: a small separate turn keeps the plan in step with
// saved work, so Steps close and focus moves without Bob having to remember.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const MESSAGE = '  Gör en inköpslista tack :)'
const receipt = (dataset: string) => ({ projectId: 'A', dataset, recordId: 'r1', label: 'Plywood', operation: 'created', savedAt: '2026-11-15T10:00:00Z' })
const context: PlanProgressContext = {
  revision: 1,
  steps: [
    { id: 's1', title: 'Modell', goal: 'Visa modellen', state: 'active', focus: true, requirements: [
      { id: 'q1', type: 'drawing', title: 'Visa vald modell', description: '', responsible: 'bob', state: 'stale' },
      { id: 'q2', type: 'decision', title: 'Klarlägg måtten', description: '', responsible: 'unassigned', state: 'missing' },
      { id: 'q3', type: 'check', title: 'Redan klart', description: '', responsible: 'bob', state: 'satisfied' }] },
    { id: 's2', title: 'Städa', goal: 'Städa verkstaden', state: 'planned', focus: false, requirements: [] },
  ],
  records: [
    { kind: 'artifact', id: 'a1', title: 'Våningssäng' },
    { kind: 'message', id: 'm1', title: 'Vi har samma mått som alltid' },
  ],
}

function harness(replies: string[], over: Partial<{ receipts: unknown[]; uncertain: boolean; remaining: number; context: PlanProgressContext }> = {}) {
  const payloads: WritePayload[] = []
  const calls: OpenAIServiceOptions[] = []
  const writer = {
    receipts: over.receipts ?? [receipt('materials')], uncertain: over.uncertain ?? false, remaining: over.remaining ?? 10,
    commit: async (payload: WritePayload) => { payloads.push(payload); return { status: 'saved' as const } },
  } as unknown as ProjectWriter
  const callModel = catalogCall(async options => {
    calls.push(options)
    const data = replies.shift()
    return data === undefined ? { success: false, error: 'none', usage } : { success: true, data, usage }
  })
  const opts: PlanWeigherOptions = { userId: 'u', message: MESSAGE, answer: 'Inköpslistan är klar.', writer, callModel,
    hasAccess: async () => true, deadline: Date.now() + 200000, read: async () => over.context ?? context }
  return { opts, payloads, calls }
}

test('the plan weigher sits on the nano tier and reads the open plan with candidate records', async () => {
  assert.equal(catalogFixture().definition('profile.plan-weigher', 'execution_profile').definition.tier, 'nano')
  const h = harness([JSON.stringify({ links: [
    { requirement_id: 'q1', evidence_kind: 'artifact', evidence_id: 'a1' },
    { requirement_id: 'q2', evidence_kind: 'message', evidence_id: 'm1' }], complete_steps: ['s2'] })])
  assert.equal(await weighPlanProgress(h.opts), 'saved')
  assert.equal(h.calls[0].catalogRoleKey, 'plan-weigher')
  const input = JSON.parse(String(h.calls[0].messages?.[0].content))
  assert.deepEqual(input.plan.steps.map((s: any) => s.id), ['s1', 's2'])
  assert.deepEqual(input.turn.saved, [{ dataset: 'materials', label: 'Plywood', operation: 'created' }])
  const [payload] = h.payloads
  assert.equal(payload.kind, 'plan_progress')
  assert.equal(payload.expected_revision, 1)
  assert.deepEqual(payload.data, { links: [
    { requirement_id: 'q1', evidence_kind: 'artifact', evidence_id: 'a1' },
    { requirement_id: 'q2', evidence_kind: 'message', evidence_id: 'm1' }], complete_steps: ['s2'] })
  assert.ok(MESSAGE.includes(payload.request_quote) && payload.request_quote.trim().length > 0)
  assert.equal('evidence_revision' in (payload.data.links as any[])[0], false, 'the server pins revisions')
})

test('links outside the input get one retry with the reason; only checked links are saved', async () => {
  const bad = { links: [
    { requirement_id: 'q1', evidence_kind: 'artifact', evidence_id: 'invented' },
    { requirement_id: 'q3', evidence_kind: 'artifact', evidence_id: 'a1' },
    { requirement_id: 'q2', evidence_kind: 'message', evidence_id: 'm1' }], complete_steps: ['s1'] }
  const h = harness([JSON.stringify(bad), JSON.stringify(bad)])
  assert.equal(await weighPlanProgress(h.opts), 'saved')
  assert.equal(h.calls.length, 2)
  const feedback = JSON.parse(String(h.calls[1].messages?.[0].content)).validationFeedback
  assert.equal(feedback.length, 3, JSON.stringify(feedback))
  assert.deepEqual(h.payloads[0].data, { links: [{ requirement_id: 'q2', evidence_kind: 'message', evidence_id: 'm1' }], complete_steps: [] })
})

test('nothing proven writes nothing; nothing to weigh never calls the model', async () => {
  const empty = harness([JSON.stringify({ links: [], complete_steps: [] })])
  assert.equal(await weighPlanProgress(empty.opts), 'unchanged')
  assert.equal(empty.payloads.length, 0)
  for (const over of [{ receipts: [] }, { uncertain: true }, { remaining: 0 }, { context: { revision: null, steps: [], records: [] } }]) {
    const h = harness([JSON.stringify({ links: [], complete_steps: [] })], over)
    assert.equal(await weighPlanProgress(h.opts), 'skipped', JSON.stringify(over))
    assert.equal(h.calls.length, 0)
  }
})
