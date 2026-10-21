import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema } from './support/project-schema.ts'

// 20261021150000: the two heaviest source-assessment layers run as plan-cached
// plpgsql with unchanged signature, result type, security and grants.
test('source assessment layers are plan-cached plpgsql with unchanged authority', async t => {
  const pg = await projectSchema(); t.after(() => pg.close())
  const rows = (await pg.query(`select p.proname, l.lanname, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text acl,
    pg_get_function_result(p.oid) result
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='bob_private' and p.proname in ('artifact_source_assessment_before_physical','artifact_source_assessment_before_parameters')
    order by p.proname`)).rows as any[]
  assert.equal(rows.length, 2)
  for (const row of rows) {
    assert.equal(row.lanname, 'plpgsql', row.proname)
    assert.equal(row.prosecdef, false, row.proname)
    assert.equal(row.provolatile, 's', row.proname)
    assert.deepEqual([...row.proconfig].sort(), ['from_collapse_limit=1', 'join_collapse_limit=1', 'plan_cache_mode=force_generic_plan', 'search_path=""'], row.proname)
    assert.equal(row.result, 'TABLE(source_state text, source_reasons text[])', row.proname)
    for (const role of ['anon', 'service_role'])
      assert.equal((await pg.query(`select has_function_privilege($1, 'bob_private.${row.proname}(text,uuid,integer)', 'execute') ok`, [role])).rows[0].ok, false, row.proname + ' ' + role)
    assert.equal((await pg.query(`select has_function_privilege('authenticated', 'bob_private.${row.proname}(text,uuid,integer)', 'execute') ok`)).rows[0].ok, true, row.proname)
  }
  // An unknown artifact still yields no row from either layer.
  for (const row of rows)
    assert.equal((await pg.query(`select count(*)::int n from bob_private.${row.proname}('none', gen_random_uuid(), 1)`)).rows[0].n, 0)
})
