import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall, preBuildWorkersCatalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogCoreTools } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { catalogWorkers } from '../supabase/functions/_shared/bob-workers.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-10-31: Bob coordinates; the structural designer owns the
// construction and Rita makes the drawing. Like Mattias, each worker has its own
// fixed tools, the same input Bob has and Bob's brief last, with the present
// records of its area read for the brief.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const STRUCTURE = ['save_construction_draft', 'check_construction_draft', 'change_construction_parameters', 'edit_construction_parts', 'change_construction_roles', 'continue_construction_change', 'derive_construction_lists', 'transition_legacy_drawing']
const DRAWING = ['design_project_cad', 'save_cad_design', 'plan_cad_pieces', 'compose_cad_shell', 'link_cad_shell_steps', 'link_project_drawing', 'link_drawing_gap', 'ensure_drawing_gap_task']
const names = (o: OpenAIServiceOptions) => (o.tools ?? []).map(t => t.function.name)
const brief = (o: OpenAIServiceOptions) => { const last = String(o.messages!.at(-1)!.content); return { label: last.slice(0, last.indexOf('\n')), ...JSON.parse(last.slice(last.indexOf('\n') + 1)) } }
const toolOutput = (o: OpenAIServiceOptions) => JSON.parse(String(o.messages!.find(m => m.role === 'tool')!.content))

async function turn(catalog: AiCatalogSession, bobSteps: ((o: OpenAIServiceOptions) => unknown)[], workerSteps: Record<string, ((o: OpenAIServiceOptions) => unknown)[]>) {
  const projectId = 'p', message = 'Rita lådan', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_project, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Lådan', description: 'Saved project' }] : [], related: [], truncated: false }, error: null }) as any, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const real = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }) })
  const constructionCalls: { name: string; args: any }[] = []
  const constructionTools = { ...real, tools: real.tools, get remaining() { return real.remaining }, execute: async (name: string, args: any) => {
    constructionCalls.push({ name, args })
    if (name === 'read_construction_draft') return { status: 'ok', drafts: [{ artifact_id: 'c1', title: 'Lådan', revision: 2 }] }
    return { status: 'saved', artifact_id: 'c1', revision: 3 }
  } }
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  const readToolPolicy = async () => {
    const policy = await seedToolPolicy(), definitions = catalog.manifest().definitions
    return { ...policy, phase: 'design', tools: policy.tools.map(row => {
      const version = (definitions.find(d => d.prompt_key === 'tools.' + row.name)?.definition.envelope as { schema_version?: number } | undefined)?.schema_version
      return version ? { ...row, schema_version: version } : row
    }) }
  }
  // A drawing consultation leaves a reviewed candidate, which makes save_cad_design callable.
  const cadAssistant: any = { pending: async () => [], tools: [DESIGN_CAD_TOOL], lifecycleTools: [], remaining: 4, lifecycleRemaining: 0,
    candidate: null, partial: false, failure: null, sources: [], lifecycle: async () => ({ status: 'invalid' }),
    consult: async () => { cadAssistant.candidate = { id: 'cand-1' }; return { status: 'ready', review: 'approved' } } }
  const bob: OpenAIServiceOptions[] = [], pickerInputs: any[] = [], ran: { name: string; status: string }[] = []
  const workers: Record<string, OpenAIServiceOptions[]> = { 'structure-worker': [], 'drawing-worker': [], 'materials-worker': [] }
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, cadAssistant,
    aiCatalog: catalog, corePreload: true, readToolPolicy, toolPicker: true, completeRequest: true, onTool: v => ran.push({ name: v.name, status: v.status }),
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage, data: JSON.stringify({ work_remaining: false, reason: '' }) }
      if (options.functionName === 'tool-picker') { pickerInputs.push(JSON.parse(String(options.messages![0].content))); return { success: true, model: 'fixture', usage, data: JSON.stringify({ tools: [], reason: '' }) } }
      if (options.functionName in workers) { const list = workers[options.functionName]; list.push(structuredClone(options)); const step = workerSteps[options.functionName]?.[list.length - 1]
        return (step ? step(options) : { success: true, model: 'fixture', usage, responseId: 'w-done', data: 'Rapport klar.' }) as any }
      bob.push(structuredClone(options)); const step = bobSteps[bob.length - 1]
      return (step ? step(options) : { success: true, model: 'fixture', usage, responseId: 'b-done', data: 'Klart.' }) as any
    }, catalog) } as any)
  assert.equal(result.ok, true, JSON.stringify(result))
  return { bob, workers, pickerInputs, ran, constructionCalls, cadAssistant }
}

