/*
 * Public database seam.
 *
 * The existing data layer is kept byte-for-byte in databaseCore.ts while the
 * phase migration is stacked. This facade adds the new phase reads/commands
 * without teaching screens to query Supabase directly. Once the phase work is
 * merged, this small compatibility split can be folded back into one file.
 */
import { createClient } from '@supabase/supabase-js'
import * as core from './databaseCore'
import * as mock from './mockData'
import type { Area, Project, ProjectPhase } from './types'

export * from './databaseCore'
// Explicit exports win over the legacy star export above. Ask Bob now resolves
// server-owned conversation state while the rest of databaseCore stays stable.
export { askBob, getAskBobConversation, resetAskBobConversation, refreshAskBobProject } from './bobConversation'

function resolveSupabaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  const url = /^[a-z0-9]{16,}$/.test(value) ? `https://${value}.supabase.co` : value
  try { new URL(url); return url } catch { return null }
}

const PHASE_URL = resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const PHASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
// Uses the same default Auth storage as the existing live client so phase RPCs
// carry the caller JWT/RLS. It does not install auth listeners or own navigation.
const phaseDb = PHASE_URL && PHASE_KEY ? createClient(PHASE_URL, PHASE_KEY, {
  db: { schema: 'bob' },
  auth: { flowType: 'pkce', detectSessionInUrl: false, autoRefreshToken: false },
}) : null

function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`database: ${result.error.message}`)
  if (result.data === null || result.data === undefined) throw new Error('database: query returned no data')
  return result.data
}

async function projectPhase(id: string): Promise<ProjectPhase | null> {
  if (!phaseDb) return mock.projects.find(project => project.id === id)?.phase ?? null
  const row = checked(await phaseDb.from('projects').select('phase').eq('id', id).single()) as { phase: ProjectPhase | null }
  return row.phase ?? null
}

async function areaPhases(projectId: string): Promise<Map<string, ProjectPhase | null>> {
  if (!phaseDb) return new Map(mock.areas.map(area => [area.id, area.phase ?? null]))
  const rows = checked(await phaseDb.from('areas').select('id, phase').eq('project_id', projectId)) as { id: string; phase: ProjectPhase | null }[]
  return new Map(rows.map(row => [row.id, row.phase ?? null]))
}

export interface AccountAreaPhase { projectId: string; phase: ProjectPhase | null }

export async function getAccountAreaPhases(projectIds: string[]): Promise<AccountAreaPhase[]> {
  const ids = [...new Set(projectIds.filter(Boolean))]
  if (!ids.length) return []
  if (!phaseDb) {
    const activeProjectId = core.getActiveProjectId()
    return activeProjectId && ids.includes(activeProjectId)
      ? mock.areas.filter(area => !area.archivedAt).map(area => ({ projectId: activeProjectId, phase: area.phase ?? null }))
      : []
  }
  const rows = checked(await phaseDb.from('areas').select('project_id, phase').in('project_id', ids).is('archived_at', null)) as { project_id: string; phase: ProjectPhase | null }[]
  return rows.map(row => ({ projectId: row.project_id, phase: row.phase ?? null }))
}

export async function getProjects(): Promise<Project[]> {
  const projects = await core.getProjects()
  if (!phaseDb) return projects.map(project => ({ ...project, phase: mock.projects.find(item => item.id === project.id)?.phase ?? null }))
  if (!projects.length) return projects
  const rows = checked(await phaseDb.from('projects').select('id, phase').in('id', projects.map(project => project.id))) as { id: string; phase: ProjectPhase | null }[]
  const phases = new Map(rows.map(row => [row.id, row.phase ?? null]))
  return projects.map(project => ({ ...project, phase: phases.get(project.id) ?? null }))
}

export async function getProject(): Promise<Project | null> {
  const project = await core.getProject()
  if (!project) return null
  return { ...project, phase: await projectPhase(project.id) }
}

export async function createProject(input: core.NewProject): Promise<Project> {
  const project = await core.createProject(input)
  // The guarded database command starts new Projects in Concept. Mock mode is
  // kept equivalent here rather than changing old fixture creation semantics.
  if (!phaseDb) {
    const stored = mock.projects.find(item => item.id === project.id)
    if (stored) stored.phase = 'concept'
  }
  return { ...project, phase: 'concept' }
}

export async function getAreas(options: { includeArchived?: boolean } = {}): Promise<Area[]> {
  const areas = await core.getAreas(options)
  const projectId = core.getActiveProjectId()
  if (!projectId) return areas.map(area => ({ ...area, phase: null }))
  const phases = await areaPhases(projectId)
  return areas.map(area => ({ ...area, phase: phases.get(area.id) ?? null }))
}

export async function getArea(slug: string): Promise<Area | undefined> {
  return (await getAreas({ includeArchived: true })).find(area => area.slug === slug)
}

export async function createArea(input: core.NewArea): Promise<Area> {
  const area = await core.createArea(input)
  return { ...area, phase: area.phase ?? null }
}

async function setPhase(scope: 'project' | 'area', areaId: string | null, phase: ProjectPhase, reason: string): Promise<void> {
  const projectId = core.getActiveProjectId()
  if (!projectId) throw new Error('database: open a project before changing phase')
  const trimmed = reason.trim()
  if (!trimmed) throw new Error('Add a short reason for the phase change.')
  if (!phaseDb) {
    if (scope === 'project') {
      const project = mock.projects.find(item => item.id === projectId)
      if (!project) throw new Error('database: no such project')
      if (phase === 'complete' && mock.areas.some(area => !area.archivedAt && area.phase !== 'complete')) {
        throw new Error('Complete or explicitly defer every Area before completing the Project.')
      }
      project.phase = phase
    } else {
      const area = mock.areas.find(item => item.id === areaId)
      if (!area) throw new Error('database: no such area')
      area.phase = phase
    }
  } else {
    checked(await phaseDb.rpc('phase_command', {
      p_project: projectId,
      p_scope: scope,
      p_area: areaId,
      p_phase: phase,
      p_reason: trimmed,
    }))
  }
  window.dispatchEvent(new Event(core.PROJECT_CHANGED_EVENT))
}

export async function setProjectPhase(phase: ProjectPhase, reason: string): Promise<void> {
  return setPhase('project', null, phase, reason)
}

export async function setAreaPhase(areaId: string, phase: ProjectPhase, reason: string): Promise<void> {
  return setPhase('area', areaId, phase, reason)
}
