import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { AvatarStack, Icon, Loading, ProgressBar, Ring, SectionTitle, useAsync } from '../components/ui'
import { useAuthTick } from '../components/Layout'
import { TaskModal } from '../components/editors'
import { ProjectImages } from '../components/ProjectImages'

export function Dashboard() {
  const [version, setVersion] = useState(0)
  const [addingTask, setAddingTask] = useState(false)
  const { data: project } = useAsync(() => db.getProject(), [])
  const { data: stats } = useAsync(() => db.getDashboardStats(), [version])
  const { data: areas } = useAsync(() => db.getAreas(), [version])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: next } = useAsync(() => db.getNextEvent(), [])
  const { data: attention } = useAsync(() => db.getAttention(), [])
  const { data: announcements } = useAsync(() => db.getAnnouncements(), [])
  const tick = useAuthTick()
  const { data: me } = useAsync(() => db.getCurrentUser(), [tick])
  const projectId = project?.id ?? ''
  const { data: planning, loading: planningLoading, error: planningError } = useAsync(
    () => projectId && db.authEnabled()
      ? Promise.all([
          db.getProjectFacts(projectId, 'measurement', { status: 'missing' }, 0),
          db.getSelectedTarget(projectId),
          db.getProjectArtifacts(projectId, '', false, 0),
        ]).then(([missing, target, artifacts]) => ({ missing, target, artifacts }))
      : Promise.resolve(null),
    [projectId, version],
  )

  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const areaById = new Map((areas ?? []).map((area) => [area.id, area.name]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
  const missingMeasurements = (planning?.missing.items ?? []).filter((item) => item.kind === 'measurement')
  const selectedTarget = planning?.target.solution ?? null
  const selectedDecision = planning?.target.decision ?? null
  const hasCurrentDrawing = Boolean(selectedTarget && selectedDecision && planning?.artifacts.items.some((artifact) =>
    artifact.targetRevision === selectedDecision.revision
    && artifact.solutionId === selectedTarget.id
    && artifact.solutionRevision === selectedTarget.revision,
  ))

  const nextPlanningAction = missingMeasurements.length > 0
    ? {
        to: '/facts?kind=measurement&status=missing',
        icon: 'ruler',
        eyebrow: 'Next step',
        title: `Measure ${missingMeasurements.length} ${missingMeasurements.length === 1 ? 'missing dimension' : 'missing dimensions'}`,
        text: missingMeasurements[0]
          ? `Start with ${missingMeasurements[0].subject}${missingMeasurements[0].areaId ? ` in ${areaById.get(missingMeasurements[0].areaId) ?? 'its area'}` : ''}.`
          : 'Collect the missing measurements before planning from assumptions.',
      }
    : !selectedTarget
      ? {
          to: '/solutions',
          icon: 'path',
          eyebrow: 'Next step',
          title: 'Choose the shared target',
          text: 'Your recorded measurements are clear enough to move on to comparing and selecting a solution.',
        }
      : !hasCurrentDrawing
        ? {
            to: '/artifacts',
            icon: 'blueprint',
            eyebrow: 'Next step',
            title: 'Turn the target into a drawing',
            text: `“${selectedTarget.title}” is selected. Keep the next plan tied to that exact version and its evidence.`,
          }
        : {
            to: '/areas',
            icon: 'check-circle',
            eyebrow: 'Next step',
            title: 'Review what the crew can do next',
            text: 'The current planning foundation has measurements, a selected target and a drawing tied to that target. Review areas and tasks for the next build action.',
          }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">God morgon{me ? `, ${me.name.split(' ')[0]}` : ''}!</h1>
          <p className="page-sub">
            {project
              ? `Here's where ${project.name} stands today.${next ? ` The big build day is ${next.day}.` : ''}`
              : ''}
          </p>
        </div>
        <div className="cluster no-print">
          <Link to="/announcements" className="btn">
            <Icon name="megaphone" size={16} /> Post update
          </Link>
          <button
            className="btn btn-primary"
            onClick={() => setAddingTask(true)}
            disabled={(areas ?? []).length === 0}
            title={(areas ?? []).length === 0 ? 'Add an area first — tasks live inside areas' : undefined}
          >
            <Icon name="plus" weight="bold" size={15} /> New task
          </button>
        </div>
      </div>

      {db.authEnabled() && project && (
        <section aria-label="Planning next steps" style={{ marginTop: 20 }}>
          {planningLoading ? (
            <div className="card" style={{ padding: 16 }}><Loading label="Checking what the project needs next…" /></div>
          ) : planningError ? (
            <div className="card" role="status" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Icon name="warning-circle" size={20} color="var(--honey)" />
                <div><strong>Planning status is unavailable</strong><div className="foundation-hint">Your saved project data is unchanged. Open the planning surfaces directly while this summary is unavailable.</div></div>
              </div>
            </div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
              <Link to={nextPlanningAction.to} className="card" style={{ padding: 18, display: 'block', borderColor: 'var(--accent-2)' }}>
                <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                    <Icon name={nextPlanningAction.icon} size={21} color="var(--accent-2)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 750, color: 'var(--accent-2)' }}>{nextPlanningAction.eyebrow}</div>
                    <h2 className="font-display" style={{ fontSize: 20, lineHeight: 1.12, margin: '4px 0 5px' }}>{nextPlanningAction.title}</h2>
                    <p className="foundation-hint" style={{ margin: 0 }}>{nextPlanningAction.text}</p>
                    <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
                      Open <Icon name="arrow-right" size={14} />
                    </div>
                  </div>
                </div>
              </Link>

              <div className="card" style={{ padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 750, color: 'var(--clay)' }}>Still missing</div>
                    <h2 className="font-display" style={{ fontSize: 19, margin: '4px 0 8px' }}>
                      {missingMeasurements.length ? `${missingMeasurements.length} to measure` : 'Planning gaps'}
                    </h2>
                  </div>
                  {missingMeasurements.length > 0 && <Link to="/facts?kind=measurement&status=missing" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-2)' }}>View all</Link>}
                </div>
                {missingMeasurements.length > 0 ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {missingMeasurements.slice(0, 3).map((measurement) => (
                      <Link key={measurement.id} to={`/facts?kind=measurement&status=missing${measurement.areaId ? `&area=${measurement.areaId}` : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', color: 'inherit' }}>
                        <Icon name={measurement.required ? 'warning-circle' : 'circle-dashed'} size={17} color={measurement.required ? 'var(--clay)' : 'var(--ink-faint)'} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{measurement.subject}</div>
                          <div className="foundation-hint">{measurement.truth === 'estimated' ? 'Estimated — verify' : 'Not measured yet'}{measurement.areaId ? ` · ${areaById.get(measurement.areaId) ?? 'Area'}` : ''}</div>
                        </div>
                        <Icon name="arrow-right" size={14} color="var(--ink-faint)" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13.5 }}><Icon name="check" size={16} color="var(--leaf)" /> No unknown or estimated measurements</div>
                    {!selectedTarget && <Link to="/solutions" style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13.5, color: 'inherit' }}><Icon name="circle-dashed" size={16} color="var(--clay)" /> No selected solution yet</Link>}
                    {selectedTarget && !hasCurrentDrawing && <Link to="/artifacts" style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13.5, color: 'inherit' }}><Icon name="circle-dashed" size={16} color="var(--clay)" /> No drawing tied to the selected solution yet</Link>}
                    {selectedTarget && hasCurrentDrawing && <div style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13.5 }}><Icon name="check" size={16} color="var(--leaf)" /> Target and matching drawing are recorded</div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Stat strip */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 22 }}>
        {stats?.map((s) => (
          <div key={s.label} style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '14px 15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>
              <Icon name={s.icon} weight="fill" size={15} color={s.color} /> {s.label}
            </div>
            <div className="font-display" style={{ fontWeight: 700, fontSize: 24, marginTop: 6 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 22, marginTop: 24 }}>
        {/* Areas */}
        <section>
          <SectionTitle action={<Link to="/areas" style={{ fontSize: 13, color: 'var(--accent-2)', fontWeight: 600 }}>View all</Link>}>
            Areas <span style={{ color: 'var(--ink-faint)', fontWeight: 600 }}>· {areas?.length ?? 0}</span>
          </SectionTitle>
          {!areas ? (
            <Loading />
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
              {areas.map((a) => {
                const overall = Math.round((a.assignedPct + a.materialsPct + a.donePct) / 3)
                return (
                  <Link key={a.id} to={`/areas/${a.slug}`} className="card" style={{ padding: 15, display: 'block' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={a.icon} size={21} color="var(--brand)" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{a.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{byId.get(a.leadId ?? '')?.name.split(' ')[0]} leads</div>
                      </div>
                      <Ring value={overall} />
                    </div>
                    <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <ProgressBar label="Assigned" value={a.assignedPct} />
                      <ProgressBar label="Materials" value={a.materialsPct} />
                      <ProgressBar label="Done" value={a.donePct} />
                    </div>
                    <div style={{ marginTop: 11, fontSize: 12, color: 'var(--ink-faint)' }}>{a.taskSummary}</div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* Right column */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {next && (
            <Link to={`/events/${next.slug}`} style={{ background: 'var(--brand)', color: 'var(--brand-ink)', borderRadius: 'var(--r)', padding: '17px 17px 16px', display: 'block' }}>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#ffffff90', fontWeight: 700 }}>Next build day</div>
              <div className="font-display" style={{ fontWeight: 700, fontSize: 19, marginTop: 4 }}>{next.title}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, color: '#ffffffd0' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="calendar-dots" size={15} color="var(--accent)" />{next.day}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="clock" size={15} color="var(--accent)" />{next.time}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                <AvatarStack people={resolve(next.attendeeIds)} max={5} />
                <span style={{ fontSize: 12.5, color: '#ffffffc0', fontWeight: 600 }}>{next.spots} spots</span>
              </div>
              <div style={{ marginTop: 13, background: '#ffffff14', borderRadius: 10, padding: '9px 11px', fontSize: 12, color: '#ffffffd5', display: 'flex', gap: 8 }}>
                <Icon name="cooking-pot" weight="fill" size={15} color="var(--accent)" style={{ marginTop: 1 }} />
                <span>{next.food}</span>
              </div>
            </Link>
          )}

          <div className="card" style={{ padding: 16 }}>
            <SectionTitle icon="warning-circle" color="var(--clay)">Needs attention</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {attention?.map((x, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', background: x.tone === 'clay' ? 'var(--clay-bg)' : 'var(--honey-bg)' }}>
                    <Icon name={x.icon} weight="fill" size={14} color={x.tone === 'clay' ? 'var(--clay)' : '#9A6313'} />
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.35 }}>{x.text}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <SectionTitle icon="megaphone" color="var(--accent-2)" action={<Link to="/announcements" style={{ fontSize: 13, color: 'var(--accent-2)', fontWeight: 600 }}>All</Link>}>
              Announcements
            </SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {announcements?.slice(0, 2).map((p) => {
                const who = byId.get(p.authorId)
                return (
                  <div key={p.id} style={{ display: 'flex', gap: 10 }}>
                    {who && <AvatarStack people={[who]} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                        <span style={{ fontWeight: 700 }}>{who?.name.split(' ')[0]}</span>
                        <span style={{ color: 'var(--ink-faint)' }}>{p.time}</span>
                        {p.pinned && <Icon name="push-pin" weight="fill" size={12} color="var(--accent-2)" />}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.4, marginTop: 2 }}>{p.text}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </div>

      <Link to="/solutions" className="card foundation-section facts-entry">
        <Icon name="path" size={24} /><div><h3>Solutions & target</h3>
          <p className="foundation-hint">Keep alternatives, their evidence and the selected project version.</p></div><Icon name="arrow-right" size={20} />
      </Link>
      <Link to="/artifacts" className="card foundation-section facts-entry">
        <Icon name="blueprint" size={24} /><div><h3>Plans & drawings</h3>
          <p className="foundation-hint">Keep the exact drawing version, selected target and measurements the crew is building from.</p></div><Icon name="arrow-right" size={20} />
      </Link>
      <Link to="/facts" className="card foundation-section facts-entry">
        <Icon name="ruler" size={24} /><div><h3>Measurements & existing parts</h3>
          <p className="foundation-hint">Record lengths, track unknowns and keep the history of parts you may reuse.</p></div>
        <Icon name="arrow-right" size={20} />
      </Link>
      {project && <div className="card foundation-section"><ProjectImages projectId={project.id} target={{ kind: 'project', id: project.id }} title="Project images" /></div>}

      {addingTask && (
        <TaskModal
          areas={areas ?? []}
          onClose={() => setAddingTask(false)}
          onDone={() => {
            setAddingTask(false)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}