test('Bob hands the construction to the structural designer; the designer has his own tools and the drafts with the brief', async () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!
  assert.equal(core.length, 6)
  const { bob, workers, pickerInputs, constructionCalls, ran } = await turn(catalog,
    [() => ({ success: true, model: 'fixture', usage, responseId: 'b1', toolCalls: [call('c1', 'ask_structure_worker', { job: 'Spara och kontrollera lådans konstruktion.', findings: 'Vald lösning: lådan 40 cm.' })] })],
    { 'structure-worker': [() => ({ success: true, model: 'fixture', usage, responseId: 'w1', toolCalls: [call('w1c', 'check_construction_draft', { artifact_id: 'c1', revision: 2 })] })] })
  // Bob: all three hand-overs, none of the construction or drawing tools, and none of them for the picker.
  for (const tool of ['ask_structure_worker', 'ask_drawing_worker', 'ask_materials_worker']) assert(names(bob[0]).includes(tool), tool)
  assert(!names(bob[0]).some(n => STRUCTURE.includes(n) || DRAWING.includes(n)), JSON.stringify(names(bob[0])))
  assert(!pickerInputs[0].candidates.some((c: any) => STRUCTURE.includes(c.name) || DRAWING.includes(c.name) || c.name.startsWith('ask_')))
  assert(names(bob[0]).includes('read_construction_draft'), 'Bob still reads the construction')
  // The structural designer: his tools and reads only, the drafts overview with Bob's brief.
  const [first] = workers['structure-worker']
  assert.equal(first.catalogRoleKey, 'structure-worker')
  const own = catalogWorkers(catalog)!.structure
  assert(names(first).every(n => own.tools.includes(n) || own.reads.includes(n)), JSON.stringify(names(first)))
  assert(names(first).includes('save_construction_draft') && !names(first).includes('design_project_cad'))
  const b = brief(first)
  assert.equal(b.job, 'Spara och kontrollera lådans konstruktion.'); assert.equal(b.findings, 'Vald lösning: lådan 40 cm.')
  assert.deepEqual(b.current.drafts, [{ artifact_id: 'c1', title: 'Lådan', revision: 2 }])
  assert.equal(constructionCalls[0].name, 'read_construction_draft'); assert.equal(constructionCalls[0].args.view, 'overview')
  // His check ran through the same session and Bob got the report.
  assert(ran.some(r => r.name === 'check_construction_draft'))
  const report = toolOutput(bob[1])
  assert.equal(report.status, 'ok'); assert.equal(report.worker, 'structure-worker')
  assert.deepEqual(report.calls.map((c: any) => c.tool), ['check_construction_draft'])
})

test('Rita draws: saving the reviewed drawing becomes callable during her job and is added at the end of her tools', async () => {
  const catalog = catalogFixture()
  const { workers, ran } = await turn(catalog,
    [() => ({ success: true, model: 'fixture', usage, responseId: 'b1', toolCalls: [call('c1', 'ask_drawing_worker', { job: 'Rita lådan från den kontrollerade konstruktionen och spara ritningen.', findings: 'Konstruktion c1, revision 3, kontrollerad.' })] })],
    { 'drawing-worker': [() => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('r1c', 'design_project_cad', {})] })] })
  const [first, second] = workers['drawing-worker']
  assert.equal(first.catalogRoleKey, 'drawing-worker')
  assert(names(first).includes('design_project_cad') && !names(first).includes('save_cad_design'), 'no candidate yet')
  assert(ran.some(r => r.name === 'design_project_cad'))
  assert.equal(names(second).at(-1), 'save_cad_design', 'the save is offered once a reviewed candidate exists')
  assert.deepEqual(names(second).slice(0, -1), names(first), 'the earlier tools keep their order')
  assert.match(brief(first).label, /\S/)
})

test('the workers come from the catalog; a tool belongs to one worker', () => {
  const workers = catalogWorkers(catalogFixture())!
  assert.deepEqual(Object.keys(workers).sort(), ['drawing', 'materials', 'structure'])
  assert.deepEqual(workers.structure.tools, STRUCTURE); assert.deepEqual(workers.drawing.tools, DRAWING)
  const owned = Object.values(workers).flatMap(w => w.tools)
  assert.equal(new Set(owned).size, owned.length)
  assert.equal(workers.structure.current!.tool, 'read_construction_draft'); assert.equal(workers.drawing.current!.tool, 'read_drawing_requests')
  for (const key of ['structure', 'drawing']) {
    const role = catalogFixture().definition(workers[key].role, 'role').definition
    assert.equal(role.profile_key, 'profile.ask-bob'); assert.equal(role.enabled, true)
  }
})

test('manifests before the publication keep construction and drawing with Bob', async () => {
  const pinned = preBuildWorkersCatalogFixture()
  assert.deepEqual(Object.keys(catalogWorkers(pinned)!), ['materials'])
  const { bob, pickerInputs } = await turn(pinned, [], {})
  assert(!names(bob[0]).includes('ask_structure_worker') && !names(bob[0]).includes('ask_drawing_worker'))
  assert(pickerInputs[0].candidates.some((c: any) => c.name === 'save_construction_draft'))
})
