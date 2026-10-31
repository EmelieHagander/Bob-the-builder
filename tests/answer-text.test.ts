import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectEdits } from '../supabase/functions/_shared/project-edits.ts'
import { createExecutionMetrics } from '../supabase/functions/_shared/execution-metrics.ts'
import { checkedToolSnapshot } from '../supabase/functions/_shared/project-tools/session.ts'
import { toolRejection, EDIT_REJECTION_CODES } from '../supabase/functions/_shared/tool-rejection.ts'
import { catalogFixture, preTextHygieneCatalogFixture, preControlledCompletionCatalogFixture } from './support/ai-catalog-fixture.ts'
import { ANSWER_TEXT_NOTE, ANSWER_TEXT_ALSO_NOTE } from '../scripts/build-bob-text-hygiene-catalog.ts'

// Paid box run 2026-10-29: "Artifact: `83e8bb90-…`, Revision: `2`" reached the
// owner. The chat answer now follows the same human-text rule as saved prose.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const MESSAGE = 'Hur stor är lådan?'
const ID_ANSWER = 'Lådan är 500 × 300 × 250 mm. Konstruktion: 83e8bb90-bc86-4279-a187-e094d5071af8.'
const CLEAN = 'Lådan är 500 × 300 × 250 mm enligt den senaste konstruktionen.'
const reply = (id: string, data: string) => ({ success: true, model: 'fixture', responseId: id, usage, data, outputPhase: 'final_answer' as const })
const payload = { data: { records: [{ id: 'A', name: 'Fixture' }], related: [], truncated: false }, error: null }

async function run(answers: string[], gate: (() => any) | null, aiCatalog = catalogFixture()) {
  const calls: string[] = [], notes: string[] = [], observations: any[] = []
  let bob = 0
  const writer = createProjectWriter('A', MESSAGE, async () => assert.fail('no write'), async () => ({ data: [], error: null }))
  const result = await runProjectAnswer({ aiCatalog, unlimitedWork: true, projectId: 'A', userId: 'u', message: MESSAGE, hasAccess: async () => true, deadline: Infinity,
    lookup: createProjectLookup('A', async () => payload, 1000, 1000), writer, observe: value => observations.push(value),
    callModel: async options => {
      calls.push(options.functionName)
      if (options.functionName === 'completion-gate') { assert(gate, 'no gate call expected'); return gate() }
      const last = options.messages?.at(-1)
      if (bob > 0 && typeof last?.content === 'string' && last.content.startsWith(aiCatalog.text('bob.note.prefix'))) notes.push(last.content)
      return reply('r' + bob, answers[Math.min(bob++, answers.length - 1)])
    } })
  return { result, calls, notes, observation: observations.at(-1) }
}
const done = () => ({ success: true, model: 'mini', usage, data: { work_remaining: false, reason: '' } })

test('an answer with internal references gets one rewrite note and the rewritten words are delivered', async () => {
  const { result, calls, notes, observation } = await run([ID_ANSWER, CLEAN], done)
  assert(result.ok); assert.equal(result.answer, CLEAN)
  assert.deepEqual(calls, ['ask-bob', 'completion-gate', 'ask-bob'])
  assert.equal(notes.length, 1); assert(notes[0].includes('83e8bb90-bc86-4279-a187-e094d5071af8'))
  assert(notes[0].includes(ANSWER_TEXT_NOTE.split('{{')[0]))
  assert.equal(observation.answer_text, 'rewritten'); assert.equal(observation.answer_text_issues, 0); assert.equal(observation.completion_checks, 0)
})

test('a rewrite that still contains references is delivered as written, without a second note', async () => {
  const { result, calls, observation } = await run([ID_ANSWER, ID_ANSWER], done)
  assert(result.ok); assert.equal(result.answer, ID_ANSWER, 'the server never replaces Bob\'s words')
  assert.deepEqual(calls, ['ask-bob', 'completion-gate', 'ask-bob'])
  assert.equal(observation.answer_text, 'rewrite_unchanged'); assert.equal(observation.answer_text_issues, 1)
})

