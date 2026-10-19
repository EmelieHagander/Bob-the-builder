import type { CurrentView } from '../../../src/domain/bobScreen.ts'
import type { ModelCall } from './project-answer.ts'
import type { LookupInput, LookupResult } from './project-lookup.ts'
import type { WorkingContext } from './bob-working-context.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { countContextTokens } from './bob-token-budget.ts'
import { boundProjectOrientation, type OrientationDirectory, type OrientationDirectoryReader } from './bob-orientation-directory.ts'

type Row = Record<string, unknown> & { id: string }
type Level = 'project' | 'area' | 'step' | 'task'
export const ORIENTATION_TOKEN_LIMITS = { overview: 500, focus: 250, footer: 150 } as const
export interface OrientationSource {
  id: string; projectId: string; dataset: string; recordId: string | null;
  revision?: number; itemId?: string; updatedAt?: string | null;
}
export interface OrientationCard {
  id: string; name: string; level: Level; status: string | null; phase: string | null; sourceId: string;
}
export interface BoundedPresentation {
  text: string; kind: 'original' | 'advisory_summary' | 'unavailable'; sourceIds: string[];
  tokens: number; maxTokens: number;
}
export interface ProjectOrientation {
  projectId: string; project: OrientationCard; overview: BoundedPresentation;
  focus: { origin: 'screen' | 'saved_plan' | 'project'; card: OrientationCard; description: BoundedPresentation };
  ancestors: OrientationCard[]; siblings: OrientationCard[]; children: OrientationCard[];
  /** Exact saved requirements and server-computed evidence state, never a model
   * summary. A source revision pins their meaning; summaries cannot replace it. */
  completionRequirements: { sourceId: string; record: Record<string, unknown> }[];
  workingPlan: { status: string; revision: number | null; pendingProposal: Record<string, unknown> | null };
  recentSharedFacts: unknown[];
  completeness: { areas: boolean; plan: boolean; hierarchy: boolean; requirements: boolean };
  sources: OrientationSource[]; warnings: string[]; footer: BoundedPresentation;
  /** Present on catalog-pinned bounded packets; exact deferred records remain
   * readable through the immutable turn directory. */
  directory?: OrientationDirectory; tokenBudget?: { tokens: number; maxTokens: number };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const rows = (value: unknown): Row[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || !value.every(row => object(row) && typeof row.id === 'string')
    || new Set(value.map(row => row.id)).size !== value.length) throw new Error('context_unavailable')
  return value as Row[]
}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]))

