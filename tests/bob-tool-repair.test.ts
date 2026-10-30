import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall, preToolRepairCatalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogCoreTools } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { repairPreservesValues, valuesNotUsed } from '../supabase/functions/_shared/bob-tool-repair.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-10-30 ("wrench wench"): Bob's tool list is fixed (the
// permanent tools and use_tool). When the server rejects the arguments Bob
// wrote for a tool, a small read-only role gets that tool's real definition and
// calls it once with the same values in the right shape; the server checks that
// nothing was added or changed and runs the tool through the same gates.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const READ_ALL_NULL = { artifact_id: null, revision: null, after: null, view: 'overview', ids: [], result_id: null, section: null, step_id: null, work_kind: null }
// The harness's construction reader takes the earlier, smaller read shape; a correct repair leaves out the field it lacks.
const READ_FIXED = { artifact_id: null, revision: null, after: null }

test('a repair may move, rename, nest and JSON-encode values and add null or empty lists, never add or change one', () => {
  assert.equal(repairPreservesValues({ view: 'overview' }, READ_ALL_NULL), true)
  assert.equal(repairPreservesValues({ scope: 'S1', change: { op: 'set', path: 'width', value: 400 } },
    { scope_ref: 'S1', base_ref: null, changes: [{ op: 'set', path: 'width', value_json: '400' }] }), true)
  assert.equal(repairPreservesValues({ changes: [{ op: 'set', path: 'parts', value: { a: 1, b: 'x' } }] },
    { changes: [{ op: 'set', path: 'parts', value_json: '{"a":1,"b":"x"}' }] }), true, 'an object becomes the JSON string the parameter requires')
  assert.equal(repairPreservesValues({ width: '400' }, { width: 400 }), true, 'a number written as text keeps its value')
  assert.equal(repairPreservesValues({ view: 'overview' }, { ...READ_ALL_NULL, view: 'parts' }), false, 'a changed choice is refused')
  assert.equal(repairPreservesValues({ reason: 'Bredare' }, { reason: 'Bredare', select: true }), false, 'an added flag is refused')
  assert.equal(repairPreservesValues({ width: 400 }, { width: 400, depth: 400 }), false, 'a value used twice is added once')
  assert.equal(repairPreservesValues({ width: 400.4 }, { width: 400 }), false, 'rounding is a change')
  // Values the tool has no field for may be left out, and are reported back to Bob.
  assert.deepEqual(valuesNotUsed({ view: 'overview', width: 400 }, { width: 400 }), ['overview'])
  assert.deepEqual(valuesNotUsed({ width: 400 }, { width: '400' }), [])
})

async function turn(catalog: AiCatalogSession, steps: ((options: OpenAIServiceOptions) => unknown)[], repair: (options: OpenAIServiceOptions) => unknown) {
  const projectId = 'p', message = 'Visa lådan', hasAccess = async () => true
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
  const requests: OpenAIServiceOptions[] = [], repairs: OpenAIServiceOptions[] = [], ran: { name: string; status: string }[] = []
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, aiCatalog: catalog,
    corePreload: true, readToolPolicy, toolPicker: true, completeRequest: true, onTool: value => ran.push({ name: value.name, status: value.status }),
    cadAssistant: { pending: async () => [], tools: [DESIGN_CAD_TOOL], lifecycleTools: [], remaining: 1, lifecycleRemaining: 0,
      candidate: null, partial: false, failure: null, sources: [], consult: async () => ({ status: 'invalid' }), lifecycle: async () => ({ status: 'invalid' }) } as any,
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage, data: JSON.stringify({ work_remaining: false, reason: '' }) }
      if (options.functionName === 'tool-picker') return { success: true, model: 'fixture', usage, data: JSON.stringify({ tools: ['read_construction_draft'], reason: '' }) }
      if (options.functionName === 'tool-repair') { repairs.push(structuredClone(options)); return repair(options) as any }
      requests.push(structuredClone(options))
      const step = steps[requests.length - 1]
      return (step ? step(options) : { success: true, model: 'fixture', usage, responseId: 'done', data: 'Klart.' }) as any
    }, catalog) } as any)
  assert.equal(result.ok, true, JSON.stringify(result))
  return { requests, repairs, ran }
}
const toolOutput = (options: OpenAIServiceOptions) => JSON.parse(String(options.messages!.find(m => m.role === 'tool')!.content))
const bobCalls = [() => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('c1', 'use_tool', { name: 'read_construction_draft', arguments: { view: 'overview' } })] })]