test('a completion gap and internal references share one note; there is never a third round', async () => {
  const gap = () => ({ success: true, model: 'mini', usage, data: { work_remaining: true, reason: 'Höjden saknas.' } })
  const { result, calls, notes, observation } = await run([ID_ANSWER, ID_ANSWER, CLEAN], gap)
  assert(result.ok); assert.equal(result.answer, ID_ANSWER)
  assert.deepEqual(calls, ['ask-bob', 'completion-gate', 'ask-bob'])
  assert.equal(notes.length, 1); assert(notes[0].includes('Höjden saknas.')); assert(notes[0].includes(ANSWER_TEXT_ALSO_NOTE.split('(')[0]))
  assert.equal(observation.completion_checks, 1); assert.equal(observation.answer_text, 'rewrite_unchanged')
})

test('a clean answer costs nothing extra; manifests pinned earlier never get the note', async () => {
  const clean = await run([CLEAN], done)
  assert.deepEqual(clean.calls, ['ask-bob', 'completion-gate']); assert.equal(clean.observation.answer_text, 'clean')
  const pinned = await run([ID_ANSWER], done, preTextHygieneCatalogFixture())
  assert(pinned.result.ok); assert.equal(pinned.result.answer, ID_ANSWER); assert.deepEqual(pinned.calls, ['ask-bob', 'completion-gate'])
  assert.equal(pinned.observation.answer_text, undefined)
})

test('the delivery metric records only the content-free outcome', async () => {
  const events: any[] = []
  const metrics = createExecutionMetrics({ runId: 'run', turnId: 'turn', write: async e => { events.push(e) }, now: () => 10, startedAt: 0 })
  metrics.observe({ steps: 2, tool_calls: 0, deferred_calls: 0, completion_checks: 0, nudges: 0, end: 'answered', answer_text: 'rewritten', answer_text_issues: 0 })
  await metrics.finish({ ok: true, writes: 0 })
  const delivery = events.find(e => e.kind === 'delivery')
  assert.equal(delivery.counts.answer_text, 'rewritten'); assert.equal(delivery.counts.answer_text_issues, 0)
  const state = metrics.exportState()
  assert.throws(() => metrics.restoreState({ ...state, observation: { ...state.observation!, answer_text: 'leaked text' as any } }), /metrics_checkpoint_invalid/)
  const old = createExecutionMetrics({ runId: 'run', turnId: 'turn', write: async e => { events.push(e) }, now: () => 10, startedAt: 0 })
  old.observe({ steps: 1, tool_calls: 0, deferred_calls: 0, completion_checks: 0, nudges: 0, end: 'answered' }); await old.finish({ ok: true, writes: 0 })
  assert.equal(Object.hasOwn(events.at(-1).counts, 'answer_text'), false, 'earlier turns keep their delivery row')
})

