import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  PhysicalBuilding,
  PhysicalElement,
  PhysicalLevel,
  PhysicalRelationship,
  PhysicalSite,
  PhysicalSpace,
  ProjectPhysicalScope,
  SpaceProposal,
  ElementProposal,
  RelationshipProposal,
} from '../data/buildingContext'
import { scopeErrorMessage, unlinkResult } from '../lib/physicalScope'
import { userErrorMessage } from '../lib/userErrors'
import { physicalTruthLabel, type MeasuredRoom, type RoomMeasurementMap } from '../lib/roomMeasurements'
import type { RoomDimensionMap } from '../lib/roomDimensions'
import { BuildingContextEditor } from './BuildingContextEditor'
import { useRoomDimensions } from './RoomDimensions'
import { useRoomMeasurements } from './RoomMeasurements'
import { BuildingSharingCard } from './SharingCards'
import { inputStyle } from './form'
import { Loading } from './ui'

type Proposals = { spaces: SpaceProposal[]; elements: ElementProposal[]; relationships: RelationshipProposal[] }
const emptyProposals: Proposals = { spaces: [], elements: [], relationships: [] }

type NodeKind = 'level' | 'space' | 'element' | 'relationship'

type BuildingContextGateway = {
  sites(projectId: string): Promise<PhysicalSite[]>
  buildings(projectId: string): Promise<PhysicalBuilding[]>
  projectBuildings(projectId: string): Promise<PhysicalBuilding[]>
  levels(projectId: string, buildingId: string): Promise<PhysicalLevel[]>
  spaces(projectId: string, buildingId: string): Promise<PhysicalSpace[]>
  elements(projectId: string, buildingId: string): Promise<PhysicalElement[]>
  relationships(projectId: string, buildingId: string): Promise<PhysicalRelationship[]>
  proposals(projectId: string, buildingId: string): Promise<Proposals>
  measurements(projectId: string, rooms: MeasuredRoom[]): Promise<RoomMeasurementMap>
  dimensions(projectId: string, rooms: MeasuredRoom[]): Promise<RoomDimensionMap>
  canDirectEdit(projectId: string, buildingId: string): Promise<boolean>
  editSite(projectId: string, action: 'create', id: string, expected: number, data: Record<string, unknown>): Promise<unknown>
  editBuilding(projectId: string, action: 'create', id: string, expected: number, data: Record<string, unknown>): Promise<unknown>
  editNode(projectId: string, buildingId: string, kind: NodeKind, action: 'create', id: string, expected: number, data: Record<string, unknown>): Promise<unknown>
  scopes(projectId: string): Promise<ProjectPhysicalScope[]>
  editScope(projectId: string, kind: 'project', action: 'link' | 'unlink', id: string, data: Record<string, unknown>): Promise<unknown>
}

type Detail = {
  levels: PhysicalLevel[]
  spaces: PhysicalSpace[]
  elements: PhysicalElement[]
  relationships: PhysicalRelationship[]
  canDirectEdit: boolean
  proposals: Proposals
}

const emptyDetail: Detail = { levels: [], spaces: [], elements: [], relationships: [], canDirectEdit: false, proposals: emptyProposals }
const message = (error: unknown) => userErrorMessage(error)
const isDenied = (error: string) => /\bdenied\b|\bunauthori[sz]ed\b|\bforbidden\b|\bpermission\b|row[- ]level security|\brls\b/i.test(error)

