import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'

const pg = new PGlite()
let snapshot: any
before(async () => {
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);')
  await setupSharedSocial(pg)
  const root = new URL('../supabase/migrations/', import.meta.url)
  await pg.exec(await readFile(new URL('20261009144206_ai_definition_catalog.sql', root), 'utf8'))
  const migration = (await readdir(root)).find(name => name.endsWith('_ai_embedding_adapter.sql'))
  assert(migration, 'embedding validator foundation exists')
  await pg.exec(await readFile(new URL(migration, root), 'utf8'))
  await pg.query(`insert into shared.ai_models(model_name,model_type,max_output_tokens,supports_images,supports_reasoning,supports_json_schema,input_cost_per_1m_tokens,output_cost_per_1m_tokens,capabilities)
    values('fixture-embedding','embedding',1,false,false,false,.02,0,$1)`, [{ provider_adapter: 'openai-embeddings-v1', supports_embedding_dimensions: true, max_embedding_dimensions: 1536, max_batch_inputs: 2048 }])
  const versions: Record<string, string> = {}
  for (const [key, kind, body] of [
    ['tier.embedding', 'tier_binding', { tier: 'embedding', model_name: 'fixture-embedding' }],
    ['profile.memory-embedding', 'execution_profile', { tier: 'embedding', reasoning_effort: null, provider_parameters: { dimensions: 256 } }],
    ['role.memory-embedding', 'role', { profile_key: 'profile.memory-embedding', prompt_keys: [] }],
  ] as const) {
    const head = (await pg.query<any>('insert into shared.ai_prompts(app,prompt_key,label,definition_kind) values($1,$2,$2,$3) returning id', ['embedding-test', key, kind])).rows[0]
    versions[key] = (await pg.query<any>('insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition) values($1,1,$2,$3) returning id', [head.id, kind, body])).rows[0].id
  }
  await pg.transaction(async tx => {
    await tx.exec('set local role service_role')
    await tx.query('select shared.activate_ai_catalog($1,$2)', ['embedding-test', versions])
    snapshot = (await tx.query<any>('select shared.resolve_ai_catalog($1,null) result', ['embedding-test'])).rows[0].result
  })
})
after(() => pg.close())

test('embedding catalog activates an immutable dimension/model/price pin accepted by runtime', async () => {
  const role = createAiCatalogSession({ rpc: async () => { throw new Error('pinned') } }, { app: 'embedding-test', manifest: snapshot }).role('memory-embedding')
  assert.equal(role.providerAdapter, 'openai-embeddings-v1')
  assert.equal(role.providerParameters.dimensions, 256)
  assert.equal(role.model.input_cost_per_1m_tokens, .02)
  assert.equal(role.systemMessage, '')
  const prices = (await pg.query<any>("select input_cost_per_1m_tokens,output_cost_per_1m_tokens from shared.ai_models where model_name='fixture-embedding'")).rows[0]
  assert.equal(Number(prices.input_cost_per_1m_tokens), .02)
  assert.equal(Number(prices.output_cost_per_1m_tokens), 0)
})

test('catalog rejects unsupported dimensions, text parameters, adapter classes and invented prompt semantics', async () => {
  for (const mutate of [
    (s: any, profile: any) => { profile.provider_parameters = { dimensions: 1537 } },
    (s: any, profile: any) => { profile.provider_parameters = { dimensions: 0 } },
    (s: any, profile: any) => { profile.provider_parameters = { dimensions: 1.5 } },
    (s: any, profile: any) => { profile.provider_parameters = { dimensions: 256, temperature: 0 } },
    (s: any, profile: any) => { profile.max_output_tokens = 100 },
    (s: any, profile: any) => { profile.reasoning_effort = 'high' },
    (s: any) => { s.models[0].capabilities.supports_embedding_dimensions = false },
    (s: any) => { s.models[0].capabilities.provider_adapter = 'openai-responses-v1' },
    (s: any) => { s.definitions.find((d: any) => d.definition_kind === 'role').definition.prompt_keys = ['embedding.persona'] },
  ]) {
    const value = structuredClone(snapshot), profile = value.definitions.find((d: any) => d.definition_kind === 'execution_profile').definition
    mutate(value, profile)
    await assert.rejects(pg.query('select shared.ai_catalog_validate($1)', [value]), /ai_catalog_(embedding_incompatible|provider_parameters_invalid|provider_unsupported|prompt_required)/)
  }
})

test('prompt-free allowance does not spill into text roles or grant browser access', async () => {
  const value = structuredClone(snapshot)
  value.definitions.find((d: any) => d.definition_kind === 'execution_profile').definition.tier = 'mini'
  await assert.rejects(pg.query('select shared.ai_catalog_validate($1)', [value]), /ai_catalog_(tier_unavailable|prompt_required)/)
  for (const role of ['anon', 'authenticated']) await assert.rejects(pg.transaction(async tx => {
    await tx.exec(`set local role ${role}`)
    await tx.query('select shared.ai_catalog_validate($1)', [snapshot])
  }), /permission denied/)
})
