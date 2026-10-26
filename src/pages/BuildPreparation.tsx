import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import { useBobSurface, openBobWithDraft } from '../lib/bobSurface'
import { preliminaryConstructionList, preliminaryCutCsv } from '../domain/constructionPreview'
import { Icon, Loading, useAsync, useProjectVersion } from '../components/ui'
import { inputStyle } from '../components/form'
import '../components/StorageBoxDrawing.css'

const pageCard = { padding: 'var(--panel-padding)' }
const shortName = (id: string) => id.replace(/^d_/, '').replace(/[_-]+/g, ' ')
const dimensions = (part: { dimensions: { x: number; y: number; z: number } }) =>
  [part.dimensions.x, part.dimensions.y, part.dimensions.z].join(' × ') + ' mm'
const FASTENER_KINDS: Record<string, string> = { screw: 'Screw', nail: 'Nail', bolt: 'Bolt' }
const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many)
// Diameters read like the rule table (3.5, 4.0 … 6.0).
const diameter = (value: number) => Number.isInteger(value * 10) ? value.toFixed(1) : String(value)

export function BuildPreparation() {
  const projectId = db.getActiveProjectId() ?? ''
  const projectVersion = useProjectVersion()
  const [params, setParams] = useSearchParams()
  const areaFilter = params.get('area') ?? ''
  const requestedId = params.get('construction') ?? ''
  const [retry, setRetry] = useState(0)

  const { data, loading, error } = useAsync(async () => {
    const [heads, areas, needs, cutPlans, shopping] = await Promise.all([
      db.getBuildConstructions(projectId), db.getAreas(),
      db.getMaterialRequirements(projectId, '', false, 0),
      db.getConstructionCutPlans(projectId), db.getMaterials(),
    ])
    return { heads, areas, needs, cutPlans, shopping }
  }, [projectId, projectVersion, retry])
  const filtered = (data?.heads ?? []).filter(head => !areaFilter || head.areaId === areaFilter)
  const chosen = filtered.find(head => head.id === requestedId) ?? filtered[0] ?? null
  const { data: source, loading: sourceLoading, error: sourceError } = useAsync(
    () => chosen ? db.getBuildConstructionSource(projectId, chosen.id, chosen.revision) : Promise.resolve(null),
    [projectId, chosen?.id, chosen?.revision, projectVersion, retry],
  )
  const { data: fasteners, loading: fastenersLoading, error: fastenersError } = useAsync(
    () => chosen ? db.getBuildConstructionFasteners(projectId, chosen.id, chosen.revision) : Promise.resolve(null),
    [projectId, chosen?.id, chosen?.revision, projectVersion, retry],
  )

  useBobSurface(projectId, { surface: 'material-plan', ...(chosen?.areaId ? { areaId: chosen.areaId } : {}) },
    'Cut list and purchasing', 2)

  const preview = source ? preliminaryConstructionList(source) : null
  const validPreview = preview?.status === 'preliminary' ? preview : null
  const linkedNeeds = (data?.needs.items ?? []).filter(item => chosen && item.artifactId === chosen.id
    && item.artifactRevision === chosen.revision && !item.artifactChanged && !item.targetChanged
    && !item.stockChanged && !item.componentChanged)
  const provisionalMaterials = validPreview ? [...validPreview.parts.reduce((groups, part) => {
    const key = part.materialId + '@' + part.materialRevision
    const existing = groups.get(key)
    if (existing) existing.blanks += part.quantity
    else groups.set(key, { key, name: part.materialName, revision: part.materialRevision, blanks: part.quantity })
    return groups
  }, new Map<string, { key: string; name: string; revision: number; blanks: number }>()).values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.revision - b.revision) : []
  const currentPlans = (data?.cutPlans.items ?? []).filter(item => chosen && item.artifact_id === chosen.id
    && item.artifact_revision === chosen.revision && item.source_state === 'current')
  const currentPlan = currentPlans[0]
  const area = data?.areas.find(item => item.id === chosen?.areaId)
  const areaQuery = chosen?.areaId ? '?area=' + encodeURIComponent(chosen.areaId) : ''
  const statusLabel = sourceLoading ? 'Reading the construction source' : validPreview
    ? 'Preliminary' : preview?.status === 'changed' ? 'The source has changed' : 'Needs more information'

  const changeArea = (next: string) => setParams(next ? { area: next } : {})
  const choose = (id: string) => setParams({ ...(areaFilter ? { area: areaFilter } : {}), construction: id })

  return <div className="page build-preparation">
    <Link to="/project" className="btn" style={{ marginBottom: 'var(--space-3)' }}>
      <Icon name="arrow-left" size={16} /> Project
    </Link>
    <div className="page-head">
      <div>
        <h1 className="page-title">Cut list &amp; purchasing</h1>
        <p className="page-sub">One saved construction gives the parts, the cutting and the material to buy. This shows what can be used now and what is still open.</p>
      </div>
    </div>

    {!db.authEnabled() && <section className="card" style={pageCard}>Open a connected project to see its saved building documents.</section>}
    {db.authEnabled() && loading && !data && <Loading label="Reading the project's building documents…" />}
    {db.authEnabled() && error && !data && <section className="card" role="alert" style={pageCard}>
      <p>The building documents could not be read. No project data was changed.</p>
      <button className="btn" onClick={() => setRetry(value => value + 1)}>Try again</button>
    </section>}

    {data && <>
      <section className="card" style={pageCard} aria-label="Choose the construction source">
        <div className="fact-filters">
          <label>
            <strong>Area</strong>
            <select style={inputStyle} value={areaFilter} onChange={event => changeArea(event.target.value)}>
              <option value="">All Areas</option>
              {data.areas.filter(item => !item.archivedAt).map(item =>
                <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {!!filtered.length && <label>
            <strong>Current construction</strong>
            <select style={inputStyle} value={chosen?.id ?? ''} onChange={event => choose(event.target.value)}>
              {filtered.map(head => <option key={head.id} value={head.id}>{head.title} · v{head.revision}</option>)}
            </select>
          </label>}
        </div>
        {!filtered.length && <p>No current saved construction was found here. <Link to={'/artifacts' + (areaFilter ? '?area=' + encodeURIComponent(areaFilter) : '')}>See drawings and construction sources</Link>.</p>}
        {chosen && <p className="foundation-hint">Source: {area?.name ?? 'The project'} · construction version {chosen.revision}. Nothing shown here is saved as a new material need.</p>}
      </section>

      {chosen && <section className="card" style={{ ...pageCard, marginTop: 'var(--section-gap)' }} aria-label="Preliminary cut list">
        <div className="foundation-heading">
          <div>
            <h2 style={{ marginBottom: 5 }}>Preliminary cut list</h2>
            <p className="foundation-hint" style={{ margin: 0 }}>{statusLabel}</p>
          </div>
          {validPreview && <a className="btn" download={'preliminary-cut-list-v' + validPreview.revision + '.csv'}
            href={'data:text/csv;charset=utf-8,' + encodeURIComponent(preliminaryCutCsv(validPreview, fasteners))}>
            <Icon name="download" size={16} /> CSV
          </a>}
        </div>
        <p className="solution-attention">Not approved for cutting. Sizes are uncut blank sizes from the saved geometry, not optimised saw cuts, material use or a verified load-bearing design.</p>
        {sourceLoading && <Loading label="Reading the exact parts and material versions…" />}
        {sourceError && <div role="alert">
          <p>The saved construction could not be read. Do not use an older cut list.</p>
          <button className="btn" onClick={() => setRetry(value => value + 1)}>Read the source again</button>
        </div>}
        {preview && preview.status !== 'preliminary' && <p role="status">{preview.message}</p>}
        {validPreview && <>
          <p><strong>{plural(validPreview.partCount, 'part', 'parts')} to make</strong> in {plural(validPreview.parts.length, 'group', 'groups')}.
            {validPreview.referenceCount > 0 && ' ' + plural(validPreview.referenceCount, 'reference part is', 'reference parts are') + ' left out of cutting and purchasing.'}
            {validPreview.retainedCount > 0 && ' ' + plural(validPreview.retainedCount, 'reused part is', 'reused parts are') + ' handled separately.'}
            {validPreview.completeItemCount > 0 && ' ' + plural(validPreview.completeItemCount, 'ready-made item is', 'ready-made items are') + ' handled separately.'}
          </p>
          {validPreview.parts.length ? <div className="box-parts" tabIndex={0} aria-label="Parts to make">
            <table>
              <thead><tr><th>Part</th><th>Material</th><th>Qty</th><th>Blank size</th><th>Labels</th></tr></thead>
              <tbody>{validPreview.parts.map(part => <tr key={part.definitionId}>
                <td><strong>{shortName(part.definitionId)}</strong></td>
                <td>{part.materialName}<div className="foundation-hint">Material version {part.materialRevision}</div></td>
                <td>{part.quantity}</td>
                <td>{dimensions(part)}</td>
                <td>{part.partLabels.join(', ')}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p>No parts in this construction are marked to be made.</p>}
        </>}
        {!!preview?.questions.length && <details style={{ marginTop: 'var(--space-3)' }}>
          <summary>Open construction questions ({preview.questions.length})</summary>
          <ul>{preview.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>
        </details>}
      </section>}

      {chosen && <section className="card" style={{ ...pageCard, marginTop: 'var(--section-gap)' }} aria-label="Screws, nails and glue">
        <h2>Screws, nails &amp; glue</h2>
        <p className="foundation-hint">Exact counts from the saved joints, with no waste added. A rule of thumb, not a strength calculation; Bob can suggest spares when you buy.</p>
        {fastenersLoading && <Loading label="Reading the fastener schedule…" />}
        {fastenersError && <p role="alert">The fastener schedule could not be read. No count is shown.</p>}
        {!fastenersLoading && !fastenersError && fasteners === null && <p role="status">No fastener schedule is available for this construction version.</p>}
        {fasteners && <>
          {fasteners.totals.length ? <div className="box-parts" tabIndex={0} aria-label="Fasteners"><table>
            <thead><tr><th>Fastener</th><th>Size</th><th>Qty</th><th>Joints</th></tr></thead>
            <tbody>{fasteners.totals.map(row => <tr key={row.kind + row.diameterMm + 'x' + row.lengthMm}>
              <td>{FASTENER_KINDS[row.kind]}</td><td>Ø {diameter(row.diameterMm)} × {row.lengthMm} mm</td><td>{row.count}</td><td>{row.joints}</td>
            </tr>)}</tbody>
          </table></div> : <p>No screws, nails or bolts in the saved joints.</p>}
          {fasteners.gluePackages > 0 && <p>Glue: {fasteners.gluePackages} {fasteners.gluePackages === 1 ? 'package' : 'packages'}.</p>}
          {!fasteners.complete && <p role="status">{fasteners.unsizedJoints} {fasteners.unsizedJoints === 1 ? 'joint has' : 'joints have'} no fastener rule or size yet and {fasteners.unsizedJoints === 1 ? 'is' : 'are'} not counted.</p>}
          {fasteners.flaggedJoints > 0 && <p className="foundation-hint">Rule warnings (short or narrow contact, short screw) on {fasteners.flaggedJoints} {fasteners.flaggedJoints === 1 ? 'joint' : 'joints'}. Check them before building.</p>}
        </>}
      </section>}

      <section className="card" style={{ ...pageCard, marginTop: 'var(--section-gap)' }} aria-label="Material and purchasing">
        <h2>Material &amp; purchasing</h2>
        <p className="foundation-hint">Raw material to buy is counted from a verified cut plan, not by adding up part sizes.</p>
        {provisionalMaterials.length > 0 && <details>
          <summary>Materials in the construction · {provisionalMaterials.length} {provisionalMaterials.length === 1 ? 'material' : 'materials'}</summary>
          <p className="foundation-hint">These are parts to make, not sheets or metres to buy. Stock format, saw kerf, offcuts and stock on hand are decided in the saved cut plan.</p>
          <div className="box-parts" tabIndex={0} aria-label="Materials in the construction"><table>
            <thead><tr><th>Material</th><th>Blanks in the drawing</th></tr></thead>
            <tbody>{provisionalMaterials.map(group => <tr key={group.key}>
              <td>{group.name} · v{group.revision}</td><td>{group.blanks}</td>
            </tr>)}</tbody>
          </table></div>
        </details>}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--layout-gap)' }}>
          <div>
            <strong>Material needs</strong>
            <p>{linkedNeeds.length ? linkedNeeds.length + ' current ' + (linkedNeeds.length === 1 ? 'need' : 'needs') + ' linked to this construction' : 'No verified material needs for this version'}</p>
          </div>
          <div>
            <strong>Cut plan</strong>
            <p>{currentPlan ? 'Saved version ' + currentPlan.revision : 'No current cut plan saved'}</p>
          </div>
          <div>
            <strong>Purchasing</strong>
            <p>{data.shopping.length ? data.shopping.length + (data.shopping.length === 1 ? ' row' : ' rows') + ' on the project shopping list' : 'No shopping rows saved'}</p>
          </div>
        </div>
        {data.needs.hasMore && <p className="foundation-hint">Material needs have more pages; coverage for this construction cannot be confirmed here.</p>}
        {data.cutPlans.hasMore && <p className="foundation-hint">More cut plans exist; check them with Bob before using a plan.</p>}
        {currentPlan && <p className="foundation-hint">The cut plan is bound to its source version. A saved plan alone does not prove material quality, fixing, strength or safe working.</p>}
        <div className="foundation-actions">
          <Link className="btn" to={'/material-plan' + areaQuery}>Material plan</Link>
          <Link className="btn" to="/shopping">Shopping list</Link>
        </div>
      </section>

      <section className="card" style={{ ...pageCard, marginTop: 'var(--section-gap)' }} aria-label="Next step">
        <h2>Next step</h2>
        <p>Bob needs to settle the construction's open questions, update the drawing from the current source version, and then work out the material needs and a real cut plan. Orders and cutting need their own review.</p>
        <div className="foundation-actions">
          <button className="btn btn-primary" onClick={() => openBobWithDraft(
            'Continue the building documents for ' + (chosen?.title ?? 'the project')
            + (chosen ? ' from saved construction version ' + chosen.revision + '.' : '.')
            + ' Read the current sources and open questions, finish and check the drawing,'
            + ' and derive role-aware material needs, fasteners and a cut plan with the existing tools.'
            + ' Say exactly what blocks safe purchasing or cutting; do not guess materials, hardware or quantities.'
            + ' Keep going on your own until you have a saved result or a real blocker.',
          )}>Ask Bob to finish the documents</button>
          <Link className="btn" to={'/artifacts' + areaQuery}>See drawings</Link>
        </div>
      </section>
    </>}
  </div>
}
