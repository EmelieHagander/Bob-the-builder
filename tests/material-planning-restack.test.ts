import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const migrations = new URL('../supabase/migrations/', import.meta.url)

test('material planning migrations stay additive after the deployed building-context series', async () => {
  const files = (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()
  const buildingTail = files.indexOf('20260913144500_building_delete_child_order.sql')
  const materialStart = files.indexOf('20260913210000_material_planning.sql')
  assert(buildingTail >= 0, 'expected deployed building-context tail migration in source history')
  assert(materialStart > buildingTail, 'material planning must remain after already-deployed building-context migrations')
})

test('manual material planning persists the explicit 4B2a method version', async () => {
  const sql = await readFile(new URL('20260913210000_material_planning.sql', migrations), 'utf8')
  assert.match(sql, /method_version := '4B2a-v1'/, 'manual requirements must retain the 4B2a calculation contract version')
})

test('stock and reusable-component capacity checks serialize concurrent reservations', async () => {
  const sql = await readFile(new URL('20260913210300_material_planning_reservation_serialization.sql', migrations), 'utf8')
  assert.match(sql, /for update of s;/i, 'stock identity must be locked exclusively while capacity is rechecked')
  assert.match(sql, /for update of c;/i, 'component identity must be locked exclusively while capacity is rechecked')
  assert.doesNotMatch(sql, /for share of (s|c);/i, 'shared locks permit concurrent over-reservation races')
})

test('material browser proof scopes Shopping navigation to the page back link', async () => {
  const script = await readFile(new URL('../scripts/material-planning-browser.mjs', import.meta.url), 'utf8')
  assert.match(script, /locator\('a\.back-link'\).*\^Shopping\$/, 'desktop proof should target the local Shopping back link')
  assert.doesNotMatch(script, /getByRole\('link', \{ name: 'Shopping', exact: true \}\)/, 'desktop sidebar and page back link share the same accessible name')
})
