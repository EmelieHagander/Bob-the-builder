import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import * as db from './data/database'
import { Loading, useAsync, useProjectVersion } from './components/ui'
import { Layout } from './components/Layout'
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
  // The active project decides the colour theme (forest / dusk / birch).
  // Refetches when the active project changes (switch from the account
  // level) and after the first project is created.
  const projectVersion = useProjectVersion()
  const [bootVersion, setBootVersion] = useState(0)
  const { data: project, loading } = useAsync(() => db.getProject(), [projectVersion, bootVersion])

  useEffect(() => {
    if (project) document.documentElement.setAttribute('data-theme', project.theme)
  }, [project])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loading />
      </div>
    )
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
        <Route path="/signin" element={<SignIn />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
