import type { SupabaseClient } from '@supabase/supabase-js'
import { wholeBuildingLinks } from '../lib/physicalScope'
import {
  chunks, currentRoomMeasurements, measuredRooms, roomRevisionFilter,
  type MeasuredRoom, type RoomMeasurementMap,
} from '../lib/roomMeasurements'
import { roomDimensionsByRoom, type RoomDimension, type RoomDimensionMap } from '../lib/roomDimensions'
import { classification, type MeasurementClassification } from './projectFacts'
import { toDataError } from '../lib/userErrors'

/** Rooms per measurement read keeps the exact-revision filter a short URL. */
const MEASUREMENT_ROOMS_PER_READ = 40
/** Below PostgREST's default row cap, so a full page always means "read on". */
const MEASUREMENT_PAGE = 500

export type PhysicalTruth = 'measured' | 'provided_spec' | 'estimated' | 'ai_assessment' | 'unknown'
export type PhysicalTargetKind = 'site' | 'building' | 'space' | 'element'
export type RelationshipKind = 'adjacent_to' | 'shares_boundary_with' | 'connects_to' | 'above' | 'below' | 'attached_to'
export type PhysicalNodeKind = 'level' | 'space' | 'element' | 'relationship'
export type PhysicalAction = 'create' | 'revise' | 'archive' | 'restore' | 'propose' | 'accept'

type Audit = {
  reason: string
  actor: string
  recordedAt: string
}
export interface PhysicalSite extends Audit {
  id: string
  revision: number
  name: string
  notes: string
  archived: boolean
}
export interface PhysicalBuilding extends Audit {
  id: string
  siteId: string | null
  revision: number
  name: string
  notes: string
  archived: boolean
}
export interface PhysicalLevel extends Audit {
  id: string
  buildingId: string
  revision: number
  name: string
  position: number
  notes: string
  archived: boolean
}
export interface PhysicalSpace extends Audit {
  id: string
  buildingId: string
  revision: number
  projectId: string | null
  sourceProjectId: string | null
  levelId: string | null
  name: string
  kind: string
  notes: string
  truth: PhysicalTruth
  source: string
  archived: boolean
  latestRevision: number
  hasProposal: boolean
}
export interface SpaceProposal extends Omit<PhysicalSpace, 'latestRevision' | 'hasProposal'> {
  acceptedRevision: number | null
}
export interface PhysicalElement extends Audit {
  id: string
  buildingId: string
  revision: number
  projectId: string | null
  sourceProjectId: string | null
  spaceId: string | null
  kind: string
  name: string
  description: string
  truth: PhysicalTruth
  source: string
  archived: boolean
  latestRevision: number
  hasProposal: boolean
}
export interface ElementProposal extends Omit<PhysicalElement, 'latestRevision' | 'hasProposal'> {
  acceptedRevision: number | null
}
export interface PhysicalRelationship extends Audit {
  id: string
  buildingId: string
  subjectSpaceId: string
  objectSpaceId: string
  revision: number
  projectId: string | null
  sourceProjectId: string | null
  relation: RelationshipKind
  truth: PhysicalTruth
  source: string
  notes: string
  archived: boolean
  latestRevision: number
  hasProposal: boolean
}
export interface RelationshipProposal extends Omit<PhysicalRelationship, 'latestRevision' | 'hasProposal'> {
  acceptedRevision: number | null
}
export interface SpaceMeasurementSnapshot extends MeasurementClassification {
  id: string
  spaceId: string
  buildingId: string
  spaceRevision: number
  sourceProjectId: string | null
  measurementId: string
  measurementRevision: number
  subject: string
  value: string | null
  unit: string
  truth: PhysicalTruth
  source: string
}
export interface ProjectPhysicalScope {
  id: string
  projectId: string
  targetKind: PhysicalTargetKind
  siteId: string | null
  buildingId: string | null
  spaceId: string | null
  elementId: string | null
}
export interface AreaPhysicalTarget {
  id: string
  projectId: string
  areaId: string
  targetKind: Exclude<PhysicalTargetKind, 'site'>
  buildingId: string
  spaceId: string | null
  elementId: string | null
}
/** What an Area can map to: rooms of Buildings the Project targets as a whole. */
export interface ProjectRoomScope {
  scopes: ProjectPhysicalScope[]
  /** Buildings the Project targets as a whole (own link or Site link). */
  buildings: PhysicalBuilding[]
  /** Every readable room of those Buildings, archived rooms included for names. */
  rooms: PhysicalSpace[]
  areaTargets: AreaPhysicalTarget[]
}
export interface PhysicalHistoryVersion {
  id: string
  buildingId: string
  revision: number
  projectId: string | null
  state: 'accepted' | 'proposed'
  archived: boolean
  reason: string
  actor: string
  recordedAt: string
  [key: string]: unknown
}

