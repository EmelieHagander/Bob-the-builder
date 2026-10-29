import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { checkedToolSnapshot } from '../supabase/functions/_shared/project-tools/session.ts'
import { catalogFixture, preControlledCompletionCatalogFixture } from './support/ai-catalog-fixture.ts'
import { CONTROLLED_COMPLETION_GATE_CONTRACT, CONTROLLED_COMPLETION_GATE_GAP } from '../scripts/build-bob-controlled-completion-catalog.ts'

// Paid box run 2026-10-29: after a saved drawing and a correct answer, the
// forced full review re-read every record, tried to draw again and timed out.
// Owner decision: saved work is judged by code facts and the small gate; only a
// named gap sends Bob one targeted note.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const MESSAGE = 'Lägg till uppgiften Slipa kanterna.'
const FIRST = 'Uppgiften Slipa kanterna är sparad. Om du vill kan jag även lägga till en checklista.'
const SECOND = 'Uppgiften är sparad, och den saknade delen är nu åtgärdad.'
const tool = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const reply = (id: string, data: string | null, toolCalls?: any[]) => ({ success: true, model: 'fixture', responseId: id, usage, data, toolCalls, outputPhase: toolCalls ? 'tool_calls' as const : 'final_answer' as const })
const payload = { data: { records: [{ id: 'A', name: 'Fixture' }], related: [], truncated: false }, error: null }

async function runWork(gate: ((input: any) => any) | null, aiCatalog = catalogFixture(), task: Record<string, unknown> = { record_id: null }) {
  const calls: string[] = [], notes: string[] = [], gateInputs: any[] = [], observations: any[] = []
  let bob = 0
  const writer = createProjectWriter('A', MESSAGE, async p => ({ data: { projectId: 'A', dataset: 'tasks', recordId: 'task-1', label: String(p.data.name),
    operation: 'created', savedAt: '2026-10-29T12:00:00Z', record: { id: 'task-1', ...p.data } }, error: null }), async () => ({ data: [], error: null }), undefined, { unlimitedWork: true })
  const result = await runProjectAnswer({ aiCatalog, unlimitedWork: true, projectId: 'A', userId: 'u', message: MESSAGE, hasAccess: async () => true, deadline: Infinity,
    lookup: createProjectLookup('A', async () => payload, 1000, 1000, undefined, { unlimitedWork: true }), writer, observe: value => observations.push(value),
    readToolPolicy: async () => checkedToolSnapshot({ phase: null, tools: aiCatalog.definition('bob.tools', 'tool_contract').definition.catalog }),
    callModel: async options => {
      calls.push(options.functionName)
      if (options.functionName === 'completion-gate') {
        assert(gate, 'no gate call expected')
        const input = JSON.parse(String(options.messages![0].content)); gateInputs.push(input)
        return gate(input)
      }
      bob++
      const last = options.messages?.at(-1)
      // Step 1 carries the orientation footer; only later notes are completion notes.
      if (bob > 1 && typeof last?.content === 'string' && last.content.startsWith(aiCatalog.text('bob.note.prefix'))) notes.push(last.content)
      if (bob === 1) return reply('manual', null, [tool('m', 'describe_tool', { name: 'save_project_task' })])
      if (bob === 2) return reply('save', null, [tool('s', 'save_project_task', { area_id: 'area', step_id: null, name: 'Slipa kanterna',
        instructions: 'Slipa alla kanter.', expected_updated_at: null, ...task })])
      return reply('answer-' + bob, bob === 3 ? FIRST : SECOND)
    } })
  return { result, calls, notes, gateInputs, observation: observations.at(-1) }
}

test('saved work with a finished answer is delivered after the small gate, without a second Bob round', async () => {
  const { result, calls, notes, gateInputs, observation } = await runWork(() => ({ success: true, model: 'mini', usage, data: { work_remaining: false, reason: '' } }))
  assert(result.ok); assert.equal(result.answer, FIRST)
  assert.deepEqual(calls, ['ask-bob', 'ask-bob', 'ask-bob', 'completion-gate'])
  assert.deepEqual(notes, [])
  assert.equal(observation.completion_checks, 0); assert.equal(observation.completion_gate, 'done')
  const [input] = gateInputs
  assert.equal(input.latest_instruction, MESSAGE); assert.equal(input.candidate_final_answer, FIRST)
  assert.deepEqual(input.saved_work, [{ dataset: 'tasks', label: 'Slipa kanterna', operation: 'created' }])
  assert.deepEqual(input.attempted_actions, [{ tool: 'save_project_task', status: 'saved' }])
})

