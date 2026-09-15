import type { SupabaseClient } from '@supabase/supabase-js'
import * as mock from './mockData'
import type { AreaPhase, TaskStatus } from './types'

export type TaskReadinessState = 'ready' | 'blocked' | 'complete'
export type TaskBlockerKind = 'phase' | 'status' | 'dependency' | 'material' | 'tool' | 'information'
export type TaskNeedKind = 'tool' | 'information'

export interface TaskBlocker {
  kind: TaskBlockerKind
  id: string
  label: string
}

export interface TaskReadiness {
  taskId: string
  projectId: string
  areaId: string
  areaPhase: AreaPhase | null
  taskStatus: TaskStatus
  state: TaskReadinessState
  blockerCount: number
  blockers: TaskBlocker[]
}

export interface TaskDependencyStatus {
  id: string
  projectId: string
  taskId: string
  prerequisiteTaskId: string
  prerequisiteStepId: string | null
  prerequisiteTaskName: string
  prerequisiteStepTitle: string
  note: string
  satisfied: boolean
}

export interface TaskNeed {
  id: string
  projectId: string
  taskId: string
  kind: TaskNeedKind
  label: string
  notes: string
  ready: boolean
  revision: number
  actor: string
  createdAt: string
  updatedAt: string
}

export interface TaskMaterialReadiness {
  projectId: string
  taskId: string
  areaId: string | null
  requirementId: string
  name: string
  purchaseQuantity: string
  unit: string
  ready: boolean
  reason: string
  shoppingStatus: string | null
}

export interface TaskWorkPlan {
  readiness: TaskReadiness
  dependencies: TaskDependencyStatus[]
  needs: TaskNeed[]
  materials: TaskMaterialReadiness[]
}

export type WorkPlanAction =
  | 'add_dependency'
  | 'remove_dependency'
  | 'add_need'
  | 'revise_need'
  | 'set_need_ready'
  | 'remove_need'

type Row = Record<string, any>

type MockDependency = {
  id: string
  projectId: string
  taskId: string
  prerequisiteTaskId: string
  prerequisiteStepId: string | null
  note: string
}
type MockNeed = TaskNeed
const mockDependencies: MockDependency[] = []
const mockNeeds: MockNeed[] = []

function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`database: ${result.error.message}`)
  if (result.data === null || result.data === undefined) throw new Error('database: query returned no data')
  return result.data
}

function blockers(value: unknown): TaskBlocker[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => item && typeof item === 'object'
    && typeof (item as Row).kind === 'string'
    && typeof (item as Row).id === 'string'
    && typeof (item as Row).label === 'string'
    ? [{ kind: (item as Row).kind as TaskBlockerKind, id: (item as Row).id, label: (item as Row).label }]
    : [])
}

function mapReadiness(row: Row): TaskReadiness {
  const parsed = blockers(row.blockers)
  return {
    taskId: row.task_id,
    projectId: row.project_id,
    areaId: row.area_id,
    areaPhase: row.area_phase ?? null,
    taskStatus: row.task_status,
    state: row.readiness_state,
    blockerCount: Number(row.blocker_count ?? parsed.length),
    blockers: parsed,
  }
}

function mapDependency(row: Row): TaskDependencyStatus {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    prerequisiteTaskId: row.prerequisite_task_id,
    prerequisiteStepId: row.prerequisite_step_id ?? null,
    prerequisiteTaskName: row.prerequisite_task_name,
    prerequisiteStepTitle: row.prerequisite_step_title ?? '',
    note: row.note ?? '',
    satisfied: Boolean(row.satisfied),
  }
}

