import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'

const pg = new PGlite()
const root = new URL('../supabase/migrations/', import.meta.url)
const sql = (name: string) => readFile(new URL(name, root), 'utf8')
const openai = { provider_adapter: 'openai-responses-v1', reasoning_efforts: ['low', 'medium', 'high'], supports_functions: true, supports_json_schema: true }
const claude = { provider_adapter: 'anthropic-messages-v1', reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max'], forced_tool_choice: false, supports_functions: true, supports_json_schema: true }
const resolve = async () => pg.transaction(async tx => {
  await tx.exec('set local role service_role')
  return (await tx.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
})

before(async () => {
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);')
  await setupSharedSocial(pg)
  await pg.exec(await sql('20261009144206_ai_definition_catalog.sql'))
  await pg.exec(await sql('20261018081835_ai_embedding_adapter.sql'))
  await pg.exec('alter table shared.ai_prompts add column if not exists retired_at timestamptz')
  await pg.query("update shared.ai_models set capabilities=$1 where model_type in ('nano','mini','standard')", [openai])
  await pg.query(`insert into shared.ai_models(model_name,provider,model_type,is_active,is_current_for_type,max_output_tokens,supports_images,supports_reasoning,supports_json_schema,capabilities)
    values('claude-haiku-5-5','anthropic','nano',true,false,128000,true,true,true,$1),('claude-sonnet-5-5','anthropic','mini',true,false,128000,true,true,true,$1),
    ('claude-opus-5-5','anthropic','standard',true,false,128000,true,true,true,$1)`, [claude])
  const versions: Record<string, string> = {}
  for (const [key, kind, body, content] of [
    ['tier.nano', 'tier_binding', { tier: 'nano', selection: 'preserve_existing_ai_settings_on_seed', model_name: 'gpt-5.4-nano' }, ''],
    ['tier.mini', 'tier_binding', { tier: 'mini', selection: 'preserve_existing_ai_settings_on_seed', model_name: 'gpt-5.4-mini' }, ''],
    ['tier.standard', 'tier_binding', { tier: 'standard', selection: 'preserve_existing_ai_settings_on_seed', model_name: 'gpt-5.4' }, ''],
    ['bob.persona', 'prompt', {}, 'You are Bob.'],
    ['profile.ask-bob', 'execution_profile', { tier: 'standard', reasoning_effort: 'medium', max_output_tokens: 16000, requirements: { images: true, functions: true } }, ''],
    ['profile.worker', 'execution_profile', { tier: 'mini', reasoning_effort: 'high', max_output_tokens: 50000, requirements: { json_schema: true } }, ''],
    ['role.ask-bob', 'role', { profile_key: 'profile.ask-bob', prompt_keys: ['bob.persona'] }, ''],
    ['role.worker', 'role', { profile_key: 'profile.worker', prompt_keys: ['bob.persona'] }, ''],
  ] as const) {
    const head = (await pg.query<any>('insert into shared.ai_prompts(app,prompt_key,label,definition_kind) values($1,$2,$2,$3) returning id', ['bob', key, kind])).rows[0]
    versions[key] = (await pg.query<any>('insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition,content) values($1,1,$2,$3,$4) returning id', [head.id, kind, body, content])).rows[0].id
  }
  await pg.transaction(async tx => { await tx.exec('set local role service_role'); await tx.query("select shared.activate_ai_catalog('bob',$1)", [versions]) })
})
after(() => pg.close())

test('Bob text tiers move to Claude, the runtime resolves the Anthropic adapter, and a rerun is a no-op', async () => {
  const before = await pg.query<any>('select model_name,is_current_for_type,is_default from shared.ai_models order by 1')
  const migration = await sql('20261102210000_bob_claude_tiers.sql')
  await pg.exec(migration)
  const manifest = await resolve()
  const tiers = Object.fromEntries(manifest.definitions.filter((d: any) => d.definition_kind === 'tier_binding').map((d: any) => [d.definition.tier, d]))
  assert.deepEqual(Object.fromEntries(Object.entries(tiers).map(([tier, d]: any) => [tier, d.definition.model_name])),
    { nano: 'claude-haiku-5-5', mini: 'claude-sonnet-5-5', standard: 'claude-opus-5-5' })
  assert.equal(tiers.standard.metadata.previous_model, 'gpt-5.4')
  const session = createAiCatalogSession({ rpc: async () => { throw new Error('pinned') } }, { app: 'bob', manifest })
  assert.equal(session.role('ask-bob').providerAdapter, 'anthropic-messages-v1')
  assert.equal(session.role('worker').model.model_name, 'claude-sonnet-5-5')
  await pg.exec(migration)
  const count = (await pg.query<any>("select count(*)::int n from shared.ai_prompt_versions v join shared.ai_prompts p on p.id=v.prompt_id where p.prompt_key='tier.mini'")).rows[0].n
  assert.equal(count, 2, 'rerun publishes nothing new')
  assert.deepEqual((await pg.query<any>('select model_name,is_current_for_type,is_default from shared.ai_models order by 1')).rows, before.rows, 'model table and other apps untouched')
})

test('the publish check keeps Claude to text tiers, its own provider and its own parameters', async () => {
  const snapshot = await resolve()
  for (const mutate of [
    (s: any) => { s.models.find((m: any) => m.model_name === 'claude-opus-5-5').provider = 'openai' },
    (s: any) => { s.models.find((m: any) => m.model_name === 'claude-opus-5-5').capabilities.provider_adapter = 'openai-responses-v1' },
    (s: any) => { s.definitions.find((d: any) => d.prompt_key === 'profile.ask-bob').definition.provider_parameters = { verbosity: 'low' } },
    (s: any) => { s.definitions.find((d: any) => d.prompt_key === 'profile.ask-bob').definition.reasoning_effort = 'minimal' },
  ]) {
    const value = structuredClone(snapshot)
    mutate(value)
    await assert.rejects(pg.query('select shared.ai_catalog_validate($1)', [value]), String(mutate))
  }
  const allowed = structuredClone(snapshot)
  allowed.definitions.find((d: any) => d.prompt_key === 'profile.ask-bob').definition.provider_parameters = { parallel_tool_calls: true }
  await pg.query('select shared.ai_catalog_validate($1)', [allowed])
})
