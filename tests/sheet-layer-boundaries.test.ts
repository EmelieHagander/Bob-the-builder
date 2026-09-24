import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { installSheetLayerFixture } from '../scripts/sheet-layer-browser.mjs'
import { verifySheetLayers } from '../scripts/check-live-sheet-layers.mjs'

const source = (path: string) => readFile(new URL('../' + path, import.meta.url), 'utf8')

test('sheet browser fixture does not parse unrelated multipart Storage uploads', async () => {
  let delegated = 0
  const request = { method: () => 'POST', postDataJSON() { throw new Error('Multipart is not JSON') } }
  const fixture = {
    async handle(actual: unknown, url: URL, respond: (value: unknown) => Promise<void>) {
      assert.equal(actual, request)
      assert.equal(url.pathname, '/storage/v1/object/bob-project-media/example.png')
      delegated++
      await respond({ status: 200, json: { Key: 'unchanged-upload' } })
      return true
    },
  }
  installSheetLayerFixture(fixture, () => 'unused', {})
  let response: unknown
  assert.equal(await fixture.handle(request, new URL('https://fixture.invalid/storage/v1/object/bob-project-media/example.png'), async value => { response = value }), true)
  assert.equal(delegated, 1)
  assert.deepEqual(response, { status: 200, json: { Key: 'unchanged-upload' } })
})

test('sheet hosted proof refuses real projects before touching artifacts or data', async () => {
  const query = {
    select() { return query }, eq() { return query },
    async single() { return { data: { name: 'Real house', type: 'Verification', description: 'Private work' }, error: null } },
  }
  const client = {
    from(table: string) { assert.equal(table, 'projects'); return query },
    rpc() { throw new Error('Must not write real data') },
  }
  await assert.rejects(verifySheetLayers(client, {}, 'real', 'area', 'artifact'), /Bob foundations verification/)
})

test('sheet browser proof remains in the existing three-width foundation gate', async () => {
  const runner = await source('scripts/check-foundations-browser.mjs')
  assert(runner.includes('installSheetLayerFixture(materialPlanning, timestamp, solutions)'))
  assert(runner.includes('await verifySheetLayersBrowser(page, base, materialPlanning, viewport.width)'))
  for (const width of [320, 390, 1280]) assert(runner.includes('width: ' + width))
})

test('actual sheet Shopping trigger preserves FK deletion and explicit replacement', async () => {
  // Focused regression for the actual migration function. The full migration and
  // authenticated command/readiness path are also exercised by sheet-layers.test.ts.
  const sql = await source('supabase/migrations/20260915183904_sheet_layer_material_quantities.sql')
  const fn = sql.match(/create function bob_private\.sheet_layer_shopping_quantity\(\)[\s\S]*?end \$\$;/)?.[0]
  const trigger = sql.match(/create trigger sheet_layer_shopping_quantity[\s\S]*?;/)?.[0]
  assert(fn && trigger)
  const pg = new PGlite()
  try {
    await pg.exec(`create schema bob; create schema bob_private;
      create table bob.material_requirement_revisions(project_id text,requirement_id uuid,revision integer,method_key text,sheet_layer jsonb,purchase_increment numeric,purchase_quantity numeric);
      create table bob.materials(id text primary key,project_id text,qty text,status text);
      create table bob.material_requirement_shopping(project_id text,requirement_id uuid,synced_requirement_revision integer,material_id text references bob.materials(id) on delete set null,synced_qty text);`)
    await pg.exec(fn + '\n' + trigger)
    await pg.exec(`insert into bob.material_requirement_revisions values('A','98000000-0000-0000-0000-000000000900',1,'stud_wall_sheet_layer','{"coverage_kind":"sheet_dimensions"}',2.88,17.28);
      insert into bob.materials values('first','A','17.28 m²','delivered');
      insert into bob.material_requirement_shopping values('A','98000000-0000-0000-0000-000000000900',1,'first','17.28 m²');`)
    assert.deepEqual((await pg.query('select qty,status from bob.materials')).rows, [{ qty: '6 sheets (17.28 m²)', status: 'delivered' }])
    await pg.exec("delete from bob.materials where id='first'")
    assert.deepEqual((await pg.query('select material_id,synced_qty from bob.material_requirement_shopping')).rows, [{ material_id: null, synced_qty: '6 sheets (17.28 m²)' }])
    await pg.exec("insert into bob.materials values('replacement','A','17.28 m²','needed'); update bob.material_requirement_shopping set material_id='replacement'")
    assert.deepEqual((await pg.query('select qty,status from bob.materials')).rows, [{ qty: '6 sheets (17.28 m²)', status: 'needed' }])
    assert.equal((await pg.query('select synced_qty from bob.material_requirement_shopping')).rows[0].synced_qty, '6 sheets (17.28 m²)')
  } finally { await pg.close() }
})
