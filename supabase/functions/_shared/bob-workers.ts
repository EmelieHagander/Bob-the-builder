import type { AiCatalogSession } from './ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import type { WorkingContext } from './bob-working-context.ts'
import { countSerializedTokens } from './bob-token-budget.ts'
import { workpadFrame, type WorkpadSnapshot } from './bob-agent-workpad.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { toolRejection, type ToolRejection } from './tool-rejection.ts'
import type {ContextSurface} from './bob-context-continuation.ts'

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
/** Owner decision 2026-11-06 (worker_focus_version 1): the tools a job is
 * offered. `core` always; up to `optional_limit` of `optional` picked from
 * Bob's request at job start; the rest of the worker's tools stay owned but
 * are not offered. Measured: two of Konrad's 25 tools were 75 % of his calls. */
export interface WorkerFocus { version: 1; core: string[]; optional: string[]; optional_limit: number }
export interface WorkerDefinition { role: string; tool: string; tools: string[]; reads: string[]; max_steps: number; knowledge?: WorkerKnowledge[]; focus?: WorkerFocus }
type Messages = NonNullable<OpenAIServiceOptions['messages']>
type ModelCall = (options: OpenAIServiceOptions, beforeDispatch?: () => Promise<void>) => Promise<OpenAIServiceResponse<string>>
const NAME = /^[a-z][a-z0-9_]{0,63}$/
/** An answer cut at the output limit, or not finished (streaming or still
 * thinking) when its request window closed, ran nothing. Bob and colleagues
 * get this once per pending step, so the same job continues in smaller pieces
 * (bed and entry, 2026-11-06). */
export const MODEL_OUTPUT_LIMIT_NOTE = 'Your previous answer did not finish within one response and was discarded: none of its tool calls ran and nothing was saved. Continue the same task in smaller steps: one change per tool call, with brief commentary.'
const CUT_ANSWER = new Set(['model_output_limit', 'model_output_window'])
export function withOutputLimitNote(messages: Messages, error: string | undefined): Messages | null {
  if (!CUT_ANSWER.has(error ?? '') || messages.some(m => m.role === 'user' && m.content === MODEL_OUTPUT_LIMIT_NOTE)) return null
  return [...messages, { role: 'user', content: MODEL_OUTPUT_LIMIT_NOTE }]
}

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
        || worker.knowledge !== undefined && !validKnowledge(worker)
        || worker.focus !== undefined && !validFocus(worker))
        throw new Error('worker_catalog_invalid')
      workers[key] = worker
    }
  }
  const owned = Object.values(workers).flatMap(worker => worker.tools)
  if (new Set(owned).size !== owned.length) throw new Error('worker_catalog_invalid')
  return structuredClone(workers)
}

// A plan sent as JSON text is the same plan (bed, 2026-11-07); the workpad
// tool reads it the same way before saving it.
const notePlan = (note: unknown): unknown => { if (typeof note !== 'string') return note; try { return JSON.parse(note) } catch { return null } }
/** A plan: a working or waiting note with a goal and at least one step. */
const plannedNote = (raw: unknown): boolean => { const note = notePlan(raw); return !!note && typeof note === 'object'
  && ['working', 'waiting'].includes(String((note as { status?: unknown }).status))
  && typeof (note as { goal?: unknown }).goal === 'string' && (note as { goal: string }).goal.trim().length > 0
  && Array.isArray((note as { steps?: unknown }).steps) && (note as { steps: unknown[] }).steps.length > 0 }

function validFocus(worker: WorkerDefinition): boolean {
  const focus = worker.focus
  if (!focus || typeof focus !== 'object' || focus.version !== 1 || !Array.isArray(focus.core) || !Array.isArray(focus.optional)) return false
  const own = new Set([...worker.tools, ...worker.reads])
  const names = [...focus.core, ...focus.optional]
  return focus.core.length > 0 && names.every(name => typeof name === 'string' && own.has(name)) && new Set(names).size === names.length
    && Number.isSafeInteger(focus.optional_limit) && focus.optional_limit >= 0 && focus.optional_limit <= 8
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
  knowledge?: Record<string, unknown>; workpad?: WorkpadSnapshot;
}): Messages {
  const stair = opts.context?.stair
  return [
    ...(stair ? [{ role: 'user' as const, content: aiCatalog.text(opts.prefix + '.project') + '\n' + JSON.stringify({ locked_at: stair.snapshotLockedAt, ...stair.snapshot }) }] : []),
    { role: 'user', content: aiCatalog.text(opts.prefix + '.conversation') },
    ...opts.history,
    ...(opts.knowledge ? [
      { role: 'user' as const, content: aiCatalog.text(opts.prefix + '.knowledge') + '\n' + JSON.stringify(opts.knowledge) },
    ] : []),
    ...(opts.workpad ? [{ role: 'user' as const, content: workpadFrame(opts.workpad) }] : []),
    ...(opts.knowledge ? [{ role: 'user' as const, content: aiCatalog.text(opts.prefix + '.request') + '\n' + opts.brief.job }]
      : [{ role: 'user' as const, content: aiCatalog.text(opts.prefix + '.brief') + '\n' + JSON.stringify(opts.brief) }]),
  ]
}

/** Owner decision 2026-11-01 (job da79a46e, "CPU Time exceeded" on every resume):
 * a worker job runs inside one of Bob's tool calls, so each resume replayed the
 * whole job from its first step. Jobs pinned with workerCheckpointVersion save the
 * worker's place after each finished step, and a resume continues from there. */
interface WorkerProgressBase {
  step: number; messages: Messages
  calls: { tool: string; status: string }[]; receipts: Record<string, unknown>[]; order: string[]
  /** Plan gate: a plan note was saved in this job, so writes are open. */
  planned?: true
}
type WorkerTerminal =
  | { status: 'awaiting_design_review'; receiptIndex: number }
  | { status: 'needs_verification'; reason: string; receiptIndex: number }
  | { status: 'needs_verification'; reason: 'construction_piece_write_conflict'; blockedTool: string }
