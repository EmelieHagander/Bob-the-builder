import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBuildingContext, type ProjectPhysicalScope } from '../src/data/buildingContext.ts'
import { areaRoomTargets, projectRoomMarks, scopeErrorMessage, unlinkResult, unlinkSummary, wholeBuildingLinks } from '../src/lib/physicalScope.ts'

// Rendered UI states (link gating, room toggles, unlink, Area rooms, project
// creation) are proven by scripts/check-project-rooms-browser.mjs.

const scope = (row: Partial<ProjectPhysicalScope>): ProjectPhysicalScope => ({
  id: 'scope', projectId: 'P', targetKind: 'building', siteId: null, buildingId: null, spaceId: null, elementId: null, ...row,
})
const house = { id: 'house', siteId: 'farm' }

test('a whole-building link comes from the building itself or its site, never from a room mark', () => {
  const scopes = [
    scope({ id: 'room', targetKind: 'space', buildingId: 'house', spaceId: 'kitchen' }),
    scope({ id: 'other', targetKind: 'building', buildingId: 'shed' }),
  ]
  assert.deepEqual(wholeBuildingLinks(scopes, house), [], 'A room-only mark does not cover the whole building')
  assert.deepEqual(wholeBuildingLinks([...scopes, scope({ id: 'b', buildingId: 'house' })], house).map(row => row.id), ['b'])
  assert.deepEqual(wholeBuildingLinks([scope({ id: 's', targetKind: 'site', siteId: 'farm' })], house).map(row => row.id), ['s'])
  assert.deepEqual(wholeBuildingLinks([scope({ id: 's', targetKind: 'site', siteId: 'farm' })], { id: 'house', siteId: null }), [])
  assert.deepEqual([...projectRoomMarks(scopes, 'house').keys()], ['kitchen'])
  assert.equal(projectRoomMarks(scopes, 'shed').size, 0)
})

test('Area room mappings are filtered by Area and target kind', () => {
  const targets = [
    { id: 't1', projectId: 'P', areaId: 'A1', targetKind: 'space' as const, buildingId: 'house', spaceId: 'kitchen', elementId: null },
    { id: 't2', projectId: 'P', areaId: 'A2', targetKind: 'space' as const, buildingId: 'house', spaceId: 'hall', elementId: null },
    { id: 't3', projectId: 'P', areaId: 'A1', targetKind: 'building' as const, buildingId: 'house', spaceId: null, elementId: null },
  ]
  assert.deepEqual(areaRoomTargets(targets, 'A1').map(row => row.id), ['t1'])
})

test('scope errors and unlink results use plain, honest copy', () => {
  assert.equal(scopeErrorMessage(new Error('building_denied'), 'building'), 'Only someone who can edit this building can link it to a project.')
  assert.match(scopeErrorMessage(new Error('building_denied'), 'room'), /no longer part of that building/)
  assert.equal(scopeErrorMessage(new Error('building_not_linked'), 'room'), 'Link the whole building to this project first.')
  assert.equal(scopeErrorMessage(new Error('project_denied'), 'room'), 'You no longer have access to this project.')
  assert.equal(scopeErrorMessage(new Error('Network down'), 'room'), 'Network down')
  assert.deepEqual(unlinkResult({ id: 'x', removed: true, removed_rooms: 2, removed_area_targets: 1 }), { removedRooms: 2, removedAreaTargets: 1 })
  assert.deepEqual(unlinkResult({ id: 'x', removed: true }), { removedRooms: 0, removedAreaTargets: 0 })
  assert.equal(unlinkSummary('Main house', { removedRooms: 2, removedAreaTargets: 1 }), 'Main house is no longer used by this project. Removed 2 room marks and 1 Area room.')
  assert.equal(unlinkSummary('Main house', { removedRooms: 0, removedAreaTargets: 0 }), 'Main house is no longer used by this project.')
})

const audit = { change_note: '', actor_label: 'Fixture', recorded_at: '2026-10-25T00:00:00Z', archived: false }
function fakeClient(rows: Record<string, unknown[]>, rpc: (name: string, params: Record<string, unknown>) => unknown) {
  const calls: { name: string; params: Record<string, unknown> }[] = []
  return {
    calls,
    client: {
      from(table: string) {
        const query = { select() { return query }, eq() { return query }, order() { return query }, limit() { return query },
          then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve) } }
        return query
      },
      async rpc(name: string, params: Record<string, unknown>) { calls.push({ name, params }); return { data: rpc(name, params), error: null } },
    } as any,
  }
}

test('Area rooms come only from buildings the project targets as a whole', async () => {
  const room = (id: string, building: string, archived = false) => ({ ...audit, id, building_id: building, project_id: 'P', revision: 1, name: id, kind: '', notes: '', truth: 'unknown', source: '', archived })
  const { client } = fakeClient({
    project_physical_scope: [
      { id: 's1', project_id: 'P', target_kind: 'building', building_id: 'house' },
      { id: 's2', project_id: 'P', target_kind: 'space', building_id: 'shed', space_id: 'bench' },
    ],
    project_buildings: [{ ...audit, id: 'house', project_id: 'P', revision: 1, name: 'House', notes: '' }, { ...audit, id: 'shed', project_id: 'P', revision: 1, name: 'Shed', notes: '' }],
    project_spaces: [room('kitchen', 'house'), room('old', 'house', true), room('bench', 'shed')],
    area_physical_targets: [{ id: 't1', project_id: 'P', area_id: 'A1', target_kind: 'space', building_id: 'house', space_id: 'kitchen' }],
  }, () => null)
  const guards: string[] = []
  const context = createBuildingContext(client, projectId => { guards.push(projectId); return () => {} })
  const result = await context.projectRoomScope('P')
  assert.deepEqual(result.buildings.map(item => item.id), ['house'], 'A room-only link does not offer the rest of that building')
  assert.deepEqual(result.rooms.map(item => item.id), ['kitchen', 'old'], 'Archived rooms stay readable for names')
  assert.equal(result.areaTargets[0].areaId, 'A1')
  assert(guards.every(id => id === 'P'))
})

test('a just-created project links by explicit id and only editable buildings are offered', async () => {
  const { client, calls } = fakeClient({
    current_buildings: [{ ...audit, id: 'mine', revision: 1, name: 'Mine', notes: '' }, { ...audit, id: 'theirs', revision: 1, name: 'Theirs', notes: '' }],
  }, (name, params) => name === 'can_edit_building' ? params.p_building === 'mine' : { id: params.p_record, target_kind: 'building' })
  const guards: string[] = []
  const context = createBuildingContext(client, projectId => { guards.push(projectId); return () => {} })
  assert.deepEqual((await context.editableBuildings('')).map(item => item.id), ['mine'])
  await context.linkCreatedProject('NEW', 'scope-1', 'mine')
  assert.deepEqual(calls.at(-1), { name: 'physical_scope_command', params: {
    p_project: 'NEW', p_kind: 'project', p_action: 'link', p_record: 'scope-1', p_data: { target_kind: 'building', building_id: 'mine' } } })
  assert.equal(guards.at(-1), '', 'The link uses the account guard, not the active-project selection')
  await assert.rejects(context.linkCreatedProject('', 'scope-2', 'mine'), /Choose a project/)
})
