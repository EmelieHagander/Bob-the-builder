import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall, preBuildWorkersCatalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogCoreTools } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { catalogWorkers, catalogRetiredTools, catalogCheckReads, saveReceipt, readbackReads } from '../supabase/functions/_shared/bob-workers.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-10-31: Bob coordinates the build team. Konrad (structural
// designer) owns the construction and Rita draws it; Mattias does materials. Each
// has its own fixed tools and the same input Bob has; Bob sends a plain request
// with no values, and each worker gets project knowledge read from the database.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const STRUCTURE = ['save_construction_draft', 'check_construction_draft', 'change_construction_parameters', 'edit_construction_parts', 'change_construction_roles', 'continue_construction_change', 'derive_construction_lists', 'transition_legacy_drawing']
const DRAWING = ['design_project_cad', 'save_cad_design', 'plan_cad_pieces', 'compose_cad_shell', 'link_cad_shell_steps', 'link_project_drawing', 'link_drawing_gap', 'ensure_drawing_gap_task']
const names = (o: OpenAIServiceOptions) => (o.tools ?? []).map(t => t.function.name)
const texts = (o: OpenAIServiceOptions) => (o.messages ?? []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
const after = (text: string) => text.slice(text.indexOf('\n') + 1)
/** The last two inputs: project knowledge (JSON) and Bob's request (plain text). */
const tail = (catalog: AiCatalogSession, o: OpenAIServiceOptions, prefix: string) => {
  const all = texts(o), knowledge = all.at(-2)!, request = all.at(-1)!
  assert(knowledge.startsWith(catalog.text(prefix + '.knowledge')), knowledge.slice(0, 80)); assert(request.startsWith(catalog.text(prefix + '.request')))
  return { knowledge: JSON.parse(after(knowledge)), request: after(request) }
}
const ask = (tool: string, request: unknown) => () => ({ success: true, model: 'fixture', usage, responseId: 'b1', toolCalls: [call('c1', tool, request)] })
const toolOutput = (o: OpenAIServiceOptions) => JSON.parse(String(o.messages!.find(m => m.role === 'tool')!.content))

async function turn(catalog: AiCatalogSession, bobSteps: ((o: OpenAIServiceOptions) => unknown)[], workerSteps: Record<string, ((o: OpenAIServiceOptions) => unknown)[]>) {
  const projectId = 'p', message = 'Rita lådan', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_project, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Lådan', description: 'Saved project' }] : [], related: [], truncated: false }, error: null }) as any, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const real = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }),
    readDelivery: async () => ({ status: 'ok', records: [] }) })
  const constructionCalls: { name: string; args: any }[] = []
  const constructionTools = { ...real, tools: real.tools, get remaining() { return real.remaining }, execute: async (name: string, args: any) => {
    constructionCalls.push({ name, args })
    if (name === 'save_construction_draft') pendingImage = true // stands in for a worker opening an image
    if (name === 'read_construction_draft') return { status: 'ok', drafts: [{ artifact_id: 'c1', title: 'Lådan', revision: 2 }] }
    if (name === 'edit_construction_parts') return { status: 'invalid', validation: { code: 'unknown_part', fields: ['changes.0.part_id'] } }
    if (name === 'check_construction_draft') return { status: 'checked', artifact_id: 'c1', revision: 3 }
    // A writer save, as production returns it: the receipt is nested.
    return { status: 'saved', receipt: { projectId, dataset: 'artifacts', recordId: 'c1', label: 'Lådan', operation: 'updated', savedAt: '2026-10-31T00:00:00Z', revision: 3, record: { title: 'Lådan' } } }
  } }
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  const realContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  // Pixels opened during the turn wait in the shared carrier until a model call confirms delivery.
  let pendingImage = false, delivered = 0
  const projectContext = Object.assign(Object.create(realContext), {
    carrier: () => pendingImage ? [{ role: 'user', content: [{ type: 'text', text: 'IMAGE-PIXELS' }] }] : [],
    confirmDelivery: () => { if (pendingImage) delivered++; pendingImage = false } })
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
  const bob: OpenAIServiceOptions[] = [], pickerInputs: any[] = [], ran: { name: string; status: string; rejection?: unknown }[] = []
  const workers: Record<string, OpenAIServiceOptions[]> = { 'structure-worker': [], 'drawing-worker': [], 'materials-worker': [] }
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, cadAssistant,
    aiCatalog: catalog, corePreload: true, readToolPolicy, toolPicker: true, completeRequest: true, onTool: v => ran.push({ name: v.name, status: v.status, ...(v.rejection ? { rejection: v.rejection } : {}) }),
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage, data: JSON.stringify({ work_remaining: false, reason: '' }) }
      if (options.functionName === 'tool-picker') { pickerInputs.push(JSON.parse(String(options.messages![0].content))); return { success: true, model: 'fixture', usage, data: JSON.stringify({ tools: [], reason: '' }) } }
      if (options.functionName in workers) { const list = workers[options.functionName]; list.push(structuredClone(options)); const step = workerSteps[options.functionName]?.[list.length - 1]
        return (step ? step(options) : { success: true, model: 'fixture', usage, responseId: 'w-done', data: 'Rapport klar.' }) as any }
      bob.push(structuredClone(options)); const step = bobSteps[bob.length - 1]
      return (step ? step(options) : { success: true, model: 'fixture', usage, responseId: 'b-done', data: 'Klart.' }) as any
    }, catalog) } as any)
  assert.equal(result.ok, true, JSON.stringify(result))
  return { bob, workers, pickerInputs, ran, constructionCalls, cadAssistant, delivered: () => delivered }
}

