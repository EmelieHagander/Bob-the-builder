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
import { relativeTime } from '../lib/format'
import * as mock from './mockData'
import type {
  Account,
  AccountNote,
  Announcement,
  Area,
  BuildEvent,
  ChatMessage,
  DietColumn,
  DietMatrixRow,
  EventStatus,
  FoodGroup,
  Material,
  MaterialStatus,
  Meal,
  Person,
  Project,
  Skill,
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

/**
 * Accepts the full project URL ("https://xyz.supabase.co") or just the bare
 * project ref ("xyz") — a common slip when copying config around. Anything
 * unusable falls back to demo mode with a console warning instead of
 * crashing the whole app at startup.
 */
function resolveSupabaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  const url = /^[a-z0-9]{16,}$/.test(value) ? `https://${value}.supabase.co` : value
  try {
    new URL(url)
    return url
  } catch {
    console.warn(`bob: VITE_SUPABASE_URL is not a usable URL ("${value}") — running on demo data.`)
    return null
  }
}

const SUPABASE_URL = resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

function connect() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.info('bob: no database configured — running on the in-memory demo data.')
    return null
  }
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: 'bob' },
      // PKCE puts the magic-link token in the query string instead of the
      // URL hash, which would otherwise collide with the HashRouter.
      auth: { flowType: 'pkce' },
    })
    console.info(`bob: live database mode (${new URL(SUPABASE_URL).host}, schema bob)`)
    return client
  } catch (err) {
    console.warn('bob: could not create the database client — running on demo data.', err)
    return null
  }
}

const db = connect()

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
  id: string; category: string; icon: string
  food_items: { id: number; name: string; qty: string; note: string; checked: boolean; sort_order: number }[]
}
type AnnouncementRow = {
  id: string; author_id: string | null; time_label: string; pinned: boolean
  text: string; reacts: number; comments: number; created_at: string | null
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

/** URL-safe slug from a display name ("Växthuset" → "vaxthuset"). */
function slugify(name: string, fallback: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  )
}

/** Collision-safe text id with a readable prefix ("t_ab12cd34"). */
function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
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
  const slug = slugify(input.name, 'project')
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

export interface ProjectDetailsUpdate {
  name: string
  description: string
  location: string
  type: string
  theme: ThemeName
}

/** Edit a project's descriptive fields (the slug stays — links keep working). */
export async function updateProjectDetails(id: string, input: ProjectDetailsUpdate): Promise<void> {
  if (!db) {
    const project = mock.projects.find((p) => p.id === id)
    if (!project) throw new Error('database: no such project')
    Object.assign(project, input)
  } else {
    const res = await db
      .from('projects')
      .update({
        name: input.name,
        description: input.description,
        location: input.location,
        type: input.type,
        theme: input.theme,
      })
      .eq('id', id)
    if (res.error) throw new Error(`database: ${res.error.message}`)
  }
  // Theme and name show in the shell — nudge mounted screens to refetch.
  window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT))
  if (!db) await read(null)
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

export interface PersonUpdate {
  role: string
  diet: string
  skills: Skill[]
}

export async function updatePerson(id: string, input: PersonUpdate): Promise<void> {
  if (!db) {
    const person = mock.people.find((p) => p.id === id)
    if (!person) throw new Error('database: no such person')
    person.role = input.role
    person.diet = input.diet
    person.skills = input.skills.map((s) => ({ ...s }))
    await read(null)
    return
  }
  const res = await db.from('people').update({ role: input.role, diet: input.diet }).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
  const cleared = await db.from('person_skills').delete().eq('person_id', id)
  if (cleared.error) throw new Error(`database: ${cleared.error.message}`)
  if (input.skills.length > 0) {
    const added = await db
      .from('person_skills')
      .insert(input.skills.map((s) => ({ person_id: id, name: s.name, level: s.level })))
    if (added.error) throw new Error(`database: ${added.error.message}`)
  }
}

