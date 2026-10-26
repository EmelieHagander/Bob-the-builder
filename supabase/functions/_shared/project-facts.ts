/** Pure project facts read once at turn start (owner decision 2026-10-26,
 * Docs/ask-bob-context.md). Code-selected saved values from
 * bob.read_project_facts: an observation for Bob, never a model summary and
 * never authority for a write, check or render. */
export type ProjectFacts = Record<string, unknown> & { status: 'ok' | 'unavailable' }

/** The SQL reader bounds every list; this only guards an unexpected payload. */
export const PROJECT_FACTS_MAX_CHARS = 24000

export function projectFactsPacket(data: unknown, failed: boolean, projectId: string): ProjectFacts {
  if (failed || !data || typeof data !== 'object' || Array.isArray(data)) return { status: 'unavailable' }
  const value = data as Record<string, unknown>
  if (value.status !== 'ok' || value.project_id !== projectId || value.version !== 1) return { status: 'unavailable' }
  if (JSON.stringify(value).length > PROJECT_FACTS_MAX_CHARS) return { status: 'unavailable', reason: 'too_large' }
  return value as ProjectFacts
}
