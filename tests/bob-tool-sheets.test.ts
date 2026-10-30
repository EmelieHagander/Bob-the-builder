import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall, preToolSheetsCatalogFixture, preToolOrderCatalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogCoreTools } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy, type BobAnswerState } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-10-30: Bob's base prompt (role, directory, the permanent
// tools and use_tool) is always the same; the job's other tools are described in
// detail at the end of the conversation and called through use_tool.
// Tool sheets (every job tool behind use_tool) are read from the manifest before the
// tool-order publication, which made every tool native again (tests at the end).
const v1 = () => preToolOrderCatalogFixture()
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const PICK = ['read_construction_draft', 'check_construction_draft']
type Step = (options: OpenAIServiceOptions, index: number) => unknown

async function turn(catalog: AiCatalogSession, steps: Step[], checkpoint?: { state?: BobAnswerState; saved: BobAnswerState[] }, extra: Record<string, unknown> = {}) {
  const projectId = 'p', message = 'Kontrollera lådan', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_project, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Fixture', description: 'Saved project' }] : [], related: [], truncated: false }, error: null }) as any, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const constructionTools = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }) })
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  const readToolPolicy = async () => {
    const policy = await seedToolPolicy(), definitions = catalog.manifest().definitions
    return { ...policy, phase: 'concept', tools: policy.tools.map(row => {
      const version = (definitions.find(d => d.prompt_key === 'tools.' + row.name)?.definition.envelope as { schema_version?: number } | undefined)?.schema_version
      return version ? { ...row, schema_version: version } : row
    }) }
  }
  const requests: OpenAIServiceOptions[] = [], ran: { name: string; status: string }[] = []
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, aiCatalog: catalog,
    corePreload: true, readToolPolicy, toolPicker: true, ...extra, onTool: value => ran.push({ name: value.name, status: value.status }),
    ...(checkpoint ? { checkpoint: { state: checkpoint.state, save: async (state: BobAnswerState) => { checkpoint.saved.push(structuredClone(state)) } } } : {}),
    cadAssistant: { pending: async () => [], tools: [DESIGN_CAD_TOOL], lifecycleTools: [], remaining: 1, lifecycleRemaining: 0,
      candidate: null, partial: false, failure: null, sources: [], consult: async () => ({ status: 'invalid' }), lifecycle: async () => ({ status: 'invalid' }) } as any,
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage, data: JSON.stringify({ work_remaining: false, reason: '' }) }
      if (options.functionName === 'tool-picker') return { success: true, model: 'fixture', usage, data: JSON.stringify({ tools: PICK, reason: '' }) }
      requests.push(structuredClone(options))
      const step = steps[requests.length - 1]
      return (step ? step(options, requests.length - 1) : { success: true, model: 'fixture', usage, responseId: 'done', data: 'Lådan är kontrollerad.' }) as any
    }, catalog) } as any)
  assert.equal(result.ok, true, JSON.stringify(result))
  return { requests, ran }
}
const contents = (options: OpenAIServiceOptions) => (options.messages ?? []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
const names = (options: OpenAIServiceOptions) => (options.tools ?? []).map(t => t.function.name)
const last = (options: OpenAIServiceOptions) => String(options.messages!.at(-1)!.content)
const sheetsIn = (options: OpenAIServiceOptions) => (options.messages ?? []).filter(m => typeof m.content === 'string' && m.content.startsWith('Verktygen du har framför dig för det här jobbet, i detalj.'))
  .flatMap(m => JSON.parse(String(m.content).slice(String(m.content).indexOf('\n') + 1)) as { name: string; description: string; parameters: any }[])

test('the base prompt is identical on every step; the picked tools come in detail last and are called through use_tool', async () => {
  const catalog = v1(), core = catalogCoreTools(catalog)!
  const { requests, ran } = await turn(catalog, [
    () => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('c1', 'use_tool', { name: 'check_construction_draft', arguments: {} })] }),
  ])
  const [first, second] = requests
  assert.deepEqual(names(first), [...core.filter(n => names(first).includes(n)), 'use_tool'].sort((a, b) => names(first).indexOf(a) - names(first).indexOf(b)))
  assert(!names(first).some(n => PICK.includes(n)), 'picked tools are not native functions')
  assert.equal(names(first).at(-1), 'use_tool')
  assert.match(first.systemMessage!, /Verktygen du har framför dig för just det här jobbet beskrivs i detalj sist/)
  // The picked tools are the very last input, with their parameters.
  assert.deepEqual(sheetsIn(first).map(s => s.name).sort(), [...PICK].sort())
  assert(last(first).startsWith('Verktygen du har framför dig'))
  assert(sheetsIn(first).every(s => s.parameters?.type === 'object' && typeof s.description === 'string'))
  // Next step: the same native list and the same system message, byte for byte; no repeated sheet.
  assert.deepEqual(JSON.stringify(second.tools), JSON.stringify(first.tools))
  assert.equal(second.systemMessage, first.systemMessage)
  assert.deepEqual(sheetsIn(second), [])
  // use_tool ran the named tool through its own handler; the call is reported under that name.
  assert.equal(ran[0].name, 'check_construction_draft'); assert.notEqual(ran[0].status, 'not_offered')
  const output = JSON.parse(String(second.messages!.find(m => m.role === 'tool')!.content))
  assert.notEqual(output.status, 'not_offered')
})

