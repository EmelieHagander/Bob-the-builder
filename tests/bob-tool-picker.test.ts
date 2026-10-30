import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall, preToolPickerCatalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogCoreTools, catalogPhaseTools } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy, type BobAnswerState } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'

// Owner decision 2026-10-30: prompt assembly chooses the turn's flexible tools
// from the request. A small read-only role names up to four at the turn's start;
// the phase set is the fallback, and the list stays fixed for the turn.
// The harness has no CAD-save, work-record, calculator or material adapters, so
// picks use tools it can offer.
const WITHOUT_ADAPTER = new Set(['read_work_context', 'edit_work_record', 'change_work_state', 'calculate_project', 'search_material_catalog'])
const expect = (names: string[]) => names.filter(n => !WITHOUT_ADAPTER.has(n)).sort()
const ok = (data: unknown) => ({ success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, data: JSON.stringify(data) })

async function turn(catalog: AiCatalogSession, opts: { pick?: (input: any) => unknown; toolPicker?: boolean; phase?: string; checkpoint?: { state?: BobAnswerState; saved: BobAnswerState[] } } = {}) {
  const projectId = 'p', message = 'Gör en slutlig ritning av lådan', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_project, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Fixture', description: 'Saved project' }] : [], related: [], truncated: false }, error: null }) as any, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const constructionTools = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }) })
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  const readToolPolicy = async () => {
    const policy = await seedToolPolicy(), definitions = catalog.manifest().definitions
    return { ...policy, phase: opts.phase ?? 'concept', tools: policy.tools.map(row => {
      const version = (definitions.find(d => d.prompt_key === 'tools.' + row.name)?.definition.envelope as { schema_version?: number } | undefined)?.schema_version
      return version ? { ...row, schema_version: version } : row
    }) }
  }
  const offered: string[][] = [], picks: any[] = []
  let step = 0
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, aiCatalog: catalog,
    corePreload: true, readToolPolicy, ...(opts.toolPicker === false ? {} : { toolPicker: true }),
    ...(opts.checkpoint ? { checkpoint: { state: opts.checkpoint.state, save: async (state: BobAnswerState) => { opts.checkpoint!.saved.push(structuredClone(state)) } } } : {}),
    cadAssistant: { pending: async () => [], tools: [DESIGN_CAD_TOOL], lifecycleTools: [], remaining: 1, lifecycleRemaining: 0,
      candidate: null, partial: false, failure: null, sources: [], consult: async () => ({ status: 'invalid' }), lifecycle: async () => ({ status: 'invalid' }) } as any,
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return ok({ work_remaining: false, reason: '' })
      if (options.functionName === 'tool-picker') {
        assert.equal(options.catalogRoleKey, 'tool-picker'); assert.equal(options.catalogSchemaKey, 'bob_tool_pick'); assert.equal(options.tools, undefined)
        const input = JSON.parse(String(options.messages![0].content)); picks.push(input)
        return opts.pick ? opts.pick(input) as any : ok({ tools: [], reason: '' })
      }
      if (!options.tools) throw Error('no tools for ' + options.functionName)
      offered.push(options.tools.map(t => t.function.name).sort()); step++
      if (step === 1) return { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, responseId: 'r1',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'open_project_item', arguments: JSON.stringify({ dataset: 'project', record_id: projectId }) } }] }
      return { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, responseId: 'r2', data: 'Ritningen är klar.' }
    }, catalog) } as any)
  assert.equal(result.ok, true, JSON.stringify(result))
  return { offered, picks }
}

