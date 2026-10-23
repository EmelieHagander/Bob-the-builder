import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import * as db from './data/database'
import { Loading, useAsync, useProjectVersion } from './components/ui'
import { Layout, useAuthTick } from './components/Layout'
const StartProject = lazy(() => import('./pages/StartProject').then(module => ({ default: module.StartProject })))
const AccountDashboard = lazy(() => import('./pages/account/AccountDashboard').then(module => ({ default: module.AccountDashboard })))
const Account = lazy(() => import('./pages/account/Account').then(module => ({ default: module.Account })))
const AccountCalendar = lazy(() => import('./pages/account/AccountCalendar').then(module => ({ default: module.AccountCalendar })))
const AccountSettings = lazy(() => import('./pages/account/AccountSettings').then(module => ({ default: module.AccountSettings })))
const ProjectHome = lazy(() => import('./pages/ProjectHome').then(module => ({ default: module.ProjectHome })))
const Areas = lazy(() => import('./pages/Areas').then(module => ({ default: module.Areas })))
const AreaWorkstream = lazy(() => import('./pages/AreaWorkstream').then(module => ({ default: module.AreaWorkstream })))
const TaskDetail = lazy(() => import('./pages/TaskDetail').then(module => ({ default: module.TaskDetail })))
const ProjectFacts = lazy(() => import('./pages/ProjectFacts').then(module => ({ default: module.ProjectFacts })))
const Solutions = lazy(() => import('./pages/Solutions').then(module => ({ default: module.Solutions })))
const Artifacts = lazy(() => import('./pages/Artifacts').then(module => ({ default: module.Artifacts })))
const MaterialPlan = lazy(() => import('./pages/MaterialPlan').then(module => ({ default: module.MaterialPlan })))
const BuildPreparation = lazy(() => import('./pages/BuildPreparation').then(module => ({ default: module.BuildPreparation })))
const BuildingContext = lazy(() => import('./pages/BuildingContext').then(module => ({ default: module.BuildingContext })))
const People = lazy(() => import('./pages/People').then(module => ({ default: module.People })))
const Events = lazy(() => import('./pages/Events').then(module => ({ default: module.Events })))
const EventDetail = lazy(() => import('./pages/EventDetail').then(module => ({ default: module.EventDetail })))
const Food = lazy(() => import('./pages/Food').then(module => ({ default: module.Food })))
const FoodShopping = lazy(() => import('./pages/FoodShopping').then(module => ({ default: module.FoodShopping })))
const Shopping = lazy(() => import('./pages/Shopping').then(module => ({ default: module.Shopping })))
const Announcements = lazy(() => import('./pages/Announcements').then(module => ({ default: module.Announcements })))
const Today = lazy(() => import('./pages/Today').then(module => ({ default: module.Today })))
const SignIn = lazy(() => import('./pages/SignIn').then(module => ({ default: module.SignIn })))
const NotFound = lazy(() => import('./pages/NotFound').then(module => ({ default: module.NotFound })))
const Install = lazy(() => import('./pages/Install').then(module => ({ default: module.Install })))
const VolunteerProject = lazy(() => import('./pages/VolunteerProject').then(module => ({ default: module.VolunteerProject })))

export function App() {
  return (
    <Suspense fallback={<Loading label="Loading page…" />}><Routes>
      <Route path="/install" element={<Install />} />
      <Route path="/volunteer" element={<VolunteerProject />} />
      <Route path="/volunteer/:token" element={<VolunteerProject />} />
      <Route path="*" element={<ProjectApp />} />
    </Routes></Suspense>
  )
}

function ProjectApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const projectVersion = useProjectVersion()
  const authTick = useAuthTick()
  const [bootVersion, setBootVersion] = useState(0)
  const [sessionVersion, setSessionVersion] = useState(0)
  useEffect(() => db.onSessionRefresh(() => setSessionVersion(v => v + 1)), [])
  const { data: boot, loading, error } = useAsync(async () => {
    const signedIn = await db.hasSession()
    const project = signedIn ? await db.getProject() : null
    return { signedIn, project, authTick, projectVersion }
  }, [projectVersion, bootVersion, authTick, sessionVersion], { timeoutMs: 20_000, keepDataOnError: true })
  const project = boot?.project ?? null
  const signedIn = boot?.signedIn

  useEffect(() => {
    if (project) document.documentElement.setAttribute('data-theme', project.theme)
  }, [project])

  const wasSignedOut = useRef(false)
  useEffect(() => {
    if (signedIn === false) wasSignedOut.current = true
    if (signedIn && wasSignedOut.current) {
      wasSignedOut.current = false
      navigate('/')
    }
  }, [signedIn, navigate])

  // Renewing the same owner's session rechecks project visibility without
  // replacing the mounted shell/draft. Account/project switches still hide it.
  const currentBoot = boot && boot.authTick === authTick && boot.projectVersion === projectVersion
  const notice = error && currentBoot ? <div className="card ui-panel" role="alert">
    Could not refresh project access. Check your connection.
    <button className="btn" onClick={() => setBootVersion(v => v + 1)}>Try again</button>
  </div> : undefined
  if (!currentBoot && (loading || !error)) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loading /></div>
  }
  if (error && !currentBoot) return <div className="page"><section className="card ui-panel" role="alert">
    <h1 className="page-title">Could not load your account</h1>
    <p>{error.message}</p>
    <div className="cluster"><button className="btn btn-primary" onClick={() => setBootVersion(v => v + 1)}>Try again</button>
      <button className="btn" onClick={() => window.location.reload()}>Reload app</button></div>
  </section></div>
  if (db.authEnabled() && signedIn === false) return <SignIn />
  // Retain previously shared Step links while root becomes the permanent Home.
  if (location.pathname === '/' && new URLSearchParams(location.search).has('step')) return <Navigate to={`/project${location.search}`} replace />
  if (location.pathname === '/account/buildings') {
    return <Layout key={`account:${authTick}`} project={project} notice={notice}><BuildingContext projectId="" context={db.buildingContext} /></Layout>
  }
  if (!project && (location.pathname.startsWith('/account') || location.pathname === '/')) return <Layout key={`account:${authTick}`} project={null} notice={notice}>
    <Routes>
      <Route path="/" element={<AccountDashboard />} />
      <Route path="/account" element={<Account />} />
      <Route path="/account/calendar" element={<AccountCalendar />} />
      <Route path="/account/settings" element={<AccountSettings />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </Layout>
  if (!project) return <StartProject onCreated={() => setBootVersion(v => v + 1)} />

  return (
    <Layout key={`${project.id}:${projectVersion}:${authTick}`} project={project} notice={notice}>
      <Routes>
        <Route path="/" element={<AccountDashboard />} />
        <Route path="/project" element={<ProjectHome />} />
        <Route path="/account" element={<Account />} />
        <Route path="/account/calendar" element={<AccountCalendar />} />
        <Route path="/account/settings" element={<AccountSettings />} />
        <Route path="/areas" element={<Areas />} />
        <Route path="/areas/:slug" element={<AreaWorkstream />} />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
        <Route path="/facts" element={<ProjectFacts />} />
        <Route path="/solutions" element={<Solutions />} />
        <Route path="/artifacts" element={<Artifacts />} />
        <Route path="/material-plan" element={<MaterialPlan />} />
        <Route path="/build-lists" element={<BuildPreparation />} />
        <Route path="/building" element={<BuildingContext projectId={project.id} context={db.buildingContext} />} />
        <Route path="/people" element={<People />} />
        <Route path="/events" element={<Events />} />
        <Route path="/events/:slug" element={<EventDetail />} />
        <Route path="/food" element={<Food />} />
        <Route path="/food/shopping" element={<FoodShopping />} />
        <Route path="/shopping" element={<Shopping />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/today" element={<Today />} />
        <Route path="/signin" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
