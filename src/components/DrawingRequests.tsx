import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import * as db from '../data/database'
import {Loading,useAsync} from './ui'
import {Modal} from './Modal'

const labels:Record<string,string>={collecting:'Reading current sources',needs_data:'Waiting for information',retrieval_failed:'Source or service unavailable',ready_to_design:'Ready for design',draft:'Draft — not approved',reviewed:'Reviewed — not saved',saved:'Saved drawing',paused:'Private context needs restoration',cancelled:'Cancelled'}
export function DrawingRequests({projectId,taskId}:{projectId:string;taskId?:string}){
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
    return <article className="card" key={r.id} style={{padding:16}}>
     <h3>{labels[r.status]??'Status unavailable'}</h3>
     <p className="foundation-hint">Request {r.id.slice(0,8)}</p>
     {!terminal&&<p>{b?.outcome_unknown?'Waiting for a model charge to be reconciled. No new paid attempt will start.':stopped?'The request has reached its cost or call limit.':r.status==='paused'?'Ask Bob to restore the requirements from the current Plan.':work.resume_state==='running'?'Bob is checking the changed information.':work.resume_state==='authorization_needed'?'Waiting to reconnect the initiating member’s signed-in session.':'Bob resumes when relevant saved information changes. Marking a task done does not supply its missing measurements.'}</p>}
     {b?.legacy_untracked&&<p>Earlier charges were not tracked against this request. A new allocation covers only further work.</p>}
     {b&&<p className="foundation-hint">{b.calls} / {b.call_limit} calls · ${Number(b.spent_usd).toFixed(2)} / ${Number(b.usd_limit).toFixed(2)}</p>}
     {gaps.length>0&&!terminal&&<ul>{gaps.map((g,i)=><li key={g.id}>{g.task_id?<Link to={'/tasks/'+encodeURIComponent(g.task_id)}>{g.task_name??'Open linked task'}</Link>:g.action==='measurement'?`Measurement complement ${i+1}`:g.action==='owner_decision'?`Decision complement ${i+1}`:`Project prerequisite ${i+1}`}{g.observed_revision<r.revision&&' — awaiting current assessment'}</li>)}</ul>}
     {r.status==='saved'&&r.artifact_id&&<Link className="btn" to={'/artifacts?drawing='+encodeURIComponent(r.artifact_id)+'&revision='+r.artifact_revision}>Open saved drawing</Link>}
     {!terminal&&<div className="foundation-actions">
      <Link className="btn" to="/facts?kind=measurement">Record measurements</Link>
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
