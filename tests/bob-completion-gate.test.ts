import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { catalogFixture, preContextStrategyCatalogFixture, preControlledCompletionCatalogFixture } from './support/ai-catalog-fixture.ts'

// Owner request 2026-10-19: a read-only turn regenerated every final answer in a
// full completion review. The gate keeps the review for answers that leave
// delegated work undone and skips it when the answer already finishes the turn.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const answer = (data: string, responseId: string) => ({ success: true, data, model: 'fixture', responseId, usage, outputPhase: 'final_answer' as const })
const payload = { data: { records: [{ id: 'A', name: 'Fixture' }], related: [], truncated: false }, error: null }
const run = async (gate: (options: any) => any, aiCatalog = catalogFixture()) => {
  const calls: string[] = [], observations: any[] = []
  const writer = createProjectWriter('A', 'Hur högt är bordet?', async () => assert.fail('no write'), async () => ({ data: [], error: null }))
  const result = await runProjectAnswer({ aiCatalog, unlimitedWork: true, projectId: 'A', userId: 'u', message: 'Hur högt är bordet?', hasAccess: async () => true,
    lookup: createProjectLookup('A', async () => payload, 1000, 1000), deadline: Infinity, writer, observe: value => observations.push(value),
    callModel: async options => {
      calls.push(options.functionName)
      if (options.functionName === 'completion-gate') {
        assert.equal(options.catalogSchemaKey, 'bob_completion_gate')
        const input = JSON.parse(String(options.messages![0].content))
        assert.equal(input.latest_instruction, 'Hur högt är bordet?')
        assert.equal(input.candidate_final_answer, 'Bordet är 72 cm högt enligt ritningen.')
        return gate(options)
      }
      return calls.filter(name => name === 'ask-bob').length === 1
        ? answer('Bordet är 72 cm högt enligt ritningen.', 'first')
        : answer('Bordet är 72 cm högt enligt ritningen, och inget arbete återstår.', 'reviewed')
    } })
  return { result, calls, observation: observations.at(-1) }
}

test('a finished read-only answer is delivered without regenerating it in a review', async () => {
  const { result, calls, observation } = await run(() => ({ success: true, model: 'mini', usage, data: { work_remaining: false, reason: 'Frågan är besvarad.' } }))
  assert(result.ok); assert.equal(result.answer, 'Bordet är 72 cm högt enligt ritningen.')
  assert.deepEqual(calls, ['ask-bob', 'completion-gate'])
  assert.equal(observation.completion_checks, 0); assert.equal(observation.completion_gate, 'done')
})

// v3 (2026-10-29) sends a targeted note or delivers; see bob-controlled-completion.test.ts.
test('a v2-pinned manifest keeps the full review for remaining work, a failed gate or an unreadable verdict', async () => {
  for (const verdict of [
    { success: true, model: 'mini', usage, data: { work_remaining: true, reason: 'Ett lovat steg återstår.' } },
    { success: false, model: 'mini', usage, data: null, error: 'unavailable' },
    { success: true, model: 'mini', usage, data: 'not json' },
  ]) {
    const { result, calls, observation } = await run(() => verdict, preControlledCompletionCatalogFixture())
    assert(result.ok); assert.match(result.answer, /inget arbete återstår/)
    assert.deepEqual(calls, ['ask-bob', 'completion-gate', 'ask-bob'])
    assert.equal(observation.completion_checks, 1)
  }
})

test('a manifest pinned before the gate keeps its original review sequence', async () => {
  const pinned = preContextStrategyCatalogFixture(snapshot => {
    const contract = snapshot.definitions.find(row => row.prompt_key === 'agent-contract.ask-bob')!
    contract.metadata.work_allowance_version = 1
    contract.metadata.work_completion_version = 2
  })
  const { calls } = await run(() => assert.fail('no gate in a pinned manifest'), pinned)
  assert.deepEqual(calls, ['ask-bob', 'ask-bob'])
})