type Row = Record<string, any>
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}
function audit(row: Row): Audit {
  return { reason: row.change_note, actor: row.actor_label, recordedAt: row.recorded_at }
}
function site(row: Row): PhysicalSite {
  return { id: row.id, revision: row.revision, name: row.name, notes: row.notes, archived: row.archived, ...audit(row) }
}
function building(row: Row): PhysicalBuilding {
  return { id: row.id, siteId: row.site_id ?? null, revision: row.revision, name: row.name, notes: row.notes, archived: row.archived, ...audit(row) }
}
function level(row: Row): PhysicalLevel {
  return { id: row.id, buildingId: row.building_id, revision: row.revision, name: row.name, position: row.position, notes: row.notes, archived: row.archived, ...audit(row) }
}
function space(row: Row): PhysicalSpace {
  return {
    id: row.id, buildingId: row.building_id, revision: row.revision, projectId: row.project_id ?? null,
    sourceProjectId: row.source_project_id ?? null,
    levelId: row.level_id ?? null, name: row.name, kind: row.kind, notes: row.notes, truth: row.truth,
    source: row.source, archived: row.archived, latestRevision: row.latest_revision ?? row.revision,
    hasProposal: !!row.has_proposal, ...audit(row),
  }
}
function spaceProposal(row: Row): SpaceProposal {
  const current = space(row)
  const { latestRevision: _latest, hasProposal: _proposal, ...rest } = current
  return { ...rest, acceptedRevision: row.accepted_revision ?? null }
}
function element(row: Row): PhysicalElement {
  return {
    id: row.id, buildingId: row.building_id, revision: row.revision, projectId: row.project_id ?? null,
    sourceProjectId: row.source_project_id ?? null,
    spaceId: row.space_id ?? null, kind: row.kind, name: row.name, description: row.description,
    truth: row.truth, source: row.source, archived: row.archived,
    latestRevision: row.latest_revision ?? row.revision, hasProposal: !!row.has_proposal, ...audit(row),
  }
}
function elementProposal(row: Row): ElementProposal {
  const current = element(row)
  const { latestRevision: _latest, hasProposal: _proposal, ...rest } = current
  return { ...rest, acceptedRevision: row.accepted_revision ?? null }
}
function relationship(row: Row): PhysicalRelationship {
  return {
    id: row.id, buildingId: row.building_id, subjectSpaceId: row.subject_space_id, objectSpaceId: row.object_space_id,
    revision: row.revision, projectId: row.project_id ?? null, sourceProjectId: row.source_project_id ?? null,
    relation: row.relation, truth: row.truth,
    source: row.source, notes: row.notes, archived: row.archived,
    latestRevision: row.latest_revision ?? row.revision, hasProposal: !!row.has_proposal, ...audit(row),
  }
}
function relationshipProposal(row: Row): RelationshipProposal {
  const current = relationship(row)
  const { latestRevision: _latest, hasProposal: _proposal, ...rest } = current
  return { ...rest, acceptedRevision: row.accepted_revision ?? null }
}

