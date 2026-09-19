import { useMemo, useState, type ReactNode } from 'react'
import type {
  PhysicalBuilding,
  PhysicalElement,
  PhysicalLevel,
  PhysicalRelationship,
  PhysicalSite,
  PhysicalSpace,
  PhysicalTruth,
  RelationshipKind,
} from '../data/buildingContext'
import { Field, FormError, inputStyle } from './form'
import { Modal } from './Modal'
import { Icon } from './ui'

type NodeKind = 'level' | 'space' | 'element' | 'relationship'
type EditorMode = 'site' | 'building' | NodeKind | 'link' | null

type NodeData = Record<string, unknown>

export interface BuildingContextEditorProps {
  sites: PhysicalSite[]
  buildings: PhysicalBuilding[]
  projectBuildingIds: string[]
  showProjectScope?: boolean
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
  showProjectScope = true,
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
  onSaved,
}: BuildingContextEditorProps) {
  const [mode, setMode] = useState<EditorMode>(null)
  const selected = buildings.find(building => building.id === selectedBuildingId) ?? buildings[0] ?? null
  const scoped = selected ? projectBuildingIds.includes(selected.id) : false
  const spaceNames = useMemo(() => new Map(spaces.map(space => [space.id, space.name])), [spaces])
  const levelNames = useMemo(() => new Map(levels.map(level => [level.id, level.name])), [levels])

  return <div className="building-context-editor">
    <div className="foundation-actions" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="cluster" style={{ flexWrap: 'wrap' }}>
        <button className="btn" type="button" onClick={() => setMode('site')}><Icon name="map-pin" size={16} /> Add site</button>
        <button className="btn btn-primary" type="button" onClick={() => setMode('building')}><Icon name="house" size={16} /> Add building</button>
      </div>
      {buildings.length > 0 && <label style={{ minWidth: 220 }}>
        <span className="foundation-hint" style={{ display: 'block', marginBottom: 4 }}>Building</span>
        <select style={inputStyle} value={selected?.id ?? ''} onChange={event => onSelectBuilding(event.target.value)}>
          {buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
      </label>}
    </div>

    {!selected ? <div className="card foundation-section" style={{ marginTop: 16 }}>
      <h3>No building recorded yet</h3>
      <p className="foundation-hint">Start with one building and only the room you need. The rest can stay unknown until it becomes useful.</p>
      <button className="btn btn-primary" type="button" onClick={() => setMode('building')}>Create first building</button>
    </div> : <>
      <div className="card foundation-section" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <p className="foundation-hint" style={{ margin: 0 }}>{selected.siteId ? sites.find(site => site.id === selected.siteId)?.name ?? 'Site' : 'Standalone building'}</p>
            <h2 style={{ margin: '3px 0 4px' }}>{selected.name}</h2>
            {selected.notes && <p style={{ margin: 0 }}>{selected.notes}</p>}
          </div>
          {showProjectScope && <div className="cluster" style={{ flexWrap: 'wrap' }}>
            <span className="image-purpose">{scoped ? 'Used by this project' : 'Not linked to this project'}</span>
            {!scoped && <button className="btn btn-primary" type="button" onClick={() => setMode('link')}>Use in this project</button>}
          </div>}
        </div>
        {!canDirectEdit && scoped && showProjectScope && <p className="foundation-hint" style={{ marginBottom: 0 }}>
          You can use this building as project context. Direct edits to accepted physical truth require building authority; project proposals stay separate.
        </p>}
      </div>

      {sharing}

      <section className="card foundation-section" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h3 style={{ marginBottom: 3 }}>Spaces</h3><p className="foundation-hint" style={{ margin: 0 }}>A building can be useful with only one known room.</p></div>
          {canDirectEdit && <div className="cluster" style={{ flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => setMode('level')}>Add level</button>
            <button className="btn btn-primary" type="button" onClick={() => setMode('space')}>Add space</button>
          </div>}
        </div>
        {spaces.length === 0 ? <p style={{ marginTop: 14 }}>No spaces yet. Add only the room or space you know about.</p> : <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', marginTop: 14 }}>
          {spaces.filter(space => !space.archived).map(space => <div key={space.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div><strong>{space.name}</strong><div className="foundation-hint">{space.kind || 'Space'}{space.levelId ? ` · ${levelNames.get(space.levelId) ?? 'Level'}` : ''}</div></div>
              <span className="image-purpose">{truthLabel(space.truth)}</span>
            </div>
            {space.notes && <p style={{ marginBottom: 0 }}>{space.notes}</p>}
            {space.hasProposal && <p className="foundation-hint" style={{ marginBottom: 0 }}>A proposed change exists; accepted current state is still shown here.</p>}
          </div>)}
        </div>}
      </section>

      <section className="card foundation-section" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h3 style={{ marginBottom: 3 }}>Known elements</h3><p className="foundation-hint" style={{ margin: 0 }}>Windows, doors, beams, outlets and other physical parts can be added only when useful.</p></div>
          {canDirectEdit && <button className="btn" type="button" onClick={() => setMode('element')}>Add element</button>}
        </div>
        {elements.filter(element => !element.archived).length === 0 ? <p style={{ marginTop: 14 }}>No building elements recorded.</p> : <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
          {elements.filter(element => !element.archived).map(element => <div key={element.id} className="card" style={{ padding: 12 }}>
            <strong>{element.name}</strong> <span className="foundation-hint">· {element.kind || 'element'}{element.spaceId ? ` · ${spaceNames.get(element.spaceId) ?? 'Space'}` : ''}</span>
            <div className="foundation-hint">{truthLabel(element.truth)}{element.source ? ` · ${element.source}` : ''}</div>
          </div>)}
        </div>}
      </section>

      <section className="card foundation-section" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h3 style={{ marginBottom: 3 }}>Spatial relationships</h3><p className="foundation-hint" style={{ margin: 0 }}>Relationships work before a complete floor plan exists.</p></div>
          {canDirectEdit && spaces.length >= 2 && <button className="btn" type="button" onClick={() => setMode('relationship')}>Add relationship</button>}
        </div>
        {relationships.filter(relation => !relation.archived).length === 0 ? <p style={{ marginTop: 14 }}>No room relationships recorded yet.</p> : <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
          {relationships.filter(relation => !relation.archived).map(relation => <div key={relation.id} className="card" style={{ padding: 12 }}>
            <strong>{spaceNames.get(relation.subjectSpaceId) ?? 'Space'}</strong> {relationLabel(relation.relation).toLowerCase()} <strong>{spaceNames.get(relation.objectSpaceId) ?? 'Space'}</strong>
            <div className="foundation-hint">{truthLabel(relation.truth)}{relation.source ? ` · ${relation.source}` : ''}</div>
          </div>)}
        </div>}
      </section>
    </>}

    {mode && <CreatePhysicalModal
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
  mode: Exclude<EditorMode, null>
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
      <p>Link <strong>{building?.name}</strong> to this project. This grants project-context reads; it does not make project members building editors.</p>
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
        {needsTruth && <p className="foundation-hint">Unknown stays unknown. This manual form cannot create an AI-assessment fact.</p>}
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        {busy && <p role="status">Saving and reading back…</p>}
        <div className="foundation-actions"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary">{busy ? 'Saving…' : 'Save'}</button></div>
      </fieldset>
    </form>}
  </Modal>
}
