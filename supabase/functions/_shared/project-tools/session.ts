import { rethrowContinuation } from '../bob-job-journal.ts'
/** Bob's toolbox. Every registered, active and currently available tool is offered
 * on every production model step with its full guide; there is no discovery round. Offering
 * is not authorization: the catalog policy, schema version and server-owned gate
 * are checked again on every execution. A model never supplies policy. */
export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
/** Offline comparison only. Production callers omit this option. */
export type ToolGuideMode = 'inline' | 'manual'
export const READ_TOOL_MANUALS: ToolSpec = { type: 'function', function: {
  name: 'read_tool_manuals', description: 'Read exact guides for 1–8 currently offered tools together before using them. Guides do not grant authority. Fetch again after a contract changes.',
  parameters: { type: 'object', properties: { names: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string' } } }, required: ['names'], additionalProperties: false },
} }
export type ToolGate = 'available' | 'not_allowed' | 'missing_context' | 'budget_exhausted'
export interface ToolDefinition {
  spec: ToolSpec
  version: number
  /** Toolbox shelf used to present the tools in groups. */
  group?: string
  /** Shown when the tool is waiting for a prerequisite created earlier in the turn. */
  waitingFor?: string
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

export interface ToolboxEntry { name: string; group: string; state: 'offered' | 'waiting' | 'budget_exhausted'; waitingFor?: string }

export function createToolSession(opts: { definitions: ToolDefinition[]; readPolicy: ToolPolicyReader; message?: string; toolGuideMode?: ToolGuideMode }) {
  const manualMode = opts.toolGuideMode === 'manual'
  const handlers = new Map<string, ToolDefinition>()
  for (const def of opts.definitions) {
    const name = def.spec.function.name
    if (manualMode && name === READ_TOOL_MANUALS.function.name) throw new Error('Reserved manual tool name')
    if (!NAME.test(name) || handlers.has(name) || !Number.isSafeInteger(def.version) || def.version < 1) throw new Error('Duplicate/invalid tool registration')
    handlers.set(name, def)
  }
  const quote = opts.message?.trim() ? serverRequestQuote(opts.message) : undefined
  let partial = false
  let snapshot: ToolSnapshot | null = null
  let offered = new Map<string, number>()
  let shelf: ToolboxEntry[] = []
  // Exact model-facing contracts, scoped to this session. Changed instructions
  // or schemas invalidate a read receipt even without a schema_version bump.
  const loadedManuals = new Map<string, string>()
  const preparedManuals = new Map<string, string>()
  const offeredContracts = new Map<string, string>()
  let manualOffered = false
  const events: { operation: string; name: string; status: string }[] = []
  const record = (operation: string, name: string, status: string) => { if (events.length < 200) events.push({ operation, name, status }) }
  async function refresh() {
    try { snapshot = checkedToolSnapshot(await opts.readPolicy()); return snapshot }
    catch (error) { partial = true; snapshot = null; if (error instanceof Error && error.message === 'project_denied') throw error; throw new Error('tool_catalog_unavailable') }
  }
  function resolve(row: ToolPolicy) {
    const def = handlers.get(row.name)
    if (!row.active || !def || def.version !== row.schema_version) return { state: 'unavailable' as const, def }
    return { state: def.gate(), def }
  }
  const surfaceSpec = (row: ToolPolicy, def: ToolDefinition): ToolSpec => ({
    type: 'function', function: { name: row.name,
      description: [...new Set([row.description, def.spec.function.description, row.how_to].map(s => s?.trim()).filter(Boolean))].join('\n\n'),
      parameters: quote === undefined ? structuredClone(def.spec.function.parameters) : modelParameters(def.spec.function.parameters) },
  })
  function safeStatus(status: string, message?: string) { if (status !== 'ok') partial = true; return { status, ...(message ? { message } : {}) } }
  return {
    get partial() { return partial },
    get events() { return events.slice() },
    get phase() { return snapshot?.phase ?? null },
    /** The whole shelf as last prepared, including tools waiting for a prerequisite. */
    get toolbox() { return shelf.slice() },
    /** Called once per model step; policy is re-read so a disabled tool disappears at once. */
    async prepare(): Promise<ToolSpec[]> {
      const current = await refresh(), specs: ToolSpec[] = []
      if (manualMode && current.tools.some(row => row.name === READ_TOOL_MANUALS.function.name)) throw new Error('Reserved manual tool name')
      offered = new Map(); shelf = []
      offeredContracts.clear(); preparedManuals.clear(); manualOffered = false
      for (const row of [...current.tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const { state, def } = resolve(row)
        if (!def || state === 'unavailable' || state === 'not_allowed') continue
        const group = def.group ?? 'Other tools'
        if (state === 'available') {
          const full = surfaceSpec(row, def)
          if (manualMode) {
            const contract = JSON.stringify(full)
            offeredContracts.set(row.name, contract)
            if (loadedManuals.get(row.name) === contract) preparedManuals.set(row.name, contract)
          }
          specs.push(manualMode ? { ...full, function: { ...full.function,
            description: row.description + '\nRead read_tool_manuals for this tool before use; its full guide applies.' } } : full)
          offered.set(row.name, row.schema_version); shelf.push({ name: row.name, group, state: 'offered' })
        }
        else shelf.push({ name: row.name, group, state: state === 'budget_exhausted' ? 'budget_exhausted' : 'waiting', ...(state === 'missing_context' && def.waitingFor ? { waitingFor: def.waitingFor } : {}) })
      }
      if (manualMode && specs.length) {
        specs.push(structuredClone(READ_TOOL_MANUALS)); manualOffered = true
        shelf.push({ name: READ_TOOL_MANUALS.function.name, group: 'Project records and memory', state: 'offered' })
      }
      return specs
    },
    /** A final text-only step: nothing from an earlier step remains callable. */
    closeSurface() { offered.clear(); offeredContracts.clear(); preparedManuals.clear(); manualOffered = false },
    async execute(name: string, args: unknown): Promise<any> {
      const current = await refresh()
      if (manualMode && name === READ_TOOL_MANUALS.function.name) {
        if (!manualOffered) return safeStatus('not_offered')
        if (!object(args) || Object.keys(args).length !== 1 || !Array.isArray(args.names)
          || args.names.length < 1 || args.names.length > 8 || new Set(args.names).size !== args.names.length
          || args.names.some(n => typeof n !== 'string' || !NAME.test(n))) return safeStatus('invalid')
        const manuals: { name: string; description: string }[] = [], contracts = new Map<string, string>()
        for (const n of args.names as string[]) {
          const row = current.tools.find(r => r.name === n)
          const resolved = row && resolve(row)
          if (!row || !resolved?.def || resolved.state !== 'available' || !offered.has(n)) return safeStatus('not_offered')
          const full = surfaceSpec(row, resolved.def), contract = JSON.stringify(full)
          if (offeredContracts.get(n) !== contract) return safeStatus('contract_changed')
          manuals.push({ name: n, description: full.function.description }); contracts.set(n, contract)
        }
        // Atomic batch: a refused name returns no guides and grants no receipts.
        for (const [n, contract] of contracts) loadedManuals.set(n, contract)
        record('manual', name, 'ok')
        return { status: 'ok', manuals }
      }
      const row = current.tools.find(r => r.name === name)
      if (!row) { record('execute', name, 'invalid'); return safeStatus('invalid', 'There is no tool with that name. Use a tool from your toolbox.') }
      const { state, def } = resolve(row)
      if (state !== 'available' || !def) {
        record('execute', name, state)
        return safeStatus(state, state === 'missing_context' && def?.waitingFor ? `Not available yet: ${def.waitingFor}` : undefined)
      }
      // The set offered to one model step is a fence: a tool that became available
      // later in the same batch is callable from the next step, not retroactively.
      if (!offered.has(name)) { record('execute', name, 'not_offered'); return safeStatus('not_offered', 'This tool became available after this step began. Call it again in your next step.') }
      if (offered.get(name) !== row.schema_version) return safeStatus('contract_changed', 'This tool changed during the turn. Use the version offered on your next step.')
      // A guide fetched earlier in this same tool batch has not reached a model
      // yet. Only the next prepare/model step may use its receipt.
      if (manualMode && preparedManuals.get(name) !== JSON.stringify(surfaceSpec(row, def)))
        return safeStatus('manual_required', 'Read this tool with read_tool_manuals before using its current contract.')
      const input = quote !== undefined && takesQuote(def.spec) && object(args) ? { ...args, [SERVER_QUOTE_FIELD]: quote } : args
      try {
        const result = await def.execute(input)
        record('execute', name, object(result) && typeof result.status === 'string' ? result.status : 'returned')
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
