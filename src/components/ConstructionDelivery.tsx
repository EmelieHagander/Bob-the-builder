import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { ArtifactVersion } from '../data/artifacts'
import type { ConstructionDeliveryResource } from '../../supabase/functions/_shared/construction-delivery'
import { drawingUrl } from './ProjectDrawings'
import { savedOutputUrl } from '../lib/savedOutputNavigation'
import { Loading, LoadFailed, useAsync } from './ui'

const labels: Record<ConstructionDeliveryResource, string> = { drawings: 'Drawings', requirements: 'Material needs', cut_plans: 'Cut plans' }

/** A paged index, never a delivery-complete or fabrication approval badge. */
export function ConstructionDelivery({ value }: { value: ArtifactVersion }) {
  const [resource, setResource] = useState<ConstructionDeliveryResource>('drawings')
  const [cursors, setCursors] = useState<(string | null)[]>([null]), [attempt, retry] = useState(0)
  const cursor = cursors.at(-1) ?? null
  const { data, loading, error } = useAsync(async () => ({ cursor, page: await db.getConstructionDelivery(value.projectId, value.id, value.revision, resource, cursor) }),
    [value.projectId, value.id, value.revision, resource, cursor, attempt], { timeoutMs: 20000 })
  const page = !loading && !error && data?.cursor === cursor && data.page.resource === resource
    && data.page.artifact_id === value.id && data.page.revision === value.revision ? data.page : null
  return <section aria-label="Saved construction outputs">
    <h3>Saved outputs</h3>
    <p>Results saved from construction version {value.revision}. Open each result to read its contents and current source checks.</p>
    <div className="foundation-actions" role="group" aria-label="Output type">
      {(Object.keys(labels) as ConstructionDeliveryResource[]).map(kind => <button key={kind} className="btn" aria-pressed={resource === kind}
        onClick={() => { setResource(kind); setCursors([null]) }}>{labels[kind]}</button>)}
    </div>
    {loading ? <Loading label="Reading saved outputs…" /> : error ? <LoadFailed what="The saved outputs" onRetry={() => retry(n => n + 1)} /> : null}
    {page && <>
      {page.source_state !== 'current' && <p className="solution-attention">{page.source_state === 'changed' ? 'The construction or its sources have changed.' : 'Current source checks are unavailable.'} These results retain their saved versions.</p>}
      {!page.records.length && <p>No {labels[resource].toLowerCase()} saved from this construction version{cursor ? ' on this page' : ''}.</p>}
      <div className="fact-list">{page.records.map(row => <article className="card fact-card" key={row.id}>
        <h4>{row.title || row.name || 'Saved cut plan'}</h4>
        <p>Version {row.revision}{row.current_revision !== row.revision ? ` · newer version ${row.current_revision} exists` : ''}{row.archived ? ' · archived' : ''}</p>
        {resource === 'drawings' && <p className="foundation-hint">{row.step_links?.some(link => link.in_current_plan) ? 'Linked to current project work.' : 'No link to a current project step.'}</p>}
        <Link className="btn" to={resource === 'drawings' ? drawingUrl({ id: row.id, revision: row.revision, area_id: value.areaId })
          : savedOutputUrl(resource, row.id, row.revision, { id: value.id, revision: value.revision, areaId: value.areaId })}>
          {resource === 'drawings' ? 'Open saved drawing' : resource === 'requirements' ? 'Open saved material need' : 'Open saved cut plan'}
        </Link>
      </article>)}</div>
      <div className="foundation-actions">
        {cursors.length > 1 && <button className="btn" onClick={() => setCursors(all => all.slice(0, -1))}>Previous results</button>}
        {page.truncated && <button className="btn" onClick={() => setCursors(all => [...all, page.next_after])}>More results</button>}
      </div>
      <p className="foundation-hint">Saved results can still need work. Material needs and hypothetical cut plans do not approve cutting or purchases.</p>
    </>}
  </section>
}
