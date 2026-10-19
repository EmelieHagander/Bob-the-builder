import type { ProjectOrientation, OrientationSource } from './bob-project-orientation.ts'
import { countSerializedTokens } from './bob-token-budget.ts'

export const ORIENTATION_DIRECTORY_LIMITS = { initial: 12_000, page: 6_000 } as const
const SECTIONS = ['siblings', 'children', 'completionRequirements', 'recentSharedFacts'] as const
type Section = typeof SECTIONS[number]
export const ORIENTATION_DIRECTORY_TOOL = { type: 'function' as const, function: {
  name: 'read_project_orientation',
  description: 'Read exact deferred project-orientation records and source revisions. Copy snapshot_id and next_cursor from the orientation or previous page; null starts that section. These are retained read results, not evidence of current write authority. Partial_record contains exact JSON fragments: concatenate in json_start order before interpreting the record. Read all deferred completion requirements before assessing completion.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    section: { type: 'string', enum: [...SECTIONS] }, snapshot_id: { type: 'string' }, after_cursor: { type: ['string', 'null'] },
  }, required: ['section', 'snapshot_id', 'after_cursor'] },
} }
export interface OrientationDirectory {
  snapshotId: string;
  sections: Record<Section, { available: number; total: number | null; included: number; omitted: number; sourceComplete: boolean;
    next: { tool: 'read_project_orientation'; arguments: { section: Section; snapshot_id: string; after_cursor: string } } | null }>;
}
export interface OrientationDirectoryState {
  version: 1;
  snapshotId: string;
  snapshot: ProjectOrientation;
  orientation: ProjectOrientation;
  pageMaxTokens: number;
}

/** Unlike journal fingerprints, an exact source snapshot must not normalize
 * any record key or literal text that happens to look like transport metadata. */
function exactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(exactJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, exactJson(item)]))
  return value
}

function sourceIds(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) sourceIds(item, found)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'sourceId' && typeof item === 'string') found.add(item)
    else if (key === 'sourceIds' && Array.isArray(item)) for (const id of item) { if (typeof id === 'string') found.add(id) }
    else sourceIds(item, found)
  }
  return found
}

/** Count the complete wire object, including the count itself and all references. */
function measured<T extends object>(value: T, maxTokens: number): T & { tokenBudget: { tokens: number; maxTokens: number } } {
  const result = { ...value, tokenBudget: { tokens: 0, maxTokens } }
  for (let iteration = 0; iteration < 5; iteration++) {
    const tokens = countSerializedTokens(result)
    if (result.tokenBudget.tokens === tokens) return result
    result.tokenBudget.tokens = tokens
  }
  throw new Error('context_token_count_unstable')
}

/** Largest end in [low, high] that still fits, given that low fits. Probes grow
 * from low, so each measured packet stays near the final size instead of the
 * whole section (this runs again on every journal replay). Same result as a
 * bisection over the full range for a monotone fit. */
function largestFitting(low: number, high: number, fits: (end: number) => boolean): number {
  let step = 1
  while (low + step <= high && fits(low + step)) { low += step; step *= 2 }
  high = Math.min(high, low + step - 1)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(middle)) low = middle
    else high = middle - 1
  }
  return low
}

