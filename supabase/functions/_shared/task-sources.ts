import { rethrowContinuation } from './bob-job-journal.ts'

/** FORM package 3: one code-only read of the governing sources for the next
 * piece of work (Docs/ask-bob-context.md#task-source-packet). It composes the
 * existing caller-scoped readers, keeps exact ids/revisions and reopen
 * pointers, and reports coverage and conflicts. It interprets no free text,
 * reads no private conversation and writes nothing. */
type Row = Record<string, any>
type Lookup = { status: string; records: Row[]; truncated?: boolean; next_cursor?: string | null }
export const TASK_SOURCES_TOOL = { type: 'function' as const, function: {
 name: 'read_task_sources',
 description: 'Collect the governing sources for the next piece of work in one read: the selected Solution revision with its features and open choices, the Step completion requirements and the exact Construction revision state, with coverage, conflicts and reopen pointers.',
 parameters: { type: 'object', additionalProperties: false, required: ['area_id', 'step_id', 'construction'], properties: {
  area_id: { type: ['string', 'null'], maxLength: 200, description: 'Area of the work, or null for the whole project.' },
  step_id: { type: ['string', 'null'], maxLength: 200, description: 'Plan Step whose completion requirements apply, or null.' },
  construction: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['artifact_id', 'revision'], properties: {
   artifact_id: { type: 'string', format: 'uuid' }, revision: { type: 'integer', minimum: 1, maximum: 999999999 } } }],
   description: 'Exact saved Construction revision the work continues from, or null.' },
 } },
} }

const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const id = (v: unknown) => v === null || typeof v === 'string' && v.trim().length > 0 && v.length <= 200
const keys = (v: unknown, k: string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...k].sort().join(',')
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []

export type TaskSourcesInput = { area_id: string | null; step_id: string | null; construction: { artifact_id: string; revision: number } | null }
export function parseTaskSourcesInput(v: unknown): TaskSourcesInput | null {
 if (!keys(v, ['area_id', 'step_id', 'construction'])) return null
 const x = v as Row
 if (!id(x.area_id) || !id(x.step_id)) return null
 if (x.construction !== null && (!keys(x.construction, ['artifact_id', 'revision']) || !uuid(x.construction.artifact_id)
  || !Number.isSafeInteger(x.construction.revision) || x.construction.revision < 1)) return null
 return structuredClone(x) as TaskSourcesInput
}

type Coverage = { source: 'solution' | 'step_requirements' | 'construction'; status: string; note?: string; next?: unknown }
export const TASK_SOURCES_LIMITS = 'Code-selected exact project records only. Private conversation, images and the meaning of free text are not included or interpreted; reopen originals through the pointers. Nothing here approves a design, a measurement or fabrication.'

