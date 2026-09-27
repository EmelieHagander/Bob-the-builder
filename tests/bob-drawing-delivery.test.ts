import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer, seedToolPolicy, type ModelCall } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter, type WritePayload, type WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { createCadAssistant, handoff } from './support/cad-review-fixture.ts'
import { drawingSaved } from '../supabase/functions/_shared/project-delivery.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import type { CadAssemblyRequest } from '../supabase/functions/_shared/cad-adapter.ts'

/** Bob chooses his own tools. The server offers the whole toolbox, never forces a
 * tool, never replaces Bob's reply, and points out only facts it knows. */
const message = 'Rita förvaringsskåpet nu. Välj en rimlig arbetsbredd.'
const id = '40000000-0000-4000-8000-000000000001'
const artifact = '40000000-0000-4000-8000-000000000002'
const time = '2026-09-25T10:00:00Z'
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
type Call = { name: string; args: unknown }
const response = (data: string | null, ...calls: Call[]) => ({ success: true, data, model: 'fixture', responseId: 'resp', usage,
  ...(calls.length ? { toolCalls: calls.map((c, i) => ({ id: 'call' + i, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) })
const call = (name: string, args: unknown): Call => ({ name, args })
const recipe: CadAssemblyRequest = { contract_version: 1, units: 'mm', assembly_id: 'cabinet',
  definitions: [{ id: 'side', primitive: 'box', x_mm: 18, y_mm: 360, z_mm: 840, material_ref: null }],
  instances: [{ id: 'cabinet.side', definition_id: 'side', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front', 'top'] }
const candidate = { recipe, source_artifact_id: null, source_revision: null, part_ids: [], title: 'Cabinet concept', description: 'Synthetic geometry fixture', assumptions: 'Working dimensions, not measured fit or strength.', target_revision: 1, measurements: [] }
const cadRequest = { handoff, brief: 'Draw the cabinet concept with explicit assumptions.', area_id: null, component_id: null, step_id: null, artifact_id: null }
const note = (o: Parameters<ModelCall>[0]) => o.messages?.find(m => m.role === 'user' && String(m.content).startsWith('[Server note'))
function fixture(selected = true, available = true) {
  let target = selected, renders = 0
  const writes: WritePayload[] = [], receipts: WriteReadback[] = []
  const makeLookup = () => createProjectLookup('A', async (_p, q) => ({ data: {
    records: q.dataset === 'project' ? [{ id: 'A', name: 'Synthetic cabinet' }] : q.dataset === 'target' && target ? [{ id: 'A', revision: 1, solution_id: id }] : [],
    related: [], truncated: false }, error: null }), 1000, 40)
  const writer = createProjectWriter('A', message, async p => {
    writes.push(structuredClone(p)); if (p.kind === 'target') target = true
    const receipt: WriteReadback = { projectId: 'A', dataset: p.kind === 'cad' ? 'artifacts' : p.kind === 'solution' ? 'solutions' : p.kind === 'target' ? 'target' : 'tasks',
      recordId: p.kind === 'cad' ? artifact : id, revision: 1, areaId: null, label: p.kind, operation: 'created', savedAt: time,
      record: { id: p.kind === 'cad' ? artifact : id, revision: 1, area_id: null, ...(p.kind === 'cad' ? { cad: true } : {}) } }
    receipts.push(receipt); return { data: receipt, error: null }
  }, async () => ({ data: receipts, error: null }), async () => ({ data: { generation: 2, receipts }, error: null }))
  const cadOptions = { projectId: 'A', userId: 'u', hasAccess: async () => true, makeLookup, deadline: Date.now() + 300000, available,
    readArtifact: async () => null, render: async (r: CadAssemblyRequest) => { renders++; return { recipe: r, manifest: { bounding_box_mm: { size: [18, 360, 840] }, instances: r.instances }, files: { front: 'Zml4dHVyZQ==' } } } }
  const designer: ModelCall = async o => o.messages?.some(m => m.role === 'tool') ? response('Inspected.') : response(null, call('render_cad_candidate', candidate))
  const run = (callModel: ModelCall, cadModel: ModelCall = designer, extra = {}) =>
    runProjectAnswer({ projectId: 'A', userId: 'u', message, lookup: makeLookup(), writer, cadAssistant: createCadAssistant({ ...cadOptions, callModel: cadModel }),
      hasAccess: async () => true, callModel, ...extra })
  return { writer, writes, receipts, makeLookup, cadOptions, designer, run, get renders() { return renders } }
}

test('Bob runs prerequisite writes, design, review and save in one turn by his own choice', async () => {
  const f = fixture(false); let calls = 0
  const result = await f.run(async o => {
    assert.equal(o.schemaName, undefined, 'no routing or intent classifier call'); assert.equal(o.tool_choice, undefined, 'nothing is forced')
    calls++
    if (calls === 1) {
      for (const name of ['design_project_cad', 'save_project_solution', 'select_project_target', 'save_project_task', 'search_project_data']) assert(o.tools?.some(t => t.function.name === name), name + ' is on the bench from the start')
      assert(!o.tools?.some(t => t.function.name === 'save_cad_design'), 'the save tool waits for a reviewed candidate')
      assert.match(o.systemMessage!, /save_cad_design \(appears when design_project_cad returns a reviewed candidate\)/)
      assert.equal(o.messages!.at(-1)!.content, message)
      return response(null, call('design_project_cad', cadRequest))
    }
    if (calls === 2) {
      assert.equal(JSON.parse(String(o.messages![0].content)).status, 'prerequisite_required')
      return response(null, call('save_project_solution', { record_id: null, expected_revision: 0, area_id: null, title: 'Cabinet', description: 'A cabinet concept', assumptions: 'Working sizes', tradeoffs: '', measurements: [], change_note: 'Delegated design', request_quote: message }))
    }
    if (calls === 3) return response(null, call('select_project_target', { record_id: id, expected_revision: 0, solution_revision: 1, area_id: null, reason: 'Requested working concept', request_quote: message }))
    if (calls === 4) return response(null, call('design_project_cad', cadRequest))
    if (calls === 5) { assert.equal(JSON.parse(String(o.messages![0].content)).status, 'ready'); assert(o.tools?.some(t => t.function.name === 'save_cad_design')); return response(null, call('save_cad_design', { request_quote: message })) }
    assert.equal(JSON.parse(String(o.messages![0].content)).receipt.recordId, artifact)
    return response('Ritningen är sparad: skåpet med 18 mm sidor, arbetsbredd enligt antagandet.')
  })
  assert(result.ok); assert.equal(result.answer, 'Ritningen är sparad: skåpet med 18 mm sidor, arbetsbredd enligt antagandet.')
  assert.equal(result.evidence.partial, false)
  assert.deepEqual(f.writes.map(w => w.kind), ['solution', 'target', 'cad']); assert.equal(f.renders, 1); assert.equal(calls, 6)
})

test("Bob's reply is kept when a reviewed candidate stays unsaved: one factual note, no forcing", async () => {
  const f = fixture(); let calls = 0
  const result = await f.run(async o => {
    calls++; assert.equal(o.tool_choice, undefined)
    if (calls === 1) return response(null, call('design_project_cad', cadRequest))
    if (calls === 2) return response('Konceptet är klart. Vill du ändra bredden innan jag sparar?')
    const server = note(o)
    assert(server, 'the check is a user-role server note (system-role messages never reach the provider)')
    assert.match(String(server!.content), /reviewed drawing candidate .* not saved \(save_cad_design\)/)
    assert(o.tools?.some(t => t.function.name === 'save_cad_design'), 'the tool is available, not forced')
    return response('Konceptet är klart men osparat. Säg till om bredden, så sparar jag.')
  })
  assert(result.ok); assert.equal(calls, 3, 'exactly one check')
  assert.equal(result.answer, 'Konceptet är klart men osparat. Säg till om bredden, så sparar jag.', 'the reply is Bob\'s own words')
  assert.doesNotMatch(result.answer, /⚠/)
  assert.equal(result.evidence.partial, true, 'an unsaved prepared result keeps the evidence partial')
  assert.equal(f.writes.length, 0)
})

test('a tool that becomes available mid-batch runs from the next step, not retroactively', async () => {
  const f = fixture(); let calls = 0
  const result = await f.run(async o => {
    calls++
    if (calls === 1) return response(null, call('design_project_cad', cadRequest), call('save_cad_design', { request_quote: message }))
    if (calls === 2) {
      assert.deepEqual(o.messages!.map(m => JSON.parse(String(m.content)).status), ['ready', 'not_offered'])
      return response(null, call('save_cad_design', { request_quote: message }))
    }
    return response('Sparad.')
  })
  assert(result.ok); assert.equal(result.answer, 'Sparad.'); assert.deepEqual(f.writes.map(w => w.kind), ['cad'])
})

test('information-only requests use one call and change nothing', async () => {
  for (const current of ['Vad betyder måttsatt ritning?', 'Avbryt ritningen. Förklara bara vad som saknas.']) {
    const f = fixture(); let calls = 0
    const result = await f.run(async o => { calls++; assert.equal(o.tool_choice, undefined); return response('Förklaring.') }, undefined, { message: current })
    assert(result.ok); assert.equal(calls, 1); assert.equal(f.renders, 0); assert.equal(f.writes.length, 0)
  }
})

test('disabled catalog policy and an unavailable CAD engine are respected and Bob explains them himself', async () => {
  for (const disabled of [false, true]) {
    const f = fixture(true, false); let calls = 0
    const result = await f.run(async o => {
      calls++
      if (disabled) assert(!o.tools?.some(t => t.function.name === 'design_project_cad'), 'a disabled row never reaches the bench')
      if (!disabled && calls === 1) return response(null, call('design_project_cad', cadRequest))
      if (!disabled) assert.equal(JSON.parse(String(o.messages![0].content)).status, 'unavailable')
      return response('Ritverktyget är inte tillgängligt just nu; jag har sparat inget.')
    }, undefined, { readToolPolicy: async () => { const policy = await seedToolPolicy(); return { ...policy, tools: policy.tools.map(t => t.name === 'design_project_cad' && disabled ? { ...t, active: false } : t) } } })
    assert(result.ok); assert.equal(result.answer, 'Ritverktyget är inte tillgängligt just nu; jag har sparat inget.')
    assert.equal(f.renders, 0); assert.equal(f.writes.length, 0); assert.equal(calls, disabled ? 1 : 2)
  }
})

test('an explicit indispensable CAD blocker returns to Bob without repeated rendering attempts', async () => {
  const f = fixture(); let calls = 0, cadCalls = 0
  const result = await f.run(async o => {
    if (++calls === 1) return response(null, call('design_project_cad', cadRequest))
    assert.equal(JSON.parse(String(o.messages![0].content)).status, 'blocked')
    return response('Den fria formen stöds inte av ritmotorn. Välj raka skivor, så ritar jag direkt.')
  }, async () => { cadCalls++; return response(null, call('report_cad_blocker', { reason: 'unsupported_geometry', explanation: 'The requested freeform surface is unsupported.' })) })
  assert(result.ok); assert.equal(cadCalls, 1); assert.equal(calls, 2); assert.equal(f.renders, 0); assert.equal(f.writes.length, 0)
  assert.match(result.answer, /fria formen/)
})

test('revocation stops the turn, and a closing deadline gives a text-only step', async () => {
  for (const mode of ['revoked', 'deadline']) {
    const f = fixture(); let allowed = true, calls = 0
    const result = await f.run(async o => {
      calls++
      if (mode === 'revoked') { allowed = false; return response(null, call('design_project_cad', cadRequest)) }
      assert.equal(o.tools, undefined); assert.match(o.systemMessage!, /bench is closed/)
      return response('Hinner inte rita i den här vändan.')
    }, undefined, { hasAccess: async () => allowed, ...(mode === 'deadline' ? { deadline: Date.now() + 30000 } : {}) })
    if (mode === 'revoked') { assert.deepEqual(result, { ok: false, error: 'project_denied' }); assert.equal(f.renders, 0) }
    else { assert(result.ok); assert.equal(result.answer, 'Hinner inte rita i den här vändan.'); assert.equal(calls, 1) }
    assert.equal(f.writes.length, 0)
  }
})

test('a worker yield replays the design and saves the drawing exactly once', async () => {
  const entries: JournalEntry[] = []; let now = 0, providerCalls = 0, renders = 0, writes = 0
  const resume = () => {
    const f = fixture(), journal = createBobJournal({ entries, save: async e => { entries.push(structuredClone(e)) } }, 20000, () => now)
    const callModel: ModelCall = o => journal.run('model', o, async () => {
      providerCalls++
      if (o.functionName === 'cad-designer') return o.messages?.some(m => m.role === 'tool') ? response('Inspected.') : response(null, call('render_cad_candidate', candidate))
      const last = o.messages!.at(-1)!
      if (last.role !== 'tool') { now = 15000; return response(null, call('design_project_cad', cadRequest)) }
      if (JSON.parse(String(last.content)).status === 'ready') return response(null, call('save_cad_design', { request_quote: message }))
      return response('Sparad.')
    }, 10000)
    const cadAssistant = createCadAssistant({ ...f.cadOptions, callModel, render: r => journal.run('cad:render', r, async () => { renders++; return f.cadOptions.render(r) }) })
    return runProjectAnswer({ projectId: 'A', userId: 'u', message, lookup: f.makeLookup(), writer: f.writer, hasAccess: async () => true, cadAssistant, callModel }).finally(() => { writes += f.writes.length })
  }
  await assert.rejects(resume(), e => e instanceof BobContinuation); now = 0
  const result = await resume()
  assert(result.ok); assert.equal(result.answer, 'Sparad.'); assert.equal(result.evidence.partial, false)
  assert.equal(providerCalls, 5, 'each provider call runs once across the yield'); assert.equal(renders, 1); assert.equal(writes, 1)
})

test('a rendering result or unrelated Artifact link alone is not a saved drawing', () => {
  const f = fixture()
  assert.equal(drawingSaved([], [{ operation: 'execute', name: 'design_project_cad', status: 'ready' }]), false)
  f.receipts.push({ projectId: 'A', dataset: 'artifacts', recordId: artifact, revision: 1, areaId: null, label: 'Linked drawing', operation: 'updated', savedAt: time, record: { id: artifact } })
  assert.equal(drawingSaved(f.receipts, [{ operation: 'execute', name: 'link_project_drawing', status: 'saved' }]), false)
  f.receipts[0].record.cad = true
  assert.equal(drawingSaved(f.receipts, []), false, 'later recovered receipts must not change an earlier replay branch')
  assert.equal(drawingSaved(f.receipts, [], true), true, 'initially recovered geometry must prevent duplicate generation')
})

test("settling and committing a private turn keeps Bob's own account of an unavailable engine", async () => {
  const f = fixture(true, false); let committed: unknown, calls = 0
  const result = await runClaimedProjectTurn({ projectId: 'A', userId: 'u', message, generation: 1, resume: true,
    lookup: f.makeLookup(), writer: f.writer, hasAccess: async () => true, fail: async () => { throw new Error('not a transport failure') },
    commit: async value => { committed = value }, cadAssistant: createCadAssistant({ ...f.cadOptions, callModel: async () => { throw new Error('unavailable engine must not call a model') } }),
    callModel: async () => ++calls === 1 ? response(null, call('design_project_cad', cadRequest)) : response('Ritmotorn svarar inte; inget sparades.') })
  assert(result.ok); assert.equal(result.answer, 'Ritmotorn svarar inte; inget sparades.')
  assert.deepEqual(committed, result); assert.equal(f.writes.length, 0)
})

test('an exhausted writer takes write tools off the bench while reading stays possible', async () => {
  const f = fixture(); let calls = 0
  for (let i = 0; i < 32; i++) await f.writer.commit(null)
  const result = await f.run(async o => {
    calls++
    assert(!o.tools?.some(t => t.function.name === 'save_project_task'))
    assert(o.tools?.some(t => t.function.name === 'search_project_data'))
    assert.match(o.systemMessage!, /save_project_task \(used up this turn\)/)
    return response('Skrivbudgeten är slut för den här vändan.')
  })
  assert(result.ok); assert.equal(calls, 1); assert.equal(f.renders, 0)
})
