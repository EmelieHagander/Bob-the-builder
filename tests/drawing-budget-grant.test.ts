import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadAssistant } from './support/cad-parameter-fixture.ts'
import { createDrawingRequestStore } from '../supabase/functions/_shared/drawing-request-store.ts'
import type { DrawingRequest, DrawingRequestStore } from '../supabase/functions/_shared/cad-intake.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { budgetResumeAction, budgetStopMessage } from '../supabase/functions/_shared/bob-budget-stop.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'

const id = '30000000-0000-4000-8000-000000000191'
const turn = '30000000-0000-4000-8000-000000000192'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const budget = (spent: number, revision = 1) => ({ legacy_untracked: false, revision, call_limit: 24, calls: 3, usd_limit: 1, spent_usd: spent })

test('store grant: only an exhausted budget is granted, with one stable grant per turn and revision', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  let spent = 1.15, grantError: string | null = null
  const store = createDrawingRequestStore({ projectId: 'A', binding: { p_thread: 't', p_turn: turn, p_generation: 1 }, newId: async () => id, privateCall: async () => null,
    caller: async (name, args) => {
      calls.push({ name, args })
      if (name === 'drawing_request_work') return { budget: budget(spent) }
      if (grantError) throw new Error(grantError)
      return { revision: 2 }
    } })
  spent = 0.4
  assert.deepEqual(await store.grant!(id), { status: 'budget_remaining', budget_revision: 1 })
  assert.deepEqual(calls.map(c => c.name), ['drawing_request_work'], 'remaining budget never calls the grant')
  spent = 1.15
  const first = await store.grant!(id)
  assert.deepEqual(first, { status: 'granted', budget_revision: 2, added: { usd: 1, calls: 24 } })
  const grant = calls.at(-1)!
  assert.equal(grant.name, 'grant_drawing_budget'); assert.equal(grant.args.p_expected, 1); assert.equal(grant.args.p_project, 'A')
  assert.match(String(grant.args.p_grant), uuid)
  await store.grant!(id)
  assert.equal(calls.at(-1)!.args.p_grant, grant.args.p_grant, 'the same turn reuses the same grant identity')
  const other = createDrawingRequestStore({ projectId: 'A', binding: { p_turn: '30000000-0000-4000-8000-000000000193' }, newId: async () => id, privateCall: async () => null, caller: async (name) => name === 'drawing_request_work' ? { budget: budget(spent) } : { revision: 2 } })
  await other.grant!(id)
  grantError = 'budget_outcome_unknown'
  assert.deepEqual(await store.grant!(id), { status: 'not_granted', reason: 'budget_outcome_unknown', budget_revision: 1 })
  grantError = 'drawing_request_unavailable'
  await assert.rejects(store.grant!(id), /drawing_request_unavailable/)
  assert.deepEqual(await store.grant!('30000000-0000-4000-8000-000000000194').catch(e => e.message), 'drawing_request_unavailable')
})

test('store grant: an untracked or missing budget is reported, never invented', async () => {
  const store = createDrawingRequestStore({ projectId: 'A', binding: {}, newId: async () => id, privateCall: async () => null, caller: async () => ({ budget: { ...budget(2), legacy_untracked: true } }) })
  assert.deepEqual(await store.grant!(id), { status: 'unavailable', reason: 'budget_unavailable' })
})