test('Bob asks Konrad in plain words; Konrad has his own tools, the project in his persona and his project knowledge', async () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!
  assert.equal(core.length, 6)
  const request = 'Hej Konrad, kan du sätta ihop konstruktionen för projektet? Lådorna väntar vi med.'
  const { bob, workers, pickerInputs, constructionCalls, ran, delivered } = await turn(catalog, [ask('ask_structure_worker', { request })],
    { 'structure-worker': [() => ({ success: true, model: 'fixture', usage, responseId: 'w1', toolCalls: [call('w1c', 'save_construction_draft', {})] })] })
  // Bob: all three hand-overs, none of the construction or drawing tools, and none of them for the picker.
  for (const tool of ['ask_structure_worker', 'ask_drawing_worker', 'ask_materials_worker']) assert(names(bob[0]).includes(tool), tool)
  assert(!names(bob[0]).some(n => STRUCTURE.includes(n) || DRAWING.includes(n)), JSON.stringify(names(bob[0])))
  assert(!pickerInputs[0].candidates.some((c: any) => STRUCTURE.includes(c.name) || DRAWING.includes(c.name) || c.name.startsWith('ask_')))
  assert(names(bob[0]).includes('read_construction_draft'), 'Bob still reads the construction')
  // The reads Bob checks a report with are in his list from the first step, never picker candidates.
  assert.deepEqual(catalogCheckReads(catalog), ['read_construction_draft', 'read_construction_delivery', 'read_project_record_section'])
  // The record-section reader is not part of this harness; the two construction reads are.
  for (const read of ['read_construction_draft', 'read_construction_delivery']) {
    assert(names(bob[0]).includes(read), read); assert(!pickerInputs[0].candidates.some((c: any) => c.name === read), read)
  }
  // The legacy box drawing skipped the construction and the review: retired for new jobs.
  assert(!names(bob[0]).includes('save_project_drawing') && !pickerInputs[0].candidates.some((c: any) => c.name === 'save_project_drawing'))
  assert.deepEqual([...catalogRetiredTools(catalog)], ['save_project_drawing'])
  // Bob's hand-over takes a request only: no ids or values.
  assert.deepEqual(Object.keys((bob[0].tools!.find(t => t.function.name === 'ask_structure_worker')!.function.parameters as any).properties), ['request'])
  // Konrad: his tools and reads only; the project's name in his persona; knowledge, then Bob's words.
  const [first] = workers['structure-worker']
  assert.equal(first.catalogRoleKey, 'structure-worker')
  const own = catalogWorkers(catalog)!.structure
  assert(names(first).every(n => own.tools.includes(n) || own.reads.includes(n)), JSON.stringify(names(first)))
  assert(names(first).includes('save_construction_draft') && !names(first).includes('design_project_cad'))
  assert.match(String(first.systemMessage), /Lådan/, 'the persona names the project')
  assert(String(first.systemMessage).includes(catalog.text('worker.team')))
  const { knowledge, request: sent } = tail(catalog, first, 'structure-worker')
  assert.equal(sent, request)
  assert.deepEqual(Object.keys(knowledge), ['selected_solutions', 'measurements', 'images', 'constructions'])
  assert.deepEqual(knowledge.constructions.drafts, [{ artifact_id: 'c1', title: 'Lådan', revision: 2 }])
  assert.equal(constructionCalls[0].name, 'read_construction_draft'); assert.equal(constructionCalls[0].args.view, 'overview')
  // His save ran through the same session and Bob got the report.
  assert(ran.some(r => r.name === 'save_construction_draft' && r.status === 'saved'))
  const report = toolOutput(bob[1])
  assert.equal(report.status, 'ok'); assert.equal(report.worker, 'structure-worker')
  assert.deepEqual(report.calls.map((c: any) => c.tool), ['save_construction_draft'])
  // What he saved comes back as receipts copied by code, not restated by a model.
  assert.deepEqual(report.receipts, [{ tool: 'save_construction_draft', dataset: 'artifacts', record_id: 'c1', revision: 3, operation: 'updated' }])
  // The saved construction comes back with the report, read by code (report_readback_version 1).
  assert.deepEqual(report.readback, [{ construction: { status: 'ok', drafts: [{ artifact_id: 'c1', title: 'Lådan', revision: 2 }] } }])
  // An image he opened goes with his own next call and is confirmed there; Bob's next call does not carry it.
  const [, second] = workers['structure-worker']
  assert(texts(second).some(t => t.includes('IMAGE-PIXELS'))); assert.equal(delivered(), 1)
  assert(!texts(bob[1]).some(t => t.includes('IMAGE-PIXELS')))
})

