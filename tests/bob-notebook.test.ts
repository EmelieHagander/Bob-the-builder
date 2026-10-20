import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createBobContextContinuation, BOB_NOTEBOOK_TOKENS } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { createToolSession } from '../supabase/functions/_shared/project-tools/session.ts'
import { bobWorkflows } from '../supabase/functions/_shared/bob-prompt.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

const disk = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: 'Manual ' + name, parameters: { type: 'object' } } })
const catalog = { definition: () => ({ metadata: { continuation_input_tokens: 64000, context_input_ceiling_tokens: 96000,
  continuation_summary_tokens: 1600, retained_tool_exchanges: 2, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Keep uncertainty explicit.' }), tool, text: () => 'Your notebook for this job.' } as unknown as AiCatalogSession
const call = (id: string, name = 'read_construction_draft', args: unknown = { view: 'parts', page: 1 }) => ({ id, type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) } })
const response = (id: string, calls: ReturnType<typeof call>[]): OpenAIServiceResponse => ({ success: true, model: 'fixture', data: null,
  responseId: id, toolCalls: calls, outputPhase: 'tool_calls', usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140, reasoning_tokens: 20 },
  outputItems: [{ type: 'reasoning', id: 'rs_' + id, summary: [], encrypted_content: 'opaque-' + id },
    ...calls.map(c => ({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments }))] })
const seed: OpenAIServiceOptions = { app: 'bob', coworkerId: 'bob', module: 'global', functionName: 'ask-bob', catalogRoleKey: 'ask-bob',
  responseItemsMode: 'preserve', tools: [tool('read_construction_draft')], messages: [{ role: 'user', content: 'Add three drawers under the bed.' }] }
const notebookOf = (request: OpenAIServiceOptions) => {
  const last = request.messages!.at(-1)!
  assert.equal(last.role, 'user')
  return JSON.parse(String(last.content).slice(String(last.content).indexOf('\n') + 1))
}

test('the notebook survives a worker restart, is shown on every request and is never recorded as history', async () => {
  const requests: OpenAIServiceOptions[] = []
  let confirmed: unknown[] = []
  const options = (script: (n: number) => ReturnType<typeof call>[]) => {
    let n = 0
    return { version: 1, mainResultReferences: 1 as const, mainNotebook: 1 as const, aiCatalog: catalog,
      snapshot: () => ({ confirmed_writes: confirmed }),
      callModel: async (request: OpenAIServiceOptions) => { requests.push(disk(request)); n++; return response('r' + requests.length, script(n)) } }
  }
  const first = createBobContextContinuation(options(n => n === 1 ? [call('note1', 'bob_notebook', { action: 'replace', text: '- [ ] read parts\n- [ ] add drawers' })] : [call('read' + n)]))
  // The notebook-only batch stays inside the adapter: Bob sees the saved note on his next request.
  const written = await first.call(seed)
  assert.deepEqual(written.toolCalls!.map(c => c.id), ['read2'])
  assert(requests[0].tools!.some(t => t.function.name === 'bob_notebook'))
  assert.equal(notebookOf(requests[0]).notebook.revision, 0)
  assert.deepEqual(notebookOf(requests[1]).notebook, { revision: 1, tokens: notebookOf(requests[1]).notebook.tokens, soft_limit_tokens: BOB_NOTEBOOK_TOKENS.soft, text: '- [ ] read parts\n- [ ] add drawers' })
  const state = disk(first.exportState())
  // Restart: a fresh adapter restores the same job and keeps the note.
  const second = createBobContextContinuation(options(() => [call('read' + requests.length)]))
  second.restoreState(state)
  confirmed = [{ tool: 'save_construction_draft', revision: 18 }]
  const head = state.chains[0][0]
  await second.call({ ...seed, previousResponseId: head, messages: [{ role: 'tool', tool_call_id: 'read2', content: '{"status":"ok"}' }] })
  const shown = notebookOf(requests.at(-1)!)
  assert.equal(shown.notebook.text, '- [ ] read parts\n- [ ] add drawers')
  assert.deepEqual(shown.confirmed_work_state, { confirmed_writes: confirmed })
  // The trailing block is rebuilt per request, never stored in the chain.
  const stored = JSON.stringify(second.exportState().chains[0][1].groups)
  assert(!stored.includes('Your notebook for this job.'))
  assert.throws(() => createBobContextContinuation({ ...options(() => []), mainNotebook: undefined }).restoreState(state), /context_checkpoint_invalid/)
})

test('150 identical reads keep their journal entries but add nothing to the notebook', async () => {
  const requests: OpenAIServiceOptions[] = []
  let n = 0
  const adapter = createBobContextContinuation({ version: 1, mainResultReferences: 1, mainNotebook: 1, aiCatalog: catalog,
    callModel: async (request: OpenAIServiceOptions) => { requests.push(disk(request)); n++
      return response('r' + n, [call(n === 1 ? 'note' : 'read' + n, n === 1 ? 'bob_notebook' : 'read_construction_draft', n === 1 ? { action: 'append', text: 'Plan: drawers.' } : { view: 'parts', page: 1 })]) } })
  let previous = (await adapter.call(seed)).responseId!
  for (let i = 0; i < 150; i++) {
    const result = await adapter.call({ ...seed, previousResponseId: previous, messages: [{ role: 'tool', tool_call_id: 'read' + (i + 2), content: '{"status":"ok","revision":17}' }] })
    previous = result.responseId!
  }
  const chain = adapter.exportState().chains[0][1]
  assert.equal(chain.operations.filter(([, op]) => op.tool_name === 'read_construction_draft').length, 150)
  const notes = requests.slice(1).map(r => notebookOf(r).notebook)
  assert(notes.every(note => note.revision === 1 && note.text === 'Plan: drawers.'))
})

test('a write past the hard limit is refused and the earlier note is kept', async () => {
  let n = 0
  const adapter = createBobContextContinuation({ version: 1, mainResultReferences: 1, mainNotebook: 1, aiCatalog: catalog,
    callModel: async () => { n++
      return n === 1 ? response('r1', [call('a', 'bob_notebook', { action: 'replace', text: 'Keep the bed frame.' })])
        : n === 2 ? response('r2', [call('b', 'bob_notebook', { action: 'append', text: 'word '.repeat(BOB_NOTEBOOK_TOKENS.hard + 10) })])
        : response('r3', [call('c')]) } })
  await adapter.call(seed)
  const chain = adapter.exportState().chains[0][1]
  assert.deepEqual(chain.notebook, { text: 'Keep the bed frame.', revision: 1 })
  assert.equal(JSON.parse(String(chain.groups.flat().find(m => m.role === 'tool' && m.tool_call_id === 'b')!.content)).status, 'too_large')
})

test('a loaded tool stays while Bob uses it, a rejected call keeps it, and a step without it releases it', async () => {
  const catalog = catalogFixture(), names = ['read_construction_draft', 'save_construction_draft']
  const rows = names.map(name => ({ name, description: 'Short card', how_to: 'manual', schema_version: 1, always_load: false, preload_phases: [], active: true }))
  let status = 'ok'
  const make = () => createToolSession({ toolInstructions: 'lazy', selectiveTools: true, releaseIdleTools: true,
    catalogTool: (name, p) => catalog.tool(name, p), catalogWorkflows: () => bobWorkflows(catalog),
    readPolicy: async () => ({ phase: 'design', tools: rows }),
    definitions: rows.map(r => ({ version: 1, spec: catalog.tool(r.name), gate: () => 'available' as const, execute: async () => ({ status }) })) })
  const offered = async (s: ReturnType<typeof make>, step: number) => { s.beginStep(step); return (await s.prepare()).map(t => t.function.name) }
  let s = make()
  assert.deepEqual(await offered(s, 0), ['describe_tool'])
  await s.execute('describe_tool', { name: 'read_construction_draft' })
  assert.deepEqual(await offered(s, 1), ['read_construction_draft', 'describe_tool'])
  await s.execute('read_construction_draft', {})
  // Three pages in a row need no new describe; a resumed step does not release twice.
  assert.deepEqual(await offered(s, 2), ['read_construction_draft', 'describe_tool'])
  await s.execute('read_construction_draft', {})
  const restored = make(); restored.restoreState(disk(s.exportState())); s = restored
  assert.deepEqual(await offered(s, 3), ['read_construction_draft', 'describe_tool'])
  assert.deepEqual(await offered(s, 3), ['read_construction_draft', 'describe_tool'])
  status = 'invalid'; await s.execute('read_construction_draft', {})
  assert.deepEqual(await offered(s, 4), ['read_construction_draft', 'describe_tool'])
  assert.deepEqual(await offered(s, 5), ['read_construction_draft', 'describe_tool'])
  status = 'ok'; await s.execute('read_construction_draft', {})
  assert.deepEqual(await offered(s, 6), ['read_construction_draft', 'describe_tool'])
  assert.deepEqual(await offered(s, 7), ['describe_tool'])
  // Describing again restores it at once.
  await s.execute('describe_tool', { name: 'read_construction_draft' })
  assert.deepEqual(await offered(s, 8), ['read_construction_draft', 'describe_tool'])
})

test('the notebook publication matches its generator and pins the notebook only with result references', () => {
  assert.match(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-ai-notebook-catalog.ts', 'supabase/migrations/20261020150000_ai_bob_notebook.sql', '--check'], { encoding: 'utf8' }), /Verified notebook publication/)
  const fixture = catalogFixture(), contract = fixture.definition('agent-contract.ask-bob').metadata
  assert.equal(contract.notebook_version, 1); assert.equal(contract.result_reference_version, 1)
  assert.equal(fixture.tool('bob_notebook', { card: false, include_manual: true }).function.name, 'bob_notebook')
  assert.match(fixture.text('bob.toolbox.intro-lazy'), /A step without it releases it/)
})
