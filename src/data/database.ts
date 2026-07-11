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
  Account,
  AccountNote,
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
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        db: { schema: 'bob' },
        // PKCE puts the magic-link token in the query string instead of the
        // URL hash, which would otherwise collide with the HashRouter.
        auth: { flowType: 'pkce' },
      })
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
  start_date: string | null; end_date: string | null
}
type AccountRow = { id: string; name: string; owner_name: string; email: string }
type NoteRow = { id: string; text: string; pinned: boolean; created_at: string }
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

/* ─────────────────────────── ACTIVE PROJECT ───────────────────────────
 * The account level brought multiple projects. Which one the app is "inside"
 * is a client-side choice kept in localStorage; every project-scoped getter
 * below filters by it. Switching fires PROJECT_CHANGED_EVENT so mounted
 * screens can refetch.
 * ──────────────────────────────────────────────────────────────────── */

const ACTIVE_PROJECT_KEY = 'bob:active-project'
export const PROJECT_CHANGED_EVENT = 'bob:project-changed'

export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY)
  } catch {
    return null
  }
}

export function setActiveProject(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id)
  } catch {
    // storage unavailable (private mode) — the event still refreshes this session
  }
  window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT))
}

/** The active project's id, or null when there are no projects at all. */
async function activeProjectId(): Promise<string | null> {
  return (await getProject())?.id ?? null
}

/**
 * Mock-mode helper for project-scoped collections. The sample detail content
 * (people, areas, tasks…) all belongs to Skogsstuga; the other demo projects
 * honestly have nothing in them yet.
 */
function readScoped<T>(value: T[]): Promise<T[]> {
  const stored = getActiveProjectId()
  const active = mock.projects.find((p) => p.id === stored) ?? mock.projects[0]
  return read(active?.id === 'p_skogsstuga' ? value : [])
}

/* ─────────────────────────── PROJECTS ─────────────────────────── */

const PROJECT_COLS = 'id, slug, name, description, location, type, theme, start_label, start_date, end_date'

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    location: row.location,
    type: row.type,
    theme: row.theme as ThemeName,
    startLabel: row.start_label,
    startDate: row.start_date,
    endDate: row.end_date,
  }
}

/** Every project on the account — the account dashboard and calendar feed. */
export async function getProjects(): Promise<Project[]> {
  if (!db) return read(mock.projects)
  const rows = unwrap<ProjectRow[]>(await db.from('projects').select(PROJECT_COLS).order('created_at'))
  return rows.map(mapProject)
}

/** The active project — `null` when the database has none yet (fresh install). */
export async function getProject(): Promise<Project | null> {
  const projects = await getProjects()
  const activeId = getActiveProjectId()
  return projects.find((p) => p.id === activeId) ?? projects[0] ?? null
}

export interface NewProject {
  name: string
  description: string
  location: string
  type: string
  theme: ThemeName
  startLabel: string
  /** optional schedule — both ISO dates, or both null while unscheduled */
  startDate?: string | null
  endDate?: string | null
}

/**
 * Create a project. In live mode this needs a signed-in member — see the
 * RLS policies in db/migrations/0006 (the 0004 bootstrap keeps the FIRST
 * project open while the database is empty). In mock mode the project
 * lives in memory until the page reloads.
 */
export async function createProject(input: NewProject): Promise<Project> {
  const slug = input.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project'
  if (!db) {
    if (mock.projects.some((p) => p.id === `p_${slug}`)) {
      throw new Error(`database: a project called "${input.name}" already exists`)
    }
    const project: Project = {
      id: `p_${slug}`,
      slug,
      name: input.name,
      description: input.description,
      location: input.location,
      type: input.type,
      theme: input.theme,
      startLabel: input.startLabel,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    }
    mock.projects.push(project)
    return read(project)
  }
  const row = unwrap<ProjectRow>(
    await db
      .from('projects')
      .insert({
        id: `p_${slug}`,
        slug,
        name: input.name,
        description: input.description,
        location: input.location,
        type: input.type,
        theme: input.theme,
        start_label: input.startLabel,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
      })
      .select(PROJECT_COLS)
      .single(),
  )
  return mapProject(row)
}

