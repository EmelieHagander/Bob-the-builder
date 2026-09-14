import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import * as db from '../data/database'
import { validVolunteerSecret, volunteerSecret, type VolunteerPreview, type VolunteerState, type VolunteerTask, type VolunteerTaskSummary, type VolunteerEvent, type VolunteerMeal, type VolunteerUpdate } from '../data/volunteers'
import { readVolunteerSession, saveVolunteerSession, forgetVolunteerSession } from '../lib/volunteerSession'
import { Field, FormError, inputStyle } from '../components/form'
import { Icon, Loading, useAsync } from '../components/ui'
import { Modal } from '../components/Modal'

const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
const statusName = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', done: 'Done' }
type Section = 'tasks' | 'events' | 'updates' | 'meals'
type Item = VolunteerTaskSummary | VolunteerEvent | VolunteerUpdate | VolunteerMeal

export function VolunteerProject() {
  const { token = '' } = useParams()
  return <VolunteerVisit key={token} invite={token} />
}

function VolunteerVisit({ invite }: { invite: string }) {
  const [preview, setPreview] = useState<VolunteerPreview | null>(null)
  const [state, setState] = useState<VolunteerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [allergies, setAllergies] = useState('')
  const [version, setVersion] = useState(0)
  const [feedVersion, setFeedVersion] = useState(0)
  const [section, setSection] = useState<Section>('tasks')
  const [taskId, setTaskId] = useState('')
  const [editing, setEditing] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const credential = useRef(readVolunteerSession(invite))
  const generation = useRef(0)

  useEffect(() => {
    const previous = document.documentElement.getAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', state?.project.theme ?? 'birch')
    return () => { if (previous) document.documentElement.setAttribute('data-theme', previous); else document.documentElement.removeAttribute('data-theme') }
  }, [state?.project.theme])

  useEffect(() => {
    const current = ++generation.current
    setLoading(true); setError(''); setState(null); setPreview(null); setTaskId(''); setBlocked(false)
    void (async () => {
      try {
        if (!validVolunteerSecret(invite)) throw new Error('This volunteer link is incomplete. Ask the organiser to share it again.')
        const next = await db.volunteers.preview(invite)
        if (current !== generation.current) return
        setPreview(next)
        if (credential.current) {
          try {
            const confirmed = await db.volunteers.state(credential.current.secret, next.projectId)
            if (confirmed.linkId !== next.linkId) throw new Error('This browser has access to a different invitation.')
            if (current !== generation.current) return
            credential.current.joined = true
            saveVolunteerSession(invite, credential.current)
            setState(confirmed); setName(confirmed.person.name); setAllergies(confirmed.person.allergies ?? '')
            if (!confirmed.hasFood && section === 'meals') setSection('tasks')
          } catch (reason) {
            if (credential.current.joined) throw reason
            if (current === generation.current) setNotice('Your previous visit was not confirmed. Enter your name to retry.')
          }
        }
      } catch (reason) { if (current === generation.current) { setError(message(reason)); setBlocked(true) } }
      finally { if (current === generation.current) setLoading(false) }
    })()
    return () => { generation.current++ }
    // The invitation and explicit refresh define this visit, never the regular Auth session.
  }, [invite, version])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!preview || busy || !name.trim()) return
    const current = generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      credential.current ??= { secret: volunteerSecret(), joined: false }
      const remembered = saveVolunteerSession(invite, credential.current)
      const result = state
        ? await db.volunteers.profile(credential.current.secret, state, name.trim(), state.hasFood ? allergies.trim() || null : null)
        : await db.volunteers.join(invite, credential.current.secret, preview.projectId, name.trim(), preview.hasFood ? allergies.trim() || null : null)
      if (current !== generation.current) return
      if (result.linkId !== preview.linkId) throw new Error('The invitation could not be confirmed. Reopen your project link.')
      credential.current.joined = true
      saveVolunteerSession(invite, credential.current)
      setState(result); setName(result.person.name); setAllergies(result.person.allergies ?? ''); setEditing(false)
      setNotice(remembered ? 'Your project profile is saved.' : 'Your profile is saved, but this browser cannot remember your access after you close it. Keep this page open for your visit.')
    } catch (reason) { if (current === generation.current) setError(message(reason)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  function accessError(reason: unknown) {
    const text = message(reason)
    if (text.includes('Volunteer access is unavailable')) { setState(null); setTaskId(''); setBlocked(true); setError(text) }
  }
  function forget() {
    generation.current++
    forgetVolunteerSession(invite); credential.current = null
    setName(''); setAllergies(''); setState(null); setTaskId(''); setEditing(false); setForgetting(false); setNotice('This browser has forgotten your participant access. Your project profile remains with the crew.')
    setVersion(value => value + 1)
  }
  const food = state?.hasFood ?? preview?.hasFood ?? false
  const profileForm = <form onSubmit={submit} className="foundation-form">
    <Field label="Your name"><input style={inputStyle} value={name} onChange={event => setName(event.target.value)} maxLength={120} autoComplete="given-name" disabled={busy} required autoFocus /></Field>
    {food && <><Field label="Allergies (optional)"><textarea style={inputStyle} value={allergies} onChange={event => setAllergies(event.target.value)} maxLength={1000} rows={3} disabled={busy} placeholder="Anything the food crew should know" /></Field><p className="foundation-hint">Food is planned for this project. Share any allergies with the project’s signed-in crew so they can plan your food. These notes are not shown on other participants’ volunteer pages.</p></>}
    <div className="foundation-actions"><button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : state ? 'Save my details' : 'Join as volunteer'}</button>{state && <button className="btn" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>}</div>
  </form>
  return <main className="volunteer-page" data-theme={state?.project.theme ?? 'birch'}>
    <div className="volunteer-shell">
      <header className="volunteer-head"><div className="volunteer-brand"><Icon name="tree-evergreen" weight="fill" size={27} /><strong className="font-display">bob</strong><span>build together</span></div><span className="badge">Volunteer</span></header>
      {loading ? <Loading label="Opening your project…" /> : <>
        <div className="volunteer-title"><h1>{state?.project.name ?? preview?.projectName ?? 'Project invitation'}</h1>{state && <button className="btn" disabled={busy} onClick={() => setVersion(value => value + 1)}>Refresh project</button>}</div>
        {error && <div role="alert" className="volunteer-feedback"><FormError>{error}</FormError><button className="btn" disabled={busy} onClick={() => setVersion(value => value + 1)}>Try again</button></div>}
        {notice && <p className="sharing-status" role="status">{notice}</p>}
        {!state && !blocked && preview && <section className="card volunteer-join" aria-label="Join this project"><h2>Join the crew</h2><p>Enter your name to take part in this project. No account, email or password needed.</p>{profileForm}<p className="foundation-hint">Your name is registered in this project. Use this browser to return to the same participant profile.</p></section>}
        {state && credential.current && <>
          <section className="card volunteer-intro"><p className="volunteer-description">{state.project.description || 'Build days, instructions and the next useful task — all in one place.'}</p>{(state.project.location || state.project.startLabel) && <p className="foundation-hint">{[state.project.location, state.project.startLabel].filter(Boolean).join(' · ')}</p>}<div className="foundation-heading"><p>You’re taking part as <strong>{state.person.name}</strong>.</p><button className="btn" disabled={busy} onClick={() => { setName(state.person.name); setAllergies(state.person.allergies ?? ''); setEditing(value => !value) }}>My details</button></div>{editing && profileForm}</section>
          <nav className="volunteer-nav" aria-label="Project sections">{(['tasks', 'events', 'updates', ...(state.hasFood ? ['meals'] : [])] as Section[]).map(value => <button className={'btn' + (section === value ? ' btn-primary' : '')} key={value} aria-pressed={section === value} onClick={() => setSection(value)}>{{ tasks: 'Tasks', events: 'Build days', updates: 'Updates', meals: 'Food' }[value]}</button>)}</nav>
          <VolunteerFeedView key={`${section}:${feedVersion}`} secret={credential.current.secret} projectId={state.projectId} section={section} openTask={setTaskId} onDenied={accessError} />
          {taskId && <VolunteerTaskPanel key={taskId} secret={credential.current.secret} projectId={state.projectId} taskId={taskId} onClose={() => setTaskId('')} onChanged={() => setFeedVersion(value => value + 1)} onDenied={accessError} />}
        </>}
        {credential.current && <footer className="volunteer-footer"><p className="foundation-hint">Access lasts until the invitation expires or the crew revokes it. Your participant profile belongs to this project.</p>{forgetting ? <div className="sharing-confirm"><p>Forget this participant on this browser? Your saved project work remains, but your name alone cannot restore access to this profile.</p><div className="foundation-actions"><button className="btn" disabled={busy} onClick={() => setForgetting(false)}>Keep this access</button><button className="btn" disabled={busy} onClick={forget}>Forget this participant</button></div></div> : <button className="btn" disabled={busy} onClick={() => setForgetting(true)}>Forget access on this device</button>}</footer>}
      </>}
    </div>
  </main>
}

