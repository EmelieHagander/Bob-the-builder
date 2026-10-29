import { rethrowContinuation } from '../bob-job-journal.ts'
import { countContextTokens } from '../bob-token-budget.ts'
/** Bob's toolbox. Inline mode offers all available tools; pinned lazy mode offers
 * loaded tools and lists the remaining capabilities as short cards. Offering
 * is not authorization: the catalog policy, schema version and server-owned gate
 * are checked again on every execution. A model never supplies policy. */
export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
/** Lazy mode is enabled only by a pinned context-strategy contract. */
export type ToolInstructions = 'inline' | 'on_demand' | 'lazy'
export const DESCRIBE_TOOL: ToolSpec = { type: 'function', function: {
  name: 'describe_tool',
  description: 'Read the current usage manual for a tool on your bench by exact name when you need its detailed workflow. Read-only; does not load, enable or execute the tool.',
  parameters: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } }, required: ['name'] },
} }
export type ToolGate = 'available' | 'not_allowed' | 'missing_context' | 'budget_exhausted' | 'write_uncertain'
export interface ToolDefinition {
  spec: ToolSpec
  version: number
  /** Toolbox shelf used to present the tools in groups. */
  group?: string
  /** Shown when the tool is waiting for a prerequisite created earlier in the turn. */
  waitingFor?: string
  /** A concrete candidate/proposal gate, not a general always-loaded tool. */
  readyContinuation?: boolean
  gate(): ToolGate
  execute(args: unknown): Promise<unknown>
}
export interface ToolPolicy {
  name: string
  description: string
  how_to: string
  schema_version: number
  always_load: boolean
  preload_phases: string[]
  active: boolean
}
export interface ToolSnapshot { phase: string | null; tools: ToolPolicy[] }
export type ToolPolicyReader = () => Promise<ToolSnapshot>
export const TOOL_LIMITS = { catalogRows: 128 } as const
const NAME = /^[a-z][a-z0-9_]{0,63}$/
const PHASES = new Set(['concept', 'design', 'planning', 'build', 'complete'])
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, n: number): v is string => typeof v === 'string' && v.length <= n
export function checkedToolSnapshot(value: unknown): ToolSnapshot {
  if (!object(value) || !(value.phase === null || text(value.phase, 64)) || !Array.isArray(value.tools) || value.tools.length > TOOL_LIMITS.catalogRows) throw new Error('tool_catalog_unavailable')
  const names = new Set<string>()
  for (const row of value.tools) {
    if (!object(row) || !text(row.name, 64) || !NAME.test(row.name) || names.has(row.name)
      || !text(row.description, 1000) || !row.description.trim() || !text(row.how_to, 12000)
      || !Number.isSafeInteger(row.schema_version) || Number(row.schema_version) < 1
      || typeof row.active !== 'boolean' || typeof row.always_load !== 'boolean'
      || !Array.isArray(row.preload_phases) || row.preload_phases.length > 5
      || row.preload_phases.some(p => typeof p !== 'string' || !PHASES.has(p))) throw new Error('tool_catalog_unavailable')
    names.add(row.name)
  }
  return { phase: PHASES.has(String(value.phase)) ? value.phase as string : null, tools: structuredClone(value.tools) as ToolPolicy[] }
}

/** Change provenance is server-owned: every write records the owner message of
 * the turn it belongs to. Bob never sees, writes or is asked for a quote. */
export const SERVER_QUOTE_FIELD = 'request_quote'
export function modelParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(parameters)
  const properties = object(copy.properties) ? copy.properties : null
  if (!properties || !Object.hasOwn(properties, SERVER_QUOTE_FIELD)) return copy
  delete properties[SERVER_QUOTE_FIELD]
  if (Array.isArray(copy.required)) copy.required = copy.required.filter(k => k !== SERVER_QUOTE_FIELD)
  return copy
}
const takesQuote = (spec: ToolSpec) => object(spec.function.parameters.properties) && Object.hasOwn(spec.function.parameters.properties, SERVER_QUOTE_FIELD)
/** The owner's message, trimmed to at most 500 UTF-16 units without splitting a
 * character: always an exact substring, as every SQL writer checks. */
export function serverRequestQuote(message: string): string {
  let out = ''
  for (const ch of message) { if (out.length + ch.length > 500) break; out += ch }
  return out
}

const WRITE_UNCERTAIN = 'A previous write has an unverified outcome. Further writes are paused for recovery; this is not an exhausted write budget. Do not repeat it or claim it failed.'

/** Only these work-value contracts have an explicit v1-to-v2 transition.
 * Live policy v2 may serve a durable v1 manifest until its job finishes. */
