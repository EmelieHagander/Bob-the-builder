import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema } from './support/project-schema.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { CAD_VIEW_NAMES, CAD_MAX_VIEWS } from '../supabase/functions/_shared/cad-adapter.ts'

// 20261021160000: every side can be requested through SQL validators and Bob's contracts.
test('SQL construction and volunteer validators accept every view and no seven-view recipe', async t => {
  const pg = await projectSchema(); t.after(() => pg.close())
  const rows = (await pg.query(`select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='bob_private' and p.proname='check_construction') or (n.nspname='bob_volunteer_private' and p.proname='volunteer_drawing')`)).rows as any[]
  assert(rows.length >= 2)
  for (const row of rows) {
    for (const view of CAD_VIEW_NAMES) assert.match(row.prosrc, new RegExp(`'${view}'`), row.proname + ' ' + view)
    assert.doesNotMatch(row.prosrc, /'front','right','top','isometric'/, row.proname)
  }
  const check = rows.find(r => r.proname === 'check_construction')!.prosrc
  assert.match(check, /not between 1 and 6/)
})

test('Bob and his CAD colleagues are offered every view, at most six, with view guidance', () => {
  const catalog = catalogFixture()
  for (const key of ['save_construction_draft', 'design_project_cad', 'plan_cad_pieces']) {
    const text = JSON.stringify(catalog.tool(key))
    assert.match(text, /isometric_back_right/, key)
    assert.doesNotMatch(text, /\["front","right","top","isometric"\]/, key)
  }
  const handoff = JSON.stringify(catalog.definition('schema.design_handoff', 'response_schema').definition)
  assert.match(handoff, /"maxItems":6/); assert.match(handoff, /left gable/)
  assert.equal(CAD_MAX_VIEWS, 6)
})
