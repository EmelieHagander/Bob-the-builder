/** Read-only, synthetic runtime audit. No network, credentials or real model.
 * Usage: node --import tsx scripts/audit-bob-runtime.ts [catalog-json | --seed | --compare]
 * Default: current repository seed; an explicit catalog path is never upgraded silently.
 * Optional catalog JSON must contain public tool metadata only, never project data.
 * This reports current mechanics; it is NOT a behavioural model evaluation.
 */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { BOB_PERSONA } from '../supabase/functions/_shared/bob-prompt.ts'
import { BOB_TRUTH_RULES } from '../supabase/functions/_shared/project-answer.ts'
import { domainVocabulary } from '../src/domain/vocabulary.ts'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { checkedToolSnapshot, type ToolInstructions } from '../supabase/functions/_shared/project-tools/session.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with { type: 'json' }
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectContext } from '../supabase/functions/_shared/project-context/dispatcher.ts'
import { createMaterialCatalogReader } from '../supabase/functions/_shared/material-catalog.ts'
import { createKnowledgeReader } from '../supabase/functions/_shared/building-knowledge.ts'
import { createOperationalReader } from '../supabase/functions/_shared/project-operations.ts'
import { createRecordDetailReader } from '../supabase/functions/_shared/project-record-detail.ts'
import { createProjectImageTools } from '../supabase/functions/_shared/project-image-tools.ts'
import { createPlanAssistant } from '../supabase/functions/_shared/plan-assistant.ts'
import { createCadAssistant } from '../supabase/functions/_shared/cad-assistant.ts'
import { createGroundedModelCall } from '../supabase/functions/_shared/project-grounding.ts'
import { buildBobSystemMessage, runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { parameterPlan } from '../tests/support/cad-parameter-fixture.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createExecutionMetrics, type ExecutionEvent } from '../supabase/functions/_shared/execution-metrics.ts'
import { measureRuntimeInput, measureRuntimeOutput } from './support/runtime-audit-metrics.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'
import { drawingSaved } from '../supabase/functions/_shared/project-delivery.ts'

export type ManualStrategy = 'per_tool' | 'batch_all' | 'selective'
type ScriptedCall = [string, unknown]
export async function runRuntimeAudit(catalogArg?: string, toolInstructions: ToolInstructions = 'inline', manualStrategy: ManualStrategy = 'per_tool') {
const originalLog = console.log, originalWarn = console.warn, originalFetch = globalThis.fetch
try {
// No network is permitted, including accidental calls from a new fixture.
globalThis.fetch = async () => { throw new Error('Runtime audit attempted network I/O') }
const useSeed = !catalogArg || catalogArg === '--seed'
const catalog = checkedToolSnapshot({ phase: null, tools: useSeed ? seed
  : JSON.parse(await readFile(catalogArg, 'utf8')) }).tools
const handoff={deliverable:'Synthetic shelf concept',requirements:[{id:'shape',requirement:'Keep the requested shelf dimensions',basis:'user_request',source_ref:null}],coordinates:{origin:null,positive_x:null,positive_y:null,positive_z:'up'},views:['front','top'],unresolved:['Site fit']}
const id = '50000000-0000-4000-8000-000000000001'
const stamp = '2026-10-03T00:00:00Z'
let responseSequence = 0
const calls: any[] = []
const executionEvents: ExecutionEvent[] = []
const metrics = createExecutionMetrics({ runId: 'synthetic-audit', turnId: 'synthetic-turn', startedAt: 0, write: async e => { executionEvents.push(e) } })
function measured(scenario: string, model: (o: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<any>>, history: string[] = []) {
  return async (options: OpenAIServiceOptions) => {
    const input = measureRuntimeInput(options, history) // snapshot before the loop mutates its message array
    const start = performance.now(), result = await model(options)
    const elapsed = performance.now() - start
    await metrics.model(options, result, elapsed)
    calls.push({ scenario, role: options.functionName, call: calls.filter(c => c.scenario === scenario && c.role === options.functionName).length + 1,
      ...input, ...(options.functionName === 'ask-bob' ? { system_sections_utf8_bytes: { persona: Buffer.byteLength(BOB_PERSONA), rules: Buffer.byteLength(BOB_TRUTH_RULES), vocabulary: Buffer.byteLength(domainVocabulary('bob')), toolbox_and_separators: input.content_utf8_bytes.system - Buffer.byteLength(BOB_PERSONA + BOB_TRUTH_RULES + domainVocabulary('bob')) } } : {}), execution_metric_role: executionEvents.at(-1)?.role, output: measureRuntimeOutput(result), fixture_elapsed_ms: elapsed,
      provider_usage: null, provider_cost_usd: null, provider_latency_ms: null })
    return result
  }
}
const response = (data: unknown, name?: string, args?: unknown): any => ({ success: true, data, model: 'controlled-fixture',
  responseId: 'synthetic-response-' + ++responseSequence, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  ...(name ? { toolCalls: [{ id: 'synthetic-call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : {}) })
const noIO = async (): Promise<any> => { throw new Error('Audit unexpectedly attempted external I/O') }
function lookup(budget = 32) {
  return createProjectLookup('synthetic', async (_p, q) => ({ error: null, data: { records: q.dataset === 'project'
    ? [{ id: 'synthetic', name: 'Synthetic audit project', phase: 'planning' }]
    : q.dataset === 'areas' ? [{ id: 'synthetic-area', name: 'Synthetic work area' }]
    : q.dataset === 'target' ? [{ id: 'synthetic', revision: 1, solution_id: id }] : [], related: [], truncated: false } }), 1000, budget)
}
function fixture(phase: string | null, message = 'Skapa en uppgift för att mäta öppningen.') {
  const receipts: any[] = [], drafts: any[] = []
  const writer = createProjectWriter('synthetic', message, async payload => {
    if (payload.kind === 'construction') {
      if (payload.expected_revision !== drafts.length) return { data: null, error: { code: '40001' } }
      const revision = drafts.length + 1
      const draft = { ...structuredClone(payload.data), projectId: 'synthetic', status: 'ok', artifact_id: id, revision, current_revision: revision, source_state: 'current', archived: false }
      drafts.push(draft)
      const receipt = { projectId: 'synthetic', dataset: 'artifacts', recordId: id, label: 'Synthetic construction', operation: revision === 1 ? 'created' : 'updated', revision, savedAt: stamp, areaId: null, record: { ...draft, id, area_id: null } }
      receipts.push(receipt); return { data: receipt, error: null }
    }
    const recordId = `synthetic-task-${receipts.length + 1}`
    const receipt = { projectId: 'synthetic', dataset: 'tasks', recordId, label: 'Synthetic task', operation: 'created', savedAt: stamp, record: { id: recordId } }
    receipts.push(receipt); return { data: receipt, error: null }
  }, async () => ({ data: receipts, error: null }), async () => ({ data: { generation: 1, receipts }, error: null }))
  const hasAccess = async () => true, deadline = Date.now() + 300000
  const base = { projectId: 'synthetic', userId: 'synthetic-user', hasAccess, deadline }
  const constructionTools = createConstructionTools({ projectId: 'synthetic', message, writer, hasAccess, now: () => new Date(stamp),
    read: async (artifact, revision) => artifact === null ? { projectId: 'synthetic', status: 'ok', items: structuredClone(drafts.slice(-1)) }
      : artifact !== id || !drafts.length ? { projectId: 'synthetic', status: 'not_found' }
      : { ...structuredClone(drafts[(revision ?? drafts.length) - 1]), current_revision: drafts.length },
    readSources: async () => ({ project: new Map(), physical: new Map() }),
    readCatalog: async (materialId, revision) => ({ projectId: 'synthetic', status: 'ok', record: { id: materialId, revision, current_revision: 1, kind: 'material', source_kind: 'design_choice', profile_code: 'sheet_stock', categories: ['wood.plywood', 'sheet'], properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null } } } }),
  })
  const projectContext = createProjectContext({ adapters: [], hasAccess, sources: [] })
  const opts = { ...base, message, writer, toolInstructions, lookup: lookup(), projectContext, constructionTools,
    context: { summary: '', throughSeq: 0, recent: [{ seq: 1, role: 'user', text: message, state: 'pending' }], history: { remaining: 4, search: noIO } },
    knowledgeReader: createKnowledgeReader(hasAccess),
    operationalReader: createOperationalReader('synthetic', noIO, hasAccess, []),
    recordReader: createRecordDetailReader(noIO, hasAccess),
    catalogReader: createMaterialCatalogReader('synthetic', noIO, hasAccess, []),
    imageTools: createProjectImageTools({ ...base, message, writer, generate: noIO, upload: noIO }),
    planAssistant: createPlanAssistant({ ...base, makeLookup: () => lookup(128), callModel: noIO }),
    cadAssistant: createCadAssistant({ ...base, makeLookup: () => lookup(40), callModel: noIO, render: noIO, readArtifact: noIO, available: true,
      requestStore: { list: async () => [], load: noIO, save: noIO, read: noIO, cancel: noIO, work: noIO, linkGap: noIO, ensureGapTask: noIO, restore: noIO } }),
    readToolPolicy: async () => ({ phase, tools: catalog }),
  }
  return { opts, receipts, drafts, session: () => createBobToolSession({ ...opts, readPolicy: opts.readToolPolicy } as any) }
}

// Runtime instrumentation contains synthetic data only; keep the report JSON parseable.
console.log = () => {}
console.warn = () => {}
const surfaces = []
for (const phase of [null, 'concept', 'design', 'planning', 'build', 'complete']) {
  const f = fixture(phase), tools = await f.session().prepare()
  const descriptions = tools.map(t => ({ name: t.function.name, bytes: Buffer.byteLength(JSON.stringify(t)) })).sort((a, b) => b.bytes - a.bytes)
  const session = f.session(); await session.prepare()
  surfaces.push({ phase, offered: tools.length, domain_tools: tools.filter(t => t.function.name !== 'describe_tool').length,
    domain_schema_sha256: createHash('sha256').update(JSON.stringify(tools.filter(t => t.function.name !== 'describe_tool').map(t => ({ name: t.function.name, parameters: t.function.parameters })))).digest('hex'),
    system_chars: buildBobSystemMessage(tools, session.toolbox).length, schema_bytes: Buffer.byteLength(JSON.stringify(tools)),
    unique_tools: new Set(tools.map(t => t.function.name)).size, duplicate_names: [...new Set(tools.filter((t, i) => tools.findIndex(other => other.function.name === t.function.name) !== i).map(t => t.function.name))],
    cad_initially_offered: tools.some(t => t.function.name === 'design_project_cad'), largest: descriptions.slice(0, 5),
    names: tools.map(t => t.function.name) })
}
// Since 2026-09-27 there is no discovery round: report the shelves Bob sees instead.
const shelfSession = fixture('planning').session(); const offered = await shelfSession.prepare()
const missingConstructionTools = ['read_construction_draft', 'save_construction_draft', 'check_construction_draft'].filter(name => !offered.some(t => t.function.name === name))
if (useSeed) assert.deepEqual(missingConstructionTools, [], 'Current K1/K2 handlers must reach the model through the seed policy')
const manualReads: string[] = []
function collectResults(options: OpenAIServiceOptions, results: any[] = []) {
  for (const m of options.messages ?? []) if (m.role === 'tool') {
    const result = JSON.parse(String(m.content))
    if (result.manual) {
      assert.equal(result.status, 'ok'); assert.equal(result.schema_version, catalog.find(r => r.name === result.name)?.schema_version)
      assert(result.manual.includes(catalog.find(r => r.name === result.name)!.how_to.trim()))
      manualReads.push(result.name)
    } else results.push(result)
  }
}
function withManuals(replies: ScriptedCall[]): ScriptedCall[][] {
  if (toolInstructions === 'inline') return replies.map(call => [call])
  if (manualStrategy !== 'per_tool') {
    // Scripted hypotheses, not a runtime router: batch independent manual reads
    // before acting; selective asks only for construction save/check guidance.
    const names = [...new Set(replies.map(([name]) => name))].filter(name => manualStrategy === 'batch_all'
      || ['save_construction_draft', 'check_construction_draft'].includes(name))
    return [...(names.length ? [names.map(name => ['describe_tool', { name }] as ScriptedCall)] : []), ...replies.map(call => [call])]
  }
  const seen = new Set<string>()
  return replies.flatMap(([name, args]): ScriptedCall[][] => {
    const read = !seen.has(name); seen.add(name)
    return [...(read ? [[['describe_tool', { name }] as ScriptedCall]] : []), [[name, args]]]
  })
}
function scriptedResponse(options: OpenAIServiceOptions, batch: ScriptedCall[]) {
  for (const [name] of batch) assert(options.tools?.some(t => t.function.name === name), 'Scripted tool must actually be offered: ' + name)
  const result = response(null)
  result.toolCalls = batch.map(([name, args], i) => ({ id: batch.length === 1 ? 'synthetic-call' : `synthetic-call-${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }))
  return result
}
const discovery = shelfSession.toolbox.reduce((acc: Record<string, string[]>, e) => { (acc[e.group] ??= []).push(e.state === 'offered' ? e.name : `${e.name} (${e.state})`); return acc }, {})
const premature = []
for (const [message,kind] of [['Skapa en uppgift för att mäta öppningen.','task'], ['Ändra planen och flytta uppgiften till rätt steg.','plan'], ['Ta fram och spara materiallistan.','material']]) {
  const f = fixture('planning', message); let calls = 0
  const result = await runProjectAnswer({ ...f.opts, callModel: measured('premature-' + kind, async o => {
    calls++
    assert.equal(o.tool_choice, undefined, 'no forced tool choice'); assert.equal(o.schemaName, undefined, 'no classifier call')
    return response('Jag kan göra det i nästa svar.')
  }) } as any)
  premature.push({ message, model_calls: calls, writes: f.receipts.length, ok: result.ok, ...(result.ok ? { partial: result.evidence.partial, answer: result.answer } : { error: result.error }) })
}

// Scripted replies exercise the real tool loop and checker. Storage is in memory;
// this is payload/mechanics evidence, never autonomous design or SQL acceptance.
let construction: any = { status: 'not_run', reason: 'catalog_contract_missing', missing_tools: missingConstructionTools }
if (!missingConstructionTools.length) {
  const message = 'Skapa och kontrollera ett syntetiskt hyllkoncept, 600 × 800 × 300 mm, med 18 mm plywood.'
  const f = fixture('design', message)
  const placement = (x = 0, z = 0) => ({ x, y: 0, z, rx: 0, ry: 0, rz: 0 })
  const recipe: any = { contract_version: 1, units: 'mm', assembly_id: 'audit-shelf',
    definitions: [{ id: 'side', primitive: 'box', material_ref: null, x_mm: 18, y_mm: 300, z_mm: 800 },
      { id: 'panel', primitive: 'box', material_ref: null, x_mm: 564, y_mm: 300, z_mm: 18 }],
    instances: [{ id: 'left', definition_id: 'side', placement: placement() }, { id: 'right', definition_id: 'side', placement: placement(582) },
      ...[0, 391, 782].map((z, i) => ({ id: 'panel' + i, definition_id: 'panel', placement: placement(18, z) }))], views: ['front', 'top'] }
  const joints = [0, 1, 2].flatMap(i => ['left', 'right'].map(side => ({ id: side + i, method: 'screwed_butt',
    first: { instance_id: side, face: side === 'left' ? 'x_max' : 'x_min' }, second: { instance_id: 'panel' + i, face: side === 'left' ? 'x_min' : 'x_max' }, reason: 'Synthetic concept choice' })))
  const save = { key: 'initial', record_id: null, expected_revision: 0, title: 'Synthetic shelf', description: 'Offline audit fixture',
    area_id: null, target_revision: 1, change_note: 'Initial concept', recipe, parameter_plan: parameterPlan(recipe),
    materials: ['side', 'panel'].map(definition_id => ({ definition_id, material_id: id, material_revision: 1, part_id: null, part_revision: null })),
    joints: joints.slice(0, -1), open_questions: [] }
  const replies = withManuals([
    ['read_construction_draft', { artifact_id: null, revision: null, after: null }],
    ['save_construction_draft', save], ['check_construction_draft', { artifact_id: id, revision: 1 }],
    ['save_construction_draft', { ...save, key: 'repair', record_id: id, expected_revision: 1, joints, change_note: 'Add the missing contact joint' }],
    ['check_construction_draft', { artifact_id: id, revision: 2 }],
    ['read_construction_draft', { artifact_id: id, revision: 2, after: null }],
  ])
  const results: any[] = []; let step = 0; let stop: any
  const answer = await runProjectAnswer({ ...f.opts, observe: value => { stop = value }, callModel: measured('construction-repair', async options => {
    collectResults(options, results)
    const next = replies[step++]
    if (!next) return response('Konceptet är sparat och geometriskt kontrollerat. Produktval och hållfasthet är fortfarande öppna.')
    return scriptedResponse(options, next)
  }) } as any)
  assert(answer.ok, JSON.stringify(answer))
  assert.equal(f.drafts.length, 2, JSON.stringify(results))
  assert.equal(results[2].concept_ready, false); assert(results[2].issues.some((i: any) => i.code === 'contact_without_joint'))
  assert.equal(results[4].concept_ready, true); assert.equal(results[4].fabrication_ready, false)
  assert.equal(results[5].revision, 2); assert.deepEqual(f.drafts[0].recipe, f.drafts[1].recipe)
  assert.equal(f.drafts[0].joints.length, 5); assert.equal(f.drafts[1].joints.length, 6)
  construction = { status: 'scripted_loop_passed', storage: 'in_memory_not_SQL', stop, revisions: f.drafts.length,
    first_check: { concept_ready: results[2].concept_ready, issues: results[2].issues.map((i: any) => i.code) },
    corrected_check: { concept_ready: results[4].concept_ready, fabrication_ready: results[4].fabrication_ready },
    readback_revision: results[5].revision, preserved_geometry: true, historical_joint_count: f.drafts[0].joints.length }
}

// Compare a simple task with construction on the same current toolbox. Include
// nonempty persisted-context input to expose the historical contribution.
const prior = ['Tidigare syntetiskt önskemål: behåll projektets mått.', 'Syntetiskt svar: uppgiften återstår.']
const task = fixture('planning')
task.opts.context.summary = 'Tidigare syntetisk planering; inget nytt sparande är verifierat.'
task.opts.context.throughSeq = 2
task.opts.context.recent = [
  { seq: 3, role: 'user', text: prior[0], state: 'completed' },
  { seq: 4, role: 'assistant', text: prior[1], state: 'completed' },
  { seq: 5, role: 'user', text: task.opts.message, state: 'pending' },
]
const taskReplies = withManuals([
  ['search_project_data', { dataset: 'areas', query: null, status: null, area_id: null, record_id: null, after_id: null }],
  ['save_project_task', { record_id: null, area_id: 'synthetic-area', step_id: null, name: 'Mät öppningen', instructions: 'Syntetisk uppgift', expected_updated_at: null }],
])
let taskStep = 0
const taskResult = await runProjectAnswer({ ...task.opts, callModel: measured('task-save-with-history', async options => {
  collectResults(options)
  const next = taskReplies[taskStep++]
  if (next) return scriptedResponse(options, next)
  return response('Uppgiften är sparad.')
}, prior) } as any)
assert(taskResult.ok); assert.equal(task.receipts.length, 1)

const readProbe = lookup()
const readInput = { dataset: 'project', query: null, status: null, area_id: null, record_id: null }
for (let i = 0; i < 32; i++) await readProbe.search(readInput)
let grounding: any
await createGroundedModelCall({ projectId: 'synthetic', message: 'Compare the reference.', lookup: lookup(48), hasAccess: async () => true,
  validateImages: async () => true, deadline: Date.now() + 30000, callModel: async o => { grounding = o.messages?.at(-1)?.content; return response('Synthetic answer') } })({
  messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'data:image/png;base64,c3ludGhldGlj' }] }],
} as any)
const groundingData = JSON.parse(grounding.slice(grounding.indexOf('{')))

const recipe = { contract_version: 1 as const, units: 'mm' as const, assembly_id: 'shelf',
  definitions: [{ id: 'board', primitive: 'box' as const, x_mm: 600, y_mm: 250, z_mm: 18, material_ref: null }],
  instances: [{ id: 'shelf.board', definition_id: 'board', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front' as const, 'top' as const] }
const candidate = { purpose: 'project', parameter_plan: parameterPlan(recipe), dimension_bindings: [], recipe, source_artifact_id: null, source_revision: null, part_ids: [], title: 'Synthetic shelf', description: 'Synthetic audit geometry',
  assumptions: 'No physical verification', target_revision: 1, measurements: [] }
const broken = structuredClone(candidate) as any; delete broken.recipe.definitions[0].y_mm
const cadCalls: any[] = []; let renders = 0
const cad = createCadAssistant({ projectId: 'synthetic', userId: 'synthetic-user', hasAccess: async () => true, makeLookup: () => lookup(40),
  deadline: Date.now() + 300000, available: true, readArtifact: noIO,
  render: async r => { renders++; const bounds = { min: [0, 0, 0], max: [600, 250, 18], size: [600, 250, 18] }
    return { recipe: r, manifest: { bounding_box_mm: bounds,
      instances: r.instances.map(i => ({ id: i.id, definition_id: i.definition_id, bounding_box_mm: bounds })) },
    files: { front: 'SYNTHETIC_SVG_BYTES', top: 'SYNTHETIC_SVG_BYTES' }, previews: {front:'SYNTHETIC_PNG_BYTES',top:'SYNTHETIC_TOP_PNG_BYTES'} } },
  callModel: measured('cad-repair', async o => {
    if(o.functionName==='cad-research') return response(null, 'finish_cad_research', { checks: [{ id: 'shape', status: 'known', blocking: false, source_refs: ['requirement:shape'], action: 'none', detail: 'Explicit synthetic dimensions' }], additional_needs: [] })
    if(o.schemaName==='bob_cad_review')return response({verdict:'pass',summary:'Synthetic review',requirements:{shape:{status:'met',evidence:'Synthetic geometry'}},issues:[]});cadCalls.push(structuredClone(o)); return cadCalls.length === 1 ? response(null, 'render_cad_candidate', broken)
    : cadCalls.length === 2 ? response(null, 'render_cad_candidate', candidate) : response('The synthetic candidate is ready.') }),
})
const cadResult = await cad.consult({ handoff, brief: 'Draw a shelf concept.', area_id: null, component_id: null, step_id: null, artifact_id: null })
const cadReturns = cadCalls.flatMap(o => o.messages ?? []).filter(m => m.role === 'tool').map(m => JSON.parse(m.content))
assert.equal(cadResult.status, 'ready', JSON.stringify(cadResult))
assert(cad.candidate, 'Only an independently reviewed candidate may be offered for saving')
assert.equal(renders, 1, 'Valid geometry must reach the synthetic transport once; invalid geometry must not.')

let fourthTools: string[] = [], researchCalls = 0
const researchLookup = lookup(40)
const research = createCadAssistant({ projectId: 'synthetic', userId: 'synthetic-user', hasAccess: async () => true,
  makeLookup: () => researchLookup, deadline: Date.now() + 300000, available: true, readArtifact: noIO, render: noIO,
  callModel: measured('cad-read-boundary', async o => {
    if(o.functionName==='cad-research')return response(null, 'finish_cad_research', { checks: [{ id: 'shape', status: 'known', blocking: false, source_refs: ['requirement:shape'], action: 'none', detail: 'Explicit request' }], additional_needs: [] })
    researchCalls++; if (researchCalls <= 3) return response(null, 'search_project_data', readInput)
    fourthTools = (o.tools ?? []).map(t => t.function.name)
    return response(null, 'report_cad_blocker', { reason: 'missing_constraint', explanation: 'Synthetic stopping condition for the audit.' }) }),
})
const researchResult = await research.consult({ handoff, brief: 'Read four needed records before drawing.', area_id: null, component_id: null, step_id: null, artifact_id: null })

assert.equal(researchResult.status, 'blocked')

const w = fixture('planning'), writeStatuses: string[] = []
for (let i = 0; i < 9; i++) writeStatuses.push((await w.opts.writer.write('save_project_task', {
  record_id: null, area_id: 'synthetic-area', step_id: null, name: `Synthetic task ${i + 1}`, instructions: 'Synthetic work',
  expected_updated_at: null, request_quote: w.opts.message,
})).status)
assert.equal(writeStatuses.filter(s => s === 'saved').length, 9)

const sourceFiles = ['scripts/audit-bob-runtime.ts', 'scripts/support/runtime-audit-metrics.ts', 'supabase/functions/_shared/bob-prompt.ts', 'supabase/functions/_shared/project-answer.ts', 'supabase/functions/_shared/project-tools/session.ts', 'supabase/functions/_shared/project-tools/bob-tools.ts', 'supabase/functions/_shared/construction-draft.ts', 'supabase/functions/_shared/construction-checks.ts', 'supabase/functions/_shared/cad-assistant.ts', 'supabase/functions/_shared/cad-research.ts', 'supabase/functions/_shared/cad-review.ts', 'supabase/functions/_shared/execution-metrics.ts']
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex')])))
return { report_version: 1, tool_instruction_mode: toolInstructions, manual_strategy: toolInstructions === 'inline' ? null : manualStrategy, manual_reads: manualReads, source_sha256: sourceHashes, fixture_date: stamp, catalog_sha256: createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),
  evidence_class: 'controlled runtime mechanics; model and I/O are synthetic',
  catalog_source: useSeed ? 'current repository seed (not live policy)' : 'explicit caller-supplied snapshot (not live policy)', active_catalog_tools: catalog.filter(r => r.active).length,
  measurement_contract: { units: 'UTF-8 bytes; not tokens', boundary: 'Local callModel options before shared provider formatting/configuration', retained_history: 'previousResponseId may carry unmeasured provider context', content_accounting: 'UTF-8 content values; local_input_json_bytes separately includes local serialization overhead', coverage: 'Bob/task/construction and CAD intake/designer/reviewer; plan specialist and memory-fold calls are not exercised', usage: 'Synthetic replies; provider usage, caching, cost and latency unavailable' },
  construction, task_save: { status: taskResult.ok ? 'saved' : 'failed', writes: task.receipts.length },
  calls, execution_roles: [...new Set(executionEvents.filter(e => e.kind === 'model').map(e => e.role))],
  surfaces, toolbox_shelves: discovery, premature,
  reserved_image_grounding: { remaining: readProbe.remaining, project: groundingData.project.status, measurements: groundingData.measurements.status, provider_still_called: true },
  cad: { status: cadResult.status, calls: cadCalls.length, renders, returned_to_designer: cadReturns.map(r => ({ status: r.status, reason: r.reason ?? null })),
    generated_pixels_delivered: cadCalls.some(o => (o.messages ?? []).some((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === 'image_url'))),
    svg_bytes_delivered: JSON.stringify(cadCalls).includes('SYNTHETIC_SVG_BYTES'),
    research_boundary_status: researchResult.status, research_tools_on_fourth_call: fourthTools, unused_lookup_calls: researchLookup.remaining },
  write_statuses_for_nine_tasks: writeStatuses,
  drawing_receipt_check_accepts_any_saved_drawing: drawingSaved([{ dataset: 'artifacts', revision: 1, record: { cad: true } }] as any,
    [{ operation: 'execute', name: 'save_cad_design', status: 'saved' }]),
}
} finally {
  console.log = originalLog; console.warn = originalWarn; globalThis.fetch = originalFetch
}
}

/** Paired mechanics experiment. Extra manual steps and their payload count; they
 * are not free retrieval, nor evidence that a real model chooses to retrieve. */
export async function runRuntimeComparison() {
  const baseline = await runRuntimeAudit()
  const candidates = []
  for (const strategy of ['per_tool', 'batch_all', 'selective'] as const) candidates.push(await runRuntimeAudit(undefined, 'on_demand', strategy))
  for (const candidate of candidates) for (const [i, before] of baseline.surfaces.entries()) {
    const after = candidate.surfaces[i]
    assert.equal(after.domain_schema_sha256, before.domain_schema_sha256)
    assert.deepEqual(after.names.filter(n => n !== 'describe_tool'), before.names)
  }
  const summarize = (r: Awaited<ReturnType<typeof runRuntimeAudit>>) => ({
    tool_instruction_mode: r.tool_instruction_mode, manual_strategy: r.manual_strategy, source_sha256: r.source_sha256, catalog_sha256: r.catalog_sha256,
    surfaces: r.surfaces,
    calls: r.calls.map(({ fixture_elapsed_ms: _timing, ...call }) => call),
    scenarios: [...new Set(r.calls.map(c => c.scenario))].map(scenario => {
      const calls = r.calls.filter(c => c.scenario === scenario)
      return { scenario, model_calls: calls.length, manual_calls: calls.reduce((n, c) => n + c.output.returned_tools.filter((t: string) => t === 'describe_tool').length, 0),
        manual_steps: calls.filter(c => c.output.returned_tools.includes('describe_tool')).length,
        first_call_content_utf8_bytes: calls[0].content_utf8_bytes,
        summed_local_input_json_bytes: calls.reduce((n, c) => n + c.local_input_json_bytes, 0),
        summed_tool_result_bytes: calls.reduce((n, c) => n + c.content_utf8_bytes.tool_results, 0) }
    }),
    manual_reads: r.manual_reads, construction: r.construction, task_save: r.task_save, cad: r.cad, premature: r.premature,
  })
  return { report_version: 2, baseline_reference: 'Docs/archive/k2-runtime-baseline-2026-10-03.json',
    evidence_class: baseline.evidence_class, measurement_contract: baseline.measurement_contract,
    experiment: 'Only catalog how_to moves on demand; code descriptions and all domain schemas stay inline. Hosted callers remain inline. Manual reads use real session dispatch and the existing turn budget.',
    limitations: 'Scripted manual strategies: per_tool reads before each distinct tool; batch_all groups the same reads in one model step; selective groups construction save/check manuals and reads none for the Task. No autonomous model selection, real member, provider token/cache/cost/latency or retained context measurement. Summed local payload is not provider billed input. CAD specialists are unchanged.',
    domain_names_and_schemas_equal: true, baseline: summarize(baseline), candidates: candidates.map(summarize) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(process.argv[2] === '--compare' ? await runRuntimeComparison() : await runRuntimeAudit(process.argv[2]), null, 2))
}