/** Set or clear a project's build window (both dates, or both null). */
export async function updateProjectSchedule(
  id: string,
  startDate: string | null,
  endDate: string | null,
): Promise<Project> {
  if (!db) {
    const project = mock.projects.find((p) => p.id === id)
    if (!project) throw new Error('database: no such project')
    project.startDate = startDate
    project.endDate = endDate
    return read(project)
  }
  const row = unwrap<ProjectRow>(
    await db
      .from('projects')
      .update({ start_date: startDate, end_date: endDate })
      .eq('id', id)
      .select(PROJECT_COLS)
      .single(),
  )
  return mapProject(row)
}

/* ─────────────────────────── ACCOUNT ─────────────────────────── */

function mapAccount(row: AccountRow): Account {
  return { id: row.id, name: row.name, ownerName: row.owner_name, email: row.email }
}

/** The single account row (seeded by db/migrations/0006). */
export async function getAccount(): Promise<Account> {
  if (!db) return read(mock.account)
  const row = unwrap<AccountRow>(await db.from('account').select('id, name, owner_name, email').single())
  return mapAccount(row)
}

export interface AccountUpdate {
  name: string
  ownerName: string
  email: string
}

export async function updateAccount(input: AccountUpdate): Promise<Account> {
  if (!db) {
    Object.assign(mock.account, input)
    return read(mock.account)
  }
  const row = unwrap<AccountRow>(
    await db
      .from('account')
      .update({ name: input.name, owner_name: input.ownerName, email: input.email })
      .eq('id', 'account')
      .select('id, name, owner_name, email')
      .single(),
  )
  return mapAccount(row)
}

/* ─────────────────────────── ACCOUNT NOTES ─────────────────────────── */

function mapNote(row: NoteRow): AccountNote {
  return { id: row.id, text: row.text, pinned: row.pinned, createdAt: row.created_at }
}

function sortNotes(notes: AccountNote[]): AccountNote[] {
  return [...notes].sort((a, b) =>
    a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.createdAt.localeCompare(a.createdAt),
  )
}

export async function getNotes(): Promise<AccountNote[]> {
  if (!db) return read(sortNotes(mock.accountNotes))
  const rows = unwrap<NoteRow[]>(
    await db
      .from('account_notes')
      .select('id, text, pinned, created_at')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false }),
  )
  return rows.map(mapNote)
}

export async function addNote(text: string): Promise<AccountNote> {
  if (!db) {
    const note: AccountNote = {
      id: crypto.randomUUID(),
      text,
      pinned: false,
      createdAt: new Date().toISOString(),
    }
    mock.accountNotes.unshift(note)
    return read(note)
  }
  const row = unwrap<NoteRow>(
    await db.from('account_notes').insert({ text }).select('id, text, pinned, created_at').single(),
  )
  return mapNote(row)
}

