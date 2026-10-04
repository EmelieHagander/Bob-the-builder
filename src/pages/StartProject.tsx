import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { Icon, useAsync } from '../components/ui'
import { NewProjectForm } from '../components/NewProjectForm'
import { ProjectInvitations } from '../components/SharingCards'

/**
 * Choose an accessible project after a stale selection, or create a new
 * project with atomic creator membership.
 */
export function StartProject({ onCreated }: { onCreated: () => void }) {
  const { data: projects } = useAsync(() => db.getProjects(), [])
  return (
    <div className="start-project">
      <div className="card start-project-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)' }}>
          <Icon name="tree-evergreen" weight="fill" size={26} color="var(--accent)" />
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Welcome to bob</h1>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '2px 0 0' }}>
              Choose a project you belong to, or start a new one.
            </p>
          </div>
        </div>

        <Link className="btn" to="/account/buildings" style={{ marginTop: 'var(--section-gap)' }}><Icon name="house" size={16} /> Buildings &amp; family</Link>
        <p className="foundation-hint">Record a building or share it with your household before starting a project.</p>

        <ProjectInvitations onChanged={projectId => { if (projectId) onCreated() }} />

        {projects && projects.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'var(--section-gap)' }}>
          {projects.map(project => <button key={project.id} className="btn" onClick={() => {
            db.setActiveProject(project.id)
            onCreated()
          }}>{project.name}</button>)}
        </div>}

        <div style={{ marginTop: 'var(--section-gap)' }}><NewProjectForm onCreated={project => {
          db.setActiveProject(project.id)
          onCreated()
        }} /></div>
      </div>
    </div>
  )
}
