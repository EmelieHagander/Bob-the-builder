import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import type { AiRpc } from './ai-background.ts'
export function aiBackgroundRpc(): AiRpc {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'shared' }, auth: { persistSession: false, autoRefreshToken: false } })
  return async (name, args) => {
    const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(10000))
    if (error) throw new Error('ai_job_storage_unavailable')
    return data
  }
}
