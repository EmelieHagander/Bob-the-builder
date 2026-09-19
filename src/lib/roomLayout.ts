import { storageBoxGeometry, type StorageBoxRecipe, type BoxPart } from './storageBox.ts'

/** A deliberately bounded proposed plan, NOT a second physical building model.
 * Canonical room/wall identities live in the persisted source bindings. Two
 * rectangular rooms share one wall and a fixed outer span. Local x points right,
 * y away from the bottom edge; neither is a surveyed house coordinate or north.
 */
export interface RoomLayoutParameters {
  generator: 'room_pair_v1'
  version: 1
  span_mm: number
  depth_mm: number
  wall_thickness_mm: number
  left_width_mm: number
  furniture_room: 'left' | 'right'
  anchor: 'shared_wall' | 'outer_wall'
  gap_mm: number
  offset_mm: number
  rotation: 0 | 90
}
export interface PlanRectangle { x: number; y: number; width: number; depth: number }
export interface RoomLayoutGeometry {
  parameters: RoomLayoutParameters
  left: PlanRectangle
  right: PlanRectangle
  wall: PlanRectangle
  furniture: PlanRectangle
  fit: 'fits_outline_only' | 'outside_room'
  clearance: { acrossMm: number; alongMm: number }
  parts: BoxPart[]
}
export const ROOM_LAYOUT_LIMITS = 'Proposed rectangular plan only. No doors, windows, services, wall structure, circulation, ceiling or safety check. Moving this drawn wall does not approve or record physical building work. Furniture size is pinned to its own drawing revision; it is never resized to fit.'
const KEYS = ['generator', 'version', 'span_mm', 'depth_mm', 'wall_thickness_mm', 'left_width_mm', 'furniture_room', 'anchor', 'gap_mm', 'offset_mm', 'rotation']
export function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(value, k))
}
export function planMicrometres(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (allowZero ? 0 : 0.001) || value > 50000
    || !/^\d+(?:\.\d{1,3})?$/.test(String(value))) throw new Error('Plan dimensions must be millimetres, at most 50000, with at most three decimals.')
  return Math.round(value * 1000)
}
export function roomLayoutParameters(value: unknown): RoomLayoutParameters {
  if (!exactObject(value, KEYS) || value.generator !== 'room_pair_v1' || value.version !== 1
    || !['left', 'right'].includes(String(value.furniture_room)) || !['shared_wall', 'outer_wall'].includes(String(value.anchor))
    || ![0, 90].includes(value.rotation as number)) throw new Error('Unsupported room layout recipe.')
  const span = planMicrometres(value.span_mm), wall = planMicrometres(value.wall_thickness_mm)
  const left = planMicrometres(value.left_width_mm)
  planMicrometres(value.depth_mm); planMicrometres(value.gap_mm, true); planMicrometres(value.offset_mm, true)
  if (span <= left + wall) throw new Error('Both rooms must have positive inside widths within the fixed span.')
  return { ...value } as unknown as RoomLayoutParameters
}
export function roomLayoutGeometry(value: unknown, furnitureRecipe: unknown): RoomLayoutGeometry {
  const p = roomLayoutParameters(value), box = storageBoxGeometry(furnitureRecipe)
  const span = planMicrometres(p.span_mm), leftWidth = planMicrometres(p.left_width_mm)
  const wallWidth = planMicrometres(p.wall_thickness_mm), depth = planMicrometres(p.depth_mm)
  const width = planMicrometres(p.rotation === 0 ? box.recipe.width_mm : box.recipe.depth_mm)
  const length = planMicrometres(p.rotation === 0 ? box.recipe.depth_mm : box.recipe.width_mm)
  const gap = planMicrometres(p.gap_mm, true), offset = planMicrometres(p.offset_mm, true)
  const origin = p.furniture_room === 'left' ? 0 : leftWidth + wallWidth
  const roomWidth = p.furniture_room === 'left' ? leftWidth : span - leftWidth - wallWidth
  const againstRightFace = p.furniture_room === 'left' ? p.anchor === 'shared_wall' : p.anchor === 'outer_wall'
  const x = againstRightFace ? origin + roomWidth - gap - width : origin + gap
  const rect = (x: number, y: number, w: number, d: number): PlanRectangle => ({ x: x / 1000, y: y / 1000, width: w / 1000, depth: d / 1000 })
  return { parameters: p, left: rect(0, 0, leftWidth, depth), right: rect(leftWidth + wallWidth, 0, span - leftWidth - wallWidth, depth),
    wall: rect(leftWidth, 0, wallWidth, depth), furniture: rect(x, offset, width, length),
    fit: gap + width <= roomWidth && offset + length <= depth ? 'fits_outline_only' : 'outside_room',
    clearance: { acrossMm: (roomWidth - gap - width) / 1000, alongMm: (depth - offset - length) / 1000 }, parts: box.parts }
}

