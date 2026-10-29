import { constructionBox } from './construction-checks.ts'

/** Owner decision 2026-10-29 (pinned per manifest, construction_text_version 1):
 * a parameter change or part edit must not leave stale size text in the
 * Construction's title or description. In the paid box run the title kept
 * "400x300x250" after the width became 500, and the drawing copied it.
 * The server never rewrites Bob's prose: a change that would leave the overall
 * size stated wrongly is rejected with the exact fragments, and Bob resends it
 * with corrected text in the same call (`text`). Parameters own dimensions. */

type Row = Record<string, any>
type Tool = { type: 'function'; function: { name: string; description: string; parameters: any } }

export const CONSTRUCTION_TEXT_SCHEMA = { anyOf: [{
  type: 'object', additionalProperties: false, required: ['title', 'description'],
  properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', minLength: 1, maxLength: 5500 } },
}, { type: 'null' }] }

export const CONSTRUCTION_TEXT_NOTE = ' text:null keeps the saved title and description. When either states a size this change alters, supply text with the complete corrected title and description (or leave sizes out of them); a change that would leave a stated overall size wrong is rejected without saving.'

export function withConstructionText(base: Tool): Tool {
  const p = base.function.parameters
  return { ...base, function: { ...base.function, description: base.function.description + CONSTRUCTION_TEXT_NOTE,
    parameters: { ...p, properties: { ...p.properties, text: CONSTRUCTION_TEXT_SCHEMA }, required: [...new Set([...p.required, 'text'])] } } }
}

const unitFactor = (unit: string | undefined) => unit === 'cm' ? 10 : unit === 'm' ? 1000 : 1
const num = (value: string) => Number(value.replace(',', '.'))
const N = '(\\d+(?:[.,]\\d+)?)', U = '(?:\\s*(mm|cm|m)\\b)?'
const MULTI = new RegExp(`${N}${U}\\s*[x×*]\\s*${N}${U}(?:\\s*[x×*]\\s*${N}${U})?`, 'gi')
const WORD_AFTER = new RegExp(`${N}\\s*(mm|cm|m)\\s+(?:bred|bredd|brett|djup|djupt|hög|högt|höjd|lång|långt|längd|wide|deep|high|tall|long)\\b`, 'gi')
const WORD_BEFORE = new RegExp(`\\b(?:bredd|djup|höjd|längd|width|depth|height|length)(?:en)?\\s*(?:på|of|:)?\\s*${N}\\s*(mm|cm|m)\\b`, 'gi')

/** Size statements: each expression and its numbers in millimetres. A unit
 * after the last number applies to earlier bare numbers ("400 × 300 × 250 mm"). */
export function sizeStatements(text: string): { fragment: string; mm: number[] }[] {
  if (typeof text !== 'string' || !text) return []
  const found: { fragment: string; mm: number[] }[] = []
  for (const m of text.matchAll(MULTI)) {
    const values = [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].filter(([v]) => v !== undefined)
    const last = [...values].reverse().find(([, u]) => u)?.[1]
    found.push({ fragment: m[0].trim(), mm: values.map(([v, u]) => num(v!) * unitFactor((u ?? last)?.toLowerCase())) })
  }
  for (const pattern of [WORD_AFTER, WORD_BEFORE]) for (const m of text.matchAll(pattern))
    found.push({ fragment: m[0].trim(), mm: [num(m[1]) * unitFactor(m[2].toLowerCase())] })
  return found
}

/** Overall size of the visible box instances, in recipe axis order. */
export function recipeSize(recipe: Row | null | undefined, instancePolicy?: Row | null): number[] | null {
  const references = new Set<string>((instancePolicy?.instances ?? []).filter((i: Row) => i?.role === 'reference').map((i: Row) => i.instance_id))
  const definitions = new Map<string, Row>((recipe?.definitions ?? []).map((d: Row) => [d.id, d]))
  const boxes = (recipe?.instances ?? []).filter((i: Row) => !references.has(i.id))
    .map((i: Row) => constructionBox(i, definitions.get(i.definition_id) as Row)).filter(Boolean) as { min: number[]; max: number[] }[]
  if (!boxes.length) return null
  return [0, 1, 2].map(k => Math.max(...boxes.map(b => b.max[k])) - Math.min(...boxes.map(b => b.min[k])))
}

const TOLERANCE_MM = 0.5
/** True when every stated number matches a distinct dimension of size. */
function within(values: number[], size: number[]): boolean {
  const left = [...size]
  for (const value of values) {
    const at = left.findIndex(d => Math.abs(d - value) <= TOLERANCE_MM)
    if (at < 0) return false
    left.splice(at, 1)
  }
  return true
}

export interface StaleSizeText { field: 'title' | 'description'; fragment: string }

/** Fragments that stated the previous overall size and do not state the new one. */
export function staleSizeText(texts: { title?: unknown; description?: unknown }, before: number[] | null, after: number[] | null): StaleSizeText[] {
  if (!before || !after || within(before, after) && within(after, before)) return []
  const stale: StaleSizeText[] = []
  for (const field of ['title', 'description'] as const) {
    const value = texts[field]
    if (typeof value !== 'string') continue
    for (const statement of sizeStatements(value))
      if (within(statement.mm, before) && !within(statement.mm, after) && !stale.some(s => s.field === field && s.fragment === statement.fragment))
        stale.push({ field, fragment: statement.fragment })
  }
  return stale
}

const shown = (size: number[]) => size.map(v => String(Math.round(v * 10) / 10).replace('.', ',')).join(' × ')

/** The rejected result for a change that would leave a stated size wrong.
 * Nothing is saved; the fragments are Bob's own text, quoted back to him. */
export function staleTextRejection(stale: StaleSizeText[], after: number[], supplied: boolean) {
  const fields = [...new Set(stale.map(s => s.field))]
  return { status: 'invalid', reason: 'stale_construction_text', validation: { code: 'stale_construction_text', fields: fields.map(f => 'text.' + f) },
    stale, current_size_mm: after.map(v => Math.round(v * 10) / 10),
    message: `No change made. ${supplied ? 'The supplied text still states' : 'The saved ' + fields.join(' and ') + ' state'} ${stale.map(s => JSON.stringify(s.fragment)).join(', ')}, but after this change the overall size is ${shown(after)} mm. Resend the same change with text: the complete title and description stating the new size, or without sizes.` }
}
