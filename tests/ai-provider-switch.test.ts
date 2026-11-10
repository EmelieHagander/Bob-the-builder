import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshProviderSwitch, resetProviderSwitch, withLiveModel, LIVE_TTL_MS } from '../supabase/functions/_shared/ai-catalog.ts'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import type { AiCatalogSession, ResolvedAiRole } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-11-09: "en switch ska byta instantly så att allt (som går,
// inte embeddings och inte bilder) byter modell". On 2026-11-08 a job pinned to
// Claude kept failing after the tiers had moved to GPT.
const model = (model_name: string, provider: string, model_type: string) => ({ model_name, provider, model_type, is_active: true, is_default: false,
  max_output_tokens: 32000, supports_images: true, supports_reasoning: true, supports_image_output: false,
  input_cost_per_1m_tokens: 1, output_cost_per_1m_tokens: 1, cached_input_cost_per_1m_tokens: null,
  capabilities: { provider_adapter: provider === 'anthropic' ? 'anthropic-messages-v1' : 'openai-responses-v1', reasoning_efforts: ['low', 'medium', 'high'], supports_functions: true, supports_json_schema: true } })
const MODELS = [model('gpt-5.4', 'openai', 'standard'), model('claude-opus-5-5', 'anthropic', 'standard'), model('gpt-image', 'openai', 'image')]
const client = (row: Record<string, unknown> | null, reads = { n: 0 }) => ({ from: (table: string) => ({ select: () => {
  const q: any = { eq: () => q, maybeSingle: async () => { reads.n++; return { data: row, error: null } },
    in: async (_: string, names: string[]) => ({ data: MODELS.filter(m => names.includes(m.model_name)), error: null }) }
  return table === 'ai_provider_switch' || table === 'ai_models' ? q : null
} }) })
const SWITCH = (provider: string) => ({ provider, models: { openai: { standard: 'gpt-5.4' }, anthropic: { standard: 'claude-opus-5-5' } } })
const role = (tier: string, m = MODELS[1]) => ({ app: 'bob', tier, model: m, providerAdapter: m.capabilities.provider_adapter, reasoningEffort: 'medium',
  maxOutputTokens: 16000, providerParameters: {}, profile: { definition: {} } }) as unknown as ResolvedAiRole

test('a running job pinned to Claude moves to GPT at its next call; image tiers stay', async () => {
  resetProviderSwitch()
  await refreshProviderSwitch(client(SWITCH('openai')) as any, 'bob', 1000)
  const moved = withLiveModel(role('standard'))
  assert.equal(moved.model.model_name, 'gpt-5.4')
  assert.equal(moved.providerAdapter, 'openai-responses-v1')
  const image = role('image', MODELS[2] as any)
  assert.equal(withLiveModel(image), image)
})

test('the switch is read at most once per TTL, and a failed read keeps the last value', async () => {
  resetProviderSwitch()
  const reads = { n: 0 }
  await refreshProviderSwitch(client(SWITCH('anthropic'), reads) as any, 'bob', 1000)
  await refreshProviderSwitch(client(SWITCH('openai'), reads) as any, 'bob', 1000 + LIVE_TTL_MS - 1)
  assert.equal(reads.n, 1)
  assert.equal(withLiveModel(role('standard', MODELS[0] as any)).model.model_name, 'claude-opus-5-5')
  const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error('down') }) }) }) }) }
  await refreshProviderSwitch(broken as any, 'bob', 1000 + LIVE_TTL_MS)
  assert.equal(withLiveModel(role('standard', MODELS[0] as any)).model.model_name, 'claude-opus-5-5')
})

test('without a switch row every job keeps its pinned model', async () => {
  resetProviderSwitch()
  await refreshProviderSwitch(client(null) as any, 'bob', 1000)
  const pinned = role('standard')
  assert.equal(withLiveModel(pinned), pinned)
})

test('a profile the other provider cannot serve fails clearly instead of changing silently', async () => {
  resetProviderSwitch()
  await refreshProviderSwitch(client(SWITCH('anthropic')) as any, 'bob', 1000)
  const tuned = { ...role('standard', MODELS[0] as any), providerParameters: { temperature: 0.2 } } as unknown as ResolvedAiRole
  assert.throws(() => withLiveModel(tuned), /provider switch provider parameters/)
})