export type WorkerProgress = WorkerProgressBase & (
  | { version: 1; previous: string }
  | { version: 2; previous: string | null; renewal: {
    resets: number; savedReceiptIndex: number | null; notedRevision: number | null
  } }
  | { version: 3; previous: null; terminal: WorkerTerminal }
)
function validTerminal(value: unknown, receipts: unknown[]): value is WorkerTerminal {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const receipt = Number.isSafeInteger(v.receiptIndex) && Number(v.receiptIndex) >= 0 && Number(v.receiptIndex) < receipts.length
  return v.status === 'awaiting_design_review' && receipt
    || v.status === 'needs_verification' && typeof v.reason === 'string' && NAME.test(v.reason)
      && (v.reason === 'construction_piece_write_conflict' ? typeof v.blockedTool === 'string' && NAME.test(v.blockedTool) : receipt)
}
export function validWorkerProgress(value: unknown, maxSteps: number): value is WorkerProgress {
  const v = value as Partial<WorkerProgress> | null
  const renewal = (v as { renewal?: { resets?: unknown; savedReceiptIndex?: unknown; notedRevision?: unknown } } | null)?.renewal
  const index = (n: unknown) => n === null || Number.isSafeInteger(n) && Number(n) >= 0
  return !!v && typeof v === 'object' && (v.version === 1
      ? typeof v.previous === 'string' && !!v.previous
      : v.version === 3 ? v.previous === null && Array.isArray(v.messages) && v.messages.length === 0
        && Array.isArray(v.receipts) && validTerminal(v.terminal, v.receipts)
      : v.version === 2 && (typeof v.previous === 'string' && !!v.previous || v.previous === null && !!v.messages?.length)
        && !!renewal && Number.isSafeInteger(renewal.resets) && Number(renewal.resets) >= 0 && Number(renewal.resets) <= 2
        && index(renewal.savedReceiptIndex) && index(renewal.notedRevision)
        && (v.previous !== null || Number(renewal.resets) > 0))
    && Number.isSafeInteger(v.step) && v.step! >= 0 && v.step! < maxSteps && Array.isArray(v.messages)
    && Array.isArray(v.calls) && v.calls.every(c => !!c && typeof c.tool === 'string' && typeof c.status === 'string')
    && Array.isArray(v.receipts) && v.receipts.every(r => !!r && typeof r === 'object' && !Array.isArray(r))
    && Array.isArray(v.order) && v.order.every(name => typeof name === 'string' && NAME.test(name))
    && (v.planned === undefined || v.planned === true)
    && (v.version !== 2 || (renewal?.savedReceiptIndex === null || Number(renewal?.savedReceiptIndex) < v.receipts.length))
}

/** A readback is authoritative only for the exact revision a tool saved. An
 * overview is evidence of persistence, not approval of its structure. */
function verifiedConstructionSave(receipt: Record<string, unknown>, readback: unknown[]): Record<string, unknown> | null {
  const artifact = typeof receipt.artifact_id === 'string' ? receipt.artifact_id : receipt.record_id
  const revision = receipt.revision
  if (typeof artifact !== 'string' || !Number.isSafeInteger(revision) || Number(revision) < 1
    || !['save_construction_draft', 'edit_construction_parts', 'change_construction_parameters',
      'change_construction_roles', 'continue_construction_change', 'transition_legacy_drawing'].includes(String(receipt.tool))) return null
  const entry = (readback[0] as { construction?: Record<string, unknown> } | undefined)?.construction
  return entry?.status === 'ok' && entry.archived !== true && entry.artifact_id === artifact && entry.revision === revision
    ? { artifact_id: artifact, revision, ...(typeof entry.source_state === 'string' ? { source_state: entry.source_state } : {}) }
    : null
}

/** A piece is confirmed only after reopening the exact current revision. A
 * successful save (or its automatic check) does not by itself prove persistence
 * or that the requested design is complete. */
export function verifiedConstructionPiece(receipt: Record<string, unknown>, opened: unknown): { artifact_id: string; revision: number } | null {
  const id = typeof receipt.artifact_id === 'string' ? receipt.artifact_id : receipt.record_id
  const rev = receipt.revision
  const row = opened as Record<string, unknown> | null
  return typeof id === 'string' && Number.isSafeInteger(rev) && Number(rev) > 0
    && row?.status === 'ok' && row.artifact_id === id && row.revision === rev
    && row.current_revision === rev && row.source_state === 'current' && row.archived === false
    ? { artifact_id: id, revision: Number(rev) } : null
}

const CONSTRUCTION_PIECE_WRITES = new Set([
  'save_construction_draft', 'edit_construction_parts', 'change_construction_parameters',
  'change_construction_roles', 'commit_construction_sketch',
])
/** A call that can save a construction revision. Owner decision 2026-11-07
 * (sketchbook B): a sketched part change and reading, rebasing or discarding a
 * sketch save nothing, so several may follow each other in one batch. */
const pieceWrite = (name: string, args: unknown) => {
  if (!CONSTRUCTION_PIECE_WRITES.has(name)) return false
  const a = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  if (name === 'edit_construction_parts' || name === 'save_construction_draft') return a.mode !== 'sketch'
  if (name === 'commit_construction_sketch') return a.action === 'commit'
  return true
}

