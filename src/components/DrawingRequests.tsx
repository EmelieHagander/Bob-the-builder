import {useEffect,useState} from 'react'
import {Link,useNavigate} from 'react-router-dom'
import { DrawingLink } from './DrawingLink'
import * as db from '../data/database'
import {Loading,useAsync} from './ui'
import {openBobForCurrentSurface} from '../lib/bobSurface'
import { drawingRequestStatusLabel } from '../lib/labels'
import { userErrorMessage } from '../lib/userErrors'

function RequestCard({projectId, work, taskId, refresh}: {
  projectId: string; work: db.DrawingRequestWork; taskId?: string; refresh: () => void
}) {
  const navigate = useNavigate()
  const [busy,setBusy] = useState(false), [error,setError] = useState('')
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); refresh() } catch (e) { setError(userErrorMessage(e, 'The request could not be updated.')) }
    finally { setBusy(false) }
  }
  const r = work.request, b = work.budget, terminal = db.isClosedDrawingRequest(r.status)
  const gaps = work.gaps.filter(g=>g.blocking)
  const scopeStep = work.gaps.find(g=>g.step_id===r.scope.step_id&&g.step_title)?.step_title
    const stateText=b?.outcome_unknown?'Waiting for a model charge to be reconciled. No new paid attempt will start.':r.status==='paused'?'Ask Bob to restore the requirements from the current Plan.':work.resume_state==='running'?'Bob is checking the changed information.':work.resume_state==='authorization_needed'?'Waiting to reconnect the initiating member’s signed-in session.':r.status==='retrieval_failed'?'A source or service could not be read. This does not mean measurements are missing. Ask Bob to check the source before collecting new data.':r.status==='draft'?'A candidate exists. It has not passed review or been saved as a drawing.':r.status==='reviewed'?'The candidate has passed review but has not yet been saved. Current sources must still be checked at save.':r.status==='ready_to_design'?'The last assessment found enough information for design. No drawing has been saved yet.':'Complete the saved information below. Bob resumes the same request when relevant information changes. Marking a task done does not supply its missing measurements.'
  return <article className="card drawing-request-card" style={{padding:'var(--panel-padding)'}}>
     {error && <p role="alert">{error}</p>}
     <h3>{drawingRequestStatusLabel(r.status)}</h3>
     {r.scope.step_id&&<p><Link to={'/project?step='+encodeURIComponent(r.scope.step_id)}>{scopeStep??'Open destination Step'}</Link></p>}
     {!terminal&&<p>{stateText}</p>}
     {b&&<details className="request-diagnostics"><summary>Run details</summary><p className="foundation-hint">{`${b.calls} calls · ${b.unpriced ? 'known cost ' : ''}$${Number(b.spent_usd).toFixed(2)}`}</p></details>}
     {gaps.length>0&&!terminal&&<ul className="drawing-request-gaps">{gaps.map((g,i)=><li key={g.id}>
      <strong>{g.label??g.task_name??(g.action==='measurement'?`Measurement complement ${i+1}`:g.action==='owner_decision'?`Decision complement ${i+1}`:`Project prerequisite ${i+1}`)}</strong>
      <p className="foundation-hint">{g.owner_label?`Responsible: ${g.owner_label}`:g.action==='bob_decision'?'Bob resolves this work choice.':'Responsible person not assigned in the shared Plan.'}{g.observed_revision<r.revision&&' — awaiting current assessment'}</p>
      {!g.label&&!g.task_name&&<p className="foundation-hint">The shared Plan does not describe this complement yet. Ask Bob to restore its requirements.</p>}
      <div className="foundation-actions">
       {g.task_id&&<Link className="btn" to={'/tasks/'+encodeURIComponent(g.task_id)}>Open linked task</Link>}
       {g.action==='measurement'&&<Link className="btn" to={'/facts?kind=measurement'+(g.area_id?'&area='+encodeURIComponent(g.area_id):'')}>Record measurements</Link>}
       {g.step_id&&<Link className="btn" to={'/project?step='+encodeURIComponent(g.step_id)}>{g.step_title??'Open linked Step'}</Link>}
      </div>
     </li>)}</ul>}
     {r.status==='saved'&&r.artifact_id&&<DrawingLink projectId={projectId} returnLabel={taskId?'Task':'Project plan'} returnKey={`request:${r.id}`} className="btn" to={'/artifacts?drawing='+encodeURIComponent(r.artifact_id)+'&revision='+r.artifact_revision}>Open saved drawing</DrawingLink>}
     {r.status==='saved'&&<p className="foundation-hint">Saved revision {r.artifact_revision}. {work.artifact_source_state==='current'?'Its linked sources are current; the saved classification still applies.':work.artifact_source_state==='changed'?'Its sources changed. Review this saved version before use.':'Its source freshness could not be checked. Open the drawing before use.'}</p>}
     {!terminal&&<div className="foundation-actions">
      <button className="btn" onClick={()=>{if(r.scope.step_id)navigate('/project?step='+encodeURIComponent(r.scope.step_id));openBobForCurrentSurface()}}>{r.scope.step_id?'Ask Bob from this Step':'Ask Bob about project work'}</button>
      {work.can_manage&&work.resume_state==='authorization_needed'&&r.status!=='paused'&&<button className="btn" disabled={busy} onClick={()=>void act(()=>db.renewDrawingRequests(projectId))}>Reconnect request</button>}
      {work.can_manage&&<button className="btn" disabled={busy} onClick={()=>void act(()=>db.cancelDrawingRequest(projectId,r.id,r.revision))}>Cancel request</button>}
     </div>}
    </article>

}

