/*
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  database.ts — THE database layer.                                          │
 * │                                                                            │
 * │  This is the single place in the whole app that knows where data comes      │
 * │  from. Every screen talks to the app *only* through the functions exported   │
 * │  here — no component imports `mockData.ts` directly.                         │
 * │                                                                            │
 * │  Two modes, decided once at startup:                                        │
 * │                                                                            │
 * │    • LIVE — when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set, every   │
 * │      getter queries the real database. The database is SHARED with other     │
 * │      apps, so all of bob's objects live in their own Postgres schema         │
 * │      (`bob`, see db/) and the client is scoped to it below.                  │
 * │                                                                            │
 * │    • MOCK — with no env config the app runs the in-memory sample data in     │
 * │      mockData.ts, exactly as before. Handy for dev and demos.                │
 * │                                                                            │
 * │  The signatures are identical in both modes, so no UI code knows or cares.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { createClient } from '@supabase/supabase-js'
import * as mock from './mockData'
import type {
  Announcement,
  Area,
  BuildEvent,
  ChatMessage,
  DietMatrixRow,
  EventStatus,
  FoodGroup,
  Material,
  MaterialStatus,
  Meal,
  Person,
  Project,
  SkillLevel,
  Task,
  TaskStatus,
  ThemeName,
  TodayTask,
} from './types'

/* ─────────────────────────── CONNECTION ───────────────────────────
 * The database is shared, so the client is pinned to bob's own schema —
 * table names in the queries below stay bare (`areas`, not `bob.areas`).
 * Schema + seed live in db/; see db/README.md for setup.
 * ──────────────────────────────────────────────────────────────── */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const db =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'bob' } })
    : null

/** Simulated network latency (ms) so the mock path exercises loading states. */
const LATENCY = 120

/**
 * Mock-mode helper. Returns a deep clone so callers can never accidentally
 * mutate the underlying store — exactly how a real query behaves.
 */
function read<T>(value: T): Promise<T> {
  const clone = structuredClone(value)
  return new Promise((resolve) => setTimeout(() => resolve(clone), LATENCY))
}

/** Live-mode helper: throw on query error, never hand `null` to the UI. */
function unwrap<T>(res: { data: T | null; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(`database: ${res.error.message}`)
  if (res.data === null || res.data === undefined) throw new Error('database: query returned no data')
  return res.data
}

/* Row shapes as they come back from the bob schema (snake_case, join tables
 * embedded). Passed explicitly to `unwrap` so the mapping below stays checked. */

type ProjectRow = {
  id: string; slug: string; name: string; description: string
  location: string; type: string; theme: string; start_label: string
}
type PersonRow = {
  id: string; name: string; initials: string; color: string; role: string; diet: string
  person_skills: { name: string; level: string }[]
}
type AreaRow = {
  id: string; slug: string; name: string; description: string; icon: string
  lead_id: string | null; assigned_pct: number; materials_pct: number; done_pct: number
  task_summary: string
  area_crew: { person_id: string }[]
  area_reference_images: { label: string; sort_order: number }[]
}
type TaskRow = {
  id: string; area_id: string; name: string; skill: string; hours: string
  status: string; materials: string
  task_assignees: { person_id: string }[]
}
type MaterialRow = {
  id: string; name: string; qty: string; area_label: string; supplier: string
  status: string; cost: string; category: string; category_icon: string
}
type EventRow = {
  id: string; slug: string; title: string; day: string; time: string; place: string
  spots: string; status: string; food: string
  event_attendees: { person_id: string }[]
}
type MealRow = { id: string; meal: string; time: string; icon: string; dish: string; notes: string }
type FoodGroupRow = {
  category: string; icon: string
  food_items: { name: string; qty: string; note: string; checked: boolean; sort_order: number }[]
}
type AnnouncementRow = {
  id: string; author_id: string | null; time_label: string; pinned: boolean
  text: string; reacts: number; comments: number
}
type TodayTaskRow = {
  id: string; area_name: string; name: string; skill: string; status: string
  assignee_ids: string[]
}

/* ─────────────────────────── PROJECT ─────────────────────────── */

export async function getProject(): Promise<Project> {
  if (!db) return read(mock.project)
  const row = unwrap<ProjectRow>(
    await db
      .from('projects')
      .select('id, slug, name, description, location, type, theme, start_label')
      .limit(1)
      .single(),
  )
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    location: row.location,
    type: row.type,
    theme: row.theme as ThemeName,
    startLabel: row.start_label,
  }
}

