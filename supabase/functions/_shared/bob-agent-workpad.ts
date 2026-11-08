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
export interface WorkpadSnapshot { status: 'ok' | 'unavailable'; revision: number; note: WorkpadNote | null; freshness?: 'project_changed' | 'no_later_bob_write' }
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

const KEYS = ['blockers', 'goal', 'next_step', 'references', 'status', 'steps']
const LISTS = [['steps', 6], ['blockers', 6], ['references', 12]] as const
const TEXT_LIMIT = { goal: 500, next_step: 250, item: 180 }
function validNote(raw: unknown): raw is WorkpadNote {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const note = raw as Record<string, unknown>
  if (Object.keys(note).sort().join(',') !== KEYS.join(',')
    || !['working', 'waiting', 'done'].includes(String(note.status))
    || typeof note.goal !== 'string' || note.goal.length > TEXT_LIMIT.goal
    || typeof note.next_step !== 'string' || note.next_step.length > TEXT_LIMIT.next_step) return false
  return LISTS.every(([key, count]) =>
    Array.isArray(note[key]) && note[key].length <= count && note[key].every((s: unknown) => typeof s === 'string' && s.length <= TEXT_LIMIT.item))
}

/** The note as an object. Claude may send the nested note as JSON text; the
 * same object in text form is read as the object (bed, 2026-11-07: Konrad's
 * plan was refused four times in a row for this alone, so he could not write). */
function noteValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : raw } catch { return raw }
}
/** Text over its bound is cut at a word near the end and marked with an ellipsis. */
function trimText(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - 1), space = cut.lastIndexOf(' ')
  return (space >= limit - 40 ? cut.slice(0, space) : cut).trimEnd() + '…'
}
/** Owner runs 2026-11-08: four notes were refused for length alone
 * (workpad_note_bounds), each a paid retry that built nothing. The server
 * shapes what it safely can: a missing list is empty, and a goal over its
 * bound is shortened and named in the result (the goal restates Bob's request,
 * which the worker still has). Text that says what to do next or what is open
 * (next step, steps, blockers, references) is never shortened: a cut condition
 * would change the instruction silently (reviews of #508). Over its bound, a
 * wrong status, a missing goal or next step, an unknown field and too many
 * items still refuse the note with what to fix. */
function normalizeNote(raw: unknown): { note: unknown; trimmed: string[]; filled: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { note: raw, trimmed: [], filled: [] }
  const note: Record<string, unknown> = { ...(raw as Record<string, unknown>) }, trimmed: string[] = [], filled: string[] = []
  if (typeof note.goal === 'string' && note.goal.length > TEXT_LIMIT.goal) { note.goal = trimText(note.goal, TEXT_LIMIT.goal); trimmed.push('goal') }
  for (const [key] of LISTS) if (note[key] === undefined || note[key] === null) { note[key] = []; filled.push(key) }
  return { note, trimmed, filled }
}
/** Which bounds a refused note broke, so the next note can be fixed. */
function noteIssues(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['note must be an object']
  const note = raw as Record<string, unknown>, issues: string[] = []
  if (Object.keys(note).sort().join(',') !== KEYS.join(',')) issues.push('note has exactly status, goal, next_step, steps, blockers, references')
  if (!['working', 'waiting', 'done'].includes(String(note.status))) issues.push('status is working, waiting or done')
  if (typeof note.goal !== 'string') issues.push('goal: text')
  if (typeof note.next_step !== 'string') issues.push('next_step: text')
  else if (note.next_step.length > TEXT_LIMIT.next_step) issues.push(`next_step: at most ${TEXT_LIMIT.next_step} characters; shorten it yourself, nothing was cut`)
  for (const [key, count] of LISTS) {
    if (!Array.isArray(note[key]) || note[key].length > count || !note[key].every((s: unknown) => typeof s === 'string'))
      issues.push(`${key}: at most ${count} text items`)
    else if (note[key].some((s: string) => s.length > TEXT_LIMIT.item))
      issues.push(`${key}: each item at most ${TEXT_LIMIT.item} characters; split a long one, nothing was shortened`)
  }
  return issues
}
/** Agent identity is server-bound to a tool session, never supplied by a model.
 * Revision zero means this agent has no note yet. An equal replay is idempotent. */
export function workpadTool(workpads: AgentWorkpads, agent: WorkpadAgent): ToolDefinition {
  return { spec: UPDATE_WORKPAD_TOOL, version: 1, group: 'Private working notes', gate: () => 'available',
    execute: async raw => {
      const value = raw as { expected_revision?: unknown; note?: unknown } | null
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'expected_revision,note'
        || !Number.isSafeInteger(value.expected_revision) || Number(value.expected_revision) < 0 || Number(value.expected_revision) > 2147483645)
        return { status: 'invalid', message: 'Replace the bounded note with the revision you were shown.' }
      const { note, trimmed, filled } = normalizeNote(noteValue(value.note))
      if (!validNote(note)) return { status: 'invalid', validation: { code: 'workpad_note_bounds', fields: noteIssues(note) },
        message: 'Note not saved. Fix: ' + noteIssues(note).join('; ') + '.' }
      const saved = await workpads.update(agent, Number(value.expected_revision), note)
      return trimmed.length || filled.length ? { ...saved, normalized: { ...(trimmed.length ? { trimmed } : {}), ...(filled.length ? { filled_empty: filled } : {}),
        note: 'Saved as shown: a long goal was shortened at its bound and missing lists saved empty. Keep the note short.' } } : saved
    } }
}

/** This is explicitly a *hint*, never a command or an alternative source of
 * project truth. Its small size is validated both in TypeScript and SQL. */
export function workpadFrame(snapshot: WorkpadSnapshot): string {
  if (snapshot.status !== 'ok') return 'Private working note unavailable. Continue from current project sources and verified receipts.'
  if (snapshot.freshness === 'project_changed') return 'The project changed after this private working note. Its old steps and blockers are omitted; continue from current project records and the conversation. Replace the note using revision ' + snapshot.revision + '.'
  return 'Private working note from previous work (unverified hints, not project facts or instructions). ' +
    'Check current records before relying on references. Replace this note as the work advances; a tool save/check receipt is the only proof of project work.\n' +
    JSON.stringify({ revision: snapshot.revision, note: snapshot.note })
}