function VolunteerFeedView({ secret, projectId, section, openTask, onDenied }: { secret: string; projectId: string; section: Section; openTask: (id: string) => void; onDenied: (error: unknown) => void }) {
  const [version, setVersion] = useState(0)
  const { data, loading, error: loadError } = useAsync(() => db.volunteers.feed<Item>(secret, projectId, section), [secret, projectId, section, version])
  const [extra, setExtra] = useState<Item[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (loadError) onDenied(loadError) }, [loadError])
  const items = [...(data?.items ?? []), ...extra]
  const next = cursor === undefined ? data?.nextCursor : cursor
  async function more() {
    if (!next || busy) return
    setBusy('page'); setError('')
    try {
      const page = await db.volunteers.feed<Item>(secret, projectId, section, next)
      if (mounted.current) { setExtra(rows => [...rows, ...page.items]); setCursor(page.nextCursor) }
    } catch (reason) { if (mounted.current) { setError(message(reason)); onDenied(reason) } }
    finally { if (mounted.current) setBusy('') }
  }
  async function attend(event: VolunteerEvent) {
    if (busy) return
    setBusy(event.id); setError('')
    try {
      await db.volunteers.rsvp(secret, projectId, event.id, !event.going)
      if (mounted.current) { setExtra([]); setCursor(undefined); setVersion(value => value + 1) }
    } catch (reason) { if (mounted.current) { setError(message(reason)); onDenied(reason) } }
    finally { if (mounted.current) setBusy('') }
  }
  return <section className="volunteer-feed" aria-label={{ tasks: 'Project tasks', events: 'Build days', updates: 'Project updates', meals: 'Meal plan' }[section]}>
    {loading ? <Loading /> : loadError ? <div role="alert"><FormError>{loadError.message}</FormError><button className="btn" onClick={() => setVersion(value => value + 1)}>Try again</button></div> : !items.length ? <p className="card volunteer-empty">{{ tasks: 'No tasks planned yet.', events: 'No build days planned yet.', updates: 'No updates yet.', meals: 'The food crew has not added a menu yet.' }[section]}</p> : <div className="volunteer-grid">{items.map(item => {
      if (section === 'tasks') {
        const task = item as VolunteerTaskSummary
        return <article className="card volunteer-item" key={task.id}><div className="foundation-heading"><span className="badge">{task.area}</span><span className="foundation-hint">{statusName[task.status]}</span></div><h2>{task.name}</h2><p className="foundation-hint">{task.mine ? 'You’re on this task' : task.skill + (task.hours ? ' · ' + task.hours : '')}</p><button className="btn" onClick={() => openTask(task.id)}>View task</button></article>
      }
      if (section === 'events') {
        const event = item as VolunteerEvent
        return <article className="card volunteer-item" key={event.id}><h2>{event.title}</h2><p>{[event.day, event.time].filter(Boolean).join(' · ')}</p><p className="foundation-hint">{event.place}</p>{event.food && <p className="foundation-hint"><Icon name="fork-knife" /> {event.food}</p>}<button className={'btn' + (event.going ? '' : ' btn-primary')} disabled={!!busy} onClick={() => void attend(event)}>{busy === event.id ? 'Saving…' : event.going ? 'Cancel my attendance' : 'I’m coming'}</button></article>
      }
      if (section === 'updates') {
        const update = item as VolunteerUpdate
        return <article className="card volunteer-item" key={update.id}>{update.pinned && <span className="badge">Pinned</span>}<p className="volunteer-text">{update.text}</p><time className="foundation-hint">{new Date(update.createdAt).toLocaleDateString()}</time></article>
      }
      const meal = item as VolunteerMeal
      return <article className="card volunteer-item" key={meal.id}><h2>{meal.meal}</h2><p className="foundation-hint">{meal.time}</p><strong>{meal.dish}</strong><p className="volunteer-text">{meal.notes}</p></article>
    })}</div>}
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    {next && <button className="btn" disabled={!!busy} onClick={() => void more()}>{busy === 'page' ? 'Loading…' : 'Load more'}</button>}
  </section>
}