export async function runWorker(opts: {
  aiCatalog: AiCatalogSession; worker: WorkerDefinition; callModel: ModelCall; userId: string
  job: { job: string; findings: string | null }; context?: WorkingContext; history: Messages
  session: { prepare(): Promise<NonNullable<OpenAIServiceOptions['tools']>>; execute(name: string, args: unknown): Promise<any> }
  readCurrent: () => Promise<unknown>; hasAccess: () => Promise<boolean>; deadline: number; modelTimeoutMs?: number
  /** Workers with knowledge reads: their fresh results, and the persona's variables (the project's name). */
  readKnowledge?: () => Promise<Record<string, unknown>>; variables?: Record<string, string>
  /** A note is separate from the immutable worker model/checkpoint chain. */
  workpadEnabled?: boolean; workpad?: WorkpadSnapshot
  /** New claimed Konrad jobs only: one construction mutation per model batch,
   * followed by a code-only readback before the next piece can be attempted. */
  pieceProgress?: { unmappedReview?:boolean;
    readSaved(receipt: Record<string, unknown>): Promise<unknown>
    /** New v2 jobs only. Inspect exact saved FORM scope and persisted part changes in code. */
    inspectSaved?(receipt: Record<string, unknown>, toolArgs: unknown): Promise<Record<string, unknown>>
    /** v4: database-enforced, exact-revision facade hold for legacy/no-FORM geometry. */
    readBoundedReview?(receipt: Record<string, unknown>): Promise<Record<string, unknown>>
    /** v3: a checked piece ends this hand-over for natural visual review. */
    pauseForDesignReview?: boolean
    /** Owner decision 2026-11-07 (workerGatesVersion 1): an incomplete piece
     * readback, check or form scope, and a rejected piece write, are facts in
     * the tool result that Konrad acts on in the same job, not the end of it.
     * Since piece progress v2–v4 went live, 1 of 33 hand-overs ended ok. */
    gatesAsFacts?: boolean
  }
  /** Pinned only for new claimed structure jobs with durable workpads. A fresh
   * chain is allowed after a persisted note and an exact saved-record readback. */
  verifiedRenewal?: { loadWorkpad(step: number): Promise<WorkpadSnapshot> }
  /** Pinned per job (workerFocusVersion 1) for workers with a catalog focus:
   * picks up to the focus limit of the optional tools from Bob's request at
   * job start. A resumed job keeps the tools it was offered. */
  focus?: { pick(candidates: string[]): Promise<string[] | null> }
  /** Pinned per job (workerPlanVersion 1): a construction write before a plan
   * note in this job's workpad is refused with plan_required; reads and checks
   * are not. The list of tools does not change, so the prompt cache holds. */
  planGate?: boolean
  /** Pixels the worker opened go with the worker's own next call (not Bob's), and are confirmed after it. */
  images?: { validate?:()=>Promise<boolean>; carrier: () => Messages; confirmDelivery: () => void }
  /** Reads what the worker saved, by code, after the job (see readbackReads). */
  readback?: (receipts: Record<string, unknown>[]) => Promise<unknown[]>
  /** Checks, by code, each saved construction revision the job left unchecked; returns the check results. */
  autoCheck?: (targets: { artifact_id: string; revision: number; component_ids?: string[] }[]) => Promise<Record<string, unknown>[]>
  onTool?: (value: { name: string; status: string; ms: number; rejection?: ToolRejection }) => void
  /** Owner decision 2026-11-01: a job stopped by the spending stop reports back
   * paused_at_limit with what it saved, instead of failing Bob's turn. */
  stopAsResult?: boolean
  /** Pinned per job (workerCheckpointVersion): the place saved after each step, and the save. */
  boundDrawingWork?:boolean;
  runtimeSurface?:()=>import('./runtime-tool-surface.ts').RuntimeToolSurface;
  stageContext?: boolean;
  registerContextSurface?: (role: string, refresh: () => Promise<ContextSurface>) => () => void;
  progress?: { restored?: WorkerProgress; save(progress: WorkerProgress): Promise<void>; afterStep?(): void }
  /** Drops the worker's model chain once it has returned; it is never continued. */
  releaseChain?: (responseId: string) => void
  /** Pinned per job (stable_tools_version 1): core tools first, with a fixed
   * cache point after them. */
  stableTools?: boolean
  /** Pinned per job (refusal_guard_version 1): the third plan refusal asks for another approach. */
  refusalGuard?: boolean
  /** Owner decision 2026-11-07 (sketchbook B): sketches still open when the job
   * ends are reported as not saved; null when they could not be read. */
  openSketches?: () => Promise<Record<string, unknown>[] | null>
}): Promise<Record<string, unknown>> {
  const roleKey = opts.worker.role.replace(/^role\./, '')
  const restored = opts.progress?.restored
  const focus = opts.focus && opts.worker.focus ? opts.worker.focus : null
  // With a focus the job is offered its core tools and the picked optional
  // ones, fixed for the job; a resumed job reads its picks from the offered
  // order instead of asking again.
  const picked = !focus ? [] : restored ? restored.order.filter(name => focus.optional.includes(name))
    : ((await opts.focus!.pick(focus.optional)) ?? []).filter(name => focus.optional.includes(name)).slice(0, focus.optional_limit)
  const allowed = new Set([...(focus ? [...focus.core, ...picked] : [...opts.worker.tools, ...opts.worker.reads]), ...(opts.workpadEnabled ? ['update_workpad'] : [])])
  // The plan gate: construction writes wait for a plan note saved in this job.
  const writes = new Set(opts.worker.tools.filter(name => name !== 'check_construction_draft'))
  let planned = restored?.planned === true
  let planRefusals = 0
  // The worker's session also offers tools that wait for a prerequisite (saving a
  // reviewed drawing), so the list is the same in every step and the prompt start
  // stays cached; calling one too early answers "not available yet". Prepared each
  // step so a disabled tool still disappears; the order never changes.
  const order: string[] = []
  // Stable tools (owner decision 2026-11-07): the core tools and the workpad
  // go first, in the catalog's focus order, so every job of this worker starts
  // with the same tool definitions and reads them from cache.
  const stablePrefix = opts.stableTools && focus ? [...focus.core, ...(opts.workpadEnabled ? ['update_workpad'] : [])] : []
  const offer = async () => {
    const offered = (await opts.session.prepare()).filter(spec => allowed.has(spec.function.name))
    if (!order.length) for (const name of stablePrefix) if (offered.some(spec => spec.function.name === name)) order.push(name)
    for (const spec of offered) if (!order.includes(spec.function.name)) order.push(spec.function.name)
    return order.flatMap(name => offered.filter(spec => spec.function.name === name))
  }
  // The last offered tool of the stable prefix, when the prefix leads the list.
  const cacheAfterTool = (offered: { function: { name: string } }[]) => {
    let last: string | undefined
    for (const spec of offered) { if (!stablePrefix.includes(spec.function.name)) break; last = spec.function.name }
    return last
  }
  let previous: string | undefined = restored?.previous ?? undefined
  if (restored && !validWorkerProgress(restored, opts.worker.max_steps)) throw new Error('worker_checkpoint_invalid')
  if (restored && restored.version !== 3 && restored.version !== (opts.verifiedRenewal ? 2 : 1)) throw new Error('worker_checkpoint_invalid')
  const renewal = restored?.version === 2 ? structuredClone(restored.renewal)
    : { resets: 0, savedReceiptIndex: null as number | null, notedRevision: null as number | null }
  // A resumed job already read its knowledge and holds its place; the next step offers the tools again.
  if (restored) order.push(...restored.order)
  let specs = restored ? [] : await offer()
  if (!restored && !specs.length) return { status: 'unavailable', worker: roleKey }
  let current: unknown, knowledge: Record<string, unknown> | undefined
  if (restored) { /* the first messages went with the saved chain */ }
  else if (opts.readKnowledge) knowledge = await opts.readKnowledge()
  else try { current = await opts.readCurrent() } catch (error) { rethrowContinuation(error); current = { status: 'unavailable' } }
  let messages: Messages = restored ? structuredClone(restored.messages)
    : buildWorkerMessages(opts.aiCatalog, { prefix: roleKey, context: opts.context, history: opts.history, brief: { ...opts.job, current },
      ...(knowledge ? { knowledge } : {}), ...(opts.workpad ? { workpad: opts.workpad } : {}) })
  // The worker sees full manuals: it has few tools and they are fixed for the job.
  const params = { server_quote: true, include_manual: true }
  const toolParams = () => Object.fromEntries(specs.map(spec => [spec.function.name, { card: false, include_manual: true, ...(spec.function.name==='list_project_category'?{categories:(spec.function.parameters as any).properties.category.enum}:{}) }]))
  const calls: { tool: string; status: string }[] = structuredClone(restored?.calls ?? [])
  // Workers with knowledge: what they saved travels to Bob as receipts, in code (no AI restates ids),
  // and with the readback switch the saved records themselves, read after the job.
  const receipts: Record<string, unknown>[] = structuredClone(restored?.receipts ?? [])
  // Last, after any server work that can yield: a resumed worker still finds its chain.
  const release = () => { if (previous) opts.releaseChain?.(previous) }
  const finish = async (reported: Record<string, unknown>) => {
    let result = reported
    if (opts.openSketches) {
      const open = await opts.openSketches()
      if (open === null) result = { ...result, open_sketches: { status: 'unavailable', note: 'Whether a construction sketch is still open could not be read.' } }
      else if (open.length) result = { ...result, open_sketches: { status: 'not_saved', sketches: open,
        note: 'These sketched changes are not saved. Ask Konrad to commit or discard them in this request; they are dropped when it ends.' } }
    }
    if (!opts.readKnowledge) { release(); return result }
    const targets = opts.autoCheck ? uncheckedConstructions(receipts) : []
    if (targets.length) for (const checked of await opts.autoCheck!(targets))
      receipts.push({ ...saveReceipt('check_construction_draft', checked), status: String(checked.status ?? 'returned'), by: 'code' })
    const readback = opts.readback && receipts.length ? await opts.readback(receipts) : undefined
    release()
    return { ...result, receipts, ...(readback?.length ? { readback } : {}) }
  }
  const terminalResult = (terminal: WorkerTerminal): Record<string, unknown> => ({
    status: terminal.status, worker: roleKey, calls,
    ...('blockedTool' in terminal ? { reason: terminal.reason, blocked_tool: terminal.blockedTool }
      : terminal.status === 'needs_verification' ? { reason: terminal.reason, saved_receipt: receipts[terminal.receiptIndex] }
      : { reason: 'show_saved_construction', saved_receipt: receipts[terminal.receiptIndex], user_feedback: 'not_recorded',
        note: 'A saved and technically checked piece is not user approval. Show this exact construction revision and its matching facade (if present), then ask naturally if the visible design matches before proceeding to the next piece. A spatial gate does not prove window count or FORM mapping.' }),
  })
  if (restored?.version === 3) {
    if (!await opts.hasAccess()) throw new Error('project_denied')
    return finish(terminalResult(restored.terminal))
  }
  if (restored && opts.pieceProgress?.readBoundedReview && !opts.pieceProgress.gatesAsFacts) {
    const rejected = calls.findLast(c => CONSTRUCTION_PIECE_WRITES.has(c.tool) && c.status === 'conflict')
    if (rejected) {
      if (!await opts.hasAccess()) throw new Error('project_denied')
      return finish(terminalResult({ status: 'needs_verification', reason: 'construction_piece_write_conflict', blockedTool: rejected.tool }))
    }
  }
  // Old snapshots saved the step before its stop decision. Never continue a
  // second piece from such a snapshot; recover the saved record through finish.
  if (restored && opts.pieceProgress?.pauseForDesignReview) {
    const index = receipts.findLastIndex(r => CONSTRUCTION_PIECE_WRITES.has(String(r.tool)))
    if (index >= 0) {
      if (!await opts.hasAccess()) throw new Error('project_denied')
      return finish(terminalResult({ status: 'needs_verification', reason: 'interrupted_piece_verification', receiptIndex: index }))
    }
  }
  const validateStage = async () => {
    if (!await opts.hasAccess()) throw new Error('project_denied')
    if (opts.images?.validate && !await opts.images.validate()) throw new Error('visual_context_unavailable')
  }
  const unregister = opts.stageContext ? opts.registerContextSurface?.(roleKey,async()=>{
    await validateStage(); specs=await offer()
    return {tools:specs,catalogSchemaParameters:params,catalogToolParameters:toolParams(),
      ...(opts.runtimeSurface?{catalogRuntimeSurface:opts.runtimeSurface()}:{})}
  }) : undefined
  try {
  for (let step = restored ? restored.step + 1 : 0; step < opts.worker.max_steps; step++) {
    if (!await opts.hasAccess()) throw new Error('project_denied')
    if (Date.now() + 15_000 >= opts.deadline) return finish({ status: 'time_budget', worker: roleKey, calls })
    if (step) specs = await offer()
    if(opts.images?.validate&&!await opts.images.validate())return finish({status:'unavailable',worker:roleKey,reason:'visual_context_unavailable',calls})
    const images = opts.images?.carrier() ?? []
    const response = await opts.callModel({ app: 'bob', coworkerId: 'bob', functionName: roleKey, aiFunction: roleKey, module: 'global', userId: opts.userId,
      ...(opts.stageContext ? { responseItemsMode: 'preserve' as const } : {}),
      catalogRoleKey: roleKey, ...(opts.runtimeSurface?{catalogRuntimeSurface:opts.runtimeSurface()}:{}), ...(opts.boundDrawingWork?{catalogDrawingWork:true}:{}), ...(opts.variables ? { catalogVariables: opts.variables } : {}), messages: [...messages, ...images], tools: specs, catalogSchemaParameters: params, catalogToolParameters: toolParams(),
      ...(previous ? { previousResponseId: previous } : {}), maxOutputTokens: 8000,
      ...(cacheAfterTool(specs) ? { cacheAfterTool: cacheAfterTool(specs) } : {}),
      timeoutMs: Math.max(1000, Math.min(opts.modelTimeoutMs ?? 45_000, opts.deadline - Date.now())) }, opts.stageContext ? validateStage : undefined)
    if (!response.success) {
      if (response.error === 'turn_budget_exhausted' && opts.stopAsResult) return finish({ status: 'paused_at_limit', worker: roleKey, calls })
      if (response.error === 'turn_budget_exhausted') throw new Error('turn_budget_exhausted')
      const noted = withOutputLimitNote(messages, response.error)
      if (noted) { messages = noted; continue }
      return finish({ status: 'unavailable', worker: roleKey, calls })
    }
    if (images.length) opts.images!.confirmDelivery()
    if (!response.toolCalls?.length) return finish({ status: 'ok', worker: roleKey, report: typeof response.data === 'string' ? response.data : '', calls })
    if (!response.responseId) return finish({ status: 'unavailable', worker: roleKey, calls })
    previous = response.responseId; messages = []
    let pieceWriteSeen = false
    let rejectedBoundedPiece: string | null = null
    let pieceReviewReceipt: Record<string, unknown> | null = null
    let incompletePiece: { receipt: Record<string, unknown>; reason: string } | null = null
    for (const call of response.toolCalls.slice(0, 8)) {
      if (!await opts.hasAccess()) throw new Error('project_denied')
      let args: unknown = null
      try { args = JSON.parse(call.function.arguments) } catch { /* the handler reports invalid input */ }
      const name = call.function.name, began = Date.now()
      let result: any
      // A parallel tool batch cannot rely on a save it has not observed yet.
      // Answer every tool_call_id, but require Konrad to see the saved revision
      // before issuing any further calls, including an updated workpad note.
      if (opts.pieceProgress && pieceWriteSeen) result = { status: 'deferred', reason: 'construction_piece_boundary',
        message: 'First read the preceding construction save and its verification. Reissue this call only if still needed.' }
      else if (!allowed.has(name)) result = { status: 'not_offered' }
      else if (opts.planGate && !planned && writes.has(name)) result = { status: 'invalid', reason: 'plan_required',
        validation: { code: 'plan_required', fields: [] },
        message: 'Write your plan with update_workpad first: the goal, the steps in order and the next step. Then make the change.',
        // Owner review 2026-11-07: the plan gate answers here, not through the
        // tool session, so it counts its own refusals for the refusal guard.
        ...(opts.refusalGuard && ++planRefusals >= 3 ? { repeated: { count: planRefusals, reason: 'plan_required',
          note: 'Refused ' + planRefusals + ' times without a saved plan. Do not try the change again yet: call update_workpad with note as an object whose status is working, with a goal, next_step and at least one step, and empty blockers and references when there are none; then make the change.' } } : {}) }
      else {
        try { result = await opts.session.execute(name, args) }
        catch (error) { rethrowContinuation(error); throw error }
      }
      if (opts.pieceProgress && allowed.has(name) && pieceWrite(name, args) && !pieceWriteSeen) pieceWriteSeen = true
      if (result && typeof result === 'object' && 'diagnostics' in result) { const { diagnostics: _d, ...content } = result; result = content }
      const status = String(result?.status ?? 'returned')
      // A v4 spatially guarded edit whose canonical writer says conflict cannot
      // be repaired by changing unrelated parts or reading forever in this
      // worker chain. Return to Bob so the current Plan/source is reconciled.
      // Older worker contracts without a bounded review stay unchanged.
      if (opts.pieceProgress?.readBoundedReview && !opts.pieceProgress.gatesAsFacts && pieceWrite(name, args) && status === 'conflict')
        rejectedBoundedPiece = name
      calls.push({ tool: NAME.test(name) ? name : 'invalid_name', status })
      // A check stores its result too, so it is reported (and read back) like a save.
      if (status === 'saved' || status === 'checked') {
        receipts.push(saveReceipt(name, result))
        if (status === 'saved' && opts.verifiedRenewal) {
          renewal.savedReceiptIndex = receipts.length - 1
          renewal.notedRevision = null
        }
      }
      if (opts.pieceProgress && CONSTRUCTION_PIECE_WRITES.has(name) && status === 'saved') {
        const receipt = receipts.at(-1)!
        pieceReviewReceipt = receipt
        let opened: unknown
        try { opened = await opts.pieceProgress.readSaved(receipt) }
        catch (error) {
          rethrowContinuation(error)
          if (error instanceof Error && error.message === 'project_denied') throw error
          opened = { status: 'unavailable' }
        }
        const confirmed = verifiedConstructionPiece(receipt, opened)
        let pieceEvidence: Record<string, unknown> | undefined
        if (confirmed && opts.pieceProgress.inspectSaved) {
          try { pieceEvidence = await opts.pieceProgress.inspectSaved(receipt, args) }
          catch (error) { rethrowContinuation(error); if (error instanceof Error && error.message === 'project_denied') throw error;
            pieceEvidence = { status: 'unavailable', reason: 'form_evidence_read_failed' } }
          // The same code-authored evidence reaches Bob in the receipt; Konrad
          // cannot upgrade this to a declaration that the assignment is done.
          receipt.piece_evidence = pieceEvidence
        }
        let boundedReview: Record<string, unknown> | undefined
        if (confirmed && opts.pieceProgress.readBoundedReview) {
          try { boundedReview = await opts.pieceProgress.readBoundedReview(receipt) }
          catch (error) { rethrowContinuation(error); if (error instanceof Error && error.message === 'project_denied') throw error;
            boundedReview = { status: 'unavailable' } }
        }
        const heldExactPiece = !!confirmed && boundedReview?.status === 'awaiting_review'
          && boundedReview.artifact_id === confirmed.artifact_id && boundedReview.saved_revision === confirmed.revision
          && ['front','back','left','right','top'].includes(String(boundedReview.pending_view))
        if (heldExactPiece) receipt.construction_review_boundary = {
          status: 'awaiting_review', artifact_id: confirmed.artifact_id, revision: confirmed.revision,
          view_id: boundedReview!.pending_view, verification: 'unverified', form_mapping_not_inferred: true,
        }
        let checked = result?.check
        let checkedByAuto = false
        // The write-state wrapper already checks ordinary saves and part edits.
        // Other construction writes (for example roles) need the same server
        // check before the next piece; no extra model review is introduced.
        if (confirmed && checked?.status !== 'checked' && opts.autoCheck) {
          const [fresh] = await opts.autoCheck([confirmed])
          checked = fresh
          if (fresh) {
            receipts.push({ ...saveReceipt('check_construction_draft', fresh),
              status: String(fresh.status ?? 'returned'), by: 'code' })
            checkedByAuto = true
          }
        }
        // The write-state wrapper already performed the server check on the
        // saved revision. Record that fact, so finish() does not check it again.
        if (confirmed && checked?.status === 'checked' && !checkedByAuto)
          receipts.push({ ...saveReceipt('check_construction_draft', confirmed), status: 'checked', by: 'write_state' })
        let localCheck: Record<string, unknown> | undefined
        const ids = pieceEvidence?.status === 'form_scoped' && pieceEvidence.affected_scope_complete === true
          && Array.isArray(pieceEvidence.scope_check_ids) ? pieceEvidence.scope_check_ids as string[] : []
        if (confirmed && ids.length && opts.autoCheck) {
          const [local] = await opts.autoCheck([{ ...confirmed, component_ids: ids }])
          localCheck = { status: local?.status ?? 'unavailable', concept_ready: local?.concept_ready === true,
            component_ids: ids, functional_fidelity: 'unverified' }
          if (local?.status === 'checked') receipts.push({ ...saveReceipt('check_construction_draft', local),
            status: 'checked', by: 'code_local', component_ids: ids })
        }
        // A bounded status goes back to the model, not the full overview/table.
        result = { ...result, piece_readback: confirmed
          ? { status: 'verified', ...confirmed, approval_not_implied: true }
          : { status: 'unverified', reason: 'saved_revision_readback_missing', approval_not_implied: true },
          piece_check: { status: checked?.status ?? 'unavailable', concept_ready: checked?.concept_ready === true },
          ...(pieceEvidence ? { piece_evidence: pieceEvidence } : {}), ...(localCheck ? { piece_local_check: localCheck } : {}),
          ...(receipt.construction_review_boundary ? { construction_review_boundary: receipt.construction_review_boundary } : {}) }
        const unmappedReview=opts.pieceProgress.unmappedReview&&pieceEvidence?.status==='construction_scoped'&&pieceEvidence.artifact_id===confirmed?.artifact_id&&pieceEvidence.revision===confirmed?.revision&&boundedReview?.status==='not_configured'
        if (!confirmed) incompletePiece = { receipt, reason: 'saved_revision_readback_missing' }
        else if (checked?.status !== 'checked') incompletePiece = { receipt, reason: 'saved_revision_check_incomplete' }
        else if (opts.pieceProgress.readBoundedReview && !heldExactPiece && boundedReview?.status !== 'not_configured')
          incompletePiece = { receipt, reason: 'construction_review_gate_missing' }
        else if (opts.pieceProgress.inspectSaved && pieceEvidence?.status === 'no_form_scope' && !heldExactPiece)
          incompletePiece = { receipt, reason: 'saved_form_scope_missing' }
        else if (opts.pieceProgress.inspectSaved && (pieceEvidence?.status !== 'form_scoped'
          || pieceEvidence.affected_scope_complete !== true) && !heldExactPiece && !unmappedReview)
          incompletePiece = { receipt, reason: pieceEvidence?.status === 'form_scoped'
            ? 'saved_form_scope_unbounded' : 'saved_form_evidence_unavailable' }
        else if (localCheck && localCheck.status !== 'checked') incompletePiece = { receipt, reason: 'saved_local_check_incomplete' }
        // The same finding goes to Konrad as a fact; he decides whether to
        // correct, re-read or report back. The receipt still reaches Bob.
        if (incompletePiece && opts.pieceProgress.gatesAsFacts) {
          result = { ...result, piece_open: { reason: incompletePiece.reason, saved: true, approval_not_implied: true,
            note: 'The piece is saved, but this verification is open. Correct it, re-read it, or report it to Bob; do not repeat the same change.' } }
          incompletePiece = null
        }
      }
      if (name === 'update_workpad' && status === 'noted' && result?.unchanged !== true
        && renewal.savedReceiptIndex !== null && Number.isSafeInteger(result?.revision))
        renewal.notedRevision = result.revision
      if (name === 'update_workpad' && status === 'noted' && plannedNote((args as { note?: unknown } | null)?.note)) planned = true
      const rejection = ['invalid', 'conflict'].includes(status) ? toolRejection(result) : undefined
      try { opts.onTool?.({ name: NAME.test(name) ? name : 'invalid_name', status, ms: Date.now() - began, ...(rejection ? { rejection } : {}) }) } catch { /* diagnostics only */ }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
    for (const call of response.toolCalls.slice(8)) messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'deferred' }) })
    // Persist the stop itself before finishing can yield. No pending tool
    // messages or completed provider chain belong in a terminal checkpoint.
    const terminal: WorkerTerminal | null = rejectedBoundedPiece
      ? { status: 'needs_verification', reason: 'construction_piece_write_conflict', blockedTool: rejectedBoundedPiece }
      : incompletePiece ? { status: 'needs_verification', reason: incompletePiece.reason, receiptIndex: receipts.indexOf(incompletePiece.receipt) }
      : opts.pieceProgress?.pauseForDesignReview && pieceReviewReceipt
        ? { status: 'awaiting_design_review', receiptIndex: receipts.indexOf(pieceReviewReceipt) } : null
    if (terminal) {
      release()
      if (opts.progress) await opts.progress.save(structuredClone({ version: 3 as const, step, previous: null, messages: [], calls, receipts, order, terminal }))
      previous = undefined
      return finish(terminalResult(terminal))
    }
    if (opts.progress) await opts.progress.save(structuredClone(opts.verifiedRenewal
      ? { version: 2 as const, step, previous: previous ?? null, messages, calls, receipts, order, renewal, ...(planned ? { planned } : {}) }
      : { version: 1 as const, step, previous, messages, calls, receipts, order, ...(planned ? { planned } : {}) }))
    // A new provider conversation must never inherit orphaned tool outputs or
    // unsaved geometry. Reset only after the last protocol batch was answered,
    // a later workpad note was saved, and an exact revision was read back.
    if (opts.verifiedRenewal && opts.progress && opts.releaseChain && opts.readback && opts.readKnowledge
      && opts.worker.role === 'role.structure-worker' && response.usage.input_tokens >= 105_000
      && renewal.resets < 2 && renewal.savedReceiptIndex !== null && renewal.notedRevision !== null
      && step + 1 < opts.worker.max_steps && Date.now() + 30_000 < opts.deadline) {
      let replacement: Messages | null = null
      try {
        const note = await opts.verifiedRenewal.loadWorkpad(step)
        if (note.status === 'ok' && note.revision === renewal.notedRevision
          && note.note?.status === 'working' && note.note.next_step.trim()) {
          const receipt = receipts[renewal.savedReceiptIndex]
          // A failed or shortened readback is not a verified saving boundary.
          const readback = await opts.readback([receipt])
          const verified = verifiedConstructionSave(receipt, readback)
          if (verified) {
            const nextKnowledge = await opts.readKnowledge()
            const unreadable = Object.values(nextKnowledge).some(value =>
              !!value && typeof value === 'object' && (value as { status?: unknown }).status === 'unavailable')
            if (!unreadable) {
              const fresh = buildWorkerMessages(opts.aiCatalog, { prefix: roleKey, context: opts.context, history: opts.history,
                brief: { ...opts.job, current: null }, knowledge: nextKnowledge, workpad: note })
              fresh.push({ role: 'user', content: JSON.stringify({ context_renewal: {
                saved_record_read_back: verified, approval_not_implied: true,
                original_assignment_preserved: true, continue_from_workpad_next_step: true,
                do_not_repeat_saved_operation: true,
              } }) })
              // An equally large seed would just create a new expensive chain.
              if (countSerializedTokens(fresh) < 75_000) replacement = fresh
            }
          }
        }
      } catch (error) {
        // Optional verification is never a new failure mode for normal work.
        // Lease/time-budget interruptions and revoked authority still propagate.
        rethrowContinuation(error)
        if (error instanceof Error && error.message === 'project_denied') throw error
      }
      if (replacement) {
        const old = previous!
        previous = undefined; messages = replacement
        renewal.resets++; renewal.savedReceiptIndex = null; renewal.notedRevision = null
        // The old step is checkpointed. Releasing its chain before saving the
        // new position keeps checkpoints small; a failed save restores the
        // previous persisted state and is not swallowed by the optional guard.
        opts.releaseChain(old)
        await opts.progress.save(structuredClone({ version: 2 as const, step, previous: null, messages, calls, receipts, order, renewal }))
      }
    }
    // Only continuing work yields. Review holds, conflicts and final reports
    // above must reach Bob before any later specialist step can be scheduled.
    if (step + 1 < opts.worker.max_steps) opts.progress?.afterStep?.()
  }
  return finish({ status: 'step_budget', worker: roleKey, calls })
  } finally { unregister?.() }
}

