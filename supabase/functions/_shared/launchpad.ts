/** Keep the deployed ask-launchpad URL stable while Bob uses the provider that
 * supports bounded server-side tools. The former app-wide Launchpad workspace
 * and unbound task ids are disabled; see supabase/README.md for re-enable gates.
 * This module belongs to Bob's deployment, not other apps' edge bundles. */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { answerWithOpenAi } from './ask-openai.ts'
import { createBobHandler } from './bob-request.ts'

export function serveLaunchpad(config: { app: 'bob'; dbSchema: 'bob' }) {
  if (config.app !== 'bob' || config.dbSchema !== 'bob') throw new Error('Bob identity must be pinned in source')
  return createBobHandler({
    authenticate: async authHeader => {
      const url = Deno.env.get('SUPABASE_URL')
      const key = Deno.env.get('SUPABASE_ANON_KEY')
      if (!url || !key) return null
      const client = createClient(url, key, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data, error } = await client.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
      return error ? null : data.user?.id ?? null
    },
    answer: answerWithOpenAi,
  })
}
