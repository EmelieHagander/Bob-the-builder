/** Tool loading is not authorization. All four surfaces use the same fresh policy
 * and the same server-owned handler gates; a model never supplies either one. */
export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export type ToolGate = 'available' | 'not_allowed' | 'missing_context' | 'budget_exhausted'
export interface ToolDefinition {
  spec: ToolSpec
  version: number
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
export const TOOL_LIMITS = { catalogRows: 128, page: 12, managementCalls: 16, loaded: 24 } as const
const NAME = /^[a-z][a-z0-9_]{0,63}$/
const PHASES = new Set(['concept', 'design', 'planning', 'build', 'complete'])
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, n: number): v is string => typeof v === 'string' && v.length <= n
const normal = (v: string) => v.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
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
const managementSpec = (name: string, description: string, properties: Record<string, unknown>): ToolSpec => ({
  type: 'function', function: { name, description, parameters: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } },
})
export const LIST_TOOLS = managementSpec('list_tools',
  'Find available tools by name/short description, or browse with query=null. This is a tool directory, not project data. Results contain no large parameter schemas. Follow next_cursor with after_name. No results is not proof that a differently worded tool does not exist.', {
    query: { type: ['string', 'null'], description: 'Literal words in the name or short description; null browses every permitted registered tool.' },
    after_name: { type: ['string', 'null'], description: 'Exact next_cursor from the previous page, or null.' },
  })
export const LOAD_TOOL = managementSpec('load_tool',
  'Load one exact tool by name. Returns its complete JSON parameter schema and usage guide and makes it callable on the NEXT model call in this turn. May be used again for a loaded tool. Does not execute it or grant new permissions. Do this before claiming a non-loaded capability is missing.', {
    name: { type: 'string', description: 'Exact tool name from list_tools, a preloaded tool or an earlier conversation.' },
  })
const MANAGEMENT = [LIST_TOOLS, LOAD_TOOL]