export async function setNotePinned(id: string, pinned: boolean): Promise<void> {
  if (!db) {
    const note = mock.accountNotes.find((n) => n.id === id)
    if (note) note.pinned = pinned
    await read(null)
    return
  }
  const res = await db.from('account_notes').update({ pinned }).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export async function deleteNote(id: string): Promise<void> {
  if (!db) {
    const i = mock.accountNotes.findIndex((n) => n.id === id)
    if (i >= 0) mock.accountNotes.splice(i, 1)
    await read(null)
    return
  }
  const res = await db.from('account_notes').delete().eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

/* ─────────────────────────── PEOPLE ─────────────────────────── */

export async function getPeople(): Promise<Person[]> {
  if (!db) return readScoped(mock.people)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<PersonRow[]>(
    await db
      .from('people')
      .select('id, name, initials, color, role, diet, person_skills(name, level)')
      .eq('project_id', pid)
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

/* ─────────────────────────── AUTH / CURRENT USER ───────────────────────────
 * Live mode: Supabase Auth (magic link or password). Signing in calls
 * bob.join_project() server-side, which claims the invited person matching
 * the email — or creates a fresh Volunteer profile. Mock mode: no auth, the
 * first organiser plays "you", exactly as before.
 * ──────────────────────────────────────────────────────────────────────── */

/** Whether real sign-in exists (live mode). Mock mode has no auth. */
export function authEnabled(): boolean {
  return db !== null
}

let sessionPerson: Person | null = null

/** Who is using the app: the signed-in member, or null when signed out. */
export async function getCurrentUser(): Promise<Person | null> {
  if (!db) {
    // Demo mode: the first organiser plays the signed-in user.
    const people = await getPeople()
    return people.find((p) => p.role.toLowerCase().includes('organiser')) ?? people[0] ?? null
  }
  const { data } = await db.auth.getSession()
  if (!data.session) return null
  if (sessionPerson) return sessionPerson
  const res = await db.rpc('join_project')
  if (res.error) throw new Error(`database: ${res.error.message}`)
  const row = res.data as { id: string; name: string; initials: string; color: string; role: string; diet: string }
  // Re-read through getPeople so skills come along and shapes stay identical.
  // getPeople is scoped to the ACTIVE project; when the member's person row
  // lives in another project, fall back to the row join_project returned so
  // the signed-in identity stays visible across the account.
  sessionPerson =
    (await getPerson(row.id)) ??
    { id: row.id, name: row.name, initials: row.initials, color: row.color, role: row.role, diet: row.diet, skills: [] }
  return sessionPerson
}

/** Sends the sign-in link. The link returns to the app, which finishes the session. */
export async function signInWithMagicLink(email: string): Promise<void> {
  if (!db) throw new Error('Running on demo data — sign-in needs the live database.')
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  })
  if (error) throw new Error(error.message)
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!db) throw new Error('Running on demo data — sign-in needs the live database.')
  const { error } = await db.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

/** Returns true when the account is ready, false when email confirmation is pending. */
export async function signUpWithPassword(email: string, password: string): Promise<boolean> {
  if (!db) throw new Error('Running on demo data — sign-up needs the live database.')
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  })
  if (error) throw new Error(error.message)
  return data.session !== null
}

export async function signOut(): Promise<void> {
  if (!db) return
  sessionPerson = null
  await db.auth.signOut()
}

/** Subscribe to sign-in/out; returns an unsubscribe function. */
export function onAuthChange(callback: () => void): () => void {
  if (!db) return () => {}
  const { data } = db.auth.onAuthStateChange(() => {
    sessionPerson = null
    callback()
  })
  return () => data.subscription.unsubscribe()
}

/** Resolve a list of person ids to people, preserving order. */
export async function getPeopleByIds(ids: string[]): Promise<Person[]> {
  const all = await getPeople()
  const byId = new Map(all.map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is Person => Boolean(p))
}

/* ─────────────────────────── AREAS & TASKS ─────────────────────────── */