test('the publication adds only the gate role and its parts, and the fixture matches the database', async () => {
  const { projectSchema } = await import('./support/project-schema.ts')
  const { createAiCatalogSession } = await import('../supabase/functions/_shared/ai-catalog.ts')
  let prior: any
  const pg = await projectSchema(async (db, name) => {
    if (name.endsWith('_bob_completion_gate_catalog.sql')) prior = (await db.query<{ m: any }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  }, '20261019080000_bob_completion_gate_catalog.sql')
  try {
    const current = (await pg.query<{ m: any }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
    const keys = (m: any) => m.definitions.map((d: any) => d.prompt_key)
    assert.deepEqual(keys(current).filter((k: string) => !keys(prior).includes(k)).sort(),
      ['agent-contract.completion-gate', 'completion-gate.contract', 'completion-gate.persona', 'role.completion-gate', 'schema.bob_completion_gate'])
    for (const old of prior.definitions) assert.deepEqual(current.definitions.find((d: any) => d.prompt_key === old.prompt_key), old, old.prompt_key)
    const live = createAiCatalogSession({ rpc: async () => { throw new Error('Pinned') } }, { app: 'bob', manifest: current })
    const role = live.role('completion-gate')
    assert.equal(role.tier, 'mini'); assert.equal(role.reasoningEffort, 'low')
    // The 2026-10-29 publication later versions the contract and role purpose.
    const fixture = preControlledCompletionCatalogFixture()
    for (const key of ['role.completion-gate', 'completion-gate.contract', 'schema.bob_completion_gate']) {
      assert.deepEqual(fixture.definition(key).definition, live.definition(key).definition); assert.equal(fixture.definition(key).content, live.definition(key).content)
    }
    assert.equal((await pg.query("select 1 from shared.ai_settings where app='bob' and function_name='completion-gate' and is_enabled")).rows.length, 1)
    assert.doesNotMatch(live.text('completion-gate.contract'), /\bsay "|säg |fortsätt/i)
  } finally { await pg.close() }
})

test('a context rollover keeps loaded tools offered, with their manual in the schema, instead of re-describing them', async () => {
  const { createToolSession } = await import('../supabase/functions/_shared/project-tools/session.ts')
  const rows = ['read_construction_draft', 'check_construction_draft'].map(name => ({ name, description: 'Card.', how_to: 'Manual.', schema_version: 1, always_load: false, preload_phases: [], active: true }))
  const catalogTool = (name: string, p: Record<string, unknown>) => ({ type: 'function' as const, function: { name,
    description: p.card === true ? `card:${name}` : p.include_manual === true ? `manual:${name}` : `plain:${name}`, parameters: { type: 'object', properties: {} } } })
  const session = createToolSession({ toolInstructions: 'lazy', readPolicy: async () => ({ phase: 'design', tools: rows }), catalogTool,
    definitions: rows.map(row => ({ version: 1, spec: { type: 'function', function: { name: row.name, description: 'x', parameters: { type: 'object', properties: {} } } },
      gate: () => 'available', execute: async () => ({ status: 'ok' }) })) } as any)
  const names = (specs: any[]) => specs.map(s => s.function.name)
  assert.deepEqual(names(await session.prepare()), ['describe_tool'])
  assert.equal((await session.execute('describe_tool', { name: 'read_construction_draft' })).status, 'ok')
  let specs = await session.prepare()
  assert.deepEqual(names(specs), ['read_construction_draft', 'describe_tool'])
  assert.equal(specs[0].function.description, 'card:read_construction_draft')
  assert.equal(session.toolParameters(), undefined)
  session.carryInstructions()
  specs = await session.prepare()
  assert.deepEqual(names(specs), ['read_construction_draft', 'describe_tool'], 'still callable after the rollover')
  assert.equal(specs[0].function.description, 'manual:read_construction_draft', 'the manual travels with the schema')
  assert.deepEqual(session.toolParameters(), { read_construction_draft: { card: false, include_manual: true } })
  assert(session.toolbox.find(entry => entry.name === 'read_construction_draft')?.instructionLoaded)
  session.resetInstructions()
  assert.deepEqual(names(await session.prepare()), ['describe_tool'], 'older journals keep the reset')
})

// Live turn 2026-10-20: Bob's reviewed answer was discarded when the spending
// stop ended the review, and the owner saw only a recovery template.
test('a spending stop during the review delivers the reviewed answer as partial', async () => {
  const stopped = { success: false, model: 'unavailable', data: null, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, error: 'turn_budget_exhausted' }
  const { result, calls, observation } = await (async () => {
    const calls: string[] = [], observations: any[] = []
    const writer = createProjectWriter('A', 'Hur högt är bordet?', async () => assert.fail('no write'), async () => ({ data: [], error: null }))
    const result = await runProjectAnswer({ aiCatalog: catalogFixture(), unlimitedWork: true, projectId: 'A', userId: 'u', message: 'Hur högt är bordet?', hasAccess: async () => true,
      lookup: createProjectLookup('A', async () => payload, 1000, 1000), deadline: Infinity, writer, observe: value => observations.push(value),
      callModel: async options => {
        calls.push(options.functionName)
        if (options.functionName === 'completion-gate') return { success: true, model: 'mini', usage, data: { work_remaining: true, reason: 'Granska.' } }
        return calls.filter(name => name === 'ask-bob').length === 1 ? answer('Bordet är 72 cm högt enligt ritningen.', 'first') : stopped
      } })
    return { result, calls, observation: observations.at(-1) }
  })()
  assert(result.ok); assert.equal(result.answer, 'Bordet är 72 cm högt enligt ritningen.')
  assert.equal(result.evidence.partial, true)
  assert.deepEqual(calls, ['ask-bob', 'completion-gate', 'ask-bob'])
  assert.equal(observation.end, 'step_budget')
})
