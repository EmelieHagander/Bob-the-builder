import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall, preMaterialFinderTeamCatalogFixture } from './support/ai-catalog-fixture.ts'
import { createBobModelBudget, bobFinalAnswerVersion } from '../supabase/functions/_shared/bob-model-budget.ts'
import { BobContinuation } from '../supabase/functions/_shared/bob-job-journal.ts'
import { runProjectAnswer, seedToolPolicy, type BobAnswerState } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-11-01: "Bob's final answer always gets through". In a live
// turn Konrad's job brought the turn to USD 1.957 of the 2.00 spending stop; Bob's
// next call was refused and the owner got the recovery template instead of Bob's answer.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const reply = (cost: number, data = 'ok'): OpenAIServiceResponse<string> => ({ success: true, data, model: 'fixture', usage, estimatedCostUsd: cost, responseId: 'r' })
const stopPolicy = (finalAnswer: boolean) => ({ unlimitedWork: true, usdStop: 2, ...(finalAnswer ? { finalAnswer: true } : {}) })
const mustNotRun = async (): Promise<OpenAIServiceResponse<string>> => { throw new Error('must not dispatch') }

test('past the spending stop Bob gets exactly one call that cannot call tools; nothing else runs', async () => {
  const budget = createBobModelBudget(1, 24, undefined, stopPolicy(true))
  assert((await budget.run(async () => reply(1.9), 'structure-worker')).success)
  // Workers and Bob's tool rounds stay refused.
  assert.equal((await budget.run(mustNotRun, 'structure-worker', undefined, true)).error, 'turn_budget_exhausted')
  assert.equal((await budget.run(mustNotRun, 'ask-bob')).error, 'turn_budget_exhausted')
  assert.equal((await budget.run(mustNotRun, 'completion-gate', undefined, true)).error, 'turn_budget_exhausted')
  // The final answer runs and is counted; a second one is refused.
  assert((await budget.run(async () => reply(.05), 'ask-bob', undefined, true)).success)
  assert.equal(budget.usage.spent, 1.95)
  const second: any = await budget.run(mustNotRun, 'ask-bob', undefined, true)
  assert.equal(second.error, 'turn_budget_exhausted'); assert.deepEqual(second.budget_stop.reasons, ['usd_limit', 'review_reserve'])
  // The reserve for delivery is unchanged.
  assert((await budget.run(async () => reply(.01), 'bob-delivery-language')).success)
})

test('without the flag the stop ends Bob exactly as before, and the checkpoint keeps version 1', async () => {
  const budget = createBobModelBudget(1, 24, undefined, stopPolicy(false))
  await budget.run(async () => reply(1.9), 'structure-worker')
  assert.equal((await budget.run(mustNotRun, 'ask-bob', undefined, true)).error, 'turn_budget_exhausted')
  assert.deepEqual(budget.exportState(), { version: 1, spent: 1.9, calls: 1, unpriced: false })
  // No spending stop pinned: the flag grants nothing either.
  const legacy = createBobModelBudget(1, 24, undefined, { finalAnswer: true })
  await legacy.run(async () => reply(1.1), 'ask-bob')
  assert.equal((await legacy.run(mustNotRun, 'ask-bob', undefined, true)).error, 'turn_budget_exhausted')
})

test('the grant survives checkpoints, and older checkpoints still restore', async () => {
  const before = createBobModelBudget(1, 24, undefined, stopPolicy(true))
  await before.run(async () => reply(1.9), 'structure-worker')
  const unused = before.exportState()
  assert.deepEqual(unused, { version: 2, spent: 1.9, calls: 1, unpriced: false, finalAnswerUsed: false })
  const resumed = createBobModelBudget(1, 24, undefined, stopPolicy(true)); resumed.restoreState(structuredClone(unused))
  assert((await resumed.run(async () => reply(.05), 'ask-bob', undefined, true)).success, 'the grant is still there after a resume')
  const used = resumed.exportState()
  assert.equal(used.finalAnswerUsed, true)
  const again = createBobModelBudget(1, 24, undefined, stopPolicy(true)); again.restoreState(structuredClone(used))
  assert.equal((await again.run(mustNotRun, 'ask-bob', undefined, true)).error, 'turn_budget_exhausted', 'a used grant is not renewed by a resume')
  // A version 1 checkpoint (job written before) restores with the grant unused; a broken version 2 is refused.
  const old = createBobModelBudget(1, 24, undefined, stopPolicy(true)); old.restoreState({ version: 1, spent: 1.9, calls: 1, unpriced: false })
  assert.deepEqual(old.exportState(), unused)
  const plain = createBobModelBudget(1, 24, undefined, stopPolicy(false)); plain.restoreState({ version: 1, spent: 1, calls: 2, unpriced: true })
  assert.deepEqual(plain.exportState(), { version: 1, spent: 1, calls: 2, unpriced: true })
  assert.throws(() => old.restoreState({ version: 2, spent: 1, calls: 1, unpriced: false } as any), /model_budget_checkpoint_invalid/)
  assert.throws(() => old.restoreState({ version: 3, spent: 1, calls: 1, unpriced: false, finalAnswerUsed: false } as any), /model_budget_checkpoint_invalid/)
})

