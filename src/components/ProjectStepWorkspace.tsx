import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type { ProjectStepWorkspace as Workspace, WorkStep, WorkTask } from '../data/projectWork'
import { useAsync, useProjectVersion } from './ui'
import { ProjectImages } from './ProjectImages'
import { PhasePill } from './PhaseUI'
import { TaskModal } from './editors'

const taskState={todo:'To do',doing:'In progress',blocked:'Blocked',done:'Done'}
const stepState={planned:'Planned',active:'In progress',blocked:'Blocked',completed:'Complete'}
function TaskLinks({tasks,people}:{tasks:WorkTask[];people:Map<string,string>}){
 return <ul className="work-task-list">{tasks.map(task=><li key={task.id}>
  <Link to={`/tasks/${encodeURIComponent(task.id)}`}>{task.name}</Link>
  <span className="foundation-hint">{taskState[task.status]}{task.assignee_ids?.length?` · ${task.assignee_ids.map(id=>people.get(id)??'Assigned participant').join(', ')}`:''}</span>
 </li>)}</ul>
}
function StepCard({step,work,selected,people,onAdd}:{step:WorkStep;work:Workspace;selected:string|null;people:Map<string,string>;onAdd?:(step:WorkStep)=>void}){
 const [open,setOpen]=useState(selected===step.id||step.state==='active')
 useEffect(()=>{if(selected===step.id)setOpen(true)},[selected,step.id])
 const drawings=work.drawings.filter(d=>d.step_id===step.id)
 return <details className="work-step" id={`step-${step.id}`} open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary><strong>{step.title}</strong><span className="foundation-hint">{stepState[step.state]} · {step.tasks.length} tasks</span></summary>
  {open&&<div className="work-step-body">
   <p>{step.goal}</p>
   <div className="foundation-actions"><PhasePill phase={step.phase} />
    {step.id===work.focus_step_id&&<span className="foundation-hint">Bob’s focus</span>}
    <span className="foundation-hint">Responsible: {step.responsible_kind==='bob'?'Bob':step.responsible_kind==='person'?people.get(step.responsible_person_id??'')??'Assigned participant':'Unassigned'}</span>
   </div>
   {!!step.tasks.length&&<TaskLinks tasks={step.tasks} people={people}/>}
   {!step.tasks.length&&<p className="foundation-hint">No tasks organised in this step yet.</p>}
   {onAdd&&<button className="btn" onClick={()=>onAdd(step)}>Add task</button>}
   {!!step.requirements.length&&<details className="work-criteria"><summary>Finish criteria · {step.requirements.length}</summary>
    <ul>{step.requirements.map(r=><li key={r.id}>{r.title} <span className="foundation-hint">· {r.status.state.replace(/_/g,' ')}</span></li>)}</ul>
   </details>}
   {!!step.related_tasks.length&&<details><summary>Related work</summary><TaskLinks tasks={step.related_tasks} people={people}/></details>}
   {drawings.map(d=><p key={d.artifact_id}><Link to={`/artifacts?drawing=${encodeURIComponent(d.artifact_id)}&revision=${d.artifact_revision}`}>Open drawing · v{d.artifact_revision}</Link></p>)}
   {db.authEnabled()&&<ProjectImages projectId={work.project_id} target={{kind:'plan_step',id:step.id}} title="Step images" />}
  </div>}
 </details>
}
/** Shared rendering of the canonical projection; references never become duplicate Tasks. */
export function ProjectPlanContent({work,selected=null,people=new Map(),onAdd}:{work:Workspace;selected?:string|null;people?:Map<string,string>;onAdd?:(step:WorkStep)=>void}){
 const renderStep=(step:WorkStep)=><StepCard key={step.id} step={step} work={work} selected={selected} people={people} onAdd={onAdd}/>
 const unorganised=(tasks:WorkTask[])=>tasks.length?<details className="work-unorganised"><summary>Tasks to organise · {tasks.length}</summary>
  <p className="foundation-hint">These saved tasks do not yet have a primary step.</p><TaskLinks tasks={tasks} people={people}/></details>:null
 return <section className="card foundation-section" aria-label="Project plan">
  <div className="foundation-heading"><h2>Plan</h2><Link to="/areas">Manage areas</Link></div>
  {!work.steps.length&&<p className="foundation-hint">No current plan yet. Bob can organise the project’s work into steps.</p>}
  {work.steps.filter(s=>!s.area_id).map(renderStep)}
  {unorganised(work.unorganised_tasks.filter(t=>!t.area_id))}
  {work.areas.map(area=><section className="work-area" key={area.id} aria-label={area.name}>
   <div className="foundation-heading"><h3><Link to={`/areas/${area.slug}`}>{area.name}</Link></h3><PhasePill phase={area.phase}/></div>
   {work.steps.filter(s=>s.area_id===area.id).map(renderStep)}
   {unorganised(work.unorganised_tasks.filter(t=>t.area_id===area.id))}
   {!work.steps.some(s=>s.area_id===area.id)&&!work.unorganised_tasks.some(t=>t.area_id===area.id)&&<p className="foundation-hint">No work organised here yet.</p>}
  </section>)}
 </section>
}
export function ProjectStepWorkspace({projectId}:{projectId:string}){
 const version=useProjectVersion(),[local,setLocal]=useState(0),[selected]=useSearchParams()
 const [adding,setAdding]=useState<WorkStep|null>(null)
 const {data,error,loading}=useAsync(()=>db.getProjectStepWorkspace(projectId),[projectId,version,local])
 const {data:crew}=useAsync(()=>db.getPeople(),[projectId,version])
 if(loading&&!data)return <p role="status">Loading project plan…</p>
 if(error)return <p role="alert">Project plan could not be loaded. <button className="btn" onClick={()=>setLocal(v=>v+1)}>Try again</button></p>
 if(!data)return null
 return <><ProjectPlanContent work={data} selected={selected.get('step')} people={new Map(crew?.map(p=>[p.id,p.name])??[])} onAdd={setAdding}/>
  {adding&&<TaskModal areas={data.areas} areaId={adding.area_id??undefined} stepId={adding.id} onClose={()=>setAdding(null)} onDone={()=>{setAdding(null);setLocal(v=>v+1)}}/>}
 </>
}