/* ─────────────────────────── PEOPLE ─────────────────────────── */

export async function getPeople(): Promise<Person[]> {
  if (!db) return read(mock.people)
  const rows = unwrap<PersonRow[]>(
    await db
      .from('people')
      .select('id, name, initials, color, role, diet, person_skills(name, level)')
      .order('sort_order'),
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    initials: row.initials,
    color: row.color,
    role: row.role,
    diet: row.diet,
    skills: row.person_skills.map((s) => ({ name: s.name, level: s.level as SkillLevel })),
  }))
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

export async function getAreas(): Promise<Area[]> {
  if (!db) return read(mock.areas)
  const rows = unwrap<AreaRow[]>(
    await db
      .from('areas')
      .select(
        'id, slug, name, description, icon, lead_id, assigned_pct, materials_pct, done_pct, task_summary, area_crew(person_id), area_reference_images(label, sort_order)',
      )
      .order('sort_order'),
  )
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    leadId: row.lead_id,
    assignedPct: row.assigned_pct,
    materialsPct: row.materials_pct,
    donePct: row.done_pct,
    taskSummary: row.task_summary,
    crewIds: row.area_crew.map((c) => c.person_id),
    referenceImages: [...row.area_reference_images]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((img) => ({ label: img.label })),
  }))
}

export async function getArea(slug: string): Promise<Area | undefined> {
  return (await getAreas()).find((a) => a.slug === slug)
}

export async function getTasks(): Promise<Task[]> {
  if (!db) return read(mock.tasks)
  const rows = unwrap<TaskRow[]>(
    await db
      .from('tasks')
      .select('id, area_id, name, skill, hours, status, materials, task_assignees(person_id)')
      .order('id'),
  )
  return rows.map((row) => ({
    id: row.id,
    areaId: row.area_id,
    name: row.name,
    skill: row.skill as SkillLevel,
    hours: row.hours,
    status: row.status as TaskStatus,
    materials: row.materials,
    assigneeIds: row.task_assignees.map((a) => a.person_id),
  }))
}

export async function getTasksByArea(areaId: string): Promise<Task[]> {
  return (await getTasks()).filter((t) => t.areaId === areaId)
}

/* ─────────────────────────── MATERIALS ─────────────────────────── */

export async function getMaterials(): Promise<Material[]> {
  if (!db) return read(mock.materials)
  const rows = unwrap<MaterialRow[]>(
    await db
      .from('materials')
      .select('id, name, qty, area_label, supplier, status, cost, category, category_icon')
      .order('sort_order'),
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    qty: row.qty,
    area: row.area_label,
    supplier: row.supplier,
    status: row.status as MaterialStatus,
    cost: row.cost,
    category: row.category,
    categoryIcon: row.category_icon,
  }))
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

export async function getEvents(): Promise<BuildEvent[]> {
  if (!db) return read(mock.events)
  const rows = unwrap<EventRow[]>(
    await db
      .from('events')
      .select('id, slug, title, day, time, place, spots, status, food, event_attendees(person_id)')
      .order('sort_order'),
  )
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    day: row.day,
    time: row.time,
    place: row.place,
    spots: row.spots,
    status: row.status as EventStatus,
    food: row.food,
    attendeeIds: row.event_attendees.map((a) => a.person_id),
  }))
}

export async function getEvent(slug: string): Promise<BuildEvent | undefined> {
  return (await getEvents()).find((e) => e.slug === slug)
}

