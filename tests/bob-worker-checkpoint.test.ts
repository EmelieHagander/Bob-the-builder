import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'
import { createBobModelBudget } from '../supabase/functions/_shared/bob-model-budget.ts'
import { BobContinuation, createBobJournal, type BobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { runProjectAnswer, seedToolPolicy, type BobAnswerState } from '../supabase/functions/_shared/project-answer.ts'
import { validWorkerProgress } from '../supabase/functions/_shared/bob-workers.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Job da79a46e (2026-11-01): bob-worker hit "CPU Time exceeded" on every resume.
// Konrad's job runs inside one of Bob's tool calls, so each resume replayed the
// whole job from his first step. With the pin, his place is saved after each step.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const reply = (cost: number, data = 'ok'): OpenAIServiceResponse<string> => ({ success: true, data, model: 'fixture', usage, estimatedCostUsd: cost, responseId: 'r' })
const stopPolicy = (finalAnswer: boolean) => ({ unlimitedWork: true, usdStop: 20, ...(finalAnswer ? { finalAnswer: true } : {}) })

// --- Bob's loop with Konrad and the shared budget -------------------------------

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
type Step = (o: OpenAIServiceOptions) => OpenAIServiceResponse<string>
const ANSWER = 'Konrad sparade lådan och servern kontrollerade den. Ritningen återstår.'

async function turn(opts: { finalAnswer: boolean; bob: Step[]; konrad: Step[]; budget?: ReturnType<typeof createBobModelBudget>;
  checkpoint?: { state?: BobAnswerState; onSave?: (state: BobAnswerState, budget: ReturnType<typeof createBobModelBudget>) => void }; yieldOnFinal?: boolean; workerCheckpoint?: boolean; journal?: BobJournal; failSave?: boolean }) {
  const catalog = catalogFixture(), projectId = 'p', message = 'Konrad, gör lådan 500 mm bred.', hasAccess = async () => true
  const lookup = createProjectLookup(projectId, async (_p, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Lådan' }] : [], related: [], truncated: false }, error: null }) as any, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const real = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }),
    readDelivery: async () => ({ status: 'ok', records: [] }) })
  const constructionCalls: string[] = []
  const constructionTools = { ...real, tools: real.tools, get remaining() { return real.remaining }, execute: async (name: string) => {
    constructionCalls.push(name)
    if (name === 'save_construction_draft' && opts.failSave) throw new BobContinuation('yield', 'segment_wall')
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
    ...(opts.workerCheckpoint ? { workerCheckpoint: true } : {}),
    ...(opts.checkpoint ? { checkpoint: { state: opts.checkpoint.state, save: async (state: BobAnswerState) => opts.checkpoint!.onSave?.(structuredClone(state), budget) } } : {}),
    // The production dispatch: every call shares one budget; tool_choice 'none' marks the final answer.
    callModel: catalogCall(async options => opts.journal ? opts.journal.run('model:' + options.functionName, options, () => model(options)) : model(options), catalog) } as any)
  async function model(options: OpenAIServiceOptions): Promise<OpenAIServiceResponse<string>> {
      requested.push(structuredClone(options))
      return budget.run(async () => {
        dispatched.push(structuredClone(options))
        if (options.functionName === 'structure-worker') return opts.konrad[konradSteps++](options)
        if (options.functionName !== 'ask-bob') return { ...reply(0), data: JSON.stringify({ work_remaining: false, reason: '' }) }
        if (opts.yieldOnFinal && options.tool_choice === 'none') throw new BobContinuation('yield', 'ai_wait')
        return opts.bob[bobSteps++](options)
      }, options.aiFunction ?? options.functionName, undefined, options.tool_choice === 'none')
  }
  return { result, requested, dispatched, budget, observation: observations.at(-1), constructionCalls }
}
const handOver: Step = () => ({ ...reply(.1), data: null, responseId: 'b1', toolCalls: [call('h1', 'ask_structure_worker', { request: 'Konrad, gör lådan 500 mm bred.' })] })
const reads = (n: number): Step => () => ({ ...reply(.1), data: null, responseId: 'k' + n, toolCalls: [call('k' + n + 'c', 'read_construction_draft', { page: n })] })
const saves: Step = () => ({ ...reply(.1), data: null, responseId: 'k3', toolCalls: [call('k3c', 'save_construction_draft', {})] })
const reports: Step = () => ({ ...reply(.1, 'Lådan är sparad.'), responseId: 'k4', outputPhase: 'final_answer' })
const stalls: Step = () => { throw new BobContinuation('yield', 'segment_wall') }
const answer: Step = () => ({ ...reply(.05, ANSWER), responseId: 'b-final', outputPhase: 'final_answer' })
const konrad = (list: OpenAIServiceOptions[]) => list.filter(o => o.functionName === 'structure-worker')

async function interrupted(workerCheckpoint: boolean) {
  const saves_: BobAnswerState[] = []
  await assert.rejects(turn({ finalAnswer: true, workerCheckpoint, bob: [handOver], konrad: [reads(1), reads(2), stalls], checkpoint: { onSave: s => { saves_.push(s) } } }),
    (e: unknown) => e instanceof BobContinuation)
  return saves_.at(-1)!
}

test('a resumed worker job continues after its last finished step instead of starting over', async () => {
  const saved = await interrupted(true)
  assert.equal(saved.phase, 'tools'); assert.equal(saved.toolIndex, 0)
  assert.equal(saved.worker?.key, 'structure'); assert.equal(saved.worker?.index, 0)
  assert(validWorkerProgress(saved.worker?.progress, 40))
  assert.equal(saved.worker!.progress.step, 1); assert.equal(saved.worker!.progress.previous, 'k2')
  assert.deepEqual(saved.worker!.progress.calls.map(c => c.tool), ['read_construction_draft', 'read_construction_draft'])

  const resumed = await turn({ finalAnswer: true, workerCheckpoint: true, bob: [answer], konrad: [saves, reports], checkpoint: { state: structuredClone(saved) } })
  assert(resumed.result.ok, JSON.stringify(resumed.result)); assert.equal(resumed.result.answer, ANSWER)
  // Only the unfinished part runs: no knowledge reads, no earlier steps again.
  const k = konrad(resumed.dispatched)
  assert.equal(k.length, 2)
  assert.equal(k[0].previousResponseId, 'k2')
  assert.deepEqual(k[0].messages!.map(m => m.role), ['tool'])
  assert.equal(k[0].messages![0].tool_call_id, 'k2c')
  assert(!resumed.constructionCalls.slice(0, 1).includes('read_construction_draft'), JSON.stringify(resumed.constructionCalls))
  assert.equal(resumed.constructionCalls[0], 'save_construction_draft')
  // Bob gets the whole job's report, including the steps before the resume.
  const report = JSON.parse(String(resumed.requested.filter(o => o.functionName === 'ask-bob').at(-1)!.messages!.find(m => m.role === 'tool' && m.tool_call_id === 'h1')!.content))
  assert.equal(report.status, 'ok')
  assert.deepEqual(report.calls.map((c: { tool: string }) => c.tool), ['read_construction_draft', 'read_construction_draft', 'save_construction_draft'])
})

test('the place is cleared once the job reports, and Bob\'s later saves carry no worker', async () => {
  const states: BobAnswerState[] = []
  const done = await turn({ finalAnswer: true, workerCheckpoint: true, bob: [handOver, answer], konrad: [reads(1), saves, reports], checkpoint: { onSave: s => { states.push(s) } } })
  assert(done.result.ok)
  const withWorker = states.filter(s => s.worker)
  assert.deepEqual(withWorker.map(s => s.worker!.progress.step), [0, 1])
  const last = states.findLastIndex(s => s.worker)
  assert(states.slice(last + 1).length > 0 && states.slice(last + 1).every(s => !s.worker))
})

test('without the pin nothing is saved inside the job and a resume starts it over, as before', async () => {
  const saved = await interrupted(false)
  assert.equal(saved.worker, undefined)
  const resumed = await turn({ finalAnswer: true, bob: [answer], konrad: [reads(1), reads(2), saves, reports], checkpoint: { state: structuredClone(saved) } })
  assert(resumed.result.ok)
  assert.equal(konrad(resumed.dispatched).length, 4)
  assert.equal(konrad(resumed.dispatched)[0].previousResponseId, undefined)
})

test('a saved place that does not match the hand-over is refused', async () => {
  const saved = await interrupted(true)
  await assert.rejects(turn({ finalAnswer: true, workerCheckpoint: true, bob: [answer], konrad: [saves, reports],
    checkpoint: { state: { ...structuredClone(saved), worker: { ...saved.worker!, index: 3 } } } }), /turn_checkpoint_invalid/)
  await assert.rejects(turn({ finalAnswer: true, workerCheckpoint: true, bob: [answer], konrad: [saves, reports],
    checkpoint: { state: { ...structuredClone(saved), worker: { ...saved.worker!, progress: { ...saved.worker!.progress, previous: '' } } } } }), /turn_checkpoint_invalid/)
})

test('with the real journal, a resume replays only the interrupted step and dispatches nothing twice', async () => {
  const store: { entries: JournalEntry[]; save(e: JournalEntry): Promise<void> } = { entries: [], async save(e) { this.entries.push(structuredClone(e)) } }
  const first = createBobJournal(store, Infinity, Date.now, new Map(), { unlimitedWork: true })
  let committed: { state: BobAnswerState; journal: ReturnType<BobJournal['exportState']> } | undefined
  // Each commit records the journal cursor with the state, as the turn checkpoint does.
  const onSave = (state: BobAnswerState) => { committed = { state, journal: first.exportState() } }
  // Konrad's third step is answered, then the segment ends while his save runs.
  await assert.rejects(turn({ finalAnswer: true, workerCheckpoint: true, journal: first, failSave: true, bob: [handOver], konrad: [reads(1), reads(2), saves], checkpoint: { onSave } }),
    (e: unknown) => e instanceof BobContinuation)
  assert.equal(committed!.state.worker!.progress.step, 1)
  const second = createBobJournal({ entries: structuredClone(store.entries), async save(e) { store.entries.push(structuredClone(e)) } }, Infinity, Date.now, new Map(), { unlimitedWork: true })
  second.restoreState(committed!.journal)
  const resumed = await turn({ finalAnswer: true, workerCheckpoint: true, journal: second, bob: [answer], konrad: [reports],
    checkpoint: { state: structuredClone(committed!.state), onSave: () => { second.exportState() } } })
  assert(resumed.result.ok, JSON.stringify(resumed.result))
  // Konrad's third answer came from the journal (same request, same place); only his report was dispatched.
  assert.deepEqual(store.entries.filter(e => e.key.startsWith('model:structure-worker:')).map(e => e.key.split(':').at(-1)), ['0', '1', '2', '3'])
  assert.deepEqual(konrad(resumed.dispatched).map(o => o.previousResponseId), ['k3'])
  assert.deepEqual(resumed.constructionCalls.slice(0, 1), ['save_construction_draft'])
})
