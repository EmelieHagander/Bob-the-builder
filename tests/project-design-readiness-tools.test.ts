import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectWriter, parseProjectWrite } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { parameterPlan } from './support/cad-parameter-fixture.ts'

const project = 'p_design_advice', image = '11111111-1111-4111-8111-111111111111'
const solution = '22222222-2222-4222-8222-222222222222', material = '33333333-3333-4333-8333-333333333333'
const message = 'Develop the chosen cabinet; choose ordinary technical details.'
function intent() {
  return { version: 1, purpose: 'construction', summary: 'A cabinet with the agreed shelf support.',
    references: [{ image_id: image, role: 'appearance', note: 'Preserve the front expression, not inferred dimensions.' }],
    features: [{ id: 'support', description: 'The shelf support remains part of the selected solution.', basis: 'user_request', source_ref: message }],
    choices: [{ id: 'shelf_support', question: 'How should the shelf be supported?', alternatives: ['Fixed cleats', 'Adjustable supports'],
      recommendation: 'Fixed cleats', basis: 'The supplied use requires a fixed shelf; no adjustment is requested.',
      consequences: 'The support height is fixed and controls shelf placement.', geometry_dependency: true,
      status: 'resolved', selected_direction: 'Fixed cleats', decision_authority: 'bob', decision_basis: message, deferral: null }],
    alignment: { status: 'aligned', basis: 'Prior selected use is preserved; ordinary technical choices are delegated.' } }
}
function readiness() {
  const pin = { version: 1, project_id: project, area_id: null, target_revision: 4, solution_id: solution, solution_revision: 2, purpose: 'construction' }
  const { version: _version, ...scope } = pin
  return { status: 'ready', ...scope, design_intent: intent(), issues: [], deferred_choice_ids: [], pin }
}
function input() {
  const recipe: any = { contract_version: 1, units: 'mm', assembly_id: 'cabinet_support',
    definitions: [{ id: 'cleat', primitive: 'box', material_ref: null, x_mm: 18, y_mm: 30, z_mm: 300 }],
    instances: [{ id: 'cleat_left', definition_id: 'cleat', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front'] }
  return { key: 'support', record_id: null, expected_revision: 0, title: 'Cabinet support', description: 'A construction checkpoint, not fabrication approval.',
    area_id: null, target_revision: 4, change_note: 'Supported choice', recipe, parameter_plan: parameterPlan(recipe),
    materials: [{ definition_id: 'cleat', material_id: material, material_revision: 1, part_id: null, part_revision: null }],
    joints: [], open_questions: ['Hardware capacity remains to be checked.'], request_quote: message }
}

test('solution writes preserve omitted legacy intent/image and distinguish deliberate replacement or clearing', () => {
  const old = { record_id: solution, expected_revision: 1, area_id: null, title: 'Cabinet', description: 'Existing cabinet', assumptions: '', tradeoffs: '', measurements: [], change_note: 'Expert advice', request_quote: message }
  const omitted = parseProjectWrite('save_project_solution', old, project, message)!
  assert.equal(omitted.kind, 'solution')
  assert.equal(Object.hasOwn(omitted.data, 'source_media_id'), false)
  assert.equal(Object.hasOwn(omitted.data, 'design_intent'), false)
  const replaced = parseProjectWrite('save_project_solution', { ...old, source_media_id: image, design_intent: intent() }, project, message)!
  assert.equal(replaced.data.source_media_id, image)
  assert.deepEqual(replaced.data.design_intent, intent())
  const cleared = parseProjectWrite('save_project_solution', { ...old, source_media_id: null, design_intent: null }, project, message)!
  assert.equal(cleared.data.source_media_id, null)
  assert.equal(cleared.data.design_intent, null)
  assert.equal(parseProjectWrite('save_project_solution', { ...old, source_media_id: 'an image title', design_intent: intent() }, project, message), null)
  assert.equal(parseProjectWrite('save_project_solution', { ...old, source_media_id: image, design_intent: { ...intent(), approved_by_owner: true } }, project, message), null)
})

test('oversize solution or target readback rejection returns a repairable compactness instruction without claiming a save', async () => {
  const writes: [string, Record<string, unknown>][] = [
    ['save_project_solution', { record_id: solution, expected_revision: 1, area_id: null, title: 'Cabinet', description: 'Existing cabinet',
      assumptions: '', tradeoffs: '', source_media_id: image, design_intent: intent(), measurements: [], change_note: 'Expert advice', request_quote: message }],
    ['select_project_target', { record_id: solution, expected_revision: 4, solution_revision: 2, area_id: null, reason: 'Use the shared direction', request_quote: message }],
  ]
  for (const [tool, args] of writes) {
    const writer = createProjectWriter(project, message,
      async () => ({ data: null, error: { code: '22023', message: 'compact_design_intent_required: private database detail' } }),
      async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
    const result = await writer.write(tool, args)
    assert.equal(result.status, 'invalid')
    assert.match(result.message ?? '', /shorten explanations while preserving actual choices, references and required features/)
    assert.doesNotMatch(JSON.stringify(result), /private database detail/)
    assert.equal(result.receipt, undefined); assert.equal(writer.receipts.length, 0)
    assert.equal(writer.uncertain, false); assert.equal(writer.needsRepair, true)
  }
})

test('an unresolved geometry choice returns advice and exact choice IDs before source reads or construction writes', async () => {
  const pending: any = readiness()
  pending.status = 'needs_data'; pending.pin = null
  const choice = pending.design_intent.choices[0]
  choice.status = 'open'; choice.selected_direction = null; choice.decision_basis = ''
  pending.issues = [{ code: 'choice_open', choice_id: choice.id, message: 'Resolve shelf support before fixing its geometry.' }]
  let sourceReads = 0, writes = 0, requested: unknown[] = []
  const tools = createConstructionTools({ projectId: project, message, hasAccess: async () => true, read: async () => null,
    readDesignReadiness: async (...args) => { requested = args; return pending },
    readSources: async () => { sourceReads++; return { project: new Map(), physical: new Map() } },
    writer: { commit: async () => { writes++; return { status: 'saved' } } } as any })
  const result = await tools.execute('save_construction_draft', input())
  assert.equal(result.status, 'needs_data')
  assert.deepEqual(requested, [4, 'construction', null])
  assert.equal(result.readiness.design_intent.choices[0].recommendation, 'Fixed cleats')
  assert.equal(result.issues[0].choice_id, 'shelf_support')
  assert.match(result.message, /investigate.*recommend.*existing mandate/i)
  assert.equal(sourceReads, 0); assert.equal(writes, 0)
})

test('a supported delegated technical choice proceeds without a second owner approval or extra construction pin fields', async () => {
  let sourceReads = 0, persisted: any
  const tools = createConstructionTools({ projectId: project, message, hasAccess: async () => true, read: async () => null,
    readDesignReadiness: async () => readiness(),
    readSources: async () => { sourceReads++; return { project: new Map(), physical: new Map() } },
    writer: { commit: async (payload: unknown) => { persisted = payload; return { status: 'saved' } } } as any })
  assert.equal((await tools.execute('save_construction_draft', input())).status, 'saved')
  assert.equal(sourceReads, 1)
  assert.equal(persisted.data.target_revision, 4)
  assert.equal(persisted.data.parameters.coverage, 'complete')
  assert.equal(Object.hasOwn(persisted.data, 'design_intent'), false, 'SQL derives the immutable solution pin from the exact target')
})

test('missing, malformed, wrong-scope or lost-access readiness cannot compile or save a construction', async () => {
  for (const outcome of [undefined, { ...readiness(), project_id: 'another_project' }, { ...readiness(), area_id: 'another_area', pin: { ...readiness().pin, area_id: 'another_area' } }, { ...readiness(), target_revision: 3 },
    { ...readiness(), purpose: 'illustration' }, { ...readiness(), pin: null }]) {
    let sourceReads = 0, writes = 0
    const tools = createConstructionTools({ projectId: project, message, hasAccess: async () => true, read: async () => null,
      ...(outcome ? { readDesignReadiness: async () => outcome } : {}),
      readSources: async () => { sourceReads++; return { project: new Map(), physical: new Map() } },
      writer: { commit: async () => { writes++; return { status: 'saved' } } } as any })
    assert.equal((await tools.execute('save_construction_draft', input())).status, 'unavailable')
    assert.equal(sourceReads, 0); assert.equal(writes, 0)
  }
  let allowed = true, sourceReads = 0, writes = 0
  const revoked = createConstructionTools({ projectId: project, message, hasAccess: async () => allowed, read: async () => null,
    readDesignReadiness: async () => { allowed = false; return readiness() },
    readSources: async () => { sourceReads++; return { project: new Map(), physical: new Map() } },
    writer: { commit: async () => { writes++; return { status: 'saved' } } } as any })
  assert.equal((await revoked.execute('save_construction_draft', input())).status, 'denied')
  assert.equal(sourceReads, 0); assert.equal(writes, 0)
})
