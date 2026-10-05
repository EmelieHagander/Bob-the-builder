import type { SupabaseClient } from '@supabase/supabase-js'
import { savedTaskEstimate } from '../lib/workEstimate'
export interface ProjectOverview {
  projectId: string
  thumbnailId: string | null
  participants: { id: string; name: string; initials: string; color: string }[]
  event: { title: string; day: string; time: string } | null
  taskEstimate: string | null
}
/** Batch private account reads; no active-project switch, inferred dates or invented duration. */
export async function readProjectOverview(client: SupabaseClient<any, any, any> | null, projectIds: string[], guard: () => void): Promise<ProjectOverview[]> {
  const ids = [...new Set(projectIds.filter(Boolean))]
  if (!client || !ids.length) return []
  const results = await Promise.all([
    client.from('people').select('id,project_id,name,initials,color', {count:'exact'}).in('project_id', ids).order('name'),
    client.from('events').select('project_id,title,day,time', {count:'exact'}).in('project_id', ids).order('sort_order'),
    client.from('tasks').select('project_id,hours', {count:'exact'}).in('project_id', ids),
    client.from('project_thumbnails').select('project_id,media_id,media_assets!inner(state)').in('project_id', ids).eq('media_assets.state', 'ready'),
  ])
  guard()
  const checked = <T extends { project_id: string }>(result: { data: T[] | null; error: { message: string } | null }): T[] => {
    if (result.error) throw new Error(result.error.message)
    const rows = result.data ?? []
    if (rows.some(row => !ids.includes(row.project_id))) throw new Error('Project overview context changed. Reload before continuing.')
    return rows
  }
  const people = checked(results[0]), events = checked(results[1]), tasks = checked(results[2]), thumbnails = checked(results[3])
  // PostgREST may cap a response. Never turn a partial page into a total.
  const complete = (result: {count?: number | null; data: unknown[] | null}) => result.count == null || result.count <= (result.data?.length ?? 0)
  return ids.map(projectId => ({
    projectId,
    thumbnailId: thumbnails.find(row => row.project_id === projectId)?.media_id ?? null,
    participants: complete(results[0]) ? people.filter(row => row.project_id === projectId).map(row => ({ id: row.id, name: row.name, initials: row.initials, color: row.color })) : [],
    // day/time are authored labels, not sortable dates. Retain the saved event order.
    event: complete(results[1]) ? events.find(row => row.project_id === projectId && (row.day.trim() || row.time.trim())) ?? null : null,
    taskEstimate: complete(results[2]) ? savedTaskEstimate(tasks.filter(row => row.project_id === projectId).map(row => row.hours)) : null,
  }))
}
