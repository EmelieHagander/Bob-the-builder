import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer, seedToolPolicy, type ModelCall } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter, type WritePayload, type WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { createCadAssistant } from '../supabase/functions/_shared/cad-assistant.ts'
import { parseDrawingIntent, drawingSaved, hasSavedDrawingReceipt } from '../supabase/functions/_shared/project-delivery.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import type { CadAssemblyRequest } from '../supabase/functions/_shared/cad-adapter.ts'

const message = 'Rita förvaringsskåpet nu. Välj en rimlig arbetsbredd.'
const id = '40000000-0000-4000-8000-000000000001'
const artifact = '40000000-0000-4000-8000-000000000002'
const time = '2026-09-25T10:00:00Z'
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const response = (data: string | null, name?: string, args?: unknown) => ({ success: true, data, model: 'fixture', responseId: 'resp', usage,
  ...(name ? { toolCalls: [{ id: 'call', type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] } : {}) })
const intent = (drawing: 'none' | 'create' | 'revise' = 'create', quote = message) => response(JSON.stringify({ drawing, description: drawing === 'none' ? '' : 'A concept drawing of the cabinet', request_quote: drawing === 'none' ? null : quote }))
const recipe: CadAssemblyRequest = { contract_version: 1, units: 'mm', assembly_id: 'cabinet',
  definitions: [{ id: 'side', primitive: 'box', x_mm: 18, y_mm: 360, z_mm: 840, material_ref: null }],
  instances: [{ id: 'cabinet.side', definition_id: 'side', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front', 'top'] }
const candidate = { recipe, source_artifact_id: null, source_revision: null, part_ids: [], title: 'Cabinet concept', description: 'Synthetic geometry fixture', assumptions: 'Working dimensions, not measured fit or strength.', target_revision: 1, measurements: [] }
const cadRequest = { brief: 'Draw the cabinet concept with explicit assumptions.', area_id: null, component_id: null, step_id: null, artifact_id: null }
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
  const run = (callModel: ModelCall, cadModel: ModelCall = async o => o.messages?.some(m => m.role === 'tool') ? response('Inspected.') : response(null, 'render_cad_candidate', candidate), extra = {}) =>
    runProjectAnswer({ projectId: 'A', userId: 'u', message, lookup: makeLookup(), writer, cadAssistant: createCadAssistant({ ...cadOptions, callModel: cadModel }),
      hasAccess: async () => true, callModel, ...extra })
  return { writer, writes, receipts, makeLookup, cadOptions, run, get renders() { return renders } }
}

test('a drawing order survives prose, missing target, prerequisite writes and an unsaved candidate in one turn', async () => {
  const f = fixture(false); let calls = 0, cadCalls = 0
  const result = await f.run(async o => {
    if (o.schemaName) return intent()
    calls++
    if (calls === 1) { assert.equal(o.messages!.at(-1)!.content, message, 'routing data must not displace the current user request'); return response('I can draw it next time.') }
    if (calls === 2) { assert.deepEqual(o.tool_choice, { type: 'function', function: { name: 'design_project_cad' } }); return response(null, 'design_project_cad', cadRequest) }
    if (calls === 3) {
      assert.equal(JSON.parse(String(o.messages![0].content)).status, 'prerequisite_required')
      assert(o.tools?.some(t => t.function.name === 'save_project_solution'))
      return response(null, 'search_project_data', { dataset: 'solutions', query: null, status: null, area_id: null, record_id: null })
    }
    if (calls === 4) return response(null, 'save_project_solution', { record_id: null, expected_revision: 0, area_id: null, title: 'Cabinet', description: 'A cabinet concept', assumptions: 'Working sizes', tradeoffs: '', measurements: [], change_note: 'Delegated design', request_quote: message })
    if (calls === 5) return response(null, 'select_project_target', { record_id: id, expected_revision: 0, solution_revision: 1, area_id: null, reason: 'Requested working concept', request_quote: message })
    if (calls === 6) return response(null, 'design_project_cad', cadRequest)
    if (calls === 7) return response('The design is ready; shall I save it?')
    if (calls === 8) { assert.deepEqual(o.tool_choice, { type: 'function', function: { name: 'save_cad_design' } }); return response(null, 'save_cad_design', { request_quote: message }) }
    assert.equal(JSON.parse(String(o.messages![0].content)).receipt.recordId, artifact)
    return response('The drawing is saved.')
  }, async o => {
    if (++cadCalls === 1) return response('I will render that next time.')
    if (cadCalls === 2) { assert.equal(o.tool_choice, 'required'); return response(null, 'render_cad_candidate', candidate) }
    return response('Inspected geometry.')
  })
  assert(result.ok); assert.equal(result.answer, 'The drawing is saved.'); assert.equal(result.evidence.partial, false)
  assert.deepEqual(f.writes.map(w => w.kind), ['solution', 'target', 'cad']); assert.equal(f.renders, 1)
  assert.equal(result.evidence.writes?.at(-1)?.recordId, artifact); assert.equal(calls, 9); assert.equal(cadCalls, 3)
})

test('saving Task instructions and promising a drawing cannot pass the drawing delivery check', async () => {
  const f = fixture(); let calls = 0
  const result = await f.run(async o => {
    if (o.schemaName) return intent()
    if (++calls === 1) return response(null, 'save_project_task', { record_id: null, area_id: 'area-a', step_id: null, name: 'Drawing instructions', instructions: 'Draft the concept', expected_updated_at: null, request_quote: message })
    return response('Drawing 1 is complete. I can make the actual file next time.')
  })
  assert(result.ok); assert.equal(f.writes.length, 1); assert.equal(f.renders, 0); assert.equal(calls, 5)
  assert.equal(result.evidence.partial, true); assert.match(result.answer, /Ritningen är inte klar/)
  assert.doesNotMatch(result.answer, /Drawing 1 is complete|next time/)
})

test('information-only and cancelled requests do not force CAD or create any write', async () => {
  for (const current of ['Vad betyder måttsatt ritning?', 'Avbryt ritningen. Förklara bara vad som saknas.']) {
    const f = fixture(); let calls = 0
    const result = await f.run(async o => {
      if (o.schemaName) { assert(String(o.messages!.at(-1)!.content).includes(current)); return intent('none') }
      calls++; assert.equal(o.tool_choice, undefined); assert(!o.tools?.some(t => t.function.name === 'design_project_cad'))
      return response('Requested explanation.')
    }, undefined, { message: current })
    assert(result.ok); assert.equal(calls, 1); assert.equal(f.renders, 0); assert.equal(f.writes.length, 0)
  }
})

test('current exact follow-up and five-message context reach intent routing without fabricated approval', async () => {
  const f = fixture(), current = 'Använd den smalare öppningen.'
  const recent = [{ role: 'user', text: 'Gör en ritning av skåpet.' }, { role: 'assistant', text: 'Vilken öppning ska jag använda?' }, { role: 'user', text: current }].map((m, i) => ({ ...m, seq: i + 1, state: 'completed' }))
  await f.run(async o => {
    if (o.schemaName) { for (const m of recent) assert(o.messages?.some(x => x.content === m.text)); return intent('revise', current) }
    return response('Not delivered.')
  }, undefined, { message: current, context: { recent, summary: 'Older context', throughSeq: 0, history: { remaining: 4 } } })
  assert.equal(f.writes.length, 0)
  assert.equal(parseDrawingIntent({ drawing: 'create', description: 'Cabinet', request_quote: 'Rewritten approval' }, current), null)
})

test('disabled catalog policy and unavailable CAD cannot be overridden by intent or forced tool selection', async () => {
  for (const disabled of [false, true]) {
    const f = fixture(true, false); let calls = 0
    const result = await f.run(async o => {
      if (o.schemaName) return intent()
      calls++
      if (!disabled && calls === 1) return response(null, 'design_project_cad', cadRequest)
      if (disabled) { assert(!o.tools?.some(t => t.function.name === 'design_project_cad')); assert.notDeepEqual(o.tool_choice, { type: 'function', function: { name: 'design_project_cad' } }) }
      return response('I made the drawing.')
    }, undefined, { readToolPolicy: async () => { const policy = await seedToolPolicy(); return { ...policy, tools: policy.tools.map(t => t.name === 'design_project_cad' && disabled ? { ...t, active: false } : t) } } })
    assert(result.ok); assert(result.evidence.partial); assert.match(result.answer, /Ritningen är inte klar/)
    assert.equal(f.renders, 0); assert.equal(f.writes.length, 0); assert(calls <= 4)
  }
})

test('an explicit indispensable CAD blocker ends honestly without consuming repeated rendering attempts', async () => {
  const f = fixture(); let calls = 0, cadCalls = 0
  const result = await f.run(async o => o.schemaName ? intent() : ++calls === 1 ? response(null, 'design_project_cad', cadRequest) : response('It is complete.'),
    async () => { cadCalls++; return response(null, 'report_cad_blocker', { reason: 'unsupported_geometry', explanation: 'The requested freeform surface is unsupported.' }) })
  assert(result.ok); assert.equal(result.evidence.partial, true); assert.equal(cadCalls, 1); assert.equal(calls, 2)
  assert.equal(f.renders, 0); assert.equal(f.writes.length, 0); assert.match(result.answer, /Ritningen är inte klar/)
  assert.match(result.answer, /freeform surface is unsupported/)
})

test('revocation after intent prevents any execution, and a closing deadline never forces another action', async () => {
  for (const mode of ['revoked', 'deadline']) {
    const f = fixture(); let allowed = true, calls = 0
    const result = await f.run(async o => {
      if (o.schemaName) { if (mode === 'revoked') allowed = false; return intent() }
      calls++; assert.equal(o.tools, undefined); return response('Not delivered.')
    }, undefined, { hasAccess: async () => allowed, ...(mode === 'deadline' ? { deadline: Date.now() + 30000 } : {}) })
    if (mode === 'revoked') { assert.deepEqual(result, { ok: false, error: 'project_denied' }); assert.equal(calls, 0) }
    else { assert(result.ok); assert(result.evidence.partial); assert.equal(calls, 1) }
    assert.equal(f.renders, 0); assert.equal(f.writes.length, 0)
  }
})

test('a worker yield replays intent and preparation, then renders and saves the drawing exactly once', async () => {
  const entries: JournalEntry[] = []; let now = 0, providerCalls = 0, renders = 0, writes = 0
  const resume = () => {
    const f = fixture(), journal = createBobJournal({ entries, save: async e => { entries.push(structuredClone(e)) } }, 20000, () => now)
    const callModel: ModelCall = o => journal.run('model', o, async () => {
      providerCalls++
      if (o.schemaName) { now = 15000; return intent() }
      if (o.functionName === 'cad-designer') return o.messages?.some(m => m.role === 'tool') ? response('Inspected.') : response(null, 'render_cad_candidate', candidate)
      if (providerCalls === 2) return response(null, 'design_project_cad', cadRequest)
      if (providerCalls === 5) return response(null, 'save_cad_design', { request_quote: message })
      return response('Saved.')
    }, 10000)
    const cadAssistant = createCadAssistant({ ...f.cadOptions, callModel, render: r => journal.run('cad:render', r, async () => { renders++; return f.cadOptions.render(r) }) })
    return runProjectAnswer({ projectId: 'A', userId: 'u', message, lookup: f.makeLookup(), writer: f.writer, hasAccess: async () => true, cadAssistant, callModel }).finally(() => { writes += f.writes.length })
  }
  await assert.rejects(resume(), e => e instanceof BobContinuation); now = 0
  const result = await resume()
  assert(result.ok); assert.equal(result.evidence.partial, false); assert.equal(providerCalls, 6); assert.equal(renders, 1); assert.equal(writes, 1)
})

test('a yield after CAD saving replays the original incomplete branch despite newly recovered receipts', async () => {
  const entries: JournalEntry[] = [], persisted: WriteReadback[] = []
  let now = 0, providerCalls = 0, renders = 0, writes = 0
  const resume = async () => {
    const f = fixture(), journal = createBobJournal({ entries, save: async e => { entries.push(structuredClone(e)) } }, 20000, () => now)
    const writer = createProjectWriter('A', message, p => journal.run('write', p, async () => {
      writes++; now = 15000
      const receipt: WriteReadback = { projectId: 'A', dataset: 'artifacts', recordId: artifact, revision: 1, areaId: null, label: 'Cabinet concept', operation: 'created', savedAt: time, record: { id: artifact, revision: 1, area_id: null, cad: true } }
      persisted.push(receipt); return { data: receipt, error: null }
    }), async () => ({ data: persisted, error: null }), async () => ({ data: { generation: 2, receipts: persisted }, error: null }))
    await writer.recover()
    const callModel: ModelCall = o => journal.run('model', o, async () => {
      providerCalls++
      if (o.schemaName) return intent()
      if (providerCalls === 2) return response('I can draw it next time.')
      if (providerCalls === 3) return response(null, 'design_project_cad', cadRequest)
      if (providerCalls === 4) return response(null, 'render_cad_candidate', candidate)
      if (providerCalls === 5) return response('Inspected.')
      if (providerCalls === 6) return response('Shall I save it?')
      if (providerCalls === 7) return response(null, 'save_cad_design', { request_quote: message })
      return response('The drawing is saved.')
    }, 10000)
    const cadAssistant = createCadAssistant({ ...f.cadOptions, callModel, render: r => journal.run('cad:render', r, async () => { renders++; return f.cadOptions.render(r) }) })
    return runProjectAnswer({ projectId: 'A', userId: 'u', message, lookup: f.makeLookup(), writer, hasAccess: async () => true, cadAssistant, callModel,
      initialDrawingDelivery: () => journal.run('delivery:initial', {}, async () => hasSavedDrawingReceipt(writer.receipts)) })
  }
  await assert.rejects(resume(), e => e instanceof BobContinuation && e.kind === 'yield')
  assert.equal(writes, 1); assert.equal(persisted.length, 1); now = 0
  const result = await resume()
  assert(result.ok); assert.equal(result.answer, 'The drawing is saved.'); assert.equal(result.evidence.partial, false)
  assert.equal(providerCalls, 8); assert.equal(renders, 1); assert.equal(writes, 1)
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

test('settling and committing a private turn preserves an incomplete drawing result', async () => {
  const f = fixture(true, false); let committed: unknown, calls = 0
  const result = await runClaimedProjectTurn({ projectId: 'A', userId: 'u', message, generation: 1, resume: true,
    lookup: f.makeLookup(), writer: f.writer, hasAccess: async () => true, fail: async () => { throw new Error('not a transport failure') },
    commit: async value => { committed = value }, cadAssistant: createCadAssistant({ ...f.cadOptions, callModel: async () => { throw new Error('unavailable engine must not call a model') } }),
    callModel: async o => o.schemaName ? intent() : ++calls === 1 ? response(null, 'design_project_cad', cadRequest) : response('The drawing is ready.') })
  assert(result.ok); assert.equal(result.evidence.partial, true); assert.match(result.answer, /Ritningen är inte klar/)
  assert.deepEqual(committed, result); assert.equal(f.writes.length, 0)
})

test('a recovered drawing is not generated twice and an exhausted writer cannot be forced to act', async () => {
  for (const mode of ['recovered', 'exhausted']) {
    const f = fixture(); let calls = 0
    if (mode === 'recovered') await f.writer.commit({ kind: 'cad', record_id: null, expected_updated_at: null, expected_revision: 0, request_quote: message, data: {} })
    else for (let i = 0; i < 8; i++) await f.writer.commit(null)
    const result = await f.run(async o => { if (o.schemaName) return intent(); calls++; assert.equal(o.tool_choice, undefined); return response('Turn result.') })
    assert(result.ok); assert.equal(calls, 1); assert.equal(f.renders, 0)
    assert.equal(result.evidence.partial, mode === 'exhausted'); assert.equal(f.writes.length, mode === 'recovered' ? 1 : 0)
  }
})