test('a gap named by the gate sends one targeted note instead of the open-ended review', async () => {
  const reason = 'Checklistan som ägaren bad om saknas.'
  const { result, calls, notes, observation } = await runWork(() => ({ success: true, model: 'mini', usage, data: JSON.stringify({ work_remaining: true, reason }) }))
  assert(result.ok); assert.equal(result.answer, SECOND)
  assert.deepEqual(calls, ['ask-bob', 'ask-bob', 'ask-bob', 'completion-gate', 'ask-bob'])
  assert.equal(notes.length, 1)
  assert(notes[0].includes(reason)); assert(notes[0].includes('Do only that part now'))
  assert.doesNotMatch(notes[0], /fresh affected records|execute it now/)
  assert.equal(observation.completion_checks, 1); assert.equal(observation.completion_gate, 'review')
})

test('without a gate verdict Bob\'s answer is delivered rather than reviewed', async () => {
  for (const verdict of [
    { success: false, model: 'mini', usage, data: null, error: 'unavailable' },
    { success: true, model: 'mini', usage, data: 'not json' },
    { success: true, model: 'mini', usage, data: { reason: 'no boolean' } },
  ]) {
    const { result, calls, observation } = await runWork(() => verdict)
    assert(result.ok); assert.equal(result.answer, FIRST)
    assert.deepEqual(calls, ['ask-bob', 'ask-bob', 'ask-bob', 'completion-gate'])
    assert.equal(observation.completion_checks, 0); assert.equal(observation.completion_gate, 'unavailable')
  }
})

test('a server-known rejected write gets the targeted finish note without asking the gate', async () => {
  const { result, calls, notes, observation } = await runWork(null, catalogFixture(), { record_id: 'missing-task' })
  assert(result.ok); assert.equal(result.answer, SECOND)
  assert.deepEqual(calls, ['ask-bob', 'ask-bob', 'ask-bob', 'ask-bob'])
  assert.equal(notes.length, 1); assert.match(notes[0], /save_project_task/)
  assert.equal(observation.completion_checks, 1); assert.equal(observation.completion_gate, undefined)
})

test('a manifest pinned before 2026-10-29 keeps the full review after saved work', async () => {
  const pinned = preControlledCompletionCatalogFixture()
  assert.equal(pinned.definition('agent-contract.ask-bob', 'agent_contract').metadata.work_completion_version, 2)
  const { result, calls, notes } = await runWork(null, pinned)
  assert(result.ok); assert.equal(result.answer, SECOND)
  assert.deepEqual(calls, ['ask-bob', 'ask-bob', 'ask-bob', 'ask-bob'])
  assert.match(notes[0], /fresh affected records/)
})

test('the publication versions only the completion contract, gate and one new note, and the fixture matches the database', async () => {
  const { projectSchema } = await import('./support/project-schema.ts')
  const { createAiCatalogSession } = await import('../supabase/functions/_shared/ai-catalog.ts')
  const { readFileSync } = await import('node:fs')
  const migration = '20261029120000_bob_controlled_completion_catalog.sql'
  let prior: any
  const pg = await projectSchema(async (db, name) => {
    if (name.endsWith(migration)) prior = (await db.query<{ m: any }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  }, migration)
  try {
    const read = async () => (await pg.query<{ m: any }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
    const current = await read()
    const byKey = (m: any) => new Map(m.definitions.map((d: any) => [d.prompt_key, d]))
    const before = byKey(prior), after = byKey(current)
    const changed = [...after.keys()].filter(k => JSON.stringify(after.get(k)) !== JSON.stringify(before.get(k))).sort()
    assert.deepEqual(changed, ['agent-contract.ask-bob', 'bob.note.gate-gap', 'completion-gate.contract', 'role.completion-gate'])
    const live = createAiCatalogSession({ rpc: async () => { throw new Error('Pinned') } }, { app: 'bob', manifest: current })
    const contract = live.definition('agent-contract.ask-bob', 'agent_contract')
    assert.equal(contract.metadata.work_completion_version, 3)
    const { work_completion_version: _now, publication: _p, controlled_completion_version: _c, ...rest } = contract.metadata
    const { work_completion_version: _was, publication: _q, ...was } = (before.get('agent-contract.ask-bob') as any).metadata
    assert.deepEqual(rest, was, 'every other contract pin is preserved')
    assert.equal(live.text('completion-gate.contract'), CONTROLLED_COMPLETION_GATE_CONTRACT)
    assert.equal(live.text('bob.note.gate-gap', { reason: 'R.' }), CONTROLLED_COMPLETION_GATE_GAP.replace('{{reason}}', 'R.'))
    assert.equal(live.role('completion-gate').tier, 'mini')
    const fixture = catalogFixture()
    for (const key of ['agent-contract.ask-bob', 'bob.note.gate-gap', 'completion-gate.contract', 'role.completion-gate']) {
      assert.deepEqual(fixture.definition(key).definition, live.definition(key).definition, key)
      assert.equal(fixture.definition(key).content, live.definition(key).content, key)
      assert.deepEqual(fixture.definition(key).metadata, live.definition(key).metadata, key)
    }
    // Re-applying the publication is a no-op.
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'))
    assert.deepEqual(await read(), current)
  } finally { await pg.close() }
})