test('the flag is pinned from the manifest: final_answer_version 1, otherwise nothing', () => {
  const contract = (catalog: AiCatalogSession) => catalog.definition('agent-contract.ask-bob', 'agent_contract').metadata
  // Published by bob-finder-save-fixes-v1; manifests pinned before it have no flag.
  assert.deepEqual(bobFinalAnswerVersion(contract(preMaterialFinderTeamCatalogFixture())), {})
  assert.deepEqual(bobFinalAnswerVersion(contract(catalogFixture())), { finalAnswerVersion: 1 })
  assert.deepEqual(bobFinalAnswerVersion({ final_answer_version: 2 }), {})
})

// --- Bob's loop with Konrad and the shared budget -------------------------------

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
type Step = (o: OpenAIServiceOptions) => OpenAIServiceResponse<string>
const ANSWER = 'Konrad sparade lådan och servern kontrollerade den. Ritningen återstår.'

async function turn(opts: { finalAnswer: boolean; bob: Step[]; konrad: Step[]; budget?: ReturnType<typeof createBobModelBudget>;
  checkpoint?: { state?: BobAnswerState; onSave?: (state: BobAnswerState, budget: ReturnType<typeof createBobModelBudget>) => void }; yieldOnFinal?: boolean }) {
  const catalog = catalogFixture(), projectId = 'p', message = 'Konrad, gör lådan 500 mm bred.', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_p, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Lådan' }] : [], related: [], truncated: false }, error: null }) as any, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const real = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }),
    readDelivery: async () => ({ status: 'ok', records: [] }) })
  const constructionCalls: string[] = []
  const constructionTools = { ...real, tools: real.tools, get remaining() { return real.remaining }, execute: async (name: string) => {
    constructionCalls.push(name)
    if (name === 'read_construction_draft') return { status: 'ok', drafts: [{ artifact_id: 'c1', title: 'Lådan', revision: 3 }] }
    if (name === 'check_construction_draft') return { status: 'checked', artifact_id: 'c1', revision: 3 }
    return { status: 'saved', receipt: { projectId, dataset: 'artifacts', recordId: 'c1', label: 'Lådan', operation: 'updated', savedAt: '2026-11-01T00:00:00Z', revision: 3, record: {} } }
  } }
  const readToolPolicy = async () => {
    const policy = await seedToolPolicy(), definitions = catalog.manifest().definitions
    return { ...policy, phase: 'design', tools: policy.tools.map(row => {
      const version = (definitions.find(d => d.prompt_key === 'tools.' + row.name)?.definition.envelope as { schema_version?: number } | undefined)?.schema_version
      return version ? { ...row, schema_version: version } : row
    }) }
  }
  const budget = opts.budget ?? createBobModelBudget(1, 24, undefined, stopPolicy(opts.finalAnswer))
  const requested: OpenAIServiceOptions[] = [], dispatched: OpenAIServiceOptions[] = [], observations: any[] = []
  let bobSteps = 0, konradSteps = 0
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, lookup, writer, hasAccess, constructionTools, aiCatalog: catalog,
    unlimitedWork: true, corePreload: true, readToolPolicy, completeRequest: true, deadline: Infinity, observe: v => observations.push(v),
    ...(opts.finalAnswer ? { finalAnswer: true } : {}),
    ...(opts.checkpoint ? { checkpoint: { state: opts.checkpoint.state, save: async (state: BobAnswerState) => opts.checkpoint!.onSave?.(structuredClone(state), budget) } } : {}),
    // The production dispatch: every call shares one budget; tool_choice 'none' marks the final answer.
    callModel: catalogCall(async options => {
      requested.push(structuredClone(options))
      return budget.run(async () => {
        dispatched.push(structuredClone(options))
        if (options.functionName === 'structure-worker') return opts.konrad[konradSteps++](options)
        if (options.functionName !== 'ask-bob') return { ...reply(0), data: JSON.stringify({ work_remaining: false, reason: '' }) }
        if (opts.yieldOnFinal && options.tool_choice === 'none') throw new BobContinuation('yield', 'ai_wait')
        return opts.bob[bobSteps++](options)
      }, options.aiFunction ?? options.functionName, undefined, options.tool_choice === 'none')
    }, catalog) } as any)
  return { result, requested, dispatched, budget, observation: observations.at(-1), constructionCalls }
}
const handOver: Step = () => ({ ...reply(.2), data: null, responseId: 'b1', toolCalls: [call('h1', 'ask_structure_worker', { request: 'Konrad, gör lådan 500 mm bred.' })] })
const konradSaves: Step = () => ({ ...reply(1.75), data: null, responseId: 'k1', toolCalls: [call('k1c', 'save_construction_draft', {})] })
const finalAnswer: Step = () => ({ ...reply(.05, ANSWER), responseId: 'b-final', outputPhase: 'final_answer' })
const handOverResult = (o: OpenAIServiceOptions) => JSON.parse(String(o.messages!.find(m => m.role === 'tool' && m.tool_call_id === 'h1')!.content))
const bobRequests = (list: OpenAIServiceOptions[]) => list.filter(o => o.functionName === 'ask-bob')

