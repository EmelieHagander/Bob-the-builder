import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadAssistant } from './support/colleague-catalog-fixture.ts'
import {checkedCadFixture,fixtureConstructionId} from './support/checked-cad-fixture.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import type { DrawingRequest, DrawingRequestStore } from '../supabase/functions/_shared/cad-intake.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { budgetResumeAction as budgetResumeActionImplementation, budgetStopMessage } from '../supabase/functions/_shared/bob-budget-stop.ts'
import { shapeId, handoff, reviewReply } from './support/cad-review-fixture.ts'

const budgetResumeAction=(stop:Parameters<typeof budgetResumeActionImplementation>[0])=>budgetResumeActionImplementation(stop,catalogFixture())

const id = '30000000-0000-4000-8000-000000000191'

const recipe = { contract_version: 1 as const, units: 'mm' as const, assembly_id: 'p0-task-resume',
  definitions: [{ id: 'panel', primitive: 'box' as const, material_ref: null, x_mm: 600, y_mm: 300, z_mm: 18 }],
  instances: [{ id: 'panel', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front' as const, 'top' as const] }
const metadata = { purpose: 'project', title: 'Concept', description: 'Synthetic task-resume test', assumptions: 'Site fit unverified', target_revision: 1, measurements: [] }
const reply = (name?: string, args: unknown = {}) => ({ success: true, data: null, responseId: 'response', model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  ...(name ? { toolCalls: [{ id: 'call', type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] } : {}) })
const assessment = { checks: [{ id: shapeId, status: 'known', blocking: false, source_refs: ['requirement:'+shapeId], action: 'none', detail: 'Concept dimensions supplied in the request.' }], additional_needs: [] }
const stoppedOutcome = { status: 'unavailable', stage: 'intake', saved: false, reason: 'turn_budget_exhausted',
  budget_stop: { scope: 'drawing_request', reasons: ['usd_limit'], calls: 9, call_limit: 24, spent_usd: 1.15, usd_limit: 1 } }

function fixture(stopped: Record<string, any> = stoppedOutcome) {
  const brief = { request_id: id, handoff, brief: 'Draw this concept.', area_id: null, component_id: null, step_id: 'work', artifact_id: fixtureConstructionId, construction_revision:1 }
  let row: DrawingRequest = { id, revision: 3, status: 'retrieval_failed',
    payload: { brief, owner_request: 'Draw this concept.', reference_refs: [], retry: { fingerprint: '', outcome: structuredClone(stopped) } } }
  const loads: number[] = []
  let newOwner=false,adoptions=0
  const store: DrawingRequestStore & {grant:(id:string)=>Promise<never>} = {
    // Older pinned packets can still contain request-scope stops. The removed
    // automatic top-up must not run even if a legacy store offers that seam.
    grant:async()=>{throw new Error('automatic top-up is forbidden')},
    list: async () => [{ id, status: row.status }],
    load: async key => { loads.push(row.revision); return key === id ? {...structuredClone(row),continuation_required:newOwner} : null },
    save: async (key, expected, status, payload) => {
      assert.equal(key, id); assert.equal(expected, row.revision, 'saves use the loaded packet revision')
      row = { id, revision: expected + 1, status, payload: structuredClone(payload) }
      // SQL's public save contract: atomic adoption releases only a cost stop.
      if(newOwner){
        newOwner=false;adoptions++
        if(row.payload.retry?.outcome.reason==='turn_budget_exhausted')row.payload.retry.fingerprint=''
      }
      return structuredClone(row)
    },

  }
  let modelCalls = 0, renderCalls = 0, reserveExhausted = false
  const makeAssistant = () => createCadAssistant({ requestStore: store, projectId: 'A', userId: 'u', ownerRequest: 'Try again please', hasAccess: async () => true, available: true, deadline: Date.now() + 300000,
    requestModel: async (_id, _o, work) => reserveExhausted ? { success: false, data: null, model: 'unavailable', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, error: 'turn_budget_exhausted', budget_stop: stopped.budget_stop } as any : work(),
    makeLookup: () => createProjectLookup('A', async (_p, q) => ({ data: { records: q.dataset === 'target' ? [{ id: 'project', revision: 1, solution_id: 'solution' }] : [], related: [], truncated: false }, error: null }), 1000, 40),
    ...checkedCadFixture('A',recipe),
    render:async r=>{renderCalls++;return checkedCadFixture('A',recipe).packet(r)},
    callModel:async o=>{modelCalls++;assert.equal(o.functionName,'cad-reviewer');return reviewReply()},
  })
  let assistant=makeAssistant()
  return { get assistant(){return assistant}, brief, loads, get row() { return row },get adoptions(){return adoptions},counts:()=>({modelCalls,renderCalls}),nextOwner:()=>{newOwner=true;reserveExhausted=false;assistant=makeAssistant()}, exhaust: () => { reserveExhausted = true } }
}

test('a saved packet resumes without an automatic allocation or a second load', async () => {
  const f = fixture()
  const result = await f.assistant.consult(f.brief)
  assert.equal(result.budget_grant, undefined)
  assert.equal(result.status, 'ready'); assert.equal(result.request_id, id)
  assert.equal(f.loads.length, 1)
  assert.equal(f.row.status, 'reviewed'); assert.equal(f.row.payload.owner_request, 'Draw this concept.\nTry again please')
  assert.equal(f.row.payload.retry, undefined)
})

test('an exhausted task stops with its actual cause and fresh-next-message hint', async () => {
  const f = fixture({...stoppedOutcome,budget_stop:{...stoppedOutcome.budget_stop,scope:'task'}}); f.exhaust()
  const result = await f.assistant.consult(f.brief)
  assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'paused_at_limit'); assert.equal(result.stage, 'review')
  assert.equal(result.budget_grant, undefined)
  assert.equal(f.loads.length, 1)
  assert.equal(result.budget_stop,undefined)
  assert.equal(f.assistant.failure?.budget_stop.scope,'task','private diagnostics retain the real stop')
  assert.match(result.user_message, /pausades vid en gräns/)
  assert.doesNotMatch(JSON.stringify(result),/budget|spent_usd|usd_limit|kostnadsgräns/)
})

test('budget guidance covers new task diagnostics and compatible older request diagnostics', () => {
  for(const scope of ['task','drawing_request'] as const){
    const stop = { scope, reasons: ['usd_limit' as const] }
    assert.match(budgetStopMessage(stop), /fortsätter/)
    assert.match(budgetResumeAction(stop), /owner.*next message/)
    assert.doesNotMatch(budgetStopMessage(stop), /budget|kostnad|\$/)
  }
})


test('a real unchanged cost-stop fingerprint is adopted through save before retry suppression',async()=>{
 const f=fixture();f.exhaust()
 await f.assistant.consult(f.brief)
 assert.equal(f.row.payload.retry?.outcome.reason,'turn_budget_exhausted')
 assert(f.row.payload.retry?.fingerprint)
 f.nextOwner()
 const result=await f.assistant.consult(f.brief)
 assert.equal(f.adoptions,1,JSON.stringify(result))
 assert.equal(result.retry_suppressed,undefined)
 assert.equal(result.status,'ready')
 assert.equal(f.row.payload.retry,undefined)
})

test('adopting an unchanged quality stop preserves evidence and does not buy another attempt',async()=>{
 const f=fixture();f.exhaust()
 await f.assistant.consult(f.brief)
 f.row.payload.retry!.outcome={status:'needs_data',reason:'review_failed',saved:false}
 f.row.payload.evidence=[{source:'retained quality evidence'}]
 const previous=structuredClone(f.row.payload),counts=f.counts()
 f.nextOwner()
 const result=await f.assistant.consult(f.brief)
 assert.equal(f.adoptions,1,JSON.stringify(result))
 assert.equal(result.retry_suppressed,true)
 assert.equal(result.reason,'review_failed')
 assert.deepEqual(f.row.payload,{...previous,owner_request:previous.owner_request+'\nTry again please'})
 assert.deepEqual(f.counts(),counts)
})
