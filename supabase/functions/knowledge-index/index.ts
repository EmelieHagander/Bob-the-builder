// Operator-only: embeds pending reference-book passages with the catalog's
// pinned embedding model. Called by hand (deploy thread) after a corpus
// migration; never by a user, a schedule or a Bob turn.
import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { timingSafeEqual } from 'node:crypto'
import { createAiCatalogSession } from '../_shared/ai-catalog.ts'
import { callOpenAIEmbeddings } from '../_shared/openai-service.ts'
import { indexKnowledgePassages } from '../_shared/knowledge-index.ts'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const same = (a: string, b: string) => { const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b); return x.length === y.length && timingSafeEqual(x, y) }

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'not_configured' })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!same(request.headers.get('Authorization') ?? '', `Bearer ${serviceKey}`)) return json(401, { error: 'unauthorized' })
  const body = await request.json().catch(() => ({})) as { max_batches?: unknown }
  const maxBatches = Number.isSafeInteger(body.max_batches) && Number(body.max_batches) >= 1 && Number(body.max_batches) <= 20 ? Number(body.max_batches) : 4
  const bob = createClient(url, serviceKey, { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false } })
  const shared = createClient(url, serviceKey, { db: { schema: 'shared' }, auth: { persistSession: false, autoRefreshToken: false } })
  const catalog = createAiCatalogSession(shared as never, { app: 'bob' })
  await catalog.load()
  const role = catalog.role('memory-embedding')
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await bob.rpc(name, args)
    if (error) throw new Error(`${name}: ${error.message}`)
    return data
  }
  const result = await indexKnowledgePassages({
    model: role.model.model_name, maxBatches, deadline: Date.now() + 100_000,
    store: {
      pending: (limit, model) => rpc('knowledge_index_pending', { p_limit: limit, p_model: model }),
      save: (items, model) => rpc('knowledge_index_save', { p_items: items, p_model: model }),
    },
    embed: async texts => {
      const response = await callOpenAIEmbeddings({ app: 'bob', coworkerId: 'bob', module: 'global', functionName: 'memory-embedding', aiFunction: 'knowledge-index',
        aiDefinition: role, input: texts, timeoutMs: 60_000 })
      if (!response.success || !response.data) throw new Error(response.error ?? 'embedding_failed')
      return response.data
    },
  })
  return json(result.status === 'failed' ? 502 : 200, { ...result, model: role.model.model_name })
})
