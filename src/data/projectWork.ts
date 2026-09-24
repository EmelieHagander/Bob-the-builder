import type { ProjectPhase, TaskStatus } from './types'
import type { DrawingSourceStatus } from './drawingSources'
export interface WorkTask {
  id: string
  name: string
  status: TaskStatus
  area_id?: string | null
  primary_step_id: string | null
  assignee_ids?: string[]
}
export interface WorkStep {
  id: string
  position: number
  title: string
  goal: string
  notes: string
  area_id: string | null
  phase: ProjectPhase | null
  state: 'planned' | 'active' | 'blocked' | 'completed'
  responsible_kind: 'bob' | 'person' | 'unassigned'
  responsible_person_id: string | null
  tasks: WorkTask[]
  related_tasks: WorkTask[]
  requirements: { id: string; title: string; status: { state: string } }[]
}
export interface ProjectWork {
  project_id: string
  vocabulary_version: string
  status: string
  revision: number | null
  focus_step_id: string | null
  areas: { id: string; name: string; slug: string; phase: ProjectPhase | null; archived_at?: string | null }[]
  steps: WorkStep[]
  unorganised_tasks: WorkTask[]
}
export interface ProjectStepWorkspace extends ProjectWork {
  drawings: (DrawingSourceStatus & { artifact_id: string; artifact_revision: number; step_id: string; title: string; status: string; area_id: string | null })[]
}
