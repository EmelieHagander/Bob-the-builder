import type { AiCatalogSession } from './ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import type { WorkingContext } from './bob-working-context.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { toolRejection, type ToolRejection } from './tool-rejection.ts'

/** Owner decision 2026-10-30: pilot of Bob as coordinator with workers, Mattias
 * (materials) first. A worker has its own fixed native tools and instructions
 * and the same input Bob has: the locked project snapshot, the conversation
 * summaries and history, then Bob's brief (the job, what Bob found this turn and
 * the current records of the worker's area). Fixed first, changing last, so each
 * worker's prompt start is cached. The worker reads and saves through a tool
 * session with the same gates, receipts and turn budgets as Bob's, and reports
 * back to Bob; it never answers the owner. */
/** Owner decision 2026-10-31: Bob hands over a plain request and no values; the
 * worker's project knowledge comes from these fixed reads, fresh at the start of
 * the job. Workers without knowledge (manifests before) get Bob's brief instead. */
export interface WorkerKnowledge { label: string; tool: string; arguments: Record<string, unknown> }
export interface WorkerDefinition { role: string; tool: string; tools: string[]; reads: string[]; max_steps: number; knowledge?: WorkerKnowledge[] }
type Messages = NonNullable<OpenAIServiceOptions['messages']>
type ModelCall = (options: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<string>>
const NAME = /^[a-z][a-z0-9_]{0,63}$/

/** Workers published by the pinned manifest, or null for manifests before the pilot.
 * Owner decision 2026-10-31: the structural designer and Rita (drawing) join
 * Mattias under build_workers; runtimes that read only workers keep those tools
 * with Bob. A tool belongs to one worker. */
export function catalogWorkers(catalog: AiCatalogSession): Record<string, WorkerDefinition> | null {
  const box = catalog.definition('bob.tools', 'tool_contract').definition
  const groups = [...(box.materials_worker_version === 1 ? [box.workers] : []), ...(box.build_workers_version === 1 ? [box.build_workers] : [])]
  if (!groups.length) return null
  const known = (name: unknown) => typeof name === 'string' && NAME.test(name) && catalog.manifest().definitions.some(row => row.prompt_key === 'tools.' + name && row.definition_kind === 'tool_contract')
  const workers: Record<string, WorkerDefinition> = {}
  for (const value of groups) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new Error('worker_catalog_invalid')
    for (const [key, worker] of Object.entries(value as Record<string, WorkerDefinition>)) {
      if (key in workers || !NAME.test(key) || !worker || typeof worker.role !== 'string' || !catalog.manifest().definitions.some(row => row.prompt_key === worker.role && row.definition_kind === 'role')
        || !known(worker.tool) || !Array.isArray(worker.tools) || !worker.tools.length || !worker.tools.every(known)
        || !Array.isArray(worker.reads) || !worker.reads.every(known) || !Number.isSafeInteger(worker.max_steps) || worker.max_steps < 1 || worker.max_steps > 40
        || worker.knowledge !== undefined && !validKnowledge(worker))
        throw new Error('worker_catalog_invalid')
      workers[key] = worker
    }
  }
  const owned = Object.values(workers).flatMap(worker => worker.tools)
  if (new Set(owned).size !== owned.length) throw new Error('worker_catalog_invalid')
  return structuredClone(workers)
}

function validKnowledge(worker: WorkerDefinition): boolean {
  const reads = worker.knowledge
  if (!Array.isArray(reads) || !reads.length || reads.length > 8) return false
  const labels = new Set<string>()
  for (const read of reads) {
    if (!read || typeof read !== 'object' || !NAME.test(read.label) || labels.has(read.label) || ![...worker.tools, ...worker.reads].includes(read.tool)
      || !read.arguments || typeof read.arguments !== 'object' || Array.isArray(read.arguments)) return false
    labels.add(read.label)
  }
  return true
}

/** Tools that belong to a worker are not offered to Bob himself. */
export function workerOwnedTools(workers: Record<string, WorkerDefinition> | null): Set<string> {
  return new Set(Object.values(workers ?? {}).flatMap(worker => worker.tools))
}

/** Tools retired for new jobs with the build workers (owner decision 2026-10-31:
 * the legacy box drawing skipped both the construction and the review). Pinned
 * manifests keep them. */
export function catalogRetiredTools(catalog: AiCatalogSession): Set<string> {
  const box = catalog.definition('bob.tools', 'tool_contract').definition
  if (box.build_workers_version !== 1 || !Array.isArray(box.retired_tools)) return new Set()
  return new Set((box.retired_tools as unknown[]).filter((name): name is string => typeof name === 'string' && NAME.test(name)))
}

