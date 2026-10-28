import type { AiCatalogSession } from './ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { readTaskSources, TASK_SOURCES_TOOL } from './task-sources.ts'

/** FORM package 3 small source reader. Code selects the exact text sources of
 * the task packet; a small model answers one concrete question with findings
 * that QUOTE those sources. Code keeps only findings whose quote occurs in the
 * named source, so the model can neither invent a source nor replace an exact
 * value with prose. It writes nothing and approves nothing. Inactive until the
 * pinned catalog enables SOURCE_READER_ROLE and the tool's policy. */
export const SOURCE_READER_ROLE = 'role.source-reader'
export const SOURCE_READER_VERSION = 'source-reader-v1'
type Row = Record<string, any>

export const SOURCE_FINDINGS_TOOL = { type: 'function' as const, function: {
 name: 'read_source_findings',
 description: 'Ask a small reader one concrete question about the exact text sources of the next piece of work: the selected Solution summary, features and choices, the Step completion requirements and the Construction description and open questions. Every finding quotes its source.',
 parameters: { type: 'object', additionalProperties: false, required: ['area_id', 'step_id', 'construction', 'question'], properties: {
  ...TASK_SOURCES_TOOL.function.parameters.properties,
  question: { type: 'string', minLength: 3, maxLength: 500, description: 'One concrete question the sources should answer, e.g. which requirements constrain the ladder side.' },
 } },
} }

const KINDS = ['requirement', 'constraint', 'measurement', 'preference', 'open_question', 'other'] as const
const string = (max: number) => ({ type: 'string', minLength: 1, maxLength: max })
const record = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
/** Catalog schema source for `schema.bob_source_findings`. */
export const SOURCE_FINDINGS_SCHEMA = record({
 findings: { type: 'array', maxItems: 24, items: record({ source_ref: string(120), kind: { type: 'string', enum: [...KINDS] }, statement: string(600), quote: string(400),
  certainty: { type: 'string', enum: ['stated', 'implied', 'uncertain'] } }) },
 conflicts: { type: 'array', maxItems: 8, items: record({ source_refs: { type: 'array', minItems: 2, maxItems: 4, items: string(120) }, description: string(600) }) },
 not_answered: { type: 'string', maxLength: 600 },
})

export type ReaderSource = { ref: string; kind: string; text: string }
const MAX_SOURCE_CHARS = 2000, MAX_TOTAL_CHARS = 24000
const textOf = (...parts: unknown[]) => parts.filter(p => typeof p === 'string' && p.trim()).join(' — ')
/** Exact text sources from the packet (and the Construction notes page). */
export function collectReaderSources(packet: Row, notes: Row | null): { sources: ReaderSource[]; truncated: string[] } {
 const all: ReaderSource[] = [], truncated: string[] = []
 const add = (ref: string, kind: string, text: string) => {
  if (!text.trim()) return
  if (text.length > MAX_SOURCE_CHARS) { truncated.push(ref); text = text.slice(0, MAX_SOURCE_CHARS) }
  all.push({ ref, kind, text })
 }
 const s = packet.solution ?? {}
 if (s.status === 'ok') {
  if (s.summary) add('solution:summary', 'solution_summary', s.summary)
  for (const f of s.features ?? []) add('feature:' + f.id, 'solution_feature', textOf(f.description))
  for (const c of s.choices ?? []) add('choice:' + c.id, 'solution_choice', textOf(c.question, c.selected_direction, c.deferral?.reason))
 }
 if (packet.step?.status === 'ok') for (const r of packet.step.requirements ?? []) if (r.id) add('requirement:' + r.id, 'step_requirement', textOf(r.title, r.description))
 for (const item of Array.isArray(notes?.items) ? notes!.items : []) {
  if (item?.collection === 'description' && typeof item.value === 'string') add('construction:description', 'construction_description', item.value)
  else if (item?.collection === 'open_questions' && typeof item.value === 'string') add('construction:question:' + item.id, 'construction_open_question', item.value)
  else if (item?.fragment) truncated.push('construction:' + item.collection)
 }
 const sources: ReaderSource[] = []
 let total = 0
 for (const source of all) { if (total + source.text.length > MAX_TOTAL_CHARS) { truncated.push(source.ref); continue } total += source.text.length; sources.push(source) }
 return { sources, truncated }
}

const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()
/** Keep only findings that quote an offered source verbatim (whitespace and
 * case aside); report how many were rejected. */
export function verifyFindings(value: unknown, sources: ReaderSource[]) {
 let v: any = value
 if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
 if (!v || typeof v !== 'object' || !Array.isArray(v.findings) || !Array.isArray(v.conflicts) || typeof v.not_answered !== 'string') return null
 const byRef = new Map(sources.map(s => [s.ref, norm(s.text)]))
 const findings: Row[] = [], rejected: Row[] = []
 for (const f of v.findings) {
  const text = byRef.get(f?.source_ref), quote = typeof f?.quote === 'string' ? norm(f.quote) : ''
  const ok = text !== undefined && quote.length > 0 && text.includes(quote) && KINDS.includes(f.kind) && typeof f.statement === 'string'
   && ['stated', 'implied', 'uncertain'].includes(f.certainty)
  if (ok) findings.push({ source_ref: f.source_ref, kind: f.kind, statement: f.statement, quote: f.quote, certainty: f.certainty, origin: 'model_interpretation', quote_verified: true })
  else rejected.push({ source_ref: typeof f?.source_ref === 'string' ? f.source_ref : null, reason: text === undefined ? 'unknown_source' : 'quote_not_in_source' })
 }
 const conflicts = v.conflicts.filter((c: any) => Array.isArray(c?.source_refs) && c.source_refs.length >= 2 && c.source_refs.every((r: unknown) => byRef.has(r as string)) && typeof c.description === 'string')
  .map((c: any) => ({ source_refs: [...c.source_refs], description: c.description, origin: 'model_interpretation' }))
 return { findings, rejected, conflicts, not_answered: v.not_answered }
}

