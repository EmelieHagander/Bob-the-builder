/*
 * Canonical public data seam. Core reads, phase commands and Bob conversation
 * exports all share the same account Auth owner. UI never queries the SDK.
 */
import { accountClient as phaseDb } from './supabaseClient'
import * as core from './databaseCore'
import * as mock from './mockData'
import type { Area, Project, ProjectPhase } from './types'

export * from './databaseCore'
// Explicit exports win over the legacy star export above. Ask Bob now resolves
// server-owned conversation state while the rest of databaseCore stays stable.
export { renewDrawingRequests, cancelAskBobTurn, subscribeBobInbox, getBobInbox, markBobChatRead, BOB_INBOX_EVENT, BOB_CONTEXT_TOO_LARGE, askBob, getAskBobConversation, getAskBobTurnProgress, getAskBobDrawingRecovery, clearAskBobHistoryCache, resetAskBobConversation, refreshAskBobProject, describeBobProgress } from './bobConversation'
export type { BobProgress, BobInbox } from './bobConversation'

function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`database: ${result.error.message}`)
  if (result.data === null || result.data === undefined) throw new Error('database: query returned no data')
  return result.data
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