/** Reads Bob uses to check a colleague's report, loaded from his first step like
 * the hand-overs (box run 12: four describe_tool rounds, each changing his tool
 * list mid-turn). Manifests before keep loading them on demand. */
export function catalogCheckReads(catalog: AiCatalogSession): string[] {
  const box = catalog.definition('bob.tools', 'tool_contract').definition
  if (box.build_workers_version !== 1 || !Array.isArray(box.check_reads)) return []
  return (box.check_reads as unknown[]).filter((name): name is string => typeof name === 'string' && NAME.test(name)
    && catalog.manifest().definitions.some(row => row.prompt_key === 'tools.' + name && row.definition_kind === 'tool_contract'))
}

/** plain: the worker reads its own project knowledge, so Bob sends only a request. */
export function parseWorkerJob(value: unknown, plain = false): { job: string; findings: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (plain) {
    if (Object.keys(v).some(key => key !== 'request') || typeof v.request !== 'string' || !v.request.trim() || v.request.length > 2000) return null
    return { job: v.request.trim(), findings: null }
  }
  if (Object.keys(v).some(key => key !== 'job' && key !== 'findings')) return null
  if (typeof v.job !== 'string' || !v.job.trim() || v.job.length > 2000) return null
  if (!(v.findings === null || v.findings === undefined || typeof v.findings === 'string' && v.findings.length <= 6000)) return null
  return { job: v.job.trim(), findings: typeof v.findings === 'string' && v.findings.trim() ? v.findings.trim() : null }
}

/** The worker's input, fixed first: project snapshot, the conversation (summaries
 * and history exactly as Bob reads them), then the changing part last: project
 * knowledge and Bob's request, or (manifests before) Bob's brief. */
export function buildWorkerMessages(aiCatalog: AiCatalogSession, opts: {
  prefix: string; context?: WorkingContext; history: Messages; brief: { job: string; findings: string | null; current: unknown };
  knowledge?: Record<string, unknown>;
}): Messages {
  const stair = opts.context?.stair
  return [
    ...(stair ? [{ role: 'user' as const, content: aiCatalog.text(opts.prefix + '.project') + '\n' + JSON.stringify({ locked_at: stair.snapshotLockedAt, ...stair.snapshot }) }] : []),
    { role: 'user', content: aiCatalog.text(opts.prefix + '.conversation') },
    ...opts.history,
    ...(opts.knowledge ? [
      { role: 'user' as const, content: aiCatalog.text(opts.prefix + '.knowledge') + '\n' + JSON.stringify(opts.knowledge) },
      { role: 'user' as const, content: aiCatalog.text(opts.prefix + '.request') + '\n' + opts.brief.job },
    ] : [{ role: 'user' as const, content: aiCatalog.text(opts.prefix + '.brief') + '\n' + JSON.stringify(opts.brief) }]),
  ]
}

