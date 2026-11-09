import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'

// Owner decision 2026-11-09: the live text-provider switch is one checked row.
const pg = new PGlite()
const sql = (name: string) => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const openai = { provider_adapter: 'openai-responses-v1', reasoning_efforts: ['low', 'medium', 'high'], supports_functions: true, supports_json_schema: true }
const claude = { provider_adapter: 'anthropic-messages-v1', reasoning_efforts: ['low', 'medium', 'high'], supports_functions: true, supports_json_schema: true }

before(async () => {
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);')
  await setupSharedSocial(pg)
  // Live shared.ai_models.provider is the shared.ai_provider enum, not text.
  await pg.exec("create type shared.ai_provider as enum ('openai','anthropic'); alter table shared.ai_models alter column provider drop default, alter column provider type shared.ai_provider using provider::shared.ai_provider")
  await pg.exec(await sql('20261009144206_ai_definition_catalog.sql'))
  await pg.query("update shared.ai_models set capabilities=$1 where model_type in ('nano','mini','standard')", [openai])
  await pg.query(`insert into shared.ai_models(model_name,provider,model_type,is_active,is_current_for_type,max_output_tokens,supports_images,supports_reasoning,supports_json_schema,capabilities)
    values('claude-haiku-5-5','anthropic','nano',true,false,128000,true,true,true,$1),('claude-sonnet-5-5','anthropic','mini',true,false,128000,true,true,true,$1),
    ('claude-opus-5-5','anthropic','standard',true,false,128000,true,true,true,$1)`, [claude])
  await pg.exec(await sql('20261109060000_bob_ai_provider_switch.sql'))
})

test('Bob starts on GPT with both providers mapped, and one update switches it', async () => {
  const row = (await pg.query<any>("select provider, models from shared.ai_provider_switch where app='bob'")).rows[0]
  assert.equal(row.provider, 'openai')
  assert.deepEqual(row.models.anthropic, { nano: 'claude-haiku-5-5', mini: 'claude-sonnet-5-5', standard: 'claude-opus-5-5' })
  await pg.exec("update shared.ai_provider_switch set provider='anthropic', updated_at=now() where app='bob'")
  assert.equal((await pg.query<any>("select provider from shared.ai_provider_switch where app='bob'")).rows[0].provider, 'anthropic')
})

test('a model that is missing, inactive or of another provider or tier is refused', async () => {
  for (const models of [{ openai: { standard: 'gpt-unknown' } }, { openai: { standard: 'claude-opus-5-5' } }, { anthropic: { nano: 'claude-opus-5-5' } }]) {
    await assert.rejects(pg.query("update shared.ai_provider_switch set models=$1, provider=$2 where app='bob'", [models, Object.keys(models)[0]]), /ai_provider_switch_model_unavailable/)
  }
  await assert.rejects(pg.exec("update shared.ai_provider_switch set models='{\"openai\":{\"nano\":\"gpt-5.4-nano\"}}', provider='anthropic' where app='bob'"), /ai_provider_switch_provider_unmapped/)
})

test('only the service role can read it', async () => {
  const read = (role: string) => pg.transaction(async tx => { await tx.exec('set local role ' + role); return tx.query("select provider from shared.ai_provider_switch") })
  await assert.rejects(read('authenticated'), /permission denied/)
  assert.equal((await read('service_role')).rows.length, 1)
})
