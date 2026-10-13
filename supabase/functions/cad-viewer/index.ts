import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { createCadViewerHandler, createCadWireframeTransport } from '../_shared/cad-viewer-request.ts'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false } })
const render = createCadWireframeTransport(Deno.env.get('BOB_CAD_URL'), Deno.env.get('BOB_CAD_TOKEN'))
Deno.serve(createCadViewerHandler({
  authorize: async (authorization, pin) => {
    const caller = createClient(url, anon, { db: { schema: 'bob' }, global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const user = await caller.auth.getUser(authorization.slice(7))
    if (user.error || !user.data.user) return null
    const source = await caller.from('artifact_source_status').select('source_state').eq('project_id', pin.project_id).eq('artifact_id', pin.artifact_id).eq('revision', pin.revision).maybeSingle()
    if (source.error || !source.data || source.data.source_state === 'unavailable') return null
    const row = await caller.from('artifact_cad_revisions').select('recipe').eq('project_id', pin.project_id).eq('artifact_id', pin.artifact_id).eq('artifact_revision', pin.revision).maybeSingle()
    return row.error ? null : row.data?.recipe ?? null
  },
  claim: async (pin, hash, retry) => {
    const result = await service.rpc('claim_cad_viewer_export', { p_project: pin.project_id, p_artifact: pin.artifact_id, p_revision: pin.revision, p_hash: hash, p_retry: retry })
    if (result.error) throw new Error('viewer_cache_unavailable')
    return result.data
  },
  finish: async (pin, hash, lease, payload) => {
    const result = await service.rpc('finish_cad_viewer_export', { p_project: pin.project_id, p_artifact: pin.artifact_id, p_revision: pin.revision, p_hash: hash, p_lease: lease, p_payload: payload })
    if (result.error) throw new Error('viewer_cache_unavailable')
    return result.data === true
  },
  render,
}))