/** Source links are immutable identities; refresh may adopt new revisions, never
 * silently replace a room, wall, furniture drawing or the single placed instance. */
export interface RoomLayoutDetails {
  project_id: string
  artifact_id: string
  artifact_revision: number
  building_id: string
  left_space_id: string
  left_space_revision: number
  right_space_id: string
  right_space_revision: number
  wall_element_id: string
  wall_element_revision: number
  furniture_artifact_id: string
  furniture_revision: number
  instance_id: string
  parameters: RoomLayoutParameters
  furniture_recipe: StorageBoxRecipe
  left_name: string
  right_name: string
  wall_name: string
  furniture_title: string
  furniture_area_id: string | null
  current_left_revision: number
  current_right_revision: number
  current_wall_revision: number
  current_furniture_revision: number
  furniture_archived: boolean
  physical_archived: boolean
  physical_pending: boolean
  context_available: boolean
}
export function roomLayoutStale(d: RoomLayoutDetails): boolean {
  return !d.context_available || d.physical_archived || d.furniture_archived
    || d.left_space_revision !== d.current_left_revision || d.right_space_revision !== d.current_right_revision
    || d.wall_element_revision !== d.current_wall_revision || d.furniture_revision !== d.current_furniture_revision
}
export type RoomLayoutView = 'overview' | 'left' | 'right'
const xml = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const fmt = (v: number) => String(Number(v.toFixed(3)))