export function BuildingContextSurface({ projectId, context, initialBuildingId }: { projectId: string; context: BuildingContextGateway; initialBuildingId?: string }) {
  const [version, setVersion] = useState(0)
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)
  const [sites, setSites] = useState<PhysicalSite[]>([])
  const [buildings, setBuildings] = useState<PhysicalBuilding[]>([])
  const [projectBuildings, setProjectBuildings] = useState<PhysicalBuilding[]>([])
  const [scopes, setScopes] = useState<ProjectPhysicalScope[]>([])
  const [detail, setDetail] = useState<Detail>(emptyDetail)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [rootError, setRootError] = useState('')
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    setSelectedBuildingId(null)
    setSites([])
    setBuildings([])
    setProjectBuildings([])
    setScopes([])
    setDetail(emptyDetail)
    setRootError('')
    setDetailError('')
  }, [context, projectId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setRootError('')
    Promise.all([
      context.sites(projectId),
      context.buildings(projectId),
      projectId ? context.projectBuildings(projectId) : Promise.resolve([]),
      projectId ? context.scopes(projectId) : Promise.resolve([]),
    ])
      .then(([nextSites, nextBuildings, scoped, nextScopes]) => {
        if (!alive) return
        if (initialBuildingId && (!nextBuildings.some(b => b.id === initialBuildingId)
          || (projectId && !scoped.some(b => b.id === initialBuildingId)))) {
          throw new Error('Requested building context is denied or no longer linked to this project.')
        }
        setSites(nextSites)
        setBuildings(nextBuildings)
        setProjectBuildings(scoped)
        setScopes(nextScopes)
        setSelectedBuildingId(current => {
          if (current && nextBuildings.some(building => building.id === current)) return current
          if (initialBuildingId && nextBuildings.some(building => building.id === initialBuildingId) && (!projectId || scoped.some(building => building.id === initialBuildingId))) return initialBuildingId
          return scoped[0]?.id ?? nextBuildings[0]?.id ?? null
        })
      })
      .catch(reason => {
        if (!alive) return
        setSites([])
        setBuildings([])
        setProjectBuildings([])
        setScopes([])
        setSelectedBuildingId(null)
        setDetail(emptyDetail)
        setRootError(message(reason))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [context, projectId, version, initialBuildingId])

  useEffect(() => {
    let alive = true
    setDetail(emptyDetail)
    setDetailError('')
    if (!selectedBuildingId) return () => { alive = false }
    setDetailLoading(true)
    Promise.all([
      context.levels(projectId, selectedBuildingId),
      context.spaces(projectId, selectedBuildingId),
      context.elements(projectId, selectedBuildingId),
      context.relationships(projectId, selectedBuildingId),
      context.canDirectEdit(projectId, selectedBuildingId),
      projectId ? context.proposals(projectId, selectedBuildingId) : Promise.resolve(emptyProposals),
    ]).then(([levels, spaces, elements, relationships, canDirectEdit, proposals]) => {
      if (alive) setDetail({ levels, spaces, elements, relationships, canDirectEdit, proposals })
    }).catch(reason => {
      if (alive) {
        setDetail(emptyDetail)
        setDetailError(message(reason))
      }
    }).finally(() => { if (alive) setDetailLoading(false) })
    return () => { alive = false }
  }, [context, projectId, selectedBuildingId, version])

  // One measurement read per Building, for the accepted revision of each listed room.
  const listedRooms = useMemo(() => detail.spaces.filter(space => !space.archived), [detail.spaces])
  const readMeasurements = useCallback((id: string, rooms: MeasuredRoom[]) => context.measurements(id, rooms), [context])
  const roomMeasurements = useRoomMeasurements(projectId, listedRooms, readMeasurements)
  // Room sizes are project dimensions: one read per Building, only inside a Project.
  const readDimensions = useCallback((id: string, rooms: MeasuredRoom[]) => context.dimensions(id, rooms), [context])
  const roomDimensions = useRoomDimensions(projectId, listedRooms, projectId ? readDimensions : null)

  if (loading && buildings.length === 0) return <Loading label="Loading building context…" />

  if (rootError) {
    const denied = isDenied(rootError)
    return <div className="card foundation-section" role="alert">
      <h3>{denied ? 'You can’t view this building context' : 'Building context is unavailable'}</h3>
      <p>{denied ? 'Your current project access does not include this physical context.' : rootError}</p>
      <p className="foundation-hint">Nothing has been invented or cached as physical truth.</p>
      {!denied && <button className="btn" type="button" onClick={() => setVersion(value => value + 1)}>Try again</button>}
    </div>
  }

  const refresh = () => setVersion(value => value + 1)
  // Room marks re-read only the scope, so the room list stays in place.
  const reloadScopes = async () => {
    try {
      const [nextScopes, nextProjectBuildings] = await Promise.all([context.scopes(projectId), context.projectBuildings(projectId)])
      setScopes(nextScopes)
      setProjectBuildings(nextProjectBuildings)
    } catch {
      throw new Error('Saved, but the room list could not be refreshed. Reload to see the current rooms.')
    }
  }
  const selectedBuilding = buildings.find(building => building.id === selectedBuildingId)
  const spaceNames = new Map([...detail.spaces, ...detail.proposals.spaces].map(s => [s.id, s.name]))
  const detailDenied = detailError ? isDenied(detailError) : false

  if (detailDenied && selectedBuildingId) return <>
    <div className="card foundation-section" role="alert">
      <h3>You can’t view {selectedBuilding?.name ?? 'this building'}</h3>
      <p>Your project may reference this building, but your current access does not permit its physical details to be read.</p>
      <p className="foundation-hint">No rooms, elements or relationships are shown as empty because their state could not be verified.</p>
      {buildings.length > 1 && <label style={{ display: 'block', maxWidth: 360, marginTop: 'var(--section-gap)' }}>
        <span className="foundation-hint" style={{ display: 'block', marginBottom: 4 }}>Choose another building</span>
        <select style={inputStyle} value={selectedBuildingId} onChange={event => setSelectedBuildingId(event.target.value)}>
          {buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
      </label>}
    </div>
  </>

  return <>
    {detailError && <div className="card foundation-section" role="alert" style={{ marginBottom: 'var(--section-gap)' }}>
      <strong>Could not load all details for {selectedBuilding?.name ?? 'this building'}.</strong>
      <p>{detailError}</p>
      <p className="foundation-hint">Physical details are hidden until they can be read back successfully.</p>
      <button className="btn" type="button" onClick={refresh}>Try again</button>
    </div>}
    {detailLoading && selectedBuildingId && <p className="foundation-hint" role="status">Refreshing {selectedBuilding?.name ?? 'building'}…</p>}
    {!detailError && <BuildingContextEditor
      sites={sites}
      buildings={buildings}
      projectBuildingIds={projectBuildings.map(building => building.id)}
      scopes={scopes}
      showProjectScope={Boolean(projectId)}
      detailLoading={detailLoading}
      sharing={selectedBuilding && detail.canDirectEdit && <BuildingSharingCard key={selectedBuilding.id} buildingId={selectedBuilding.id} buildingName={selectedBuilding.name} />}
      selectedBuildingId={selectedBuildingId}
      levels={detail.levels}
      spaces={detail.spaces}
      elements={detail.elements}
      relationships={detail.relationships}
      canDirectEdit={detail.canDirectEdit}
      roomMeasurements={roomMeasurements.load}
      onRetryMeasurements={roomMeasurements.retry}
      roomDimensions={projectId ? roomDimensions.load : undefined}
      onRetryDimensions={roomDimensions.retry}
      onSelectBuilding={setSelectedBuildingId}
      onCreateSite={async (id, data) => { await context.editSite(projectId, 'create', id, 0, data) }}
      onCreateBuilding={async (id, data) => {
        await context.editBuilding(projectId, 'create', id, 0, data)
        setSelectedBuildingId(id)
      }}
      onCreateNode={async (kind, id, data) => {
        if (!selectedBuildingId) throw new Error('Choose a building first.')
        await context.editNode(projectId, selectedBuildingId, kind, 'create', id, 0, data)
      }}
      onLinkProject={async (id, data) => {
        try { await context.editScope(projectId, 'project', 'link', id, data) }
        catch (reason) { throw new Error(scopeErrorMessage(reason, 'building')) }
      }}
      onToggleRoom={async (space, mark) => {
        try {
          if (mark) await context.editScope(projectId, 'project', 'unlink', mark.id, {})
          else await context.editScope(projectId, 'project', 'link', crypto.randomUUID(), { target_kind: 'space', building_id: space.buildingId, space_id: space.id })
        } catch (reason) { throw new Error(scopeErrorMessage(reason, 'room')) }
        await reloadScopes()
      }}
      onUnlinkProject={async scope => {
        try { return unlinkResult(await context.editScope(projectId, 'project', 'unlink', scope.id, {})) }
        catch (reason) { throw new Error(scopeErrorMessage(reason, 'building')) }
      }}
      onSaved={refresh}
    />}
    {!detailError && !detailLoading && projectId && (detail.proposals.spaces.length + detail.proposals.elements.length + detail.proposals.relationships.length > 0) &&
      <section className="card foundation-section" aria-label="Project proposals" style={{ overflowWrap: 'anywhere' }}>
        <h3>Project proposals · not current state</h3>
        <p>These are proposed changes for this project. They do not replace the accepted building context above.</p>
        {[...detail.proposals.spaces.map(p => ({ ...p, label: p.name, type: 'Space' })),
          ...detail.proposals.elements.map(p => ({ ...p, label: p.name, type: 'Element' })),
          ...detail.proposals.relationships.map(p => ({ ...p, label: `${p.relation.replace(/_/g, ' ')} · ${spaceNames.get(p.subjectSpaceId) ?? 'Unresolved space'} → ${spaceNames.get(p.objectSpaceId) ?? 'Unresolved space'}`, type: 'Relationship' })),
        ].map(p => <article className="fact-source" key={`${p.type}:${p.id}`}>
          <strong>{p.label}</strong><p>{p.type} · Proposed version {p.revision} · {physicalTruthLabel(p.truth)}</p>
          <p>{'description' in p ? p.description : p.notes}</p><p>Source: {p.source || 'Not recorded'}</p>
        </article>)}
      </section>}

  </>
}
