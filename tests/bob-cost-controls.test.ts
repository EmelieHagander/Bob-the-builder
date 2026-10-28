import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { catalogCoreTools } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createBuildingScope } from '../supabase/functions/_shared/project-building-scope.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { catalogFixture, preCostControlsCatalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'

test('six catalog-bound core tools are callable in the first medium request and survive later steps', async () => {
  const core = catalogCoreTools(catalogFixture())!
  assert.equal(core.length, 6)
  const catalog = catalogFixture(manifest => {
    for (const name of core) {
      const definition = manifest.definitions.find(r => r.prompt_key === 'tools.' + name)!.definition
      definition.description = definition.card_description = 'Catalogue description for ' + name
    }
  })
  const projectId = 'p', message = 'Read the saved project', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_project, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Fixture', description: 'Saved project' }] : [], related: [], truncated: false }, error: null }), undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const constructionTools = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess,
    read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }) })
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  // An implementation fallback must not become the model's tool description.
  for (const tool of [...constructionTools.tools, ...solutionActions.tools]) tool.function.description = 'Implementation fallback must not appear'
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  const buildingScope = createBuildingScope({ projectId, hasAccess, read: async () => ({ data: [], error: null }) })
  let calls = 0
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, solutionActions,
    projectContext, buildingScope, buildingLinks: { linked: [], linkable: ['Fixture'], whole: false }, aiCatalog: catalog, corePreload: true,
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, data: JSON.stringify({ work_remaining: false }) }
      calls++
      assert.equal(options.aiDefinition?.model.model_name, 'gpt-5.4')
      assert.equal(options.aiDefinition?.reasoningEffort, 'medium')
      assert.deepEqual(options.tools!.map(t => t.function.name).sort(), [...core].sort())
      for (const tool of options.tools!) assert(tool.function.description.includes('Catalogue description for ' + tool.function.name), tool.function.name)
      assert(!JSON.stringify(options.tools).includes('Implementation fallback'))
      const response = { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, responseId: 'response-' + calls }
      if (calls === 1) return { ...response, data: null, toolCalls: [{ id: 'read', type: 'function' as const, function: { name: 'search_project_data', arguments: JSON.stringify({ dataset: 'project', query: null, status: null, area_id: null, record_id: null, after_id: null }) } }] }
      return { ...response, data: 'Read the saved project.' }
    }, catalog) })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(calls, 2, 'read immediately, then answer without a describe round')
})

test('core catalog bounds fail closed and historical manifests keep the original behavior', () => {
  const prior = preCostControlsCatalogFixture()
  assert.equal(catalogCoreTools(prior), null)
  assert.equal(prior.role('ask-bob').reasoningEffort, 'high')
  for (const core of [[], ['search_project_data'], ['describe_tool', 'describe_tool'], ['describe_tool', 'nonexistent_tool'],
    ['describe_tool', 'search_project_data', 'open_project_item', 'read_solution_context', 'read_construction_draft', 'change_construction_parameters', 'list_project_category']]) {
    const invalid = catalogFixture(m => { m.definitions.find(r => r.prompt_key === 'bob.tools')!.definition.core_tools = core })
    assert.throws(() => catalogCoreTools(invalid), /core_tool_catalog_invalid/)
  }
})
