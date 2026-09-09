import type { ProjectSource } from '../../../src/data/provenance.ts'

export const DATASETS = ['project', 'areas', 'tasks', 'materials', 'crew', 'events', 'announcements'] as const
export const LIMITS = { lookups: 3, rows: 25, joinedRows: 25, bytes: 16 * 1024, queryChars: 200, timeoutMs: 10_000 } as const
export interface LookupInput {
  dataset: typeof DATASETS[number]
  query: string | null
  status: string | null
  area_id: string | null
  record_id: string | null
}
type Row = Record<string, unknown> & { id: string; updated_at?: string | null }
export interface LookupPayload { records: Row[]; related: Row[]; truncated: boolean }
export interface LookupResult {
  status: 'ok' | 'empty' | 'denied' | 'invalid' | 'unavailable' | 'budget_exhausted'
  projectId: string
  dataset?: LookupInput['dataset']
  retrievedAt: string
  records: Row[]
  related: Row[]
  truncated: boolean
  /** True even for a complete filtered page: this is not a whole-project census. */
  partial: boolean
  truth: 'unknown'
}
export type LookupTransport = (projectId: string, input: LookupInput, signal: AbortSignal) =>
  PromiseLike<{ data: unknown; error: { code?: string } | null }>

export function parseLookup(value: unknown): LookupInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['dataset', 'query', 'status', 'area_id', 'record_id'].includes(k))) return null
  if (!DATASETS.includes(v.dataset as LookupInput['dataset'])) return null
  for (const key of ['query', 'status', 'area_id', 'record_id']) {
    if (v[key] !== null && (typeof v[key] !== 'string' || (v[key] as string).length > LIMITS.queryChars)) return null
  }
  if (v.area_id !== null && v.dataset !== 'tasks') return null
  const statuses: Record<string, string[]> = {
    tasks: ['todo', 'doing', 'done', 'blocked'],
    materials: ['needed', 'ordered', 'delivered', 'backorder'], events: ['going', 'open'],
  }
  if (v.status !== null && !statuses[String(v.dataset)]?.includes(v.status as string)) return null
  return v as unknown as LookupInput
}

export const SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    // The canonical shared service uses non-strict provider tools. parseLookup
    // independently enforces this exact argument shape before database access.
    name: 'search_project_data',
    description: 'Read a bounded page of stored data in the already authorised active project. No writes. Text is literal, not SQL. A partial/empty page never proves a project-wide absence.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        dataset: { type: 'string', enum: [...DATASETS] },
        query: { type: ['string', 'null'], description: 'Literal search text, max 200 characters.' },
        status: { type: ['string', 'null'], description: 'Task, material or event status only; otherwise null.' },
        area_id: { type: ['string', 'null'], description: 'Exact area id for tasks only; otherwise null.' },
        record_id: { type: ['string', 'null'], description: 'Exact record id, or null.' },
      },
      required: ['dataset', 'query', 'status', 'area_id', 'record_id'],
    },
  },
}

/** One instance per question; the model cannot change its project or budget. */
export function createProjectLookup(projectId: string, transport: LookupTransport, timeoutMs: number = LIMITS.timeoutMs) {
  let used = 0
  const sources: ProjectSource[] = []
  let incomplete = false
  return {
    sources,
    get remaining() { return Math.max(0, LIMITS.lookups - used) },
    get partial() { return incomplete },
    async search(value: unknown): Promise<LookupResult> {
      const base: LookupResult = { status: 'invalid', projectId, retrievedAt: new Date().toISOString(), records: [], related: [], truncated: false, partial: true, truth: 'unknown' }
      // Invalid attempts count too, so malformed/hostile calls cannot loop forever.
      if (++used > LIMITS.lookups) { incomplete = true; return { ...base, status: 'budget_exhausted' } }
      const input = parseLookup(value)
      if (!input) { incomplete = true; return base }
      base.dataset = input.dataset
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const { data, error } = await Promise.race([
          Promise.resolve(transport(projectId, input, controller.signal)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, timeoutMs) }),
        ])
        if (error) {
          incomplete = true
          return { ...base, status: error.code === '42501' ? 'denied' : error.code === '22023' ? 'invalid' : 'unavailable' }
        }
        const payload = data as LookupPayload
        if (!payload || !Array.isArray(payload.records) || !Array.isArray(payload.related) || typeof payload.truncated !== 'boolean') throw new Error('invalid_payload')
        const result: LookupResult = { ...base, status: 'ok', records: payload.records.slice(0, LIMITS.rows), related: payload.related.slice(0, LIMITS.joinedRows), truncated: payload.truncated || payload.records.length > LIMITS.rows || payload.related.length > LIMITS.joinedRows }
        while (new TextEncoder().encode(JSON.stringify(result)).length > LIMITS.bytes) {
          result.truncated = true
          if (result.related.length) result.related.pop()
          else result.records.pop()
        }
        result.status = result.records.length || result.truncated ? 'ok' : 'empty'
        incomplete ||= result.truncated
        for (const row of [...result.records, ...result.related]) {
          const label = String(row.name ?? row.title ?? row.text ?? row.id).slice(0, 120)
          sources.push({ projectId, dataset: typeof row.kind === 'string' ? row.kind : input.dataset, recordId: row.id, label, retrievedAt: result.retrievedAt, updatedAt: row.updated_at ?? null, truth: 'unknown' })
        }
        return result
      } catch {
        incomplete = true
        return { ...base, status: 'unavailable' }
      } finally { clearTimeout(timer) }
    },
  }
}
