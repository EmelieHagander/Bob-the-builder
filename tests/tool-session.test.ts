import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolSession, checkedToolSnapshot, type ToolDefinition, type ToolPolicy, type ToolSnapshot, type ToolGate } from '../supabase/functions/_shared/project-tools/session.ts'

/** The whole available toolbox is offered on every step with its guide. Offering
 * is never authority: policy, version and gate are re-checked on each execution. */
const policy = (name: string, core = false, phases: string[] = []): ToolPolicy => ({ name, description: 'Ritning för ett valfritt testobjekt: ' + name,
  how_to: 'FULL_GUIDE for ' + name, schema_version: 1, always_load: core, preload_phases: phases, active: true })
function fixture(rows = [policy('read_records', true), policy('draw_shape', false, ['design']), policy('analyse_materials', false, ['planning'])]) {
  const gates = new Map<string, ToolGate>(), reads = { n: 0 }
  let writes = 0
  const snap: ToolSnapshot = { phase: 'concept', tools: rows }
  let failure: Error | null = null
  const definitions: ToolDefinition[] = rows.map(p => ({ version: 1, group: 'Shelf', waitingFor: 'after a prerequisite', spec: { type: 'function', function: { name: p.name, description: 'Exact implementation boundary',
    parameters: { type: 'object', additionalProperties: false, properties: { value: { type: 'number' } }, required: ['value'] } } },
    gate: () => gates.get(p.name) ?? 'available', execute: async args => { writes++; return { status: 'saved', value: args } },
  }))
  const readPolicy = async () => { reads.n++; if (failure) throw failure; return structuredClone(snap) }
  const make = () => createToolSession({ definitions, readPolicy })
  return { rows, definitions, make, session: make(), setPhase: (p: string | null) => { snap.phase = p },
    setGate: (name: string, v: ToolGate) => { gates.set(name, v) }, fail: (v: string) => { failure = new Error(v) }, get reads() { return reads.n }, get writes() { return writes } }
}
const names = (specs: { function: { name: string } }[]) => specs.map(s => s.function.name)

test('every available tool is offered with its full guide, whatever the phase', async () => {
  for (const phase of ['concept', 'design', null, 'unrecognised']) {
    const f = fixture(); f.setPhase(phase)
    const tools = await f.make().prepare()
    assert.deepEqual(names(tools), ['analyse_materials', 'draw_shape', 'read_records'])
    for (const name of names(tools)) assert.match(JSON.stringify(tools), new RegExp('FULL_GUIDE for ' + name))
    assert.doesNotMatch(JSON.stringify(tools), /list_tools|load_tool/, 'no discovery round-trip exists')
  }
})

test('offered tools execute; a tool that became available after the step began waits for the next step', async () => {
  const f = fixture(); f.setGate('draw_shape', 'missing_context')
  await f.session.prepare()
  assert.deepEqual(f.session.toolbox.find(e => e.name === 'draw_shape'), { name: 'draw_shape', group: 'Shelf', state: 'waiting', waitingFor: 'after a prerequisite' })
  assert.equal((await f.session.execute('read_records', { value: 1 })).status, 'saved')
  f.setGate('draw_shape', 'available')
  assert.equal((await f.session.execute('draw_shape', { value: 5 })).status, 'not_offered', 'no retroactive execution within a step')
  assert(names(await f.session.prepare()).includes('draw_shape'))
  assert.equal((await f.session.execute('draw_shape', { value: 5 })).status, 'saved')
  assert.equal(f.writes, 2)
})

test('caller denial hides a tool entirely and blocks a guessed invocation', async () => {
  const f = fixture(); await f.session.prepare()
  f.setGate('draw_shape', 'not_allowed')
  assert(!names(await f.session.prepare()).includes('draw_shape'))
  assert(!f.session.toolbox.some(e => e.name === 'draw_shape'), 'not even listed as waiting')
  assert.equal((await f.session.execute('draw_shape', { value: 9 })).status, 'not_allowed')
  assert.equal(f.writes, 0)
})