const recipe = { contract_version: 1 as const, units: 'mm' as const, assembly_id: 'p0-grant',
  definitions: [{ id: 'panel', primitive: 'box' as const, material_ref: null, x_mm: 600, y_mm: 300, z_mm: 18 }],
  instances: [{ id: 'panel', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front' as const, 'top' as const] }
const metadata = { purpose: 'project', title: 'Concept', description: 'Synthetic grant test', assumptions: 'Site fit unverified', target_revision: 1, measurements: [] }
const reply = (name?: string, args: unknown = {}) => ({ success: true, data: null, responseId: 'response', model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  ...(name ? { toolCalls: [{ id: 'call', type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] } : {}) })
const assessment = { checks: [{ id: 'shape', status: 'known', blocking: false, source_refs: ['requirement:shape'], action: 'none', detail: 'Concept dimensions supplied in the request.' }], additional_needs: [] }
const stoppedOutcome = { status: 'unavailable', stage: 'intake', saved: false, reason: 'turn_budget_exhausted',
  budget_stop: { scope: 'drawing_request', reasons: ['usd_limit'], calls: 9, call_limit: 24, spent_usd: 1.15, usd_limit: 1 } }

function fixture(stopped: Record<string, any> = stoppedOutcome) {
  const brief = { request_id: id, handoff, brief: 'Draw this concept.', area_id: null, component_id: null, step_id: 'work', artifact_id: null }
  let row: DrawingRequest = { id, revision: 3, status: 'retrieval_failed',
    payload: { brief, owner_request: 'Draw this concept.', reference_refs: [], retry: { fingerprint: 'f'.repeat(64), outcome: structuredClone(stopped) } } }
  const grants: string[] = [], loads: number[] = []
  let grantStatus: 'granted' | 'not_granted' = 'granted'
  const store: DrawingRequestStore = {
    list: async () => [{ id, status: row.status }],
    load: async key => { loads.push(row.revision); return key === id ? structuredClone(row) : null },
    save: async (key, expected, status, payload) => {
      assert.equal(key, id); assert.equal(expected, row.revision, 'saves use the reloaded revision after a grant')
      row = { id, revision: expected + 1, status, payload: structuredClone(payload) }
      return structuredClone(row)
    },
    grant: async key => {
      grants.push(key)
      if (grantStatus !== 'granted') return { status: grantStatus, reason: 'budget_outcome_unknown', budget_revision: 1 }
      // Mirrors bob.grant_drawing_budget: the cost-stop gate opens and the revision moves.
      row = { ...row, revision: row.revision + 1, payload: { ...row.payload, retry: { fingerprint: '', outcome: row.payload.retry!.outcome } } }
      return { status: 'granted', budget_revision: 2, added: { usd: 1, calls: 24 } }
    },
  }
  let designerCalls = 0, reserveExhausted = false
  const assistant = createCadAssistant({ requestStore: store, projectId: 'A', userId: 'u', ownerRequest: 'Try again please', hasAccess: async () => true, available: true, deadline: Date.now() + 300000,
    requestModel: async (_id, _o, work) => reserveExhausted ? { success: false, data: null, model: 'unavailable', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, error: 'turn_budget_exhausted', budget_stop: stopped.budget_stop } as any : work(),
    makeLookup: () => createProjectLookup('A', async (_p, q) => ({ data: { records: q.dataset === 'target' ? [{ id: 'project', revision: 1, solution_id: 'solution' }] : [], related: [], truncated: false }, error: null }), 1000, 40),
    readArtifact: async () => null,
    render: async r => ({ recipe: r, manifest: { instances: r.instances }, files: { front: 'PRIVATE_EXPORT' }, previews: { front: 'PRIVATE_PIXELS', top: 'PRIVATE_PIXELS' } }),
    callModel: async o => {
      if (o.functionName === 'cad-research') return reply('finish_cad_research', assessment)
      if (o.functionName === 'cad-reviewer') return reviewReply()
      designerCalls++
      return designerCalls % 2 === 1 ? reply('render_cad_candidate', { ...metadata, recipe, dimension_bindings: [] }) : reply()
    },
  })
  return { assistant, brief, grants, loads, get row() { return row }, denyGrant: () => { grantStatus = 'not_granted' }, exhaust: () => { reserveExhausted = true } }
}

test('resuming a cost-stopped request grants budget first, reloads the packet and finishes the drawing', async () => {
  const f = fixture()
  const result = await f.assistant.consult(f.brief)
  assert.deepEqual(f.grants, [id], 'one grant before any model work')
  assert.deepEqual(result.budget_grant, { status: 'granted', budget_revision: 2, added: { usd: 1, calls: 24 } })
  assert.equal(result.status, 'ready'); assert.equal(result.request_id, id)
  assert.equal(f.loads.length, 2, 'the packet is reloaded after the grant')
  assert.equal(f.row.status, 'reviewed'); assert.equal(f.row.payload.owner_request, 'Draw this concept.\nTry again please')
  assert.equal(f.row.payload.retry, undefined, 'the cost-stop gate is gone after a successful resume')
})

test('a stop that is not a request cost limit never grants', async () => {
  for (const stop of [{ scope: 'turn', reasons: ['usd_limit'] }, { scope: 'drawing_request', reasons: ['pending_outcome'] }]) {
    const f = fixture({ ...stoppedOutcome, budget_stop: stop })
    await f.assistant.consult(f.brief)
    assert.deepEqual(f.grants, [], JSON.stringify(stop))
  }
  const f = fixture({ status: 'needs_data', stage: 'intake', saved: false })
  await f.assistant.consult(f.brief)
  assert.deepEqual(f.grants, [])
})

test('a refused grant stops at the budget boundary with the owner-facing resume hint, without re-reading', async () => {
  const f = fixture(); f.denyGrant(); f.exhaust()
  const result = await f.assistant.consult(f.brief)
  assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'turn_budget_exhausted'); assert.equal(result.stage, 'intake')
  assert.deepEqual(result.budget_grant, { status: 'not_granted', reason: 'budget_outcome_unknown', budget_revision: 1 })
  assert.equal(f.loads.length, 1, 'no reload without a grant')
  assert.match(result.next_action, /call design_project_cad at once with this same request_id/)
  assert.match(result.next_action, /do not read requests, budgets or sources/)
  assert.match(result.user_message, /Skriv till mig igen om ritningen/)
})

test('budget stop guidance distinguishes the request limit from the turn limit', () => {
  const request = { scope: 'drawing_request' as const, reasons: ['usd_limit' as const] }
  assert.match(budgetResumeAction(request), /next message about this drawing renews its budget/)
  assert.doesNotMatch(budgetResumeAction(request), /try again/, 'no magic words for the owner')
  assert.doesNotMatch(budgetResumeAction(request), /Resume only after an authorised budget change/)
  assert.match(budgetResumeAction({ scope: 'turn', reasons: ['call_limit'] }), /next message continues this same request_id/)
  assert.match(budgetStopMessage(request), /mer budget/)
  assert.doesNotMatch(budgetStopMessage({ scope: 'turn', reasons: ['usd_limit'] }), /mer budget/)
})
