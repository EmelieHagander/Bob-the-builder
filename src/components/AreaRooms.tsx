/*
 * Which rooms an Area covers. Only rooms of Buildings the Project targets as a
 * whole can be mapped; the guarded scope command enforces the same rule.
 */
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { PhysicalSpace } from '../data/buildingContext'
import type { Area } from '../data/types'
import { areaRoomTargets, scopeErrorMessage } from '../lib/physicalScope'
import { Field, FormError, inputStyle } from './form'
import { RoomDimensions, RoomReadsFailed, useRoomDimensions } from './RoomDimensions'
import { RoomMeasurements, useRoomMeasurements } from './RoomMeasurements'
import { Icon, List, ListItem, LoadFailed, Loading, Panel, useAsync } from './ui'

export function AreaRooms({ projectId, area }: { projectId: string; area: Area }) {
  const connected = db.authEnabled()
  const headingId = useId()
  const [version, setVersion] = useState(0)
  const { data, loading, error } = useAsync(
    () => connected && projectId ? db.buildingContext.projectRoomScope(projectId) : Promise.resolve(null),
    [connected, projectId, version],
  )
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const reload = () => setVersion(value => value + 1)
  // Mapped rooms' measurements: one read for the panel, at each room's current revision.
  const mappedRooms = useMemo(() => {
    if (!data) return []
    const ids = new Set(areaRoomTargets(data.areaTargets, area.id).map(target => target.spaceId))
    return data.rooms.filter(room => ids.has(room.id))
  }, [data, area.id])
  const measurements = useRoomMeasurements(projectId, mappedRooms, connected ? db.buildingContext.measurements : null)
  const dimensions = useRoomDimensions(projectId, mappedRooms, connected ? db.buildingContext.dimensions : null)

  async function run(action: () => Promise<unknown>, roomName: string) {
    setBusy(true); setActionError('')
    try { await action(); setChoice(''); reload() }
    catch (reason) { setActionError(`${roomName}: ${scopeErrorMessage(reason, 'room')}`) }
    finally { setBusy(false) }
  }

  const frame = (children: ReactNode) => <Panel as="section" className="area-rooms" aria-labelledby={headingId}>
    <h2 id={headingId}>Rooms</h2>
    {children}
  </Panel>

  if (!connected) return frame(<p className="foundation-hint">This demo does not save building rooms. Open a connected project to choose rooms.</p>)
  if (!data && loading) return frame(<Loading label="Loading rooms…" />)
  if (error || !data) return frame(<LoadFailed what="Rooms" onRetry={reload} />)

  if (!data.buildings.length) return frame(<>
    <p className="foundation-hint">This project has no building linked yet. Link one to choose the rooms this Area covers.</p>
    <Link className="btn" to="/building"><Icon name="house" size={16} /> Building &amp; spaces</Link>
  </>)

  const buildingNames = new Map(data.buildings.map(building => [building.id, building.name]))
  const roomsById = new Map(data.rooms.map(room => [room.id, room]))
  const several = data.buildings.length > 1
  const label = (room: PhysicalSpace) => several ? `${room.name} · ${buildingNames.get(room.buildingId) ?? 'Building'}` : room.name
  const mapped = areaRoomTargets(data.areaTargets, area.id)
  const mappedIds = new Set(mapped.map(target => target.spaceId))
  const projectRooms = new Set(data.scopes.filter(scope => scope.targetKind === 'space').map(scope => scope.spaceId))
  const current = data.rooms.filter(room => !room.archived)
  const available = current.filter(room => !mappedIds.has(room.id))
    .sort((a, b) => Number(projectRooms.has(b.id)) - Number(projectRooms.has(a.id)) || label(a).localeCompare(label(b)))
  const archived = Boolean(area.archivedAt)
  const idle = !busy && !loading

  const add = (event: FormEvent) => {
    event.preventDefault()
    const room = roomsById.get(choice)
    if (!room || !idle) return
    void run(() => db.buildingContext.editScope(projectId, 'area', 'link', crypto.randomUUID(), {
      area_id: area.id, target_kind: 'space', building_id: room.buildingId, space_id: room.id,
    }), room.name)
  }

  return frame(<>
    {mapped.length === 0
      ? <p className="foundation-hint">No rooms chosen for this Area yet.</p>
      : <>
        {mappedRooms.length > 0 && <RoomReadsFailed measurements={measurements.load} onRetryMeasurements={measurements.retry}
          dimensions={dimensions.load} onRetryDimensions={dimensions.retry} />}
        <List>{mapped.map(target => {
          const room = roomsById.get(target.spaceId ?? '')
          const name = room ? `${label(room)}${room.archived ? ' (archived)' : ''}` : 'Room no longer available'
          return <ListItem key={target.id}>
            <div className="area-room-row">
              <span>{name}</span>
              {!archived && <button type="button" className="btn btn-remove" disabled={!idle}
                aria-label={`Remove ${room?.name ?? 'room'} from this Area`}
                onClick={() => void run(() => db.buildingContext.editScope(projectId, 'area', 'unlink', target.id, {}), room?.name ?? 'Room')}>
                Remove
              </button>}
            </div>
            {room && <RoomDimensions room={room} roomName={room.name} load={dimensions.load} />}
            {room && <RoomMeasurements room={room} roomName={room.name} load={measurements.load} />}
          </ListItem>
        })}</List>
      </>}
    {archived
      ? <p className="foundation-hint">Restore the Area to change its rooms.</p>
      : current.length === 0
        ? <p className="foundation-hint">
          No rooms recorded in {data.buildings.map(building => building.name).join(', ')} yet.{' '}
          <Link className="project-detail-link" to={`/building?building=${encodeURIComponent(data.buildings[0].id)}`}>Add rooms</Link>
        </p>
        : available.length > 0 && <form className="area-room-add" onSubmit={add}>
          <Field label="Add a room">
            <select style={inputStyle} value={choice} disabled={!idle} onChange={event => setChoice(event.target.value)}>
              <option value="">Choose a room…</option>
              {available.map(room => <option key={room.id} value={room.id}>{label(room)}{projectRooms.has(room.id) ? ' (in project)' : ''}</option>)}
            </select>
          </Field>
          <button type="submit" className="btn btn-primary" disabled={!idle || !choice}>{busy ? 'Saving…' : 'Add'}</button>
        </form>}
    {loading && <p className="foundation-hint" role="status">Updating rooms…</p>}
    {actionError && <div role="alert"><FormError>{actionError}</FormError></div>}
  </>)
}