test('missing prerequisite, used-up budget, disabled row, unknown name and backend failure remain distinct', async () => {
  const f = fixture(); await f.session.prepare()
  f.setGate('draw_shape', 'missing_context')
  const waiting = await f.session.execute('draw_shape', { value: 1 })
  assert.equal(waiting.status, 'missing_context'); assert.match(waiting.message, /after a prerequisite/)
  f.setGate('draw_shape', 'budget_exhausted')
  assert.equal((await f.session.execute('draw_shape', { value: 1 })).status, 'budget_exhausted')
  await f.session.prepare()
  assert.equal(f.session.toolbox.find(e => e.name === 'draw_shape')?.state, 'budget_exhausted')
  f.setGate('draw_shape', 'available'); f.rows[1].active = false
  assert.equal((await f.session.execute('draw_shape', { value: 1 })).status, 'unavailable')
  assert.equal((await f.session.execute('not_registered', {})).status, 'invalid')
  f.fail('private query diagnostic')
  await assert.rejects(f.session.prepare(), /^Error: tool_catalog_unavailable$/)
  assert.equal(f.writes, 0)
})

test('catalog rows cannot invent executable handlers or mismatch versions', async () => {
  const f = fixture(); f.rows.push(policy('imaginary_handler')); f.rows[1].schema_version = 2
  const tools = await f.session.prepare()
  assert(!names(tools).some(n => ['imaginary_handler', 'draw_shape'].includes(n)))
  for (const name of ['imaginary_handler', 'draw_shape']) assert.equal((await f.session.execute(name, { value: 1 })).status, 'unavailable')
  assert.equal(f.writes, 0)
})

test('catalog edits take effect at execution, not only when offered', async () => {
  const f = fixture(); await f.session.prepare()
  f.rows[1].active = false
  assert.equal((await f.session.execute('draw_shape', { value: 4 })).status, 'unavailable')
  assert(!names(await f.session.prepare()).includes('draw_shape'))
  assert.equal(f.writes, 0)
})

test('offered schemas are copies; a model cannot mutate the execution registry', async () => {
  const f = fixture()
  const packet = await f.session.prepare()
  ;(packet.find(t => t.function.name === 'draw_shape')!.function.parameters.required as string[]).push('malicious')
  assert.deepEqual(f.definitions[1].spec.function.parameters.required, ['value'])
  assert.deepEqual((await f.session.prepare()).find(t => t.function.name === 'draw_shape')!.function.parameters.required, ['value'])
})

test('a fresh session re-reads policy; nothing carries over between turns', async () => {
  const f = fixture(); await f.session.prepare(); const before = f.reads
  f.rows[0].active = false
  assert(!names(await f.make().prepare()).includes('read_records'))
  assert(f.reads > before)
})

test('tool-free finalization cannot execute an earlier offered tool', async () => {
  const f = fixture(); await f.session.prepare(); f.session.closeSurface()
  assert.notEqual((await f.session.execute('read_records', { value: 1 })).status, 'saved'); assert.equal(f.writes, 0)
})

test('an unexpected handler failure stops with a generic code and no private text', async () => {
  const f = fixture(); f.definitions[0].execute = async () => { throw new Error('secret row 42 violates constraint') }
  await f.session.prepare()
  await assert.rejects(f.session.execute('read_records', { value: 1 }), /^Error: tool_execution_unavailable$/)
  assert.equal(f.session.partial, true)
})

test('malformed/truncated policy fails rather than inventing an empty toolbox', () => {
  assert.throws(() => checkedToolSnapshot({ phase: null, tools: [policy('a'), policy('a')] }))
  assert.throws(() => checkedToolSnapshot({ phase: null, tools: Array(129).fill(policy('a')) }))
  assert.throws(() => checkedToolSnapshot({ phase: null, tools: [{ ...policy('a'), active: 'yes' }] }))
  assert.throws(() => checkedToolSnapshot({ phase: null, tools: [{ ...policy('a'), preload_phases: ['admin'] }] }))
})