const RECEIPT_KEYS = ['artifact_id', 'record_id', 'id', 'revision', 'construction_revision', 'request_id', 'step_id']
const plain = (value: unknown) => typeof value === 'string' && value.length <= 200 || typeof value === 'number' && Number.isFinite(value)
/** The ids and revisions a save returned, copied by code. Writer saves nest them
 * in receipt {dataset, recordId, revision, operation}; others return them flat. */
export function saveReceipt(tool: string, result: unknown): Record<string, unknown> {
  const receipt: Record<string, unknown> = { tool }
  if (!result || typeof result !== 'object') return receipt
  const nested = (result as Record<string, unknown>).receipt
  if (nested && typeof nested === 'object') {
    const r = nested as Record<string, unknown>
    for (const [from, to] of [['dataset', 'dataset'], ['recordId', 'record_id'], ['revision', 'revision'], ['operation', 'operation']] as const)
      if (plain(r[from])) receipt[to] = r[from]
  }
  for (const key of RECEIPT_KEYS) {
    const value = (result as Record<string, unknown>)[key]
    if (!(key in receipt) && plain(value)) receipt[key] = value
  }
  return receipt
}

/** Owner decision 2026-10-31: what Konrad and Rita saved comes back with their
 * report, read by code, so Bob checks the saved record instead of reading it
 * again. One read per saved construction or drawing (its latest revision). */