test('a tool loaded mid-turn never changes the start of the prompt; unloaded and malformed calls are refused', async () => {
  const catalog = v1()
  const { requests, ran } = await turn(catalog, [
    () => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('c1', 'use_tool', { name: 'change_construction_parameters', arguments: {} }), call('c2', 'use_tool', { nope: true })] }),
    () => ({ success: true, model: 'fixture', usage, responseId: 'r2', toolCalls: [call('c3', 'describe_tool', { name: 'change_construction_parameters' })] }),
    () => ({ success: true, model: 'fixture', usage, responseId: 'r3', toolCalls: [call('c4', 'use_tool', { name: 'change_construction_parameters', arguments: {} })] }),
  ])
  assert.deepEqual(ran.slice(0, 2).map(r => [r.name, r.status]), [['change_construction_parameters', 'not_offered'], ['use_tool', 'invalid']])
  assert.equal(ran[2].name, 'describe_tool'); assert.equal(ran[2].status, 'ok')
  assert.equal(ran[3].name, 'change_construction_parameters'); assert.notEqual(ran[3].status, 'not_offered')
  for (const request of requests.slice(1)) {
    assert.equal(JSON.stringify(request.tools), JSON.stringify(requests[0].tools), 'native tools never change')
    assert.equal(request.systemMessage, requests[0].systemMessage, 'instructions never change')
  }
  // The manual came back as describe_tool's result (the end of the conversation): no second copy.
  assert.deepEqual(requests.slice(1).flatMap(sheetsIn), [])
})

test('a resumed turn does not repeat sheets; pinned manifests keep every loaded tool native', async () => {
  const catalog = v1(), checkpoint = { saved: [] as BobAnswerState[] }
  await turn(catalog, [() => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('c1', 'use_tool', { name: 'read_construction_draft', arguments: {} })] })], checkpoint)
  const resumable = checkpoint.saved.find(state => state.step === 1 && state.phase === 'ready')!
  assert.deepEqual([...resumable.sheets!].sort(), [...PICK].sort())
  const resumed = await turn(catalog, [], { state: resumable, saved: [] })
  assert.deepEqual(resumed.requests.flatMap(sheetsIn), [])
  const pinned = preToolSheetsCatalogFixture()
  const old = await turn(pinned, [])
  assert(PICK.every(n => names(old.requests[0]).includes(n)) && !names(old.requests[0]).includes('use_tool'), JSON.stringify(names(old.requests[0])))
  assert.deepEqual(sheetsIn(old.requests[0]), [])
  assert.doesNotMatch(old.requests[0].systemMessage!, /beskrivs i detalj sist/)
})

// Tool order, owner decision after paid box run 5: through use_tool Bob wrote
// wrong arguments for tools that worked first time as native functions. Every
// tool is native again; the turn's first tools keep their order and a tool
// loaded later is added at the end, so the list only grows within a turn.
test('tool order: every tool is native; a tool loaded mid-turn is appended and the rest of the list keeps its order', async () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!
  const box = catalog.definition('bob.tools', 'tool_contract')
  assert.equal(box.definition.tool_order_version, 1); assert.equal(box.definition.tool_sheets_version, undefined)
  const { requests, ran } = await turn(catalog, [
    () => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('c1', 'check_construction_draft', {}), call('c2', 'describe_tool', { name: 'change_construction_parameters' })] }),
    () => ({ success: true, model: 'fixture', usage, responseId: 'r2', toolCalls: [call('c3', 'change_construction_parameters', {})] }),
  ], undefined, { completeRequest: true })
  const first = names(requests[0])
  assert(PICK.every(n => first.includes(n)) && core.some(n => first.includes(n)), 'picked and permanent tools are native: ' + JSON.stringify(first))
  assert(!first.includes('use_tool') && !first.includes('change_construction_parameters'))
  assert.doesNotMatch(requests[0].systemMessage!, /beskrivs i detalj sist/)
  assert.deepEqual(requests.flatMap(sheetsIn), [], 'nothing is described at the end')
  assert.equal(ran[0].name, 'check_construction_draft'); assert.notEqual(ran[0].status, 'not_offered')
  assert.equal(ran[1].name, 'describe_tool'); assert.equal(ran[1].status, 'ok')
  assert.equal(ran[2].name, 'change_construction_parameters'); assert.notEqual(ran[2].status, 'not_offered')
  // The loaded tool is added at the end; everything before it is byte-identical.
  const later = requests.at(-1)!
  assert.deepEqual(names(later), [...first, 'change_construction_parameters'])
  assert.equal(JSON.stringify(later.tools!.slice(0, first.length)), JSON.stringify(requests[0].tools))
  // Availability is sent at the end when the list grows, so the instructions stay the same.
  const availability = requests.map(r => contents(r).filter(c => c.startsWith('{"tool_availability"')).length)
  assert.deepEqual(availability, [1, 1, 0], 'sent at the start and again only after the list changed')
  for (const request of requests.slice(1)) assert.equal(request.systemMessage, requests[0].systemMessage, 'instructions never change')
})

test('tool order: a resumed turn sends the same list in the same order', async () => {
  const catalog = catalogFixture(), checkpoint = { saved: [] as BobAnswerState[] }
  const first = await turn(catalog, [() => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('c1', 'describe_tool', { name: 'change_construction_parameters' })] })], checkpoint)
  const resumable = checkpoint.saved.find(state => state.step === 1 && state.phase === 'ready')!
  assert.deepEqual(resumable.native, names(first.requests[0]), 'the checkpoint keeps the order sent so far')
  const resumed = await turn(catalog, [], { state: resumable, saved: [] })
  assert.equal(JSON.stringify(resumed.requests[0].tools), JSON.stringify(first.requests[1].tools))
})
