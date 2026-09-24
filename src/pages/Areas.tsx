import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { Area } from '../data/types'
import { EmptyState, Icon, Loading, ProgressBar, Ring, useAsync } from '../components/ui'
import { AreaModal } from '../components/editors'
import { PhasePill, PhaseTransitionDialog } from '../components/PhaseUI'
import { areaNextAction, areaPhaseSummary } from '../lib/projectPhase'

export function Areas() {
  const [version, setVersion] = useState(0)
  const { data: areas } = useAsync(() => db.getAreas(), [version])
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

      {!areas ? (
        <Loading />
      ) : areas.length === 0 ? (
        <div style={{ marginTop: 22 }}>
          <EmptyState icon="squares-four" title="No Areas yet" hint="Add Areas when the project needs larger groups of related steps. Smaller projects can keep steps directly in the Plan." />
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginTop: 22 }}>
          {areas.map((area) => {
            const overall = Math.round((area.assignedPct + area.materialsPct + area.donePct) / 3)
            const next = areaNextAction(area)
            return (
              <article key={area.id} className="card" style={{ padding: 17 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                    <Icon name={area.icon} size={25} color="var(--brand)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link to={`/areas/${area.slug}`} style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{area.name}</Link>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{byId.get(area.leadId ?? '')?.name.split(' ')[0] ?? 'Unassigned'} leads</div>
                    <div style={{ marginTop: 7 }}><PhasePill phase={area.phase} /></div>
                  </div>
                  {area.phase === 'build' && <Ring value={overall} size={50} />}
                </div>

                <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '12px 0 0', lineHeight: 1.4 }}>{area.description}</p>

                {area.phase === 'build' ? (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <ProgressBar label="Assigned" value={area.assignedPct} />
                    <ProgressBar label="Materials ready" value={area.materialsPct} />
                    <ProgressBar label="Done" value={area.donePct} />
                  </div>
                ) : (
                  <div style={{ marginTop: 12, padding: '10px 11px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 750 }}>
                      <Icon name={next.icon} size={15} color="var(--accent-2)" /> {next.title}
                    </div>
                    <p className="foundation-hint" style={{ margin: '4px 0 0' }}>{next.text}</p>
                  </div>
                )}

                <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="list-checks" size={14} /> {area.taskSummary}
                </div>

                <div className="foundation-actions no-print" style={{ marginTop: 13 }}>
                  <Link to={next.to} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{area.phase ? next.title : 'Open Area'}</Link>
                  <button className="btn" onClick={() => setPhaseArea(area)}>{area.phase ? 'Review phase' : 'Set phase'}</button>
                </div>
              </article>
            )
          })}
        </div>
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
