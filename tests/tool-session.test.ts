import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolSession, checkedToolSnapshot, serverRequestQuote, type ToolDefinition, type ToolPolicy, type ToolSnapshot, type ToolGate } from '../supabase/functions/_shared/project-tools/session.ts'

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
  const make = (toolInstructions: 'inline' | 'on_demand' = 'inline') => createToolSession({ definitions, readPolicy, toolInstructions })
  return { rows, definitions, make, session: make(), setPhase: (p: string | null) => { snap.phase = p },
    setGate: (name: string, v: ToolGate) => { gates.set(name, v) }, fail: (v: string) => { failure = new Error(v) }, get reads() { return reads.n }, get writes() { return writes } }
}
const names = (specs: { function: { name: string } }[]) => specs.map(s => s.function.name)

test('on-demand manuals preserve purpose, implementation boundaries, schemas and direct invocation', async () => {
  const f = fixture(), compact = f.make('on_demand')
  const before = await f.session.prepare(), after = await compact.prepare()
  assert.deepEqual(names(after).filter(n => n !== 'describe_tool'), names(before))
  assert.equal((await compact.execute('draw_shape', { value: 4 })).status, 'saved', 'manual retrieval is not a prerequisite')
  assert.equal(f.writes, 1)
  for (const tool of before) {
    const short = after.find(t => t.function.name === tool.function.name)!
    assert.deepEqual(short.function.parameters, tool.function.parameters)
    assert.match(short.function.description, /Ritning för/)
    assert.match(short.function.description, /Exact implementation boundary/)
    assert.doesNotMatch(short.function.description, /FULL_GUIDE/)
    const manual = await compact.execute('describe_tool', { name: tool.function.name })
    assert.equal(manual.status, 'ok'); assert.equal(manual.manual, tool.function.description)
  }
  assert.equal(f.writes, 1, 'manual reads never execute the target')
})

test('manual reads obey the live policy, visibility fence, schema version and closed bench', async () => {
  const f = fixture(), compact = f.make('on_demand')
  assert.equal((await compact.execute('describe_tool', { name: 'draw_shape' })).status, 'not_offered')
  f.setGate('draw_shape', 'missing_context')
  await compact.prepare()
  const waiting = await compact.execute('describe_tool', { name: 'draw_shape' })
  assert.equal(waiting.state, 'missing_context'); assert.equal(waiting.waiting_for, 'after a prerequisite')
  assert.equal((await compact.execute('draw_shape', {})).status, 'missing_context')
  f.setGate('draw_shape', 'available')
  assert.equal((await compact.execute('draw_shape', {})).status, 'not_offered', 'reading a manual never loads a capability')
  await compact.prepare()
  f.rows[1].how_to = 'Updated current manual'
  assert.match((await compact.execute('describe_tool', { name: 'draw_shape' })).manual, /Updated current manual/)
  for (const gate of ['not_allowed', 'budget_exhausted'] as const) {
    f.setGate('draw_shape', gate)
    const result = await compact.execute('describe_tool', { name: 'draw_shape' })
    if (gate === 'not_allowed') { assert.equal(result.status, 'unavailable'); assert.equal(result.manual, undefined) }
    else assert.equal(result.state, 'budget_exhausted')
  }
  f.setGate('draw_shape', 'available')
  f.rows[1].schema_version = 2; f.definitions[1].version = 2
  assert.equal((await compact.execute('describe_tool', { name: 'draw_shape' })).status, 'contract_changed')
  f.rows[1].active = false
  assert.equal((await compact.execute('describe_tool', { name: 'draw_shape' })).status, 'unavailable')
  for (const args of [null, {}, { name: 'draw_shape', extra: true }, { name: 42 }, { name: '../secret' }]) {
    assert.equal((await compact.execute('describe_tool', args)).status, 'invalid')
  }
  assert.equal((await compact.execute('describe_tool', { name: 'unknown' })).status, 'unavailable')
  compact.closeSurface()
  assert.equal((await compact.execute('describe_tool', { name: 'read_records' })).status, 'not_offered')
  assert.equal(f.writes, 0)
})

test('manual lookup cannot disclose a newly allowed tool or survive a failed policy read', async () => {
  const f = fixture(), compact = f.make('on_demand')
  f.setGate('draw_shape', 'not_allowed'); await compact.prepare()
  f.setGate('draw_shape', 'available')
  assert.equal((await compact.execute('describe_tool', { name: 'draw_shape' })).status, 'not_offered')
  f.fail('private diagnostic')
  await assert.rejects(compact.execute('describe_tool', { name: 'read_records' }), /^Error: tool_catalog_unavailable$/)
  assert.equal(f.writes, 0)
})

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

test('the server fills change provenance: hidden from the offered schema, injected on execution', async () => {
  const seen: unknown[] = []
  const quoted: ToolDefinition = { version: 1, spec: { type: 'function', function: { name: 'save_thing', description: 'Write',
    parameters: { type: 'object', additionalProperties: false, properties: { value: { type: 'number' }, request_quote: { type: 'string' } }, required: ['value', 'request_quote'] } } },
    gate: () => 'available', execute: async args => { seen.push(args); return { status: 'saved' } } }
  const session = createToolSession({ definitions: [quoted], readPolicy: async () => ({ phase: null, tools: [policy('save_thing')] }), message: 'Spara det här, tack.' })
  const [offered] = await session.prepare()
  assert.deepEqual(offered.function.parameters, { type: 'object', additionalProperties: false, properties: { value: { type: 'number' } }, required: ['value'] })
  assert.deepEqual((quoted.spec.function.parameters as any).required, ['value', 'request_quote'], 'the execution registry is unchanged')
  await session.execute('save_thing', { value: 1 })
  await session.execute('save_thing', { value: 2, request_quote: 'invented' })
  assert.deepEqual(seen, [{ value: 1, request_quote: 'Spara det här, tack.' }, { value: 2, request_quote: 'Spara det här, tack.' }])
})

test('the provenance quote is an exact prefix of at most 500 units and never splits a character', () => {
  const long = '🌲'.repeat(300)
  const quote = serverRequestQuote(long)
  assert(quote.length <= 500); assert(long.startsWith(quote)); assert.equal(quote, '🌲'.repeat(250))
  assert.equal(serverRequestQuote('Kort.'), 'Kort.')
})
