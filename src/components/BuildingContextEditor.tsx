import { useMemo, useState, type ReactNode } from 'react'
import type {
  PhysicalBuilding,
  PhysicalElement,
  PhysicalLevel,
  PhysicalRelationship,
  PhysicalSite,
  PhysicalSpace,
  PhysicalTruth,
  ProjectPhysicalScope,
  RelationshipKind,
} from '../data/buildingContext'
import { projectRoomMarks, unlinkSummary, wholeBuildingLinks, type UnlinkResult } from '../lib/physicalScope'
import { Field, FormError, inputStyle } from './form'
import { Modal } from './Modal'
import { Icon, List, ListItem, Loading } from './ui'

type NodeKind = 'level' | 'space' | 'element' | 'relationship'
type EditorMode = 'site' | 'building' | NodeKind | 'link' | 'unlink' | null

type NodeData = Record<string, unknown>

export interface BuildingContextEditorProps {
  sites: PhysicalSite[]
  buildings: PhysicalBuilding[]
  projectBuildingIds: string[]
  /** This Project's scope rows; empty outside a Project. */
  scopes?: ProjectPhysicalScope[]
  showProjectScope?: boolean
  /** Details (rooms and edit permission) are still being read. */
  detailLoading?: boolean
  sharing?: ReactNode
  selectedBuildingId: string | null
  levels: PhysicalLevel[]
  spaces: PhysicalSpace[]
  elements: PhysicalElement[]
  relationships: PhysicalRelationship[]
  canDirectEdit: boolean
  onSelectBuilding: (buildingId: string) => void
  onCreateSite: (id: string, data: { name: string; notes: string }) => Promise<void>
  onCreateBuilding: (id: string, data: { site_id: string | null; name: string; notes: string }) => Promise<void>
  onCreateNode: (kind: NodeKind, id: string, data: NodeData) => Promise<void>
  onLinkProject: (id: string, data: { target_kind: 'building'; building_id: string }) => Promise<void>
  /** Mark (no current mark) or unmark one room for this Project; resolves after read-back. */
  onToggleRoom?: (space: PhysicalSpace, mark: ProjectPhysicalScope | null) => Promise<void>
  onUnlinkProject?: (scope: ProjectPhysicalScope) => Promise<UnlinkResult>
  onSaved: () => void
}

const truthOptions: { value: Exclude<PhysicalTruth, 'ai_assessment'>; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'measured', label: 'Measured / observed' },
  { value: 'provided_spec', label: 'Provided plan / specification' },
  { value: 'estimated', label: 'Estimated' },
]

const relationOptions: { value: RelationshipKind; label: string }[] = [
  { value: 'adjacent_to', label: 'Adjacent to' },
  { value: 'shares_boundary_with', label: 'Shares wall / boundary with' },
  { value: 'connects_to', label: 'Connects to' },
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
  { value: 'attached_to', label: 'Attached to' },
]

