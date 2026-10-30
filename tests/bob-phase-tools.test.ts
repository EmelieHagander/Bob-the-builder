import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogFixture, catalogCall, prePhaseToolsCatalogFixture, preToolSheetsCatalogFixture, preMaterialsWorkerCatalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogCoreTools, catalogPhaseTools, TOOL_PHASES } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { countContextTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'

// Owner decision 2026-10-29: six permanent tools plus four chosen by where the
// project is, loaded in full from the first step and kept for the turn; every
// other card says when to use the tool and what it gives.
const data = JSON.parse(readFileSync(new URL('../scripts/data/tool-cards.json', import.meta.url), 'utf8'))
const MIGRATION = '20261029250000_bob_phase_tools_catalog.sql'

// The harness registers no work-record, calculator or material-catalog adapter, so those
// tools cannot be offered here; expectations drop exactly those.
const WITHOUT_ADAPTER = new Set(['read_work_context', 'edit_work_record', 'change_work_state', 'calculate_project', 'search_material_catalog'])
const expect = (names: string[]) => names.filter(n => !WITHOUT_ADAPTER.has(n)).sort()
async function offeredTools(catalog: AiCatalogSession, phases: (string | null)[], drawingRequests: unknown[] = []) {
  const projectId = 'p', message = 'Read the saved project', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_project, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Fixture', description: 'Saved project' }] : [], related: [], truncated: false }, error: null }) as any, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const constructionTools = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }) })
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  // The live reader re-reads the project phase on every step; here it changes after the first.
  let step = 0
  const readToolPolicy = async () => {
    const policy = await seedToolPolicy(), definitions = catalog.manifest().definitions
    return { ...policy, phase: phases[Math.min(step, phases.length - 1)], tools: policy.tools.map(row => {
      const version = (definitions.find(d => d.prompt_key === 'tools.' + row.name)?.definition.envelope as { schema_version?: number } | undefined)?.schema_version
      return version ? { ...row, schema_version: version } : row
    }) }
  }
  const offered: string[][] = []
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, aiCatalog: catalog,
    corePreload: true, readToolPolicy,
    // Only what the bench needs from the drawing assistant: its tool and the pending requests.
    cadAssistant: { pending: async () => drawingRequests, tools: [DESIGN_CAD_TOOL], lifecycleTools: [], remaining: 1, lifecycleRemaining: 0,
      candidate: null, partial: false, failure: null, sources: [], consult: async () => ({ status: 'invalid' }), lifecycle: async () => ({ status: 'invalid' }) } as any,
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, data: JSON.stringify({ work_remaining: false }) }
      if (!options.tools) throw Error('no tools for ' + options.functionName)
      offered.push(options.tools.map(t => t.function.name).sort()); step++
      // One research step, then the answer: the list must not change between them.
      if (step === 1) return { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, responseId: 'r1',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'open_project_item', arguments: JSON.stringify({ dataset: 'project', record_id: projectId }) } }] }
      return { success: true, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, responseId: 'r2', data: 'The saved project is open.' }
    }, catalog) } as any)
  assert.equal(result.ok, true, JSON.stringify(result))
  return offered
}

test('the published bench holds six permanent tools and four distinct tools per phase', () => {
  // The six permanent tools, read from the manifest before the worker pilot; the
  // pilot (2026-10-30) adds Bob's hand-over to Mattias as a seventh.
  const catalog = preMaterialsWorkerCatalogFixture(), core = catalogCoreTools(catalog)!, phases = catalogPhaseTools(catalog, core)!
  assert.deepEqual(core, data.core_tools)
  assert.equal(core.length, 6); assert(core.includes('describe_tool') && core.includes('search_project_data'))
  assert.deepEqual(catalogCoreTools(catalogFixture()), [...data.core_tools, 'ask_materials_worker'])
  assert.deepEqual(Object.keys(phases).sort(), [...TOOL_PHASES].sort())
  for (const [phase, names] of Object.entries(phases)) {
    assert.equal(names.length, 4, phase); assert(names.every(n => !core.includes(n)), phase)
  }
  // Older pinned manifests keep the five-tool bench and no phase tools.
  const pinned = prePhaseToolsCatalogFixture()
  assert.deepEqual(catalogCoreTools(pinned), data.core_tools_before)
  assert.equal(catalogPhaseTools(pinned, catalogCoreTools(pinned)), null)
})

