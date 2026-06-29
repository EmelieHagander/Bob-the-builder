import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as db from '../data/database'
import {
  AvatarStack,
  EmptyState,
  Icon,
  Loading,
  MaterialPill,
  ProgressBar,
  SkillPill,
  StatusPill,
  statusCheck,
  useAsync,
} from '../components/ui'

type Tab = 'tasks' | 'materials' | 'images'

export function AreaDetail() {
  const { slug = '' } = useParams()
  const { data: area, loading } = useAsync(() => db.getArea(slug), [slug])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: allTasks } = useAsync(() => db.getTasks(), [])
  const { data: allMaterials } = useAsync(() => db.getMaterials(), [])
  const [tab, setTab] = useState<Tab>('tasks')

  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))

  if (loading) return <div className="page"><Loading /></div>
  if (!area) return <div className="page"><EmptyState icon="magnifying-glass" title="Area not found" hint="It may have been renamed or removed." /></div>

  const tasks = (allTasks ?? []).filter((t) => t.areaId === area.id)
  const materials = (allMaterials ?? []).filter((m) => m.area === area.name)
  const lead = byId.get(area.leadId ?? '')

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'tasks', label: 'Tasks', count: tasks.length },
    { key: 'materials', label: 'Materials', count: materials.length },
    { key: 'images', label: 'Reference images', count: area.referenceImages.length },
  ]

  return (
    <div className="page">
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Link to="/areas">Areas</Link>
        <Icon name="caret-right" size={12} />
        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{area.name}</span>
      </div>

      <div className="page-head" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={area.icon} size={30} color="var(--brand)" />
          </div>
          <div>
            <h1 className="page-title">{area.name}</h1>
            <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 2 }}>
              {area.description} {lead && `${lead.name.split(' ')[0]} leads · ${area.crewIds.length} in the crew.`}
            </div>
          </div>
        </div>
        <div className="cluster no-print">
          <button className="btn"><Icon name="package" size={15} /> Add material</button>
          <button className="btn btn-primary"><Icon name="plus" weight="bold" size={14} /> Add task</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginTop: 18, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none',
                border: 'none',
                padding: '9px 12px',
                marginBottom: -1,
                borderBottom: active ? '2.5px solid var(--accent)' : '2.5px solid transparent',
                fontSize: 14,
                fontWeight: active ? 700 : 600,
                color: active ? 'var(--ink)' : 'var(--ink-soft)',
              }}
            >
              {t.label} <span style={{ color: 'var(--ink-faint)', fontWeight: 600 }}>{t.count}</span>
            </button>
          )
        })}
      </div>

      <div className="area-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 22, marginTop: 18 }}>
        <div>
          {tab === 'tasks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {tasks.length === 0 && <EmptyState icon="list-plus" title="No tasks yet" hint="Add the first task so the crew knows where to start." />}
              {tasks.map((t) => {
                const chk = statusCheck(t.status)
                const [got, total] = t.materials.split('/').map((s) => s.trim())
                const matReady = got === total
                return (
                  <div key={t.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 15px' }}>
                    <Icon name={chk.icon} size={22} color={chk.color} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        <SkillPill level={t.skill} />
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-soft)' }}><Icon name="clock" size={13} />{t.hours}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: matReady ? 'var(--leaf)' : 'var(--clay)' }}><Icon name="package" size={13} />{t.materials} materials</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} className="task-right">
                      {t.assigneeIds.length === 0 ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--clay)', border: '1.5px dashed var(--clay)', borderRadius: 999, padding: '4px 10px' }}>
                          <Icon name="user-plus" size={13} /> Assign
                        </span>
                      ) : (
                        <AvatarStack people={resolve(t.assigneeIds)} max={3} />
                      )}
                      <StatusPill status={t.status} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'materials' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {materials.length === 0 && <EmptyState icon="package" title="No materials yet" hint="Add what this area needs and it flows into the shopping list." />}
              {materials.map((m) => (
                <div key={m.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 15px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{m.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3 }}>{m.qty} · {m.supplier} · {m.cost}</div>
                  </div>
                  <MaterialPill status={m.status} />
                </div>
              ))}
            </div>
          )}

          {tab === 'images' && (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {area.referenceImages.length === 0 && <EmptyState icon="image" title="No reference images" hint="Upload finish samples so volunteers can see the intended result." />}
              {area.referenceImages.map((im, i) => (
                <div
                  key={i}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 12,
                    border: '1px solid var(--line)',
                    backgroundImage: 'repeating-linear-gradient(45deg, var(--surface-2), var(--surface-2) 8px, #0000000a 8px, #0000000a 16px)',
                    display: 'flex',
                    alignItems: 'flex-end',
                    padding: 9,
                  }}
                >
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--ink-soft)' }}>{im.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Side column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Area at a glance</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ProgressBar label="Assigned" value={area.assignedPct} />
              <ProgressBar label="Materials ready" value={area.materialsPct} />
              <ProgressBar label="Done" value={area.donePct} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, paddingTop: 13, borderTop: '1px solid var(--line)' }}>
              <AvatarStack people={resolve(area.crewIds)} />
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>{area.crewIds.length} in the crew</span>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Reference images</span>
              <Icon name="plus-circle" size={18} color="var(--accent-2)" />
            </div>
            {area.referenceImages.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Nothing uploaded yet.</div>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
                {area.referenceImages.map((im, i) => (
                  <div
                    key={i}
                    style={{
                      aspectRatio: '1',
                      borderRadius: 11,
                      border: '1px solid var(--line)',
                      backgroundImage: 'repeating-linear-gradient(45deg, var(--surface-2), var(--surface-2) 7px, #0000000a 7px, #0000000a 14px)',
                      display: 'flex',
                      alignItems: 'flex-end',
                      padding: 7,
                    }}
                  >
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, color: 'var(--ink-soft)', lineHeight: 1.2 }}>{im.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
