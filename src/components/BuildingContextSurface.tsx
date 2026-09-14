import { useEffect, useState } from 'react'
import type {
  PhysicalBuilding,
  PhysicalElement,
  PhysicalLevel,
  PhysicalRelationship,
  PhysicalSite,
  PhysicalSpace,
} from '../data/buildingContext'
import { BuildingContextEditor } from './BuildingContextEditor'
import { BuildingSharingCard } from './SharingCards'
import { inputStyle } from './form'
import { Loading } from './ui'

type NodeKind = 'level' | 'space' | 'element' | 'relationship'

type BuildingContextGateway = {
  sites(projectId: string): Promise<PhysicalSite[]>
  buildings(projectId: string): Promise<PhysicalBuilding[]>
  projectBuildings(projectId: string): Promise<PhysicalBuilding[]>
  levels(projectId: string, buildingId: string): Promise<PhysicalLevel[]>
  spaces(projectId: string, buildingId: string): Promise<PhysicalSpace[]>
  elements(projectId: string, buildingId: string): Promise<PhysicalElement[]>
  relationships(projectId: string, buildingId: string): Promise<PhysicalRelationship[]>
  canDirectEdit(projectId: string, buildingId: string): Promise<boolean>
  editSite(projectId: string, action: 'create', id: string, expected: number, data: Record<string, unknown>): Promise<unknown>
  editBuilding(projectId: string, action: 'create', id: string, expected: number, data: Record<string, unknown>): Promise<unknown>
  editNode(projectId: string, buildingId: string, kind: NodeKind, action: 'create', id: string, expected: number, data: Record<string, unknown>): Promise<unknown>
  editScope(projectId: string, kind: 'project', action: 'link', id: string, data: Record<string, unknown>): Promise<unknown>
}

type Detail = {
  levels: PhysicalLevel[]
  spaces: PhysicalSpace[]
  elements: PhysicalElement[]
  relationships: PhysicalRelationship[]
  canDirectEdit: boolean
}

const emptyDetail: Detail = { levels: [], spaces: [], elements: [], relationships: [], canDirectEdit: false }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const isDenied = (error: string) => /\bdenied\b|\bunauthori[sz]ed\b|\bforbidden\b|\bpermission\b|row[- ]level security|\brls\b/i.test(error)

export function BuildingContextSurface({ projectId, context }: { projectId: string; context: BuildingContextGateway }) {
  const [version, setVersion] = useState(0)
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)
  const [sites, setSites] = useState<PhysicalSite[]>([])
  const [buildings, setBuildings] = useState<PhysicalBuilding[]>([])
  const [projectBuildings, setProjectBuildings] = useState<PhysicalBuilding[]>([])
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
    setDetail(emptyDetail)
    setRootError('')
    setDetailError('')
  }, [context, projectId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setRootError('')
    Promise.all([context.sites(projectId), context.buildings(projectId), projectId ? context.projectBuildings(projectId) : Promise.resolve([])])
      .then(([nextSites, nextBuildings, scoped]) => {
        if (!alive) return
        setSites(nextSites)
        setBuildings(nextBuildings)
        setProjectBuildings(scoped)
        setSelectedBuildingId(current => {
          if (current && nextBuildings.some(building => building.id === current)) return current
          return scoped[0]?.id ?? nextBuildings[0]?.id ?? null
        })
      })
      .catch(reason => {
        if (!alive) return
        setSites([])
        setBuildings([])
        setProjectBuildings([])
        setSelectedBuildingId(null)
        setDetail(emptyDetail)
        setRootError(message(reason))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [context, projectId, version])

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
    ]).then(([levels, spaces, elements, relationships, canDirectEdit]) => {
      if (alive) setDetail({ levels, spaces, elements, relationships, canDirectEdit })
    }).catch(reason => {
      if (alive) {
        setDetail(emptyDetail)
        setDetailError(message(reason))
      }
    }).finally(() => { if (alive) setDetailLoading(false) })
    return () => { alive = false }
  }, [context, projectId, selectedBuildingId, version])

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
  const selectedBuilding = buildings.find(building => building.id === selectedBuildingId)
  const detailDenied = detailError ? isDenied(detailError) : false

  if (detailDenied && selectedBuildingId) return <>
    <div className="card foundation-section" role="alert">
      <h3>You can’t view {selectedBuilding?.name ?? 'this building'}</h3>
      <p>Your project may reference this building, but your current access does not permit its physical details to be read.</p>
      <p className="foundation-hint">No rooms, elements or relationships are shown as empty because their state could not be verified.</p>
      {buildings.length > 1 && <label style={{ display: 'block', maxWidth: 360, marginTop: 16 }}>
        <span className="foundation-hint" style={{ display: 'block', marginBottom: 4 }}>Choose another building</span>
        <select style={inputStyle} value={selectedBuildingId} onChange={event => setSelectedBuildingId(event.target.value)}>
          {buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
      </label>}
    </div>
  </>

  return <>
    {detailError && <div className="card foundation-section" role="alert" style={{ marginBottom: 16 }}>
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
      showProjectScope={Boolean(projectId)}
      sharing={selectedBuilding && detail.canDirectEdit && <BuildingSharingCard key={selectedBuilding.id} buildingId={selectedBuilding.id} buildingName={selectedBuilding.name} />}
      selectedBuildingId={selectedBuildingId}
      levels={detail.levels}
      spaces={detail.spaces}
      elements={detail.elements}
      relationships={detail.relationships}
      canDirectEdit={detail.canDirectEdit}
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
      onLinkProject={async (id, data) => { await context.editScope(projectId, 'project', 'link', id, data) }}
      onSaved={refresh}
    />}
  </>
}
