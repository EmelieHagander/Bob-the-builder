import { useBobSurface } from '../lib/bobSurface'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type { Area } from '../data/types'
import { EmptyState, Icon, List, ListItem, Loading, ProgressBar, SummaryRow, useAsync, useProjectVersion } from '../components/ui'
import { AreaModal } from '../components/editors'
import { PhasePill, PhaseTransitionDialog } from '../components/PhaseUI'
import { areaNextAction, areaPhaseSummary } from '../lib/projectPhase'

export function Areas() {
  useBobSurface(db.getActiveProjectId() ?? '', { surface: 'areas' }, 'Areas')
  const [version, setVersion] = useState(0)
  const projectVersion = useProjectVersion()
  const [params, setParams] = useSearchParams()
  const archived = params.get('view') === 'archived'
  const { data: allAreas, error } = useAsync(() => db.getAreas({ includeArchived: true }), [version, projectVersion])
  const areas = allAreas?.filter(area => !!area.archivedAt === archived)
  const { data: people } = useAsync(() => db.getPeople(), [])
  const [adding, setAdding] = useState(false)
  const [phaseArea, setPhaseArea] = useState<Area | null>(null)
  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Areas</h1>
          <p className="page-sub">Areas group related steps and can progress at different speeds.</p>
          {areas && areas.length > 0 && <p className="foundation-hint" style={{ marginTop: 5 }}>{areaPhaseSummary(areas)}</p>}
        </div>
        <button className="btn btn-primary no-print" onClick={() => setAdding(true)}>
          <Icon name="plus" weight="bold" size={15} /> Add Area
        </button>
      </div>

      <div className="foundation-actions" aria-label="Area filters">
        <button className="btn" aria-pressed={!archived} onClick={() => setParams({})}>Active Areas</button>
        <button className="btn" aria-pressed={archived} onClick={() => setParams({ view: 'archived' })}>Archived Areas{allAreas ? ` · ${allAreas.filter(area => area.archivedAt).length}` : ''}</button>
      </div>

      {error ? <p role="alert">Areas could not be loaded. <button className="btn" onClick={() => setVersion(value => value + 1)}>Try again</button></p> : !areas ? (
        <Loading />
      ) : areas.length === 0 ? (
        <div style={{ marginTop: 'var(--section-gap)' }}>
          <EmptyState icon="squares-four" title={archived ? 'No archived Areas' : 'No active Areas'} hint={archived ? 'Archived Areas keep their saved work and can be restored.' : 'Add Areas when the project needs larger groups of related steps. Smaller projects can keep steps directly in the Plan.'} />
        </div>
      ) : (
        <List aria-label={archived ? 'Archived Areas' : 'Active Areas'}>
          {areas.map((area) => {
            const next = areaNextAction(area)
            return (
              <ListItem key={area.id}>
                <SummaryRow leading={<Icon name={area.icon} size={20} color="var(--brand)" />}>
                  <div className="ui-row-title"><Link to={`/areas/${area.slug}`}>{area.name}</Link>{archived ? <span className="pill">Archived</span> : <PhasePill phase={area.phase} />}</div>
                  <div className="ui-row-meta">{byId.get(area.leadId ?? '')?.name.split(' ')[0] ?? 'Unassigned'} leads · {area.taskSummary}</div>
                </SummaryRow>

                {archived ? <p className="foundation-hint">Saved work and history are kept. Open this Area to view its records or restore it.</p> : area.phase === 'build' ? (
                  <div className="area-progress-summary">
                    <ProgressBar label="Assigned" value={area.assignedPct} />
                    <ProgressBar label="Materials ready" value={area.materialsPct} />
                    <ProgressBar label="Done" value={area.donePct} />
                  </div>
                ) : (
                  <p className="ui-row-meta">{next.text}</p>
                )}

                <div className="ui-row-actions no-print">
                  <Link to={archived ? `/areas/${area.slug}` : next.to} className="btn">{archived || !area.phase ? 'Open Area' : next.title}</Link>
                  {!archived && <button className="btn" onClick={() => setPhaseArea(area)}>{area.phase ? 'Review phase' : 'Set phase'}</button>}
                </div>
                {area.description && <details className="ui-row-details"><summary>Description</summary><p className="instruction-text">{area.description}</p></details>}
              </ListItem>
            )
          })}
        </List>
      )}

      {adding && (
        <AreaModal
          people={people ?? []}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            setVersion((v) => v + 1)
          }}
        />
      )}

      {phaseArea && <PhaseTransitionDialog title={`Review phase · ${phaseArea.name}`} current={phaseArea.phase}
        onClose={() => setPhaseArea(null)} onSave={async (phase, reason) => {
          await db.setAreaPhase(phaseArea.id, phase, reason)
          setPhaseArea(null)
          setVersion(value => value + 1)
        }} />}
    </div>
  )
}