export async function boundProjectOrientation(original: ProjectOrientation, opts: {
  hasAccess: () => Promise<boolean>; maxTokens: number; pageMaxTokens: number;
}) {
  if (!Number.isSafeInteger(opts.maxTokens) || opts.maxTokens < 2048 || opts.maxTokens > 24_000
    || !Number.isSafeInteger(opts.pageMaxTokens) || opts.pageMaxTokens < 2000 || opts.pageMaxTokens > 12_000) throw new Error('context_policy_unavailable')
  // Retained read results are immutable for this turn, including after context
  // renewal. A replay reconstructs them from the same journaled domain reads.
  const snapshot = exactJson(structuredClone(original)) as ProjectOrientation
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)))
  const snapshotId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const sections = Object.fromEntries(SECTIONS.map(section => [section, snapshot[section]])) as Record<Section, unknown[]>
  const complete: Record<Section, boolean> = { siblings: snapshot.completeness.hierarchy, children: snapshot.completeness.hierarchy,
    completionRequirements: snapshot.completeness.requirements, recentSharedFacts: true }
  const cursor = (index: number, offset = 0) => `${index}:${offset}`
  const included: Record<Section, number> = { siblings: 0, children: 0, completionRequirements: 0, recentSharedFacts: 0 }
  function packet() {
    const directory: OrientationDirectory = { snapshotId, sections: Object.fromEntries(SECTIONS.map(section => [section, {
      available: sections[section].length, total: complete[section] ? sections[section].length : null,
      included: included[section], omitted: sections[section].length - included[section], sourceComplete: complete[section],
      next: included[section] < sections[section].length ? { tool: 'read_project_orientation', arguments: {
        section, snapshot_id: snapshotId, after_cursor: cursor(included[section]),
      } } : null,
    }])) as OrientationDirectory['sections'] }
    const value = { ...snapshot, ...Object.fromEntries(SECTIONS.map(section => [section, sections[section].slice(0, included[section])])),
      directory, sources: [] as OrientationSource[], completeness: { ...snapshot.completeness,
        hierarchy: snapshot.completeness.hierarchy && included.siblings === sections.siblings.length && included.children === sections.children.length,
        requirements: snapshot.completeness.requirements && included.completionRequirements === sections.completionRequirements.length },
      warnings: [...snapshot.warnings, ...(SECTIONS.some(section => included[section] < sections[section].length) ? ['orientation:deferred_records'] : [])],
    }
    // The root plan pointer also records a genuinely unavailable approved plan.
    const referenced = sourceIds(value)
    value.sources = snapshot.sources.filter(source => referenced.has(source.id) || source.dataset === 'plan' && !source.itemId)
    return measured(value, opts.maxTokens) as ProjectOrientation
  }
  let orientation = packet()
  if (orientation.tokenBudget!.tokens > opts.maxTokens) throw new Error('context_input_too_large')
  // Exact governing requirements take precedence over directories. If even an
  // individual original is large it stays exact behind a fragmentable page.
  for (const section of ['completionRequirements', 'recentSharedFacts', 'children', 'siblings'] as const) {
    const low = largestFitting(0, sections[section].length, end => {
      included[section] = end
      return packet().tokenBudget!.tokens <= opts.maxTokens
    })
    included[section] = low
  }
  orientation = packet()
  if (orientation.tokenBudget!.tokens > opts.maxTokens) throw new Error('context_input_too_large')
  if (!await opts.hasAccess()) throw new Error('project_denied')
  return restoreOrientationDirectory({ version: 1, snapshotId, snapshot, orientation, pageMaxTokens: opts.pageMaxTokens },
    { projectId: snapshot.projectId, hasAccess: opts.hasAccess })
}

/** The directory has no mutable cursor: every continuation is encoded in the
 * tool arguments. Restore the exact original and its prepared first packet,
 * without hashing/tokenizing the entire project or reading it again. */