const CONSTRUCTION_READBACK = new Set(['save_construction_draft', 'edit_construction_parts', 'change_construction_parameters', 'change_construction_roles', 'continue_construction_change', 'transition_legacy_drawing', 'check_construction_draft'])
const READBACK_LIMIT = 8
export type ReadbackEntry = { label: string; tool: string; arguments: Record<string, unknown> } | { label: string; not_read: 'no_saved_revision' | 'limit' }
/** Every saved or checked construction and every saved drawing, once, at its
 * latest revision. A save whose receipt names no revision, or one past the
 * limit, is listed as not read, so Bob never takes a missing record for "nothing saved". */
export function readbackReads(receipts: Record<string, unknown>[]): ReadbackEntry[] {
  const reads = new Map<string, ReadbackEntry>()
  for (const r of receipts) {
    const label = CONSTRUCTION_READBACK.has(String(r.tool)) ? 'construction' : r.tool === 'save_cad_design' ? 'drawing' : null
    if (!label) continue
    const id = typeof r.artifact_id === 'string' ? r.artifact_id : typeof r.record_id === 'string' ? r.record_id : null
    const revision = typeof r.revision === 'number' && Number.isSafeInteger(r.revision) && r.revision > 0 ? r.revision : null
    if (!id || revision === null) { reads.set(label + ':unknown:' + reads.size, { label, not_read: 'no_saved_revision' }); continue }
    reads.set(label + ':' + id, label === 'construction'
      ? { label, tool: 'read_construction_draft', arguments: { artifact_id: id, revision, after: null, view: 'overview', ids: [], result_id: null, section: null, step_id: null, work_kind: null } }
      : { label, tool: 'read_project_record_section', arguments: { dataset: 'drawing', record_id: id, revision, path: [] } })
  }
  const all = [...reads.values()]
  return all.map((entry, i) => i < READBACK_LIMIT || !('tool' in entry) ? entry : { label: entry.label, not_read: 'limit' as const })
}
/** Box run 14: Konrad changed a construction without running the server check,
 * so Bob sent him back before Rita drew. Every construction revision a job saved
 * and left unchecked is checked by code after the job (a server check, no model). */
