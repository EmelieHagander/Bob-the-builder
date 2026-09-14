import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { PhasePill, PhaseRail, PhaseTransitionDialog, NextActionCard } from '../components/PhaseUI'
import { ProjectImages } from '../components/ProjectImages'
import { AvatarStack, Icon, Loading, SectionTitle, useAsync, useProjectVersion } from '../components/ui'
import { areaNextAction, areaPhaseSummary, projectFocus } from '../lib/projectPhase'

export function ProjectHome() {
  const projectVersion = useProjectVersion()
  const [version, setVersion] = useState(0)
  const [phaseOpen, setPhaseOpen] = useState(false)
  const { data: project, loading: projectLoading, error: projectError } = useAsync(() => db.getProject(), [projectVersion, version])
  const { data: areas, loading: areasLoading, error: areasError } = useAsync(() => db.getAreas(), [projectVersion, version])
  const { data: people } = useAsync(() => db.getPeople(), [projectVersion])
  const { data: next } = useAsync(() => db.getNextEvent(), [projectVersion])
  const { data: announcements } = useAsync(() => db.getAnnouncements(), [projectVersion])

  if (projectLoading && !project) return <div className="page"><Loading label="Loading project…" /></div>
  if (!project || projectError) return <div className="page"><h1 className="page-title">Project unavailable</h1><p role="alert">{projectError?.message ?? 'This project may no longer be available.'}</p></div>

  const areaItems = areas ?? []
  const focus = projectFocus(project.phase, areaItems)
  const byId = new Map((people ?? []).map(person => [person.id, person]))
  const resolve = (ids: string[]) => ids.map(id => byId.get(id)).filter((person): person is NonNullable<typeof person> => Boolean(person))

  return <div className="page">
    <div className="page-head">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
          <PhasePill phase={project.phase} prefix="Project" />
          {project.location && <span className="foundation-hint">{project.location}</span>}
        </div>
        <h1 className="page-title">{project.name}</h1>
        <p className="page-sub">{project.description || 'Keep the project moving from idea to what was actually built.'}</p>
      </div>
      <div className="cluster no-print">
        <Link to="/building" className="btn"><Icon name="house" size={15} /> Building &amp; spaces</Link>
        <button className="btn btn-primary" onClick={() => setPhaseOpen(true)}>
          <Icon name="signpost" size={15} /> {project.phase ? 'Review phase' : 'Set project phase'}
        </button>
      </div>
    </div>

    <section aria-label="Project lifecycle" style={{ marginTop: 18 }}>
      <PhaseRail phase={project.phase} />
    </section>

    <section style={{ marginTop: 18 }}>
      <NextActionCard
        eyebrow="Project focus"
        title={focus.title}
        text={focus.text}
        icon={focus.icon}
        action={!project.phase ? <button className="btn btn-primary" onClick={() => setPhaseOpen(true)}>Classify this project</button> : undefined}
      />
    </section>

    <section className="card" style={{ marginTop: 20, padding: 16 }}>
      <ProjectImages projectId={project.id} target={{ kind: 'project', id: project.id }} title="Project images" allowUpload />
    </section>

    <section style={{ marginTop: 24 }}>
      <SectionTitle action={<Link to="/areas" style={{ fontSize: 13, color: 'var(--accent-2)', fontWeight: 700 }}>All Areas</Link>}>
        Workstreams <span style={{ color: 'var(--ink-faint)', fontWeight: 600 }}>· {areaPhaseSummary(areaItems)}</span>
      </SectionTitle>
      {areasLoading ? <Loading label="Loading Areas…" /> : areasError ? <div className="card" role="status" style={{ padding: 16 }}>Area phase status is unavailable. Your saved project data is unchanged.</div>
        : !areaItems.length ? <div className="card" style={{ padding: 18 }}>
          <strong>No Areas yet</strong><p className="foundation-hint">Create workstreams for coherent parts of the project. They can later move through phases independently.</p>
          <Link to="/areas" className="btn btn-primary">Add the first Area</Link>
        </div> : <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          {areaItems.map(area => {
            const action = areaNextAction(area)
            const buildProgress = area.phase === 'build' ? area.donePct : null
            return <article key={area.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                  <Icon name={area.icon} size={20} color="var(--brand)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/areas/${area.slug}`} style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{area.name}</Link>
                  <div style={{ marginTop: 5 }}><PhasePill phase={area.phase} /></div>
                </div>
                {buildProgress !== null && <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--leaf)' }}>{buildProgress}% done</span>}
              </div>
              <p className="foundation-hint" style={{ margin: '10px 0 8px' }}>{area.taskSummary}</p>
              <Link to={action.to} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 750, color: 'var(--accent-2)' }}>
                <Icon name={action.icon} size={15} /> {action.title} <Icon name="arrow-right" size={13} />
              </Link>
            </article>
          })}
        </div>}
    </section>

    <section style={{ marginTop: 24 }} aria-label="Project tools">
      <SectionTitle>Project tools</SectionTitle>
      <div className="cluster" style={{ gap: 8 }}>
        <Link className="btn" to="/facts"><Icon name="ruler" size={15} /> Measurements &amp; existing parts</Link>
        <Link className="btn" to="/solutions"><Icon name="path" size={15} /> Solutions &amp; target</Link>
        <Link className="btn" to="/artifacts"><Icon name="blueprint" size={15} /> Plans &amp; drawings</Link>
        <Link className="btn" to="/material-plan"><Icon name="package" size={15} /> Material plan</Link>
      </div>
      <p className="foundation-hint" style={{ marginBottom: 0 }}>These stay available across phases. The current phase changes emphasis, not access to project truth.</p>
    </section>

    <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 20, marginTop: 26 }}>
      <section>
        <SectionTitle icon="megaphone" color="var(--accent-2)" action={<Link to="/announcements" style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-2)' }}>Announcements</Link>}>Project updates</SectionTitle>
        <div className="card" style={{ padding: 16 }}>
          {announcements?.[0] ? <><p style={{ margin: 0, lineHeight: 1.45 }}>{announcements[0].text}</p><p className="foundation-hint" style={{ marginBottom: 0 }}>{announcements[0].time}</p></>
            : <p className="foundation-hint" style={{ margin: 0 }}>No announcements yet.</p>}
        </div>
      </section>
      <section>
        <SectionTitle icon="calendar-dots" color="var(--honey)">Next build day</SectionTitle>
        <div className="card" style={{ padding: 16 }}>
          {next ? <>
            <strong>{next.title}</strong>
            <p className="foundation-hint">{next.day} · {next.time} · {next.place}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><AvatarStack people={resolve(next.attendeeIds)} max={5} /><span className="foundation-hint">{next.spots} spots</span></div>
            <Link to={`/events/${next.slug}`} className="btn" style={{ marginTop: 12 }}>Open build day</Link>
          </> : <><p className="foundation-hint">Nothing scheduled yet. Calendar timing is separate from lifecycle phase.</p><Link to="/events" className="btn">Events</Link></>}
        </div>
      </section>
    </div>

    {phaseOpen && <PhaseTransitionDialog title="Review Project phase" current={project.phase} onClose={() => setPhaseOpen(false)}
      onSave={async (phase, reason) => { await db.setProjectPhase(phase, reason); setPhaseOpen(false); setVersion(value => value + 1) }} />}
  </div>
}