test('an invalid phase bench fails before any model request', () => {
  const broken = (change: (phases: any) => void) => catalogFixture(m => {
    const def = m.definitions.find(r => r.prompt_key === 'bob.tools')!.definition as any
    change(def.phase_tools)
  })
  for (const change of [
    (p: any) => { p.design = [...p.design, 'read_construction_changes'] },
    (p: any) => { p.design = ['not_a_tool'] },
    (p: any) => { p.design = ['search_project_data'] },
    (p: any) => { p.someday = ['read_construction_draft'] },
    (p: any) => { p.build = [] },
  ]) { const c = broken(change); assert.throws(() => catalogPhaseTools(c, catalogCoreTools(c)), /phase_tool_catalog_invalid/) }
})

test('the first request offers the six plus the phase four, and the list stays fixed for the turn', async () => {
  // Since the 2026-10-30 tool sheets the four are described at the end instead (bob-tool-sheets.test.ts);
  // the native choice is pinned by manifests from before that publication.
  const catalog = preToolSheetsCatalogFixture(), core = catalogCoreTools(catalog)!, phases = catalogPhaseTools(catalog, core)!
  // Phase changes after the first step: the turn keeps the set it started with.
  const design = await offeredTools(catalog, ['design', 'build'])
  assert.deepEqual(design[0], expect([...core, ...phases.design]))
  assert.deepEqual(design[1], design[0], 'no tool appears or disappears mid-turn')
  assert.deepEqual((await offeredTools(catalog, ['planning']))[0], expect([...core, ...phases.planning]))
  // Pending drawing work wins over the phase.
  assert.deepEqual((await offeredTools(catalog, ['concept'], [{ id: 'request' }]))[0], expect([...core, ...phases.design]))
  // A project without a phase gets the six only.
  assert.deepEqual((await offeredTools(catalog, [null]))[0], expect([...core]))
  // A manifest pinned before the publication offers its five.
  const pinned = prePhaseToolsCatalogFixture()
  assert.deepEqual((await offeredTools(pinned, ['design']))[0], expect([...catalogCoreTools(pinned)!]))
})

test('every card outside the permanent six says when to use the tool and what it gives, within 80 tokens', () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!
  const tools = catalog.manifest().definitions.filter(d => d.definition_kind === 'tool_contract' && d.prompt_key.startsWith('tools.') && !core.includes(d.prompt_key.slice(6))
    && typeof d.definition.card_description === 'string')
  assert(tools.length > 80)
  for (const d of tools) {
    const card = String(d.definition.card_description ?? '')
    assert.match(card, /^Use (when|before|after) .+?\. Gives .+/, d.prompt_key)
    assert(countContextTokens(card) <= 80, d.prompt_key)
  }
})

test('the publication versions only bob.tools and the cards, is idempotent and matches the fixture', async () => {
  const { projectSchema } = await import('./support/project-schema.ts')
  let prior: any
  const pg = await projectSchema(async (db, name) => {
    if (name.endsWith(MIGRATION)) prior = (await db.query<{ m: any }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  }, MIGRATION)
  try {
    const read = async () => (await pg.query<{ m: any }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
    const current = await read()
    const byKey = (m: any) => new Map<string, any>(m.definitions.map((d: any) => [d.prompt_key, d]))
    const before = byKey(prior), after = byKey(current)
    const changed = [...after.keys()].filter(k => JSON.stringify(after.get(k)) !== JSON.stringify(before.get(k))).sort()
    assert.deepEqual(changed, ['bob.tools', ...Object.keys(data.cards).map(n => 'tools.' + n)].sort())
    // The state this publication produced; later publications version bob.tools again.
    const fixture = preToolSheetsCatalogFixture()
    for (const key of changed) {
      const row = after.get(key), was = before.get(key), f = fixture.definition(key, row.definition_kind)
      // Definition and content equal the fixture; metadata gains only the publication markers
      // (some seeded metadata already differs between the fixture and migrated databases).
      // The fixture carries the same card and bench (an older seeded text drift elsewhere is not this publication's).
      if (key === 'bob.tools') assert.deepEqual(f.definition, row.definition); else assert.equal(f.definition.card_description, row.definition.card_description, key)
      const { seed_version: _s, source_revision: _r, ...kept } = was.metadata
      assert.deepEqual(row.metadata, key === 'bob.tools' ? { ...kept, publication: 'phase-tools-v1', phase_tools_version: 1 }
        : { ...kept, card_publication: 'phase-tools-v1', phase_tools_version: 1 }, key)
      assert.equal(f.metadata.phase_tools_version, 1, key)
      if (key !== 'bob.tools') assert.deepEqual({ ...was.definition, card_description: data.cards[key.slice(6)].card }, row.definition, key)
    }
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + MIGRATION, import.meta.url), 'utf8'))
    assert.deepEqual(await read(), current)
  } finally { await pg.close() }
})

test('the generated publication is current with its card data', async () => {
  const { execFileSync } = await import('node:child_process')
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-bob-phase-tools-catalog.ts', 'supabase/migrations/' + MIGRATION, '--check'])
})