function mapNeed(row: Row): TaskNeed {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    kind: row.kind,
    label: row.label,
    notes: row.notes ?? '',
    ready: Boolean(row.ready),
    revision: Number(row.revision),
    actor: row.actor_label ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMaterial(row: Row): TaskMaterialReadiness {
  return {
    projectId: row.project_id,
    taskId: row.task_id,
    areaId: row.area_id ?? null,
    requirementId: row.requirement_id,
    name: row.name,
    purchaseQuantity: String(row.purchase_quantity),
    unit: row.unit,
    ready: Boolean(row.ready),
    reason: row.reason,
    shoppingStatus: row.shopping_status ?? null,
  }
}

function mockProjectTasks(projectId: string) {
  if (projectId !== 'p_skogsstuga') return []
  return mock.tasks
}

function mockDependencyRows(projectId: string, taskId = ''): TaskDependencyStatus[] {
  const tasks = mockProjectTasks(projectId)
  return mockDependencies
    .filter(item => item.projectId === projectId && (!taskId || item.taskId === taskId))
    .map(item => {
      const prerequisite = tasks.find(task => task.id === item.prerequisiteTaskId)
      return {
        ...item,
        prerequisiteTaskName: prerequisite?.name ?? 'Prerequisite task',
        prerequisiteStepTitle: '',
        satisfied: prerequisite?.status === 'done',
      }
    })
}

function mockReadiness(projectId: string): TaskReadiness[] {
  const tasks = mockProjectTasks(projectId)
  return tasks.map(task => {
    const area = mock.areas.find(item => item.id === task.areaId)
    if (task.status === 'done') return {
      taskId: task.id, projectId, areaId: task.areaId, areaPhase: area?.phase ?? null,
      taskStatus: task.status, state: 'complete' as const, blockerCount: 0, blockers: [],
    }
    const found: TaskBlocker[] = []
    if (area?.phase !== 'build') found.push({
      kind: 'phase', id: area?.id ?? task.areaId,
      label: area?.phase ? `Area is in ${area.phase}; move to Build when work is actually ready` : 'Set Area phase before starting',
    })
    if (task.status === 'blocked') found.push({ kind: 'status', id: task.id, label: 'Task is manually marked Blocked' })
    for (const dependency of mockDependencyRows(projectId, task.id)) {
      if (!dependency.satisfied) found.push({ kind: 'dependency', id: dependency.id, label: `Finish ${dependency.prerequisiteTaskName}` })
    }
    for (const need of mockNeeds.filter(item => item.projectId === projectId && item.taskId === task.id && !item.ready)) {
      found.push({ kind: need.kind, id: need.id, label: need.kind === 'tool' ? `Tool needed: ${need.label}` : `Confirm: ${need.label}` })
    }
    return {
      taskId: task.id, projectId, areaId: task.areaId, areaPhase: area?.phase ?? null, taskStatus: task.status,
      state: found.length ? 'blocked' : 'ready', blockerCount: found.length, blockers: found,
    }
  })
}

export function createWorkPlan(
  client: SupabaseClient<any, any, any> | null,
  capture: (id: string) => () => void,
) {
  function connection(projectId: string) {
    const guard = capture(projectId)
    guard()
    if (!client) return { db: null, guard }
    return { db: client, guard }
  }

  async function readiness(projectId: string, taskId = ''): Promise<TaskReadiness[]> {
    const { db, guard } = connection(projectId)
    if (!db) return structuredClone(mockReadiness(projectId).filter(item => !taskId || item.taskId === taskId))
    let query = db.from('current_task_readiness').select('*').eq('project_id', projectId)
    if (taskId) query = query.eq('task_id', taskId)
    const rows = checked(await query.order('task_id')) as Row[]
    guard()
    return rows.map(mapReadiness)
  }

  async function detail(projectId: string, taskId: string): Promise<TaskWorkPlan> {
    const { db, guard } = connection(projectId)
    if (!db) {
      const current = mockReadiness(projectId).find(item => item.taskId === taskId)
      if (!current) throw new Error('Task not found.')
      return structuredClone({
        readiness: current,
        dependencies: mockDependencyRows(projectId, taskId),
        needs: mockNeeds.filter(item => item.projectId === projectId && item.taskId === taskId),
        materials: [],
      })
    }
    const [readinessResult, dependenciesResult, needsResult, materialsResult] = await Promise.all([
      db.from('current_task_readiness').select('*').eq('project_id', projectId).eq('task_id', taskId).single(),
      db.from('task_dependency_status').select('*').eq('project_id', projectId).eq('task_id', taskId).order('created_at', { referencedTable: 'task_dependencies', ascending: true }),
      db.from('task_needs').select('*').eq('project_id', projectId).eq('task_id', taskId).order('created_at'),
      db.from('task_material_readiness').select('*').eq('project_id', projectId).eq('task_id', taskId).order('name'),
    ])
    guard()
    return {
      readiness: mapReadiness(checked(readinessResult) as Row),
      dependencies: (checked(dependenciesResult) as Row[]).map(mapDependency),
      needs: (checked(needsResult) as Row[]).map(mapNeed),
      materials: (checked(materialsResult) as Row[]).map(mapMaterial),
    }
  }

  async function command(
    projectId: string,
    taskId: string,
    action: WorkPlanAction,
    itemId: string | null = null,
    expected = 0,
    data: Record<string, unknown> = {},
  ): Promise<{ id: string; revision?: number; removed?: boolean }> {
    const { db, guard } = connection(projectId)
    const id = itemId ?? crypto.randomUUID()
    if (!db) {
      const task = mockProjectTasks(projectId).find(item => item.id === taskId)
      if (!task) throw new Error('Task not found.')
      if (action === 'add_dependency') {
        const prerequisiteTaskId = String(data.prerequisite_task_id ?? '')
        const prerequisite = mockProjectTasks(projectId).find(item => item.id === prerequisiteTaskId)
        if (!prerequisite || prerequisiteTaskId === taskId) throw new Error('Choose another task in this Project.')
        if (mockDependencies.some(item => item.taskId === taskId && item.prerequisiteTaskId === prerequisiteTaskId)) throw new Error('Dependency already exists.')
        const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
          if (from === target) return true
          if (seen.has(from)) return false
          seen.add(from)
          return mockDependencies.filter(item => item.projectId === projectId && item.taskId === from)
            .some(item => reaches(item.prerequisiteTaskId, target, seen))
        }
        if (reaches(prerequisiteTaskId, taskId)) throw new Error('Task dependencies cannot form a cycle.')
        mockDependencies.push({ id, projectId, taskId, prerequisiteTaskId, prerequisiteStepId: null, note: String(data.note ?? '') })
      } else if (action === 'remove_dependency') {
        const index = mockDependencies.findIndex(item => item.id === id && item.projectId === projectId && item.taskId === taskId)
        if (index < 0) throw new Error('Dependency changed. Reload first.')
        mockDependencies.splice(index, 1)
        return { id, removed: true }
      } else if (action === 'add_need') {
        const kind = data.kind as TaskNeedKind
        if (kind !== 'tool' && kind !== 'information') throw new Error('Choose a need type.')
        const now = new Date().toISOString()
        mockNeeds.push({ id, projectId, taskId, kind, label: String(data.label ?? '').trim(), notes: String(data.notes ?? '').trim(), ready: false, revision: 1, actor: 'Demo builder', createdAt: now, updatedAt: now })
        return { id, revision: 1 }
      } else {
        const need = mockNeeds.find(item => item.id === id && item.projectId === projectId && item.taskId === taskId)
        if (!need || need.revision !== expected) throw new Error('Task need changed. Reload first.')
        if (action === 'remove_need') {
          mockNeeds.splice(mockNeeds.indexOf(need), 1)
          return { id, removed: true }
        }
        if (action === 'set_need_ready') need.ready = Boolean(data.ready)
        else {
          need.label = String(data.label ?? need.label).trim()
          need.notes = String(data.notes ?? '').trim()
          if (typeof data.ready === 'boolean') need.ready = data.ready
        }
        need.revision += 1
        need.updatedAt = new Date().toISOString()
        return { id, revision: need.revision }
      }
      return { id }
    }
    const saved = checked(await db.rpc('work_plan_command', {
      p_project: projectId,
      p_task: taskId,
      p_action: action,
      p_item: id,
      p_expected: expected,
      p_data: data,
    })) as Row
    guard()
    return { id: saved.id ?? id, revision: saved.revision, removed: saved.removed }
  }

  return { readiness, detail, command }
}