test('after a switch from Claude to GPT the chain is sent in full once instead of a foreign cursor', async () => {
  let adapter = 'anthropic-messages-v1'
  const catalog = {
    definition: () => ({ metadata: { continuation_input_tokens: 64000, context_input_ceiling_tokens: 96000, continuation_summary_tokens: 1600, retained_tool_exchanges: 2, continuation_retention_version: 2 } }),
    role: () => ({ systemMessage: 'Build carefully.', model: { provider: adapter.startsWith('anthropic') ? 'anthropic' : 'openai' }, providerAdapter: adapter }),
    tool: (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object' } } }),
    text: (key: string) => key,
  } as unknown as AiCatalogSession
  const sent: OpenAIServiceOptions[] = []
  const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
  let refreshed = 0
  const continuation = createBobContextContinuation({ version: 1, aiCatalog: catalog, refreshProvider: async () => { refreshed++ },
    callModel: async options => {
      sent.push(structuredClone(options))
      return { success: true, data: sent.length === 1 ? null : 'done', model: 'm', responseId: 'resp_' + sent.length, usage,
        ...(sent.length === 1 ? { outputPhase: 'tool_calls', toolCalls: [{ id: 'call_one', type: 'function', function: { name: 'read_construction_draft', arguments: '{}' } }] } : {}) } as OpenAIServiceResponse<string>
    } })
  const request: OpenAIServiceOptions = { app: 'bob', module: 'global', coworkerId: 'bob', functionName: 'structure-worker', aiFunction: 'structure-worker',
    catalogRoleKey: 'structure-worker', messages: [{ role: 'user', content: 'Read the construction.' }] }
  const first = await continuation.call(request)
  adapter = 'openai-responses-v1'
  await continuation.call({ ...request, previousResponseId: first.responseId, messages: [{ role: 'tool', tool_call_id: 'call_one', content: '{"revision":4}' }] })
  assert.equal(refreshed, 2)
  assert.equal(sent[1].previousResponseId, undefined, 'a Claude message id must not reach OpenAI as a cursor')
  assert.equal(sent[1].messages?.[0].content, 'Read the construction.')
  assert.equal(sent[1].messages?.at(-1)?.content, '{"revision":4}')
})

test('after a switch from GPT to Claude diagnostics start a new comparison instead of using a GPT response id', async () => {
  let adapter = 'openai-responses-v1'
  const catalog = {
    definition: () => ({ metadata: { continuation_input_tokens: 64000, context_input_ceiling_tokens: 96000,
      continuation_summary_tokens: 1600, retained_tool_exchanges: 2, continuation_retention_version: 2 } }),
    role: () => ({ systemMessage: 'Build carefully.', model: { provider: adapter.startsWith('anthropic') ? 'anthropic' : 'openai' }, providerAdapter: adapter }),
    tool: (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object' } } }),
    text: (key: string) => key,
  } as unknown as AiCatalogSession
  const sent: OpenAIServiceOptions[] = []
  const continuation = createBobContextContinuation({ version: 1, aiCatalog: catalog,
    callModel: async options => {
      sent.push(structuredClone(options))
      return { success: true, data: null, model: 'm', responseId: sent.length === 1 ? 'resp_gpt' : 'msg_claude',
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        ...(sent.length === 1 ? { outputPhase: 'tool_calls', toolCalls: [{ id: 'call_one', type: 'function',
          function: { name: 'read_construction_draft', arguments: '{}' } }] } : {}) } as OpenAIServiceResponse<string>
    } })
  const request: OpenAIServiceOptions = { app: 'bob', module: 'global', coworkerId: 'bob', functionName: 'structure-worker',
    aiFunction: 'structure-worker', catalogRoleKey: 'structure-worker', messages: [{ role: 'user', content: 'Read the construction.' }] }
  const first = await continuation.call(request)
  adapter = 'anthropic-messages-v1'
  await continuation.call({ ...request, previousResponseId: first.responseId,
    messages: [{ role: 'tool', tool_call_id: 'call_one', content: '{"revision":4}' }] })
  assert.equal(sent[1].previousResponseId, undefined, 'the GPT cursor must not reach Claude')
  assert.equal(sent[1].cacheDiagnosticsPreviousMessageId, null, 'the GPT response has no Claude fingerprint')
})