export const WORK_VALUE_TOOL_NAMES = ['edit_work_record', 'create_work_record', 'change_task_readiness'] as const
function policySupportsHandler(name: string, policyVersion: number, handlerVersion: number) {
  return (WORK_VALUE_TOOL_NAMES as readonly string[]).includes(name)
    ? policyVersion === 1 && handlerVersion === 1 || policyVersion === 2 && (handlerVersion === 1 || handlerVersion === 2)
    : policyVersion === handlerVersion
}

/** A catalog workflow: method plus member directory. Older manifests load the
 * group; selective manifests retain only the method until individual selection.
 * Each member keeps its own policy, gate and version checks. */
export interface WorkflowCard { name: string; card: string; method: string; tools: string[] }
export interface ToolFollowup { after_tool:string; statuses:string[]; tools:string[]; when?:{field:string;equals:string|boolean} }

export interface ToolboxEntry { name: string; group: string; state: 'offered' | 'waiting' | 'budget_exhausted'; waitingFor?: string; description?: string; instructionLoaded?: boolean }

/** Data only: handlers and policy readers are recreated for each worker lease. */
export interface ToolSessionState {
  version: 1 | 2
  workflows?: string[]
  loaded: [string, number][]
  carried: string[]
  partial: boolean
  snapshot: ToolSnapshot | null
  offered: [string, number][]
  visible: [string, number][]
  shelf: ToolboxEntry[]
  events: { operation: string; name: string; status: string }[]
  cards: [string, string | null][]
}

