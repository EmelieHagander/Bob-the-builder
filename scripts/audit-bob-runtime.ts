/** Read-only, synthetic runtime audit. No network, credentials or real model.
 * Usage: node --import tsx scripts/audit-bob-runtime.ts [catalog-json | --seed]
 * Default: the dated public catalog snapshot accompanying this audit.
 * Optional catalog JSON must contain public tool metadata only, never project data.
 * This reports current mechanics; it is NOT a behavioural model evaluation.
 */
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { checkedToolSnapshot } from '../supabase/functions/_shared/project-tools/session.ts'
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
import { drawingSaved } from '../supabase/functions/_shared/project-delivery.ts'

const useSeed = process.argv[2] === '--seed'
const catalog = checkedToolSnapshot({ phase: null, tools: useSeed ? seed
  : JSON.parse(await readFile(process.argv[2] ?? new URL('./fixtures/bob-tool-catalog-2026-09-25.json', import.meta.url), 'utf8')) }).tools
const handoff={deliverable:'Synthetic shelf concept',requirements:[{id:'shape',requirement:'Keep the requested shelf dimensions',basis:'user_request',source_ref:null}],coordinates:{origin:null,positive_x:null,positive_y:null,positive_z:'up'},views:['front','top'],unresolved:['Site fit']}
const id = '50000000-0000-4000-8000-000000000001'
const stamp = '2026-09-25T00:00:00Z'
const response = (data: unknown, name?: string, args?: unknown): any => ({ success: true, data, model: 'controlled-fixture',
  responseId: 'synthetic-response', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  ...(name ? { toolCalls: [{ id: 'synthetic-call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : {}) })
const noIO = async (): Promise<any> => { throw new Error('Audit unexpectedly attempted external I/O') }
function lookup(budget = 32) {
  return createProjectLookup('synthetic', async (_p, q) => ({ error: null, data: { records: q.dataset === 'project'
    ? [{ id: 'synthetic', name: 'Synthetic audit project', phase: 'planning' }]
    : q.dataset === 'target' ? [{ id: 'synthetic', revision: 1, solution_id: id }] : [], related: [], truncated: false } }), 1000, budget)
}
function fixture(phase: string | null, message = 'Skapa en uppgift för att mäta öppningen.') {
  const receipts: any[] = []
  const writer = createProjectWriter('synthetic', message, async () => {
    const recordId = `synthetic-task-${receipts.length + 1}`
    const receipt = { projectId: 'synthetic', dataset: 'tasks', recordId, label: 'Synthetic task', operation: 'created', savedAt: stamp, record: { id: recordId } }
    receipts.push(receipt); return { data: receipt, error: null }
  }, async () => ({ data: receipts, error: null }), async () => ({ data: { generation: 1, receipts }, error: null }))
  const hasAccess = async () => true, deadline = Date.now() + 300000
  const base = { projectId: 'synthetic', userId: 'synthetic-user', hasAccess, deadline }
  const projectContext = createProjectContext({ adapters: [], hasAccess, sources: [] })
  const opts = { ...base, message, writer, lookup: lookup(), projectContext,
    context: { summary: '', throughSeq: 0, recent: [{ seq: 1, role: 'user', text: message, state: 'pending' }], history: { remaining: 4, search: noIO } },
    knowledgeReader: createKnowledgeReader(hasAccess),
    operationalReader: createOperationalReader('synthetic', noIO, hasAccess, []),
    recordReader: createRecordDetailReader(noIO, hasAccess),
    catalogReader: createMaterialCatalogReader('synthetic', noIO, hasAccess, []),
    imageTools: createProjectImageTools({ ...base, message, writer, generate: noIO, upload: noIO }),
    planAssistant: createPlanAssistant({ ...base, makeLookup: () => lookup(128), callModel: noIO }),
    cadAssistant: createCadAssistant({ ...base, makeLookup: () => lookup(40), callModel: noIO, render: noIO, readArtifact: noIO, available: true }),
    readToolPolicy: async () => ({ phase, tools: catalog }),
  }
  return { opts, receipts, session: () => createBobToolSession({ ...opts, readPolicy: opts.readToolPolicy } as any) }
}

const emit = console.log
// Runtime instrumentation contains synthetic data only; keep the report JSON parseable.
console.log = () => {}
console.warn = () => {}
const surfaces = []
for (const phase of [null, 'concept', 'design', 'planning', 'build', 'complete']) {
  const f = fixture(phase), tools = await f.session().prepare()
  const descriptions = tools.map(t => ({ name: t.function.name, bytes: Buffer.byteLength(JSON.stringify(t)) })).sort((a, b) => b.bytes - a.bytes)
  surfaces.push({ phase, offered: tools.length, domain_tools: tools.length - 2,
    system_chars: buildBobSystemMessage(tools).length, schema_bytes: Buffer.byteLength(JSON.stringify(tools)),
    cad_initially_offered: tools.some(t => t.function.name === 'design_project_cad'), largest: descriptions.slice(0, 5),
    names: tools.map(t => t.function.name) })
}
const discovery = []
for (const query of ['ritning', 'drawing', 'CAD', 'draw bed', 'ändra planen', 'edit plan', 'archive area']) {
  const s = fixture('planning').session(); await s.prepare()
  const result = await s.execute('list_tools', { query, after_name: null })
  discovery.push({ query, status: result.status, search: result.search, names: result.items.map((t: any) => t.name), next_cursor: result.next_cursor })
}
const premature = []
for (const [message,kind] of [['Skapa en uppgift för att mäta öppningen.','task'], ['Ändra planen och flytta uppgiften till rätt steg.','plan'], ['Ta fram och spara materiallistan.','material']]) {
  const f = fixture('planning', message); let calls = 0
  const result = await runProjectAnswer({ ...f.opts, callModel: async o => {
    calls++
    return o.schemaName ? response({goals:[{kind,description:message,count:1,record_id:null}],request_quote:message}) : response('Jag kan göra det i nästa svar.')
  } } as any)
  premature.push({ message, model_calls: calls, writes: f.receipts.length, ok: result.ok, ...(result.ok ? { partial: result.evidence.partial, answer: result.answer } : { error: result.error }) })
}
const f = fixture('planning'); let classificationCalls = 0
const classificationFailure = await runProjectAnswer({ ...f.opts, callModel: async o => { classificationCalls++; return o.schemaName ? { ...response(null), success: false, error: 'synthetic-classifier-failure' } : response('The informational answer remains available.') } } as any)

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
const candidate = { recipe, source_artifact_id: null, source_revision: null, part_ids: [], title: 'Synthetic shelf', description: 'Synthetic audit geometry',
  assumptions: 'No physical verification', target_revision: 1, measurements: [] }
const broken = structuredClone(candidate) as any; delete broken.recipe.definitions[0].y_mm
const cadCalls: any[] = []; let renders = 0
const cad = createCadAssistant({ projectId: 'synthetic', userId: 'synthetic-user', hasAccess: async () => true, makeLookup: () => lookup(40),
  deadline: Date.now() + 300000, available: true, readArtifact: noIO,
  render: async r => { renders++; const bounds = { min: [0, 0, 0], max: [600, 250, 18], size: [600, 250, 18] }
    return { recipe: r, manifest: { bounding_box_mm: bounds,
      instances: r.instances.map(i => ({ id: i.id, definition_id: i.definition_id, bounding_box_mm: bounds })) },
    files: { front: 'SYNTHETIC_SVG_BYTES', top: 'SYNTHETIC_SVG_BYTES' }, previews: {front:'SYNTHETIC_PNG_BYTES',top:'SYNTHETIC_TOP_PNG_BYTES'} } },
  callModel: async o => { if(o.schemaName==='bob_cad_review')return response({verdict:'pass',summary:'Synthetic review',requirements:[{id:'shape',status:'met',evidence:'Synthetic geometry'}],issues:[]});cadCalls.push(o); return cadCalls.length === 1 ? response(null, 'render_cad_candidate', broken)
    : cadCalls.length === 2 ? response(null, 'render_cad_candidate', candidate) : response('The synthetic candidate is ready.') },
})
const cadResult = await cad.consult({ handoff, brief: 'Draw a shelf concept.', area_id: null, component_id: null, step_id: null, artifact_id: null })
const cadReturns = cadCalls.flatMap(o => o.messages ?? []).filter(m => m.role === 'tool').map(m => JSON.parse(m.content))
assert.equal(renders, 1, 'Valid geometry must reach the synthetic transport once; invalid geometry must not.')

let fourthTools: string[] = [], researchCalls = 0
const researchLookup = lookup(40)
const research = createCadAssistant({ projectId: 'synthetic', userId: 'synthetic-user', hasAccess: async () => true,
  makeLookup: () => researchLookup, deadline: Date.now() + 300000, available: true, readArtifact: noIO, render: noIO,
  callModel: async o => { researchCalls++; if (researchCalls <= 3) return response(null, 'search_project_data', readInput)
    fourthTools = (o.tools ?? []).map(t => t.function.name)
    return response(null, 'report_cad_blocker', { reason: 'missing_constraint', explanation: 'Synthetic stopping condition for the audit.' }) },
})
await research.consult({ handoff, brief: 'Read four needed records before drawing.', area_id: null, component_id: null, step_id: null, artifact_id: null })

const w = fixture('planning'), writeStatuses: string[] = []
for (let i = 0; i < 9; i++) writeStatuses.push((await w.opts.writer.write('save_project_task', {
  record_id: null, area_id: 'synthetic-area', step_id: null, name: `Synthetic task ${i + 1}`, instructions: 'Synthetic work',
  expected_updated_at: null, request_quote: w.opts.message,
})).status)
assert.equal(writeStatuses.filter(s => s === 'saved').length, 9)

emit(JSON.stringify({ evidence_class: 'controlled runtime mechanics; model and I/O are synthetic',
  catalog_source: useSeed ? 'repository seed' : 'dated public metadata snapshot', active_catalog_tools: catalog.filter(r => r.active).length,
  surfaces, discovery, premature, classification_failure: { calls: classificationCalls, result: classificationFailure },
  reserved_image_grounding: { remaining: readProbe.remaining, project: groundingData.project.status, measurements: groundingData.measurements.status, provider_still_called: true },
  cad: { status: cadResult.status, calls: cadCalls.length, renders, returned_to_designer: cadReturns,
    generated_pixels_delivered: cadCalls.some(o => (o.messages ?? []).some((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === 'image_url'))),
    svg_bytes_delivered: JSON.stringify(cadCalls).includes('SYNTHETIC_SVG_BYTES'),
    research_tools_on_fourth_call: fourthTools, unused_lookup_calls: researchLookup.remaining },
  write_statuses_for_nine_tasks: writeStatuses,
  drawing_receipt_check_accepts_any_saved_drawing: drawingSaved([{ dataset: 'artifacts', revision: 1, record: { cad: true } }] as any,
    [{ operation: 'execute', name: 'save_cad_design', status: 'saved' }]),
}, null, 2))