/** No provider markup is rendered. Labels are escaped and geometry is computed. */
export function roomLayoutSvg(d: RoomLayoutDetails, view: RoomLayoutView, title: string, source = '', lineageChanged = false): string {
  if (!['overview', 'left', 'right'].includes(view)) throw new Error('Unknown room view.')
  const g = roomLayoutGeometry(d.parameters, d.furniture_recipe)
  const room = view === 'overview' ? { x: 0, y: 0, width: g.parameters.span_mm, depth: g.parameters.depth_mm } : g[view]
  const scale = Math.min(720 / room.width, 380 / room.depth)
  const ox = (960 - room.width * scale) / 2, oy = 200 + (380 - room.depth * scale) / 2
  const x = (v: number) => ox + (v - room.x) * scale, y = (v: number) => oy + (room.depth - v) * scale
  const text = (a: number, b: number, t: unknown, extra = '') => `<text x="${fmt(a)}" y="${fmt(b)}" ${extra}>${xml(t)}</text>`
  const rect = (r: PlanRectangle, fill: string, extra = '') => `<rect x="${fmt(x(r.x))}" y="${fmt(y(r.y + r.depth))}" width="${fmt(r.width * scale)}" height="${fmt(r.depth * scale)}" fill="${fill}" stroke="#222" stroke-width="1.6" ${extra}/>`
  const dim = (a: number, b: number, yy: number, label: string) => `<path d="M${fmt(a)},${fmt(yy - 6)}v12 M${fmt(a)},${fmt(yy)}H${fmt(b)} M${fmt(b)},${fmt(yy - 6)}v12" fill="none" stroke="#222"/>${text((a+b)/2, yy-10, label, 'text-anchor="middle"')}`
  const labels = (r: PlanRectangle, name: string) => text(x(r.x + r.width / 2), oy - 18, name.slice(0, 38), 'text-anchor="middle" font-size="18"')
  let drawing = ''
  if (view === 'overview') drawing = rect(g.left, '#fafafa') + rect(g.right, '#fafafa') + rect(g.wall, '#ccc')
    + labels(g.left, d.left_name) + labels(g.right, d.right_name)
    + dim(x(0), x(g.left.width), oy + room.depth * scale + 34, `${fmt(g.left.width)} mm`)
    + dim(x(g.right.x), x(g.parameters.span_mm), oy + room.depth * scale + 34, `${fmt(g.right.width)} mm`)
  else drawing = rect(room, '#fafafa') + labels(room, view === 'left' ? d.left_name : d.right_name)
  // Keep out-of-room geometry visible in the overview, clipped only to the sheet.
  // Never hide a conflict merely because the chosen room view crops it.
  if (view === 'overview' || view === d.parameters.furniture_room) {
    drawing += rect(g.furniture, g.fit === 'outside_room' ? '#eee' : '#e6e6e6', g.fit === 'outside_room' ? 'stroke-dasharray="8 4"' : '')
      + text(x(g.furniture.x + g.furniture.width / 2), y(g.furniture.y + g.furniture.depth / 2), 'F1', 'text-anchor="middle" font-weight="bold"')
  }
  const name = view === 'overview' ? 'Two-room plan' : view === 'left' ? d.left_name : d.right_name
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="800" viewBox="0 0 960 800" role="img" aria-label="${xml(`${name} · proposed linked plan`)}">
<title>${xml(title)} · ${xml(name)}</title><desc>${xml(ROOM_LAYOUT_LIMITS)}</desc><rect width="960" height="800" fill="white"/>
<g fill="#222" font-family="Arial,sans-serif" font-size="17">
${text(30, 36, title.slice(0, 65), 'font-size="23" font-weight="bold"')}${text(30, 64, `${name} · revision ${d.artifact_revision} · Concept`)}
${text(30, 94, (roomLayoutStale(d) || lineageChanged) ? 'SOURCES CHANGED — saved geometry retained; review before reuse' : 'Proposed dimensions — not measured building state', 'font-size="15"')}
${text(30, 117, source.slice(0, 110), 'font-size="13"')}
${dim(ox, ox+room.width*scale, 150, `Inside span ${fmt(room.width)} mm`)}${drawing}
${text(30, 647, `Depth ${fmt(room.depth)} mm · shared wall ${fmt(g.wall.width)} mm · F1 ${fmt(g.furniture.width)} × ${fmt(g.furniture.depth)} mm`)}
${text(30, 678, `F1: ${d.furniture_title.slice(0, 42)} · drawing v${d.furniture_revision} · one instance`, 'font-size="15"')}
${text(30, 708, g.fit === 'outside_room' ? 'DOES NOT FIT this room outline — furniture dimensions have NOT been changed' : 'Inside outline only — openings, circulation and height are not checked', 'font-size="15" font-weight="bold"')}
${text(30, 739, 'All dimensions in mm · NOT TO SCALE · Local coordinates, not a surveyed house plan', 'font-size="14"')}
${text(30, 769, `${d.artifact_id} · room_pair_v1 / 1`, 'font-size="12"')}</g></svg>`
}

export function checkedRoomLayout(value: unknown, projectId: string, artifactId: string, revision: number): RoomLayoutDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Room layout sources unavailable.')
  const d = value as RoomLayoutDetails
  if (d.project_id !== projectId || d.artifact_id !== artifactId || d.artifact_revision !== revision
    || !['building_id', 'left_space_id', 'right_space_id', 'wall_element_id', 'furniture_artifact_id', 'instance_id'].every(k =>
      typeof d[k as keyof RoomLayoutDetails] === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(d[k as keyof RoomLayoutDetails])))
    || !['left_space_revision', 'right_space_revision', 'wall_element_revision', 'furniture_revision', 'current_left_revision', 'current_right_revision', 'current_wall_revision', 'current_furniture_revision'].every(k =>
      Number.isSafeInteger(d[k as keyof RoomLayoutDetails]) && Number(d[k as keyof RoomLayoutDetails]) > 0)
    || !['left_name', 'right_name', 'wall_name', 'furniture_title'].every(k => typeof d[k as keyof RoomLayoutDetails] === 'string')
    || !['furniture_archived', 'physical_archived', 'physical_pending', 'context_available'].every(k => typeof d[k as keyof RoomLayoutDetails] === 'boolean')
    || (d.furniture_area_id !== null && typeof d.furniture_area_id !== 'string')) throw new Error('Room layout source identity or revision mismatch.')
  roomLayoutGeometry(d.parameters, d.furniture_recipe)
  return d
}
export function withDerivedRoomLayout<T extends Record<string, unknown>>(record: T, projectId: string): T & Record<string, unknown> {
  if (!record.room_layout) return record.has_room_layout ? { ...record, drawing_error: 'Linked room layout sources unavailable. Do not invent a replacement.' } : record
  const d = checkedRoomLayout(record.room_layout, projectId, String(record.id), Number(record.revision))
  const g = roomLayoutGeometry(d.parameters, d.furniture_recipe)
  return { ...record, derived_layout: { truth: 'provided_spec', unit: 'mm', left: g.left, right: g.right, wall: g.wall,
    furniture: g.furniture, fit: g.fit, clearance: g.clearance, sources_changed: roomLayoutStale(d),
    furniture_drawing_revision: d.furniture_revision, furniture_parts: g.parts, limits: ROOM_LAYOUT_LIMITS } }
}
