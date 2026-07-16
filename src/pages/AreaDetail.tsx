import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as db from '../data/database'
import type { Material, MaterialStatus, Task, TaskStatus } from '../data/types'
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
import { AddImageModal, AreaModal, AssignModal, MaterialModal, TaskModal } from '../components/editors'

type Tab = 'tasks' | 'materials' | 'images'

/** Tap the status icon to walk a task through its life. Blocked goes back to work. */
const NEXT_TASK_STATUS: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo', blocked: 'doing' }
/** Tap the pill to advance a material along the buying flow. */
const NEXT_MATERIAL_STATUS: Record<MaterialStatus, MaterialStatus> = { needed: 'ordered', ordered: 'delivered', delivered: 'needed', backorder: 'ordered' }

export function AreaDetail() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [version, setVersion] = useState(0)
  const { data: area, loading } = useAsync(() => db.getArea(slug), [slug, version])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: allTasks } = useAsync(() => db.getTasks(), [version])
  const { data: allMaterials } = useAsync(() => db.getMaterials(), [version])
  const [tab, setTab] = useState<Tab>('tasks')
  const [modal, setModal] = useState<
    | { kind: 'task'; task?: Task }
    | { kind: 'material'; material?: Material }
    | { kind: 'image' }
    | { kind: 'assign'; task: Task }
    | { kind: 'area' }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))

  const reload = () => {
    setModal(null)
    setVersion((v) => v + 1)
  }
  const act = (action: () => Promise<unknown>) => {
    setError(null)
    action().then(reload).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  if (loading) return <div className="page"><Loading /></div>
  if (!area) return <div className="page"><EmptyState icon="magnifying-glass" title="Area not found" hint="It may have been renamed or removed." /></div>

  const tasks = (allTasks ?? []).filter((t) => t.areaId === area.id)
  const materials = (allMaterials ?? []).filter((m) => m.area === area.name)
  const materialCategories = [...new Set((allMaterials ?? []).map((m) => m.category))]
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
          <button className="btn" onClick={() => setModal({ kind: 'area' })}><Icon name="pencil-simple" size={15} /> Edit</button>
          <button className="btn" onClick={() => setModal({ kind: 'material' })}><Icon name="package" size={15} /> Add material</button>
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'task' })}><Icon name="plus" weight="bold" size={14} /> Add task</button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 12, background: 'var(--clay-bg)', border: '1px solid #e0b3a8', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#8a3b2b' }}>
          {error}
        </div>
      )}

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
                    <button
                      className="no-print"
                      title={`Mark as ${NEXT_TASK_STATUS[t.status]}`}
                      onClick={() => act(() => db.setTaskStatus(t.id, NEXT_TASK_STATUS[t.status]))}
                      style={{ background: 'none', border: 'none', padding: 0, display: 'flex', cursor: 'pointer' }}
                    >
                      <Icon name={chk.icon} size={22} color={chk.color} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <button
                        title="Edit task"
                        onClick={() => setModal({ kind: 'task', task: t })}
                        style={{ background: 'none', border: 'none', padding: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}
                      >
                        {t.name}
                      </button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        <SkillPill level={t.skill} />
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-soft)' }}><Icon name="clock" size={13} />{t.hours}</span>
                        {/* authored "x / y" readiness from the seed content — hide when there's nothing behind it */}
                        {total !== '0' && total !== '' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: matReady ? 'var(--leaf)' : 'var(--clay)' }}><Icon name="package" size={13} />{t.materials} materials</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} className="task-right">
                      <button
                        title="Choose who's on this task"
                        onClick={() => setModal({ kind: 'assign', task: t })}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      >
                        {t.assigneeIds.length === 0 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--clay)', border: '1.5px dashed var(--clay)', borderRadius: 999, padding: '4px 10px' }}>
                            <Icon name="user-plus" size={13} /> Assign
                          </span>
                        ) : (
                          <AvatarStack people={resolve(t.assigneeIds)} max={3} />
                        )}
                      </button>
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
                    <button
                      title="Edit material"
                      onClick={() => setModal({ kind: 'material', material: m })}
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {m.name}
                    </button>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3 }}>{m.qty} · {m.supplier} · {m.cost}</div>
                  </div>
                  <button
                    title={`Mark as ${NEXT_MATERIAL_STATUS[m.status]}`}
                    onClick={() => act(() => db.setMaterialStatus(m.id, NEXT_MATERIAL_STATUS[m.status]))}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <MaterialPill status={m.status} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'images' && (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {area.referenceImages.length === 0 && <EmptyState icon="image" title="No reference images" hint="Add finish samples so volunteers can see the intended result." />}
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
              <button
                title="Add reference image"
                onClick={() => setModal({ kind: 'image' })}
                style={{ background: 'none', border: 'none', padding: 0, display: 'flex', cursor: 'pointer' }}
              >
                <Icon name="plus-circle" size={18} color="var(--accent-2)" />
              </button>
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

      {modal?.kind === 'task' && <TaskModal areas={[area]} areaId={area.id} task={modal.task} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'material' && (
        <MaterialModal areas={[area]} categories={materialCategories} defaultArea={area.name} material={modal.material} onClose={() => setModal(null)} onDone={reload} />
      )}
      {modal?.kind === 'image' && <AddImageModal areaId={area.id} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'assign' && <AssignModal task={modal.task} people={people ?? []} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'area' && (
        <AreaModal
          people={people ?? []}
          area={area}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null)
            // A delete leaves nothing here; a rename changes the slug lookup target.
            void db.getAreas().then((all) => {
              const still = all.find((a) => a.id === area.id)
              if (!still) navigate('/areas')
              else if (still.slug !== slug) navigate(`/areas/${still.slug}`)
              else setVersion((v) => v + 1)
            })
          }}
        />
      )}
    </div>
  )
}
