import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema } from './support/project-schema.ts'

test('store research publishes a read-only catalog and preserves unknown native search totals in durable accounting', async t => {
  const pg = await projectSchema(); t.after(() => pg.close())
  const result: any = (await pg.query("select shared.resolve_ai_catalog('bob',null) as result")).rows[0].result
  const box = result.definitions.find((d: any) => d.prompt_key === 'bob.tools').definition
  assert.equal(box.store_research_version, 1)
  assert.equal(box.blocker_handoff_version, 1)
  const role = result.definitions.find((d: any) => d.prompt_key === 'role.store-worker').definition
  assert.deepEqual(role.tool_keys, [], 'research has no project mutation tools')
  assert.equal((await pg.query("select has_function_privilege('authenticated','shared.ai_job_accept(uuid,jsonb)','execute') as allowed")).rows[0].allowed, false)
  await pg.exec("update shared_private.ai_runtime set worker_url='https://fixtureproject.supabase.co/functions/v1/ai-background-worker'")
  await pg.exec("create function shared_private.store_fixture_wake(p_job uuid,p_context jsonb,p_status text) returns void language plpgsql as $$begin return; end$$; insert into shared_private.ai_receivers values('store_fixture','main','shared_private','store_fixture_wake',true)")
  const accounting = { user_id: null, module: 'global', ai_function: 'store-worker', model: 'fixture', input_price_per_1m: 1, output_price_per_1m: 2, cached_price_per_1m: .1 }
  for (const native_search of [true, false]) {
    const prepared: any = (await pg.query("select shared.ai_job_reserve('store_fixture',$1,$2,'main','{}',now()+interval '1 hour',$3::jsonb) as result",
      ['native-' + native_search, 'a'.repeat(64), JSON.stringify({ ...accounting, ...(native_search ? { native_search: true } : {}) })])).rows[0].result
    const response = { id: 'resp_' + native_search, status: 'completed', metadata: { ai_job_id: prepared.id }, usage: { input_tokens: 100, output_tokens: 50 } }
    await pg.query('select shared.ai_job_accept($1,$2::jsonb)', [prepared.id, JSON.stringify(response)])
    const row: any = (await pg.query('select cost_usd,cost_basis,input_tokens from shared.ai_usage_events where background_job_id=$1', [prepared.id])).rows[0]
    assert(row)
    assert.equal(row.input_tokens, 100)
    assert.equal(row.cost_basis, native_search ? 'native_search_total_unknown' : null)
    if (native_search) assert.equal(row.cost_usd, null)
    else assert.equal(Number(row.cost_usd), .0002)
  }
})