export async function prepareProjectOrientation(opts: {
  projectId: string; userId: string; briefing: LookupResult; currentView?: CurrentView;
  lookup: { search(value: LookupInput): Promise<LookupResult> }; context?: WorkingContext; message: string;
  callModel: ModelCall; hasAccess: () => Promise<boolean>; deadline: number;
  directory?: { maxTokens: number; pageMaxTokens: number; ready(reader: OrientationDirectoryReader): void };
}): Promise<ProjectOrientation> {
  if (!await opts.hasAccess()) throw new Error('project_denied')
  if (opts.briefing.projectId !== opts.projectId || opts.briefing.status !== 'ok'
    || opts.currentView && opts.currentView.projectId !== opts.projectId) throw new Error('context_unavailable')
  const project = opts.briefing.records.find(row => row.id === opts.projectId)
  if (!project) throw new Error('context_unavailable')
  const warnings: string[] = [], sources: OrientationSource[] = [], sourceByKey = new Map<string, OrientationSource>()
  const source = (dataset: string, recordId: string | null, rev?: number | null, itemId?: string, updatedAt?: string | null): string => {
    const key = JSON.stringify([dataset, recordId, rev ?? null, itemId ?? null])
    const found = sourceByKey.get(key)
    if (found) return found.id
    const id = `source-${sources.length + 1}`
    sources.push({ id, projectId: opts.projectId, dataset, recordId, ...(rev ? { revision: rev } : {}), ...(itemId ? { itemId } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}) })
    sourceByKey.set(key, sources.at(-1)!)
    return id
  }
  const search = async (dataset: LookupInput['dataset'], recordId: string | null = null, after: string | null = null, area: string | null = null) => {
    if (!await opts.hasAccess()) throw new Error('project_denied')
    const value = await opts.lookup.search({ dataset, query: null, status: null, area_id: area, record_id: recordId, after_id: after })
    if (value.status === 'denied' || !await opts.hasAccess()) throw new Error('project_denied')
    if (value.projectId !== opts.projectId || value.records.some(row => row.project_id != null && row.project_id !== opts.projectId)) throw new Error('context_unavailable')
    return value
  }
  const collect = async (dataset: 'areas' | 'tasks', area: string | null = null): Promise<{ records: Row[]; complete: boolean }> => {
    const all: Row[] = [], cursors = new Set<string>(), ids = new Set<string>()
    let cursor: string | null = null
    while (Date.now() + 1000 < opts.deadline) {
      const page = await search(dataset, null, cursor, area)
      if (!['ok', 'empty'].includes(page.status)) { warnings.push(`${dataset}:${page.status}`); return { records: all, complete: false } }
      for (const row of page.records) {
        if (ids.has(row.id)) { warnings.push(`${dataset}:overlapping_pages`); return { records: all, complete: false } }
        all.push(row); ids.add(row.id)
      }
      if (!page.truncated) return { records: all, complete: true }
      if (!page.next_cursor || cursors.has(page.next_cursor)) { warnings.push(`${dataset}:incomplete_page`); return { records: all, complete: false } }
      cursors.add(page.next_cursor); cursor = page.next_cursor
    }
    warnings.push(`${dataset}:time_boundary`)
    return { records: all, complete: false }
  }
  const projectSource = source('project', project.id, null, undefined, project.updated_at)
  const planResult = await search('plan')
  const plan = planResult.status === 'ok' ? planResult.records.find(row => row.id === opts.projectId && row.status === 'approved') : undefined
  const planComplete = planResult.status === 'empty' || !!plan && !planResult.truncated
  if (!planComplete) warnings.push(`plan:${planResult.status === 'ok' ? 'unavailable_approved_revision' : planResult.status}`)
  const planRevision = revision(plan?.revision)
  source('plan', planRevision ? String(planRevision) : null, planRevision)
  const steps = rows(plan?.steps)
  if (plan && (!planRevision || !Array.isArray(plan.steps) || steps.some(step => !Array.isArray(step.tasks) || !Array.isArray(step.requirements)))) throw new Error('context_unavailable')
  if (steps.some(step => rows(step.tasks).some(task => task.project_id != null && task.project_id !== opts.projectId))) throw new Error('context_unavailable')
  const areas = await collect('areas')
  const card = (row: Row, level: Level): OrientationCard => ({ id: row.id, name: text(row.name ?? row.title) || row.id, level,
    status: text(row.status ?? row.state) || (level === 'area' && row.archived_at ? 'archived' : null), phase: text(row.phase) || null,
    sourceId: level === 'step' ? source('plan', planRevision ? String(planRevision) : null, planRevision, row.id)
      : source(level === 'area' ? 'areas' : level === 'task' ? 'tasks' : 'project', row.id, null, undefined, text(row.updated_at) || null) })
  const projectCard = card(project, 'project')
  let focus = projectCard, origin: ProjectOrientation['focus']['origin'] = 'project', focusRow: Row = project
  let focusStep: Row | undefined, focusArea: Row | undefined, taskParent: string | null = null
  const view = opts.currentView?.status === 'ok' ? opts.currentView.focus : undefined
  const failedScreen = opts.currentView && ['not_found', 'unavailable'].includes(opts.currentView.status)
  let hierarchyComplete = planComplete && areas.complete
  if (failedScreen) { warnings.push('screen_focus_unavailable'); hierarchyComplete = false }
  else if (view?.task) {
    origin = 'screen'
    const result = await search('tasks', view.task.id)
    const task = result.records.find(row => row.id === view.task!.id)
    if (result.status === 'ok' && task) {
      focusRow = task; focus = card(task, 'task'); taskParent = text(task.primary_step_id) || null
      focusStep = steps.find(step => step.id === taskParent)
      focusArea = areas.records.find(area => area.id === (focusStep?.area_id ?? task.area_id))
      if (taskParent && !focusStep) { hierarchyComplete = false; warnings.push('task_parent_step_unavailable') }
    } else { hierarchyComplete = false; warnings.push(`screen_task:${result.status}`) }
  } else if (view?.planStep) {
    origin = 'screen'
    focusStep = steps.find(step => step.id === view.planStep!.id && planRevision === view.planStep!.planRevision)
    if (focusStep) { focusRow = focusStep; focus = card(focusStep, 'step'); focusArea = areas.records.find(area => area.id === focusStep!.area_id) }
    else { hierarchyComplete = false; warnings.push('screen_step_revision_unavailable') }
  } else if (view?.area) {
    origin = 'screen'; focusArea = areas.records.find(area => area.id === view.area!.id)
    if (focusArea) { focusRow = focusArea; focus = card(focusArea, 'area') }
    else { hierarchyComplete = false; warnings.push('screen_area_unavailable') }
  } else if (!failedScreen && text(plan?.focus_step_id)) {
    origin = 'saved_plan'; focusStep = steps.find(step => step.id === plan!.focus_step_id)
    if (focusStep) { focusRow = focusStep; focus = card(focusStep, 'step'); focusArea = areas.records.find(area => area.id === focusStep!.area_id) }
    else { hierarchyComplete = false; warnings.push('saved_focus_unavailable') }
  }
  if (focusRow.area_id && !focusArea) { hierarchyComplete = false; warnings.push('focus_area_unavailable') }
  const ancestors: OrientationCard[] = focus.level === 'project' ? [] : [projectCard]
  if (focusArea && focus.level !== 'area') ancestors.push(card(focusArea, 'area'))
  if (focusStep && focus.level === 'task') ancestors.push(card(focusStep, 'step'))
  let siblings: OrientationCard[] = [], children: OrientationCard[] = []
  if (focus.level === 'project') children = [...areas.records.map(row => card(row, 'area')), ...steps.filter(step => step.area_id == null).map(row => card(row, 'step'))]
  if (focus.level === 'area') {
    siblings = areas.records.filter(row => row.id !== focus.id).map(row => card(row, 'area'))
    children = steps.filter(step => step.area_id === focus.id).map(row => card(row, 'step'))
  }
  if (focus.level === 'step') {
    siblings = steps.filter(step => step.id !== focus.id && (step.area_id ?? null) === (focusRow.area_id ?? null)).map(row => card(row, 'step'))
    children = rows(focusStep?.tasks).map(row => card(row, 'task'))
  }
  if (focus.level === 'task') {
    if (focusStep) siblings = rows(focusStep.tasks).filter(task => task.id !== focus.id).map(row => card(row, 'task'))
    else if (!taskParent) {
      const tasks = await collect('tasks', text(focusRow.area_id) || null)
      hierarchyComplete &&= tasks.complete
      siblings = tasks.records.filter(task => task.id !== focus.id && task.primary_step_id == null && (task.area_id ?? null) === (focusRow.area_id ?? null)).map(row => card(row, 'task'))
    }
  }
  const completionRequirements = rows(focusStep?.requirements).map(record => ({ sourceId: source('plan', planRevision ? String(planRevision) : null, planRevision, record.id), record: { ...record } }))
  const working = object(project.working_plan) ? project.working_plan : {}
  const pending = object(working.pending_proposal) ? pick(working.pending_proposal, ['record_id', 'revision', 'based_on_revision', 'created_at']) : null
  const workingPlan = { status: text(working.status) || (plan ? 'approved' : 'unavailable'), revision: planRevision,
    pendingProposal: pending ? { ...pending, status: 'proposed', sourceId: source('plan', text(pending.record_id) || String(pending.revision), revision(pending.revision)) } : null }
  const requestSource = source('conversation', opts.context ? `${opts.context.recent.at(-1)!.seq}` : 'current_request')
  const sourceDescription = focus.level === 'project' ? '' : focus.level === 'step'
    ? JSON.stringify({ goal: text(focusRow.goal), brief: text(focusRow.notes) })
    : text(focusRow.instructions ?? focusRow.description)
  const blocks = [
    { key: 'overview', text: text(project.description), sourceIds: [projectSource], maxTokens: ORIENTATION_TOKEN_LIMITS.overview },
    { key: 'focus', text: sourceDescription, sourceIds: [focus.sourceId], maxTokens: ORIENTATION_TOKEN_LIMITS.focus },
    { key: 'footer', text: JSON.stringify({ project: projectCard.name, focus: { level: focus.level, name: focus.name, status: focus.status, phase: focus.phase }, currentRequest: opts.message }),
      sourceIds: [...new Set([projectSource, focus.sourceId, requestSource])], maxTokens: ORIENTATION_TOKEN_LIMITS.footer },
  ]
  const presentations = new Map<string, BoundedPresentation>()
  for (const block of blocks) {
    const tokens = countContextTokens(block.text)
    if (tokens <= block.maxTokens) presentations.set(block.key,
      { text: block.text, sourceIds: block.sourceIds, maxTokens: block.maxTokens, kind: 'original', tokens })
  }
  const oversized = blocks.filter(block => !presentations.has(block.key))
  if (oversized.length) {
    let feedback: string | undefined
    for (let attempt = 0; attempt < 2 && Date.now() + 5000 < opts.deadline; attempt++) {
      if (!await opts.hasAccess()) throw new Error('project_denied')
      try {
        const result = await opts.callModel({ app: 'bob', coworkerId: 'bob', functionName: 'context-summary', aiFunction: 'context-summary', module: 'global', userId: opts.userId,
          catalogRoleKey: 'context-presentation', catalogSchemaKey: 'bob_context_presentation', schemaName: 'bob_context_presentation',
          messages: [{ role: 'user', content: JSON.stringify({ projectId: opts.projectId, blocks: oversized, ...(feedback ? { validationFeedback: feedback } : {}) }) }],
          maxOutputTokens: 3000, timeoutMs: Math.min(30000, opts.deadline - Date.now()) })
        const data: unknown = result.data
        if (!result.success || result.toolCalls?.length || !object(data) || Object.keys(data).some(key => key !== 'presentations')
          || !Array.isArray(data.presentations) || data.presentations.length !== oversized.length) throw new Error('presentation_shape')
        const candidate = new Map<string, BoundedPresentation>()
        for (const value of data.presentations) {
          if (!object(value) || Object.keys(value).some(key => !['key', 'text', 'sourceIds'].includes(key)) || typeof value.key !== 'string'
            || typeof value.text !== 'string' || !value.text.trim() || !Array.isArray(value.sourceIds)) throw new Error('presentation_shape')
          const block = oversized.find(block => block.key === value.key)
          if (!block || candidate.has(value.key) || value.sourceIds.length !== block.sourceIds.length
            || new Set(value.sourceIds).size !== value.sourceIds.length || value.sourceIds.some(id => !block.sourceIds.includes(String(id)))) throw new Error('presentation_sources')
          const tokens = countContextTokens(value.text)
          if (tokens > block.maxTokens) throw new Error('presentation_size')
          candidate.set(value.key, { text: value.text, sourceIds: block.sourceIds, maxTokens: block.maxTokens, kind: 'advisory_summary', tokens })
        }
        for (const [key, value] of candidate) presentations.set(key, value)
        break
      } catch (error) { rethrowContinuation(error); feedback = error instanceof Error ? error.message : 'presentation_unavailable' }
    }
  }
  for (const block of oversized) if (!presentations.has(block.key)) {
    warnings.push(`${block.key}:presentation_unavailable`)
    presentations.set(block.key, { text: '', kind: 'unavailable', sourceIds: block.sourceIds, tokens: 0, maxTokens: block.maxTokens })
  }
  if (!await opts.hasAccess()) throw new Error('project_denied')
  const orientation: ProjectOrientation = { projectId: opts.projectId, project: projectCard, overview: presentations.get('overview')!,
    focus: { origin, card: focus, description: presentations.get('focus')! }, ancestors, siblings, children, completionRequirements,
    workingPlan, recentSharedFacts: Array.isArray(working.recent_shared_facts) ? working.recent_shared_facts : [],
    completeness: { areas: areas.complete, plan: planComplete, hierarchy: hierarchyComplete, requirements: planComplete && (!taskParent || !!focusStep) },
    sources, warnings, footer: presentations.get('footer')! }
  if (!opts.directory) return orientation
  const bounded = await boundProjectOrientation(orientation, { ...opts.directory, hasAccess: opts.hasAccess })
  opts.directory.ready(bounded.reader)
  return bounded.orientation
}
