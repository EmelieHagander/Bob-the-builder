/*
 * Human labels for codes that reach a screen: truth classes, record types,
 * categories, statuses and calculation terms. Screens show these labels or a
 * record's own name; never a raw code, UUID or internal path. An unknown code
 * gets a neutral label (or a plain-word rendering of the code), not the code.
 */
import { DOMAIN_TERMS } from '../domain/vocabulary'
import { TRUTH_LABELS } from '../data/projectFacts'
import type { TruthState } from '../data/provenance'

/** "sheet_goods" → "Sheet goods"; "wood.plywood" → "Plywood". Never returns the code itself. */
export function humanizeCode(code: string, fallback = 'Other'): string {
  const last = code.trim().split('.').pop() ?? ''
  const words = last.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!words || /^[0-9a-f]{8}\b/i.test(words)) return fallback
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

const pick = <T extends string>(table: Partial<Record<T, string>>, code: string | null | undefined, fallback: string) =>
  (code && Object.prototype.hasOwnProperty.call(table, code) ? table[code as T] : undefined) ?? fallback

/* ── Truth ── */
export const TRUTH_STATE_LABELS: Record<TruthState, string> = { ...TRUTH_LABELS, ai_assessment: 'Bob’s assessment' }
export const truthLabel = (truth: string | null | undefined) => pick(TRUTH_STATE_LABELS, truth, 'Unknown')

/* ── Project record types (Bob's evidence and saved changes) ── */
export const RECORD_TYPE_LABELS: Record<string, string> = {
  project: DOMAIN_TERMS.project.en, areas: DOMAIN_TERMS.area.en, tasks: DOMAIN_TERMS.task.en, plan: DOMAIN_TERMS.plan.en,
  materials: 'Shopping item', crew: 'Crew member', events: 'Build day', announcements: 'Announcement',
  measurements: 'Measurement', components: 'Existing part', solutions: 'Solution', target: 'Selected target',
  artifacts: 'Drawing', drawing: 'Drawing', requirements: DOMAIN_TERMS.material_requirement.en,
  physical_buildings: 'Building', building_context: 'Building', physical_levels: 'Floor', physical_spaces: DOMAIN_TERMS.space.en,
  physical_elements: 'Building part', physical_relationships: 'Space connection', physical_proposals: 'Proposed building change',
  physical_space_measurements: 'Space measurement', catalog: 'Catalog item', media: 'Image', image_pixels: 'Image',
  stock: 'Material stock', cut_plans: 'Cut plan',
}
export const recordTypeLabel = (dataset: string | null | undefined) => pick(RECORD_TYPE_LABELS, dataset, 'Project record')

/* ── Material categories (free text, or catalog/Bob codes) ── */
export const MATERIAL_CATEGORY_LABELS: Record<string, string> = {
  wood: 'Timber', timber: 'Timber', plastic: 'Plastic', metal: 'Metal', coating: 'Paint and coatings',
  sheet: 'Sheet material', sheet_goods: 'Sheet material', sheet_stock: 'Sheet material', panel: 'Panels',
  rectangular_profile: 'Timber and profiles', tube: 'Tubes and pipes', tube_stock: 'Tubes and pipes',
  fastener: 'Fasteners', fasteners: 'Fasteners', liquid: 'Liquids', 'plastic.pvc': 'PVC',
  'wood.plywood': 'Plywood', 'wood.softwood': 'Softwood', other: 'Other',
}
/** People's own category names stay as written; codes become labels. */
export function categoryLabel(category: string | null | undefined): string {
  const value = (category ?? '').trim()
  if (!value) return 'Other'
  const known = MATERIAL_CATEGORY_LABELS[value.toLowerCase()]
  if (known) return known
  return /^[a-z0-9]+(?:[_.-][a-z0-9]+)+$/.test(value) ? humanizeCode(value) : value
}

/* ── Drawings ── */
export const DRAWING_KIND_LABELS = { plan: 'Plan', elevation: 'Elevation', section: 'Section', detail: 'Detail' } as const
export const DRAWING_STATUS_LABELS = { concept: 'Concept', measured: 'Measured', build_ready: 'Build ready' } as const
const DRAWING_GENERATOR_LABELS: Record<string, string> = {
  stud_wall_opening_v1: 'Stud wall with an opening', storage_box_v1: 'Storage box', room_layout_v1: 'Room layout',
  multifloor_v1: 'Multi-floor study', stair_study_v1: 'Stair study',
}
export const drawingGeneratorLabel = (generator: string) => pick(DRAWING_GENERATOR_LABELS, generator, 'Drawing generator')
export const drawingStatusLabel = (status: string) => pick(DRAWING_STATUS_LABELS, status, humanizeCode(status, 'Status unknown'))
export const DRAWING_REQUEST_STATUS_LABELS: Record<string, string> = {
  collecting: 'Reading current sources', needs_data: 'Waiting for information', retrieval_failed: 'Source or service unavailable',
  ready_to_design: 'Ready for design', draft: 'Draft — not approved', reviewed: 'Reviewed — not saved', saved: 'Saved drawing',
  paused: 'Private context needs restoration', cancelled: 'Cancelled',
}
export const drawingRequestStatusLabel = (status: string) => pick(DRAWING_REQUEST_STATUS_LABELS, status, 'Status unavailable')

