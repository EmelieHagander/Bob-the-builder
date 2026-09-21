import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2'
import { checkedToolSnapshot, type ToolPolicyReader } from './session.ts'

/** No service-role domain reads, per-user/global cache, or fallback after a
 * failed policy read. Phase is a current DB fact, never a model/browser grant. */
export function createToolPolicyReader(client: SupabaseClient<any, any, any>, projectId: string): ToolPolicyReader {
  return async () => {
    const signal = AbortSignal.timeout(10_000)
    const [project, catalog] = await Promise.all([
      client.from('projects').select('id,phase').eq('id', projectId).abortSignal(signal).maybeSingle(),
      client.from('tool_catalog').select('name,description,how_to,schema_version,always_load,preload_phases,active')
        .order('name').limit(129).abortSignal(signal),
    ])
    if (project.error || catalog.error) throw new Error('tool_catalog_unavailable')
    if (!project.data || project.data.id !== projectId) throw new Error('project_denied')
    return checkedToolSnapshot({ phase: project.data.phase, tools: catalog.data })
  }
}