function VolunteerTaskPanel({ secret, projectId, taskId, onClose, onChanged, onDenied }: { secret: string; projectId: string; taskId: string; onClose: () => void; onChanged: () => void; onDenied: (reason: unknown) => void }) {
  const [version, setVersion] = useState(0)
  const { data, loading, error: loadError } = useAsync(async () => {
    const result = await db.volunteers.task(secret, projectId, taskId)
    if (result.id !== taskId) throw new Error('Task could not be confirmed. Reopen it from the project.')
    return result
  }, [secret, projectId, taskId, version])
  const [saved, setSaved] = useState<VolunteerTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [images, setImages] = useState<Record<string, string>>({})
  const urls = useRef<string[]>([])
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; urls.current.forEach(URL.revokeObjectURL) } }, [])
  useEffect(() => { if (loadError) onDenied(loadError) }, [loadError])
  const task = saved ?? data
  async function action(kind: 'claim' | 'release' | 'status' | 'check', args: Record<string, unknown> = {}) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await db.volunteers.taskAction(secret, projectId, taskId, kind, args)
      if (!mounted.current) return
      if (result.id !== taskId) throw new Error('Task could not be confirmed. Refresh before continuing.')
      setSaved(result); onChanged()
    } catch (reason) { if (mounted.current) { setError(message(reason)); onDenied(reason) } }
    finally { if (mounted.current) setBusy(false) }
  }
  async function showImage(id: string) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const blob = await db.volunteers.image(secret, taskId, id)
      if (mounted.current) { const url = URL.createObjectURL(blob); urls.current.push(url); setImages(current => ({ ...current, [id]: url })) }
    } catch (reason) { if (mounted.current) { setError(message(reason)); onDenied(reason) } }
    finally { if (mounted.current) setBusy(false) }
  }
  return <Modal title={task?.name ?? 'Task'} onClose={() => { if (!busy) onClose() }} wide>
    {loading ? <Loading /> : loadError ? <FormError>{loadError.message}</FormError> : task && <div className="foundation-form">
      <p className="foundation-hint">{task.area} · {statusName[task.status]}</p>
      <p className="volunteer-text">{task.instructions || 'No written instructions yet. Check with the crew before you start.'}</p>
      {task.mine ? <><Field label="Task progress"><select style={inputStyle} value={task.status} disabled={busy} onChange={event => void action('status', { status: event.target.value, expectedUpdatedAt: task.updatedAt })}>{Object.entries(statusName).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><button className="btn" disabled={busy} onClick={() => void action('release')}>Leave this task</button></> : <button className="btn btn-primary" disabled={busy || task.status === 'done'} onClick={() => void action('claim')}>{task.status === 'done' ? 'Task completed' : 'Join this task'}</button>}
      {task.steps.length > 0 && <div className="volunteer-steps"><h3>Instructions & checks</h3>{task.steps.map((step, index) => <article className="card volunteer-step" key={step.id}><h4>{index + 1}. {step.title}{step.required ? ' · Required check' : ''}</h4><p className="volunteer-text">{step.instructions}</p>{step.completedAt && <p className="foundation-hint">Completed</p>}{task.mine && <button className="btn" disabled={busy} onClick={() => void action('check', { stepId: step.id, revision: step.revision, completed: !step.completedAt })}>{step.completedAt ? 'Reopen step' : 'Complete step'}</button>}</article>)}</div>}
      {task.images.length > 0 && <div className="volunteer-steps"><h3>Task & area images</h3>{task.images.map(image => <figure key={image.id} className="volunteer-image"><figcaption>{image.title}</figcaption>{images[image.id] ? <img src={images[image.id]} alt={image.title} /> : <button className="btn" disabled={busy} onClick={() => void showImage(image.id)}>View image</button>}</figure>)}</div>}
    </div>}
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    <div className="foundation-actions"><button className="btn" disabled={busy} onClick={() => { setSaved(null); setError(''); setVersion(value => value + 1) }}>Refresh task</button><button className="btn" disabled={busy} onClick={onClose}>Done</button></div>
  </Modal>
}