export function sourceReaderEnabled(catalog: AiCatalogSession) {
 const rows = catalog.manifest().definitions
 return rows.some(r => r.prompt_key === SOURCE_READER_ROLE && r.definition?.enabled === true) && rows.some(r => r.prompt_key === 'tools.read_source_findings')
}

export type SourceReader = ReturnType<typeof createSourceReader>
/** One bounded reader per turn; its call counter is checkpointed. */
export function createSourceReader(opts: {
 aiCatalog: AiCatalogSession; userId: string; projectId: string; hasAccess: () => Promise<boolean>; deadline: number
 callModel: (o: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<string>>
 maxCalls?: number
}) {
 let used = 0
 const max = opts.maxCalls ?? 3
 return {
  tools: [SOURCE_FINDINGS_TOOL],
  get remaining() { return Math.max(0, max - used) },
  get used() { return used },
  exportState() { return { version: 1 as const, used } },
  restoreState(state: { version: 1; used: number }) { if (state?.version !== 1 || !Number.isSafeInteger(state.used) || state.used < 0) throw new Error('source_reader_checkpoint_invalid'); used = state.used },
  async execute(raw: unknown, readers: { search: (q: Row) => Promise<any>; construction?: (q: Row) => Promise<Row> }): Promise<Row> {
   if (!sourceReaderEnabled(opts.aiCatalog)) return { status: 'unavailable', reason: 'source_reader_disabled' }
   const v = raw as Row
   if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'area_id,construction,question,step_id'
    || typeof v.question !== 'string' || v.question.trim().length < 3 || v.question.length > 500) return { status: 'invalid', message: 'Pass area_id, step_id, construction and one concrete question (3-500 characters).' }
   if (used >= max) return { status: 'budget_exhausted' }
   const { question, ...scope } = v
   const packet = await readTaskSources(scope, { projectId: opts.projectId, ...readers })
   if (packet.status !== 'ok') return packet
   let notes: Row | null = null
   if (packet.construction?.status === 'ok' && readers.construction) {
    try { notes = await readers.construction(packet.construction.reopen.input) } catch (error) { rethrowContinuation(error); notes = null }
    if (notes?.status === 'denied') return { status: 'denied' }
    if (notes?.status !== 'ok') notes = null
   }
   const { sources, truncated } = collectReaderSources(packet, notes)
   const pins = { solution: packet.solution?.status === 'ok' ? { solution_id: packet.solution.solution_id, solution_revision: packet.solution.solution_revision } : null,
    step: packet.step?.status === 'ok' ? { step_id: packet.step.step_id, plan_revision: packet.step.plan_revision } : null,
    construction: packet.construction?.status === 'ok' ? { artifact_id: packet.construction.artifact_id, revision: packet.construction.revision } : null }
   const coverage = [...packet.coverage, { source: 'construction_notes', status: packet.construction?.status !== 'ok' ? 'not_requested' : notes ? (notes.coverage?.complete === false ? 'truncated' : 'ok') : 'unavailable' },
    ...(truncated.length ? [{ source: 'reader_input', status: 'truncated', refs: truncated }] : [])]
   const base = { question, pins, sources: sources.map(s => ({ ref: s.ref, kind: s.kind })), coverage, conflicts_in_records: packet.conflicts,
    limits: 'Findings are a small model\'s reading of the quoted project text, checked only for verbatim quotes. They are not project truth, approval or a measurement. Reopen the originals through read_task_sources pointers before relying on a finding.' }
   if (!sources.length) return { status: 'ok', ...base, findings: [], conflicts: [], not_answered: 'No text sources were available for this scope.', rejected_findings: [] }
   if (!await opts.hasAccess()) return { status: 'denied' }
   used++
   const result = await opts.callModel({ app: 'bob', coworkerId: 'bob', functionName: 'source-reader', aiFunction: 'source-reader', module: 'global', userId: opts.userId,
    catalogRoleKey: 'source-reader', catalogSchemaKey: 'bob_source_findings',
    messages: [{ role: 'user', content: JSON.stringify({ version: SOURCE_READER_VERSION, question, sources }) }],
    timeoutMs: Math.max(1000, Math.min(45000, opts.deadline - Date.now())) })
   if (!await opts.hasAccess()) return { status: 'denied' }
   if (!result.success) return { status: 'unavailable', reason: 'reader_unavailable', ...base, findings: [], conflicts: [], rejected_findings: [] }
   const checked = verifyFindings(result.data, sources)
   if (!checked) return { status: 'unavailable', reason: 'reader_output_invalid', ...base, findings: [], conflicts: [], rejected_findings: [] }
   return { status: 'ok', ...base, findings: checked.findings, conflicts: checked.conflicts, not_answered: checked.not_answered, rejected_findings: checked.rejected }
  },
 }
}