export function createToolSession(opts: { definitions: ToolDefinition[]; readPolicy: ToolPolicyReader; message?: string; toolInstructions?: ToolInstructions; selectiveTools?: boolean;
  autoLoadReady?:boolean; followups?:ToolFollowup[];
  /** Tools of work already in progress, loaded without a describe_tool round (lazy loading only). */ preloadTools?: (phase: string | null) => string[]; catalogTool?: (name: string, parameters: Record<string, unknown>) => ToolSpec; catalogToolVersion?: (name: string) => number; catalogColleagues?: (name: string) => unknown[]; catalogWorkflows?: () => WorkflowCard[]; feedback?: (key: string, variables?: Record<string, string>) => string }) {
  const lazy = opts.toolInstructions === 'lazy'
  const selective = lazy && opts.selectiveTools === true
  const workflows = new Set<string>()
  const onDemand = lazy || opts.toolInstructions === 'on_demand'
  const loaded = new Map<string, number>()
  const followups=opts.followups??[]
  if(!Array.isArray(followups)||followups.length>32||followups.some(f=>!f||!NAME.test(f.after_tool)||!Array.isArray(f.statuses)||!f.statuses.length
    ||f.statuses.some(s=>typeof s!=='string'||!NAME.test(s))||!Array.isArray(f.tools)||f.tools.length>8||f.tools.some(t=>typeof t!=='string'||!NAME.test(t))
    ||f.when&&(!NAME.test(f.when.field)||!['string','boolean'].includes(typeof f.when.equals))))throw Error('tool_catalog_unavailable')
  // Loaded across a context rollover: their manuals moved into summarized
  // history, so the offered schema carries the manual itself.
  const carried = new Set<string>()
  const handlers = new Map<string, ToolDefinition>()
  for (const def of opts.definitions) {
    const name = def.spec.function.name
    if (!NAME.test(name) || handlers.has(name) || (onDemand && name === DESCRIBE_TOOL.function.name) || !Number.isSafeInteger(def.version) || def.version < 1) throw new Error('Duplicate/invalid tool registration')
    handlers.set(name, def)
  }
  const quote = opts.message?.trim() ? serverRequestQuote(opts.message) : undefined
  let partial = false
  let snapshot: ToolSnapshot | null = null
  let offered = new Map<string, number>()
  let visible = new Map<string, number>()
  let shelf: ToolboxEntry[] = []
  const events: { operation: string; name: string; status: string }[] = []
  const record = (operation: string, name: string, status: string) => { if (events.length < 200) events.push({ operation, name, status }) }
  async function refresh() {
    try { snapshot = checkedToolSnapshot(await opts.readPolicy()); return snapshot }
    catch (error) { partial = true; snapshot = null; if (error instanceof Error && error.message === 'project_denied') throw error; throw new Error('tool_catalog_unavailable') }
  }
  function resolve(row: ToolPolicy) {
    const def = handlers.get(row.name)
    if (!row.active || !def || !policySupportsHandler(row.name, row.schema_version, def.version) || (opts.catalogToolVersion && opts.catalogToolVersion(row.name) !== def.version)) return { state: 'unavailable' as const, def }
    return { state: def.gate(), def }
  }
  const description = (row: ToolPolicy, def: ToolDefinition, includeManual: boolean) => opts.catalogTool
    ? opts.catalogTool(row.name, { include_manual: includeManual }).function.description
    : [...new Set([row.description, def.spec.function.description, ...(includeManual ? [row.how_to] : [])].map(s => s?.trim()).filter(Boolean))].join('\n\n')
  const surfaceSpec = (row: ToolPolicy, def: ToolDefinition): ToolSpec => opts.catalogTool
    ? opts.catalogTool(row.name, { include_manual: selective || !onDemand || carried.has(row.name), ...(lazy && !selective && !carried.has(row.name) ? { card: true } : {}), server_quote: quote !== undefined,
        ...(row.name === 'list_project_category' && object(def.spec.function.parameters.properties) && object(def.spec.function.parameters.properties.category)
          ? { categories: def.spec.function.parameters.properties.category.enum } : {}) })
    : ({
    type: 'function', function: { name: row.name,
      description: description(row, def, selective || !onDemand),
      parameters: quote === undefined ? structuredClone(def.spec.function.parameters) : modelParameters(def.spec.function.parameters) },
  })
  function safeStatus(status: string, message?: string) { if (status !== 'ok') partial = true; return { status, ...(message ? { message } : {}) } }
  // Cards come from the pinned catalog and repeat on every step (and replay);
  // bind and count each card once per session.
  const cards = new Map<string, string | undefined>()
  const cardDescription = (row: { name: string; description?: string }) => {
    // These keys are persisted inside JSONB checkpoints. Encode the tuple so
    // the binding stays exact without a NUL separator PostgreSQL cannot store.
    const key = JSON.stringify([row.name, opts.catalogTool ? '' : row.description ?? ''])
    if (cards.has(key)) return cards.get(key)
    const description = opts.catalogTool ? opts.catalogTool(row.name, { card: true }).function.description : row.description
    if (description && countContextTokens(description) > 80) throw new Error('tool_card_too_large')
    cards.set(key, description)
    return description
  }
  return {
    exportState(): ToolSessionState {
      return JSON.parse(JSON.stringify({ version: selective ? 2 : 1, ...(selective ? { workflows: [...workflows] } : {}), loaded: [...loaded], carried: [...carried], partial,
        snapshot, offered: [...offered], visible: [...visible], shelf, events,
        cards: [...cards].map(([name, description]) => [name, description ?? null]) }))
    },
    restoreState(state: ToolSessionState) {
      const versions = (rows: [string, number][]) => Array.isArray(rows) && rows.every(row => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && Number.isSafeInteger(row[1]) && row[1] > 0)
      if (state?.version !== (selective ? 2 : 1) || selective && (!Array.isArray(state.workflows) || state.workflows.some(name => !opts.catalogWorkflows?.().some(w => w.name === name))) || typeof state.partial !== 'boolean' || !versions(state.loaded) || !versions(state.offered) || !versions(state.visible)
        || !Array.isArray(state.carried) || state.carried.some(name => typeof name !== 'string')
        || !Array.isArray(state.shelf) || !Array.isArray(state.events) || state.events.length > 200 || !Array.isArray(state.cards)
        || state.cards.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !(row[1] === null || typeof row[1] === 'string'))) throw new Error('tool_session_checkpoint_invalid')
      const restored: ToolSessionState = JSON.parse(JSON.stringify(state))
      const policy = restored.snapshot === null ? null : checkedToolSnapshot(restored.snapshot)
      loaded.clear(); for (const [name, version] of restored.loaded) loaded.set(name, version)
      workflows.clear(); for (const name of restored.workflows ?? []) workflows.add(name)
      carried.clear(); for (const name of restored.carried) carried.add(name)
      partial = restored.partial; snapshot = policy
      offered = new Map(restored.offered); visible = new Map(restored.visible); shelf = restored.shelf
      events.splice(0, events.length, ...restored.events)
      cards.clear(); for (const [name, description] of restored.cards) cards.set(name, description ?? undefined)
    },
    get partial() { return partial },
    get events() { return events.slice() },
    get phase() { return snapshot?.phase ?? null },
    /** The whole shelf as last prepared, including tools waiting for a prerequisite. */
    get toolbox() { return shelf.slice() },
    /** Resolve only immutable pinned methods; checkpoint state never grants tools. */
    get workflowInstructions() { return selective ? (opts.catalogWorkflows?.() ?? []).filter(w => workflows.has(w.name)).map(w => `${w.name}\n${w.method}`).join('\n\n') : '' },
    /** Context rollover releases schemas for the next prepare. Preserve the
     * fence of an already submitted model request and its in-flight results. */
    resetInstructions() { if (!selective) { loaded.clear(); carried.clear() } },
    /** Rollover that keeps the loaded tools: each offered schema then includes
     * its manual, instead of Bob describing the same tools again. */
    carryInstructions() { carried.clear(); for (const name of loaded.keys()) carried.add(name) },
    /** Per-tool catalog binding for carried tools (manual inside the schema). */
    toolParameters(): Record<string, { card: false; include_manual: true }> | undefined {
      const offeredCarried = [...(selective ? loaded.keys() : carried)].filter(name => offered.has(name))
      return offeredCarried.length ? Object.fromEntries(offeredCarried.map(name => [name, { card: false, include_manual: true }])) : undefined
    },
    /** Called once per model step; policy is re-read so a disabled tool disappears at once. */
    async prepare(): Promise<ToolSpec[]> {
      const current = await refresh(), specs: ToolSpec[] = []
      // Work already in progress names its tools. Loading them here instead of
      // one describe_tool round each saves the round and the provider cache
      // miss that every change to the native tool list causes (2026-10-20:
      // 42 post-manual steps hit the cache 9% of the time against 81%).
      // Same gate as describe_tool by name; authority is still checked at execution.
      if (lazy) for (const name of opts.preloadTools?.(current.phase) ?? []) {
        if (loaded.has(name)) continue
        const row = current.tools.find(r => r.name === name)
        const resolved = row ? resolve(row) : null
        if (row && resolved?.def && resolved.state !== 'unavailable' && resolved.state !== 'not_allowed') loaded.set(row.name, resolved.def.version)
      }
      offered = new Map(); visible = new Map(); shelf = []
      for (const row of [...current.tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const { state, def } = resolve(row)
        if (!def || state === 'unavailable' || state === 'not_allowed') { loaded.delete(row.name); carried.delete(row.name); continue }
        if (loaded.get(row.name) !== def.version) { loaded.delete(row.name); carried.delete(row.name) }
        if(lazy&&opts.autoLoadReady&&def.readyContinuation&&state==='available')loaded.set(row.name,def.version)
        visible.set(row.name, def.version)
        const group = def.group ?? 'Other tools'
        const card = lazy ? { description: cardDescription(row), instructionLoaded: loaded.has(row.name) } : {}
        if (state === 'available') {
          if (!lazy || loaded.has(row.name)) { specs.push(surfaceSpec(row, def)); offered.set(row.name, def.version) }
          shelf.push({ name: row.name, group, state: 'offered', ...card })
        } else shelf.push({ name: row.name, group, state: state === 'budget_exhausted' ? 'budget_exhausted' : 'waiting', ...card, ...(state === 'write_uncertain' ? { waitingFor: WRITE_UNCERTAIN } : state === 'missing_context' && def.waitingFor ? { waitingFor: def.waitingFor } : {}) })
      }
      if (onDemand && visible.size) {
        specs.push(opts.catalogTool ? opts.catalogTool(DESCRIBE_TOOL.function.name, {}) : structuredClone(DESCRIBE_TOOL)); offered.set(DESCRIBE_TOOL.function.name, 1)
        shelf.push({ name: DESCRIBE_TOOL.function.name, group: 'Tool manuals', state: 'offered' })
      }
      return specs
    },
    /** A final text-only step: nothing from an earlier step remains callable. */
    closeSurface() { offered.clear(); visible.clear() },
    async execute(name: string, args: unknown): Promise<any> {
      const current = await refresh()
      // Session metadata, not a domain handler or a catalog grant. Resolve the
      // target afresh, even after its manual was read earlier in this turn.
      if (onDemand && name === DESCRIBE_TOOL.function.name) {
        const finish = (result: Record<string, unknown>) => { record('execute', name, String(result.status)); return result }
        if (!offered.has(name)) return finish(safeStatus('not_offered'))
        if (!object(args) || Object.keys(args).length !== 1 || typeof args.name !== 'string' || !NAME.test(args.name)) return finish(safeStatus('invalid'))
        const workflow = lazy ? opts.catalogWorkflows?.().find(w => w.name === args.name) : undefined
        if (workflow) {
          const members: { name: string; state: string }[] = [], loadedNow: string[] = []
          for (const name of workflow.tools) {
            const member = current.tools.find(r => r.name === name)
            const found = member ? resolve(member) : null
            if (!member || !found?.def || found.state === 'unavailable' || found.state === 'not_allowed' || visible.get(name) !== found.def.version) continue
            if (!selective && found.state === 'available') { loaded.set(name, found.def.version); loadedNow.push(name) }
            members.push({ name, state: found.state })
          }
          if (!members.length) return finish(safeStatus('unavailable'))
          if (selective) { workflows.add(workflow.name); return finish({ status: 'ok', workflow: workflow.name, method_ref: 'current_system_instructions', tools: members, callable_from_next_step: [], next_action: 'Read the selected workflow method in the next request. describe_tool by exact tool name loads only that tool.' }) }
          return finish({ status: 'ok', workflow: workflow.name, method: workflow.method, tools: members, callable_from_next_step: loadedNow })
        }
        const row = current.tools.find(r => r.name === args.name)
        const resolved = row ? resolve(row) : null
        if (!row || !resolved?.def || resolved.state === 'unavailable' || resolved.state === 'not_allowed') return finish(safeStatus('unavailable'))
        if (!visible.has(row.name)) return finish(safeStatus('not_offered'))
        if (visible.get(row.name) !== resolved.def.version) return finish(safeStatus('contract_changed'))
        if (lazy) loaded.set(row.name, resolved.def.version)
        if (selective) return finish({ status: 'ok', name: row.name, schema_version: resolved.def.version, state: resolved.state,
          instructions_ref: 'next_request_tool_definition', callable_from_next_step: resolved.state === 'available',
          colleagues: opts.catalogColleagues?.(row.name) ?? [],
          ...(resolved.state === 'missing_context' && resolved.def.waitingFor ? { waiting_for: resolved.def.waitingFor } : {}) })
        return finish({ status: 'ok', name: row.name, schema_version: resolved.def.version, state: resolved.state,
          manual: description(row, resolved.def, true),
          ...(lazy ? { parameters: surfaceSpec(row, resolved.def).function.parameters, callable_from_next_step: resolved.state === 'available', colleagues: opts.catalogColleagues?.(row.name) ?? [] } : {}),
          ...(resolved.state === 'missing_context' && resolved.def.waitingFor ? { waiting_for: resolved.def.waitingFor } : {}) })
      }
      const row = current.tools.find(r => r.name === name)
      if (!row) { record('execute', name, 'invalid'); return safeStatus('invalid', opts.feedback?.('invalid') ?? 'There is no tool with that name. Use a tool from your toolbox.') }
      const { state, def } = resolve(row)
      if (state !== 'available' || !def) {
        record('execute', name, state)
        return safeStatus(state, state === 'write_uncertain' ? WRITE_UNCERTAIN : state === 'missing_context' && def?.waitingFor ? opts.feedback?.('waiting', { waiting: def.waitingFor }) ?? `Not available yet: ${def.waitingFor}` : undefined)
      }
      // The set offered to one model step is a fence: a tool that became available
      // later in the same batch is callable from the next step, not retroactively.
      if (!offered.has(name)) { record('execute', name, 'not_offered'); return safeStatus('not_offered', opts.feedback?.('not-offered') ?? 'This tool became available after this step began. Call it again in your next step.') }
      if (offered.get(name) !== def.version) return safeStatus('contract_changed', opts.feedback?.('contract-changed') ?? 'This tool changed during the turn. Use the version offered on your next step.')
      const input = quote !== undefined && takesQuote(def.spec) && object(args) ? { ...args, [SERVER_QUOTE_FIELD]: quote } : args
      try {
        const result = await def.execute(input)
        record('execute', name, object(result) && typeof result.status === 'string' ? result.status : 'returned')
        if(lazy&&object(result))for(const followup of followups){
          if(followup.after_tool!==name||!followup.statuses.includes(String(result.status))
            ||followup.when&&result[followup.when.field]!==followup.when.equals)continue
          for(const next of followup.tools){
            const policy=current.tools.find(row=>row.name===next),resolved=policy?resolve(policy):null
            // Loading never grants authority; prepare and execute both recheck
            // current policy, handler version and the ordinary domain gate.
            if(resolved?.def&&resolved.state==='available')loaded.set(next,resolved.def.version)
          }
        }
        return result
      } catch (error) {
        rethrowContinuation(error)
        partial = true
        record('execute', name, 'tool_execution_unavailable')
        // Stop and settle possible writes. An unexpected handler failure is not
        // a missing tool or catalog failure; never echo private error contents.
        throw new Error('tool_execution_unavailable')
      }
    },
  }
}
export type ToolSession = ReturnType<typeof createToolSession>