/** The soonest upcoming event — drives the dashboard "next build day" card. */
export async function getNextEvent(): Promise<BuildEvent | undefined> {
  return (await getEvents())[0]
}

/* ─────────────────────────── FOOD ─────────────────────────── */

export async function getMeals(): Promise<Meal[]> {
  if (!db) return read(mock.meals)
  const rows = unwrap<MealRow[]>(
    await db.from('meals').select('id, meal, time, icon, dish, notes').order('sort_order'),
  )
  return rows.map((row) => ({
    id: row.id,
    meal: row.meal,
    time: row.time,
    icon: row.icon,
    dish: row.dish,
    notes: row.notes,
  }))
}

export async function getDietColumns(): Promise<string[]> {
  if (!db) return read(mock.dietColumns)
  const rows = unwrap<{ name: string }[]>(await db.from('diet_columns').select('name').order('sort_order'))
  return rows.map((row) => row.name)
}

export async function getDietMatrix(): Promise<DietMatrixRow[]> {
  if (!db) return read(mock.dietMatrix)
  const [people, columns, flags] = await Promise.all([
    unwrap<{ id: string }[]>(await db.from('people').select('id').order('sort_order')),
    unwrap<{ id: string }[]>(await db.from('diet_columns').select('id').order('sort_order')),
    unwrap<{ person_id: string; column_id: string }[]>(await db.from('diet_flags').select('person_id, column_id')),
  ])
  const flagged = new Set(flags.map((f) => `${f.person_id}:${f.column_id}`))
  return people.map((p) => ({
    personId: p.id,
    flags: columns.map((c) => flagged.has(`${p.id}:${c.id}`)),
  }))
}

export async function getFoodShopping(): Promise<FoodGroup[]> {
  if (!db) return read(mock.foodShopping)
  const rows = unwrap<FoodGroupRow[]>(
    await db
      .from('food_groups')
      .select('category, icon, food_items(name, qty, note, checked, sort_order)')
      .order('sort_order'),
  )
  return rows.map((row) => ({
    category: row.category,
    icon: row.icon,
    items: [...row.food_items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ name: i.name, qty: i.qty, note: i.note, checked: i.checked })),
  }))
}

/* ─────────────────────────── COMMUNICATION ─────────────────────────── */

export async function getAnnouncements(): Promise<Announcement[]> {
  if (!db) return read(mock.announcements)
  const rows = unwrap<AnnouncementRow[]>(
    await db
      .from('announcements')
      .select('id, author_id, time_label, pinned, text, reacts, comments')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id'),
  )
  return rows.map((row) => ({
    id: row.id,
    authorId: row.author_id ?? '',
    time: row.time_label,
    pinned: row.pinned,
    text: row.text,
    reacts: row.reacts,
    comments: row.comments,
  }))
}

/* ─────────────────────────── DAY-OF / TODAY ─────────────────────────── */

export async function getTodayTasks(): Promise<TodayTask[]> {
  if (!db) return read(mock.todayTasks)
  const rows = unwrap<TodayTaskRow[]>(
    await db
      .from('today_tasks')
      .select('id, area_name, name, skill, status, assignee_ids')
      .order('id'),
  )
  return rows.map((row) => ({
    id: row.id,
    areaName: row.area_name,
    name: row.name,
    skill: row.skill as SkillLevel,
    status: row.status as TaskStatus,
    assigneeIds: row.assignee_ids,
  }))
}

/* ─────────────────────────── ASK BOB ───────────────────────────
 * The assistant conversation is scripted client-side content, not project
 * data — it stays out of the database in both modes.
 * ──────────────────────────────────────────────────────────────── */

export function getAskBobChat(): Promise<ChatMessage[]> {
  return read(mock.askBobChat)
}

export function getAskBobChips(): Promise<string[]> {
  return read(mock.askBobChips)
}

/* ─────────────────────────── DERIVED / DASHBOARD ───────────────────────────
 * Aggregations the dashboard needs. Built on the getters above, so they work
 * identically in live and mock mode; if they ever get heavy they can become
 * database views instead of client-side reductions.
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
