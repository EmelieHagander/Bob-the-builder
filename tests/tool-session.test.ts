import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolSession, checkedToolSnapshot, serverRequestQuote, type ToolDefinition, type ToolPolicy, type ToolSnapshot, type ToolGate, type ToolGuideMode } from '../supabase/functions/_shared/project-tools/session.ts'

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
  const make = (toolGuideMode?: ToolGuideMode) => createToolSession({ definitions, readPolicy, toolGuideMode })
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

test('manual candidate retains all exact schemas and blocks use until full guides are read in one batch', async () => {
  const f = fixture(), manual = f.make('manual')
  const baseline = await f.session.prepare(), short = await manual.prepare()
  assert.deepEqual(names(short).filter(n => n !== 'read_tool_manuals'), names(baseline))
  for (const full of baseline) {
    const brief = short.find(t => t.function.name === full.function.name)!
    assert.deepEqual(brief.function.parameters, full.function.parameters)
    assert(!brief.function.description.includes('FULL_GUIDE'))
    assert.equal((await manual.execute(full.function.name, { value: 1 })).status, 'manual_required')
  }
  assert.equal(f.writes, 0)
  const guides = await manual.execute('read_tool_manuals', { names: names(baseline) })
  assert.equal(guides.status, 'ok')
  assert.deepEqual(guides.manuals, baseline.map(t => ({ name: t.function.name, description: t.function.description })))
  assert.equal((await manual.execute('draw_shape', { value: 1 })).status, 'manual_required', 'a guide fetched in this batch has not reached the model yet')
  await manual.prepare()
  for (const name of names(baseline)) assert.equal((await manual.execute(name, { value: 1 })).status, 'saved')
  assert.equal(f.writes, 3)
  const fresh = f.make('manual'); await fresh.prepare()
  assert.equal((await fresh.execute('draw_shape', { value: 1 })).status, 'manual_required')
})

test('manual batches preserve denied/disabled/waiting/version and offered-step fences without partial guide leaks', async () => {
  for (const change of ['denied', 'disabled', 'waiting', 'budget', 'version', 'unknown'] as const) {
    const f = fixture(), s = f.make('manual'); await s.prepare()
    if (change === 'denied') f.setGate('draw_shape', 'not_allowed')
    if (change === 'disabled') f.rows[1].active = false
    if (change === 'waiting') f.setGate('draw_shape', 'missing_context')
    if (change === 'budget') f.setGate('draw_shape', 'budget_exhausted')
    if (change === 'version') f.rows[1].schema_version = 2
    const r = await s.execute('read_tool_manuals', { names: ['read_records', change === 'unknown' ? 'secret_tool' : 'draw_shape'] })
    assert.equal(r.status, 'not_offered'); assert.equal(r.manuals, undefined)
    assert.equal((await s.execute('read_records', { value: 1 })).status, 'manual_required')
    assert.equal(f.writes, 0)
  }
  const f = fixture(); f.setGate('draw_shape', 'missing_context')
  const s = f.make('manual'); await s.prepare(); f.setGate('draw_shape', 'available')
  assert.equal((await s.execute('read_tool_manuals', { names: ['draw_shape'] })).status, 'not_offered')
  await s.prepare(); assert.equal((await s.execute('read_tool_manuals', { names: ['draw_shape'] })).status, 'ok')
  s.closeSurface()
  assert.equal((await s.execute('read_tool_manuals', { names: ['draw_shape'] })).status, 'not_offered')
  assert.equal((await s.execute('draw_shape', { value: 1 })).status, 'not_offered')
  f.fail('private diagnostic'); await assert.rejects(s.execute('read_tool_manuals', { names: ['draw_shape'] }), /tool_catalog_unavailable/)
})

test('manual receipts invalidate on changed guides or exact schemas and cannot load a changed step contract', async () => {
  for (const change of ['guide', 'schema'] as const) {
    const f = fixture(), s = f.make('manual'); await s.prepare()
    await s.execute('read_tool_manuals', { names: ['draw_shape'] })
    if (change === 'guide') f.rows[1].how_to += ' NEW_GUIDE'
    else (f.definitions[1].spec.function.parameters as any).required.push('new_required_field')
    assert.equal((await s.execute('draw_shape', { value: 1 })).status, 'manual_required')
    assert.equal((await s.execute('read_tool_manuals', { names: ['draw_shape'] })).status, 'contract_changed')
    await s.prepare()
    assert.equal((await s.execute('read_tool_manuals', { names: ['draw_shape'] })).status, 'ok')
    await s.prepare()
    assert.equal((await s.execute('draw_shape', { value: 1 })).status, 'saved')
  }
})

test('manual reader validates bounded batches and cannot override a registered or catalog tool', async () => {
  const f = fixture(), s = f.make('manual'); await s.prepare()
  for (const args of [null, { names: [] }, { names: ['draw_shape', 'draw_shape'] },
    { names: Array(9).fill('draw_shape') }, { names: [42] }, { names: ['draw_shape'], other: true }])
    assert.equal((await s.execute('read_tool_manuals', args)).status, 'invalid')
  assert.equal((await s.execute('draw_shape', { value: 1 })).status, 'manual_required')
  const empty = createToolSession({ definitions: [], readPolicy: async () => ({ phase: null, tools: [] }), toolGuideMode: 'manual' })
  assert.deepEqual(await empty.prepare(), [])
  assert.throws(() => fixture([policy('read_tool_manuals')]).make('manual'), /Reserved/)
  f.rows.push(policy('read_tool_manuals')); await assert.rejects(s.prepare(), /Reserved/)
})

test('manual candidate hides provenance and injects the owner quote only at the existing execution boundary', async () => {
  const f = fixture([policy('save_thing')]), seen: unknown[] = []
  const def = f.definitions[0]
  ;(def.spec.function.parameters as any).properties.request_quote = { type: 'string' }
  ;(def.spec.function.parameters.required as string[]).push('request_quote')
  def.execute = async args => { seen.push(args); return { status: 'saved' } }
  const s = createToolSession({ definitions: [def], readPolicy: async () => ({ phase: null, tools: f.rows }),
    message: 'Spara det här.', toolGuideMode: 'manual' })
  const tools = await s.prepare()
  assert(!JSON.stringify(tools).includes('request_quote'))
  await s.execute('read_tool_manuals', { names: ['save_thing'] }); await s.prepare()
  assert.equal((await s.execute('save_thing', { value: 1, request_quote: 'invented' })).status, 'saved')
  assert.deepEqual(seen, [{ value: 1, request_quote: 'Spara det här.' }])
})
