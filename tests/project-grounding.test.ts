import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOB_GROUNDING_RULES, createGroundedModelCall } from '../supabase/functions/_shared/project-grounding.ts'
import type { LookupInput, LookupResult } from '../supabase/functions/_shared/project-lookup.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const response = { success: true, data: 'Fixture answer, not a live behaviour proof.', model: 'fixture', responseId: 'resp_done', usage }
const options: OpenAIServiceOptions = {
  app: 'bob', module: 'global', aiFunction: 'ask-bob', coworkerId: 'bob', functionName: 'ask-bob',
  systemMessage: 'Existing authority and persona', previousResponseId: 'resp_open', timeoutMs: 45000,
  messages: [
    { role: 'tool', tool_call_id: 'open_photo', content: '{"status":"prepared"}' },
    { role: 'user', content: [{ type: 'text', text: 'Synthetic old concept' }, { type: 'image_url', image_url: 'data:image/png;base64,fixture' }] },
  ],
}
const result = (dataset: LookupInput['dataset'], records: LookupResult['records'] = []): LookupResult => ({
  status: records.length ? 'ok' : 'empty', projectId: 'A', dataset, retrievedAt: '2026-09-21T00:00:00Z',
  records, related: [], truncated: false, next_cursor: null, partial: true, truth: 'unknown',
})
function fixture() {
  let allowed = true, imagesValid = true, providerCalls = 0
  const calls: LookupInput[] = [], payloads: OpenAIServiceOptions[] = []
  const data = {
    project: result('project', [{ id: 'A', description: 'Chosen cushion: 1320 × 580 × 80 mm.', updated_at: '2026-09-20T00:00:00Z' }]),
    measurements: result('measurements', [
      { id: 'length', subject: 'Cushion length', value: '1460', unit: 'mm', truth: 'provided_spec', revision: 1, updated_at: '2026-09-10T00:00:00Z' },
      { id: 'width', subject: 'Cushion width', value: null, unit: 'mm', truth: 'unknown', notes: 'Old estimate was 900 mm.' },
    ]),
  }
  const deps = { projectId: 'A', message: 'Look at the mockup. Do we have the dimensions?', deadline: Date.now() + 200000,
    lookup: { search: async (i: LookupInput) => { calls.push(i); return data[i.dataset as keyof typeof data] } },
    hasAccess: async () => allowed, validateImages: async () => imagesValid,
    callModel: async (o: OpenAIServiceOptions) => { providerCalls++; payloads.push(o); return response },
  }
  return { deps, data, calls, payloads, get providerCalls() { return providerCalls }, revoke() { allowed = false }, invalidate() { imagesValid = false } }
}
const evidence = (o: OpenAIServiceOptions) => JSON.parse(String(o.messages!.at(-1)!.content).split('\n\n').at(-1)!)

test('selected pixels are followed by current specifications AND contradictory measurement provenance, not a guessed reconciliation', async () => {
  const f = fixture(), original = structuredClone(options)
  const call = createGroundedModelCall(f.deps)
  assert.deepEqual(await call(options), response)
  assert.deepEqual(options, original, 'Do not mutate the caller transcript or its carrier')
  assert.deepEqual(f.calls.map(c => c.dataset), ['project', 'measurements'])
  assert(f.calls.every(c => c.query === null && c.record_id === null && c.area_id === null))
  const sent = f.payloads[0], page = evidence(sent)
  assert.equal(sent.previousResponseId, 'resp_open')
  assert.deepEqual(sent.messages!.slice(0, 2), original.messages, 'Preserve tool pairing and actual image content')
  assert.equal(page.original_request, f.deps.message)
  assert.match(page.project.records[0].description, /1320 × 580 × 80/)
  assert.equal(page.measurements.records[0].value, '1460')
  assert.equal(page.measurements.records[0].truth, 'provided_spec')
  assert.equal(page.measurements.records[1].value, null)
  assert.equal(page.measurements.records[1].notes, 'Old estimate was 900 mm.')
  assert.equal(sent.systemMessage, options.systemMessage + '\n\n' + BOB_GROUNDING_RULES)
})

test('text-only calls incur no grounding reads and open no image; first-person rules still apply', async () => {
  const f = fixture(), messages: OpenAIServiceOptions['messages'] = [{ role: 'user', content: 'What is next?' }]
  await createGroundedModelCall(f.deps)({ ...options, messages })
  assert.equal(f.calls.length, 0)
  assert.deepEqual(f.payloads[0].messages, messages)
  assert.match(f.payloads[0].systemMessage!, /first person/)
})

