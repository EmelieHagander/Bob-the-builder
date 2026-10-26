/*
 * A room's size in one line ("3970 × 2700 mm · height 1920 mm") with its truth,
 * read from the project's room dimensions for the room revision on screen.
 * Unknown parts are named, conflicting values are all shown, nothing is
 * derived. Rooms outside the project's scope show no size. Callers read once
 * per list (`useRoomDimensions`), never once per room.
 */
import type { MeasuredRoom } from '../lib/roomMeasurements'
import { measurementKey } from '../lib/roomMeasurements'
import { roomSize, type RoomDimensionMap } from '../lib/roomDimensions'
import { RoomMeasurementsFailed, useRoomRead, type RoomMeasurementsLoad, type RoomReadLoad } from './RoomMeasurements'

export type RoomDimensionsLoad = RoomReadLoad<RoomDimensionMap>

export const useRoomDimensions = (projectId: string, rooms: MeasuredRoom[], read: ((projectId: string, rooms: MeasuredRoom[]) => Promise<RoomDimensionMap>) | null) =>
  useRoomRead(projectId, rooms, read, () => new Map())

export function RoomDimensions({ room, roomName, load }: { room: MeasuredRoom; roomName: string; load: RoomDimensionsLoad }) {
  // The measurement list below shows the page's loading state.
  if (load.status === 'loading') return null
  if (load.status === 'failed') return <p className="room-dimensions room-measurements-note">Room size not loaded.</p>
  const dimensions = load.byRoom.get(measurementKey(room))
  if (!dimensions) return null
  const size = roomSize(dimensions)
  return <div className="room-dimensions" role="group" aria-label={`${roomName} size`}>
    <p className="room-dimensions-size">{size.text}</p>
    {size.truths.length > 0 && <p className="room-dimensions-truth">{size.truths.map(label => <span key={label} className="image-purpose">{label}</span>)}</p>}
    {size.conflicts.map(text => <p key={text} className="room-dimensions-conflict" role="note">{text}</p>)}
  </div>
}

/** One alert for the page's room reads: measurements first, then sizes; Retry repeats what failed. */
export function RoomReadsFailed({ measurements, onRetryMeasurements, dimensions, onRetryDimensions }: {
  measurements?: RoomMeasurementsLoad; onRetryMeasurements?: () => void
  dimensions?: RoomDimensionsLoad; onRetryDimensions?: () => void
}) {
  const sizesFailed = dimensions?.status === 'failed' && !!onRetryDimensions
  if (measurements?.status === 'failed' && onRetryMeasurements) return <RoomMeasurementsFailed onRetry={() => {
    onRetryMeasurements()
    if (sizesFailed) onRetryDimensions!()
  }} />
  if (sizesFailed) return <RoomMeasurementsFailed message="Room sizes could not be loaded. Rooms are listed without them." onRetry={onRetryDimensions!} />
  return null
}