export function createToolSession(opts: { definitions: ToolDefinition[]; readPolicy: ToolPolicyReader }) {
  const handlers = new Map<string, ToolDefinition>()
  for (const def of opts.definitions) {
    const name = def.spec.function.name
    if (!NAME.test(name) || handlers.has(name) || MANAGEMENT.some(t => t.function.name === name) || !Number.isSafeInteger(def.version) || def.version < 1) throw new Error('Duplicate/invalid tool registration')
    handlers.set(name, def)
  }
  const loaded = new Map<string, number>()
  let used = 0, partial = false, seeded = false
  let snapshot: ToolSnapshot | null = null
  // A packet offered to one model call is a fence. Loading a tool later in that
  // call's batch does not retroactively authorize a guessed call from the batch.
  let offered = new Map<string, number>()
  const events: { operation: string; name: string; status: string }[] = []
  const record = (operation: string, name: string, status: string) => { if (events.length < 100) events.push({ operation, name, status }) }
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
    type: 'function', function: { name: row.name, description: row.description, parameters: structuredClone(def.spec.function.parameters) },
  })
  function safeStatus(status: string, message?: string) { if (status !== 'ok') partial = true; return { status, ...(message ? { message } : {}) } }
  return {
    get partial() { return partial },
    get events() { return events.slice() },
    /** Called once per provider iteration; not cached across callers/projects. */
    async prepare(): Promise<ToolSpec[]> {
      const current = await refresh(), specs: ToolSpec[] = []
      if (!seeded) {
        for (const row of current.tools) if (current.phase !== null && row.preload_phases.includes(current.phase) && resolve(row).state === 'available') loaded.set(row.name, row.schema_version)
        seeded = true
      }
      offered = new Map()
      for (const row of [...current.tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const { state, def } = resolve(row)
        if (state !== 'available' || !def) { loaded.delete(row.name); continue }
        if (loaded.has(row.name) && loaded.get(row.name) !== row.schema_version) loaded.delete(row.name)
        if (row.always_load || loaded.get(row.name) === row.schema_version) {
          specs.push(surfaceSpec(row, def)); offered.set(row.name, row.schema_version)
        }
      }
      // Management has a separate bound; it cannot reset any domain budget.
      if (used < TOOL_LIMITS.managementCalls && current.tools.some(row => resolve(row).state === 'available')) for (const spec of MANAGEMENT) {
        specs.push(spec); offered.set(spec.function.name, 1)
      }
      return specs
    },
    /** The final, tool-free answer call cannot use an earlier offered fence. */
    closeSurface() { offered.clear() },
    async execute(name: string, args: unknown): Promise<any> {
      const current = await refresh()
      if (!offered.has(name)) {
        const row = current.tools.find(r => r.name === name)
        if (row) {
          const { state } = resolve(row)
          if (state === 'available') return safeStatus('not_loaded', 'Use load_tool with the exact name; then invoke it on the next model call.')
          return safeStatus(state)
        }
        return safeStatus('invalid', 'No offered tool has that name. Browse list_tools rather than inventing a call.')
      }
      if (name === 'list_tools' || name === 'load_tool') {
        if (++used > TOOL_LIMITS.managementCalls) return safeStatus('budget_exhausted')
        if (!object(args)) return safeStatus('invalid')
        if (name === 'list_tools') {
          if (Object.keys(args).length !== 2 || !Object.hasOwn(args, 'query') || !Object.hasOwn(args, 'after_name')
            || !(args.query === null || text(args.query, 200)) || !(args.after_name === null || (text(args.after_name, 64) && NAME.test(args.after_name)))) return safeStatus('invalid')
          const terms = args.query ? normal(args.query as string).split(/\s+/).filter(Boolean) : []
          const eligible = current.tools.filter(row => {
            const { state } = resolve(row)
            return row.active && state !== 'not_allowed' && state !== 'unavailable'
          }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
          const matches = eligible.filter(r => (!args.after_name || r.name > String(args.after_name))
            && terms.every(t => normal(r.name + ' ' + r.description).includes(t)))
          const page = matches.slice(0, TOOL_LIMITS.page)
          const items = page.map(row => ({ name: row.name, description: row.description,
            tier: row.always_load ? 'core' : 'on_demand', loaded: offered.get(row.name) === row.schema_version,
            availability: resolve(row).state }))
          record('list', '', items.length ? 'ok' : 'empty')
          return { status: items.length ? 'ok' : 'empty', items, next_cursor: matches.length > page.length ? page[page.length - 1].name : null,
            phase: current.phase, scope: 'permitted_registered_tools', note: 'Phase selects preloads only. Read/list/load never authorizes a project change. Browse query=null if a word search misses.' }
        }
        if (Object.keys(args).length !== 1 || !text(args.name, 64) || !NAME.test(args.name)) return safeStatus('invalid')
        const row = current.tools.find(r => r.name === args.name)
        if (!row) return safeStatus('not_found')
        const { state, def } = resolve(row)
        if (state !== 'available' || !def) { record('load', row.name, state); return safeStatus(state) }
        if (!loaded.has(row.name) && loaded.size >= TOOL_LIMITS.loaded) return safeStatus('budget_exhausted', 'This turn has reached its distinct-tool loading limit.')
        loaded.set(row.name, row.schema_version)
        record('load', row.name, 'loaded')
        return { status: 'loaded', name: row.name, schema_version: row.schema_version,
          tool: surfaceSpec(row, def), how_to: row.how_to, implementation_notes: def.spec.function.description,
          next: 'Use this actual tool on the next model call. Loading is read-only; execute only when the current request authorizes its effect.' }
      }
      const row = current.tools.find(r => r.name === name)
      if (!row) return safeStatus('unavailable')
      const { state, def } = resolve(row)
      if (state !== 'available' || !def) { record('execute', name, state); return safeStatus(state) }
      if (row.schema_version !== offered.get(name)) return safeStatus('contract_changed', 'Reload the exact tool before retrying.')
      try {
        const result = await def.execute(args)
        record('execute', name, object(result) && typeof result.status === 'string' ? result.status : 'returned')
        return result
      } catch {
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
