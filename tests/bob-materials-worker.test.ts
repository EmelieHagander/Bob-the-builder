import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall, preMaterialsWorkerCatalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogCoreTools } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { runProjectAnswer, seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { catalogWorkers, parseWorkerJob } from '../supabase/functions/_shared/bob-workers.ts'
import { restoreWorkingContext, type ContextStore, type MemoryStair } from '../supabase/functions/_shared/bob-working-context.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { CATALOG_SEARCH_TOOL, CATALOG_READ_TOOL } from '../supabase/functions/_shared/material-catalog.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-10-30: pilot of Bob as coordinator with one worker,
// Mattias (materials). Bob no longer offers the materials tools; he hands the job
// to Mattias, who has his own fixed native tools and the same input Bob has:
// project snapshot, conversation summaries and history, then Bob's brief last.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const at = (n: number) => new Date(Date.UTC(2026, 9, 30, 8, n)).toISOString()
const MATERIALS = ['search_material_catalog', 'read_material_catalog', 'save_catalog_definition', 'manage_project_material', 'derive_cad_material_requirement', 'check_construction_cut_fit', 'save_construction_cut_plan', 'delete_shopping_item']

async function turn(catalog: AiCatalogSession, bobSteps: ((o: OpenAIServiceOptions) => unknown)[], workerSteps: ((o: OpenAIServiceOptions) => unknown)[]) {
  const projectId = 'p', message = 'Vilken plywood ska vi köpa till lådan?', hasAccess = async () => true
  const stair: MemoryStair = { snapshot: { project: { name: 'Lådan', phase: 'concept' } }, snapshotLockedAt: at(0),
    summaries: [{ id: 's1', level: 2, seqFrom: 1, seqTo: 2, text: 'Ägaren vill ha en låda av 12 mm plywood.' }],
    raw: [{ seq: 3, role: 'user', text: 'Den ska vara 40 cm bred.', state: 'completed', createdAt: at(3) }, { seq: 4, role: 'assistant', text: 'Noterat, 40 cm.', state: 'completed', createdAt: at(4) }], events: [] }
  const store = { load: async () => ({}), save: async () => ({}), search: async () => ({}) } as ContextStore
  const context = restoreWorkingContext({ version: 1, projectId, threadId: 't', searches: 0, context: { summary: '', throughSeq: 2,
    recent: [{ seq: 5, role: 'user', text: message, state: 'pending' }], recentWrites: [], recentSources: [], memoryManagementVersion: 2, stair } }, { projectId, threadId: 't', message, store, hasAccess })
  const reads: any[] = []
  const lookup = createProjectLookup(projectId, async (_project, input) => { reads.push(input)
    return { data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Lådan', description: 'Saved project' }] : input.dataset === 'materials' ? [{ id: 'mat-1', name: 'Plywood 12 mm', quantity: 2 }] : [], related: [], truncated: false }, error: null } as any }, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const constructionTools = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }) })
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  const catalogCalls: { name: string; args: unknown }[] = []
  const catalogReader = { tools: [CATALOG_SEARCH_TOOL, CATALOG_READ_TOOL], remaining: 20,
    read: async (name: string, args: unknown) => { catalogCalls.push({ name, args }); return { status: 'ok', records: [{ id: 'def-ply12', title: 'Plywood 12 mm' }] } } }
  const readToolPolicy = async () => {
    const policy = await seedToolPolicy(), definitions = catalog.manifest().definitions
    return { ...policy, phase: 'concept', tools: policy.tools.map(row => {
      const version = (definitions.find(d => d.prompt_key === 'tools.' + row.name)?.definition.envelope as { schema_version?: number } | undefined)?.schema_version
      return version ? { ...row, schema_version: version } : row
    }) }
  }
  const bob: OpenAIServiceOptions[] = [], worker: OpenAIServiceOptions[] = [], pickerInputs: any[] = [], ran: { name: string; status: string }[] = []
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, context, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, catalogReader,
    aiCatalog: catalog, corePreload: true, readToolPolicy, toolPicker: true, completeRequest: true, onTool: v => ran.push({ name: v.name, status: v.status }),
    cadAssistant: { pending: async () => [], tools: [DESIGN_CAD_TOOL], lifecycleTools: [], remaining: 1, lifecycleRemaining: 0,
      candidate: null, partial: false, failure: null, sources: [], consult: async () => ({ status: 'invalid' }), lifecycle: async () => ({ status: 'invalid' }) } as any,
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage, data: JSON.stringify({ work_remaining: false, reason: '' }) }
      if (options.functionName === 'tool-picker') { pickerInputs.push(JSON.parse(String(options.messages![0].content))); return { success: true, model: 'fixture', usage, data: JSON.stringify({ tools: [], reason: '' }) } }
      if (options.functionName === 'materials-worker') { worker.push(structuredClone(options)); const step = workerSteps[worker.length - 1]
        return (step ? step(options) : { success: true, model: 'fixture', usage, responseId: 'w-done', data: 'Rapport: 12 mm plywood finns i katalogen (def-ply12).' }) as any }
      bob.push(structuredClone(options)); const step = bobSteps[bob.length - 1]
      return (step ? step(options) : { success: true, model: 'fixture', usage, responseId: 'b-done', data: 'Mattias hittade 12 mm plywood.' }) as any
    }, catalog) } as any)
  assert.equal(result.ok, true, JSON.stringify(result))
  return { bob, worker, pickerInputs, ran, catalogCalls, reads }
}
const names = (o: OpenAIServiceOptions) => (o.tools ?? []).map(t => t.function.name)
const contents = (o: OpenAIServiceOptions) => (o.messages ?? []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
const handOver = [() => ({ success: true, model: 'fixture', usage, responseId: 'b1', toolCalls: [call('c1', 'ask_materials_worker', { job: 'Hitta 12 mm plywood i katalogen till lådan.', findings: 'Lådan är 40 cm bred.' })] })]

test('Bob hands the materials job to Mattias; Mattias works with his own fixed tools and the same conversation', async () => {
  const catalog = catalogFixture(), core = catalogCoreTools(catalog)!
  // The six permanent tools are unchanged, so a runtime without workers ignores the pilot.
  assert.equal(core.length, 6); assert(!core.includes('ask_materials_worker'))
  const { bob, worker, pickerInputs, ran, catalogCalls, reads } = await turn(catalog, handOver, [
    () => ({ success: true, model: 'fixture', usage, responseId: 'w1', toolCalls: [call('w1c', 'search_material_catalog', { entity: 'materials', query: 'plywood 12', categories: [], profile_code: null, profile_revision: null, properties: {} })] }),
  ])
  // Bob: the hand-over tool, none of the materials tools, and no materials candidates for the picker.
  assert(names(bob[0]).includes('ask_materials_worker'), 'the hand-over is loaded from the first step')
  assert(!pickerInputs[0].candidates.some((c: any) => c.name === 'ask_materials_worker'))
  assert(!names(bob[0]).some(n => MATERIALS.includes(n)), JSON.stringify(names(bob[0])))
  assert(!pickerInputs[0].candidates.some((c: any) => MATERIALS.includes(c.name)))
  // Mattias: his tools only, fixed across his steps, with full manuals.
  assert.equal(worker.length, 2)
  assert.equal(worker[0].catalogRoleKey, 'materials-worker')
  assert(names(worker[0]).every(n => MATERIALS.includes(n) || ['search_project_data', 'open_project_item', 'read_construction_draft', 'read_solution_context'].includes(n)), JSON.stringify(names(worker[0])))
  assert(names(worker[0]).includes('search_material_catalog') && !names(worker[0]).includes('ask_materials_worker') && !names(worker[0]).includes('describe_tool'))
  assert.equal(worker[1].previousResponseId, 'w1')
  // His input: project snapshot, the conversation label, the same summary and history as Bob, then Bob's brief last.
  const input = contents(worker[0])
  assert.match(input[0], /^Projektet på huvudnivå/); assert(input[0].includes('"Lådan"'))
  assert.match(input[1], /^Här följer samtalet mellan Bob och beställaren/)
  assert(input[2].includes('Ägaren vill ha en låda av 12 mm plywood.') && input[2].includes('"from_seq":1'))
  assert.deepEqual(input.slice(3, 5), ['Den ska vara 40 cm bred.', 'Noterat, 40 cm.'])
  assert.match(input.at(-1)!, /^Bobs uppdrag till dig/)
  const brief = JSON.parse(input.at(-1)!.slice(input.at(-1)!.indexOf('\n') + 1))
  assert.equal(brief.job, 'Hitta 12 mm plywood i katalogen till lådan.'); assert.equal(brief.findings, 'Lådan är 40 cm bred.')
  assert.equal(brief.current.records[0].name, 'Plywood 12 mm', 'the current project materials come with the brief')
  assert(reads.some(r => r.dataset === 'materials'))
  // Mattias's tool ran through the same session; Bob got his report.
  assert.equal(catalogCalls[0].name, 'search_material_catalog')
  assert(ran.some(r => r.name === 'search_material_catalog' && r.status === 'ok'))
  const report = JSON.parse(String(bob[1].messages!.find(m => m.role === 'tool')!.content))
  assert.equal(report.status, 'ok'); assert.match(report.report, /def-ply12/)
  assert.deepEqual(report.calls, [{ tool: 'search_material_catalog', status: 'ok' }])
})

test('Mattias cannot call tools outside his set; an invalid hand-over is refused before any worker call', async () => {
  const catalog = catalogFixture()
  const outside = await turn(catalog, handOver, [() => ({ success: true, model: 'fixture', usage, responseId: 'w1', toolCalls: [call('w1c', 'save_cad_design', { request_quote: 'x' })] })])
  assert.deepEqual(JSON.parse(String(outside.bob[1].messages!.find(m => m.role === 'tool')!.content)).calls, [{ tool: 'save_cad_design', status: 'not_offered' }])
  const invalid = await turn(catalog, [() => ({ success: true, model: 'fixture', usage, responseId: 'b1', toolCalls: [call('c1', 'ask_materials_worker', { task: 'x' })] })], [])
  assert.equal(invalid.worker.length, 0)
  assert.equal(JSON.parse(String(invalid.bob[1].messages!.find(m => m.role === 'tool')!.content)).status, 'invalid')
  assert.equal(parseWorkerJob({ job: ' ', findings: null }), null); assert.deepEqual(parseWorkerJob({ job: 'Gör x', findings: null }), { job: 'Gör x', findings: null })
})

test('manifests before the pilot keep the materials tools with Bob and never start a worker', async () => {
  const pinned = preMaterialsWorkerCatalogFixture()
  assert.equal(catalogWorkers(pinned), null)
  const { worker, pickerInputs } = await turn(pinned, [], [])
  assert.equal(worker.length, 0)
  assert(pickerInputs[0].candidates.some((c: any) => c.name === 'search_material_catalog'))
})

test('the worker definition and role come from the catalog', () => {
  const catalog = catalogFixture(), workers = catalogWorkers(catalog)!
  assert.deepEqual(workers.materials.tools, MATERIALS)
  assert.equal(workers.materials.tool, 'ask_materials_worker'); assert.equal(workers.materials.max_steps, 12)
  const role = catalog.definition('role.materials-worker', 'role').definition
  assert.equal(role.profile_key, 'profile.ask-bob'); assert.equal(catalog.definition('agent-contract.materials-worker').definition.writes, 'through_bob_session')
  assert.match(catalog.text('materials-worker.contract'), /Do exactly the job in Bob's brief/)
})
