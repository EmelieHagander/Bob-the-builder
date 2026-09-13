import type { SupabaseClient } from '@supabase/supabase-js'

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
export interface SpaceMeasurementSnapshot {
  id: string
  spaceId: string
  buildingId: string
  spaceRevision: number
  sourceProjectId: string
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
  return {
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
    async measurements(projectId: string, spaceId: string, revision: number): Promise<SpaceMeasurementSnapshot[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('space_measurement_details').select('*')
        .eq('space_id', spaceId).eq('space_revision', revision).order('subject')) as Row[]
      guard()
      return rows.map(row => ({
        id: row.id, spaceId: row.space_id, buildingId: row.building_id, spaceRevision: row.space_revision,
        sourceProjectId: row.source_project_id, measurementId: row.measurement_id,
        measurementRevision: row.measurement_revision, subject: row.subject,
        value: row.value === null ? null : String(row.value), unit: row.unit, truth: row.truth, source: row.source,
      }))
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
      const sessionResult = await db.auth.getSession()
      if (sessionResult.error) throw new Error(sessionResult.error.message)
      if (!sessionResult.data.session) return false
      const row = checked(await db.from('building_members').select('building_id').eq('building_id', buildingId)
        .eq('auth_user_id', sessionResult.data.session.user.id).maybeSingle()) as Row | null
      guard(); return !!row
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
}
