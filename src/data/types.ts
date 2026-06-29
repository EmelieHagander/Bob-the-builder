/*
 * Domain model for bob.
 *
 * These are the shapes the rest of the app works with. They are deliberately
 * decoupled from any storage concern — the database layer (`database.ts`) is the
 * only thing that knows where the data actually comes from.
 */

export type ThemeName = 'forest' | 'dusk' | 'birch'

export type SkillLevel = 'novice' | 'intermediate' | 'expert'
export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked'
export type MaterialStatus = 'needed' | 'ordered' | 'delivered' | 'backorder'
export type EventStatus = 'going' | 'open'
export type ProjectRole = 'Organiser' | 'Volunteer' | 'Food manager'

export interface Skill {
  name: string
  level: SkillLevel
}

export interface Person {
  id: string
  name: string
  initials: string
  color: string
  role: string
  skills: Skill[]
  diet: string
}

export interface Project {
  id: string
  slug: string
  name: string
  description: string
  location: string
  type: string
  theme: ThemeName
  startLabel: string
}

export interface Area {
  id: string
  slug: string
  name: string
  description: string
  icon: string
  leadId: string | null
  /** 0-100 progress figures used across dashboard + area detail */
  assignedPct: number
  materialsPct: number
  donePct: number
  taskSummary: string
  /** ids of people in this area's crew */
  crewIds: string[]
  referenceImages: { label: string }[]
}

export interface Task {
  id: string
  areaId: string
  name: string
  skill: SkillLevel
  hours: string
  status: TaskStatus
  assigneeIds: string[]
  /** "x / y" materials-ready fraction, kept as authored in the mockup */
  materials: string
}

export interface Material {
  id: string
  name: string
  qty: string
  /** area name (or "Flera"/"Several") this material belongs to */
  area: string
  supplier: string
  status: MaterialStatus
  cost: string
  category: string
  categoryIcon: string
}

export interface BuildEvent {
  id: string
  slug: string
  title: string
  day: string
  time: string
  place: string
  spots: string
  status: EventStatus
  attendeeIds: string[]
  food: string
}

export interface Meal {
  id: string
  meal: string
  time: string
  icon: string
  dish: string
  notes: string
}

export interface DietMatrixRow {
  personId: string
  /** one flag per column in `getDietColumns()`, in order */
  flags: boolean[]
}

export interface Announcement {
  id: string
  authorId: string
  time: string
  pinned: boolean
  text: string
  reacts: number
  comments: number
}

export interface FoodItem {
  name: string
  qty: string
  note: string
  checked: boolean
}

export interface FoodGroup {
  category: string
  icon: string
  items: FoodItem[]
}

export interface TodayTask {
  id: string
  areaName: string
  name: string
  skill: SkillLevel
  status: TaskStatus
  assigneeIds: string[]
}

export interface ChatMessage {
  from: 'bob' | 'user'
  text: string
  list?: { icon: string; tone: 'clay' | 'honey' | 'leaf'; text: string }[]
  action?: string
  note?: string
}