function PastRequest({projectId, request, taskId, refresh}: {
  projectId: string; request: db.DrawingRequestWork['request']; taskId?: string; refresh: () => void
}) {
  const [open, setOpen] = useState(false), [retry, setRetry] = useState(0)
  const {data,error,loading} = useAsync(() => open ? db.getDrawingRequestWork(projectId,request.id) : Promise.resolve(null),
    [open, projectId, request.id, request.revision, retry])
  return <details id={`past-request-${request.id}`} className="past-request" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{drawingRequestStatusLabel(request.status)}{request.artifact_revision ? ` · v${request.artifact_revision}` : ''}</summary>
    {open && (error ? <p role="alert">Request unavailable. <button className="btn" onClick={() => setRetry(n=>n+1)}>Retry</button></p>
      : loading || !data ? <Loading label="Loading request…" /> : <RequestCard projectId={projectId} work={data} taskId={taskId} refresh={refresh} />)}
  </details>
}

export function DrawingRequests({projectId, taskId, stepId}: {projectId:string; taskId?:string; stepId?:string}) {
  const [version,setVersion] = useState(0)
  const refresh = () => setVersion(v=>v+1)
  const {data,loading,error} = useAsync(() => db.getDrawingRequests(projectId,taskId), [projectId,taskId,version])
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') refresh() }, 15000)
    return () => clearInterval(timer)
  }, [projectId])
  if (error) return <section aria-label="Drawing requests"><p role="alert">Drawing requests are unavailable. <button className="btn" onClick={refresh}>Retry requests</button></p></section>
  if (loading && !data) return <Loading label="Loading drawing requests…" />
  if (!data || (!data.active.length && !data.closed.length)) return null
  const relevant = (w: db.DrawingRequestWork) => !stepId || w.request.scope.step_id === stepId || w.gaps.some(g => g.blocking && g.step_id === stepId)
  const here = data.active.filter(relevant), other = data.active.filter(w => !relevant(w))
  const card = (w: db.DrawingRequestWork) => {
    const gap = w.gaps.find(g => g.blocking && g.step_id === stepId) ?? w.gaps.find(g => g.blocking)
    return <details className="request-item" id={`open-request-${w.request.id}`} key={w.request.id}>
      <summary>{gap?.label || gap?.task_name || drawingRequestStatusLabel(w.request.status)}</summary>
      <RequestCard projectId={projectId} work={w} taskId={taskId} refresh={refresh} />
    </details>
  }
  return <section aria-label="Drawing requests" className="project-requests">
    {!!here.length && <><h2 className="guide-request-heading">Drawing requests</h2>{here.map(card)}</>}
    {!!other.length && <details className="request-history"><summary>Open requests in other steps · {other.length}</summary>{other.map(card)}</details>}
    {!!data.closed.length && <details className="request-history" id="past-drawing-requests"><summary>Past drawing requests · {data.closed.length}</summary>
      {data.closed.map(r => <PastRequest key={r.id} projectId={projectId} request={r} taskId={taskId} refresh={refresh} />)}
    </details>}
  </section>
}