export function restoreOrientationDirectory(state: OrientationDirectoryState, opts: {
  projectId: string; hasAccess: () => Promise<boolean>;
}) {
  if (state?.version !== 1 || typeof state.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(state.snapshotId)
    || state.snapshot?.projectId !== opts.projectId || state.orientation?.projectId !== opts.projectId
    || state.orientation.directory?.snapshotId !== state.snapshotId
    || !Number.isSafeInteger(state.pageMaxTokens) || state.pageMaxTokens < 2000 || state.pageMaxTokens > 12_000
    || !SECTIONS.every(section => Array.isArray(state.snapshot[section]) && Array.isArray(state.orientation[section]))
    || !Array.isArray(state.snapshot.sources) || state.snapshot.sources.some(source => source.projectId !== opts.projectId)
    || !state.snapshot.completeness || !['hierarchy', 'requirements'].every(key => typeof state.snapshot.completeness[key as 'hierarchy' | 'requirements'] === 'boolean')) {
    throw new Error('context_checkpoint_invalid')
  }
  const saved = structuredClone(state)
  const { snapshot, snapshotId, orientation, pageMaxTokens } = saved
  const sections = Object.fromEntries(SECTIONS.map(section => [section, snapshot[section]])) as Record<Section, unknown[]>
  const complete: Record<Section, boolean> = { siblings: snapshot.completeness.hierarchy, children: snapshot.completeness.hierarchy,
    completionRequirements: snapshot.completeness.requirements, recentSharedFacts: true }
  const availableSources = (value: unknown): OrientationSource[] => {
    const ids = sourceIds(value)
    return snapshot.sources.filter(source => ids.has(source.id))
  }
  const cursor = (index: number, offset = 0) => `${index}:${offset}`
  const reader = { tools: [ORIENTATION_DIRECTORY_TOOL], exportState: (): OrientationDirectoryState => structuredClone(saved),
    async execute(raw: unknown) {
    if (!await opts.hasAccess()) throw new Error('project_denied')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'invalid' }
    const input = raw as Record<string, unknown>
    if (Object.keys(input).length !== 3 || !SECTIONS.includes(input.section as Section) || input.snapshot_id !== snapshotId
      || !(input.after_cursor === null || typeof input.after_cursor === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(input.after_cursor))) {
      return { status: typeof input.snapshot_id === 'string' && input.snapshot_id !== snapshotId ? 'stale_snapshot' : 'invalid' }
    }
    const section = input.section as Section, records = sections[section]
    const [index, offset] = input.after_cursor === null ? [0, 0] : (input.after_cursor as string).split(':').map(Number)
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(offset) || index > records.length || index === records.length && offset !== 0) return { status: 'invalid' }
    const base = { projectId: snapshot.projectId, snapshot_id: snapshotId, section, start: index,
      total: complete[section] ? records.length : null, available: records.length, sourceComplete: complete[section] }
    const page = (end: number) => measured({ ...base, status: 'ok', records: records.slice(index, end), sources: availableSources(records.slice(index, end)),
      returned: end - index, omitted: records.length - end, next_cursor: end < records.length ? cursor(end) : null }, pageMaxTokens)
    let result: unknown
    if (offset === 0) {
      // A bounded search window avoids re-encoding the entire remaining
      // directory for every page in a large project.
      let low = index, high = Math.min(records.length, index + 128)
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (page(middle).tokenBudget.tokens <= pageMaxTokens) low = middle
        else high = middle - 1
      }
      if (low > index || index === records.length) result = page(low)
    }
    if (result === undefined) {
      const json = JSON.stringify(records[index])
      if (offset >= json.length || offset > 0 && /[\uDC00-\uDFFF]/.test(json[offset])) return { status: 'invalid' }
      const fragment = (end: number) => measured({ ...base, status: 'partial_record', records: [], sources: availableSources(records[index]),
        fragment: { record_index: index, json_start: offset, json_end: end, json_length: json.length, content: json.slice(offset, end) },
        returned: 0, omitted: records.length - index - (end === json.length ? 1 : 0),
        next_cursor: end < json.length ? cursor(index, end) : index + 1 < records.length ? cursor(index + 1) : null }, pageMaxTokens)
      let low = offset, high = Math.min(json.length, offset + pageMaxTokens * 8)
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (fragment(middle).tokenBudget.tokens <= pageMaxTokens) low = middle
        else high = middle - 1
      }
      // Do not split a Unicode surrogate pair across fragment boundaries.
      if (low < json.length && /[\uDC00-\uDFFF]/.test(json[low])) low--
      if (low <= offset) throw new Error('context_input_too_large')
      result = fragment(low)
    }
    if (!await opts.hasAccess()) throw new Error('project_denied')
    return result
  } }
  return { orientation, reader }
}
export type OrientationDirectoryReader = Awaited<ReturnType<typeof boundProjectOrientation>>['reader']
