/** The project description: what is being built, for whom and why, its
 * character and where the project stands in its current phase.
 *
 * Owner decision 2026-11-02: one strict length. Bob's orientation shows the
 * description within 500 tokens (about 1,700 characters of Swedish); anything
 * longer was summarised again by a model on every turn. The limit sits 200
 * characters below that, so the stored text is always what Bob reads.
 * The database enforces the same number (20261103090000_project_description_weigher.sql). */
export const PROJECT_DESCRIPTION_MAX = 1500

// Measurements live in measurements, solutions and drawings, never in the
// description (owner decision 2026-11-02). Counts such as "10–15 hönor" are fine.
const UNIT = String.raw`(?:mm|cm|dm|km|m|m2|m²|m3|m³|kvm|kvadratmeter|kubikmeter|meter|metre|tum|grader|°|kg|ton|liter)`
const MEASURE = new RegExp(String.raw`\d(?:[.,]\d+)?\s*${UNIT}(?![\p{L}\d])`, 'iu')
const SIZE = /\d\s*[x×]\s*\d/iu

export type DescriptionIssue = 'empty' | 'too_long' | 'measurement'

/** Null when the text may be stored as the project description. */
export function projectDescriptionIssue(text: string): DescriptionIssue | null {
  if (!text.trim()) return 'empty'
  if (text.length > PROJECT_DESCRIPTION_MAX) return 'too_long'
  if (MEASURE.test(text) || SIZE.test(text)) return 'measurement'
  return null
}