test('a rejected call goes once to the small role with the real definition; the reshaped call runs and Bob learns its shape', async () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!
  assert.equal(catalog.definition('bob.tools', 'tool_contract').definition.tool_repair_version, 1)
  const { requests, repairs, ran } = await turn(catalog, bobCalls, options => ({ success: true, model: 'fixture', usage,
    toolCalls: [call('r1', options.tools![0].function.name, READ_FIXED)] }))
  // Bob's tool list is the fixed one: permanent tools and use_tool, never the job's tools.
  assert.deepEqual(requests[0].tools!.map(t => t.function.name).filter(n => !core.includes(n)), ['use_tool'])
  assert.equal(repairs.length, 1)
  const [repair] = repairs
  assert.equal(repair.catalogRoleKey, 'tool-repair')
  assert.deepEqual(repair.tools!.map(t => t.function.name), ['read_construction_draft'])
  assert.deepEqual(repair.tool_choice, { type: 'function', function: { name: 'read_construction_draft' } })
  const input = JSON.parse(String(repair.messages![0].content))
  assert.deepEqual(input.bob_arguments, { view: 'overview' }); assert.equal(input.tool, 'read_construction_draft')
  assert.equal(ran[0].name, 'read_construction_draft'); assert.notEqual(ran[0].status, 'invalid')
  const output = toolOutput(requests[1])
  assert.equal(output.arguments_reshaped, true); assert.deepEqual(output.arguments_used, READ_FIXED)
  assert.deepEqual(output.values_not_used, ['overview'], 'Bob sees which of his values the tool could not take')
})

test('a repair that adds or changes a value, fails or is absent leaves Bob the original rejection', async () => {
  const catalog = catalogFixture()
  for (const repair of [
    (options: OpenAIServiceOptions) => ({ success: true, model: 'fixture', usage, toolCalls: [call('r1', options.tools![0].function.name, { ...READ_ALL_NULL, view: 'parts' })] }),
    () => ({ success: false, model: 'fixture', error: 'unavailable' }),
    () => ({ success: true, model: 'fixture', usage, data: 'no call' }),
  ]) {
    const { requests, repairs, ran } = await turn(catalog, bobCalls, repair)
    assert.equal(repairs.length, 1)
    assert.equal(ran[0].status, 'invalid')
    const output = toolOutput(requests[1])
    assert.equal(output.status, 'invalid'); assert.equal(output.arguments_reshaped, undefined)
  }
})

test('manifests before the publication never ask the small role', async () => {
  const pinned = preToolRepairCatalogFixture()
  assert.equal(pinned.definition('bob.tools', 'tool_contract').definition.tool_repair_version, undefined)
  const { repairs } = await turn(pinned, [() => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('c1', 'read_construction_draft', { view: 'overview' })] })],
    () => { throw Error('pinned manifests never repair') })
  assert.equal(repairs.length, 0)
})

test('the small role is read-only, mini tier and has no tools of its own', () => {
  const catalog = catalogFixture(), role = catalog.definition('role.tool-repair', 'role').definition
  assert.equal(role.function_name, 'tool-repair'); assert.deepEqual(role.tool_keys, [])
  assert.equal(catalog.definition('agent-contract.tool-repair').definition.writes, 'none')
  assert.equal(catalog.definition(String(role.profile_key)).definition.tier, 'mini')
  assert.match(catalog.text('tool-repair.contract'), /Never add, guess, compute, round or change a value/)
})
