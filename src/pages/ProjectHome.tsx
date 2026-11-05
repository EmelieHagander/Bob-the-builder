import { formatEventDay } from '../lib/eventDay'
import { useBobSurface } from '../lib/bobSurface'
import { ProjectStepWorkspace } from '../components/ProjectStepWorkspace'
import { ProjectDrawings } from '../components/ProjectDrawings'
import { useEffect, useState, type ReactNode } from 'react'
import type { BuildEvent } from '../data/types'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import { PhasePill, PhaseRail, PhaseTransitionDialog, NextActionCard } from '../components/PhaseUI'
import { ProjectThumbnail } from '../components/ProjectThumbnail'
import { ProjectMetadata } from '../components/ProjectMetadata'
import { ProjectImages } from '../components/ProjectImages'
import { ProjectStart } from '../components/ProjectStart'
import { FormError } from '../components/form'
import { AvatarStack, Icon, Loading, SectionTitle, useAsync, useProjectVersion } from '../components/ui'
import { areaNextAction, areaPhaseSummary, projectFocus } from '../lib/projectPhase'
import { userErrorMessage } from '../lib/userErrors'

export function ProjectHome() {
  const projectVersion = useProjectVersion()
  const [version, setVersion] = useState(0)
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [imagesOpen, setImagesOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const media = params.get('media')
  const showingMedia = db.authEnabled() && (media === 'photos' || media === 'drawings')
  const mediaUrl = (section?: 'photos' | 'drawings') => {
    const next = new URLSearchParams(params)
    if (section) next.set('media', section)
    else next.delete('media')
    return { pathname: '/project', search: next.toString() }
  }
  const { data: project, loading: projectLoading, error: projectError } = useAsync(() => db.getProject(), [projectVersion, version])
  const { data: areas, loading: areasLoading, error: areasError } = useAsync(() => db.getAreas(), [projectVersion, version])
  const { data: people } = useAsync(() => db.getPeople(), [projectVersion])
  const connected = db.authEnabled()
  const { data: demoTasks } = useAsync(() => connected ? Promise.resolve(null) : db.getTasks(), [connected, projectVersion, version])
  const { data: next } = useAsync(() => db.getNextEvent(), [projectVersion])
  const { data: announcements } = useAsync(() => db.getAnnouncements(), [projectVersion])
  const projectId = project?.id ?? ''
  const [mediaVersion, setMediaVersion] = useState(0)
  useEffect(() => {
    const refresh = () => setMediaVersion(v => v + 1)
    window.addEventListener(db.MEDIA_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(db.MEDIA_CHANGED_EVENT, refresh)
  }, [])
  const { data: overview } = useAsync(() => db.getAccountProjectOverview(projectId ? [projectId] : []), [projectId, projectVersion, version, mediaVersion])
  const { data: thumbnailId } = useAsync(() => projectId ? db.getProjectThumbnail(projectId) : Promise.resolve(null), [projectId, projectVersion, mediaVersion])
  useBobSurface(projectId, { surface: 'project' }, 'Project')
  if (projectLoading && !project) return <div className="page"><Loading label="Loading project…" /></div>
  if (!project || projectError) return <div className="page"><h1 className="page-title">Project unavailable</h1><p role="alert">{projectError ? userErrorMessage(projectError, 'This project may no longer be available.') : 'This project may no longer be available.'}</p></div>

  const areaItems = areas ?? []
  const building = project.phase === 'build'
  // Start this build: big when a build day exists, small once planning is reached.
  const startable = !building && project.phase !== 'complete'
  const startSize = !startable ? null : next ? 'large' : project.phase === 'planning' ? 'small' : null
  const startBuild = async () => {
    if (starting) return
    setStarting(true); setStartError('')
    try {
      await db.setProjectPhase('build', next ? `Build started for ${next.title}.` : 'Build started from Project Home.')
      setVersion(value => value + 1)
      if (next) navigate('/today')
    } catch (err) {
      setStartError(userErrorMessage(err, 'Could not start the build. Try again.'))
    } finally { setStarting(false) }
  }
  const focus = projectFocus(project.phase, areaItems)
  const byId = new Map((people ?? []).map(person => [person.id, person]))
  const resolve = (ids: string[]) => ids.map(id => byId.get(id)).filter((person): person is NonNullable<typeof person> => Boolean(person))
  const areaSummary = areasLoading ? 'Loading Areas…' : areasError ? 'Area status unavailable' : areaPhaseSummary(areaItems)
  const startButton = startSize === 'small' && <button className={connected ? 'btn' : 'btn btn-primary'} disabled={starting} onClick={() => void startBuild()}>
    <Icon name="hammer" size={16} /> {starting ? 'Starting…' : 'Start this build'}
  </button>
  return <div className={connected ? "page project-home project-home-connected" : "page project-home"}>
    <div className="page-head">
      <div className="project-header-identity">
        {thumbnailId && <ProjectThumbnail projectId={project.id} mediaId={thumbnailId} />}
      <div>
        <div className="project-phase-row">
          <button className="project-phase-control" aria-label={project.phase ? 'Review phase' : 'Set project phase'}
            title={project.phase ? 'Review phase' : 'Set project phase'} onClick={() => setPhaseOpen(true)}>
            <PhasePill phase={project.phase} prefix="Project" /><Icon name="caret-down" size={12} />
          </button>

        </div>
        <h1 className="page-title">{project.name}</h1>
        {!connected && <><ProjectMetadata overview={overview?.[0]} /><p className="page-sub project-area-summary">{areaSummary}</p></>}
      </div></div>
      <div className="cluster no-print">
        {!connected && startButton}
        {connected
          ? <Link className="btn media-entry" aria-label={showingMedia ? 'Back to plan' : 'Images & drawings'} to={mediaUrl(showingMedia ? undefined : 'drawings')}>
              <Icon name={showingMedia ? 'arrow-left' : 'images'} size={16} />{showingMedia ? 'Back to plan' : <span>Images &amp; drawings</span>}
            </Link>
          : <Link className="btn" to="/artifacts">Drawings</Link>}

      </div>
    </div>

    {showingMedia ? <section className="project-media" aria-label="Images and drawings">
      <nav aria-label="Project media" className="media-tabs">
        <Link to={mediaUrl('drawings')} replace aria-current={media === 'drawings' ? 'page' : undefined}>Drawings</Link>
        <Link to={mediaUrl('photos')} replace aria-current={media === 'photos' ? 'page' : undefined}>Photos</Link>
      </nav>
      {media === 'drawings' ? <ProjectDrawings key={project.id} projectId={project.id} />
        : <ProjectImages key={project.id} projectId={project.id} target={{kind:'project',id:project.id}} title="Project images" allowUpload allowThumbnail />}
    </section> : <>
    {startError && <FormError>Could not start the build: {startError}</FormError>}

    {building && <BuildFocus next={next} />}
    {connected && <ProjectStepWorkspace key={`plan:${project.id}`} projectId={project.id} building={building} />}
    {!connected && !building && areas && demoTasks && !areas.length && !demoTasks.length && <ProjectStart />}

    {startSize === 'large' && next && <section className="card build-start" aria-labelledby="build-start-title">
      <div className="build-start-copy">
        <h2 id="build-start-title" className="font-display">Ready to build?</h2>
        <p className="foundation-hint">{next.title} · {formatEventDay(next.day)}{next.time ? ` · ${next.time}` : ''}. Starting switches this project to Build mode and puts the build-day work first.</p>
      </div>
      <button className="btn btn-primary build-start-button" disabled={starting} onClick={() => void startBuild()}>
        <Icon name="hammer" size={22} /> {starting ? 'Starting…' : 'Start this build'}
      </button>
    </section>}

    <details className="project-reference" id="project-information" open={!connected || undefined}>
      <summary>Project information</summary>
    {project.location && <p className="foundation-hint">{project.location}</p>}
    {project.description && <details id="project-description" className="project-description">
      <summary>Project description</summary>
      <p className="instruction-text">{project.description}</p>
      <Link to="/facts" className="project-detail-link">Measurements &amp; existing parts <Icon name="arrow-right" size={15} /></Link>
    </details>}

    <PlanningTools folded={connected || building}>
    {connected && startButton}
    <nav className="project-shortcuts" aria-label="Project tools">
      <Link className="btn" to="/build-lists"><Icon name="package" size={18} /><span>Cut list &amp; purchasing</span></Link>
      <Link className="btn" to="/facts" aria-label="Measurements & existing parts"><Icon name="ruler" size={18} /><span>Measurements</span></Link>
      <Link className="btn" to="/material-plan"><Icon name="package" size={18} /><span>Material plan</span></Link>
      <Link className="btn" to="/solutions"><Icon name="path" size={18} /><span>Solutions &amp; target</span></Link>
    </nav>

    <details id="project-context" className="project-context-details">
      <summary>Project focus &amp; lifecycle</summary>
      {connected && <><ProjectMetadata overview={overview?.[0]} /><p className="foundation-hint">{areaSummary}</p></>}
      <section aria-label="Project lifecycle"><PhaseRail phase={project.phase} compact /></section>
      <section style={{ marginTop: 'var(--section-gap)' }}>
      <NextActionCard
        eyebrow="Project focus"
        title={focus.title}
        text={focus.text}
        icon={focus.icon}
        action={!project.phase ? <button className="btn btn-primary" onClick={() => setPhaseOpen(true)}>Classify this project</button> : undefined}
      />
      </section>
      <Link to="/building" className="project-detail-link"><Icon name="house" size={16} /> Building &amp; spaces <Icon name="arrow-right" size={15} /></Link>
    </details>

    </PlanningTools>

    {!connected && <details className="card project-photo-details project-disclosure" id="project-images" onToggle={event => setImagesOpen(event.currentTarget.open)}>
      <summary>Project images</summary>
      {imagesOpen && <ProjectImages projectId={project.id} target={{ kind: 'project', id: project.id }} title="Project images" allowUpload allowThumbnail />}
    </details>}

    {!db.authEnabled() && <section style={{ marginTop: 'var(--section-gap)' }}>
      <SectionTitle action={<Link to="/areas" style={{ fontSize: 13, color: 'var(--accent-2)', fontWeight: 700 }}>All Areas</Link>}>
        Areas <span style={{ color: 'var(--ink-faint)', fontWeight: 600 }}>· {areaPhaseSummary(areaItems)}</span>
      </SectionTitle>
      {areasLoading ? <Loading label="Loading Areas…" /> : areasError ? <div className="card" role="status" style={{ padding: 'var(--panel-padding)' }}>Area phase status is unavailable. Your saved project data is unchanged.</div>
        : !areaItems.length ? <div className="card" style={{ padding: 'var(--panel-padding)' }}>
          <strong>No Areas yet</strong><p className="foundation-hint">Group related steps into Areas when the project needs them. Each Area can progress through phases independently.</p>
          <Link to="/areas" className="btn">Add the first Area</Link>
        </div> : <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          {areaItems.map(area => {
            const action = areaNextAction(area)
            const buildProgress = area.phase === 'build' ? area.donePct : null
            return <article key={area.id} className="card" style={{ padding: 'var(--panel-padding)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--layout-gap)' }}>
                <div style={{ width: 40, height: 40, borderRadius: 'var(--r)', background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
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
    </section>}

    <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 'var(--layout-gap)', marginTop: 'var(--section-gap)' }}>
      <section>
        <SectionTitle icon="megaphone" color="var(--accent-2)" action={<Link to="/announcements" style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-2)' }}>Announcements</Link>}>Project updates</SectionTitle>
        <div className="card" style={{ padding: 'var(--panel-padding)' }}>
          {announcements?.[0] ? <><p style={{ margin: 0, lineHeight: 1.45 }}>{announcements[0].text}</p><p className="foundation-hint" style={{ marginBottom: 0 }}>{announcements[0].time}</p></>
            : <p className="foundation-hint" style={{ margin: 0 }}>No announcements yet.</p>}
        </div>
      </section>
      {!building && <section>
        <SectionTitle icon="calendar-dots" color="var(--honey)">Next build day</SectionTitle>
        <div className="card" style={{ padding: 'var(--panel-padding)' }}>
          {next ? <>
            <strong>{next.title}</strong>
            <p className="foundation-hint">{formatEventDay(next.day)} · {next.time} · {next.place}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)' }}><AvatarStack people={resolve(next.attendeeIds)} max={5} /><span className="foundation-hint">{next.spots} spots</span></div>
            <Link to={`/events/${next.slug}`} className="btn" style={{ marginTop: 'var(--section-gap)' }}>Open build day</Link>
          </> : <><p className="foundation-hint">Nothing scheduled yet. Calendar timing is separate from lifecycle phase.</p><Link to="/events" className="btn">Events</Link></>}
        </div>
      </section>}
    </div>

    </details>

    </>}

    {phaseOpen && <PhaseTransitionDialog title="Review Project phase" current={project.phase} onClose={() => setPhaseOpen(false)}
      onSave={async (phase, reason) => { await db.setProjectPhase(phase, reason); setPhaseOpen(false); setVersion(value => value + 1) }} />}
  </div>
}

function PlanningTools({ folded, children }: { folded: boolean; children: ReactNode }) {
  if (!folded) return <>{children}</>
  return <details id="planning-tools" className="card planning-tools">
    <summary>Planning tools</summary>
    <p className="foundation-hint">Measurements, materials and the selected design.</p>
    {children}
  </details>
}

// Compact on purpose: one line for the build day keeps the Plan on a small
// phone's opening screen.
function BuildFocus({ next }: { next: BuildEvent | null | undefined }) {
  return <section className="card build-focus" aria-labelledby="build-focus-title">
    <div className="build-focus-head">
      <h2 id="build-focus-title" className="build-focus-label"><Icon name="hammer" size={16} /> Build mode</h2>
      {next && <span className="build-focus-next">{next.title} · {formatEventDay(next.day)}</span>}
    </div>
    {!next && <p className="foundation-hint">No build day scheduled. Work can still go ahead; plan one so people know when to come.</p>}
    <div className="cluster build-focus-actions">
      <Link className="btn btn-primary" to="/today"><Icon name="sun-horizon" size={16} /> What needs doing</Link>
      {next ? <Link className="btn" to={`/events/${next.slug}`}>Build day</Link> : <Link className="btn" to="/events">Plan a build day</Link>}
    </div>
  </section>
}