export async function getAreas(): Promise<Area[]> {
  if (!db) return readScoped(mock.areas)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<AreaRow[]>(
    await db
      .from('areas')
      .select(
        'id, slug, name, description, icon, lead_id, assigned_pct, materials_pct, done_pct, task_summary, area_crew(person_id), area_reference_images(label, sort_order)',
      )
      .eq('project_id', pid)
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
  if (!db) return readScoped(mock.tasks)
  const pid = await activeProjectId()
  if (!pid) return []
  // tasks carry no project_id — scope through their area
  const rows = unwrap<TaskRow[]>(
    await db
      .from('tasks')
      .select('id, area_id, name, skill, hours, status, materials, task_assignees(person_id), areas!inner(project_id)')
      .eq('areas.project_id', pid)
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
  if (!db) return readScoped(mock.materials)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<MaterialRow[]>(
    await db
      .from('materials')
      .select('id, name, qty, area_label, supplier, status, cost, category, category_icon')
      .eq('project_id', pid)
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
  if (!db) return readScoped(mock.events)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<EventRow[]>(
    await db
      .from('events')
      .select('id, slug, title, day, time, place, spots, status, food, event_attendees(person_id)')
      .eq('project_id', pid)
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
  if (!db) return readScoped(mock.meals)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<MealRow[]>(
    await db.from('meals').select('id, meal, time, icon, dish, notes').eq('project_id', pid).order('sort_order'),
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
  if (!db) return readScoped(mock.dietColumns)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<{ name: string }[]>(
    await db.from('diet_columns').select('name').eq('project_id', pid).order('sort_order'),
  )
  return rows.map((row) => row.name)
}

export async function getDietMatrix(): Promise<DietMatrixRow[]> {
  if (!db) return readScoped(mock.dietMatrix)
  const pid = await activeProjectId()
  if (!pid) return []
  const [people, columns, flags] = await Promise.all([
    unwrap<{ id: string }[]>(await db.from('people').select('id').eq('project_id', pid).order('sort_order')),
    unwrap<{ id: string }[]>(await db.from('diet_columns').select('id').eq('project_id', pid).order('sort_order')),
    // flags carry no project_id — scope through the person they belong to
    unwrap<{ person_id: string; column_id: string }[]>(
      await db.from('diet_flags').select('person_id, column_id, people!inner(project_id)').eq('people.project_id', pid),
    ),
  ])
  const flagged = new Set(flags.map((f) => `${f.person_id}:${f.column_id}`))
  return people.map((p) => ({
    personId: p.id,
    flags: columns.map((c) => flagged.has(`${p.id}:${c.id}`)),
  }))
}

export async function getFoodShopping(): Promise<FoodGroup[]> {
  if (!db) return readScoped(mock.foodShopping)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<FoodGroupRow[]>(
    await db
      .from('food_groups')
      .select('category, icon, food_items(name, qty, note, checked, sort_order)')
      .eq('project_id', pid)
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
  if (!db) return readScoped(mock.announcements)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<AnnouncementRow[]>(
    await db
      .from('announcements')
      .select('id, author_id, time_label, pinned, text, reacts, comments')
      .eq('project_id', pid)
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
  if (!db) return readScoped(mock.todayTasks)
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<TodayTaskRow[]>(
    await db
      .from('today_tasks')
      .select('id, area_name, name, skill, status, assignee_ids')
      .eq('project_id', pid) // column added to the view in db/migrations/0006
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
 * There is no assistant backend yet. In mock mode bob plays the scripted
 * Skogsstuga conversation from the mockup; in live mode he introduces
 * himself and surfaces the real "needs attention" feed, so he never talks
 * about demo content that isn't there.
 * ──────────────────────────────────────────────────────────────── */

export async function getAskBobChat(): Promise<ChatMessage[]> {
  if (!db) return read(mock.askBobChat)
  const [project, attention, next] = await Promise.all([getProject(), getAttention(), getNextEvent()])
  const messages: ChatMessage[] = [
    {
      from: 'bob',
      text: `Hej! I've got the whole ${project?.name ?? ''} build in my head — ask me anything.`,
    },
  ]
  if (attention.length > 0) {
    messages.push({
      from: 'bob',
      text: next ? `Things I'd nudge before ${next.day}:` : "Things I'd nudge:",
      list: attention.map((a) => ({ icon: a.icon, tone: a.tone, text: a.text })),
    })
  } else {
    messages.push({ from: 'bob', text: 'Nothing needs attention right now — the build is looking tidy.' })
  }
  return messages
}

export function getAskBobChips(): Promise<string[]> {
  if (!db) return read(mock.askBobChips)
  return Promise.resolve(["What's blocking us?", 'Who has signed up?', 'What still needs buying?', 'Draft an announcement'])
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
  const when = next ? next.day : 'the next build day'
  const parts = columns
    .map((c, i) => (counts[i] > 0 ? `${counts[i]} ${c.toLowerCase()}` : null))
    .filter(Boolean)
  return `${confirmed} confirmed for ${when}${parts.length > 0 ? ' · ' + parts.join(' · ') : ''}`
}