export function uncheckedConstructions(receipts: Record<string, unknown>[]): { artifact_id: string; revision: number }[] {
  const latest = new Map<string, number>(), checked = new Set<string>()
  for (const r of receipts) {
    const id = typeof r.artifact_id === 'string' ? r.artifact_id : typeof r.record_id === 'string' ? r.record_id : null
    const revision = typeof r.revision === 'number' && Number.isSafeInteger(r.revision) && r.revision > 0 ? r.revision : null
    if (!id || revision === null || !CONSTRUCTION_READBACK.has(String(r.tool))) continue
    if (r.tool === 'check_construction_draft') checked.add(id + '@' + revision)
    else latest.set(id, Math.max(latest.get(id) ?? 0, revision))
  }
  return [...latest].filter(([id, revision]) => !checked.has(id + '@' + revision)).map(([artifact_id, revision]) => ({ artifact_id, revision }))
}
export function catalogConstructionAutoCheck(catalog: AiCatalogSession): boolean {
  return catalog.definition('bob.tools', 'tool_contract').definition.construction_auto_check_version === 1
}

/** Box run 13: catalog switch for the readback (texts tell Bob it is there). */
export function catalogReportReadback(catalog: AiCatalogSession): boolean {
  return catalog.definition('bob.tools', 'tool_contract').definition.report_readback_version === 1
}