/* ── Material calculations ── */
const MATERIAL_METHOD_LABELS: Record<string, string> = {
  stud_wall_net_area: 'Net wall area from the drawing',
  stud_wall_sheet_layer: 'Sheet layers over the net wall area',
}
/**
 * The server-written calculation text of a deterministic requirement, with its
 * method and status codes named for people. It keeps the arithmetic and the
 * input-certainty sentence. Returns null when codes or IDs would remain
 * (construction/CAD blanks record UUIDs), so the screen shows a summary instead.
 */
export function readableMaterialBasis(basis: string, methodKey: string): string | null {
  const text = basis
    .replace(/\bstud_wall_net_area\s+v?[\w.-]+/g, 'the net wall area method')
    .replace(/\bstud_wall_sheet_layer\s+v?[\w.-]+/g, 'the sheet layer method')
    .replace(/Drawing status: ([a-z_]+)\./g, (_, status: string) => `Drawing status: ${drawingStatusLabel(status)}.`)
    .replace(/Product input: (provided_spec|measured|estimated);/g, (_, truth: string) => `Product input: ${truthLabel(truth).toLowerCase()};`)
  const leftover = /[0-9a-f]{8}-[0-9a-f]{4}-|\b[a-z]+_[a-z0-9_]+\b/i
  return methodKey.startsWith('construction_blank_') || methodKey.startsWith('cad_blank_') || leftover.test(text) ? null : text
}
export function materialMethodLabel(methodKey: string): string {
  if (MATERIAL_METHOD_LABELS[methodKey]) return MATERIAL_METHOD_LABELS[methodKey]
  if (methodKey.startsWith('construction_blank_')) return 'Blank sizes from the construction'
  if (methodKey.startsWith('cad_blank_')) return 'Blank sizes from the CAD drawing'
  return 'Calculated by bob'
}

/* ── CAD parameter sources ── */
export const CAD_SOURCE_KIND_LABELS = {
  project_measurement: 'Project measurement', space_measurement: 'Space measurement', drawing: 'Source drawing', target: 'Selected target', image: 'Image',
} as const
const CAD_OPERATION_LABELS: Record<string, string> = { add_v1: 'Sum', subtract_v1: 'Difference', multiply_v1: 'Product', divide_v1: 'Quotient' }
const CAD_ROUNDING_LABELS: Record<string, string> = { exact: 'exact', half_away_6: 'rounded to 6 decimals' }
const CAD_DIMENSIONS: Record<string, string> = {
  x_mm: 'width (x)', y_mm: 'depth (y)', z_mm: 'height (z)', x: 'position x', y: 'position y', z: 'position z',
  rx: 'rotation about x', ry: 'rotation about y', rz: 'rotation about z',
}
const CAD_COORDINATE_LABELS: Record<string, string> = {
  origin: 'Origin', positive_x: 'Positive X direction', positive_y: 'Positive Y direction', positive_z: 'Positive Z (up) direction',
}
export const cadOperationLabel = (operation: string | undefined) => pick(CAD_OPERATION_LABELS, operation, 'Calculation')
export const cadRoundingLabel = (rounding: string | undefined) => pick(CAD_ROUNDING_LABELS, rounding, 'rounding not recorded')
export const cadCoordinateLabel = (key: string) => pick(CAD_COORDINATE_LABELS, key, humanizeCode(key, 'Coordinate'))
/** Bob-authored identifiers ("wallHeight", "side_panel") as plain words. */
function identifierWords(id: string, fallback: string): string {
  const words = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_.:-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!words || /^[0-9a-f]{8}\b/i.test(words)) return fallback
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}
/** A named parameter ("wall_height") or, for untracked drawings, its recipe path. */
export function cadParameterLabel(id: string): string {
  return id.includes('/') ? cadPathLabel(id) : identifierWords(id, 'Parameter')
}
/** "definitions/side_panel/x_mm" → "Side panel · width (x)". */
export function cadPathLabel(path: string): string {
  const parts = path.split('/')
  const dimension = parts[parts.length - 1] ?? ''
  const subject = identifierWords(parts[1] ?? '', 'Part')
  return `${subject} · ${CAD_DIMENSIONS[dimension] ?? identifierWords(dimension, 'value').toLowerCase()}`
}
export function cadFrameSourceLabel(sourceRef: string): string {
  if (sourceRef.startsWith('image:')) return 'Project image'
  if (sourceRef.startsWith('parameter:')) return cadParameterLabel(sourceRef.slice('parameter:'.length))
  return 'Recorded source'
}
export const cadFrameKindLabel = (kind: string) => kind === 'image' ? 'Photo' : kind === 'room' ? 'Room' : 'Reference'
