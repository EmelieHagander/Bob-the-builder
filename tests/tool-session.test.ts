import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolSession, checkedToolSnapshot, TOOL_LIMITS, type ToolDefinition, type ToolPolicy, type ToolSnapshot, type ToolGate } from '../supabase/functions/_shared/project-tools/session.ts'
const policy = (name: string, core = false, phases: string[] = []): ToolPolicy => ({ name, description: 'Ritning för ett valfritt testobjekt: ' + name,
  how_to: 'FULL_GUIDE for ' + name, schema_version: 1, always_load: core, preload_phases: phases, active: true })
function fixture(rows = [policy('read_records', true), policy('draw_shape', false, ['design']), policy('analyse_materials', false, ['planning'])]) {
  let state: ToolGate = 'available', reads = 0, writes = 0
  let snap: ToolSnapshot = { phase: 'concept', tools: rows }
  let failure: Error | null = null
  const definitions: ToolDefinition[] = rows.map(p => ({ version: 1, spec: { type: 'function', function: { name: p.name, description: 'Exact implementation boundary',
    parameters: { type: 'object', additionalProperties: false, properties: { value: { type: 'number' } }, required: ['value'] } } },
    gate: () => state, execute: async args => { writes++; return { status: 'saved', value: args } },
  }))
  const readPolicy = async () => { reads++; if (failure) throw failure; return structuredClone(snap) }
  const make = () => createToolSession({ definitions, readPolicy })
  return { rows, definitions, make, session: make(), setPhase: (p: string | null) => { snap.phase = p },
    setGate: (v: ToolGate) => { state = v }, fail: (v: string) => { failure = new Error(v) }, get reads() { return reads }, get writes() { return writes } }
}
const names = (specs: { function: { name: string } }[]) => specs.map(s => s.function.name)
const browse = { query: null, after_name: null }

test('core plus phase preloads, never every large schema or guide', async () => {
  const f = fixture()
  let tools = await f.session.prepare()
  assert.deepEqual(names(tools), ['read_records', 'list_tools', 'load_tool'])
  assert.doesNotMatch(JSON.stringify(tools), /FULL_GUIDE|draw_shape|analyse_materials/)
  f.setPhase('design'); tools = await f.make().prepare()
  assert.deepEqual(names(tools), ['draw_shape', 'read_records', 'list_tools', 'load_tool'])
  f.setPhase('unrecognised'); assert(!names(await f.make().prepare()).includes('draw_shape'))
})

test('browse names and short descriptions, exact load hydrates the schema on the next iteration, then executes', async () => {
  const f = fixture(); await f.session.prepare()
  const listed = await f.session.execute('list_tools', browse)
  assert.equal(listed.status, 'ok'); assert.equal(listed.items.length, 3)
  assert.doesNotMatch(JSON.stringify(listed), /parameters|FULL_GUIDE/)
  const loaded = await f.session.execute('load_tool', { name: 'draw_shape' })
  assert.equal(loaded.status, 'loaded'); assert.equal(loaded.how_to, 'FULL_GUIDE for draw_shape')
  assert.deepEqual(loaded.tool.function.parameters, f.definitions[1].spec.function.parameters)
  assert.equal(f.writes, 0)
  assert.equal((await f.session.execute('draw_shape', { value: 5 })).status, 'not_loaded', 'Same-response load+guessed execution cannot bypass the offered fence')
  assert.equal(f.writes, 0)
  assert(names(await f.session.prepare()).includes('draw_shape'))
  assert.equal((await f.session.execute('draw_shape', { value: 5 })).status, 'saved')
  assert.equal(f.writes, 1)
})

test('phase is an initial-load hint, never a denial or mid-turn unload', async () => {
  const f = fixture(); f.setPhase('design'); await f.session.prepare()
  f.setPhase('build'); assert(names(await f.session.prepare()).includes('draw_shape'))
  assert.equal((await f.session.execute('load_tool', { name: 'analyse_materials' })).status, 'loaded')
  assert(names(await f.session.prepare()).includes('analyse_materials'))
  assert(!names(await f.make().prepare()).includes('draw_shape'), 'A fresh turn selects its own loadout')
})

test('catalog has complete pagination, empty text search has an unfiltered browse path, exact names do not depend on ranking', async () => {
  const f = fixture(Array.from({ length: 27 }, (_, i) => policy('operation_' + String(i).padStart(2, '0'))))
  await f.session.prepare()
  const a = await f.session.execute('list_tools', browse)
  assert.equal(a.items.length, 12); assert.equal(a.next_cursor, 'operation_11')
  const b = await f.session.execute('list_tools', { ...browse, after_name: a.next_cursor })
  const c = await f.session.execute('list_tools', { ...browse, after_name: b.next_cursor })
  assert.equal(new Set([...a.items, ...b.items, ...c.items].map((r: any) => r.name)).size, 27); assert.equal(c.next_cursor, null)
  assert.equal((await f.session.execute('list_tools', { ...browse, query: 'no match' })).status, 'empty')
  assert.equal((await f.session.execute('load_tool', { name: 'operation_26' })).status, 'loaded')
  assert.equal((await f.session.execute('list_tools', { ...browse, query: 'ritning' })).items.length, 12)
})

