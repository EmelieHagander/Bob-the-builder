import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import * as db from './data/database'
import { Loading, useAsync, useProjectVersion } from './components/ui'
import { Layout, useAuthTick } from './components/Layout'
import { StartProject } from './pages/StartProject'
import { AccountDashboard } from './pages/account/AccountDashboard'
import { AccountCalendar } from './pages/account/AccountCalendar'
import { AccountSettings } from './pages/account/AccountSettings'
import { Dashboard } from './pages/Dashboard'
import { Areas } from './pages/Areas'
import { AreaDetail } from './pages/AreaDetail'
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

export function App() {
  const navigate = useNavigate()
  // The active project decides the colour theme (forest / dusk / birch).
  // Refetches when the active project changes (switch from the account
  // level) and after the first project is created.
  const projectVersion = useProjectVersion()
  const authTick = useAuthTick()
  const [bootVersion, setBootVersion] = useState(0)
  const { data: project, loading } = useAsync(() => db.getProject(), [projectVersion, bootVersion])
  const { data: signedIn, loading: sessionLoading } = useAsync(() => db.hasSession(), [authTick])

  useEffect(() => {
    if (project) document.documentElement.setAttribute('data-theme', project.theme)
  }, [project])

  // After signing in, land on the account dashboard — regardless of whether
  // the session arrived from the form, the guest button, or a magic link.
  const wasSignedOut = useRef(false)
  useEffect(() => {
    if (signedIn === false) wasSignedOut.current = true
    if (signedIn && wasSignedOut.current) {
      wasSignedOut.current = false
      navigate('/account')
    }
  }, [signedIn, navigate])

  if (loading || sessionLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loading />
      </div>
    )
  }

  // Live mode requires a signed-in member (or the guest) before anything else.
  // The sign-in screen stands alone — no sidebar, no menus. Demo mode has no
  // auth and skips straight in.
  if (db.authEnabled() && !signedIn) {
    return <SignIn />
  }

  // Fresh install (or demo data just removed): no project in the database yet.
  if (!project) {
    return <StartProject onCreated={() => setBootVersion((v) => v + 1)} />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/account" element={<AccountDashboard />} />
        <Route path="/account/calendar" element={<AccountCalendar />} />
        <Route path="/account/settings" element={<AccountSettings />} />
        <Route path="/areas" element={<Areas />} />
        <Route path="/areas/:slug" element={<AreaDetail />} />
        <Route path="/people" element={<People />} />
        <Route path="/events" element={<Events />} />
        <Route path="/events/:slug" element={<EventDetail />} />
        <Route path="/food" element={<Food />} />
        <Route path="/food/shopping" element={<FoodShopping />} />
        <Route path="/shopping" element={<Shopping />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/today" element={<Today />} />
        {/* Signed-in users don't need the form — the gate above owns sign-in. */}
        <Route path="/signin" element={<Navigate to="/account" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
