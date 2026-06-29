/*
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  database.ts — THE database layer.                                          │
 * │                                                                            │
 * │  This is the single place in the whole app that knows where data comes      │
 * │  from. Every screen talks to the app *only* through the functions exported   │
 * │  here — no component imports `mockData.ts` directly.                         │
 * │                                                                            │
 * │  Right now these functions return the mock data in `mockData.ts`. When we    │
 * │  are ready for a real backend (the PRD suggests Supabase for realtime +      │
 * │  auth + image storage), this is the ONLY file that needs to change:          │
 * │                                                                            │
 * │    1. Create the client in the "CONNECTION" block below                     │
 * │       (e.g. `const db = createClient(URL, KEY)`).                           │
 * │    2. Replace each function body with the equivalent query                  │
 * │       (e.g. `return (await db.from('areas').select('*')).data`).            │
 * │                                                                            │
 * │  The signatures stay identical, so no UI code has to change. The functions   │
 * │  are already async and return clones, so swapping in a network call is a     │
 * │  drop-in.                                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import * as mock from './mockData'
import type {
  Announcement,
  Area,
  BuildEvent,
  ChatMessage,
  DietMatrixRow,
  FoodGroup,
  Material,
  Meal,
  Person,
  Project,
  Task,
  TodayTask,
} from './types'

/* ─────────────────────────── CONNECTION ───────────────────────────
 * When moving to a real backend, instantiate the client here. Example:
 *
 *   import { createClient } from '@supabase/supabase-js'
 *   const db = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
 *
 * For now we run against the in-memory mock source. `USE_MOCK` is the single
 * flag that decides which path everything below takes.
 * ──────────────────────────────────────────────────────────────── */

const USE_MOCK = true

/** Simulated network latency (ms) so the UI exercises its loading states. */
const LATENCY = 120

/**
 * Tiny helper that mimics an async data source. Returns a deep clone so callers
 * can never accidentally mutate the underlying store — exactly how a real query
 * would behave (you always get a fresh row set back).
 */
function read<T>(value: T): Promise<T> {
  if (!USE_MOCK) {
    // Real backend queries would go here, per-function. See header note.
    throw new Error('database.ts: no live backend configured — set USE_MOCK or wire up a client.')
  }
  const clone = structuredClone(value)
  return new Promise((resolve) => setTimeout(() => resolve(clone), LATENCY))
}

/* ─────────────────────────── PROJECT ─────────────────────────── */

export function getProject(): Promise<Project> {
  return read(mock.project)
}

/* ─────────────────────────── PEOPLE ─────────────────────────── */

export function getPeople(): Promise<Person[]> {
  return read(mock.people)
}

export async function getPerson(id: string): Promise<Person | undefined> {
  return (await getPeople()).find((p) => p.id === id)
}

/** Resolve a list of person ids to people, preserving order. */
export async function getPeopleByIds(ids: string[]): Promise<Person[]> {
  const all = await getPeople()
  const byId = new Map(all.map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is Person => Boolean(p))
}

/* ─────────────────────────── AREAS & TASKS ─────────────────────────── */

export function getAreas(): Promise<Area[]> {
  return read(mock.areas)
}

export async function getArea(slug: string): Promise<Area | undefined> {
  return (await getAreas()).find((a) => a.slug === slug)
}

export function getTasks(): Promise<Task[]> {
  return read(mock.tasks)
}

export async function getTasksByArea(areaId: string): Promise<Task[]> {
  return (await getTasks()).filter((t) => t.areaId === areaId)
}

/* ─────────────────────────── MATERIALS ─────────────────────────── */

export function getMaterials(): Promise<Material[]> {
  return read(mock.materials)
}

/** Materials grouped by category, in first-seen order — for the shopping list. */
export async function getMaterialsGrouped(): Promise<
  { category: string; icon: string; items: Material[] }[]