const truthLabel = (truth: PhysicalTruth) => truthOptions.find(option => option.value === truth)?.label ?? 'AI assessment'
const relationLabel = (relation: RelationshipKind) => relationOptions.find(option => option.value === relation)?.label ?? relation
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export function BuildingContextEditor({
  sites,
  buildings,
  projectBuildingIds,
  scopes = [],
  showProjectScope = true,
  detailLoading = false,
  sharing,
  selectedBuildingId,
  levels,
  spaces,
  elements,
  relationships,
  canDirectEdit,
  onSelectBuilding,
  onCreateSite,
  onCreateBuilding,
  onCreateNode,
  onLinkProject,
  onToggleRoom,
  onUnlinkProject,
  onSaved,
}: BuildingContextEditorProps) {
  const [mode, setMode] = useState<EditorMode>(null)
  const [roomBusy, setRoomBusy] = useState<string | null>(null)
  const [roomError, setRoomError] = useState('')
  const [notice, setNotice] = useState('')
  const selected = buildings.find(building => building.id === selectedBuildingId) ?? buildings[0] ?? null
  const scoped = selected ? projectBuildingIds.includes(selected.id) : false
  const spaceNames = useMemo(() => new Map(spaces.map(space => [space.id, space.name])), [spaces])
  const levelNames = useMemo(() => new Map(levels.map(level => [level.id, level.name])), [levels])
  // Room marks need the whole Building (or its Site) in this Project.
  const wholeLinks = selected && showProjectScope ? wholeBuildingLinks(scopes, selected) : []
  const wholeLinked = wholeLinks.length > 0
  const unlinkScope = wholeLinks.find(scope => scope.targetKind === 'building') ?? wholeLinks[0] ?? null
  const marks = selected && showProjectScope ? projectRoomMarks(scopes, selected.id) : new Map<string, ProjectPhysicalScope>()
  const markedSpaces = spaces.filter(space => marks.has(space.id))
  const unlistedMarks = [...marks.keys()].filter(id => !spaces.some(space => space.id === id)).length
  const activeSpaces = spaces.filter(space => !space.archived)
  const siteName = (siteId: string | null) => sites.find(site => site.id === siteId)?.name ?? 'its site'

  async function toggleRoom(space: PhysicalSpace, mark: ProjectPhysicalScope | null) {
    if (!onToggleRoom || roomBusy) return
    setRoomBusy(space.id); setRoomError(''); setNotice('')
    try { await onToggleRoom(space, mark) }
    catch (err) { setRoomError(`${space.name}: ${errorMessage(err)}`) }
    finally { setRoomBusy(null) }
  }

  return <div className="building-context-editor">
    <div className="foundation-actions" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="cluster" style={{ flexWrap: 'wrap' }}>
        <button className="btn" type="button" onClick={() => setMode('site')}><Icon name="map-pin" size={16} /> Add site</button>
        <button className="btn btn-primary" type="button" onClick={() => setMode('building')}><Icon name="house" size={16} /> Add building</button>
      </div>
      {buildings.length > 0 && <label style={{ minWidth: 220 }}>
        <span className="foundation-hint" style={{ display: 'block', marginBottom: 4 }}>Building</span>
        <select style={inputStyle} value={selected?.id ?? ''} onChange={event => { setNotice(''); setRoomError(''); onSelectBuilding(event.target.value) }}>
          {buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
      </label>}
    </div>

    {!selected ? <div className="card foundation-section" style={{ marginTop: 'var(--section-gap)' }}>
      <h3>No building recorded yet</h3>
      <p className="foundation-hint">Start with one building and only the room you need. The rest can stay unknown until it becomes useful.</p>
      <button className="btn btn-primary" type="button" onClick={() => setMode('building')}>Create first building</button>
    </div> : <>
      <div className="card foundation-section" style={{ marginTop: 'var(--section-gap)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--layout-gap)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <p className="foundation-hint" style={{ margin: 0 }}>{selected.siteId ? sites.find(site => site.id === selected.siteId)?.name ?? 'Site' : 'Standalone building'}</p>
            <h2 style={{ margin: '3px 0 4px' }}>{selected.name}</h2>
            {selected.notes && <p style={{ margin: 0 }}>{selected.notes}</p>}
          </div>
          {showProjectScope && <div className="cluster" style={{ flexWrap: 'wrap' }}>
            <span className="image-purpose">{wholeLinked ? 'Used by this project' : scoped ? 'Some rooms linked' : 'Not linked to this project'}</span>
            {!wholeLinked && canDirectEdit && !detailLoading && <button className="btn btn-primary" type="button" onClick={() => setMode('link')}>Use in this project</button>}
            {unlinkScope && onUnlinkProject && <button className="btn" type="button" onClick={() => { setNotice(''); setMode('unlink') }}>Unlink from this project</button>}
          </div>}
        </div>
        {showProjectScope && !wholeLinked && !canDirectEdit && !detailLoading && <p className="foundation-hint">
          Only someone who can edit {selected.name} can link it to this project. Ask them to choose “Use in this project”.
        </p>}
        {showProjectScope && !wholeLinked && scoped && <p className="foundation-hint">
          This project uses single rooms here, not the whole building. Link the whole building to choose rooms.
        </p>}
        {showProjectScope && wholeLinked && <div className="room-scope-summary">
          <strong>Rooms in this project</strong>
          {unlinkScope?.targetKind === 'site' && <p className="foundation-hint">Linked through the site {siteName(unlinkScope.siteId)}.</p>}
          {detailLoading ? <p className="foundation-hint" role="status">Loading rooms…</p>
            : markedSpaces.length || unlistedMarks ? <p>
              {markedSpaces.map(space => space.archived ? `${space.name} (archived)` : space.name).join(', ')}
              {unlistedMarks > 0 && `${markedSpaces.length ? ' · ' : ''}${unlistedMarks} ${unlistedMarks === 1 ? 'room is' : 'rooms are'} no longer listed`}
            </p>
            : <p className="foundation-hint">None marked yet. Tick the rooms this project covers below.</p>}
        </div>}
        {notice && <p className="foundation-hint" role="status">{notice}</p>}
        {!canDirectEdit && !detailLoading && scoped && showProjectScope && <p className="foundation-hint" style={{ marginBottom: 0 }}>
          View only. Ask a building owner to update these details.
        </p>}
      </div>

      {/* In a Project, its rooms come first; household sharing is building administration. */}
      {!showProjectScope && sharing}

      <section className="card foundation-section" style={{ marginTop: 'var(--section-gap)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--layout-gap)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h3 style={{ marginBottom: 3 }}>Spaces</h3><p className="foundation-hint" style={{ margin: 0 }}>{wholeLinked && onToggleRoom ? 'Tick the rooms this project covers.' : 'Rooms and other spaces in this building.'}</p></div>
          {canDirectEdit && <div className="cluster" style={{ flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => setMode('level')}>Add level</button>
            <button className="btn btn-primary" type="button" onClick={() => setMode('space')}>Add space</button>
          </div>}
        </div>
        {roomError && <div role="alert" style={{ marginTop: 'var(--section-gap)' }}><FormError>
          <span>{roomError}</span> <button className="btn" type="button" onClick={() => { setRoomError(''); onSaved() }}>Reload</button>
        </FormError></div>}
        {detailLoading && spaces.length === 0 ? <Loading label="Loading rooms…" /> : spaces.length === 0 ? <p style={{ marginTop: 'var(--section-gap)' }}>No spaces yet. Add only the room or space you know about.</p> : <List>
          {activeSpaces.map(space => {
            const mark = marks.get(space.id) ?? null
            const toggle = Boolean(showProjectScope && onToggleRoom && (wholeLinked || mark))
            // While saving, show the intended state beside "Saving…"; failure restores the read-back state.
            return <ListItem key={space.id}>
            <div className="building-room-row">
              <div className="building-room-text"><strong>{space.name}</strong><div className="foundation-hint">{space.kind || 'Space'}{space.levelId ? ` · ${levelNames.get(space.levelId) ?? 'Level'}` : ''}</div></div>
              <div className="building-room-side">
                <span className="image-purpose">{truthLabel(space.truth)}</span>
                {toggle && <label className="foundation-check room-scope-toggle">
                  <input type="checkbox" checked={roomBusy === space.id ? !mark : !!mark} disabled={roomBusy !== null} aria-label={`${space.name}: in this project`} onChange={() => void toggleRoom(space, mark)} />
                  <span>{roomBusy === space.id ? 'Saving…' : 'In this project'}</span>
                </label>}
              </div>
            </div>
            {space.notes && <details className="space-notes" style={{ marginTop: 10 }}>
              <summary>Notes</summary><p style={{ marginBottom: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{space.notes}</p>
            </details>}
            {space.hasProposal && <p className="foundation-hint" style={{ marginBottom: 0 }}>Proposed change available.</p>}
          </ListItem>})}
        </List>}
      </section>

      <section className="card foundation-section" style={{ marginTop: 'var(--section-gap)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--layout-gap)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h3 style={{ marginBottom: 3 }}>Known elements</h3><p className="foundation-hint" style={{ margin: 0 }}>Windows, doors and other building parts.</p></div>
          {canDirectEdit && <button className="btn" type="button" onClick={() => setMode('element')}>Add element</button>}
        </div>
        {elements.filter(element => !element.archived).length === 0 ? detailLoading ? null : <p style={{ marginTop: 'var(--section-gap)' }}>No building elements recorded.</p> : <List>
          {elements.filter(element => !element.archived).map(element => <ListItem key={element.id}>
            <strong>{element.name}</strong> <span className="foundation-hint">· {element.kind || 'element'}{element.spaceId ? ` · ${spaceNames.get(element.spaceId) ?? 'Space'}` : ''}</span>
            <div className="foundation-hint">{truthLabel(element.truth)}{element.source ? ` · ${element.source}` : ''}</div>
          </ListItem>)}
        </List>}
      </section>

      <section className="card foundation-section" style={{ marginTop: 'var(--section-gap)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--layout-gap)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h3 style={{ marginBottom: 3 }}>Spatial relationships</h3><p className="foundation-hint" style={{ margin: 0 }}>How the rooms connect or sit beside each other.</p></div>
          {canDirectEdit && spaces.length >= 2 && <button className="btn" type="button" onClick={() => setMode('relationship')}>Add relationship</button>}
        </div>
        {relationships.filter(relation => !relation.archived).length === 0 ? detailLoading ? null : <p style={{ marginTop: 'var(--section-gap)' }}>No room relationships recorded yet.</p> : <List>
          {relationships.filter(relation => !relation.archived).map(relation => <ListItem key={relation.id}>
            <strong>{spaceNames.get(relation.subjectSpaceId) ?? 'Space'}</strong> {relationLabel(relation.relation).toLowerCase()} <strong>{spaceNames.get(relation.objectSpaceId) ?? 'Space'}</strong>
            <div className="foundation-hint">{truthLabel(relation.truth)}{relation.source ? ` · ${relation.source}` : ''}</div>
          </ListItem>)}
        </List>}
      </section>
      {showProjectScope && sharing}
    </>}

    {mode === 'unlink' && selected && unlinkScope && onUnlinkProject && <UnlinkProjectModal
      building={selected}
      scope={unlinkScope}
      siteName={siteName(unlinkScope.siteId)}
      markedCount={marks.size}
      stillCovered={wholeLinks.length > 1}
      onClose={() => setMode(null)}
      onUnlink={onUnlinkProject}
      onDone={result => { setMode(null); setNotice(unlinkSummary(selected.name, result)); onSaved() }}
    />}
    {mode && mode !== 'unlink' && <CreatePhysicalModal
      mode={mode}
      sites={sites}
      building={selected}
      levels={levels}
      spaces={spaces}
      onClose={() => setMode(null)}
      onCreateSite={onCreateSite}
      onCreateBuilding={onCreateBuilding}
      onCreateNode={onCreateNode}
      onLinkProject={onLinkProject}
      onSaved={() => { setMode(null); onSaved() }}
    />}
  </div>
}

function CreatePhysicalModal({
  mode,
  sites,
  building,
  levels,
  spaces,
  onClose,
  onCreateSite,
  onCreateBuilding,
  onCreateNode,
  onLinkProject,
  onSaved,
}: {
  mode: Exclude<EditorMode, null | 'unlink'>
  sites: PhysicalSite[]
  building: PhysicalBuilding | null
  levels: PhysicalLevel[]
  spaces: PhysicalSpace[]
  onClose: () => void
  onCreateSite: BuildingContextEditorProps['onCreateSite']
  onCreateBuilding: BuildingContextEditorProps['onCreateBuilding']
  onCreateNode: BuildingContextEditorProps['onCreateNode']
  onLinkProject: BuildingContextEditorProps['onLinkProject']
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [siteId, setSiteId] = useState('')
  const [levelId, setLevelId] = useState('')
  const [position, setPosition] = useState('0')
  const [kind, setKind] = useState('')
  const [description, setDescription] = useState('')
  const [truth, setTruth] = useState<Exclude<PhysicalTruth, 'ai_assessment'>>('unknown')
  const [source, setSource] = useState('')
  const [subject, setSubject] = useState(spaces[0]?.id ?? '')
  const [object, setObject] = useState(spaces[1]?.id ?? '')
  const [relation, setRelation] = useState<RelationshipKind>('adjacent_to')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = mode === 'site' ? 'Add site' : mode === 'building' ? 'Add building' : mode === 'level' ? 'Add level' : mode === 'space' ? 'Add space' : mode === 'element' ? 'Add building element' : mode === 'relationship' ? 'Add spatial relationship' : 'Use building in project'
  const needsTruth = mode === 'space' || mode === 'element' || mode === 'relationship'

  return <Modal title={title} onClose={() => { if (!busy) onClose() }}>
    {mode === 'link' ? <>
      <p>Everyone in this project will see <strong>{building?.name}</strong> and its rooms. It does not let them change the building.</p>
      <p className="foundation-hint">Next, tick the rooms this project covers.</p>
      {error && <div role="alert"><FormError>{error}</FormError></div>}
      <div className="foundation-actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !building} onClick={async () => {
        if (!building) return
        setBusy(true); setError('')
        try { await onLinkProject(crypto.randomUUID(), { target_kind: 'building', building_id: building.id }); onSaved() }
        catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
      }}>{busy ? 'Linking…' : 'Use this building'}</button></div>
    </> : <form onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      if ((mode === 'level' || mode === 'space' || mode === 'element' || mode === 'relationship') && !building) return
      if (mode === 'relationship' && (!subject || !object || subject === object)) { setError('Choose two different spaces.'); return }
      setBusy(true); setError('')
      try {
        const id = crypto.randomUUID()
        if (mode === 'site') await onCreateSite(id, { name, notes })
        else if (mode === 'building') await onCreateBuilding(id, { site_id: siteId || null, name, notes })
        else if (mode === 'level') await onCreateNode('level', id, { name, position: Number(position), notes })
        else if (mode === 'space') await onCreateNode('space', id, { name, kind, level_id: levelId || null, notes, truth, source, measurements: [] })
        else if (mode === 'element') await onCreateNode('element', id, { space_id: subject || null, kind, name, description, truth, source })
        else if (mode === 'relationship') await onCreateNode('relationship', id, { subject_space_id: subject, object_space_id: object, relation, truth, source, notes })
        onSaved()
      } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
    }}>
      <fieldset disabled={busy} className="foundation-form" style={{ border: 0, padding: 0, margin: 0 }}>
        {(mode === 'site' || mode === 'building' || mode === 'level' || mode === 'space' || mode === 'element') && <Field label={mode === 'space' ? 'Space name' : mode === 'element' ? 'Element name' : 'Name'}><input style={inputStyle} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field>}
        {mode === 'building' && <Field label="Site (optional)"><select style={inputStyle} value={siteId} onChange={event => setSiteId(event.target.value)}><option value="">No site / standalone</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>}
        {mode === 'level' && <Field label="Order / position"><input style={inputStyle} type="number" value={position} onChange={event => setPosition(event.target.value)} /></Field>}
        {mode === 'space' && <><Field label="Kind"><input style={inputStyle} maxLength={80} placeholder="Bedroom, kitchen, porch…" value={kind} onChange={event => setKind(event.target.value)} /></Field><Field label="Level (optional)"><select style={inputStyle} value={levelId} onChange={event => setLevelId(event.target.value)}><option value="">Not modelled / unknown</option>{levels.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}</select></Field></>}
        {mode === 'element' && <><Field label="Kind"><input style={inputStyle} required maxLength={80} placeholder="Window, wall, beam, outlet…" value={kind} onChange={event => setKind(event.target.value)} /></Field><Field label="Space (optional)"><select style={inputStyle} value={subject} onChange={event => setSubject(event.target.value)}><option value="">Whole building / not placed</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></Field><Field label="Description"><textarea style={inputStyle} rows={2} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></Field></>}
        {mode === 'relationship' && <><Field label="First space"><select style={inputStyle} required value={subject} onChange={event => setSubject(event.target.value)}>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></Field><Field label="Relationship"><select style={inputStyle} value={relation} onChange={event => setRelation(event.target.value as RelationshipKind)}>{relationOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Second space"><select style={inputStyle} required value={object} onChange={event => setObject(event.target.value)}>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></Field></>}
        {needsTruth && <><Field label="How certain is this?"><select style={inputStyle} value={truth} onChange={event => setTruth(event.target.value as Exclude<PhysicalTruth, 'ai_assessment'>)}>{truthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Source / how do we know?"><textarea style={inputStyle} rows={2} required={truth !== 'unknown'} maxLength={2000} placeholder={truth === 'unknown' ? 'Optional while unknown' : 'Measurement, drawing, observation…'} value={source} onChange={event => setSource(event.target.value)} /></Field></>}
        {(mode === 'site' || mode === 'building' || mode === 'level' || mode === 'space' || mode === 'relationship') && <Field label="Notes"><textarea style={inputStyle} rows={2} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>}
        {needsTruth && <p className="foundation-hint">Choose Unknown until you have a measurement, observation or plan.</p>}
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        {busy && <p role="status">Saving…</p>}
        <div className="foundation-actions"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary">{busy ? 'Saving…' : 'Save'}</button></div>
      </fieldset>
    </form>}
  </Modal>
}

function UnlinkProjectModal({ building, scope, siteName, markedCount, stillCovered, onClose, onUnlink, onDone }: {
  building: PhysicalBuilding
  scope: ProjectPhysicalScope
  siteName: string
  markedCount: number
  stillCovered: boolean
  onClose: () => void
  onUnlink: (scope: ProjectPhysicalScope) => Promise<UnlinkResult>
  onDone: (result: UnlinkResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const viaSite = scope.targetKind === 'site'
  return <Modal title="Unlink from this project" onClose={() => { if (!busy) onClose() }}>
    {viaSite
      ? <p>This project uses <strong>{building.name}</strong> through the site <strong>{siteName}</strong>. Unlinking removes the whole site and every building on it from this project.</p>
      : <p>Stop using <strong>{building.name}</strong> in this project?</p>}
    {stillCovered ? <p className="foundation-hint">The project still covers {building.name} another way, so its room marks and Area rooms stay.</p>
      : <ul className="unlink-consequences">
        <li>{markedCount ? `This project’s ${markedCount} room ${markedCount === 1 ? 'mark is' : 'marks are'} removed.` : 'No rooms are marked, so none are removed.'}</li>
        <li>Areas lose the rooms they were mapped to in {viaSite ? 'those buildings' : 'this building'}.</li>
        <li>The building, its rooms and their history stay saved.</li>
      </ul>}
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    <div className="foundation-actions" style={{ justifyContent: 'flex-end' }}>
      <button className="btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn btn-remove" type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError('')
        try { onDone(await onUnlink(scope)) }
        catch (err) { setError(errorMessage(err)); setBusy(false) }
      }}>{busy ? 'Unlinking…' : viaSite ? 'Unlink site' : 'Unlink building'}</button>
    </div>
  </Modal>
}
