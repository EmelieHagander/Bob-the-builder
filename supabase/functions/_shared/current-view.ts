import { parseBobScreen, isBobOpaqueId, type BobScreenPointer, type CurrentView } from '../../../src/domain/bobScreen.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'

type Row = Record<string, unknown>
/** Fixed reads only; implementations must use the authenticated caller's client. */
export interface CurrentViewReader {
  project(projectId: string): Promise<Row | null>
  viewer(projectId: string): Promise<Row | null>
  area(projectId: string, id: string): Promise<Row | null>
  task(projectId: string, id: string): Promise<Row | null>
  assignees(projectId: string, taskId: string): Promise<{ rows: Row[]; truncated: boolean }>
  person(projectId: string, id: string): Promise<Row | null>
  planStep(projectId: string, id: string): Promise<Row | null>
  instruction(projectId: string, taskId: string, id: string): Promise<Row | null>
  solution(projectId: string, id: string, revision: number): Promise<Row | null>
  drawing(projectId: string, id: string, revision: number): Promise<Row | null>
  event(projectId: string, id: string): Promise<Row | null>
}

// Structural client seam keeps this shared Edge module independent of npm/jsr
// Supabase import versions. callerDb is the already JWT-bound `bob` schema client.
interface ReadQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: unknown): ReadQuery
  abortSignal(signal: AbortSignal): ReadQuery
  maybeSingle(): ReadQuery
  order(column: string): ReadQuery
  limit(count: number): ReadQuery
}
export interface CurrentViewClient { from(table: string): { select(columns: string): ReadQuery } }

export function createCurrentViewReader(callerDb: CurrentViewClient, verifiedUserId: string): CurrentViewReader {
  async function one(table: string, columns: string, filters: Record<string, unknown>): Promise<Row | null> {
    let query = callerDb.from(table).select(columns)
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value)
    const { data, error } = await query.abortSignal(AbortSignal.timeout(10000)).maybeSingle()
    if (error) throw new Error('current_view_unavailable')
    if (data === null) return null
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('current_view_unavailable')
    return data as Row
  }
  async function version(projectId: string, id: string, revision: number, kind: 'solution' | 'artifact'): Promise<Row | null> {
    const parent = await one(kind === 'solution' ? 'solutions' : 'artifacts', 'id,project_id,area_id,current_revision', { project_id: projectId, id })
    if (!parent || parent.project_id !== projectId || parent.id !== id) return null
    const row = await one(kind === 'solution' ? 'solution_revisions' : 'artifact_revision_details',
      `${kind}_id,project_id,revision,title,archived,recorded_at${kind === 'artifact' ? ',status' : ''}`,
      { project_id: projectId, [`${kind}_id`]: id, revision })
    if (!row) return null
    if (row.project_id !== projectId || row[`${kind}_id`] !== id || row.revision !== revision) throw new Error('current_view_unavailable')
    if (kind === 'solution') return { ...row, id, area_id: parent.area_id }
    const freshness = await one('artifact_source_status', 'project_id,artifact_id,revision,source_state,source_reasons', { project_id: projectId, artifact_id: id, revision })
    if (!freshness || freshness.project_id !== projectId || freshness.artifact_id !== id || freshness.revision !== revision) throw new Error('current_view_unavailable')
    return { ...row, ...freshness, id, area_id: parent.area_id }
  }
  return {
    project: projectId => one('projects', 'id,name,updated_at', { id: projectId }),
    viewer: projectId => one('people', 'id,project_id,name,updated_at', { project_id: projectId, auth_user_id: verifiedUserId }),
    area: (projectId, id) => one('areas', 'id,project_id,name,archived_at,updated_at', { project_id: projectId, id }),
    task: (projectId, id) => one('tasks', 'id,project_id,area_id,primary_step_id,name,status,instructions,updated_at', { project_id: projectId, id }),
    person: (projectId, id) => one('people', 'id,project_id,name,updated_at', { project_id: projectId, id }),
    async assignees(projectId, taskId) {
      const { data, error } = await callerDb.from('task_assignees')
        .select('task_id,person_id,tasks!inner(project_id),people!inner(id,project_id,name,updated_at)')
        .eq('task_id', taskId).eq('tasks.project_id', projectId).eq('people.project_id', projectId)
        .order('person_id').limit(9).abortSignal(AbortSignal.timeout(10000))
      if (error || !Array.isArray(data)) throw new Error('current_view_unavailable')
      const rows = data.slice(0, 8).map((value: unknown) => {
        const row = value as Row, task = row.tasks as Row, person = row.people as Row
        if (!row || row.task_id !== taskId || !task || task.project_id !== projectId || !person
          || person.project_id !== projectId || person.id !== row.person_id) throw new Error('current_view_unavailable')
        return { ...person, task_id: taskId }
      })
      return { rows, truncated: data.length > 8 }
    },
    async planStep(projectId, id) {
      const plan = await one('project_plans', 'project_id,current_revision', { project_id: projectId })
      if (!plan || plan.project_id !== projectId || !Number.isSafeInteger(plan.current_revision)) return null
      const row = await one('project_plan_steps', 'project_id,plan_revision,step_id,title,area_id,state,goal,notes,responsible_kind,responsible_person_id',
        { project_id: projectId, plan_revision: plan.current_revision, step_id: id })
      return row ? { ...row, id: row.step_id } : null
    },
    instruction: (projectId, taskId, id) => one('task_steps', 'id,project_id,task_id,title,instructions,revision,required,completed_at,updated_at', { project_id: projectId, task_id: taskId, id }),
    solution: (projectId, id, revision) => version(projectId, id, revision, 'solution'),
    drawing: (projectId, id, revision) => version(projectId, id, revision, 'artifact'),
    event: (projectId, id) => one('events', 'id,project_id,title,status,day,time,place,updated_at', { project_id: projectId, id }),
  }
}