test('a worker stopped by the spending stop reports what it saved, and Bob answers once without tools', async () => {
  const { result, requested, dispatched, observation, constructionCalls } = await turn({ finalAnswer: true, bob: [handOver, finalAnswer], konrad: [konradSaves] })
  assert(result.ok, JSON.stringify(result))
  assert.equal(result.answer, ANSWER); assert.equal(result.providerResponseId, 'b-final', 'Bob\'s own words, committed as his answer')
  assert.equal(result.evidence.partial, true); assert.equal(observation.end, 'step_budget')
  // Konrad's second call was refused; his job came back as a status with his saves.
  assert.deepEqual(dispatched.map(o => o.functionName), ['ask-bob', 'structure-worker', 'ask-bob'])
  const bob = bobRequests(requested)
  assert.equal(bob.length, 3, 'one refused step with tools, then the one final call')
  const report = handOverResult(bob[2])
  assert.equal(report.status, 'paused_at_limit'); assert.equal(report.worker, 'structure-worker')
  assert.deepEqual(report.receipts, [{ tool: 'save_construction_draft', dataset: 'artifacts', record_id: 'c1', revision: 3, operation: 'updated' },
    { tool: 'check_construction_draft', artifact_id: 'c1', revision: 3, status: 'checked', by: 'code' }])
  assert.deepEqual(report.readback, [{ construction: { status: 'ok', drafts: [{ artifact_id: 'c1', title: 'Lådan', revision: 3 }] } }])
  assert(!JSON.stringify(report).includes('usd'), 'Bob is not told about money')
  // The final request is the refused one, with its tools kept but not callable.
  assert.equal(bob[1].tool_choice, undefined); assert.equal(bob[2].tool_choice, 'none')
  assert.deepEqual(bob[2].tools!.map(t => t.function.name), bob[1].tools!.map(t => t.function.name))
  // Same request, plus the approved closed-bench note once, naming the spending budget.
  assert.deepEqual({ ...bob[2], tool_choice: undefined, messages: bob[2].messages.slice(0, -1) }, { ...bob[1], tool_choice: undefined })
  const note = bob[2].messages.at(-1)!
  assert.equal(note.role, 'user'); assert.match(String(note.content), /spending/)
  assert(constructionCalls.includes('check_construction_draft'))
})

test('Bob refused after a finished worker report also gets his final answer', async () => {
  const konradReports: Step = () => ({ ...reply(.7, 'Lådan är sparad och kontrollerad.'), responseId: 'k2', outputPhase: 'final_answer' })
  const { result, dispatched, requested } = await turn({ finalAnswer: true, bob: [handOver, finalAnswer],
    konrad: [() => ({ ...reply(1.0), data: null, responseId: 'k1', toolCalls: [call('k1c', 'save_construction_draft', {})] }), konradReports] })
  assert(result.ok); assert.equal(result.answer, ANSWER)
  assert.deepEqual(dispatched.map(o => o.functionName), ['ask-bob', 'structure-worker', 'structure-worker', 'ask-bob'])
  assert.equal(handOverResult(bobRequests(requested)[2]).status, 'ok')
})

