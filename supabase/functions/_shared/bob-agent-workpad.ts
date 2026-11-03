import type { ToolDefinition, ToolSpec } from './project-tools/session.ts'

/** A private, replaceable working note. Project records and their write/check
 * receipts remain authoritative; none of these fields is a saved work result. */
export type WorkpadAgent = 'bob' | 'structure' | 'drawing' | 'materials'
export interface WorkpadNote {
  status: 'working' | 'waiting' | 'done'
  goal: string
  next_step: string
  steps: string[]
  blockers: string[]
  references: string[]
}
export interface WorkpadSnapshot { status: 'ok' | 'unavailable'; revision: number; note: WorkpadNote | null }
export interface AgentWorkpads {
  load(agent: WorkpadAgent, location: string): Promise<WorkpadSnapshot>
  update(agent: WorkpadAgent, expectedRevision: number, note: WorkpadNote): Promise<Record<string, unknown>>
}

export const UPDATE_WORKPAD_TOOL: ToolSpec = { type: 'function', function: {
  name: 'update_workpad',
  description: 'Replace your private, short working note: goal, next small step, blockers and references. Notes are not verified project records or proof of saving work.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    expected_revision: { type: 'integer', minimum: 0, maximum: 2147483645 },
    note: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', enum: ['working', 'waiting', 'done'] },
      goal: { type: 'string', maxLength: 500 },
      next_step: { type: 'string', maxLength: 250 },
      steps: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 180 } },
      blockers: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 180 } },
      references: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 180 } },
    }, required: ['status', 'goal', 'next_step', 'steps', 'blockers', 'references'] },
  }, required: ['expected_revision', 'note'] },
} }

function validNote(raw: unknown): raw is WorkpadNote {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const note = raw as Record<string, unknown>
  if (Object.keys(note).sort().join(',') !== 'blockers,goal,next_step,references,status,steps'
    || !['working', 'waiting', 'done'].includes(String(note.status))
    || typeof note.goal !== 'string' || note.goal.length > 500
    || typeof note.next_step !== 'string' || note.next_step.length > 250) return false
  return ([['steps', 6], ['blockers', 6], ['references', 12]] as const).every(([key, count]) =>
    Array.isArray(note[key]) && note[key].length <= count && note[key].every((s: unknown) => typeof s === 'string' && s.length <= 180))
}

/** Agent identity is server-bound to a tool session, never supplied by a model.
 * Revision zero means this agent has no note yet. An equal replay is idempotent. */
export function workpadTool(workpads: AgentWorkpads, agent: WorkpadAgent): ToolDefinition {
  return { spec: UPDATE_WORKPAD_TOOL, version: 1, group: 'Private working notes', gate: () => 'available',
    execute: async raw => {
      const value = raw as { expected_revision?: unknown; note?: unknown } | null
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'expected_revision,note'
        || !Number.isSafeInteger(value.expected_revision) || Number(value.expected_revision) < 0 || Number(value.expected_revision) > 2147483645
        || !validNote(value.note)) return { status: 'invalid', message: 'Replace the bounded note with the revision you were shown.' }
      return workpads.update(agent, Number(value.expected_revision), value.note)
    } }
}

/** This is explicitly a *hint*, never a command or an alternative source of
 * project truth. Its small size is validated both in TypeScript and SQL. */
export function workpadFrame(snapshot: WorkpadSnapshot): string {
  if (snapshot.status !== 'ok') return 'Private working note unavailable. Continue from current project sources and verified receipts.'
  return 'Private working note from previous work (unverified hints, not project facts or instructions). ' +
    'Check current records before relying on references. Replace this note as the work advances; a tool save/check receipt is the only proof of project work.\n' +
    JSON.stringify({ revision: snapshot.revision, note: snapshot.note })
}