> {
  const items = await getMaterials()
  const groups: { category: string; icon: string; items: Material[] }[] = []
  for (const item of items) {
    let group = groups.find((g) => g.category === item.category)
    if (!group) {
      group = { category: item.category, icon: item.categoryIcon, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

/* ─────────────────────────── EVENTS ─────────────────────────── */

export function getEvents(): Promise<BuildEvent[]> {
  return read(mock.events)
}

export async function getEvent(slug: string): Promise<BuildEvent | undefined> {
  return (await getEvents()).find((e) => e.slug === slug)
}

/** The soonest upcoming event — drives the dashboard "next build day" card. */
export async function getNextEvent(): Promise<BuildEvent | undefined> {
  return (await getEvents())[0]
}

/* ─────────────────────────── FOOD ─────────────────────────── */

export function getMeals(): Promise<Meal[]> {
  return read(mock.meals)
}

export function getDietColumns(): Promise<string[]> {
  return read(mock.dietColumns)
}

export function getDietMatrix(): Promise<DietMatrixRow[]> {
  return read(mock.dietMatrix)
}

export function getFoodShopping(): Promise<FoodGroup[]> {
  return read(mock.foodShopping)
}

/* ─────────────────────────── COMMUNICATION ─────────────────────────── */

export function getAnnouncements(): Promise<Announcement[]> {
  return read(mock.announcements)
}

/* ─────────────────────────── DAY-OF / TODAY ─────────────────────────── */

export function getTodayTasks(): Promise<TodayTask[]> {
  return read(mock.todayTasks)
}

/* ─────────────────────────── ASK BOB ─────────────────────────── */

export function getAskBobChat(): Promise<ChatMessage[]> {
  return read(mock.askBobChat)
}

export function getAskBobChips(): Promise<string[]> {
  return read(mock.askBobChips)
}

/* ─────────────────────────── DERIVED / DASHBOARD ───────────────────────────
 * Aggregations the dashboard needs. Kept here (not in components) so that when
 * a real DB arrives these can become efficient queries / views instead of
 * client-side reductions.
 * ──────────────────────────────────────────────────────────────────────── */

export interface DashboardStat {
  icon: string
  value: string
  label: string
  color: string
}

export async function getDashboardStats(): Promise<DashboardStat[]> {
  const [areas, materials, events] = await Promise.all([getAreas(), getMaterials(), getEvents()])
  const overall = Math.round(
    areas.reduce((sum, a) => sum + a.donePct, 0) / Math.max(areas.length, 1),
  )
  const stillNeeded = materials.filter((m) => m.status === 'needed' || m.status === 'backorder').length
  const next = events[0]
  const [taken, cap] = next ? next.spots.split('/').map((s) => s.trim()) : ['0', '0']
  return [
    { icon: 'calendar-dots', value: next ? next.day : '—', label: 'Next build day', color: 'var(--accent)' },
    { icon: 'users-three', value: `${taken} / ${cap}`, label: 'Volunteers confirmed', color: 'var(--leaf)' },
    { icon: 'chart-pie-slice', value: `${overall}%`, label: 'Overall complete', color: 'var(--honey)' },
    { icon: 'package', value: String(stillNeeded), label: 'Materials still needed', color: 'var(--clay)' },
  ]
}

export interface AttentionItem {
  icon: string
  tone: 'clay' | 'honey'
  text: string
}

/** "Needs attention" feed — derived from unassigned tasks, blockers, skill gaps. */
export async function getAttention(): Promise<AttentionItem[]> {
  const [areas, tasks, materials] = await Promise.all([getAreas(), getTasks(), getMaterials()])
  const areaName = new Map(areas.map((a) => [a.id, a.name]))
  const items: AttentionItem[] = []

  // Areas with unassigned tasks
  const unassignedByArea = new Map<string, number>()
  for (const t of tasks) {
    if (t.assigneeIds.length === 0) {
      unassignedByArea.set(t.areaId, (unassignedByArea.get(t.areaId) ?? 0) + 1)
    }
  }
  for (const [areaId, count] of unassignedByArea) {
    if (count >= 2) {
      items.push({ icon: 'user-circle-dashed', tone: 'clay', text: `${count} tasks in ${areaName.get(areaId)} have nobody assigned yet` })
    }
  }

  // Back-ordered materials
  for (const m of materials) {
    if (m.status === 'backorder') {
      items.push({ icon: 'package', tone: 'honey', text: `${m.area} — ${m.name.toLowerCase()} is on back-order` })
    }
  }

  // Expert tasks with no assignee
  const expertGap = tasks.find((t) => t.skill === 'expert' && t.assigneeIds.length === 0)
  if (expertGap) {
    items.push({ icon: 'medal', tone: 'clay', text: `"${expertGap.name}" needs a skilled hand — none confirmed` })
  }

  return items.slice(0, 4)
}

/** Headline summary for the food / event pages, derived from the diet matrix. */
export async function getFoodSummary(): Promise<string> {
  const [columns, matrix, next] = await Promise.all([getDietColumns(), getDietMatrix(), getNextEvent()])
  const counts = columns.map((_, i) => matrix.filter((r) => r.flags[i]).length)
  const confirmed = next ? next.spots.split('/')[0].trim() : String(matrix.length)
  const parts = columns
    .map((c, i) => (counts[i] > 0 ? `${counts[i]} ${c.toLowerCase()}` : null))
    .filter(Boolean)
  return `${confirmed} confirmed for Saturday · ${parts.join(' · ')}`
}
