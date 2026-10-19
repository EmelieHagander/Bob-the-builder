import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { runProjectAnswer, type BobAnswerState, type ProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup, type ProjectLookupState } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter, type ProjectWriterState, type WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { createProjectContext, type ProjectContextState } from '../supabase/functions/_shared/project-context/dispatcher.ts'
import { prepareChatImages } from '../supabase/functions/_shared/project-context/chat-images.ts'
import { checkedToolSnapshot } from '../supabase/functions/_shared/project-tools/session.ts'
import { BobContinuation, createBobJournal, type BobJournalState, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { AIBackgroundPending, backgroundResponse } from '../supabase/functions/_shared/ai-background.ts'
import { catalogFixture, catalogCall } from '../tests/support/ai-catalog-fixture.ts'
import type { OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'
import { createBobContextContinuation, type BobContextContinuationState, type ContextSurface } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { contextTokenPrefix, countContextTokens, countSerializedTokens } from '../supabase/functions/_shared/bob-token-budget.ts'

const TIME = '2026-10-19T10:00:00.000Z', IMAGE = '10000000-0000-4000-8000-000000000001'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const noError = (data: unknown) => ({ data, error: null })
const counters = () => ({ access: 0, policy: 0, imageValidate: 0, imageCurrent: 0, imageOpen: 0, catalog: 0,
  modelRequests: 0, modelDispatch: 0, providerPosts: 0, lookupRequests: 0, lookupDispatch: 0, toolTraversals: 0,
  writeTransport: 0, writes: 0, checkpoints: 0, summaryPosts: 0, checkpointBytes: 0, maxCheckpointBytes: 0, retainedContextBytes: 0 })
export interface ResumeProbeCapsule {
  answer: BobAnswerState
  lookup: ProjectLookupState
  context: ProjectContextState
  writer: ProjectWriterState
  journal: BobJournalState
  continuation?: BobContextContinuationState
  contextEpoch?: number
}
export interface ResumeProbeOptions {
  checkpoint: boolean
  yieldMode?: 'none' | 'step' | 'boundary'
  finalStep?: number
  /** SQL commit succeeds but the operation journal cannot save its result once. */
  loseWriteCheckpoint?: boolean
  /** First request at this model index is accepted and waits until completed. */
  waitModelAt?: number
  /** Approximately 2000-token read pages, two 4 MB media references, and the
   * production context-continuation adapter with its pinned rollover policy. */
  stress?: boolean
  completeRequest?: boolean
  resultReferences?: boolean
  onRequest?: (request: OpenAIServiceOptions) => void
  onCheckpoint?: (state: BobAnswerState, revoke: () => void) => void
}

/** Synthetic core-runtime fixture, also shared by regression tests. All durable
 * stores and provider IO are in memory. A claim reconstructs every runtime object
 * from a JSON round trip; no closure is reused across worker invocations. */
export function createResumeProbe(options: ResumeProbeOptions) {
  const session = catalogFixture()
  const policy = checkedToolSnapshot({ phase: null, tools: session.definition('bob.tools', 'tool_contract').definition.catalog })
  const entries: JournalEntry[] = [], ledger = new Map<string, WriteReadback>()
  const claims: (ReturnType<typeof counters> & { claim: number; step: number; phase: string; cpuMs: number; wallMs: number })[] = []
  let capsule: ResumeProbeCapsule | undefined, allowed = true, lostWrite = false, waitingReady = false
  let waitingJob: { key: string; fingerprint: string; responseId: string | null } | undefined
  let result: ProjectAnswer | undefined
  const finalStep = options.finalStep ?? 42
  const readDetail = options.stress ? contextTokenPrefix(Array.from({ length: 800 }, (_, i) =>
    `Observation ${i}: source record revision ${i % 7}, proposed timber dimension ${1800 + i} mm remains unmeasured; keep the recorded source and verify before fabrication.`).join('\n'), 1850) : undefined
  const imageIds = options.stress ? [IMAGE, '10000000-0000-4000-8000-000000000002'] : [IMAGE]
  const scripted = (step: number): OpenAIServiceResponse<string> => {
    const common = { success: true, model: 'fixture', responseId: `response-${step}`, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
    const tool = (name: string, args: unknown, suffix = '') => ({ id: `call-${step}${suffix}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
    if (step >= finalStep) return { ...common, data: 'The synthetic job completed.', outputPhase: 'final_answer' }
    if (step === 1) return { ...common, data: null, outputPhase: 'tool_calls', toolCalls: [
      tool('describe_tool', { name: 'search_project_data' }, '-read'), tool('describe_tool', { name: 'save_project_task' }, '-write')] }
    if (step === 2) return { ...common, data: null, outputPhase: 'tool_calls', toolCalls: ['one', 'two'].map(name => tool('save_project_task', {
      record_id: null, area_id: 'area', step_id: null, name, instructions: 'Synthetic task', expected_updated_at: null,
    }, '-' + name)) }
    return { ...common, data: null, outputPhase: 'tool_calls', toolCalls: [tool('search_project_data', {
      dataset: 'project', query: `probe-${step}`, status: null, area_id: null, record_id: null, after_id: null,
    })] }
  }
  async function runClaim() {
    const cpuStart = process.cpuUsage(), wallStart = performance.now()
    const c = counters(), checkpointAtStart = capsule?.answer
    const journal = createBobJournal({ entries, save: async entry => {
      if (options.loseWriteCheckpoint && !lostWrite && entry.key.startsWith('write:')) { lostWrite = true; throw new Error('Simulated write checkpoint outage') }
      entries.push(clone(entry))
    } }, Infinity, Date.now, new Map(), { unlimitedWork: true })
    if (capsule) journal.restoreState(capsule.journal)
    const hasAccess = async () => { c.access++; return allowed }
    const lookup = createProjectLookup('A', async (_project, input) => {
      c.lookupRequests++
      return journal.run('rpc:lookup', input, async () => {
        c.lookupDispatch++
        return noError({ records: input.dataset === 'project' ? [{ id: 'A', name: 'Probe', description: input.query && readDetail ? readDetail + '\nPage: ' + input.query : 'Synthetic fixture.' }] : [], related: [], truncated: false })
      })
    }, undefined, undefined, undefined, { unlimitedWork: true, observationTime: value => journal.run('lookup:observed', value, async () => TIME) })
    const context = createProjectContext({ hasAccess, sources: lookup.sources, unlimitedWork: true, imageEvidenceInstruction: 'Image evidence',
      adapters: [{ category: 'images', prefix: 'image', checkpointed: true,
        count: async () => journal.run('images:count', {}, async () => imageIds.length), list: async () => ({ items: [], next_cursor: null }),
        open: async ref => journal.run('images:open', { ref }, async () => {
          c.imageOpen++
          return { item: { ref, title: 'Synthetic image', project_id: 'A' }, version: 'v1', bytes: 4000000,
            source: { projectId: 'A', dataset: 'image_pixels', recordId: ref.slice(6), label: 'Synthetic image', retrievedAt: TIME, updatedAt: TIME, truth: 'unknown' as const },
            image: { type: 'image_url' as const, image_url: `private-image:${ref.slice(6)}/${'a'.repeat(64)}` } }
        }), current: async () => { c.imageCurrent++; return allowed },
      }],
    })
    const validate = context.validate.bind(context)
    context.validate = async () => { c.imageValidate++; return validate() }
    const catalog = context.catalog.bind(context)
    context.catalog = async () => { c.catalog++; return catalog() }
    const writer = createProjectWriter('A', 'Continue this synthetic task.', payload => journal.run('write', payload, async () => {
      c.writeTransport++
      const key = JSON.stringify(payload)
      if (!ledger.has(key)) {
        c.writes++
        ledger.set(key, { projectId: 'A', dataset: 'tasks', recordId: String(payload.data.name), label: String(payload.data.name), operation: 'created', savedAt: TIME,
          record: { id: String(payload.data.name), ...payload.data } })
      }
      return noError(ledger.get(key))
    }), async () => noError([...ledger.values()]), async () => noError({ generation: 2, receipts: [...ledger.values()] }), { unlimitedWork: true })
    if (capsule) {
      lookup.restoreState(capsule.lookup); context.restoreState(capsule.context); writer.restoreState(capsule.writer)
    }
    const dispatchModel = catalogCall(async request => {
      c.modelRequests++
      options.onRequest?.(request)
      return journal.run('model:' + request.functionName, request, async identity => {
        if (request.catalogRoleKey === 'context-compactor') {
          c.summaryPosts++; c.providerPosts++
          const source = JSON.parse(String(request.messages![0].content))
          return { success: true, model: 'summary-fixture', data: JSON.stringify({ summary: 'Synthetic source observations remain unmeasured. Two fixture tasks were saved.',
            open_questions: [], next_steps: ['Continue the read sequence.'], source_refs: source.allowed_source_refs.slice(0, 1) }),
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
        }
        if (!options.checkpoint && options.yieldMode !== 'none' && c.modelDispatch >= 1) throw new BobContinuation('yield')
        c.modelDispatch++
        const step = Number(identity.key.split(':').at(-1)) + 1
        if (step === options.waitModelAt) {
          const jobId = '11111111-1111-4111-8111-111111111111'
          const rpc = async (name: string, args: any) => {
            if (name === 'ai_job_prepare') {
              const submit = !waitingJob
              if (!waitingJob) waitingJob = { key: args.p_key, fingerprint: args.p_fingerprint, responseId: null }
              assert.equal(args.p_key, waitingJob.key); assert.equal(args.p_fingerprint, waitingJob.fingerprint)
              return { id: jobId, submit, status: waitingReady ? 'completed' : 'submitting', response_id: waitingJob.responseId,
                response: waitingReady ? { id: waitingJob.responseId, status: 'completed', output: [] } : null }
            }
            if (name === 'ai_job_start_submission') return { submit: true, status: 'submitting' }
            if (name === 'ai_job_accept') { waitingJob!.responseId = args.p_response.id; return true }
            throw new Error('Unexpected provider RPC: ' + name)
          }
          const originalFetch = globalThis.fetch
          globalThis.fetch = async (_url, init) => {
            assert.equal(init?.method, 'POST'); c.providerPosts++
            return Response.json({ id: 'accepted-response', status: 'queued', output: [] })
          }
          try {
            await backgroundResponse(rpc, 'synthetic-key', 'bob', { key: identity.key, fingerprint: identity.fingerprint,
              receiver: 'bob', context: {}, expiresAt: '2030-01-01T00:00:00Z' }, { model: 'fixture' }, {
              user_id: null, module: 'fixture', ai_function: 'ask-bob', model: 'fixture', input_price_per_1m: 0, output_price_per_1m: 0, cached_price_per_1m: 0,
            })
          } catch (error) {
            if (error instanceof AIBackgroundPending) throw new BobContinuation('yield', 'ai_wait', { id: error.jobId, accepted: error.accepted, role: 'ask-bob' })
            throw error
          } finally { globalThis.fetch = originalFetch }
        } else c.providerPosts++
        const result = scripted(step)
        return request.responseItemsMode === 'preserve' ? { ...result, outputItems: [
          { type: 'reasoning', id: 'rs_' + step, summary: [], encrypted_content: 'opaque-fixture-' + step },
          ...(result.toolCalls?.map(call => ({ type: 'function_call', id: 'fc_' + call.id, call_id: call.id,
            name: call.function.name, arguments: call.function.arguments, status: 'completed' })) ?? [
            { type: 'message', id: 'msg_' + step, role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: result.data, annotations: [] }] },
          ]),
        ] } : result
      })
    }, session)
    let contextEpoch = capsule?.contextEpoch ?? 0, refreshSurface: (() => Promise<ContextSurface>) | undefined
    const continuation = options.stress || options.completeRequest ? createBobContextContinuation({ version: 1, aiCatalog: session, callModel: dispatchModel,
      ...(options.resultReferences ? { mainResultReferences: 1 } : {}),
      pageBoundaries: (source, compute) => journal.run('context:pages', { source }, compute),
      onRollover: () => { contextEpoch++ }, refreshSurface: () => refreshSurface?.() ?? Promise.resolve(undefined),
      snapshot: () => ({ confirmed_writes: writer.executedReceipts.map(({ record: _record, ...receipt }) => receipt), unresolved_tools: writer.unresolvedTools }),
    }) : undefined
    if (capsule?.continuation) continuation!.restoreState(capsule.continuation)
    const callModel = continuation ? (request: Parameters<typeof dispatchModel>[0]) => continuation.call(request) : dispatchModel
    try {
      if (!capsule) await prepareChatImages(context, imageIds)
      await writer.recover()
      result = await runProjectAnswer({ aiCatalog: session, projectId: 'A', userId: 'owner', message: 'Continue this synthetic task.',
        lookup, writer, hasAccess, projectContext: context, carryLoadedTools: true, unlimitedWork: true, deadline: Infinity,
        ...(options.completeRequest ? { completeRequest: true } : {}),
        ...(options.resultReferences ? { resultReferences: true } : {}),
        readToolPolicy: async () => { c.policy++; return policy }, onTool: () => { c.toolTraversals++ }, callModel,
        ...(continuation ? { contextEpoch: () => contextEpoch, registerContextSurface: (refresh: () => Promise<ContextSurface>) => { refreshSurface = refresh } } : {}),
        ...(options.checkpoint ? { checkpoint: { state: capsule?.answer, save: async (answer: BobAnswerState) => {
          const next = { answer, lookup: lookup.exportState(), context: context.exportState(), writer: writer.exportState(), journal: journal.exportState(),
            ...(continuation ? { continuation: continuation.exportState(), contextEpoch } : {}) }
          const encoded = JSON.stringify(next), bytes = Buffer.byteLength(encoded)
          capsule = JSON.parse(encoded)
          c.checkpointBytes += bytes; c.maxCheckpointBytes = Math.max(c.maxCheckpointBytes, bytes)
          c.retainedContextBytes = Math.max(c.retainedContextBytes, Buffer.byteLength(JSON.stringify(next.continuation ?? null)))
          c.checkpoints++
          options.onCheckpoint?.(answer, () => { allowed = false })
          if (options.yieldMode === 'boundary' || options.yieldMode === 'step' && answer.phase === 'ready' && answer.step > 0) throw new BobContinuation('yield', 'simulated_lost_checkpoint_ack')
        } } } : {}),
      })
      return { status: 'done' as const, result }
    } catch (error) {
      if (!(error instanceof BobContinuation && error.kind === 'yield')) throw error
      return { status: 'yield' as const, reason: error.message }
    } finally {
      const cpu = process.cpuUsage(cpuStart)
      claims.push({ claim: claims.length + 1, step: checkpointAtStart?.step ?? 0, phase: checkpointAtStart?.phase ?? 'start', ...c,
        cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(3), wallMs: +(performance.now() - wallStart).toFixed(3) })
    }
  }
  return {
    runClaim,
    async runToEnd() {
      for (let i = 0; i < 500; i++) { const response = await runClaim(); if (response.status === 'done') return response.result }
      throw new Error('probe_did_not_finish')
    },
    completeWaitingModel() { waitingReady = true },
    state: () => capsule,
    get result() { return result },
    get claims() { return claims },
    get receipts() { return [...ledger.values()] },
    get readDetailTokens() { return readDetail ? countContextTokens(readDetail) : 0 },
    totals: () => Object.fromEntries(Object.keys(counters()).map(key => [key, claims.reduce((total, claim) => {
      const value = claim[key as keyof ReturnType<typeof counters>]
      return key === 'maxCheckpointBytes' || key === 'retainedContextBytes' ? Math.max(total, value) : total + value
    }, 0)])) as ReturnType<typeof counters>,
  }
}

/** Compare staged context strategies on identical scripted outcomes, not on
 * a new model-generated task. Never interpret fixture tokens as provider bills. */
async function compareContext() {
  const results = [], reports = []
  for (const resultReferences of [false, true]) {
    let final: OpenAIServiceOptions | undefined
    const probe = createResumeProbe({ checkpoint: true, completeRequest: true, resultReferences, stress: true, yieldMode: 'boundary',
      onRequest: request => { if (request.functionName === 'ask-bob') final = request } })
    results.push(await probe.runToEnd())
    reports.push({ resultReferences, total: probe.totals(), claims: probe.claims.length,
      finalSerializedFixtureTokens: countSerializedTokens(final),
      earlyCpuMs: probe.claims.filter(row => row.step === 2).map(row => row.cpuMs),
      lateCpuMs: probe.claims.filter(row => row.step === 40).map(row => row.cpuMs) })
  }
  assert.deepEqual(results[0], results[1])
  return { note: 'Offline scripted comparison: no paid model calls, actual pixels, hosted CPU, real reasoning or cache-hit measurements. Gross serialized checkpoint bytes are not persisted delta bytes. Node token caches stay warm between claims. Equal fixture outcomes do not prove model quality or cost savings.', reports }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const log = console.log
  console.log = () => {}
  try {
    if (process.argv.includes('--compare-context')) log(JSON.stringify(await compareContext(), null, 2))
    else {
    const stress = process.argv.includes('--stress')
    await createResumeProbe({ checkpoint: false, yieldMode: 'none', stress }).runToEnd()
    const legacy = createResumeProbe({ checkpoint: false, yieldMode: 'step', stress }), checkpoint = createResumeProbe({ checkpoint: true, yieldMode: 'step', stress })
    const oldResult = await legacy.runToEnd(), newResult = await checkpoint.runToEnd()
    assert.deepEqual(newResult, oldResult)
    const report = (probe: ReturnType<typeof createResumeProbe>) => ({ total: probe.totals(), claims: probe.claims.length,
      cpuMs: +probe.claims.reduce((sum, row) => sum + row.cpuMs, 0).toFixed(3), wallMs: +probe.claims.reduce((sum, row) => sum + row.wallMs, 0).toFixed(3),
      selected: probe.claims.filter(row => [2, 20, 40, 43].includes(row.claim)) })
    log(JSON.stringify({ note: 'Synthetic Node core-runtime benchmark; reader invocations are not production RPC counts. CPU is process.cpuUsage including runtime construction and restore, not Supabase Edge CPU. In-memory transport and media refs; no network or pixels. Module token caches remain warm between restored worker instances. Checkpoint bytes measure gross complete-state serialization, not persisted delta bytes.',
      stress, readDetailTokens: checkpoint.readDetailTokens, legacy: report(legacy), checkpoint: report(checkpoint) }, null, 2))
    }
  } finally { console.log = log }
}