test('the readback reads the saved construction at its saved revision; without the switch there is none', async () => {
  const off = catalogFixture(m => { const box = m.definitions.find(d => d.prompt_key === 'bob.tools')!; const { report_readback_version: _r, ...rest } = box.definition; box.definition = rest })
  const without = await turn(off, [ask('ask_structure_worker', { request: 'Konrad, sätt ihop lådan.' })],
    { 'structure-worker': [() => ({ success: true, model: 'fixture', usage, responseId: 'w1', toolCalls: [call('w1c', 'save_construction_draft', {})] })] })
  assert.equal(toolOutput(without.bob[1]).readback, undefined)
  const catalog = catalogFixture()
  const { bob, constructionCalls } = await turn(catalog, [ask('ask_structure_worker', { request: 'Konrad, sätt ihop lådan.' })],
    { 'structure-worker': [() => ({ success: true, model: 'fixture', usage, responseId: 'w1', toolCalls: [call('w1c', 'save_construction_draft', {})] })] })
  const report = toolOutput(bob[1])
  assert.deepEqual(report.readback, [{ construction: { status: 'ok', drafts: [{ artifact_id: 'c1', title: 'Lådan', revision: 2 }] } }])
  const read = constructionCalls.at(-1)!
  assert.equal(read.name, 'read_construction_draft'); assert.equal(read.args.artifact_id, 'c1'); assert.equal(read.args.revision, 3); assert.equal(read.args.view, 'overview')
})

test('receipts are copied by code from nested and flat results; the readback reads each saved record once', () => {
  assert.deepEqual(saveReceipt('save_cad_design', { status: 'saved', receipt: { dataset: 'artifacts', recordId: 'd1', revision: 2, operation: 'created', label: 'x', record: {} } }),
    { tool: 'save_cad_design', dataset: 'artifacts', record_id: 'd1', revision: 2, operation: 'created' })
  assert.deepEqual(saveReceipt('continue_construction_change', { status: 'saved', artifact_id: 'c1', revision: 4 }), { tool: 'continue_construction_change', artifact_id: 'c1', revision: 4 })
  const reads = readbackReads([{ tool: 'save_construction_draft', record_id: 'c1', revision: 2 }, { tool: 'edit_construction_parts', record_id: 'c1', revision: 3 },
    { tool: 'save_cad_design', record_id: 'd1', revision: 1 }, { tool: 'manage_project_material', record_id: 'm1', revision: 1 },
    { tool: 'check_construction_draft', artifact_id: 'c2', revision: 1 }, { tool: 'save_cad_design' }])
  assert.deepEqual(reads.map(r => 'tool' in r ? [r.label, r.tool, r.arguments.revision] : [r.label, r.not_read]),
    [['construction', 'read_construction_draft', 3], ['drawing', 'read_project_record_section', 1], ['construction', 'read_construction_draft', 1], ['drawing', 'no_saved_revision']])
  // Every saved construction is read back, up to the limit; the rest say so.
  const many = readbackReads(Array.from({ length: 10 }, (_, i) => ({ tool: 'save_construction_draft', record_id: 'c' + i, revision: 1 })))
  assert.equal(many.filter(r => 'tool' in r).length, 8); assert.deepEqual(many.slice(8).map(r => 'not_read' in r && r.not_read), ['limit', 'limit'])
})

