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

export interface Skill { name: string; level: SkillLevel }
export interface Person { id: string; name: string; initials: string; color: string; role: string; skills: Skill[]; diet: string }
export interface Project {
  id: string; slug: string; name: string; description: string; location: string; type: string; theme: ThemeName; startLabel: string
  startDate: string | null; endDate: string | null
}
export interface Account { id: string; name: string; ownerName: string; email: string }
export interface AccountNote { id: string; text: string; pinned: boolean; createdAt: string }
export interface Area {
  id: string; slug: string; name: string; description: string; icon: string; leadId: string | null
  assignedPct: number; materialsPct: number; donePct: number; taskSummary: string; crewIds: string[]; referenceImages: { label: string }[]
}
export interface Task { id: string; areaId: string; name: string; skill: SkillLevel; hours: string; status: TaskStatus; assigneeIds: string[]; materials: string }

export type MediaPurpose = 'current_state' | 'reference' | 'instruction' | 'proposal' | 'progress' | 'as_built'
export type MediaTarget = { kind: 'project' | 'area' | 'task' | 'step'; id: string }
export interface MediaAsset {
  id: string; projectId: string; bucket: string; path: string; title: string; originalName: string; purpose: MediaPurpose
  contentType: string; byteSize: number; width: number; height: number; state: 'pending' | 'ready' | 'deleting'; createdAt: string
  links: { id: string; kind: 'area' | 'task' | 'step'; targetId: string }[]
}
export interface MediaPage { items: MediaAsset[]; hasMore: boolean }
export interface TaskStep { id: string; taskId: string; title: string; instructions: string; position: number; isCheckpoint: boolean; required: boolean; completedAt: string | null; revision: number }
export interface TaskDetail { task: Task; instructions: string; updatedAt: string; steps: TaskStep[] }

export interface Material { id: string; name: string; qty: string; area: string; supplier: string; status: MaterialStatus; cost: string; category: string; categoryIcon: string }
export interface BuildEvent { id: string; slug: string; title: string; day: string; time: string; place: string; spots: string; status: EventStatus; attendeeIds: string[]; food: string }
export interface Meal { id: string; meal: string; time: string; icon: string; dish: string; notes: string }
export interface DietMatrixRow { personId: string; flags: boolean[] }
export interface Announcement { id: string; authorId: string; time: string; pinned: boolean; text: string; reacts: number; comments: number; createdAt: string | null }
export interface FoodItem { id: string; name: string; qty: string; note: string; checked: boolean }
export interface DietColumn { id: string; name: string }
export interface FoodGroup { category: string; icon: string; items: FoodItem[] }
export interface TodayTask { id: string; areaName: string; name: string; skill: SkillLevel; status: TaskStatus; assigneeIds: string[] }
export interface ChatMessage {
  evidence?: import('./provenance').AnswerEvidence
  from: 'bob' | 'user'; text: string
  list?: { icon: string; tone: 'clay' | 'honey' | 'leaf'; text: string }[]
  action?: string; note?: string; report?: string
}

export type { Measurement, ExistingComponent, ProjectFact, FactKind, FactFilter, FactPage } from './projectFacts'
export type { Solution, SolutionVersion, SolutionMeasurement, TargetDecision, SelectedTarget } from './solutions'
export type {
  ArtifactKind, ArtifactStatus, ArtifactMeasurement, ArtifactGenerator, ArtifactGeometryInput,
  ArtifactGeneration, ProjectArtifact, ArtifactVersion,
} from './artifacts'
export type {
  PhysicalTruth, PhysicalTargetKind, RelationshipKind, PhysicalNodeKind, PhysicalAction,
  PhysicalSite, PhysicalBuilding, PhysicalLevel, PhysicalSpace, SpaceProposal, PhysicalElement,
  ElementProposal, PhysicalRelationship, RelationshipProposal, SpaceMeasurementSnapshot,
  ProjectPhysicalScope, AreaPhysicalTarget, PhysicalHistoryVersion,
} from './buildingContext'
