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
// Fixed messages of the construction tools (construction-draft.ts) that carry no
// typed code (2026-10-31: box run 13 logged Konrad's rejected save as unspecified).
export const CONSTRUCTION_REJECTION_CODES: readonly (readonly [string, string])[] = [
  ['A joint Solution/Construction change uses target_revision:null', 'construction_target_revision'],
  ['Choose the selected Solution edit_ref', 'construction_solution_ref'],
  ['Use an exact quote from the current request', 'request_quote'],
  ['Name changed inputs or an explicit current target revision', 'construction_no_change'],
  ['Use work_kind, step_id and no result reference', 'construction_view_arguments'],
  ['work_kind and step_id apply only to view=work', 'construction_view_arguments'],
  ['List drafts with view=overview', 'construction_list_arguments'],
  ['Use the exact result_id and construction revision', 'construction_result_reference'],
  ['List saved checks without IDs', 'construction_results_arguments'],
  ['Use the current request and exact cut-plan revision', 'cut_plan_revision'],
  ['Use the current request and exact expected revision', 'expected_revision'],
  ['No construction changed. Correct only the named posts', 'construction_posts'],
  ['Invalid CAD recipe or referenced part IDs', 'invalid_recipe'],
  ['Image frames are not supported', 'unsupported_image_frame'],
  ['Computed dimensions or placement are outside', 'computed_geometry_invalid'],
  ['Bind every path in unbound', 'parameter_binding_gap'],
  ['Use next_read from this exact revision', 'construction_view_cursor_invalid'],
  ['Use fewer named IDs or one result section', 'construction_view_header_too_large'],
]
export const TOOL_REJECTION_CODES: readonly string[] = [...new Set([...EDIT_REJECTION_CODES.map(([, code]) => code), ...CONSTRUCTION_REJECTION_CODES.map(([, code]) => code), 'invalid_json', 'schema_mismatch', 'unspecified'])]

/** A short, stable fingerprint of a fixed server message (FNV-1a): it tells two
 * unmapped messages apart in the logs without carrying any of their text. */
function messageId(message: string): string {
  let hash = 0x811c9dc5
  for (const char of message.slice(0, 160)) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 0x01000193) >>> 0 }
  return 'm' + hash.toString(16).padStart(8, '0')
}

const CODE = /^[a-z][a-z0-9_]{0,39}$/
const PATH = /^[A-Za-z0-9_.\/\-*]{1,120}$/

export interface ToolRejection { code: string; fields: string[]; message_id?: string }

// Schema check paths ($.joints[0].fasteners) as dotted field paths (joints.0.fasteners).
const fieldPath = (path: unknown) => typeof path === 'string' ? path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '') : path

export function toolRejection(result: unknown): ToolRejection {
  const r = result && typeof result === 'object' ? result as Record<string, any> : {}
  const issues = Array.isArray(r.issues) ? r.issues.filter((i: unknown) => i && typeof i === 'object') : []
  const fields = (Array.isArray(r.validation?.fields) ? r.validation.fields : issues.map((i: Record<string, unknown>) => fieldPath(i.path)))
    .filter((f: unknown): f is string => typeof f === 'string' && PATH.test(f)).slice(0, 8)
  const typed = [r.validation?.code, r.reason, issues[0]?.code].find(c => typeof c === 'string' && CODE.test(c))
  if (typed) return { code: typed, fields }
  // Box run 17 (2026-11-01): arguments that failed the tool's schema logged as unspecified.
  if (issues.length && issues.every((i: Record<string, unknown>) => typeof i.expected === 'string')) return { code: 'schema_mismatch', fields }
  const message = typeof r.message === 'string' ? r.message.replace(/^No change made\.\s*/, '') : ''
  const mapped = [...EDIT_REJECTION_CODES, ...CONSTRUCTION_REJECTION_CODES].find(([prefix]) => message.startsWith(prefix))?.[1]
  if (mapped) return { code: mapped, fields }
  // Engine errors that are already codes (parameter_*, coordinate_*).
  if (CODE.test(message)) return { code: message, fields }
  // A JSON value that does not parse surfaces the engine's own message.
  if (/JSON|Unexpected (token|end)/.test(message)) return { code: 'invalid_json', fields }
  return { code: 'unspecified', fields, ...(message ? { message_id: messageId(message) } : {}) }
}