class MissingFocus extends Error {}
const text = (v: unknown, limit = 240): string => typeof v === 'string' ? v.slice(0, limit) : ''
function positive(v: unknown): number {
  if (!Number.isSafeInteger(v) || Number(v) < 1) throw new Error('current_view_unavailable')
  return Number(v)
}

/** Never turns the browser descriptor itself into evidence or raw page content. */
export async function hydrateCurrentView(opts: { projectId: string; screen?: BobScreenPointer | null; reader: CurrentViewReader }): Promise<CurrentView> {
  const retrievedAt = new Date().toISOString()
  let screen: BobScreenPointer | null
  try { screen = parseBobScreen(opts.screen) } catch {
    return { status: 'unsupported', projectId: opts.projectId, surface: null, focus: {}, sources: [], warnings: [], retrievedAt }
  }
  const empty: CurrentView = { status: 'unsupported', projectId: opts.projectId, surface: screen?.surface ?? null, focus: {}, sources: [], warnings: [], retrievedAt }
  if (!screen) return empty
  const sources: ProjectSource[] = []
  const view: CurrentView = { ...empty, status: 'ok', focus: {}, warnings: [], sources }
  const compact = (value: unknown, limit: number, warning: string): string => {
    if (typeof value === 'string' && value.length > limit) view.warnings.push(warning)
    return text(value, limit)
  }
  const addSource = (dataset: string, row: Row, id: string) => {
    if (sources.some(source => source.dataset === dataset && source.recordId === id)) return
    sources.push({ projectId: opts.projectId, dataset, recordId: id, label: text(row.name ?? row.title ?? id, 120),
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : typeof row.recorded_at === 'string' ? row.recorded_at : null,
      truth: 'unknown', retrievedAt })
  }
  const scoped = (row: Row | null, id: string): Row => {
    if (!row || row.project_id !== opts.projectId || row.id !== id) throw new MissingFocus()
    return row
  }
  const entity = (row: Row) => ({ id: String(row.id), name: text(row.name ?? row.title) })
  let areaId: string | undefined = screen.areaId
  let areaLoaded: string | undefined
  async function loadArea(id: string) {
    if (areaLoaded === id) return
    const row = scoped(await opts.reader.area(opts.projectId, id), id)
    view.focus.area = entity(row)
    addSource('areas', row, id)
    if (row.archived_at) view.warnings.push('area_archived')
    areaLoaded = id
  }
  const checkArea = async (row: Row) => {
    const parentArea = row.area_id
    if (areaId && parentArea !== areaId) throw new MissingFocus()
    if (parentArea !== null && parentArea !== undefined) {
      if (!isBobOpaqueId(parentArea)) throw new MissingFocus()
      areaId = parentArea
      await loadArea(parentArea)
    }
  }
  async function loadPlanStep(id: string) {
    const row = scoped(await opts.reader.planStep(opts.projectId, id), id)
    await checkArea(row)
    view.focus.planStep = { ...entity(row), state: text(row.state), planRevision: positive(row.plan_revision), goal: compact(row.goal, 600, 'plan_step_goal_truncated'), notes: compact(row.notes, 600, 'plan_step_notes_truncated') }
    if (!['bob', 'person', 'unassigned'].includes(String(row.responsible_kind))) throw new Error('current_view_unavailable')
    const responsible = { kind: row.responsible_kind as 'bob' | 'person' | 'unassigned' } as NonNullable<NonNullable<CurrentView['focus']['planStep']>['responsible']>
    if (responsible.kind === 'person') {
      if (!isBobOpaqueId(row.responsible_person_id)) throw new MissingFocus()
      const person = scoped(await opts.reader.person(opts.projectId, row.responsible_person_id), row.responsible_person_id)
      responsible.person = entity(person)
      addSource('crew', person, row.responsible_person_id)
    } else if (row.responsible_person_id != null) throw new MissingFocus()
    view.focus.planStep.responsible = responsible
    addSource('plan', row, id)
  }
  try {
    const project = await opts.reader.project(opts.projectId)
    if (!project || project.id !== opts.projectId) throw new MissingFocus()
    view.project = entity(project)
    addSource('project', project, opts.projectId)
    const viewer = await opts.reader.viewer(opts.projectId)
    if (viewer) {
      if (viewer.project_id !== opts.projectId || !isBobOpaqueId(viewer.id)) throw new MissingFocus()
      view.viewer = entity(viewer)
      addSource('crew', viewer, String(viewer.id))
    }
    if (areaId) await loadArea(areaId)
    if (screen.taskId) {
      const row = scoped(await opts.reader.task(opts.projectId, screen.taskId), screen.taskId)
      await checkArea(row)
      view.focus.task = { ...entity(row), status: text(row.status), instructions: compact(row.instructions, 1200, 'task_instructions_truncated') }
      addSource('tasks', row, screen.taskId)
      const assignees = await opts.reader.assignees(opts.projectId, screen.taskId)
      if (!Array.isArray(assignees.rows) || assignees.rows.length > 8 || typeof assignees.truncated !== 'boolean') throw new Error('current_view_unavailable')
      view.focus.task.assignees = assignees.rows.map(person => {
        if (!isBobOpaqueId(person.id) || person.project_id !== opts.projectId || person.task_id !== screen.taskId) throw new MissingFocus()
        addSource('crew', person, person.id)
        return entity(person)
      })
      if (assignees.truncated) view.warnings.push('task_assignees_truncated')
      if (screen.planStepId && row.primary_step_id !== screen.planStepId) throw new MissingFocus()
      if (row.primary_step_id !== null && row.primary_step_id !== undefined) {
        if (!isBobOpaqueId(row.primary_step_id)) throw new MissingFocus()
        await loadPlanStep(row.primary_step_id)
      }
      if (screen.instructionId) {
        const instruction = scoped(await opts.reader.instruction(opts.projectId, screen.taskId, screen.instructionId), screen.instructionId)
        if (instruction.task_id !== screen.taskId) throw new MissingFocus()
        view.focus.instruction = { ...entity(instruction), revision: positive(instruction.revision), instructions: compact(instruction.instructions, 1200, 'selected_instruction_truncated'), required: instruction.required === true, completedAt: typeof instruction.completed_at === 'string' ? instruction.completed_at : null }
        addSource('task_instructions', instruction, screen.instructionId)
      }
    } else if (screen.planStepId) await loadPlanStep(screen.planStepId)
    if (screen.solutionId) {
      const row = scoped(await opts.reader.solution(opts.projectId, screen.solutionId, screen.solutionRevision!), screen.solutionId)
      if (row.revision !== screen.solutionRevision) throw new MissingFocus()
      await checkArea(row)
      view.focus.solution = { ...entity(row), revision: positive(row.revision), archived: row.archived === true }
      addSource('solutions', row, screen.solutionId)
    }
    if (screen.artifactId) {
      const row = scoped(await opts.reader.drawing(opts.projectId, screen.artifactId, screen.artifactRevision!), screen.artifactId)
      if (row.revision !== screen.artifactRevision) throw new MissingFocus()
      await checkArea(row)
      if (!['current', 'changed', 'unavailable'].includes(String(row.source_state))) throw new Error('current_view_unavailable')
      view.focus.drawing = { ...entity(row), revision: positive(row.revision), status: text(row.status), archived: row.archived === true, sourceState: row.source_state as 'current' | 'changed' | 'unavailable' }
      if (Array.isArray(row.source_reasons)) view.warnings.push(...row.source_reasons.filter((x): x is string => typeof x === 'string').slice(0, 20).map(x => text(x, 120)))
      addSource('artifacts', row, screen.artifactId)
    }
    if (screen.eventId) {
      const row = scoped(await opts.reader.event(opts.projectId, screen.eventId), screen.eventId)
      view.focus.event = { ...entity(row), status: text(row.status), day: text(row.day), time: text(row.time), place: text(row.place) }
      addSource('events', row, screen.eventId)
    }
    // An access revocation during these reads must discard the whole projection.
    const stillVisible = await opts.reader.project(opts.projectId)
    if (!stillVisible || stillVisible.id !== opts.projectId) throw new MissingFocus()
    return view
  } catch (error) {
    return { ...empty, status: error instanceof MissingFocus ? 'not_found' : 'unavailable' }
  }
}

/** Rehydrate with caller authority before provider work/settlement; age alone is
 * not proof of change. Changed labels, parent scope, revisions or source states
 * invalidate the frozen logical-turn view. */
export function contextChanged(before: CurrentView, after: CurrentView): boolean {
  const stable = (view: CurrentView) => ({ status: view.status, projectId: view.projectId, surface: view.surface,
    project: view.project, viewer: view.viewer, focus: view.focus, warnings: view.warnings,
    sources: view.sources.map(({ retrievedAt: _time, ...source }) => source) })
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]))
    return value
  }
  return JSON.stringify(canonical(stable(before))) !== JSON.stringify(canonical(stable(after)))
}
