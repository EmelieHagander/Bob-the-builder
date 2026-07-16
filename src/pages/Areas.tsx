import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { EmptyState, Icon, Loading, ProgressBar, Ring, useAsync } from '../components/ui'
import { NewAreaModal } from '../components/editors'

export function Areas() {
  const [version, setVersion] = useState(0)
  const { data: areas } = useAsync(() => db.getAreas(), [version])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const [adding, setAdding] = useState(false)
  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Areas</h1>
          <p className="page-sub">Every work zone in the build — drill into one to manage its tasks and materials.</p>
        </div>
        <button className="btn btn-primary no-print" onClick={() => setAdding(true)}>
          <Icon name="plus" weight="bold" size={15} /> Add area
        </button>
      </div>

      {!areas ? (
        <Loading />
      ) : areas.length === 0 ? (
        <div style={{ marginTop: 22 }}>
          <EmptyState icon="squares-four" title="No areas yet" hint="Split the build into zones — kitchen, roof, garden — and add the first one." />
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginTop: 22 }}>
          {areas.map((a) => {
            const overall = Math.round((a.assignedPct + a.materialsPct + a.donePct) / 3)
            return (
              <Link key={a.id} to={`/areas/${a.slug}`} className="card" style={{ padding: 17, display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={a.icon} size={25} color="var(--brand)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{a.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{byId.get(a.leadId ?? '')?.name.split(' ')[0] ?? 'Unassigned'} leads</div>
                  </div>
                  <Ring value={overall} size={50} />
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 12, lineHeight: 1.4 }}>{a.description}</p>
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <ProgressBar label="Assigned" value={a.assignedPct} />
                  <ProgressBar label="Materials" value={a.materialsPct} />
                  <ProgressBar label="Done" value={a.donePct} />
                </div>
                <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="list-checks" size={14} /> {a.taskSummary}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {adding && (
        <NewAreaModal
          people={people ?? []}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}
