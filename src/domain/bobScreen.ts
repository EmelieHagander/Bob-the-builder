import type { ProjectSource } from '../data/provenance.ts'

export const BOB_SCREEN_SURFACES = ['project', 'areas', 'area', 'task', 'facts', 'solutions', 'drawings', 'people', 'events', 'event', 'shopping', 'today', 'announcements', 'building', 'material-plan'] as const
export type BobScreenSurface = typeof BOB_SCREEN_SURFACES[number]
/** Navigation only. Labels, facts and project/viewer identity are server-owned. */
export interface BobScreenPointer {
  surface: BobScreenSurface
  areaId?: string
  taskId?: string
  planStepId?: string
  instructionId?: string
  solutionId?: string
  solutionRevision?: number
  artifactId?: string
  artifactRevision?: number
  eventId?: string
}

const fields: Record<BobScreenSurface, readonly string[]> = {
  project: ['planStepId'], areas: [], area: ['areaId', 'planStepId'],
  task: ['areaId', 'taskId', 'planStepId', 'instructionId'], facts: ['areaId'],
  solutions: ['areaId', 'solutionId', 'solutionRevision'],
  drawings: ['areaId', 'artifactId', 'artifactRevision'],
  people: [], events: [], event: ['eventId'], shopping: [], today: [],
  announcements: [], building: [], 'material-plan': ['areaId'],
}
export function isBobOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)
}
/** Omission is compatible with older callers; malformed focus never falls back. */
export function parseBobScreen(value: unknown): BobScreenPointer | null {
  if (value === undefined || value === null) return null
  const invalid = (): never => { throw new Error('invalid_screen') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return invalid()
  const v = value as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(v, 'surface')) return invalid()
  if (!BOB_SCREEN_SURFACES.includes(v.surface as BobScreenSurface)) return invalid()
  const surface = v.surface as BobScreenSurface
  if (Object.keys(v).some(k => k !== 'surface' && !fields[surface].includes(k))) return invalid()
  for (const key of Object.keys(v)) {
    if (key === 'surface') continue
    if (key.endsWith('Revision')) {
      if (!Number.isSafeInteger(v[key]) || Number(v[key]) < 1 || Number(v[key]) > 2147483647) return invalid()
    } else if (!isBobOpaqueId(v[key])) return invalid()
  }
  if (surface === 'area' && !v.areaId || surface === 'task' && !v.taskId || surface === 'event' && !v.eventId) return invalid()
  if (('artifactId' in v) !== ('artifactRevision' in v) || ('solutionId' in v) !== ('solutionRevision' in v)) return invalid()
  return { ...v } as unknown as BobScreenPointer
}

export interface CurrentViewEntity { id: string; name: string }
export interface CurrentView {
  status: 'ok' | 'not_found' | 'unavailable' | 'unsupported'
  projectId: string
  surface: BobScreenSurface | null
  project?: CurrentViewEntity
  viewer?: CurrentViewEntity
  focus: {
    area?: CurrentViewEntity
    task?: CurrentViewEntity & { status: string; instructions: string; assignees?: CurrentViewEntity[] }
    planStep?: CurrentViewEntity & { state: string; planRevision: number; goal: string; notes: string;
      responsible?: { kind: 'bob' | 'person' | 'unassigned'; person?: CurrentViewEntity } }
    instruction?: CurrentViewEntity & { revision: number; instructions: string; required: boolean; completedAt: string | null }
    solution?: CurrentViewEntity & { revision: number; archived: boolean }
    drawing?: CurrentViewEntity & { revision: number; status: string; archived: boolean; sourceState: 'current' | 'changed' | 'unavailable' }
    event?: CurrentViewEntity & { status: string; day: string; time: string; place: string }
  }
  sources: ProjectSource[]
  warnings: string[]
  retrievedAt: string
}
