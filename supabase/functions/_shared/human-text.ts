/** Owner decision 2026-10-26: human text holds only human prose; references are
 * typed relations, never IDs or codes in free text. This pure check finds the
 * fragments that do not belong in text people read. Writers reject them, so Bob
 * rewrites in the same turn. Typed fields and quotes of the owner's own words
 * are never passed here. Ordinary Swedish/English prose, measurements, external
 * web addresses, e-mail addresses and file names pass. */

export type HumanTextKind = 'record_id' | 'internal_code' | 'tool_name' | 'revision_ref' | 'internal_link'
export interface HumanTextIssue { kind: HumanTextKind; fragment: string }

const KIND_LABELS: Record<HumanTextKind, string> = {
  record_id: 'database IDs',
  internal_code: 'internal codes',
  tool_name: 'tool names',
  revision_ref: 'revision numbers',
  internal_link: 'app links or paths',
}

// App routes (src/App.tsx). A path counts only at a word start, so "c/c 600"
// and "och/eller" never match.
const ROUTES = 'project|areas|tasks|facts|solutions|artifacts|material-plan|building|people|events|food|shopping|announcements|today|account|volunteer|install'
const ROUTE_PATH = new RegExp(`(?<=^|[\\s(\\[{"'\`])#?/(?:${ROUTES})(?=$|[/?#\\s)\\]}"'\`.,;:!])[^\\s)\\]}"'\`]*`, 'gi')
const MARKDOWN_LINK = /\[[^\]\n]{0,200}\]\(\s*([^)\s]{1,500})\s*\)/g
const APP_URL = /https?:\/\/[^\s)\]>"'`]*github\.io\/Bob-the-builder[^\s)\]>"'`]*/gi
const EXTERNAL_URL = /\bhttps?:\/\/[^\s)\]>"'`]+/gi
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const FILE_NAME = /[\w.-]+\.(?:jpe?g|png|heic|webp|gif|pdf|step|stp|svg|dxf|dwg|xlsx?|docx?|csv|txt)\b/gi
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b(?:@\d+)?/gi
// Hashes and opaque references: long hexadecimal runs mixing digits and letters.
const HEX_RUN = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi
const SNAKE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b(?:@\d+)?/g
const CAMEL = /\b[a-z]{2,}[A-Z][A-Za-z0-9]*\b/g
const REVISION = /\brevision(?:en)?\s+#?\d+\b/gi
const REV = /\b(rev)(\.?)(\s?)(\d+)\b/gi
// First words of Bob's tool names; an all-letter snake token starting with one is a tool name.
const TOOL_VERBS = new Set(['read', 'save', 'edit', 'create', 'change', 'search', 'list', 'open', 'describe', 'generate', 'attach', 'detach', 'finalize', 'derive', 'check', 'design', 'plan', 'compose', 'link', 'ensure', 'cancel', 'restore', 'select', 'manage', 'update', 'delete', 'archive', 'set', 'propose', 'decide', 'compile', 'audit', 'inspect', 'calculate', 'continue', 'transition'])
// Camera file stems (IMG_1234) and names with an inner capital stay human text.
const CAMERA = /^[A-Z]+_\d+$/
const ALLOWED_CAMEL = new Set(['mmHg', 'macOS'])
// Swedish "rev" is also the past tense of "riva": "vi rev 3 väggar" is prose.
const SUBJECTS = new Set(['vi', 'jag', 'ni', 'de', 'dom', 'han', 'hon', 'hen', 'du', 'man', 'som', 'och', 'sen', 'sedan', 'redan', 'också', 'då'])
const RECORD_NOUN = /(?:ritning|drawing|artifact|lösning|solution|plan|konstruktion|construction|version)(?:en|ens|s|er|ar|na)?$/i