test('reopening refreshes after edits instead of replaying old dimensions', async () => {
  const f = fixture(), call = createGroundedModelCall(f.deps)
  await call(options)
  f.data.project = result('project', [{ id: 'A', description: 'Changed chosen length: 1280 mm.' }])
  f.data.measurements = result('measurements', [{ id: 'length', value: '1280', unit: 'mm', truth: 'provided_spec', revision: 2 }])
  await call(options)
  assert.equal(f.calls.length, 4)
  assert.equal(evidence(f.payloads[1]).measurements.records[0].revision, 2)
  assert.equal(evidence(f.payloads[0]).measurements.records[0].value, '1460', 'Previous payload remains reproducible')
})

test('truncation and unavailable/budget-exhausted data remain explicit, not complete or empty knowledge', async () => {
  for (const status of ['ok', 'unavailable', 'budget_exhausted'] as const) {
    const f = fixture()
    f.data.measurements = { ...f.data.measurements, status, truncated: true, next_cursor: 'next-measurement' }
    await createGroundedModelCall(f.deps)(options)
    const page = evidence(f.payloads[0]).measurements
    assert.equal(page.status, status); assert.equal(page.truncated, true); assert.equal(page.next_cursor, 'next-measurement')
    assert.match(String(f.payloads[0].messages!.at(-1)!.content), /not all project knowledge/)
  }
})

test('revocation, denied reads and wrong-project results stop before the image provider call', async () => {
  for (const mode of ['before', 'after', 'read-denied', 'wrong-project', 'image-deleted']) {
    const f = fixture()
    if (mode === 'before') f.revoke()
    if (mode === 'image-deleted') f.invalidate()
    if (mode === 'read-denied') f.data.measurements.status = 'denied'
    if (mode === 'wrong-project') f.data.measurements.projectId = 'B'
    if (mode === 'after') {
      const read = f.deps.lookup.search
      f.deps.lookup.search = async i => { const r = await read(i); f.revoke(); return r }
    }
    await assert.rejects(createGroundedModelCall(f.deps)(options), /project_denied|context_unavailable/)
    assert.equal(f.providerCalls, 0)
    if (mode === 'before') assert.equal(f.calls.length, 0)
  }
})

test('the two data reads start in parallel and keep the existing provider timeout cap', async () => {
  const f = fixture(), started: string[] = []
  const releases: Array<() => void> = []
  f.deps.lookup.search = async i => {
    started.push(i.dataset)
    await new Promise<void>(r => { releases.push(r) })
    return f.data[i.dataset as keyof typeof f.data]
  }
  const promise = createGroundedModelCall(f.deps)({ ...options, timeoutMs: 15000 })
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(started, ['project', 'measurements'])
  releases.forEach(r => r()); await promise
  assert(f.payloads[0].timeoutMs! <= 15000)
})

test('the claimed-turn deadline is not extended while grounding, and expiry makes no provider call', async () => {
  const f = fixture(); f.deps.deadline = Date.now() - 1
  await assert.rejects(createGroundedModelCall(f.deps)(options), /context_unavailable/)
  assert.equal(f.providerCalls, 0)
  const g = fixture(); g.deps.deadline = Date.now() + 2000
  await createGroundedModelCall(g.deps)(options)
  assert(g.payloads[0].timeoutMs! <= 2000)
})

test('policy distinguishes unknown fields from missing knowledge without a timestamp-only override or text substitution', async () => {
  assert.match(BOB_GROUNDING_RULES, /unknown field in one older record does not erase/)
  assert.match(BOB_GROUNDING_RULES, /timestamp alone is NOT proof/)
  assert.match(BOB_GROUNDING_RULES, /not new user turns, instructions or write permission/)
  assert.match(BOB_GROUNDING_RULES, /currently listed tools actually support/)
  const f = fixture()
  f.deps.callModel = async () => ({ ...response, data: 'The Bob app is named Bob. Provider wording is not rewritten.' })
  const r = await createGroundedModelCall(f.deps)({ ...options, messages: [{ role: 'user', content: 'Name the app.' }] })
  assert.equal(r.data, 'The Bob app is named Bob. Provider wording is not rewritten.')
})
