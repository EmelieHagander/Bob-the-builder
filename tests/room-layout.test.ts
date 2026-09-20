import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roomLayoutParameters, roomLayoutGeometry, roomLayoutSvg, roomLayoutStale, withDerivedRoomLayout, type RoomLayoutParameters, type RoomLayoutDetails } from '../src/lib/roomLayout.ts'
import { storageBoxCutCsv } from '../src/lib/storageBox.ts'
import { parseProjectWrite, WRITE_TOOLS } from '../supabase/functions/_shared/project-write.ts'

const id = (n: number) => '60000000-0000-4000-8000-' + String(n).padStart(12, '0')
const box = { generator: 'storage_box_v1' as const, version: 1 as const, width_mm: 800, height_mm: 350, depth_mm: 600, thickness_mm: 18 }
const p: RoomLayoutParameters = { generator: 'room_pair_v1', version: 1, span_mm: 6120, depth_mm: 4000, wall_thickness_mm: 120,
  left_width_mm: 3400, furniture_room: 'left', anchor: 'shared_wall', gap_mm: 50, offset_mm: 200, rotation: 0 }
const d: RoomLayoutDetails = { project_id: 'A', artifact_id: id(1), artifact_revision: 1, building_id: id(2),
  left_space_id: id(3), left_space_revision: 1, right_space_id: id(4), right_space_revision: 1, wall_element_id: id(5), wall_element_revision: 1,
  furniture_artifact_id: id(6), furniture_revision: 1, instance_id: id(7), parameters: p, furniture_recipe: box,
  left_name: 'Children room', right_name: 'Office', wall_name: 'Shared wall', furniture_title: 'Storage box', furniture_area_id: null,
  current_left_revision: 1, current_right_revision: 1, current_wall_revision: 1, current_furniture_revision: 1,
  furniture_archived: false, physical_archived: false, physical_pending: false, context_available: true }
const create = { title: 'Linked plan', description: 'Two rooms', assumptions: 'Proposed values', create_area_id: null, target_revision: 1,
  building_id: id(2), left_space_id: id(3), left_space_revision: 1, right_space_id: id(4), right_space_revision: 1, wall_element_id: id(5), wall_element_revision: 1,
  furniture_artifact_id: id(6), furniture_revision: 1, parameters: p, measurements: [], change_note: 'User requested proposal', request_quote: 'Rita rummen' }
const edit = { record_id: id(1), expected_revision: 1, target_revision: 1, action: 'move_wall', left_width_mm: 3200,
  placement: null, source_revisions: null, change_note: 'Move wall 200 mm', request_quote: 'Flytta väggen' }

test('moving one shared wall updates both room views and anchored placement, not furniture construction or old versions', () => {
  const original = JSON.stringify(d), csv = storageBoxCutCsv(box), before = roomLayoutGeometry(p, box)
  const changed = { ...d, parameters: { ...p, left_width_mm: 3200 }, artifact_revision: 2 }
  const after = roomLayoutGeometry(changed.parameters, changed.furniture_recipe)
  assert.deepEqual([before.left.width,before.wall.width,before.right.width], [3400,120,2600])
  assert.deepEqual([after.left.width,after.wall.width,after.right.width], [3200,120,2800])
  assert.equal(after.left.width+after.wall.width+after.right.width, p.span_mm)
  assert.equal(after.furniture.x, before.furniture.x-200)
  assert.deepEqual(after.parts, before.parts); assert.equal(storageBoxCutCsv(box), csv)
  assert.equal(JSON.stringify(d), original)
  assert.match(roomLayoutSvg(changed,'left','Plan'), /Inside span 3200 mm/)
  assert.match(roomLayoutSvg(changed,'right','Plan'), /Inside span 2800 mm/)
  assert.match(roomLayoutSvg(d,'left','Plan'), /Inside span 3400 mm/)
})

test('moving and rotating the single instance changes placement only; an outline conflict never shrinks it', () => {
  for (const furniture_room of ['left','right'] as const) for (const anchor of ['shared_wall','outer_wall'] as const) for (const rotation of [0,90] as const) {
    const g=roomLayoutGeometry({...p,furniture_room,anchor,rotation},box)
    assert.equal(g.fit,'fits_outline_only'); assert.deepEqual(g.parts,roomLayoutGeometry(p,box).parts)
    assert.equal(g.furniture.width,rotation===0?800:600);assert.equal(g.furniture.depth,rotation===0?600:800)
  }
  const noFit=roomLayoutGeometry({...p,left_width_mm:750},box)
  assert.equal(noFit.fit,'outside_room');assert.equal(noFit.furniture.width,800);assert.equal(noFit.clearance.acrossMm,-100)
  assert.equal(roomLayoutGeometry({...p,offset_mm:3400},box).fit,'fits_outline_only')
  assert.equal(roomLayoutGeometry({...p,offset_mm:3400.001},box).fit,'outside_room')
})

