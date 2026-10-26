/*
 * A room's saved measurements, read from the snapshots of the room revision
 * on screen. Labels stay verbatim and each truth class stays visible; the
 * source is one tap away. Measurements that say what they measure come first,
 * with that shown under their label. Callers read once per list
 * (`useRoomMeasurements`), never once per room.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { SpaceMeasurementSnapshot } from '../data/buildingContext'
import { measurementPropertyLabel } from '../lib/labels'
import {
  MEASUREMENT_PREVIEW, measuredRooms, measurementKey, measurementValue, physicalTruthLabel,
  type MeasuredRoom, type RoomMeasurementMap,
} from '../lib/roomMeasurements'
import { Icon } from './ui'

/** One list-level read for every room on screen. */
export type RoomReadLoad<T> =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; byRoom: T }
export type RoomMeasurementsLoad = RoomReadLoad<RoomMeasurementMap>

type Read<T> = (projectId: string, rooms: MeasuredRoom[]) => Promise<T>

/** One read for every listed room; re-reads only when a room or its revision changes. */
export function useRoomRead<T>(projectId: string, rooms: MeasuredRoom[], read: Read<T> | null, empty: () => T) {
  const wanted = measuredRooms(rooms)
  const key = wanted.map(measurementKey).sort().join('|')
  const [version, setVersion] = useState(0)
  const [load, setLoad] = useState<RoomReadLoad<T>>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    if (!read || !wanted.length) { setLoad({ status: 'ready', byRoom: empty() }); return () => { alive = false } }
    setLoad({ status: 'loading' })
    read(projectId, wanted)
      .then(byRoom => { if (alive) setLoad({ status: 'ready', byRoom }) })
      .catch(() => { if (alive) setLoad({ status: 'failed' }) })
    return () => { alive = false }
    // `key` identifies the rooms and revisions; the array itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, key, read, version])
  return { load, retry: () => setVersion(value => value + 1) }
}

export const useRoomMeasurements = (projectId: string, rooms: MeasuredRoom[], read: Read<RoomMeasurementMap> | null) =>
  useRoomRead(projectId, rooms, read, () => new Map())

/** A list-level read failed: say so once, keep the rooms, offer a retry. */
export function RoomMeasurementsFailed({ onRetry, message = 'Room measurements could not be loaded. Rooms are listed without them.' }: { onRetry: () => void; message?: string }) {
  return <div className="ui-form-error room-measurements-failed" role="alert">
    <span>{message}</span>
    <button type="button" className="btn" onClick={onRetry}><Icon name="arrow-clockwise" size={15} /> Retry</button>
  </div>
}

export function RoomMeasurements({ room, roomName, load }: { room: MeasuredRoom; roomName: string; load: RoomMeasurementsLoad }) {
  const listId = useId()
  const [all, setAll] = useState(false)
  // A room missing from the read (e.g. a newer revision) is still loading, never empty.
  const items = load.status === 'ready' ? load.byRoom.get(measurementKey(room)) : undefined
  const frame = (children: ReactNode) => <div className="room-measurements" role="group" aria-label={`${roomName} measurements`}>{children}</div>

  if (load.status === 'failed') return frame(<p className="room-measurements-note">Measurements not loaded.</p>)
  if (!items) return frame(<p className="room-measurements-note">Loading measurements…</p>)
  if (!items.length) return frame(<p className="room-measurements-note">No measurements saved for this room yet.</p>)

  const shown = all ? items : items.slice(0, MEASUREMENT_PREVIEW)
  return frame(<>
    <p className="room-measurements-title">Measurements <span>· {items.length}</span></p>
    <ul className="room-measurement-list" id={listId}>
      {shown.map(item => <li key={item.id}><MeasurementRow item={item} /></li>)}
    </ul>
    {items.length > MEASUREMENT_PREVIEW && <button type="button" className="btn room-measurements-more"
      aria-expanded={all} aria-controls={listId} onClick={() => setAll(value => !value)}>
      {all ? 'Show fewer' : `Show all ${items.length} measurements`}
    </button>}
  </>)
}

function MeasurementRow({ item }: { item: SpaceMeasurementSnapshot }) {
  const measures = measurementPropertyLabel(item)
  return <details className="room-measurement">
    <summary>
      <span className="room-measurement-subject"><span>{item.subject}</span>{measures && <span className="room-measurement-property">{measures}</span>}</span>
      <span className="room-measurement-value">{measurementValue(item)}</span>
      <span className="room-measurement-truth">{physicalTruthLabel(item.truth)}</span>
    </summary>
    <div className="room-measurement-source">
      <p>Source: {item.source.trim() || 'not recorded'}</p>
      <p>Measurement version {item.measurementRevision}</p>
    </div>
  </details>
}
