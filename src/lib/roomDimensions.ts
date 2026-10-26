/*
 * A room's size as bob.project_room_dimensions reports it: per typed property
 * (and side/reference) the strongest-truth values saved on the room revision on
 * screen. Nothing here derives a missing value: unknown is said in words and a
 * conflict names every value. Owner definitions (2026-10-26): length is the
 * room's longest inside dimension, width the shortest, ceiling height applies
 * to the whole room; local heights carry a reference and are not the room's.
 */
import type { MeasurementProperty, MeasurementSide } from '../data/projectFacts'
import { measuredRooms, measurementKey, physicalTruthLabel, type MeasuredRoom } from './roomMeasurements'

export type DimensionStatus = 'known' | 'conflict' | 'unknown'
export interface RoomDimensionValue {
  snapshotId: string
  measurementId: string
  measurementRevision: number
  subject: string
  value: string | null
  unit: string
  millimetres: string | null
  truth: string
  source: string
}
export interface RoomDimension {
  spaceId: string
  spaceRevision: number
  property: MeasurementProperty
  side: MeasurementSide | null
  reference: string | null
  status: DimensionStatus
  /** The strongest truth present; null while unknown. */
  truth: string | null
  /** Set only when known. */
  millimetres: string | null
  /** The values at that truth (all of them for a conflict). */
  measurements: RoomDimensionValue[]
}
/** Dimensions keyed by exact room revision (`measurementKey`). */
export type RoomDimensionMap = Map<string, RoomDimension[]>

/** Rows of the requested room revisions only; a room without rows is outside the project. */
export function roomDimensionsByRoom(rooms: MeasuredRoom[], rows: RoomDimension[]): RoomDimensionMap {
  const wanted = new Set(measuredRooms(rooms).map(measurementKey))
  const byRoom: RoomDimensionMap = new Map()
  for (const row of rows) {
    const key = measurementKey({ id: row.spaceId, revision: row.spaceRevision })
    if (!wanted.has(key)) continue
    byRoom.set(key, [...byRoom.get(key) ?? [], row])
  }
  return byRoom
}

const ROOM_SIZE = ['room_length', 'room_width', 'ceiling_height'] as const
type RoomSizeProperty = typeof ROOM_SIZE[number]
const PART_NAMES: Record<RoomSizeProperty, string> = { room_length: 'length', room_width: 'width', ceiling_height: 'height' }

export interface RoomSizePart {
  property: RoomSizeProperty
  name: string
  status: DimensionStatus
  millimetres: string | null
  truth: string | null
}
export interface RoomSize {
  /** "3970 × 2700 mm · height 1920 mm"; unknown and conflicting parts are named. */
  text: string
  parts: RoomSizePart[]
  /** One label when every known part shares its truth; otherwise one per known part. */
  truths: string[]
  /** One sentence per conflicting part, naming each value. */
  conflicts: string[]
}

/** "1250.5" → "1250.5 mm". The database already normalised the unit. */
export const millimetreText = (millimetres: string) => `${millimetres} mm`

function listText(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** The room's own length, width and ceiling height (no side, no reference). */
export function roomSize(dimensions: RoomDimension[]): RoomSize {
  const parts = ROOM_SIZE.map((property): RoomSizePart => {
    const row = dimensions.find(item => item.property === property && item.side === null && item.reference === null)
    const status = row?.status === 'known' && row.millimetres ? 'known' : row?.status === 'conflict' ? 'conflict' : 'unknown'
    return { property, name: PART_NAMES[property], status, millimetres: status === 'known' ? row!.millimetres : null, truth: status === 'unknown' ? null : row!.truth }
  })
  const [length, width, height] = parts
  const phrase = (part: RoomSizePart) => part.status === 'known' ? `${part.name} ${millimetreText(part.millimetres!)}`
    : part.status === 'conflict' ? `${part.name} conflicting` : `${part.name} unknown`
  const floor = length.status === 'known' && width.status === 'known'
    ? `${length.millimetres} × ${millimetreText(width.millimetres!)}`
    : length.status === 'unknown' && width.status === 'unknown' ? 'length and width unknown'
      : `${phrase(length)}, ${phrase(width)}`
  const sentence = `${floor} · ${phrase(height)}`
  const known = parts.filter(part => part.status === 'known')
  const labels = [...new Set(known.map(part => physicalTruthLabel(part.truth ?? 'unknown')))]
  const truths = labels.length <= 1 ? labels : known.map(part => `${part.name.charAt(0).toUpperCase()}${part.name.slice(1)}: ${physicalTruthLabel(part.truth ?? 'unknown')}`)
  const conflicts = parts.filter(part => part.status === 'conflict').map(part => {
    const row = dimensions.find(item => item.property === part.property && item.side === null && item.reference === null)!
    const values = [...new Set(row.measurements.map(item => item.millimetres).filter((mm): mm is string => !!mm))].map(millimetreText)
    const name = `${part.name.charAt(0).toUpperCase()}${part.name.slice(1)}`
    return `${name}: different ${physicalTruthLabel(part.truth ?? 'unknown').toLowerCase()} values, ${listText(values)}. Check which is right.`
  })
  return { text: sentence.charAt(0).toUpperCase() + sentence.slice(1), parts, truths, conflicts }
}