test('a rejected worker call records why, as a code and field paths only', async () => {
  const catalog = catalogFixture()
  const { ran } = await turn(catalog, [ask('ask_structure_worker', { request: 'Konrad, byt ut sidan.' })],
    { 'structure-worker': [() => ({ success: true, model: 'fixture', usage, responseId: 'w1', toolCalls: [call('w1c', 'edit_construction_parts', { artifact_id: 'c1' })] })] })
  const rejected = ran.find(r => r.name === 'edit_construction_parts')!
  assert.equal(rejected.status, 'invalid')
  assert.deepEqual(rejected.rejection, { code: 'unknown_part', fields: ['changes.0.part_id'] })
})

test('a hand-over with values is refused before any worker call', async () => {
  const catalog = catalogFixture()
  const { bob, workers } = await turn(catalog, [ask('ask_structure_worker', { job: 'Spara lådan', findings: 'Bredd 400 mm' })], {})
  assert.equal(workers['structure-worker'].length, 0)
  assert.equal(toolOutput(bob[1]).status, 'invalid')
})

test('Rita draws with a fixed tool list: the save is offered from the start and refused until a checked drawing exists', async () => {
  const catalog = catalogFixture()
  const { workers, ran } = await turn(catalog, [ask('ask_drawing_worker', { request: 'Rita, kan du rita lådan nu när Konrad är klar?' })],
    { 'drawing-worker': [
      () => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('r1c', 'save_cad_design', {})] }),
      () => ({ success: true, model: 'fixture', usage, responseId: 'r2', toolCalls: [call('r2c', 'design_project_cad', {})] })] })
  const [first, second, third] = workers['drawing-worker']
  assert.equal(first.catalogRoleKey, 'drawing-worker')
  assert(names(first).includes('design_project_cad') && names(first).includes('save_cad_design'), 'the save is offered before a candidate exists')
  // Too early: the server answers that it waits for a checked drawing; nothing is saved.
  const early = JSON.parse(String(second.messages!.find(m => m.role === 'tool')!.content))
  assert.equal(early.status, 'missing_context')
  assert(ran.some(r => r.name === 'design_project_cad'))
  assert.deepEqual(names(second), names(first)); assert.deepEqual(names(third), names(first), 'the same tools in the same order in every step')
  assert.deepEqual(Object.keys(tail(catalog, first, 'drawing-worker').knowledge), ['constructions', 'drawing_requests', 'plan', 'selected_solutions'])
})

test('Mattias works the same way: a plain request and his project knowledge', async () => {
  const catalog = catalogFixture()
  const request = 'Mattias, kan du se vilket material lådan behöver?'
  const { bob, workers } = await turn(catalog, [ask('ask_materials_worker', { request })], {})
  const [first] = workers['materials-worker']
  assert.equal(first.catalogRoleKey, 'materials-worker')
  assert.match(String(first.systemMessage), /Lådan/); assert(String(first.systemMessage).includes(catalog.text('worker.team')))
  const { knowledge, request: sent } = tail(catalog, first, 'materials-worker')
  assert.equal(sent, request); assert.deepEqual(Object.keys(knowledge), ['materials', 'constructions'])
  assert.equal(catalog.definition('tools.ask_materials_worker', 'tool_contract').definition.envelope.schema_version, 2)
  assert.equal(toolOutput(bob[1]).status, 'ok')
})

test('the workers come from the catalog; a tool belongs to one worker', () => {
  const catalog = catalogFixture(), workers = catalogWorkers(catalog)!
  assert.deepEqual(Object.keys(workers).sort(), ['drawing', 'materials', 'structure'])
  assert.deepEqual(workers.structure.tools, STRUCTURE); assert.deepEqual(workers.drawing.tools, DRAWING)
  const owned = Object.values(workers).flatMap(w => w.tools)
  assert.equal(new Set(owned).size, owned.length)
  for (const key of ['structure', 'drawing', 'materials']) {
    const role = catalog.definition(workers[key].role, 'role').definition
    assert.equal(role.profile_key, 'profile.ask-bob'); assert.equal(role.enabled, true)
    assert.deepEqual(role.prompt_keys.slice(-1), ['worker.team'])
  }
})

test('manifests before the publication keep construction and drawing with Bob, and Mattias\'s first form', async () => {
  const pinned = preBuildWorkersCatalogFixture()
  assert.deepEqual(Object.keys(catalogWorkers(pinned)!), ['materials'])
  assert.equal(catalogWorkers(pinned)!.materials.knowledge, undefined)
  const { bob, pickerInputs } = await turn(pinned, [], {})
  assert(!names(bob[0]).includes('ask_structure_worker') && !names(bob[0]).includes('ask_drawing_worker'))
  assert(pickerInputs[0].candidates.some((c: any) => c.name === 'save_construction_draft'))
  assert.equal(catalogRetiredTools(pinned).size, 0); assert.deepEqual(catalogCheckReads(pinned), [])
})
