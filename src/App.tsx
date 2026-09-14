import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import * as db from './data/database'
import { Loading, useAsync, useProjectVersion } from './components/ui'
import { Layout, useAuthTick } from './components/Layout'
import { StartProject } from './pages/StartProject'
import { AccountDashboard } from './pages/account/AccountDashboard'
import { AccountCalendar } from './pages/account/AccountCalendar'
import { AccountSettings } from './pages/account/AccountSettings'
import { ProjectHome } from './pages/ProjectHome'
import { Areas } from './pages/Areas'
import { AreaWorkstream } from './pages/AreaWorkstream'
import { TaskDetail } from './pages/TaskDetail'
import { ProjectFacts } from './pages/ProjectFacts'
import { Solutions } from './pages/Solutions'
import { Artifacts } from './pages/Artifacts'
import { MaterialPlan } from './pages/MaterialPlan'
import { BuildingContext } from './pages/BuildingContext'
import { People } from './pages/People'
import { Events } from './pages/Events'
import { EventDetail } from './pages/EventDetail'
import { Food } from './pages/Food'
import { FoodShopping } from './pages/FoodShopping'
import { Shopping } from './pages/Shopping'
import { Announcements } from './pages/Announcements'
import { Today } from './pages/Today'
import { SignIn } from './pages/SignIn'
import { NotFound } from './pages/NotFound'
import { Install } from './pages/Install'
import { VolunteerProject } from './pages/VolunteerProject'

export function App() {
  return (
    <Routes>
      <Route path="/install" element={<Install />} />
      <Route path="/volunteer" element={<VolunteerProject />} />
      <Route path="/volunteer/:token" element={<VolunteerProject />} />
      <Route path="*" element={<ProjectApp />} />
    </Routes>
  )
}

function ProjectApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const projectVersion = useProjectVersion()
  const authTick = useAuthTick()
  const [bootVersion, setBootVersion] = useState(0)
  const { data: project, loading, error } = useAsync(() => db.getProject(), [projectVersion, bootVersion, authTick])
  const { data: signedIn, loading: sessionLoading } = useAsync(() => db.hasSession(), [authTick])

  useEffect(() => {
    if (project) document.documentElement.setAttribute('data-theme', project.theme)
  }, [project])

  const wasSignedOut = useRef(false)
  useEffect(() => {
    if (signedIn === false) wasSignedOut.current = true
    if (signedIn && wasSignedOut.current) {
      wasSignedOut.current = false
      navigate('/account')
    }
  }, [signedIn, navigate])

  if (loading || sessionLoading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loading /></div>
  }
  if (db.authEnabled() && !signedIn) return <SignIn />
  if (location.pathname === '/account/buildings') {
    return <BuildingContext key={`account:${authTick}`} projectId="" context={db.buildingContext} />
  }
  if (error) return <div className="card" role="alert" style={{ margin: 32, padding: 24 }}>
    <p>Could not load your project. Your access may have changed.</p>
    <button className="btn btn-primary" onClick={() => setBootVersion(v => v + 1)}>Try again</button>
  </div>
  if (!project) return <StartProject onCreated={() => setBootVersion(v => v + 1)} />

  return (
    <Layout key={`${project.id}:${projectVersion}:${authTick}`} project={project}>
      <Routes>
        <Route path="/" element={<ProjectHome />} />
        <Route path="/account" element={<AccountDashboard />} />
        <Route path="/account/calendar" element={<AccountCalendar />} />
        <Route path="/account/settings" element={<AccountSettings />} />
        <Route path="/areas" element={<Areas />} />
        <Route path="/areas/:slug" element={<AreaWorkstream />} />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
        <Route path="/facts" element={<ProjectFacts />} />
        <Route path="/solutions" element={<Solutions />} />
        <Route path="/artifacts" element={<Artifacts />} />
        <Route path="/material-plan" element={<MaterialPlan />} />
        <Route path="/building" element={<BuildingContext projectId={project.id} context={db.buildingContext} />} />
        <Route path="/people" element={<People />} />
        <Route path="/events" element={<Events />} />
        <Route path="/events/:slug" element={<EventDetail />} />
        <Route path="/food" element={<Food />} />
        <Route path="/food/shopping" element={<FoodShopping />} />
        <Route path="/shopping" element={<Shopping />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/today" element={<Today />} />
        <Route path="/signin" element={<Navigate to="/account" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