test('rejected calls log and record a content-free reason; every fixed edit message has a code', async () => {
  assert.deepEqual(toolRejection({ status: 'invalid', validation: { code: 'human_text', fields: ['text.title'] }, message: 'contains "secret"' }), { code: 'human_text', fields: ['text.title'] })
  assert.deepEqual(toolRejection({ status: 'invalid', issues: [{ code: 'request_quote', path: 'request_quote' }] }), { code: 'request_quote', fields: ['request_quote'] })
  assert.equal(toolRejection({ status: 'invalid', message: 'No change made. Unexpected token } in JSON at position 4' }).code, 'invalid_json')
  assert.equal(toolRejection({ status: 'invalid', message: 'Something new happened with "Bob\'s words".' }).code, 'unspecified')
  // An unmapped message gets a fingerprint that tells messages apart and carries none of their text (2026-10-31).
  const unmapped = toolRejection({ status: 'invalid', message: 'Something new happened with "Bob\'s words".' })
  assert.match(unmapped.message_id!, /^m[0-9a-f]{8}$/); assert(!JSON.stringify(unmapped).includes('Bob'))
  assert.equal(toolRejection({ status: 'invalid', message: 'Something new happened with "Bob\'s words".' }).message_id, unmapped.message_id)
  assert.notEqual(toolRejection({ status: 'invalid', message: 'Another fixed message.' }).message_id, unmapped.message_id)
  // Construction tools' fixed messages and engine codes are readable codes.
  assert.equal(toolRejection({ status: 'invalid', message: 'Invalid CAD recipe or referenced part IDs.' }).code, 'invalid_recipe')
  assert.equal(toolRejection({ status: 'invalid', message: 'parameter_cycle' }).code, 'parameter_cycle')
  const construction = readFileSync(new URL('../supabase/functions/_shared/construction-draft.ts', import.meta.url), 'utf8')
  for (const [, message] of construction.matchAll(/status:'invalid',message:'([^']+)'/g))
    assert.notEqual(toolRejection({ status: 'invalid', message }).code, 'unspecified', message)
  assert.deepEqual(toolRejection({ status: 'invalid', validation: { code: 'x', fields: ['ok.path', 'has spaces and prose'] } }).fields, ['ok.path'])
  // Messages are fixed server strings in project-edits.ts; a new one must get a code.
  const source = readFileSync(new URL('../supabase/functions/_shared/project-edits.ts', import.meta.url), 'utf8')
  const messages = [...source.matchAll(/(?:throw new Error|fail)\('([^']+)'/g)].map(m => m[1]).filter(m => !/^invalid_/.test(m))
  assert(messages.length >= 20)
  for (const message of messages) assert.notEqual(toolRejection({ status: 'invalid', message: 'No change made. ' + message }).code, 'unspecified', message)
  assert.equal(new Set(EDIT_REJECTION_CODES.map(([prefix]) => prefix)).size, EDIT_REJECTION_CODES.length)

  const warn = console.warn, warnings: string[] = []
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  try {
    for (const [aiCatalog, expected] of [[catalogFixture(), 'edit_ref_required'], [preControlledCompletionCatalogFixture(), undefined]] as const) {
      const events: any[] = [], message = 'Ändra lösningens beskrivning.'
      let bob = 0
      const writer = createProjectWriter('A', message, async () => assert.fail('no write'), async () => ({ data: [], error: null }))
      const projectEdits = createProjectEdits({ projectId: 'A', writer, hasAccess: async () => true, unlimitedWork: true, read: async () => ({ data: [], error: null }) })
      const result = await runProjectAnswer({ aiCatalog, unlimitedWork: true, projectId: 'A', userId: 'u', message, hasAccess: async () => true, deadline: Infinity,
        lookup: createProjectLookup('A', async () => payload, 1000, 1000), writer, projectEdits, onTool: e => events.push(e),
        readToolPolicy: async () => checkedToolSnapshot({ phase: null, tools: aiCatalog.definition('bob.tools', 'tool_contract').definition.catalog }),
        callModel: async options => {
          if (options.functionName === 'completion-gate') return done()
          const call = (name: string, args: unknown) => ({ success: true, model: 'fixture', responseId: 'c' + bob, usage, data: null, outputPhase: 'tool_calls' as const,
            toolCalls: [{ id: 'call' + bob, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] })
          if (bob++ === 0) return call('describe_tool', { name: 'edit_project_record' })
          if (bob === 2) return call('edit_project_record', { edit_ref: 'edit_missing', changes: [{ op: 'set', path: '/description', value_json: '"Ny text"' }], reason: 'Ägarens begäran', request_quote: message })
          return reply('final', 'Jag behöver läsa lösningen först.')
        } })
      assert(result.ok)
      const rejected = events.find(e => e.name === 'edit_project_record')
      assert.equal(rejected.status, 'invalid'); assert.equal(rejected.validation_code, expected)
    }
  } finally { console.warn = warn }
  const logged = warnings.filter(w => w.startsWith('[Bob tool rejection]'))
  assert(logged.length >= 2); assert(logged.every(w => w.includes('"code":"edit_ref_required"') && !w.includes('Ny text') && !w.includes('Ägarens')))
})
