import { exactObject, roomLayoutParameters, planMicrometres } from '../../../src/lib/roomLayout.ts'

const text = { type: 'string' }, number = { type: 'number' }, integer = { type: 'integer' }
const ref = { ...text, description: 'Exact existing canonical UUID from current project research. Never invent an identity.' }
const revision = { ...integer, description: 'Exact current revision read from the authorised source.' }
const measurements = { type: 'array', maxItems: 20, description: 'Exact relevant canonical measurement revisions. These are evidence, not automatic parameter bindings.',
  items: { type: 'object', additionalProperties: false, required: ['id', 'revision'], properties: { id: ref, revision } } }
const quote = { ...text, description: 'Exact 1–500 character quote from the CURRENT user request authorising this action.' }
const placement = {
  furniture_room: { type: 'string', enum: ['left', 'right'] }, anchor: { type: 'string', enum: ['shared_wall', 'outer_wall'] },
  gap_mm: { ...number, description: 'Nonnegative gap from the named wall face to the furniture footprint; not a fixing or safety assertion.' },
  offset_mm: { ...number, description: 'Nonnegative distance along the wall from the plan bottom edge to the footprint.' },
  rotation: { type: 'integer', enum: [0, 90], description: '0: furniture width across the room, depth along the wall. 90: swap footprint axes only, never change the construction.' },
}
const parameters = { generator: { type: 'string', enum: ['room_pair_v1'] }, version: { type: 'integer', enum: [1] },
  span_mm: { ...number, description: 'Fixed inside span across both rooms INCLUDING the shared wall thickness.' },
  depth_mm: { ...number, description: 'Common inside depth of the two rectangular rooms.' },
  wall_thickness_mm: number, left_width_mm: { ...number, description: 'Left room inside width. Right width is derived as span minus left width minus wall thickness.' }, ...placement }
function tool(name: string, description: string, properties: Record<string, unknown>) {
  return { type: 'function' as const, function: { name, description, parameters: {
    type: 'object', additionalProperties: false, properties, required: Object.keys(properties),
  } } }
}
export const ROOM_LAYOUT_TOOLS = [
  tool('create_project_room_layout', 'Create one proposed linked 2D plan: two existing canonical rooms on the same level, one existing wall, and one instance of an existing storage-box drawing. Read physical_spaces, physical_elements, target, measurements and artifacts first. Chosen plan dimensions are proposals, not measured building state. This does not create/accept physical rooms or walls. It saves all plan views atomically and returns an exact-revision drawing link. No arbitrary plan, extra furniture, door/ceiling or structural checks.', {
    title: text, description: text, assumptions: text, create_area_id: { type: ['string', 'null'] }, target_revision: revision,
    building_id: ref, left_space_id: ref, left_space_revision: revision, right_space_id: ref, right_space_revision: revision,
    wall_element_id: ref, wall_element_revision: revision, furniture_artifact_id: ref, furniture_revision: revision,
    parameters: { type: 'object', additionalProperties: false, properties: parameters, required: Object.keys(parameters) },
    measurements, change_note: text, request_quote: quote,
  }),
  tool('edit_project_room_layout', 'Edit a linked two-room drawing, not the actual building. Read the exact current drawing and its dependencies first. move_wall changes ONLY the left inside width: the fixed span and wall thickness derive both rooms; placement follows its named wall. place_furniture changes ONLY placement, never the furniture drawing or parts. refresh_sources is an explicit decision to adopt the read current source revisions and selected target, without changing parameter values. Report outside_room and stale/unavailable sources; never call an outline check safe/build-ready. All unused change fields MUST be null.', {
    record_id: ref, expected_revision: revision, target_revision: revision,
    action: { type: 'string', enum: ['move_wall', 'place_furniture', 'refresh_sources'] },
    left_width_mm: { type: ['number', 'null'] },
    placement: { type: ['object', 'null'], additionalProperties: false, properties: placement, required: Object.keys(placement) },
    source_revisions: { type: ['object', 'null'], additionalProperties: false,
      properties: { left_space_revision: revision, right_space_revision: revision, wall_element_revision: revision, furniture_revision: revision, measurements },
      required: ['left_space_revision', 'right_space_revision', 'wall_element_revision', 'furniture_revision', 'measurements'] },
    change_note: text, request_quote: quote,
  }),
]
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
const rev = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0
const string = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const revisions = ['left_space_revision', 'right_space_revision', 'wall_element_revision', 'furniture_revision']
function validMeasurements(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 20) return false
  const seen = new Set<string>()
  return value.every(m => {
    if (!exactObject(m, ['id', 'revision']) || !uuid(m.id) || !rev(m.revision) || seen.has(m.id.toLowerCase())) return false
    seen.add(m.id.toLowerCase()); return true
  })
}
export function parseRoomLayoutWrite(name: string, v: Record<string, unknown>) {
  const definition = ROOM_LAYOUT_TOOLS.find(t => t.function.name === name)
  if (!definition || !exactObject(v, definition.function.parameters.required)
    || !rev(v.target_revision) || !string(v.change_note, 1000) || !string(v.request_quote, 500)) return null
  const base = { kind: 'room_layout' as const, record_id: null as string | null, expected_revision: 0,
    expected_updated_at: null, request_quote: v.request_quote as string }
  if (name === 'create_project_room_layout') {
    if (!string(v.title, 200) || !string(v.description, 6000) || !string(v.assumptions, 3500)
      || (v.create_area_id !== null && !string(v.create_area_id, 200)) || !validMeasurements(v.measurements)
      || !['building_id', 'left_space_id', 'right_space_id', 'wall_element_id', 'furniture_artifact_id'].every(k => uuid(v[k]))
      || v.left_space_id === v.right_space_id || !revisions.every(k => rev(v[k]))) return null
    try {
      const p = roomLayoutParameters(v.parameters)
      const { create_area_id, request_quote: _quote, ...data } = v
      return { ...base, data: { ...data, parameters: p, area_id: create_area_id, action: 'create' } }
    } catch { return null }
  }
  if (!uuid(v.record_id) || !rev(v.expected_revision)) return null
  const data: Record<string, unknown> = { action: v.action, target_revision: v.target_revision, change_note: v.change_note }
  try {
    if (v.action === 'move_wall') {
      if (v.placement !== null || v.source_revisions !== null) return null
      planMicrometres(v.left_width_mm); data.left_width_mm = v.left_width_mm
    } else if (v.action === 'place_furniture') {
      if (v.left_width_mm !== null || v.source_revisions !== null || !exactObject(v.placement, Object.keys(placement))) return null
      const p = v.placement
      if (!['left', 'right'].includes(String(p.furniture_room)) || !['shared_wall', 'outer_wall'].includes(String(p.anchor)) || ![0, 90].includes(p.rotation as number)) return null
      planMicrometres(p.gap_mm, true); planMicrometres(p.offset_mm, true); Object.assign(data, p)
    } else if (v.action === 'refresh_sources') {
      if (v.left_width_mm !== null || v.placement !== null || !exactObject(v.source_revisions, [...revisions, 'measurements'])) return null
      const s = v.source_revisions
      if (!revisions.every(k => rev(s[k])) || !validMeasurements(s.measurements)) return null
      Object.assign(data, s)
    } else return null
    return { ...base, record_id: v.record_id, expected_revision: Number(v.expected_revision), data }
  } catch { return null }
}
