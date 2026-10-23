import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import { useBobSurface, openBobWithDraft } from '../lib/bobSurface'
import { preliminaryConstructionList, preliminaryCutCsv } from '../domain/constructionPreview'
import { Icon, Loading, useAsync, useProjectVersion } from '../components/ui'

const pageCard = { padding: 'var(--panel-padding)' }
const shortName = (id: string) => id.replace(/^d_/, '').replace(/[_-]+/g, ' ')
const dimensions = (part: { dimensions: { x: number; y: number; z: number } }) =>
  [part.dimensions.x, part.dimensions.y, part.dimensions.z].join(' × ') + ' mm'

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

  useBobSurface(projectId, { surface: 'material-plan', ...(chosen?.areaId ? { areaId: chosen.areaId } : {}) },
    'Kaplista och inköp', 2)

  const preview = source ? preliminaryConstructionList(source) : null
  const validPreview = preview?.status === 'preliminary' ? preview : null
  const linkedNeeds = (data?.needs.items ?? []).filter(item => chosen && item.artifactId === chosen.id
    && item.artifactRevision === chosen.revision && !item.artifactChanged && !item.targetChanged
    && !item.stockChanged && !item.componentChanged)
  const currentPlans = (data?.cutPlans.items ?? []).filter(item => chosen && item.artifact_id === chosen.id
    && item.artifact_revision === chosen.revision && item.source_state === 'current')
  const currentPlan = currentPlans[0]
  const area = data?.areas.find(item => item.id === chosen?.areaId)
  const areaQuery = chosen?.areaId ? '?area=' + encodeURIComponent(chosen.areaId) : ''
  const currentNeedCoverage = validPreview && validPreview.parts.length > 0
    && validPreview.parts.every(part => linkedNeeds.some(need => need.artifactId === chosen?.id
      && need.artifactRevision === chosen?.revision && need.name))
  // A count of requirements is not proof of per-definition coverage or approved procurement.
  const statusLabel = sourceLoading ? 'Läser konstruktionskälla' : validPreview
    ? 'Preliminärt underlag' : preview?.status === 'changed' ? 'Källan har ändrats' : 'Behöver kompletteras'

  const changeArea = (next: string) => setParams(next ? { area: next } : {})
  const choose = (id: string) => setParams({ ...(areaFilter ? { area: areaFilter } : {}), construction: id })

  return <div className="page build-preparation">
    <Link to="/project" className="btn" style={{ marginBottom: 'var(--space-3)' }}>
      <Icon name="arrow-left" size={16} /> Projekt
    </Link>
    <div className="page-head">
      <div>
        <h1 className="page-title">Kaplista &amp; inköp</h1>
        <p className="page-sub">Samma konstruktion ger underlag för delar, kapning och materialinköp. Här framgår vad som går att använda och vad som återstår.</p>
      </div>
    </div>

    {!db.authEnabled() && <section className="card" style={pageCard}>Öppna ett anslutet projekt för att se sparade byggunderlag.</section>}
    {db.authEnabled() && loading && !data && <Loading label="Läser projektets byggunderlag…" />}
    {db.authEnabled() && error && !data && <section className="card" role="alert" style={pageCard}>
      <p>Byggunderlaget kunde inte läsas. Ingen projektdata har ändrats.</p>
      <button className="btn" onClick={() => setRetry(value => value + 1)}>Försök igen</button>
    </section>}

    {data && <>
      <section className="card" style={pageCard} aria-label="Välj konstruktionskälla">
        <div className="fact-filters">
          <label>
            <strong>Område</strong>
            <select className="input" value={areaFilter} onChange={event => changeArea(event.target.value)}>
              <option value="">Alla områden</option>
              {data.areas.filter(item => !item.archivedAt).map(item =>
                <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {!!filtered.length && <label>
            <strong>Aktuell konstruktion</strong>
            <select className="input" value={chosen?.id ?? ''} onChange={event => choose(event.target.value)}>
              {filtered.map(head => <option key={head.id} value={head.id}>{head.title} · v{head.revision}</option>)}
            </select>
          </label>}
        </div>
        {!filtered.length && <p>Ingen aktiv, sparad konstruktion hittades i detta område. <Link to={'/artifacts' + (areaFilter ? '?area=' + encodeURIComponent(areaFilter) : '')}>Visa ritningar och konstruktionsunderlag</Link>.</p>}
        {chosen && <p className="foundation-hint">Källa: {area?.name ?? 'Projektet'} · konstruktionsversion {chosen.revision}. Visade resultat sparas inte som nya materialbehov.</p>}
      </section>

      {chosen && <section className="card" style={{ ...pageCard, marginTop: 'var(--section-gap)' }} aria-label="Preliminär kaplista">
        <div className="foundation-heading">
          <div>
            <h2 style={{ marginBottom: 5 }}>Preliminär kaplista</h2>
            <p className="foundation-hint" style={{ margin: 0 }}>{statusLabel}</p>
          </div>
          {validPreview && <a className="btn" download={'preliminar-kaplista-v' + validPreview.revision + '.csv'}
            href={'data:text/csv;charset=utf-8,' + encodeURIComponent(preliminaryCutCsv(validPreview))}>
            <Icon name="download" size={16} /> CSV
          </a>}
        </div>
        <p className="solution-attention">Inte godkänd för kapning. Måtten är okapade ämnesmått från sparad geometri, inte optimerade sågkap, materialåtgång eller verifierad bärande konstruktion.</p>
        {sourceLoading && <Loading label="Läser exakta delar och materialversioner…" />}
        {sourceError && <div role="alert">
          <p>Den sparade konstruktionen kunde inte läsas. Använd inte en äldre kaplista.</p>
          <button className="btn" onClick={() => setRetry(value => value + 1)}>Läs om källan</button>
        </div>}
        {preview && preview.status !== 'preliminary' && <p role="status">{preview.message}</p>}
        {validPreview && <>
          <p><strong>{validPreview.partCount} tillverkningsinstanser</strong> i {validPreview.parts.length} delgrupper.
            {validPreview.referenceCount > 0 && ' ' + validPreview.referenceCount + ' referensinstanser är uttryckligen uteslutna från kap- och inköpsmängder.'}
            {validPreview.retainedCount > 0 && ' ' + validPreview.retainedCount + ' återbrukade instanser hanteras separat.'}
            {validPreview.completeItemCount > 0 && ' ' + validPreview.completeItemCount + ' färdiga artiklar hanteras separat.'}
          </p>
          {validPreview.parts.length ? <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Del</th><th>Material</th><th>Antal</th><th>Ämnesmått</th><th>Märkning</th></tr></thead>
              <tbody>{validPreview.parts.map(part => <tr key={part.definitionId}>
                <td><strong>{shortName(part.definitionId)}</strong><div className="foundation-hint">{part.definitionId}</div></td>
                <td>{part.materialName}<div className="foundation-hint">Materialversion {part.materialRevision}</div></td>
                <td>{part.quantity}</td>
                <td>{dimensions(part)}</td>
                <td>{part.partLabels.join(', ')}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p>Inga instanser är markerade för tillverkning i denna konstruktion.</p>}
        </>}
        {!!preview?.questions.length && <details style={{ marginTop: 'var(--space-3)' }}>
          <summary>Öppna konstruktionsfrågor ({preview.questions.length})</summary>
          <ul>{preview.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>
        </details>}
      </section>}

      <section className="card" style={{ ...pageCard, marginTop: 'var(--section-gap)' }} aria-label="Material och inköpsstatus">
        <h2>Material &amp; inköp</h2>
        <p className="foundation-hint">Råmaterial och inköp räknas från en verifierad kapplan, inte genom att summera delarnas mått.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--layout-gap)' }}>
          <div>
            <strong>Materialbehov</strong>
            <p>{linkedNeeds.length ? linkedNeeds.length + ' aktuella poster kopplade till konstruktionen' : 'Ingen verifierad materialbehovslista för vald version'}</p>
          </div>
          <div>
            <strong>Kapplan</strong>
            <p>{currentPlan ? 'Sparad version ' + currentPlan.revision : 'Ingen aktuell kapplan sparad'}</p>
          </div>
          <div>
            <strong>Inköp</strong>
            <p>{data.shopping.length ? data.shopping.length + ' rader i projektets inköpslista' : 'Ingen inköpsrad sparad'}</p>
          </div>
        </div>
        {data.needs.hasMore && <p className="foundation-hint">Materialbehov har fler sidor; täckningen för denna konstruktion kan inte bekräftas här.</p>}
        {data.cutPlans.hasMore && <p className="foundation-hint">Fler kapplaner finns; kontrollera dem hos Bob innan du använder en plan.</p>}
        {currentPlan && <p className="foundation-hint">Kapplanen är källversionsbunden. En sparad plan är inte i sig ett bevis på materialkvalitet, infästning, hållfasthet eller säkert arbetsutförande.</p>}
        {currentNeedCoverage && <p className="foundation-hint">Materialbehov finns för delgrupper, men leveranskedjan måste ändå verifieras innan kapning och beställning.</p>}
        <div className="foundation-actions">
          <Link className="btn" to={'/material-plan' + areaQuery}>Materialplan</Link>
          <Link className="btn" to="/shopping">Inköpslista</Link>
        </div>
      </section>

      <section className="card" style={{ ...pageCard, marginTop: 'var(--section-gap)' }} aria-label="Nästa steg">
        <h2>Nästa steg</h2>
        <p>Bob behöver kontrollera konstruktionens öppna frågor, uppdatera ritningen från aktuell källversion och därefter beräkna materialbehov och en verklig kapplan. Beställningar och kapning kräver separat granskning.</p>
        <div className="foundation-actions">
          <button className="btn btn-primary" onClick={() => openBobWithDraft(
            'Fortsätt byggunderlaget för ' + (chosen?.title ?? 'projektet')
            + (chosen ? ' från sparad konstruktionsversion ' + chosen.revision + '.' : '.')
            + ' Läs aktuella källor och öppna frågor, färdigställ och kontrollera ritningen,'
            + ' härled rollmedvetna materialbehov och kapplan via befintliga verktyg.'
            + ' Redovisa exakt vad som blockerar ett säkert inköp eller kapning; gissa inte material, beslag eller mängder.'
            + ' Fortsätt autonomt tills du har ett sparat delresultat eller en verklig blockerare.',
          )}>Be Bob färdigställa underlaget</button>
          <Link className="btn" to={'/artifacts' + areaQuery}>Visa ritningar</Link>
        </div>
      </section>
    </>}
  </div>
}