export async function runWorker(opts: {
  aiCatalog: AiCatalogSession; worker: WorkerDefinition; callModel: ModelCall; userId: string
  job: { job: string; findings: string | null }; context?: WorkingContext; history: Messages
  session: { prepare(): Promise<NonNullable<OpenAIServiceOptions['tools']>>; execute(name: string, args: unknown): Promise<any> }
  readCurrent: () => Promise<unknown>; hasAccess: () => Promise<boolean>; deadline: number; modelTimeoutMs?: number
  /** Workers with knowledge reads: their fresh results, and the persona's variables (the project's name). */
  readKnowledge?: () => Promise<Record<string, unknown>>; variables?: Record<string, string>
  /** Pixels the worker opened go with the worker's own next call (not Bob's), and are confirmed after it. */
  images?: { carrier: () => Messages; confirmDelivery: () => void }
  onTool?: (value: { name: string; status: string; ms: number; rejection?: ToolRejection }) => void
}): Promise<Record<string, unknown>> {
  const roleKey = opts.worker.role.replace(/^role\./, '')
  const allowed = new Set([...opts.worker.tools, ...opts.worker.reads])
  // The worker's session also offers tools that wait for a prerequisite (saving a
  // reviewed drawing), so the list is the same in every step and the prompt start
  // stays cached; calling one too early answers "not available yet". Prepared each
  // step so a disabled tool still disappears; the order never changes.
  const order: string[] = []
  const offer = async () => {
    const offered = (await opts.session.prepare()).filter(spec => allowed.has(spec.function.name))
    for (const spec of offered) if (!order.includes(spec.function.name)) order.push(spec.function.name)
    return order.flatMap(name => offered.filter(spec => spec.function.name === name))
  }
  let specs = await offer()
  if (!specs.length) return { status: 'unavailable', worker: roleKey }
  let current: unknown, knowledge: Record<string, unknown> | undefined
  if (opts.readKnowledge) knowledge = await opts.readKnowledge()
  else try { current = await opts.readCurrent() } catch (error) { rethrowContinuation(error); current = { status: 'unavailable' } }
  let messages: Messages = buildWorkerMessages(opts.aiCatalog, { prefix: roleKey, context: opts.context, history: opts.history, brief: { ...opts.job, current }, ...(knowledge ? { knowledge } : {}) })
  // The worker sees full manuals: it has few tools and they are fixed for the job.
  const params = { server_quote: true, include_manual: true }
  const toolParams = () => Object.fromEntries(specs.map(spec => [spec.function.name, { card: false, include_manual: true }]))
  const calls: { tool: string; status: string }[] = []
  // Workers with knowledge: what they saved travels to Bob as receipts, in code (no AI restates ids).
  const receipts: Record<string, unknown>[] = []
  let previous: string | undefined
  for (let step = 0; step < opts.worker.max_steps; step++) {
    if (!await opts.hasAccess()) throw new Error('project_denied')
    if (Date.now() + 15_000 >= opts.deadline) return opts.readKnowledge ? { status: 'time_budget', worker: roleKey, calls, receipts } : { status: 'time_budget', worker: roleKey, calls }
    if (step) specs = await offer()
    const images = opts.images?.carrier() ?? []
    const response = await opts.callModel({ app: 'bob', coworkerId: 'bob', functionName: roleKey, aiFunction: roleKey, module: 'global', userId: opts.userId,
      catalogRoleKey: roleKey, ...(opts.variables ? { catalogVariables: opts.variables } : {}), messages: [...messages, ...images], tools: specs, catalogSchemaParameters: params, catalogToolParameters: toolParams(),
      ...(previous ? { previousResponseId: previous } : {}), maxOutputTokens: 8000,
      timeoutMs: Math.max(1000, Math.min(opts.modelTimeoutMs ?? 45_000, opts.deadline - Date.now())) })
    const done = (result: Record<string, unknown>) => opts.readKnowledge ? { ...result, receipts } : result
    if (!response.success) {
      if (response.error === 'turn_budget_exhausted') throw new Error('turn_budget_exhausted')
      return done({ status: 'unavailable', worker: roleKey, calls })
    }
    if (images.length) opts.images!.confirmDelivery()
    if (!response.toolCalls?.length) return done({ status: 'ok', worker: roleKey, report: typeof response.data === 'string' ? response.data : '', calls })
    if (!response.responseId) return done({ status: 'unavailable', worker: roleKey, calls })
    previous = response.responseId; messages = []
    for (const call of response.toolCalls.slice(0, 8)) {
      if (!await opts.hasAccess()) throw new Error('project_denied')
      let args: unknown = null
      try { args = JSON.parse(call.function.arguments) } catch { /* the handler reports invalid input */ }
      const name = call.function.name, began = Date.now()
      let result: any
      if (!allowed.has(name)) result = { status: 'not_offered' }
      else {
        try { result = await opts.session.execute(name, args) }
        catch (error) { rethrowContinuation(error); throw error }
      }
      if (result && typeof result === 'object' && 'diagnostics' in result) { const { diagnostics: _d, ...content } = result; result = content }
      const status = String(result?.status ?? 'returned')
      calls.push({ tool: NAME.test(name) ? name : 'invalid_name', status })
      if (status === 'saved') receipts.push(saveReceipt(name, result))
      const rejection = ['invalid', 'conflict'].includes(status) ? toolRejection(result) : undefined
      try { opts.onTool?.({ name: NAME.test(name) ? name : 'invalid_name', status, ms: Date.now() - began, ...(rejection ? { rejection } : {}) }) } catch { /* diagnostics only */ }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
    for (const call of response.toolCalls.slice(8)) messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'deferred' }) })
  }
  return opts.readKnowledge ? { status: 'step_budget', worker: roleKey, calls, receipts } : { status: 'step_budget', worker: roleKey, calls }
}

const RECEIPT_KEYS = ['artifact_id', 'record_id', 'id', 'revision', 'construction_revision', 'request_id', 'step_id']
/** The ids and revisions a save returned, copied by code. */
export function saveReceipt(tool: string, result: unknown): Record<string, unknown> {
  const receipt: Record<string, unknown> = { tool }
  if (result && typeof result === 'object') for (const key of RECEIPT_KEYS) {
    const value = (result as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.length <= 200 || typeof value === 'number' && Number.isFinite(value)) receipt[key] = value
  }
  return receipt
}
