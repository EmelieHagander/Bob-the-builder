import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('building delete removes dependent physical identities before the building', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260913144500_building_delete_child_order.sql', import.meta.url), 'utf8')
  const statements = [
    'delete from bob.spatial_relationships where building_id=p_building;',
    'delete from bob.building_elements where building_id=p_building;',
    'delete from bob.building_spaces where building_id=p_building;',
    'delete from bob.building_levels where building_id=p_building;',
    'delete from bob.buildings where id=p_building;',
  ]
  const positions = statements.map(statement => sql.indexOf(statement))
  assert(positions.every(position => position >= 0), 'every dependency-order delete must be present')
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'children must be deleted before parents')
  assert.match(sql, /Archive building before deleting\./)
  assert.match(sql, /Building is still used by a project\./)
})
