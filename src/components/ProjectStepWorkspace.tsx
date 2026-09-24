import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { useAsync, useProjectVersion } from './ui'
import { ProjectImages } from './ProjectImages'
export function ProjectStepWorkspace({projectId}:{projectId:string}){
 const version=useProjectVersion()
 const {data,error,loading}=useAsync(()=>db.getProjectStepWorkspace(projectId),[projectId,version])
 if(loading)return <p role="status">Loading project steps…</p>
 if(error)return <p role="alert">Project steps could not be loaded. Reload to try again.</p>
 if(!data?.steps.length)return null
 return <section className="card foundation-section" aria-label="Project steps"><h2>Project steps</h2>
  {data.steps.map(step=><details key={step.id} open={step.state==='active'}>
   <summary>{step.position}. {step.title} · {step.state}</summary>
   <p>{step.goal}</p>{step.notes&&<p style={{whiteSpace:'pre-wrap'}}>{step.notes}</p>}
   {data.drawings.filter(d=>d.step_id===step.id).map(d=><p key={d.artifact_id}><Link to={`/artifacts?drawing=${encodeURIComponent(d.artifact_id)}&revision=${d.artifact_revision}`}>Open drawing · v{d.artifact_revision}</Link></p>)}
   <ProjectImages projectId={projectId} target={{kind:'plan_step',id:step.id}} title="Images for this step" />
  </details>)}
 </section>
}
