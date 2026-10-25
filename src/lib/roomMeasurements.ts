/*
 * Room measurements are immutable snapshots saved with one accepted room
 * revision. Only the revision a screen shows is current; older revisions keep
 * their own snapshots as history. Subjects stay verbatim: nothing here infers
 * what a measurement measures from its label.
 */
import type { PhysicalTruth, SpaceMeasurementSnapshot } from '../data/buildingContext'
import { TRUTH_LABELS, type MeasurementTruth } from '../data/projectFacts'

/** The accepted room revision whose measurements are wanted. */
export type MeasuredRoom = { id: string; revision: number }
/** Measurements keyed by exact room revision (see `measurementKey`). */
export type RoomMeasurementMap = Map<string, SpaceMeasurementSnapshot[]>

/** Rows shown before "Show all". */
export const MEASUREMENT_PREVIEW = 3

export const measurementKey = (room: MeasuredRoom) => `${room.id}@${room.revision}`

/** Human truth label; anything unrecognised stays Unknown rather than gaining certainty. */
export function physicalTruthLabel(truth: PhysicalTruth | string): string {
  if (truth === 'ai_assessment') return 'AI assessment'
  return TRUTH_LABELS[truth as MeasurementTruth] ?? 'Unknown'
}

/** Saved value and unit as recorded; a missing value is never filled in. */
export function measurementValue(item: Pick<SpaceMeasurementSnapshot, 'value' | 'unit'>): string {
  return item.value === null || item.value === '' ? 'Not measured yet' : `${item.value} ${item.unit}`.trim()
}

/** Rooms with a usable revision, once each. */
export function measuredRooms(rooms: MeasuredRoom[]): MeasuredRoom[] {
  const seen = new Set<string>()
  return rooms.filter(room => {
    const key = measurementKey(room)
    if (!room.id || !Number.isInteger(room.revision) || room.revision < 1 || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Group snapshots under each requested room revision, in the order read.
 * Every requested room gets an entry, so "no measurements" is a real answer;
 * snapshots of any other revision are dropped.
 */
export function currentRoomMeasurements(rooms: MeasuredRoom[], snapshots: SpaceMeasurementSnapshot[]): RoomMeasurementMap {
  const byRoom: RoomMeasurementMap = new Map(measuredRooms(rooms).map(room => [measurementKey(room), []]))
  const seen = new Set<string>()
  for (const item of snapshots) {
    const list = byRoom.get(measurementKey({ id: item.spaceId, revision: item.spaceRevision }))
    if (!list || seen.has(item.id)) continue
    seen.add(item.id)
    list.push(item)
  }
  return byRoom
}

/** PostgREST `or` filter for exact room revisions; values are quoted. */
export function roomRevisionFilter(rooms: MeasuredRoom[]): string {
  return measuredRooms(rooms)
    .map(room => `and(space_id.eq.${JSON.stringify(room.id)},space_revision.eq.${room.revision})`)
    .join(',')
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}