export function humanTextIssues(text: string): HumanTextIssue[] {
  if (typeof text !== 'string' || !text.trim()) return []
  const issues: HumanTextIssue[] = []
  const add = (kind: HumanTextKind, fragment: string) => {
    const value = fragment.trim()
    if (value && !issues.some(i => i.fragment === value)) issues.push({ kind, fragment: value })
  }
  // Each pass blanks what it consumed, so a fragment is reported once and
  // allowed spans (web addresses, e-mail, file names) are not checked further.
  let rest = text
  const consume = (pattern: RegExp, verdict: (whole: string, target?: string) => HumanTextKind | 'allow' | 'keep') => {
    rest = rest.replace(pattern, (whole: string, target?: unknown) => {
      const found = verdict(whole, typeof target === 'string' ? target : undefined)
      if (found === 'keep') return whole
      if (found !== 'allow') add(found, whole)
      return ' '.repeat(whole.length)
    })
  }
  consume(MARKDOWN_LINK, (_, target = '') => !/^(?:https?:\/\/|mailto:|tel:)/i.test(target) || /github\.io\/Bob-the-builder/i.test(target) ? 'internal_link' : 'keep')
  consume(APP_URL, () => 'internal_link')
  consume(ROUTE_PATH, () => 'internal_link')
  for (const allowed of [EXTERNAL_URL, EMAIL, FILE_NAME]) consume(allowed, () => 'allow')
  consume(UUID, () => 'record_id')
  consume(HEX_RUN, () => 'record_id')
  consume(SNAKE, whole => {
    const token = whole.replace(/@\d+$/, ''), parts = token.split('_')
    return CAMERA.test(token) ? 'allow' : TOOL_VERBS.has(parts[0]) && parts.every(p => /^[a-z]+$/.test(p)) ? 'tool_name' : 'internal_code'
  })
  consume(CAMEL, whole => ALLOWED_CAMEL.has(whole) ? 'allow' : 'internal_code')
  consume(REVISION, () => 'revision_ref')
  for (const match of rest.matchAll(REV)) {
    const [whole, , dot, space] = match
    const before = rest.slice(0, match.index).match(/(\p{L}+)[^\p{L}]*$/u)?.[1] ?? ''
    const after = rest.slice(match.index! + whole.length)
    const verb = !dot && !!space && (SUBJECTS.has(before.toLowerCase()) || /^\s*\p{L}/u.test(after) && !RECORD_NOUN.test(before))
    if (!verb) add('revision_ref', whole)
  }
  return issues
}

/** Strings at prose paths. A path is dotted keys; '*' matches any array index
 * or object key. base is where value sits inside its tool input. */
export function proseFields(value: unknown, paths: readonly string[], base: readonly string[] = []): [string, string][] {
  const patterns = paths.map(p => p.split('.'))
  const out: [string, string][] = []
  const visit = (v: unknown, at: string[], depth: number) => {
    if (depth > 12) return
    if (typeof v === 'string') {
      if (patterns.some(p => p.length === at.length && p.every((segment, i) => segment === '*' || segment === at[i]))) out.push([at.join('.'), v])
    } else if (Array.isArray(v)) v.forEach((item, i) => visit(item, [...at, String(i)], depth + 1))
    else if (v && typeof v === 'object') for (const [key, item] of Object.entries(v)) visit(item, [...at, key], depth + 1)
  }
  visit(value, [...base], 0)
  return out
}

export interface HumanTextRejection { fields: string[]; kinds: HumanTextKind[]; fragments: string[]; message: string }

/** One answerable rejection naming every prose field with internal fragments,
 * or null when all of them read as plain prose. It never suggests wording. */
export function humanTextRejection(fields: readonly (readonly [string, unknown])[]): HumanTextRejection | null {
  const found = fields.flatMap(([field, value]) => typeof value === 'string' ? humanTextIssues(value).map(issue => ({ field, ...issue })) : [])
  if (!found.length) return null
  const unique = <T>(values: T[]) => [...new Set(values)]
  const names = unique(found.map(f => f.field)), kinds = unique(found.map(f => f.kind)), fragments = unique(found.map(f => f.fragment))
  const shown = fragments.slice(0, 4).map(f => JSON.stringify(f.length > 60 ? f.slice(0, 57) + '…' : f)).join(', ') + (fragments.length > 4 ? ', …' : '')
  return { fields: names, kinds, fragments,
    message: `${names.join(', ')}: ${kinds.map(k => KIND_LABELS[k]).join(' and ')} found (${shown}). Text people read holds only plain prose; rewrite it in plain words and keep references in the tool's typed fields.` }
}