export function createBuildingContext(
  client: SupabaseClient<any, any, any> | null,
  capture: (projectId: string) => () => void,
) {
  function connection(projectId: string) {
    const guard = capture(projectId)
    guard()
    if (!client) throw new Error('This demo does not save building context. Open a connected project.')
    return { db: client, guard }
  }
  function scoped<T extends Row>(rows: T[], projectId: string): T[] {
    if (rows.some(row => row.project_id && row.project_id !== projectId)) throw new Error('Physical project context mismatch.')
    return rows
  }
  const api = {
    async sites(projectId: string): Promise<PhysicalSite[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_sites').select('*').eq('archived', false).order('name')) as Row[]
      guard(); return rows.map(site)
    },
    async buildings(projectId: string): Promise<PhysicalBuilding[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_buildings').select('*').eq('archived', false).order('name')) as Row[]
      guard(); return rows.map(building)
    },
    async projectBuildings(projectId: string): Promise<PhysicalBuilding[]> {
      if (!projectId) return []
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('project_buildings').select('*').eq('project_id', projectId).eq('archived', false).order('name')) as Row[]
      guard(); return scoped(rows, projectId).map(building)
    },
    async levels(projectId: string, buildingId: string): Promise<PhysicalLevel[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_levels').select('*').eq('building_id', buildingId).eq('archived', false).order('position').order('name')) as Row[]
      guard(); return rows.map(level)
    },
    async spaces(projectId: string, buildingId: string): Promise<PhysicalSpace[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_spaces').select('*').eq('building_id', buildingId).order('name')) as Row[]
      guard(); return rows.map(space)
    },
    async projectSpaces(projectId: string): Promise<PhysicalSpace[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('project_spaces').select('*').eq('project_id', projectId).order('name')) as Row[]
      guard(); return scoped(rows, projectId).map(space)
    },
    async elements(projectId: string, buildingId: string): Promise<PhysicalElement[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_elements').select('*').eq('building_id', buildingId).order('name')) as Row[]
      guard(); return rows.map(element)
    },
    async relationships(projectId: string, buildingId: string): Promise<PhysicalRelationship[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_relationships').select('*').eq('building_id', buildingId).order('recorded_at')) as Row[]
      guard(); return rows.map(relationship)
    },
    async proposals(projectId: string, buildingId: string) {
      const { db, guard } = connection(projectId)
      const [spaces, elements, relations] = await Promise.all([
        db.from('latest_space_proposals').select('*').eq('building_id', buildingId).eq('project_id', projectId).order('recorded_at'),
        db.from('latest_element_proposals').select('*').eq('building_id', buildingId).eq('project_id', projectId).order('recorded_at'),
        db.from('latest_relationship_proposals').select('*').eq('building_id', buildingId).eq('project_id', projectId).order('recorded_at'),
      ])
      guard()
      return {
        spaces: scoped(checked(spaces) as Row[], projectId).map(spaceProposal),
        elements: scoped(checked(elements) as Row[], projectId).map(elementProposal),
        relationships: scoped(checked(relations) as Row[], projectId).map(relationshipProposal),
      }
    },
    /**
     * Measurement snapshots of exactly the room revisions given (the accepted
     * revisions a screen shows), keyed by `measurementKey`. One read covers a
     * page of rooms; every page of rows is followed so none is silently dropped.
     */
    async measurements(projectId: string, rooms: MeasuredRoom[]): Promise<RoomMeasurementMap> {
      const { db, guard } = connection(projectId)
      const rows: Row[] = []
      for (const batch of chunks(measuredRooms(rooms), MEASUREMENT_ROOMS_PER_READ)) {
        for (let from = 0; ; from += MEASUREMENT_PAGE) {
          const page = checked(await db.from('space_measurement_details').select('*').or(roomRevisionFilter(batch))
            .order('space_id').order('subject').order('id').range(from, from + MEASUREMENT_PAGE - 1)) as Row[]
          guard()
          rows.push(...page)
          if (page.length < MEASUREMENT_PAGE) break
        }
      }
      return currentRoomMeasurements(rooms, rows.map(row => ({
        id: row.id, spaceId: row.space_id, buildingId: row.building_id, spaceRevision: row.space_revision,
        sourceProjectId: row.source_project_id ?? null, measurementId: row.measurement_id,
        measurementRevision: row.measurement_revision, subject: row.subject,
        value: row.value === null || row.value === undefined ? null : String(row.value), unit: row.unit ?? '',
        truth: row.truth, source: row.source ?? '', ...classification(row),
      })))
    },
    /**
     * Length, width, ceiling height and other typed dimensions of exactly the
     * room revisions given, from `project_room_dimensions` (one read per page of
     * rooms). Rooms outside this project's scope have no entry.
     */
    async dimensions(projectId: string, rooms: MeasuredRoom[]): Promise<RoomDimensionMap> {
      const { db, guard } = connection(projectId)
      const rows: Row[] = []
      for (const batch of chunks(measuredRooms(rooms), MEASUREMENT_ROOMS_PER_READ)) {
        for (let from = 0; ; from += MEASUREMENT_PAGE) {
          const result = await db.from('project_room_dimensions').select('*').eq('project_id', projectId).or(roomRevisionFilter(batch))
            .order('space_id').order('property').order('side', { nullsFirst: true }).order('reference', { nullsFirst: true })
            .range(from, from + MEASUREMENT_PAGE - 1)
          if (result.error) throw toDataError(result.error)
          guard()
          const page = (result.data ?? []) as Row[]
          rows.push(...scoped(page, projectId))
          if (page.length < MEASUREMENT_PAGE) break
        }
      }
      return roomDimensionsByRoom(rooms, rows.map((row): RoomDimension => ({
        spaceId: row.space_id, spaceRevision: row.space_revision, property: row.property, side: row.side ?? null,
        reference: row.reference ?? null, status: row.status, truth: row.truth ?? null, millimetres: row.millimetres ?? null,
        measurements: (Array.isArray(row.measurements) ? row.measurements : []).map((item: Row) => ({
          snapshotId: item.snapshot_id, measurementId: item.measurement_id, measurementRevision: item.measurement_revision,
          subject: item.subject, value: item.value ?? null, unit: item.unit ?? '', millimetres: item.millimetres ?? null,
          truth: item.truth, source: item.source ?? '',
        })),
      })))
    },
    async history(projectId: string, kind: Exclude<PhysicalNodeKind, 'level'>, id: string): Promise<PhysicalHistoryVersion[]> {
      const { db, guard } = connection(projectId)
      const table = kind === 'space' ? 'space_revisions' : kind === 'element' ? 'element_revisions' : 'relationship_revisions'
      const key = kind === 'space' ? 'space_id' : kind === 'element' ? 'element_id' : 'relationship_id'
      const rows = checked(await db.from(table).select('*').eq(key, id).order('revision', { ascending: false }).limit(50)) as Row[]
      guard()
      return rows.map(row => ({ ...row, id: row[key], buildingId: row.building_id, revision: row.revision,
        projectId: row.project_id ?? null, state: row.state, archived: row.archived,
        reason: row.change_note, actor: row.actor_label, recordedAt: row.recorded_at })) as PhysicalHistoryVersion[]
    },
    async scopes(projectId: string): Promise<ProjectPhysicalScope[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('project_physical_scope').select('*').eq('project_id', projectId).order('created_at')) as Row[]
      guard(); return scoped(rows, projectId).map(row => ({ id: row.id, projectId: row.project_id, targetKind: row.target_kind,
        siteId: row.site_id ?? null, buildingId: row.building_id ?? null, spaceId: row.space_id ?? null, elementId: row.element_id ?? null }))
    },
    async areaTargets(projectId: string): Promise<AreaPhysicalTarget[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('area_physical_targets').select('*').eq('project_id', projectId).order('created_at')) as Row[]
      guard(); return scoped(rows, projectId).map(row => ({ id: row.id, projectId: row.project_id, areaId: row.area_id,
        targetKind: row.target_kind, buildingId: row.building_id, spaceId: row.space_id ?? null, elementId: row.element_id ?? null }))
    },
    async canDirectEdit(projectId: string, buildingId: string): Promise<boolean> {
      const { db, guard } = connection(projectId)
      const result = checked(await db.rpc('can_edit_building', { p_building: buildingId })) as boolean
      guard(); return result === true
    },
    async editSite(projectId: string, action: 'create' | 'revise' | 'archive' | 'restore', id: string, expected: number, data: Record<string, unknown>) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('physical_site_command', { p_action: action, p_site: id, p_expected: expected, p_data: data })) as Row
      guard(); return saved
    },
    async editBuilding(projectId: string, action: 'create' | 'revise' | 'archive' | 'restore', id: string, expected: number, data: Record<string, unknown>) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('physical_building_command', { p_action: action, p_building: id, p_expected: expected, p_data: data })) as Row
      guard(); return saved
    },
    async editNode(projectId: string, buildingId: string, kind: PhysicalNodeKind, action: PhysicalAction, id: string, expected: number, data: Record<string, unknown>) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('physical_node_command', {
        p_building: buildingId, p_kind: kind, p_action: action, p_record: id, p_expected: expected, p_data: data,
      })) as Row
      guard(); return saved
    },
    async editScope(projectId: string, kind: 'project' | 'area', action: 'link' | 'unlink', id: string, data: Record<string, unknown>) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('physical_scope_command', { p_project: projectId, p_kind: kind, p_action: action, p_record: id, p_data: data })) as Row
      guard(); return saved
    },
  }
  return {
    ...api,
    /** Buildings the caller may link to a Project: linking needs Building edit rights. */
    async editableBuildings(projectId: string): Promise<PhysicalBuilding[]> {
      const all = await api.buildings(projectId)
      const editable = await Promise.all(all.map(item => api.canDirectEdit(projectId, item.id)))
      return all.filter((_, index) => editable[index])
    },
    /**
     * Link a Project the caller has just created. Its id is the explicit context;
     * the active-Project selection is unchanged until the caller opens it.
     */
    async linkCreatedProject(projectId: string, scopeId: string, buildingId: string) {
      if (!projectId || !buildingId) throw new Error('Choose a project and a building first.')
      const { db, guard } = connection('')
      const saved = checked(await db.rpc('physical_scope_command', {
        p_project: projectId, p_kind: 'project', p_action: 'link', p_record: scopeId,
        p_data: { target_kind: 'building', building_id: buildingId },
      })) as Row
      guard(); return saved
    },
    /** Rooms an Area can map to, plus the Project's current scope and Area mappings. */
    async projectRoomScope(projectId: string): Promise<ProjectRoomScope> {
      const [scopes, linked, rooms, areaTargets] = await Promise.all([
        api.scopes(projectId), api.projectBuildings(projectId), api.projectSpaces(projectId), api.areaTargets(projectId),
      ])
      const buildings = linked.filter(item => wholeBuildingLinks(scopes, item).length > 0)
      const ids = new Set(buildings.map(item => item.id))
      return { scopes, buildings, rooms: rooms.filter(room => ids.has(room.buildingId)), areaTargets }
    },
  }
}