test('caller denial cannot be recovered through listing, exact loading, an old packet or a guessed invocation', async () => {
  const f = fixture(); await f.session.prepare()
  await f.session.execute('load_tool', { name: 'draw_shape' }); await f.session.prepare()
  f.setGate('not_allowed')
  assert.equal((await f.session.execute('list_tools', browse)).items.length, 0)
  assert.equal((await f.session.execute('load_tool', { name: 'draw_shape' })).status, 'not_allowed')
  assert.equal((await f.session.execute('draw_shape', { value: 9 })).status, 'not_allowed')
  assert.equal(f.writes, 0)
})

test('missing prerequisite, budget, disabled handler, unknown name and backend failure remain distinct', async () => {
  const f = fixture(); await f.session.prepare()
  for (const status of ['missing_context', 'budget_exhausted'] as const) {
    f.setGate(status)
    assert.equal((await f.session.execute('load_tool', { name: 'draw_shape' })).status, status)
  }
  f.setGate('available'); f.rows[1].active = false
  assert.equal((await f.session.execute('load_tool', { name: 'draw_shape' })).status, 'unavailable')
  assert.equal((await f.session.execute('load_tool', { name: 'not_registered' })).status, 'not_found')
  f.fail('private query diagnostic')
  await assert.rejects(f.session.prepare(), /^Error: tool_catalog_unavailable$/)
  assert.equal(f.writes, 0)
})

test('catalog rows cannot invent executable handlers or mismatch versions', async () => {
  const f = fixture(); f.rows.push(policy('imaginary_handler')); f.rows[1].schema_version = 2
  await f.session.prepare()
  const list = await f.session.execute('list_tools', browse)
  assert(!list.items.some((r: any) => ['imaginary_handler', 'draw_shape'].includes(r.name)))
  for (const name of ['imaginary_handler','draw_shape']) assert.equal((await f.session.execute('load_tool', { name })).status, 'unavailable')
  assert.equal(f.writes, 0)
})

test('catalog edits take effect at execution, not only at preload', async () => {
  const f = fixture(); f.setPhase('design'); await f.session.prepare()
  f.rows[1].active = false
  assert.equal((await f.session.execute('draw_shape', { value: 4 })).status, 'unavailable')
  assert.equal(f.writes, 0)
})

test('strict discovery inputs reject project, privilege, SQL, URL and wildcard payloads', async () => {
  const f = fixture(); await f.session.prepare()
  for (const input of [{ name: 'draw_shape', projectId: 'B' }, { name: 'draw_shape', role: 'admin' }, { name: '../evil' }, { name: '*' }, { name: 'https://evil.example' }, null]) {
    assert.equal((await f.session.execute('load_tool', input)).status, 'invalid')
  }
  for (const input of [{ query: null }, { ...browse, sql: 'select' }, { ...browse, after_name: '../bad' }]) assert.equal((await f.session.execute('list_tools', input)).status, 'invalid')
  assert.equal(f.writes, 0)
})

test('loaded schemas are copies, no model mutation of the execution registry', async () => {
  const f = fixture(); await f.session.prepare()
  const packet = await f.session.execute('load_tool', { name: 'draw_shape' })
  packet.tool.function.parameters.required.push('malicious')
  assert.deepEqual(f.definitions[1].spec.function.parameters.required, ['value'])
  assert.deepEqual((await f.session.prepare()).find(t => t.function.name === 'draw_shape')!.function.parameters.required, ['value'])
})

test('independent management budget never resets domain budgets and a fresh session does not inherit loads', async () => {
  const f = fixture(); await f.session.prepare()
  for (let i = 0; i < TOOL_LIMITS.managementCalls; i++) assert.equal((await f.session.execute('load_tool', { name: 'draw_shape' })).status, 'loaded')
  assert.equal((await f.session.execute('load_tool', { name: 'draw_shape' })).status, 'budget_exhausted')
  assert(!names(await f.session.prepare()).includes('load_tool'))
  assert(names(await f.session.prepare()).includes('draw_shape'))
  assert(!names(await f.make().prepare()).includes('draw_shape'))
  assert.equal(f.writes, 0)
})

test('tool-free finalization cannot execute an earlier offered tool', async () => {
  const f = fixture(); await f.session.prepare(); f.session.closeSurface()
  assert.notEqual((await f.session.execute('read_records', {})).status, 'saved'); assert.equal(f.writes, 0)
})

test('malformed/truncated policy fails rather than inventing an empty toolbox', () => {
  assert.throws(() => checkedToolSnapshot({ phase: null, tools: [policy('a'), policy('a')] }))
  assert.throws(() => checkedToolSnapshot({ phase: null, tools: Array(129).fill(policy('a')) }))
  assert.throws(() => checkedToolSnapshot({ phase: null, tools: [{ ...policy('a'), active: 'yes' }] }))
  assert.throws(() => checkedToolSnapshot({ phase: null, tools: [{ ...policy('a'), preload_phases: ['admin'] }] }))
})