/** Remove someone from the crew. Their assignments and sign-ups go with them. */
export async function deletePerson(id: string): Promise<void> {
  if (!db) {
    const i = mock.people.findIndex((p) => p.id === id)
    if (i >= 0) mock.people.splice(i, 1)
    mock.tasks.forEach((t) => {
      t.assigneeIds = t.assigneeIds.filter((a) => a !== id)
    })
    mock.areas.forEach((a) => {
      a.crewIds = a.crewIds.filter((c) => c !== id)
      if (a.leadId === id) a.leadId = null
    })
    mock.events.forEach((e) => {
      e.attendeeIds = e.attendeeIds.filter((a) => a !== id)
    })
    const m = mock.dietMatrix.findIndex((r) => r.personId === id)
    if (m >= 0) mock.dietMatrix.splice(m, 1)
    await read(null)
    return
  }
  const res = await db.from('people').delete().eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
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
let joinInFlight: Promise<Person | null> | null = null

/** Who is using the app: the signed-in member, or null when signed out. */
export async function getCurrentUser(): Promise<Person | null> {
  if (!db) {
    // Demo mode: the first organiser plays the signed-in user.
    const people = await getPeople()
    return people.find((p) => p.role.toLowerCase().includes('organiser')) ?? people[0] ?? null
  }
  const client = db
  const { data } = await client.auth.getSession()
  if (!data.session) return null
  if (sessionPerson) return sessionPerson
  // Several components ask "who am I" at once right after sign-in — share a
  // single join_project call instead of racing parallel first-joins.
  joinInFlight ??= (async () => {
    const res = await client.rpc('join_project')
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
  })().finally(() => {
    joinInFlight = null
  })
  return joinInFlight
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

/** Is anyone signed in? Mock mode has no auth, so always "yes". */
export async function hasSession(): Promise<boolean> {
  if (!db) return true
  const { data } = await db.auth.getSession()
  return data.session !== null
}

/*
 * The shared GUEST account: one click on the sign-in screen, no email
 * needed. The credentials are public by design — the guest is just another
 * signed-in member named "Guest" (household posture; the account exists so
 * writes still go through `authenticated` policies and carry an identity).
 */
const GUEST_EMAIL = 'guest@bob.local'
const GUEST_PASSWORD = 'bob-guest-2026'

export async function signInAsGuest(): Promise<void> {
  if (!db) throw new Error('Running on demo data — sign-in needs the live database.')
  const { error } = await db.auth.signInWithPassword({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
  if (error) throw new Error(error.message)
}

/**
 * Register an invite: creates the person on the project's crew and records
 * their email server-side (bob.invite_person, security definer — the invite
 * email is never readable through the API). When they sign in with that
 * email they claim the person row.
 */
const AVATAR_COLORS = ['#7E9B52', '#5E87A6', '#B5675A', '#C98B2E', '#8A6FA8', '#B07F4F', '#5E9C68', '#C07A4E']

export async function invitePerson(projectId: string, name: string, email: string): Promise<void> {
  if (!db) {
    // Demo mode: no real emails, but the person still joins the crew so the
    // flow feels like the live one. (Content lives on the sample project.)
    const person: Person = {
      id: newId('i'),
      name: name.trim(),
      initials: name.trim().slice(0, 2).toUpperCase(),
      color: AVATAR_COLORS[mock.people.length % AVATAR_COLORS.length],
      role: 'Volunteer',
      diet: 'No restrictions',
      skills: [],
    }
    mock.people.push(person)
    mock.dietMatrix.push({ personId: person.id, flags: mock.dietColumns.map(() => false) })
    await read(null)
    return
  }
  const res = await db.rpc('invite_person', {
    p_project_id: projectId,
    p_name: name.trim(),
    p_email: email.trim(),
  })
  if (res.error) throw new Error(`database: ${res.error.message}`)
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

/**
 * Progress and the task summary are DERIVED from the actual tasks and
 * materials, never trusted from storage — the stored columns are legacy
 * seed content and go stale the moment anyone edits anything.
 */
function deriveAreaStats(area: Area, tasks: Task[], materials: Material[]): Area {
  const own = tasks.filter((t) => t.areaId === area.id)
  const mats = materials.filter((m) => m.area === area.name)
  const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100))
  const done = own.filter((t) => t.status === 'done').length
  const assigned = own.filter((t) => t.assigneeIds.length > 0).length
  const blocked = own.filter((t) => t.status === 'blocked').length
  const expertOpen = own.filter((t) => t.skill === 'expert' && t.status !== 'done' && t.assigneeIds.length === 0).length
  let summary = 'No tasks yet'
  if (own.length > 0) {
    const parts = [`${own.length} task${own.length === 1 ? '' : 's'}`, `${done} done`]
    if (blocked > 0) parts.push(`${blocked} blocked`)
    else if (expertOpen > 0) parts.push(`${expertOpen} need a skilled hand`)
    summary = parts.join(' · ')
  }
  return {
    ...area,
    assignedPct: pct(assigned, own.length),
    materialsPct: pct(mats.filter((m) => m.status === 'delivered').length, mats.length),
    donePct: pct(done, own.length),
    taskSummary: summary,
  }
}

export async function getAreas(): Promise<Area[]> {
  const [areas, tasks, materials] = await Promise.all([fetchAreas(), getTasks(), getMaterials()])
  return areas.map((a) => deriveAreaStats(a, tasks, materials))
}

async function fetchAreas(): Promise<Area[]> {
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

export interface NewArea {
  name: string
  description: string
  icon: string
  leadId?: string | null
}

/** Create a work area on the active project. Progress starts at zero. */
export async function createArea(input: NewArea): Promise<Area> {
  const existing = await getAreas()
  const baseSlug = slugify(input.name, 'area')
  // Keep slugs unique within the project — the router looks areas up by slug.
  const slug = existing.some((a) => a.slug === baseSlug) ? `${baseSlug}-${existing.length + 1}` : baseSlug
  const area: Area = {
    id: newId('a'),
    slug,
    name: input.name,
    description: input.description,
    icon: input.icon || 'hammer',
    leadId: input.leadId ?? null,
    assignedPct: 0,
    materialsPct: 0,
    donePct: 0,
    taskSummary: 'No tasks yet',
    crewIds: input.leadId ? [input.leadId] : [],
    referenceImages: [],
  }
  if (!db) {
    mock.areas.push(area)
    return read(area)
  }
  const pid = await activeProjectId()
  if (!pid) throw new Error('database: create a project before adding areas')
  const res = await db.from('areas').insert({
    id: area.id,
    project_id: pid,
    slug: area.slug,
    name: area.name,
    description: area.description,
    icon: area.icon,
    lead_id: area.leadId,
    task_summary: area.taskSummary,
    sort_order: existing.length + 1,
  })
  if (res.error) throw new Error(`database: ${res.error.message}`)
  if (area.leadId) {
    const crew = await db.from('area_crew').insert({ area_id: area.id, person_id: area.leadId })
    if (crew.error) throw new Error(`database: ${crew.error.message}`)
  }
  return area
}

export interface AreaUpdate {
  name: string
  description: string
  icon: string
  leadId: string | null
}

/** Edit an area. Materials are linked by area NAME, so a rename follows through. */
export async function updateArea(id: string, input: AreaUpdate): Promise<void> {
  if (!db) {
    const area = mock.areas.find((a) => a.id === id)
    if (!area) throw new Error('database: no such area')
    const oldName = area.name
    area.name = input.name
    area.description = input.description
    area.icon = input.icon
    area.leadId = input.leadId
    if (input.leadId && !area.crewIds.includes(input.leadId)) area.crewIds.push(input.leadId)
    if (oldName !== input.name) {
      mock.materials.forEach((m) => {
        if (m.area === oldName) m.area = input.name
      })
    }
    await read(null)
    return
  }
  const before = (await fetchAreas()).find((a) => a.id === id)
  if (!before) throw new Error('database: no such area')
  const res = await db
    .from('areas')
    .update({ name: input.name, description: input.description, icon: input.icon, lead_id: input.leadId })
    .eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
  if (input.leadId && !before.crewIds.includes(input.leadId)) {
    const crew = await db.from('area_crew').insert({ area_id: id, person_id: input.leadId })
    if (crew.error) throw new Error(`database: ${crew.error.message}`)
  }
  if (before.name !== input.name) {
    const pid = await activeProjectId()
    const mats = await db.from('materials').update({ area_label: input.name }).eq('project_id', pid).eq('area_label', before.name)
    if (mats.error) throw new Error(`database: ${mats.error.message}`)
  }
}

/** Delete an area and everything in it (tasks cascade; its materials go too). */
export async function deleteArea(id: string): Promise<void> {
  if (!db) {
    const i = mock.areas.findIndex((a) => a.id === id)
    if (i < 0) return
    const name = mock.areas[i].name
    mock.areas.splice(i, 1)
    for (let t = mock.tasks.length - 1; t >= 0; t--) if (mock.tasks[t].areaId === id) mock.tasks.splice(t, 1)
    for (let m = mock.materials.length - 1; m >= 0; m--) if (mock.materials[m].area === name) mock.materials.splice(m, 1)
    await read(null)
    return
  }
  const area = (await fetchAreas()).find((a) => a.id === id)
  const res = await db.from('areas').delete().eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
  if (area) {
    const pid = await activeProjectId()
    const mats = await db.from('materials').delete().eq('project_id', pid).eq('area_label', area.name)
    if (mats.error) throw new Error(`database: ${mats.error.message}`)
  }
}

/** Add a reference-image label to an area (v1 stores labels, not files). */
export async function addReferenceImage(areaId: string, label: string): Promise<void> {
  if (!db) {
    const area = mock.areas.find((a) => a.id === areaId)
    if (!area) throw new Error('database: no such area')
    area.referenceImages.push({ label })
    await read(null)
    return
  }
  const count = (await getAreas()).find((a) => a.id === areaId)?.referenceImages.length ?? 0
  const res = await db.from('area_reference_images').insert({ area_id: areaId, label, sort_order: count + 1 })
  if (res.error) throw new Error(`database: ${res.error.message}`)
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

export interface NewTask {
  areaId: string
  name: string
  skill: SkillLevel
  hours: string
}

export async function createTask(input: NewTask): Promise<Task> {
  const task: Task = {
    id: newId('t'),
    areaId: input.areaId,
    name: input.name,
    skill: input.skill,
    hours: input.hours,
    status: 'todo',
    assigneeIds: [],
    materials: '0 / 0',
  }
  if (!db) {
    mock.tasks.push(task)
    return read(task)
  }
  const res = await db.from('tasks').insert({
    id: task.id,
    area_id: task.areaId,
    name: task.name,
    skill: task.skill,
    hours: task.hours,
    status: task.status,
    materials: task.materials,
  })
  if (res.error) throw new Error(`database: ${res.error.message}`)
  return task
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<void> {
  if (!db) {
    const task = mock.tasks.find((t) => t.id === id)
    if (task) task.status = status
    await read(null)
    return
  }
  const res = await db.from('tasks').update({ status }).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

/** Replace a task's assignees with exactly this set of people. */
export async function setTaskAssignees(id: string, personIds: string[]): Promise<void> {
  if (!db) {
    const task = mock.tasks.find((t) => t.id === id)
    if (task) task.assigneeIds = [...personIds]
    await read(null)
    return
  }
  const cleared = await db.from('task_assignees').delete().eq('task_id', id)
  if (cleared.error) throw new Error(`database: ${cleared.error.message}`)
  if (personIds.length > 0) {
    const res = await db.from('task_assignees').insert(personIds.map((pid) => ({ task_id: id, person_id: pid })))
    if (res.error) throw new Error(`database: ${res.error.message}`)
  }
}

export interface TaskUpdate {
  name: string
  skill: SkillLevel
  hours: string
}

export async function updateTask(id: string, input: TaskUpdate): Promise<void> {
  if (!db) {
    const task = mock.tasks.find((t) => t.id === id)
    if (!task) throw new Error('database: no such task')
    Object.assign(task, input)
    await read(null)
    return
  }
  const res = await db.from('tasks').update({ name: input.name, skill: input.skill, hours: input.hours }).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export async function deleteTask(id: string): Promise<void> {
  if (!db) {
    const i = mock.tasks.findIndex((t) => t.id === id)
    if (i >= 0) mock.tasks.splice(i, 1)
    await read(null)
    return
  }
  const res = await db.from('tasks').delete().eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
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

/** Category → icon, matching the seed content; anything new gets 'package'. */
const CATEGORY_ICONS: Record<string, string> = {
  timber: 'tree',
  'fasteners & glue': 'nut',
  electrical: 'lightning',
  'paint & finish': 'paint-roller',
  'sauna & plumbing': 'drop',
  tools: 'wrench',
  food: 'basket',
}

export interface NewMaterial {
  name: string
  qty: string
  /** area display name (or "Several") */
  area: string
  supplier: string
  cost: string
  category: string
  status?: MaterialStatus
}

export async function createMaterial(input: NewMaterial): Promise<Material> {
  const existing = await getMaterials()
  const category = input.category.trim() || 'Other'
  const material: Material = {
    id: newId('m'),
    name: input.name,
    qty: input.qty,
    area: input.area || 'Several',
    supplier: input.supplier,
    status: input.status ?? 'needed',
    cost: input.cost,
    category,
    categoryIcon:
      existing.find((m) => m.category === category)?.categoryIcon ??
      CATEGORY_ICONS[category.toLowerCase()] ??
      'package',
  }
  if (!db) {
    mock.materials.push(material)
    return read(material)
  }
  const pid = await activeProjectId()
  if (!pid) throw new Error('database: create a project before adding materials')
  const res = await db.from('materials').insert({
    id: material.id,
    project_id: pid,
    name: material.name,
    qty: material.qty,
    area_label: material.area,
    supplier: material.supplier,
    status: material.status,
    cost: material.cost,
    category: material.category,
    category_icon: material.categoryIcon,
    sort_order: existing.length + 1,
  })
  if (res.error) throw new Error(`database: ${res.error.message}`)
  return material
}

export interface MaterialUpdate {
  name: string
  qty: string
  area: string
  supplier: string
  cost: string
  category: string
}

export async function updateMaterial(id: string, input: MaterialUpdate): Promise<void> {
  const category = input.category.trim() || 'Other'
  const icon =
    (await getMaterials()).find((m) => m.category === category && m.id !== id)?.categoryIcon ??
    CATEGORY_ICONS[category.toLowerCase()] ??
    'package'
  if (!db) {
    const material = mock.materials.find((m) => m.id === id)
    if (!material) throw new Error('database: no such material')
    Object.assign(material, { ...input, category, categoryIcon: icon })
    await read(null)
    return
  }
  const res = await db
    .from('materials')
    .update({
      name: input.name,
      qty: input.qty,
      area_label: input.area,
      supplier: input.supplier,
      cost: input.cost,
      category,
      category_icon: icon,
    })
    .eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export async function deleteMaterial(id: string): Promise<void> {
  if (!db) {
    const i = mock.materials.findIndex((m) => m.id === id)
    if (i >= 0) mock.materials.splice(i, 1)
    await read(null)
    return
  }
  const res = await db.from('materials').delete().eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export async function setMaterialStatus(id: string, status: MaterialStatus): Promise<void> {
  if (!db) {
    const material = mock.materials.find((m) => m.id === id)
    if (material) material.status = status
    await read(null)
    return
  }
  const res = await db.from('materials').update({ status }).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
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

export interface NewEvent {
  title: string
  day: string
  time: string
  place: string
  capacity: number
  food: string
}

export async function createEvent(input: NewEvent): Promise<BuildEvent> {
  const existing = await getEvents()
  const baseSlug = slugify(input.title, 'event')
  const slug = existing.some((e) => e.slug === baseSlug) ? `${baseSlug}-${existing.length + 1}` : baseSlug
  const event: BuildEvent = {
    id: newId('e'),
    slug,
    title: input.title,
    day: input.day,
    time: input.time,
    place: input.place,
    spots: `0 / ${input.capacity}`,
    status: 'open',
    attendeeIds: [],
    food: input.food,
  }
  if (!db) {
    mock.events.push(event)
    return read(event)
  }
  const pid = await activeProjectId()
  if (!pid) throw new Error('database: create a project before adding events')
  const res = await db.from('events').insert({
    id: event.id,
    project_id: pid,
    slug: event.slug,
    title: event.title,
    day: event.day,
    time: event.time,
    place: event.place,
    spots: event.spots,
    status: event.status,
    food: event.food,
    sort_order: existing.length + 1,
  })
  if (res.error) throw new Error(`database: ${res.error.message}`)
  return event
}

/** "taken / cap" helpers for the authored spots string. */
function spotsParts(spots: string): { taken: number; cap: number } {
  const [taken, cap] = spots.split('/').map((s) => parseInt(s, 10) || 0)
  return { taken, cap }
}

/** Is this person on the attendee list? The "You're going" state is per-user. */
export function isAttending(event: BuildEvent, personId: string | undefined): boolean {
  return Boolean(personId && event.attendeeIds.includes(personId))
}

export function isFull(event: BuildEvent): boolean {
  const { taken, cap } = spotsParts(event.spots)
  return cap > 0 && taken >= cap
}

/** Sign the current user up for a build day (idempotent). */
export async function joinEvent(id: string): Promise<void> {
  const me = await getCurrentUser()
  if (!me) throw new Error('Sign in first so the organiser knows who is coming.')
  const bump = (spots: string, delta: number): string => {
    const { taken, cap } = spotsParts(spots)
    return `${Math.max(0, taken + delta)} / ${cap}`
  }
  if (!db) {
    const event = mock.events.find((e) => e.id === id)
    if (!event) throw new Error('database: no such event')
    if (!event.attendeeIds.includes(me.id)) {
      if (isFull(event)) throw new Error('This build day is full — ask the organiser to add spots.')
      event.attendeeIds.push(me.id)
      event.spots = bump(event.spots, +1)
    }
    event.status = 'going'
    await read(null)
    return
  }
  const already = await db.from('event_attendees').select('person_id').eq('event_id', id).eq('person_id', me.id)
  if (already.error) throw new Error(`database: ${already.error.message}`)
  const event = (await getEvents()).find((e) => e.id === id)
  if (!event) throw new Error('database: no such event')
  const patch: { status: EventStatus; spots?: string } = { status: 'going' }
  if ((already.data ?? []).length === 0) {
    if (isFull(event)) throw new Error('This build day is full — ask the organiser to add spots.')
    const joined = await db.from('event_attendees').insert({ event_id: id, person_id: me.id })
    if (joined.error) throw new Error(`database: ${joined.error.message}`)
    patch.spots = bump(event.spots, +1)
  }
  const res = await db.from('events').update(patch).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

/** Take the current user off a build day's attendee list. */
export async function leaveEvent(id: string): Promise<void> {
  const me = await getCurrentUser()
  if (!me) return
  const bump = (spots: string): string => {
    const { taken, cap } = spotsParts(spots)
    return `${Math.max(0, taken - 1)} / ${cap}`
  }
  if (!db) {
    const event = mock.events.find((e) => e.id === id)
    if (!event) return
    const i = event.attendeeIds.indexOf(me.id)
    if (i >= 0) {
      event.attendeeIds.splice(i, 1)
      event.spots = bump(event.spots)
    }
    event.status = 'open'
    await read(null)
    return
  }
  const event = (await getEvents()).find((e) => e.id === id)
  if (!event || !event.attendeeIds.includes(me.id)) return
  const gone = await db.from('event_attendees').delete().eq('event_id', id).eq('person_id', me.id)
  if (gone.error) throw new Error(`database: ${gone.error.message}`)
  const res = await db.from('events').update({ status: 'open' as EventStatus, spots: bump(event.spots) }).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export interface EventUpdate {
  title: string
  day: string
  time: string
  place: string
  capacity: number
  food: string
}

export async function updateEvent(id: string, input: EventUpdate): Promise<void> {
  const patch = (spots: string) => ({
    title: input.title,
    day: input.day,
    time: input.time,
    place: input.place,
    spots: `${spotsParts(spots).taken} / ${Math.max(1, input.capacity)}`,
    food: input.food,
  })
  if (!db) {
    const event = mock.events.find((e) => e.id === id)
    if (!event) throw new Error('database: no such event')
    Object.assign(event, patch(event.spots))
    await read(null)
    return
  }
  const event = (await getEvents()).find((e) => e.id === id)
  if (!event) throw new Error('database: no such event')
  const res = await db.from('events').update(patch(event.spots)).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export async function deleteEvent(id: string): Promise<void> {
  if (!db) {
    const i = mock.events.findIndex((e) => e.id === id)
    if (i >= 0) mock.events.splice(i, 1)
    await read(null)
    return
  }
  const res = await db.from('events').delete().eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
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

export interface MealInput {
  meal: string
  time: string
  icon: string
  dish: string
  notes: string
}

export async function createMeal(input: MealInput): Promise<Meal> {
  const meal: Meal = { id: newId('meal'), ...input }
  if (!db) {
    mock.meals.push(meal)
    return read(meal)
  }
  const pid = await activeProjectId()
  if (!pid) throw new Error('database: create a project before planning meals')
  const res = await db.from('meals').insert({
    id: meal.id,
    project_id: pid,
    meal: input.meal,
    time: input.time,
    icon: input.icon,
    dish: input.dish,
    notes: input.notes,
    sort_order: (await getMeals()).length + 1,
  })
  if (res.error) throw new Error(`database: ${res.error.message}`)
  return meal
}

export async function updateMeal(id: string, input: MealInput): Promise<void> {
  if (!db) {
    const meal = mock.meals.find((m) => m.id === id)
    if (!meal) throw new Error('database: no such meal')
    Object.assign(meal, input)
    await read(null)
    return
  }
  const res = await db
    .from('meals')
    .update({ meal: input.meal, time: input.time, icon: input.icon, dish: input.dish, notes: input.notes })
    .eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export async function deleteMeal(id: string): Promise<void> {
  if (!db) {
    const i = mock.meals.findIndex((m) => m.id === id)
    if (i >= 0) mock.meals.splice(i, 1)
    await read(null)
    return
  }
  const res = await db.from('meals').delete().eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

/** Default matrix columns, created on first use for projects without any. */
const DEFAULT_DIET_COLUMNS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Nut allergy', 'Dairy-free']

export async function getDietColumns(): Promise<DietColumn[]> {
  if (!db) return read(mock.dietColumns.map((name, i) => ({ id: `dc_${i}`, name })))
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<{ id: string; name: string }[]>(
    await db.from('diet_columns').select('id, name').eq('project_id', pid).order('sort_order'),
  )
  return rows
}

/**
 * Flip one cell of the allergy matrix. Projects that never seeded columns get
 * the default set created on the first toggle.
 */
export async function setDietFlag(personId: string, columnId: string, on: boolean): Promise<void> {
  if (!db) {
    const index = Number(columnId.replace('dc_', ''))
    let row = mock.dietMatrix.find((r) => r.personId === personId)
    if (!row) {
      row = { personId, flags: mock.dietColumns.map(() => false) }
      mock.dietMatrix.push(row)
    }
    row.flags[index] = on
    await read(null)
    return
  }
  if (on) {
    const res = await db.from('diet_flags').insert({ person_id: personId, column_id: columnId })
    if (res.error && !/duplicate/i.test(res.error.message)) throw new Error(`database: ${res.error.message}`)
  } else {
    const res = await db.from('diet_flags').delete().eq('person_id', personId).eq('column_id', columnId)
    if (res.error) throw new Error(`database: ${res.error.message}`)
  }
}

/** Create the default diet columns for the active project (no-op if any exist). */
export async function ensureDietColumns(): Promise<DietColumn[]> {
  const existing = await getDietColumns()
  if (existing.length > 0 || !db) return existing
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = DEFAULT_DIET_COLUMNS.map((name, i) => ({
    id: newId('dc'),
    project_id: pid,
    name,
    sort_order: i + 1,
  }))
  const res = await db.from('diet_columns').insert(rows)
  if (res.error) throw new Error(`database: ${res.error.message}`)
  return rows.map((r) => ({ id: r.id, name: r.name }))
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
      .select('id, category, icon, food_items(id, name, qty, note, checked, sort_order)')
      .eq('project_id', pid)
      .order('sort_order'),
  )
  return rows.map((row) => ({
    category: row.category,
    icon: row.icon,
    items: [...row.food_items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ id: String(i.id), name: i.name, qty: i.qty, note: i.note, checked: i.checked })),
  }))
}

/** Tick / untick a food-shopping item — persists for the whole crew. */
export async function setFoodItemChecked(id: string, checked: boolean): Promise<void> {
  if (!db) {
    for (const group of mock.foodShopping) {
      const item = group.items.find((i) => i.id === id)
      if (item) item.checked = checked
    }
    await read(null)
    return
  }
  const res = await db.from('food_items').update({ checked }).eq('id', Number(id))
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

const FOOD_GROUP_ICONS: Record<string, string> = {
  'fresh & veg': 'carrot',
  'meat & dairy': 'cow',
  'bread & dry': 'bread',
  drinks: 'coffee',
}

export interface NewFoodItem {
  category: string
  name: string
  qty: string
  note: string
}

/** Add an item to the food shopping list, creating its category if needed. */
export async function createFoodItem(input: NewFoodItem): Promise<void> {
  const category = input.category.trim() || 'Other'
  if (!db) {
    let group = mock.foodShopping.find((g) => g.category === category)
    if (!group) {
      group = { category, icon: FOOD_GROUP_ICONS[category.toLowerCase()] ?? 'basket', items: [] }
      mock.foodShopping.push(group)
    }
    group.items.push({ id: newId('fi'), name: input.name, qty: input.qty, note: input.note, checked: false })
    await read(null)
    return
  }
  const pid = await activeProjectId()
  if (!pid) throw new Error('database: create a project before planning food')
  const groups = unwrap<{ id: string; category: string }[]>(
    await db.from('food_groups').select('id, category').eq('project_id', pid),
  )
  let groupId = groups.find((g) => g.category === category)?.id
  if (!groupId) {
    groupId = newId('fg')
    const made = await db.from('food_groups').insert({
      id: groupId,
      project_id: pid,
      category,
      icon: FOOD_GROUP_ICONS[category.toLowerCase()] ?? 'basket',
      sort_order: groups.length + 1,
    })
    if (made.error) throw new Error(`database: ${made.error.message}`)
  }
  const res = await db.from('food_items').insert({ group_id: groupId, name: input.name, qty: input.qty, note: input.note })
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

/* ─────────────────────────── COMMUNICATION ─────────────────────────── */

export async function getAnnouncements(): Promise<Announcement[]> {
  if (!db) {
    const posts = await readScoped(mock.announcements)
    // Real posts carry a timestamp; authored seed content keeps its label.
    return posts.map((a) => ({ ...a, time: a.createdAt ? relativeTime(a.createdAt) : a.time }))
  }
  const pid = await activeProjectId()
  if (!pid) return []
  const rows = unwrap<AnnouncementRow[]>(
    await db
      .from('announcements')
      .select('id, author_id, time_label, pinned, text, reacts, comments, created_at')
      .eq('project_id', pid)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id'),
  )
  return rows.map((row) => ({
    id: row.id,
    authorId: row.author_id ?? '',
    time: row.created_at ? relativeTime(row.created_at) : row.time_label,
    pinned: row.pinned,
    text: row.text,
    reacts: row.reacts,
    comments: row.comments,
    createdAt: row.created_at,
  }))
}

/** Post an announcement as the current user. */
export async function postAnnouncement(text: string): Promise<Announcement> {
  const me = await getCurrentUser()
  if (!me) throw new Error('Sign in first to post to the crew.')
  const announcement: Announcement = {
    id: newId('an'),
    authorId: me.id,
    time: 'just now',
    pinned: false,
    text,
    reacts: 0,
    comments: 0,
    createdAt: new Date().toISOString(),
  }
  if (!db) {
    mock.announcements.unshift(announcement)
    return read(announcement)
  }
  const pid = await activeProjectId()
  if (!pid) throw new Error('database: create a project before posting')
  const res = await db.from('announcements').insert({
    id: announcement.id,
    project_id: pid,
    author_id: me.id,
    time_label: announcement.time,
    pinned: false,
    text,
  })
  if (res.error) throw new Error(`database: ${res.error.message}`)
  return announcement
}

/** One more heart on a post. Household posture: no per-person bookkeeping. */
export async function reactToAnnouncement(id: string): Promise<void> {
  if (!db) {
    const post = mock.announcements.find((a) => a.id === id)
    if (post) post.reacts += 1
    await read(null)
    return
  }
  const current = unwrap<{ reacts: number }>(await db.from('announcements').select('reacts').eq('id', id).single())
  const res = await db.from('announcements').update({ reacts: current.reacts + 1 }).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export async function setAnnouncementPinned(id: string, pinned: boolean): Promise<void> {
  if (!db) {
    const post = mock.announcements.find((a) => a.id === id)
    if (post) post.pinned = pinned
    await read(null)
    return
  }
  const res = await db.from('announcements').update({ pinned }).eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
}

export async function deleteAnnouncement(id: string): Promise<void> {
  if (!db) {
    const i = mock.announcements.findIndex((a) => a.id === id)
    if (i >= 0) mock.announcements.splice(i, 1)
    await read(null)
    return
  }
  const res = await db.from('announcements').delete().eq('id', id)
  if (res.error) throw new Error(`database: ${res.error.message}`)
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

/* ─────────────────────────── ASK BOB × LAUNCHPAD ───────────────────────────
 * bob's real brain lives on Launchpad: the `ask-launchpad` edge function
 * (supabase/README.md) forwards a question to a team of AI builders running
 * on Launchpad's platform and bob relays the answer. The contract is async
 * and info-only — send a question, poll the task, maybe answer a follow-up
 * question mid-run. When the seam isn't configured (or in mock mode) these
 * return `unavailable`, and the drawer falls back to the scripted feed.
 * ──────────────────────────────────────────────────────────────────────── */

export interface BuildersQuestion {
  id: string
  text: string
  options?: string[]
}

export interface BuildersUpdate {
  status: 'working' | 'input-required' | 'completed' | 'failed'
  summary?: string
  report?: string
  question?: BuildersQuestion
  errorCode?: string
}

type BuildersSeamResponse = {
  ok: boolean
  error?: string
  taskId?: string
  status?: BuildersUpdate['status']
  summary?: string
  report?: string
  question?: { id?: string; text?: string; options?: string[] }
  errorCode?: string
}

async function callBuildersSeam(body: Record<string, unknown>): Promise<BuildersSeamResponse> {
  if (!db) return { ok: false, error: 'not_configured' }
  try {
    const { data, error } = await db.functions.invoke('ask-launchpad', { body })
    if (error || !data) return { ok: false, error: 'seam_unreachable' }
    return data as BuildersSeamResponse
  } catch {
    return { ok: false, error: 'seam_unreachable' }
  }
}

/**
 * Hand a question to the Launchpad builders. Resolves to a task id to poll,
 * or `{ unavailable }` when there is no live seam (mock mode, seam not yet
 * configured, signed out, or Launchpad unreachable) — callers fall back to
 * the scripted answer, never fake one.
 */
export async function askBuilders(message: string): Promise<{ taskId: string } | { unavailable: string }> {
  const res = await callBuildersSeam({ action: 'send', message })
  if (res.ok && res.taskId) return { taskId: res.taskId }
  return { unavailable: res.error ?? 'gateway_error' }
}

/** One poll of a running builders task. */
export async function getBuildersUpdate(taskId: string): Promise<BuildersUpdate> {
  const res = await callBuildersSeam({ action: 'status', taskId })
  if (!res.ok || !res.status) return { status: 'failed', errorCode: res.error ?? 'gateway_error' }
  return {
    status: res.status,
    summary: res.summary,
    report: res.report,
    question:
      res.question?.id && res.question?.text
        ? { id: res.question.id, text: res.question.text, options: res.question.options }
        : undefined,
    errorCode: res.errorCode,
  }
}

/** Answer a mid-run question from the builders; the task then resumes. */
export async function answerBuilders(taskId: string, questionId: string, answer: string): Promise<boolean> {
  const res = await callBuildersSeam({ action: 'reply', taskId, questionId, answer })
  return res.ok
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
    .map((c, i) => (counts[i] > 0 ? `${counts[i]} ${c.name.toLowerCase()}` : null))
    .filter(Boolean)
  return `${confirmed} confirmed for ${when}${parts.length > 0 ? ' · ' + parts.join(' · ') : ''}`
}