/** Owner decision 2026-11-02 (Ladan): Konrad wrote a whole first construction
 * (40k output tokens) although the selected solution did not yet pass the
 * construction check, so the save was refused and the work thrown away. A first
 * construction now starts only when the solution passes; otherwise the hand-over
 * returns the check to Bob, who resolves it in the solution first. */
export function catalogHandoverReadiness(catalog: AiCatalogSession): boolean {
  return catalog.definition('bob.tools', 'tool_contract').definition.handover_readiness_version === 1
}
const constructionRead = (view: string, extra: Record<string, unknown> = {}) =>
  ({ artifact_id: null, revision: null, view, ids: [], after: null, section: null, result_id: null, work_kind: null, step_id: null, ...extra })
export async function handoverReadinessBlock(session: { prepare(): Promise<unknown>; execute(name: string, args: unknown): Promise<any> }): Promise<Record<string, unknown> | null> {
  // The worker's own session offers its reads first, exactly as its first step would.
  await session.prepare()
  const overview = await session.execute('read_construction_draft', constructionRead('overview'))
  if (overview?.status !== 'ok' || !Array.isArray(overview.items) || overview.items.length) return null
  const work = await session.execute('read_construction_draft', constructionRead('work', { work_kind: 'parts' }))
  const state = work?.creation_state
  if (typeof state !== 'string' || ['ready', 'unavailable'].includes(state) || work.scoped_refinement_available === true) return null
  const governing = Array.isArray(work.items) ? work.items.find((item: any) => item?.collection === 'governing_sources')?.value : undefined
  const issues = Array.isArray(governing?.preparation?.issues)
    ? governing.preparation.issues.map((issue: any) => ({ code: issue?.code ?? null, message: issue?.message ?? null })) : []
  return { status: 'not_started', reason: 'solution_not_ready_for_construction', creation_state: state, issues,
    message: 'The structure colleague was not started: the selected solution does not yet pass the construction check. Resolve these issues in the solution, then hand the construction over again.' }
}
