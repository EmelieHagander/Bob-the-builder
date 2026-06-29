import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import * as db from './data/database'
import { useAsync } from './components/ui'
import { Layout } from './components/Layout'
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
  const { data: project } = useAsync(() => db.getProject(), [])

  useEffect(() => {
    if (project) document.documentElement.setAttribute('data-theme', project.theme)
  }, [project])

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
