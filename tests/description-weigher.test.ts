import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'
import { weighProjectDescription, type WeigherOptions } from '../supabase/functions/_shared/description-weigher.ts'
import { PROJECT_DESCRIPTION_MAX, projectDescriptionIssue } from '../src/domain/projectDescription.ts'
import type { ProjectWriter, WritePayload } from '../supabase/functions/_shared/project-write.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-11-02: one strict description length, no measurements,
// and a small separate turn that keeps the description tight after Bob saves.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const MESSAGE = '  Kör, vi bygger ladan med loft för barnen.'
const receipt = (dataset: string) => ({ projectId: 'A', dataset, recordId: 'r1', label: 'Lösning', operation: 'updated', savedAt: '2026-11-02T20:00:00Z' })

function harness(replies: string[], over: Partial<{ receipts: unknown[]; uncertain: boolean; remaining: number; current: string }> = {}) {
  const payloads: WritePayload[] = []
  const calls: OpenAIServiceOptions[] = []
  const writer = {
    receipts: over.receipts ?? [receipt('solutions')], uncertain: over.uncertain ?? false, remaining: over.remaining ?? 10,
    commit: async (payload: WritePayload) => { payloads.push(payload); return { status: 'saved' as const } },
  } as unknown as ProjectWriter
  const callModel = catalogCall(async options => {
    calls.push(options)
    const data = replies.shift()
    return data === undefined ? { success: false, error: 'none', usage } : { success: true, data, usage }
  })
  const opts: WeigherOptions = { projectId: 'A', userId: 'u', message: MESSAGE, answer: 'Klart, lösningen är sparad.', writer, callModel,
    hasAccess: async () => true, deadline: Date.now() + 200000,
    read: async () => ({ project: { name: 'Lada', type: null, phase: 'design', description: over.current ?? 'En lada för höns.', updatedAt: '2026-11-02T19:00:00Z' }, plan: [{ title: 'Grund', state: 'todo' }] }) }
  return { opts, payloads, calls }
}

test('the strict limit sits 200 characters under what Bob reads, and measurements never pass', () => {
  assert.equal(PROJECT_DESCRIPTION_MAX, 1500)
  assert.equal(projectDescriptionIssue('En liten lada för 10–15 hönor och två kaniner.'), null, 'counts are not measurements')
  assert.equal(projectDescriptionIssue('Laga datum 10 mars.'), null)
  for (const text of ['En lada på 4 x 7 m.', 'Väggar 120 cm höga.', 'Golvet blir 28 kvm.', 'Takvinkel 27°', 'Regel 45x95.', 'Bredd 2,4 m'])
    assert.equal(projectDescriptionIssue(text), 'measurement', text)
  assert.equal(projectDescriptionIssue('a'.repeat(1501)), 'too_long')
  assert.equal(projectDescriptionIssue('  '), 'empty')
})

test('after a turn that saved something, the nano weigher rewrites the description through the claimed writer', async () => {
  const h = harness([JSON.stringify({ description: '  En lada för höns och kaniner med ett loft för barnen. Nu i designfasen.  ' })])
  assert.equal(await weighProjectDescription(h.opts), 'saved')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].catalogRoleKey, 'description-weigher')
  assert.equal(catalogFixture().role('description-weigher').model.model_name, 'gpt-5.4-nano', 'the role resolves to the nano tier in the fixture')
  const input = JSON.parse(String(h.calls[0].messages?.[0].content))
  assert.equal(input.max_characters, 1500)
  assert.deepEqual(input.turn.saved, [{ dataset: 'solutions', label: 'Lösning', operation: 'updated' }])
  assert.equal(h.payloads.length, 1)
  const [payload] = h.payloads
  assert.equal(payload.kind, 'project')
  assert.equal(payload.expected_updated_at, '2026-11-02T19:00:00Z')
  assert.deepEqual(payload.data, { description: 'En lada för höns och kaniner med ett loft för barnen. Nu i designfasen.' })
  assert.ok(MESSAGE.includes(payload.request_quote) && payload.request_quote.trim().length > 0)
})

test('the role sits on the nano tier', () => {
  assert.equal(catalogFixture().definition('profile.description-weigher', 'execution_profile').definition.tier, 'nano')
})

test('a text with measurements gets one retry with the reason, then nothing is saved', async () => {
  const h = harness([JSON.stringify({ description: 'En lada på 4 x 7 m.' }), JSON.stringify({ description: 'Ladan är 28 kvm.' })])
  assert.equal(await weighProjectDescription(h.opts), 'rejected')
  assert.equal(h.calls.length, 2)
  assert.equal(JSON.parse(String(h.calls[1].messages?.[0].content)).validationFeedback.issue, 'measurement')
  assert.equal(h.payloads.length, 0)
})

test('an unchanged description is not written again', async () => {
  const h = harness([JSON.stringify({ description: 'En lada för höns.' })])
  assert.equal(await weighProjectDescription(h.opts), 'unchanged')
  assert.equal(h.payloads.length, 0)
})

test('nothing to weigh: no saves, an uncertain write, or Bob already saved the description', async () => {
  for (const over of [{ receipts: [] }, { uncertain: true }, { remaining: 0 }, { receipts: [receipt('project')] }]) {
    const h = harness([JSON.stringify({ description: 'Ny text.' })], over)
    assert.equal(await weighProjectDescription(h.opts), 'skipped')
    assert.equal(h.calls.length + h.payloads.length, 0)
  }
})
