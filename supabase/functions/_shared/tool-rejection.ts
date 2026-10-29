/** Content-free reason for a rejected tool call (owner request 2026-10-29: the
 * paid run's edit_project_record rejection could not be explained from logs).
 * Only codes and field paths leave this function, never message text, values
 * or Bob's prose. Typed codes come first; the content editor's fixed server
 * messages map to stable codes by their prefix. */

// Fixed messages in project-edits.ts (applyProjectDelta and prepare). The
// mapping test fails when a message there has no code here.
export const EDIT_REJECTION_CODES: readonly (readonly [string, string])[] = [
  ['Read and choose a server-issued edit_ref', 'edit_ref_required'],
  ['The selected version is older than', 'edit_selected_version_stale'],
  ['Supply 1–40 content changes', 'edit_change_count'],
  ['Invalid change shape', 'edit_change_shape'],
  ['Supply a JSON value', 'edit_value_json'],
  ['Unsupported content path', 'edit_path_unsupported'],
  ['Unsupported design content path', 'edit_path_unsupported'],
  ['Unsupported concept path', 'edit_path_unsupported'],
  ['Unsupported item field', 'edit_path_unsupported'],
  ['Clear a text field explicitly', 'edit_remove_text'],
  ['Required design fields cannot be removed', 'edit_remove_required'],
  ['Initialize the design summary', 'edit_design_uninitialized'],
  ['Initialize the concept model first', 'edit_concept_uninitialized'],
  ['Concept changes use set', 'edit_concept_operation'],
  ['Revise named concept fields', 'edit_concept_replace'],
  ['Concept identities and whole components cannot be replaced', 'edit_concept_replace'],
  ['A new concept item needs a new identity', 'edit_identity'],
  ['New design items contain content only', 'edit_identity'],
  ['Use an index from the saved concept read', 'edit_index'],
  ['Use an item index from this edit context', 'edit_index'],
  ['Change individual item fields', 'edit_item_operation'],
  ['Set alignment explicitly', 'edit_alignment_operation'],
  ['append_text requires text', 'edit_append_text'],
  ['Invalid or oversized ', 'edit_field_size'],
  ['Design content is inconsistent or oversized', 'edit_design_inconsistent'],
  ['Invalid read selection', 'edit_read_selection'],
  ['Use the exact next_ref and filter', 'edit_read_cursor'],
]
export const TOOL_REJECTION_CODES: readonly string[] = [...new Set([...EDIT_REJECTION_CODES.map(([, code]) => code), 'invalid_json', 'unspecified'])]

const CODE = /^[a-z][a-z0-9_]{0,39}$/
const PATH = /^[A-Za-z0-9_.\/\-*]{1,120}$/

export interface ToolRejection { code: string; fields: string[] }

export function toolRejection(result: unknown): ToolRejection {
  const r = result && typeof result === 'object' ? result as Record<string, any> : {}
  const issues = Array.isArray(r.issues) ? r.issues.filter((i: unknown) => i && typeof i === 'object') : []
  const fields = (Array.isArray(r.validation?.fields) ? r.validation.fields : issues.map((i: Record<string, unknown>) => i.path))
    .filter((f: unknown): f is string => typeof f === 'string' && PATH.test(f)).slice(0, 8)
  const typed = [r.validation?.code, r.reason, issues[0]?.code].find(c => typeof c === 'string' && CODE.test(c))
  if (typed) return { code: typed, fields }
  const message = typeof r.message === 'string' ? r.message.replace(/^No change made\.\s*/, '') : ''
  const mapped = EDIT_REJECTION_CODES.find(([prefix]) => message.startsWith(prefix))?.[1]
  if (mapped) return { code: mapped, fields }
  // A JSON value that does not parse surfaces the engine's own message.
  if (/JSON|Unexpected (token|end)/.test(message)) return { code: 'invalid_json', fields }
  return { code: 'unspecified', fields }
}
