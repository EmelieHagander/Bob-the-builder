/** Freshness is separate from the saved Concept/Measured/Build ready decision. */
export interface DrawingSourceStatus {
  source_state: 'current' | 'changed' | 'unavailable'
  source_reasons: string[]
  changes?: DrawingSourceChange[]
  changesTruncated?: boolean
  changesUnavailable?: boolean
}

/** Caller-authorised revision delta; removed/denied physical sources have no id. */
export interface DrawingSourceChange {
  kind: 'project_measurement' | 'space_measurement' | 'drawing' | 'target' | 'image'
  id: string | null
  saved_revision?: number
  current_revision?: number | null
  saved_version?: string
  current_version?: string | null
  parameter_ids: string[]
  state: 'changed' | 'unavailable'
}

/** Malformed deltas must keep the saved drawing recoverable, with a visible
 * unavailable notice rather than trusting or rendering arbitrary RPC data. */
export function parseDrawingSourceChanges(value: unknown): { changes: DrawingSourceChange[]; changesTruncated: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.changes) || result.changes.length > 200 || typeof result.truncated !== 'boolean') return null
  const keys = ['kind', 'id', 'saved_revision', 'current_revision', 'saved_version', 'current_version', 'parameter_ids', 'state']
  const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 2147483647
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
  for (const change of result.changes) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return null
    const c = change as Record<string, unknown>
    if (Object.keys(c).some(key => !keys.includes(key))
      || !['project_measurement', 'space_measurement', 'drawing', 'target', 'image'].includes(String(c.kind))
      || (c.id !== null && !text(c.id, 200)) || !['changed', 'unavailable'].includes(String(c.state))
      || !Array.isArray(c.parameter_ids) || c.parameter_ids.length > 1024 || !c.parameter_ids.every(id => text(id, 240))
      || ('saved_revision' in c && !revision(c.saved_revision))
      || ('current_revision' in c && c.current_revision !== null && !revision(c.current_revision))
      || ('saved_version' in c && !text(c.saved_version, 512))
      || ('current_version' in c && c.current_version !== null && !text(c.current_version, 512))) return null
  }
  return { changes: result.changes as DrawingSourceChange[], changesTruncated: result.truncated }
}