test('without the flag the worker stop still fails the turn as before', async () => {
  const { result, dispatched } = await turn({ finalAnswer: false, bob: [handOver, finalAnswer], konrad: [konradSaves] })
  assert.deepEqual(result, { ok: false, error: 'tool_execution_unavailable' })
  assert.deepEqual(dispatched.map(o => o.functionName), ['ask-bob', 'structure-worker'])
})

test('a second refusal ends the turn: an empty final answer is not retried', async () => {
  const empty: Step = () => ({ ...reply(.05, ''), responseId: 'b-final', outputPhase: 'final_answer' })
  const { result, dispatched } = await turn({ finalAnswer: true, bob: [handOver, empty], konrad: [konradSaves] })
  assert.deepEqual(result, { ok: false, error: 'turn_budget_exhausted' })
  assert.equal(bobRequests(dispatched).length, 2, 'the hand-over step and the one final call')
})

test('with the flag, a stop during the completion review still delivers the reviewed answer, without a final call', async () => {
  const stopped = { success: false, model: 'unavailable', data: null, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, error: 'turn_budget_exhausted' }
  const calls: OpenAIServiceOptions[] = []
  const writer = createProjectWriter('A', 'Hur högt är bordet?', async () => assert.fail('no write'), async () => ({ data: [], error: null }))
  const result = await runProjectAnswer({ aiCatalog: catalogFixture(), unlimitedWork: true, finalAnswer: true, projectId: 'A', userId: 'u', message: 'Hur högt är bordet?', hasAccess: async () => true,
    lookup: createProjectLookup('A', async () => ({ data: { records: [{ id: 'A', name: 'Fixture' }], related: [], truncated: false }, error: null }), 1000, 1000), deadline: Infinity, writer,
    callModel: async options => {
      calls.push(options)
      if (options.functionName === 'completion-gate') return { success: true, model: 'mini', usage, data: { work_remaining: true, reason: 'Granska.' } } as any
      return calls.filter(o => o.functionName === 'ask-bob').length === 1 ? { ...reply(.1, 'Bordet är 72 cm högt enligt ritningen.'), responseId: 'first', outputPhase: 'final_answer' } : stopped
    } })
  assert(result.ok); assert.equal(result.answer, 'Bordet är 72 cm högt enligt ritningen.'); assert.equal(result.evidence.partial, true)
  assert.deepEqual(calls.map(o => o.functionName), ['ask-bob', 'completion-gate', 'ask-bob'])
  assert(calls.every(o => o.tool_choice === undefined))
})

test('a job that yields during the final call resumes with the grant and answers once', async () => {
  let saved: { state: BobAnswerState; budget: ReturnType<ReturnType<typeof createBobModelBudget>['exportState']> } | undefined
  const onSave = (state: BobAnswerState, budget: ReturnType<typeof createBobModelBudget>) => { saved = { state, budget: budget.exportState() } }
  await assert.rejects(turn({ finalAnswer: true, bob: [handOver], konrad: [konradSaves], yieldOnFinal: true, checkpoint: { onSave } }), (e: unknown) => e instanceof BobContinuation)
  assert.equal(saved!.state.phase, 'model'); assert.equal(saved!.state.finalCall, true); assert.equal(saved!.state.request!.tool_choice, 'none')
  assert.equal(saved!.budget.finalAnswerUsed, false, 'committed before the final call')
  // The next segment restores the committed budget and the saved step.
  const budget = createBobModelBudget(1, 24, undefined, stopPolicy(true)); budget.restoreState(structuredClone(saved!.budget))
  const resumed = await turn({ finalAnswer: true, bob: [finalAnswer], konrad: [], budget, checkpoint: { state: structuredClone(saved!.state), onSave } })
  assert(resumed.result.ok); assert.equal(resumed.result.answer, ANSWER)
  assert.deepEqual(resumed.dispatched.map(o => o.functionName), ['ask-bob'])
  assert.equal(resumed.dispatched[0].tool_choice, 'none')
  assert.equal(saved!.budget.finalAnswerUsed, true)
})