/** Reads run in a fixed order so a journaled turn replays them identically. */
export async function readTaskSources(raw: unknown, readers: {
 projectId: string
 search: (input: Row) => Promise<Lookup>
 construction?: (input: Row) => Promise<Row>
}): Promise<Row> {
 const input = parseTaskSourcesInput(raw)
 if (!input) return { status: 'invalid', message: 'Pass area_id, step_id and construction ({artifact_id, revision} or null).' }
 const coverage: Coverage[] = [], conflicts: { code: string; detail: Row }[] = [], open_items: Row[] = []
 const read = async (q: Row): Promise<Lookup> => {
  try { return await readers.search(q) } catch (error) { rethrowContinuation(error); return { status: 'unavailable', records: [] } }
 }

 // Selected Solution: the Area's own target, else the project target it inherits.
 const targetQuery = (area: string | null) => ({ dataset: 'target', query: null, status: null, area_id: area, record_id: area === null ? 'project' : null, after_id: null })
 let target = await read(targetQuery(input.area_id)), inherited = false
 if (target.status === 'denied') return { status: 'denied' }
 if (target.status === 'empty' && input.area_id !== null) { target = await read(targetQuery(null)); inherited = true }
 if (target.status === 'denied') return { status: 'denied' }
 const selected = target.status === 'ok' ? target.records[0] : undefined
 let solution: Row = { status: target.status === 'ok' ? (selected ? 'ok' : 'empty') : target.status }
 if (selected) {
  const intent = selected.design_intent && typeof selected.design_intent === 'object' ? selected.design_intent : null
  const choices = rows(intent?.choices)
  solution = { status: selected.solution_id ? 'ok' : 'no_selected_solution', target_id: selected.id, target_revision: selected.revision ?? null, inherited_from_project: inherited,
   solution_id: selected.solution_id ?? null, solution_revision: selected.solution_revision ?? null,
   alignment: intent?.alignment?.status ?? null,
   features: rows(intent?.features).map(f => ({ id: f.id, description: f.description, basis: f.basis, source_ref: f.source_ref ?? null })),
   choices: choices.map(c => ({ id: c.id, question: c.question, status: c.status, ...(c.selected_direction ? { selected_direction: c.selected_direction } : {}), ...(c.deferral ? { deferral: c.deferral } : {}) })),
   references: rows(intent?.references).map(r => ({ image_id: r.image_id, role: r.role })),
   reopen: { tool: 'search_project_data', input: targetQuery(inherited ? null : input.area_id) } }
  for (const c of choices) if (c.status !== 'resolved') open_items.push({ source: 'solution', choice_id: c.id, status: c.status })
  if (!intent) conflicts.push({ code: 'design_intent_missing', detail: { solution_id: selected.solution_id ?? null, solution_revision: selected.solution_revision ?? null } })
 }
 coverage.push({ source: 'solution', status: solution.status, ...(inherited ? { note: 'Area has no own target; the project target applies.' } : {}),
  ...(target.truncated ? { next: target.next_cursor ?? null } : {}) })

 // Completion requirements of the requested Step in the approved plan.
 let step: Row = { status: 'not_requested' }
 if (input.step_id !== null) {
  const planQuery = { dataset: 'plan', query: null, status: null, area_id: null, record_id: null, after_id: null }
  const plan = await read(planQuery)
  if (plan.status === 'denied') return { status: 'denied' }
  const approved = plan.status === 'ok' ? plan.records.find(r => r.id === readers.projectId && r.status === 'approved') : undefined
  const found = approved ? rows(approved.steps).find(s => s.id === input.step_id) : undefined
  step = found ? { status: 'ok', step_id: found.id, plan_revision: approved!.revision ?? null, title: found.title ?? found.name ?? null, state: found.state ?? found.status ?? null,
    requirements: rows(found.requirements).map(r => ({ ...r })), reopen: { tool: 'search_project_data', input: planQuery } }
   : { status: plan.status !== 'ok' && plan.status !== 'empty' ? plan.status : approved ? 'step_not_in_approved_plan' : plan.truncated ? 'truncated' : 'no_approved_plan' }
  if (step.status === 'ok') for (const r of step.requirements) if (r.resolution == null || r.resolution === 'open') open_items.push({ source: 'step_requirements', requirement_id: r.id ?? null })
 }
 coverage.push({ source: 'step_requirements', status: step.status })

 // Exact Construction revision: freshness, Solution pin and FORM scope counts.
 let construction: Row = { status: 'not_requested' }
 if (input.construction) {
  const exact = { artifact_id: input.construction.artifact_id, revision: input.construction.revision, after: null, view: 'overview', ids: [], result_id: null, section: null }
  let page: Row | null = null
  if (!readers.construction) construction = { status: 'unavailable' }
  else {
   try { page = await readers.construction(exact) } catch (error) { rethrowContinuation(error); if (error instanceof Error && error.message === 'project_denied') return { status: 'denied' }; page = null }
   if (page?.status === 'denied') return { status: 'denied' }
   if (page?.status !== 'ok' || page.artifact_id !== exact.artifact_id || page.revision !== exact.revision) construction = { status: page?.status === 'not_found' ? 'not_found' : 'unavailable' }
   else {
    const form = page.form && typeof page.form === 'object' ? page.form : null
    construction = { status: 'ok', artifact_id: page.artifact_id, revision: page.revision, current_revision: page.current_revision ?? null, source_state: page.source_state ?? null,
     archived: page.archived ?? null, area_id: page.area_id ?? null, target_revision: page.target_revision ?? null,
     form: form ? { solution_id: form.solution_id ?? null, solution_revision: form.solution_revision ?? null, mapped_components: form.mapped_components ?? null,
      pending_components: form.pending_components ?? null, pending_choices: form.pending_choices ?? null, verification: 'unverified' } : null,
     open_questions: page.counts?.open_questions ?? null,
     reopen: { tool: 'read_construction_draft', input: { ...exact, view: 'notes' } } }
    if (construction.archived || construction.source_state !== 'current' || construction.current_revision !== construction.revision)
     conflicts.push({ code: 'construction_not_current', detail: { revision: construction.revision, current_revision: construction.current_revision, source_state: construction.source_state, archived: construction.archived } })
    if (form && solution.status === 'ok' && (form.solution_id !== solution.solution_id || form.solution_revision !== solution.solution_revision))
     conflicts.push({ code: 'construction_solution_differs', detail: { construction: { solution_id: form.solution_id ?? null, solution_revision: form.solution_revision ?? null }, selected: { solution_id: solution.solution_id, solution_revision: solution.solution_revision } } })
    if (solution.status === 'ok' && construction.target_revision !== null && solution.target_revision !== null && construction.target_revision !== solution.target_revision)
     conflicts.push({ code: 'construction_target_differs', detail: { construction: construction.target_revision, selected: solution.target_revision } })
    if ((construction.area_id ?? null) !== input.area_id) conflicts.push({ code: 'construction_scope_differs', detail: { construction_area_id: construction.area_id, requested_area_id: input.area_id } })
    if ((form?.pending_components ?? 0) > 0 || (form?.pending_choices ?? 0) > 0) open_items.push({ source: 'construction', pending_components: form?.pending_components ?? 0, pending_choices: form?.pending_choices ?? 0 })
    if ((construction.open_questions ?? 0) > 0) open_items.push({ source: 'construction', open_questions: construction.open_questions })
   }
  }
 }
 coverage.push({ source: 'construction', status: construction.status })

 return { status: 'ok', projectId: readers.projectId, scope: { area_id: input.area_id, step_id: input.step_id },
  solution, step, construction, open_items, conflicts, coverage, limits: TASK_SOURCES_LIMITS }
}
