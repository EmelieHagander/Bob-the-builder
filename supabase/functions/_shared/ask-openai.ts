import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { callOpenAIResponses } from './openai-service.ts'
import { createProjectLookup } from './project-lookup.ts'
import { runProjectAnswer, type ProjectAnswer } from './project-answer.ts'

/** Project reads use the caller JWT. Service access stays inside the shared
 * AI service for configuration/billing, never project context. */
export async function answerWithOpenAi(opts: {
  authHeader: string; userId: string; projectId: string; message: string;
}): Promise<ProjectAnswer> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !key) return { ok: false, error: 'not_configured' }
  const client = createClient(url, key, {
    db: { schema: 'bob' }, global: { headers: { Authorization: opts.authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const lookup = createProjectLookup(opts.projectId, (projectId, input, signal) =>
    client.rpc('search_project_data', {
      p_project_id: projectId, p_dataset: input.dataset, p_query: input.query,
      p_status: input.status, p_area_id: input.area_id, p_record_id: input.record_id,
    }).abortSignal(signal))
  return runProjectAnswer({ ...opts, lookup,
    hasAccess: async () => {
      const { data, error } = await client.from('projects').select('id').eq('id', opts.projectId)
        .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
      return !error && data?.id === opts.projectId
    },
    callModel: options => callOpenAIResponses<string>(options),
  })
}
