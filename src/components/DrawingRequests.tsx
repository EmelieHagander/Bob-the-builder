import {useEffect,useState} from 'react'
import {Link,useNavigate} from 'react-router-dom'
import * as db from '../data/database'
import {Loading,useAsync} from './ui'
import {Modal} from './Modal'
import {openBobForCurrentSurface} from '../lib/bobSurface'

const labels:Record<string,string>={collecting:'Reading current sources',needs_data:'Waiting for information',retrieval_failed:'Source or service unavailable',ready_to_design:'Ready for design',draft:'Draft — not approved',reviewed:'Reviewed — not saved',saved:'Saved drawing',paused:'Private context needs restoration',cancelled:'Cancelled'}
export function DrawingRequests({projectId,taskId}:{projectId:string;taskId?:string}){
 const navigate=useNavigate()
 const [version,setVersion]=useState(0),[after,setAfter]=useState<string|null>(null)
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const [grant,setGrant]=useState<{work:db.DrawingRequestWork;id:string}|null>(null)
 const {data,loading,error:loadError}=useAsync(()=>db.getDrawingRequests(projectId,after,taskId??null),[projectId,taskId,after,version])
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState!=='hidden')setVersion(v=>v+1)},15000);return()=>clearInterval(timer)},[projectId])
 const act=async(work:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await work();setVersion(v=>v+1)}catch(e){setError(e instanceof Error?e.message:'The request could not be updated.')}finally{setBusy(false)}}
 if(loading&&!data)return <section aria-label="Drawing requests"><Loading label="Loading drawing requests…" /></section>
 if(loadError)return <section className="card" aria-label="Drawing requests" style={{padding:16,marginTop:18}}><p role="status">Drawing requests are unavailable.</p><button className="btn" onClick={()=>setVersion(v=>v+1)}>Retry requests</button></section>
 if(!data?.items.length&&!after)return null
 return <section aria-label="Drawing requests" style={{marginTop:18}}>
  <h2 className="font-display">Drawing requests</h2>
  {error&&!grant&&<p role="alert">{error}</p>}
  <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))',gap:12}}>
   {data?.items.map(work=>{
    const r=work.request,b=work.budget,terminal=['saved','cancelled'].includes(r.status)
    const stopped=!!b&&(b.calls>=b.call_limit||b.spent_usd>=b.usd_limit)
    const gaps=work.gaps.filter(g=>g.blocking)
    const scopeStep=work.gaps.find(g=>g.step_id===r.scope.step_id&&g.step_title)?.step_title
    const stateText=b?.outcome_unknown?'Waiting for a model charge to be reconciled. No new paid attempt will start.':stopped?'The request has reached its cost or call limit.':r.status==='paused'?'Ask Bob to restore the requirements from the current Plan.':work.resume_state==='running'?'Bob is checking the changed information.':work.resume_state==='authorization_needed'?'Waiting to reconnect the initiating member’s signed-in session.':r.status==='retrieval_failed'?'A source or service could not be read. This does not mean measurements are missing. Ask Bob to check the source before collecting new data.':r.status==='draft'?'A candidate exists. It has not passed review or been saved as a drawing.':r.status==='reviewed'?'The candidate has passed review but has not yet been saved. Current sources must still be checked at save.':r.status==='ready_to_design'?'The last assessment found enough information for design. No drawing has been saved yet.':'Complete the saved information below. Bob resumes the same request when relevant information changes. Marking a task done does not supply its missing measurements.'
    return <article className="card drawing-request-card" key={r.id} style={{padding:16}}>
     <h3>{labels[r.status]??'Status unavailable'}</h3>
     <p className="foundation-hint">Request {r.id.slice(0,8)}</p>
     {r.scope.step_id&&<p><Link to={'/?step='+encodeURIComponent(r.scope.step_id)}>{scopeStep??'Open destination Step'}</Link></p>}
     {!terminal&&<p>{stateText}</p>}
     {b?.legacy_untracked&&<p>Earlier charges were not tracked against this request. A new allocation covers only further work.</p>}
     {b&&<p className="foundation-hint">{b.calls} / {b.call_limit} calls · ${Number(b.spent_usd).toFixed(2)} / ${Number(b.usd_limit).toFixed(2)}</p>}
     {gaps.length>0&&!terminal&&<ul className="drawing-request-gaps">{gaps.map((g,i)=><li key={g.id}>
      <strong>{g.label??g.task_name??(g.action==='measurement'?`Measurement complement ${i+1}`:g.action==='owner_decision'?`Decision complement ${i+1}`:`Project prerequisite ${i+1}`)}</strong>
      <p className="foundation-hint">{g.owner_label?`Responsible: ${g.owner_label}`:g.action==='bob_decision'?'Bob resolves this work choice.':'Responsible person not assigned in the shared Plan.'}{g.observed_revision<r.revision&&' — awaiting current assessment'}</p>
      {!g.label&&!g.task_name&&<p className="foundation-hint">The shared Plan does not describe this complement yet. Ask Bob to restore its requirements.</p>}
      <div className="foundation-actions">
       {g.task_id&&<Link className="btn" to={'/tasks/'+encodeURIComponent(g.task_id)}>Open linked task</Link>}
       {g.action==='measurement'&&<Link className="btn" to={'/facts?kind=measurement'+(g.area_id?'&area='+encodeURIComponent(g.area_id):'')}>Record measurements</Link>}
       {g.step_id&&<Link className="btn" to={'/?step='+encodeURIComponent(g.step_id)}>{g.step_title??'Open linked Step'}</Link>}
      </div>
     </li>)}</ul>}
     {r.status==='saved'&&r.artifact_id&&<Link className="btn" to={'/artifacts?drawing='+encodeURIComponent(r.artifact_id)+'&revision='+r.artifact_revision}>Open saved drawing</Link>}
     {r.status==='saved'&&<p className="foundation-hint">Saved revision {r.artifact_revision}. {work.artifact_source_state==='current'?'Its linked sources are current; the saved classification still applies.':work.artifact_source_state==='changed'?'Its sources changed. Review this saved version before use.':'Its source freshness could not be checked. Open the drawing before use.'}</p>}
     {!terminal&&<div className="foundation-actions">
      <button className="btn" onClick={()=>{if(r.scope.step_id)navigate('/?step='+encodeURIComponent(r.scope.step_id));openBobForCurrentSurface()}}>{r.scope.step_id?'Ask Bob from this Step':'Ask Bob about project work'}</button>
      {work.can_manage&&work.resume_state==='authorization_needed'&&r.status!=='paused'&&<button className="btn" disabled={busy} onClick={()=>void act(()=>db.renewDrawingRequests(projectId))}>Reconnect request</button>}
      {work.can_manage&&stopped&&!b?.outcome_unknown&&<button className="btn" disabled={busy} onClick={()=>setGrant({work,id:crypto.randomUUID()})}>Add request budget</button>}
      {work.can_manage&&<button className="btn" disabled={busy} onClick={()=>void act(()=>db.cancelDrawingRequest(projectId,r.id,r.revision))}>Cancel request</button>}
     </div>}
    </article>
   })}
  </div>
  {(after||data?.next_cursor)&&<div className="foundation-actions">{after&&<button className="btn" onClick={()=>setAfter(null)}>First requests</button>}{data?.next_cursor&&<button className="btn" onClick={()=>setAfter(data.next_cursor)}>More requests</button>}</div>}
  {grant&&<Modal title="Add request budget" onClose={()=>{if(!busy)setGrant(null)}}>
   <p>Add $1 and up to 24 model calls to this same request. Its requirements and prior charges remain. A call already in progress may exceed the cost threshold; further calls then stop.</p>
   {error&&<p role="alert">{error}</p>}
   <div className="foundation-actions"><button className="btn" disabled={busy} onClick={()=>setGrant(null)}>Keep current limit</button><button className="btn btn-primary" disabled={busy} onClick={()=>void act(async()=>{await db.grantDrawingBudget(projectId,grant.work.request.id,grant.work.budget!.revision,grant.id);setGrant(null);await db.renewDrawingRequests(projectId)})}>{busy?'Adding…':'Add $1 / 24 calls'}</button></div>
  </Modal>}
 </section>
}