test('the picker reads the request and the cards once, and its tools replace the phase set for the whole turn', async () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!
  const drawing = ['design_project_cad', 'check_construction_draft', 'change_construction_parameters']
  const { offered, picks } = await turn(catalog, { pick: () => ok({ tools: drawing, reason: 'En ritning begärs.' }) })
  assert.equal(picks.length, 1, 'one picker call per turn')
  assert.equal(picks[0].latest_instruction, 'Gör en slutlig ritning av lådan'); assert.deepEqual(picks[0].always_loaded, core)
  const names = picks[0].candidates.map((c: any) => c.name)
  assert(names.includes('design_project_cad') && !names.some((n: string) => core.includes(n)), 'core tools are not candidates')
  assert(picks[0].candidates.every((c: any) => typeof c.card === 'string' && c.card.length > 0))
  assert.deepEqual(offered[0], expect([...core, ...drawing]))
  assert.deepEqual(offered[1], offered[0], 'the list stays fixed for the turn')
})

test('unknown, duplicate or extra names are dropped; an empty, invalid or failed pick keeps the phase set', async () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!, phases = catalogPhaseTools(catalog, core)!
  const mixed = await turn(catalog, { pick: () => ok({ tools: ['made_up', 'design_project_cad', 'design_project_cad', core[0]], reason: '' }) })
  assert.deepEqual(mixed.offered[0], expect([...core, 'design_project_cad']))
  const five = await turn(catalog, { pick: () => ok({ tools: ['design_project_cad', 'check_construction_draft', 'change_construction_parameters', 'read_construction_draft', 'edit_construction_parts'], reason: '' }) })
  assert.deepEqual(five.offered[0], expect([...core, 'design_project_cad', 'check_construction_draft', 'change_construction_parameters', 'read_construction_draft']))
  for (const pick of [() => ok({ tools: [], reason: '' }), () => ({ success: true, model: 'fixture', data: 'not json' }), () => ({ success: false, error: 'unavailable' })])
    assert.deepEqual((await turn(catalog, { pick, phase: 'design' })).offered[0], expect([...core, ...phases.design]))
})

test('a resumed turn keeps its picked tools without asking again; pinned manifests and offline callers never ask', async () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!, phases = catalogPhaseTools(catalog, core)!
  const checkpoint = { saved: [] as BobAnswerState[] }
  await turn(catalog, { pick: () => ok({ tools: ['design_project_cad'], reason: '' }), checkpoint })
  const first = checkpoint.saved.find(state => state.step === 1)!
  assert.deepEqual(first.initial.toolPick, ['design_project_cad'])
  const resumed = await turn(catalog, { pick: () => { throw Error('asked again') }, checkpoint: { state: first, saved: [] } })
  assert.equal(resumed.picks.length, 0)
  assert(resumed.offered[0].includes('design_project_cad') && !resumed.offered[0].includes('create_solution_alternative'), JSON.stringify(resumed.offered[0]))
  // A manifest pinned before the publication, and a caller that does not opt in, keep the phase choice.
  const pinned = preToolPickerCatalogFixture()
  const old = await turn(pinned, { pick: () => { throw Error('pinned manifests never ask') }, phase: 'design' })
  assert.deepEqual(old.offered[0], expect([...catalogCoreTools(pinned)!, ...catalogPhaseTools(pinned, catalogCoreTools(pinned))!.design]))
  const offline = await turn(catalog, { toolPicker: false, pick: () => { throw Error('offline callers never ask') }, phase: 'design' })
  assert.deepEqual(offline.offered[0], expect([...core, ...phases.design]))
})

test('the picker is a small read-only role with its own schema and no tools', () => {
  const catalog = catalogFixture(), role = catalog.definition('role.tool-picker', 'role').definition
  assert.equal(role.function_name, 'tool-picker'); assert.equal(role.profile_key, 'profile.context-summary'); assert.deepEqual(role.tool_keys, [])
  assert.equal(catalog.definition('profile.context-summary').definition.tier, 'mini')
  const schema = catalog.definition('schema.bob_tool_pick').definition as any
  assert.equal(schema.properties.tools.maxItems, 4); assert.deepEqual(schema.required, ['tools', 'reason'])
  assert.equal(catalog.definition('agent-contract.tool-picker').definition.writes, 'none')
  assert.equal(preToolPickerCatalogFixture().manifest().definitions.some(row => row.prompt_key === 'role.tool-picker'), false)
})
