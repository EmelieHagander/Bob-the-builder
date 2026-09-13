import type { SupabaseClient } from '@supabase/supabase-js'
import type { MeasurementTruth } from './projectFacts'
import type { StudWallRole } from '../lib/artifactGeometry'

export type ArtifactKind = 'plan' | 'elevation' | 'section' | 'detail'
export type ArtifactStatus = 'concept' | 'measured' | 'build_ready'
export type ArtifactGenerator = 'stud_wall_opening_v1'

export interface ArtifactMeasurement {
  id: string
  revision: number
  subject: string
  value: string | null
  unit: string
  truth: MeasurementTruth
  source: string
  latestRevision: number
  archived: boolean
}

export interface ArtifactGeometryInput extends ArtifactMeasurement {
  role: StudWallRole
}

export interface ArtifactGeneration {
  generator: ArtifactGenerator
  generatorVersion: number
  buildingId: string
  buildingName: string
  spaceId: string
  spaceName: string
  spaceRevision: number
  currentSpaceRevision: number
  spaceHasProposal: boolean
  studSpacingMm: number
  inputs: ArtifactGeometryInput[]
}

export interface ProjectArtifact {
  id: string
  projectId: string
  areaId: string | null
  revision: number
  kind: ArtifactKind
  title: string
  description: string
  status: ArtifactStatus
  assumptions: string
  imageId: string | null
  imageTitle: string
  targetRevision: number
  solutionId: string
  solutionRevision: number
  solutionTitle: string
  archived: boolean
  reason: string
  actor: string
  recordedAt: string
  generator: ArtifactGenerator | null
  generatorVersion: number | null
}

export interface ArtifactVersion extends ProjectArtifact {
  measurements: ArtifactMeasurement[]
  generation: ArtifactGeneration | null
}

type Row = Record<string, any>

function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

function artifact(row: Row): ProjectArtifact {
  return {
    id: row.artifact_id ?? row.id,
    projectId: row.project_id,
    areaId: row.area_id ?? null,
    revision: row.revision,
    kind: row.kind,
    title: row.title,
    description: row.description,
    status: row.status,
    assumptions: row.assumptions,
    imageId: row.source_media_id,
    imageTitle: row.source_media_title,
    targetRevision: row.target_revision,
    solutionId: row.solution_id,
    solutionRevision: row.solution_revision,
    solutionTitle: row.solution_title,
    archived: row.archived,
    reason: row.change_note,
    actor: row.actor_label,
    recordedAt: row.recorded_at,
    generator: row.generator ?? null,
    generatorVersion: row.generator_version ?? null,
  }
}

function measurement(row: Row): ArtifactMeasurement {
  return {
    id: row.measurement_id,
    revision: row.measurement_revision,
    subject: row.subject,
    value: row.value === null ? null : String(row.value),
    unit: row.unit,
    truth: row.truth,
    source: row.source,
    latestRevision: row.latest_revision,
    archived: row.currently_archived,
  }
}

export function createArtifacts(
  client: SupabaseClient<any, any, any> | null,
  capture: (id: string) => () => void,
) {
  function connection(projectId: string) {
    const guard = capture(projectId)
    guard()
    if (!client) throw new Error('This demo does not save plans and drawings. Open a connected project.')
    return { db: client, guard }
  }

  function scoped<T extends Row>(rows: T[], projectId: string): T[] {
    if (rows.some(row => row.project_id !== projectId)) throw new Error('Drawing project mismatch.')
    return rows
  }

  async function generation(projectId: string, id: string, revision: number): Promise<ArtifactGeneration | null> {
    const { db, guard } = connection(projectId)
    const result = await db.from('artifact_generation_details').select('*')
      .eq('project_id', projectId).eq('artifact_id', id).eq('artifact_revision', revision).maybeSingle()
    if (result.error) throw new Error(result.error.message)
    guard()
    if (!result.data) return null
    const row = result.data as Row
    if (row.project_id !== projectId) throw new Error('Generated drawing project mismatch.')
    const inputs = checked(await db.from('artifact_geometry_input_details').select('*')
      .eq('project_id', projectId).eq('artifact_id', id).eq('artifact_revision', revision).order('role')) as Row[]
    guard()
    scoped(inputs, projectId)
    return {
      generator: row.generator,
      generatorVersion: row.generator_version,
      buildingId: row.building_id,
      buildingName: row.building_name,
      spaceId: row.space_id,
      spaceName: row.space_name,
      spaceRevision: row.space_revision,
      currentSpaceRevision: row.current_space_revision,
      spaceHasProposal: Boolean(row.space_has_proposal),
      studSpacingMm: Number(row.parameters?.stud_spacing_mm),
      inputs: inputs.map(item => ({ ...measurement(item), role: item.role as StudWallRole })),
    }
  }

  async function version(projectId: string, id: string, revision: number): Promise<ArtifactVersion> {
    const { db, guard } = connection(projectId)
    const r = checked(await db.from('artifact_revision_details').select('*').eq('project_id', projectId)
      .eq('artifact_id', id).eq('revision', revision).single()) as Row
    guard()
    if (!r) throw new Error('Drawing version unavailable. Reload to check access.')
    scoped([r], projectId)
    const refs = checked(await db.from('artifact_measurement_details').select('*')
      .eq('project_id', projectId).eq('artifact_id', id).eq('artifact_revision', revision)
      .order('measurement_id').limit(20)) as Row[]
    guard()
    const generated = r.generator ? await generation(projectId, id, revision) : null
    guard()
    return {
      ...artifact(r),
      measurements: scoped(refs, projectId).map(measurement),
      generation: generated,
    }
  }

  return {
    version,
    generation,
    async list(projectId: string, areaId = '', archived = false, offset = 0) {
      const { db, guard } = connection(projectId)
      let query = db.from('current_artifacts').select('*').eq('project_id', projectId).eq('archived', archived)
      if (areaId) query = query.eq('area_id', areaId)
      const rows = checked(await query.order('recorded_at', { ascending: false }).order('id').range(offset, offset + 24)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 24), projectId).map(artifact), hasMore: rows.length > 24 }
    },
    async history(projectId: string, id: string, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('artifact_revision_details').select('*').eq('project_id', projectId).eq('artifact_id', id)
        .order('revision', { ascending: false }).range(offset, offset + 12)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 12), projectId).map(artifact), hasMore: rows.length > 12 }
    },
    async edit(projectId: string, action: 'create' | 'revise' | 'archive' | 'restore', id: string, expected: number, data: Record<string, unknown> = {}) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('artifact_command', { p_project: projectId, p_action: action, p_artifact: id, p_expected: expected, p_data: data })) as Row
      guard()
      return version(projectId, id, saved.revision)
    },
    async generate(projectId: string, action: 'create' | 'regenerate', id: string, expected: number, data: Record<string, unknown>) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('artifact_geometry_command', {
        p_project: projectId, p_action: action, p_artifact: id, p_expected: expected, p_data: data,
      })) as Row
      guard()
      return version(projectId, id, saved.revision)
    },
  }
}