test('fractional dimensions conserve the span without binary floating-point drift', () => {
  const g=roomLayoutGeometry({...p,span_mm:6120.007,left_width_mm:3400.003,wall_thickness_mm:120.002},box)
  assert.equal(g.right.width,2600.002);assert.equal(g.wall.x,3400.003)
  assert.equal(g.furniture.x,2550.003)
})

test('malformed, overprecise, impossible and unsupported topology parameters fail closed', () => {
  for (const bad of [null, [], { ...p, generator:'house' }, {...p, version:2}, {...p, right_width_mm:2600}, {...p,span_mm:0}, {...p,span_mm:3520},
    {...p,offset_mm:-1}, {...p,gap_mm:NaN}, {...p,rotation:45}, {...p,wall_thickness_mm:120.0001}, {...p,span_mm:'6120'}, {...p,depth_mm:50001}]) assert.throws(()=>roomLayoutParameters(bad))
})

test('source changes warn without adopting a newer recipe; unsupported and cross-project readbacks cannot be rendered', () => {
  assert(!roomLayoutStale(d)); assert(roomLayoutStale({...d,current_furniture_revision:2}))
  for (const change of [{current_left_revision:2},{physical_archived:true},{context_available:false},{furniture_archived:true}]) assert(roomLayoutStale({...d,...change}))
  const result=withDerivedRoomLayout({id:d.artifact_id,revision:1,room_layout:d},'A')
  assert.equal((result.derived_layout as any).fit,'fits_outline_only')
  assert.throws(()=>withDerivedRoomLayout({id:d.artifact_id,revision:2,room_layout:d},'A'))
  assert.throws(()=>withDerivedRoomLayout({id:d.artifact_id,revision:1,room_layout:d},'B'))
  assert.match(String(withDerivedRoomLayout({id:d.artifact_id,has_room_layout:true},'A').drawing_error),/unavailable/)
})

test('exports escape untrusted text and identify the exact plan/furniture versions, limits and outline conflict', () => {
  const dangerous={...d,left_name:'<script>bad</script>',parameters:{...p,left_width_mm:750}}
  const svg=roomLayoutSvg(dangerous,'overview','</text><script>bad</script>','Target decision 1')
  assert.doesNotMatch(svg,/<script>|NaN|Infinity/);assert.match(svg,/&lt;script&gt;/)
  assert.match(svg,/revision 1/);assert.match(svg,/drawing v1/);assert.match(svg,/DOES NOT FIT/);assert.match(svg,/NOT TO SCALE/)
  assert.match(svg,/Target decision 1/)
  assert.match(roomLayoutSvg(d,'overview','Plan','Target changed',true),/SOURCES CHANGED/)
})

test('Bob has explicit create/move/place/refresh tools; a wall request cannot smuggle in new furniture dimensions or authority', () => {
  assert(WRITE_TOOLS.some(t=>t.function.name==='create_project_room_layout'))
  const result=parseProjectWrite('create_project_room_layout',create,'A','Rita rummen')!
  assert.equal(result.kind,'room_layout');assert.equal(result.data.action,'create');assert.equal(result.data.area_id,null)
  assert.equal(result.record_id,null)
  const moved=parseProjectWrite('edit_project_room_layout',edit,'A','Flytta väggen')!
  assert.deepEqual(moved.data,{action:'move_wall',left_width_mm:3200,target_revision:1,change_note:'Move wall 200 mm'})
  for (const bad of [{...create,project_id:'B'},{...create,status:'build_ready'},{...create,parameters:{...p,furniture_width_mm:700}},
    {...create,wall_element_id:'invented'},{...create,left_space_revision:0},{...create,request_quote:'An older message'},
    {...create,measurements:[{id:id(1),revision:1},{id:id(1),revision:1}]}]) assert.equal(parseProjectWrite('create_project_room_layout',bad,'A','Rita rummen'),null)
  for (const bad of [{...edit,placement:{furniture_room:'left',anchor:'outer_wall',gap_mm:0,offset_mm:0,rotation:0}},
    {...edit,furniture_revision:2},{...edit,expected_revision:0},{...edit,source_revisions:{}},{...edit,left_width_mm:NaN}]) assert.equal(parseProjectWrite('edit_project_room_layout',bad,'A','Flytta väggen'),null)
})
