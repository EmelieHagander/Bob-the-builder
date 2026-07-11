import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import * as db from './data/database'
import { Loading, useAsync } from './components/ui'
import { Layout } from './components/Layout'
import { StartProject } from './pages/StartProject'
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
import { NotFound } from './pages/NotFound'

export function App() {
  // The active project decides the colour theme (forest / dusk / birch).
  // Bumped after the first project is created so everything refetches.
  const [projectVersion, setProjectVersion] = useState(0)
  const { data: project, loading } = useAsync(() => db.getProject(), [projectVersion])

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
    return <StartProject onCreated={() => setProjectVersion((v) => v + 1)} />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
