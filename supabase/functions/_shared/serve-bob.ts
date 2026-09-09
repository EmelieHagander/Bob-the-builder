/** Bob's authenticated OpenAI entry point. Project reads use the caller JWT;
 * model configuration and billing stay in the shared OpenAI service. */
import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { answerWithOpenAi } from './ask-openai.ts'
import { createBobHandler } from './bob-request.ts'

export function serveBob() {
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
