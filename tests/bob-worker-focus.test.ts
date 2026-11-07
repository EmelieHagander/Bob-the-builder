import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogWorkers, runWorker, validWorkerProgress, type WorkerProgress } from '../supabase/functions/_shared/bob-workers.ts'
import { pickTurnTools, pickWorkerTools } from '../supabase/functions/_shared/project-answer.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-11-06 (B, "Applicera alla"). Measured since 2026-11-02:
// Konrad was offered 25 tools on every call; two of them were 75 % of his
// calls, thirteen were used seven times or fewer, five never, and the plan the
// persona asks for never came before the first write.
const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
const spec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const catalog = {
  definition: () => ({ metadata: { continuation_input_tokens: 64000, context_input_ceiling_tokens: 96000, continuation_summary_tokens: 1600, retained_tool_exchanges: 2, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Build carefully.', model: { provider: 'anthropic' }, providerAdapter: 'anthropic-messages-v1' }),
  tool: spec, text: (key: string) => key,
} as unknown as AiCatalogSession
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const reply = (id: string, calls: ReturnType<typeof call>[]): OpenAIServiceResponse<string> => ({ success: true, data: null, model: 'fixture', responseId: id, usage, outputPhase: 'tool_calls', toolCalls: calls })
const done = (id: string): OpenAIServiceResponse<string> => ({ success: true, data: 'Klart.', model: 'fixture', responseId: id, usage })
const worker = { role: 'role.structure-worker', tool: 'ask_structure_worker', max_steps: 8,
  tools: ['edit_construction_parts', 'change_construction_roles', 'transition_legacy_drawing', 'check_construction_draft'],
  reads: ['read_construction_draft', 'read_build_tree', 'calculate_project'],
  focus: { version: 1 as const, core: ['read_construction_draft', 'edit_construction_parts', 'check_construction_draft'], optional: ['read_build_tree', 'calculate_project', 'change_construction_roles'], optional_limit: 2 } }
const everything = [...worker.tools, ...worker.reads, 'update_workpad']
const toolResults = (options: OpenAIServiceOptions) => options.messages!.filter(m => m.role === 'tool').map(m => JSON.parse(String(m.content)))
const names = (options: OpenAIServiceOptions) => options.tools!.map(t => t.function.name)

function harness(steps: ((options: OpenAIServiceOptions) => OpenAIServiceResponse<string>)[], over: Partial<Parameters<typeof runWorker>[0]> = {}) {
  const requests: OpenAIServiceOptions[] = [], executed: { name: string; args: unknown }[] = [], picks: string[][] = [], saved: WorkerProgress[] = []
  const rejections: { name: string; code?: string }[] = []
  const run = () => runWorker({ aiCatalog: catalog, worker, userId: 'owner', job: { job: 'Sätt dit en dörr i väggen.', findings: null }, history: [],
    callModel: async options => { requests.push(structuredClone(options)); return steps[requests.length - 1]?.(options) ?? done('w-done') },
    readCurrent: async () => null, hasAccess: async () => true, deadline: Date.now() + 60_000,
    session: { prepare: async () => everything.map(spec), execute: async (name, args) => {
      executed.push({ name, args })
      if (name === 'update_workpad') return { status: 'noted', revision: executed.length }
      if (name === 'read_construction_draft' || name === 'read_build_tree') return { status: 'ok' }
      if (name === 'check_construction_draft') return { status: 'checked', artifact_id: 'c1', revision: 2 }
      return { status: 'saved', receipt: { dataset: 'artifacts', recordId: 'c1', revision: 3, operation: 'updated' } }
    } },
    workpadEnabled: true, workpad: { status: 'ok', revision: 0, note: null },
    focus: { pick: async candidates => { picks.push(candidates); return ['calculate_project', 'read_build_tree', 'change_construction_roles', 'nope'] } },
    planGate: true,
    onTool: value => rejections.push({ name: value.name, code: value.rejection?.code }),
    progress: { save: async progress => { saved.push(structuredClone(progress)) } },
    ...over })
  return { run, requests, executed, picks, saved, rejections }
}

test('a focused job is offered its core tools and the picked optional ones, fixed for the job; the rest are owned but not offered', async () => {
  const h = harness([
    () => reply('w1', [call('a', 'transition_legacy_drawing'), call('b', 'change_construction_roles'), call('c', 'read_build_tree')]),
    () => done('w2'),
  ])
  const result = await h.run()
  assert.equal(result.status, 'ok')
  assert.deepEqual(h.picks, [worker.focus.optional], 'the picker sees the optional tools once')
  // Core, the first two valid picks (the limit), the workpad; prepare order; same list every step.
  assert.deepEqual(names(h.requests[0]), ['edit_construction_parts', 'check_construction_draft', 'read_construction_draft', 'read_build_tree', 'calculate_project', 'update_workpad'])
  assert.deepEqual(names(h.requests[1]), names(h.requests[0]))
  // A never-used tool and an unpicked optional one are not offered, and a call to them does not run.
  assert.deepEqual(toolResults(h.requests[1]).map(r => r.status), ['not_offered', 'not_offered', 'ok'])
  assert.deepEqual(h.executed.map(e => e.name), ['read_build_tree'])
})

test('a resumed focused job keeps the tools it was offered without asking the picker again', async () => {
  const first = harness([() => reply('w1', [call('c', 'read_build_tree')])])
  await first.run()
  assert.equal(first.saved.length, 1)
  const second = harness([() => done('w2')], { progress: { restored: first.saved[0], save: async () => {} } })
  await second.run()
  assert.deepEqual(second.picks, [], 'no second pick')
  assert.deepEqual(names(second.requests[0]), names(first.requests[0]))
})

test('without the focus pin the job is offered every owned tool, as before', async () => {
  const h = harness([() => done('w1')], { focus: undefined })
  await h.run()
  assert.deepEqual(h.picks, [])
  assert.deepEqual(new Set(names(h.requests[0])), new Set(everything))
})

test('the plan gate refuses a construction write until a plan note is saved in the job; reads and checks pass', async () => {
  const working = { status: 'working', goal: 'Dörr i väggen', next_step: 'Byt panel', steps: ['Läs väggen', 'Byt panel'], blockers: [], references: [] }
  const h = harness([
    () => reply('w1', [call('a', 'read_construction_draft'), call('b', 'check_construction_draft'), call('c', 'edit_construction_parts', { changes: [] })]),
    () => reply('w2', [call('d', 'update_workpad', { expected_revision: 0, note: { ...working, status: 'done' } }), call('e', 'edit_construction_parts', { changes: [] })]),
    () => reply('w3', [call('f', 'update_workpad', { expected_revision: 1, note: { ...working, steps: [] } }), call('g', 'edit_construction_parts', { changes: [] })]),
    () => reply('w4', [call('h', 'update_workpad', { expected_revision: 2, note: working }), call('i', 'edit_construction_parts', { changes: [] })]),
    () => done('w5'),
  ])
  const result = await h.run()
  assert.equal(result.status, 'ok')
  const statuses = (step: number) => toolResults(h.requests[step]).map(r => r.status + (r.reason ? ':' + r.reason : ''))
  assert.deepEqual(statuses(1), ['ok', 'checked', 'invalid:plan_required'])
  assert.deepEqual(statuses(2), ['noted', 'invalid:plan_required'], 'a done note is not a plan')
  assert.deepEqual(statuses(3), ['noted', 'invalid:plan_required'], 'a note without steps is not a plan')
  assert.deepEqual(statuses(4), ['noted', 'saved'])
  assert.deepEqual(h.executed.filter(e => e.name === 'edit_construction_parts').length, 1, 'the refused writes never ran')
  assert.deepEqual(h.rejections.filter(r => r.code).map(r => r.code), ['plan_required', 'plan_required', 'plan_required'])
  assert.equal(h.saved.at(-1)!.planned, true); assert.equal(h.saved[0].planned, undefined)
  // The reply names what to do; the refusal is a tool result, not a change to the list of tools.
  assert.match(toolResults(h.requests[1])[2].message, /update_workpad/)
  assert.deepEqual(names(h.requests[4]), names(h.requests[0]))
})

test('a resumed job that already planned writes at once; without the gate a write runs at once', async () => {
  const planned = harness([() => reply('w1', [call('a', 'update_workpad', { expected_revision: 0, note: { status: 'working', goal: 'g', next_step: 'n', steps: ['s'], blockers: [], references: [] } })])])
  await planned.run()
  const resumed = harness([() => reply('w2', [call('b', 'edit_construction_parts', { changes: [] })]), () => done('w3')], { progress: { restored: planned.saved[0], save: async () => {} } })
  await resumed.run()
  assert.deepEqual(toolResults(resumed.requests[1]).map(r => r.status), ['saved'])
  const open = harness([() => reply('w1', [call('a', 'edit_construction_parts', { changes: [] })]), () => done('w2')], { planGate: undefined })
  await open.run()
  assert.deepEqual(toolResults(open.requests[1]).map(r => r.status), ['saved'])
  assert.ok(validWorkerProgress({ ...planned.saved[0] }, 8)); assert.ok(!validWorkerProgress({ ...planned.saved[0], planned: false }, 8))
})

test('the catalog publishes Konrad\'s focus, the plan paragraph, the three pins and the picker\'s eight; a bad focus is refused', () => {
  const fixture = catalogFixture()
  const structure = catalogWorkers(fixture)!.structure
  assert.deepEqual(structure.focus, { version: 1,
    core: ['read_construction_draft', 'edit_construction_parts', 'save_construction_draft', 'check_construction_draft', 'find_catalog_materials', 'add_catalog_fastener', 'search_project_data'],
    optional: ['change_construction_parameters', 'continue_construction_change', 'read_build_tree', 'read_solution_context', 'read_construction_changes', 'search_building_knowledge', 'open_project_item', 'list_project_category', 'calculate_project', 'change_construction_roles', 'read_construction_delivery'],
    optional_limit: 4 })
  for (const never of ['create_sub_build', 'place_build', 'derive_construction_lists', 'transition_legacy_drawing'])
    assert.ok([...structure.tools, ...structure.reads].includes(never) && ![...structure.focus!.core, ...structure.focus!.optional].includes(never), never)
  const contract = fixture.definition('agent-contract.ask-bob', 'agent_contract').metadata
  assert.equal(contract.worker_focus_version, 1); assert.equal(contract.worker_plan_version, 1); assert.equal(contract.tool_pick_limit, 8)
  assert.equal(fixture.definition('bob.tools', 'tool_contract').definition.worker_focus_version, 1)
  assert.equal((fixture.definition('schema.bob_tool_pick', 'response_schema').definition as any).properties.tools.maxItems, 8)
  assert.match(fixture.text('tool-picker.contract'), /Name at most eight/)
  assert.match(fixture.text('structure-worker.persona', { project_name: 'Lådan' }), /Innan du ändrar något skriver du din plan i anteckningsblocket/)
  for (const bad of [{ core: ['nope'] }, { optional: ['edit_construction_parts'] }, { optional_limit: 9 }, { version: 2 }, { core: [] }]) {
    const broken = catalogFixture(manifest => {
      const box = manifest.definitions.find(row => row.prompt_key === 'bob.tools')!.definition as any
      box.build_workers.structure.focus = { ...box.build_workers.structure.focus, ...bad }
    })
    assert.throws(() => catalogWorkers(broken), /worker_catalog_invalid/, JSON.stringify(bad))
  }
})

test('the picker names up to the pinned limit for Bob, and only a worker\'s optional tools for a job', async () => {
  const fixture = catalogFixture()
  const inputs: Record<string, unknown>[] = []
  const opts = { aiCatalog: fixture, userId: 'owner', message: 'Bygg in entrén', callModel: async (options: OpenAIServiceOptions) => {
    const input = JSON.parse(String(options.messages![0].content)); inputs.push(input)
    return { success: true, model: 'fixture', usage, data: JSON.stringify({ tools: input.candidates.slice(0, 9).map((c: { name: string }) => c.name) }) }
  } } as any
  const four = await pickTurnTools(opts, ['describe_tool'], [], Date.now() + 10_000)
  const eight = await pickTurnTools(opts, ['describe_tool'], [], Date.now() + 10_000, new Set(), 8)
  assert.equal(four!.length, 4); assert.equal(eight!.length, 8)
  const structure = catalogWorkers(fixture)!.structure
  const picked = await pickWorkerTools(opts, 'Sätt dit en dörr.', structure.focus!.core, structure.focus!.optional, Date.now() + 10_000, structure.focus!.optional_limit)
  assert.equal(picked!.length, 4); assert.ok(picked!.every(name => structure.focus!.optional.includes(name)))
  const input = inputs.at(-1)!
  assert.equal(input.latest_instruction, 'Sätt dit en dörr.'); assert.deepEqual(input.always_loaded, structure.focus!.core)
  assert.deepEqual((input.candidates as { name: string }[]).map(c => c.name), structure.focus!.optional, 'every optional tool has a card')
})

test('the worker gates pin is published for new jobs and the request fingerprint tells identical from changed requests', async () => {
  const { requestFingerprint } = await import('../supabase/functions/_shared/project-answer.ts')
  assert.equal(catalogFixture().definition('agent-contract.ask-bob', 'agent_contract').metadata.worker_gates_version, 1)
  const a = requestFingerprint({ job: 'Gör lådan 500 mm bred.', findings: null })
  assert.match(a, /^[0-9a-f]{16}$/)
  assert.equal(requestFingerprint({ job: 'Gör lådan 500 mm bred.', findings: null }), a)
  assert.notEqual(requestFingerprint({ job: 'Gör lådan 500 mm bred, en del i taget.', findings: null }), a)
  assert.notEqual(requestFingerprint({ job: 'Gör lådan 500 mm bred.', findings: 'ny' }), a)
})
