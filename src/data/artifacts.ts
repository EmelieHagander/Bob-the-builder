import { checkedStairStudy, type StairDetails } from '../lib/stairStudy'
import { checkedBuildingPlan, type BuildingPlanDetails } from '../lib/buildingPlan'
import { checkedRoomLayout, type RoomLayoutDetails } from '../lib/roomLayout'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MeasurementTruth } from './projectFacts'
import type { StudWallRole } from '../lib/artifactGeometry'
import type { StorageBoxRecipe } from '../lib/storageBox'
import type { DrawingSourceStatus } from './drawingSources'

export type ArtifactKind = 'plan' | 'elevation' | 'section' | 'detail'
export type ArtifactStatus = 'concept' | 'measured' | 'build_ready'
export type ArtifactGenerator = 'stud_wall_opening_v1'
export type ArtifactEditAction = 'create' | 'revise' | 'archive' | 'restore' | 'generate' | 'regenerate' | 'generate_box' | 'regenerate_box'

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
  parametricRecipe?: StorageBoxRecipe | null
  hasStairStudy?: boolean
  hasMultifloorPlan?: boolean
  hasRoomLayout?: boolean
}

export interface CadDrawing { recipe: Record<string, any>; manifest: Record<string, any>; files: Record<string, string>; step_id: string | null; source_artifact_id: string | null; source_revision: number | null; source_changed?: boolean }

export interface ArtifactVersion extends ProjectArtifact {
  sourceStatus?: DrawingSourceStatus
  cad?: CadDrawing | null
  measurements: ArtifactMeasurement[]
  generation: ArtifactGeneration | null
  stairStudy?: StairDetails | null
  multifloorPlan?: BuildingPlanDetails | null
  roomLayout?: RoomLayoutDetails | null
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
    parametricRecipe: row.parametric_recipe ?? null,
    hasRoomLayout: row.has_room_layout === true,
    hasMultifloorPlan: row.has_multifloor_plan === true,
    hasStairStudy: row.has_stair_study === true,
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

  async function recipes(projectId: string, pairs: { id: string; revision: number }[]) {
    const { db, guard } = connection(projectId)
    if (!pairs.length) return [] as Row[]
    if (pairs.length > 24 || pairs.some(p => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.id)
      || !Number.isSafeInteger(p.revision) || p.revision < 1)) throw new Error('Invalid drawing revision reference.')
    // Read the exact versions returned by the preceding query, not whichever
    // recipe becomes current while a collaborator saves another revision.
    const filter = pairs.map(p => `and(artifact_id.eq.${p.id},artifact_revision.eq.${p.revision})`).join(',')
    const rows = checked(await db.from('artifact_parametric_recipes').select('*').eq('project_id', projectId).or(filter)) as Row[]
    guard()
    if (rows.some(row => !pairs.some(p => p.id === row.artifact_id && p.revision === row.artifact_revision))) {
      throw new Error('Drawing recipe revision mismatch.')
    }
    return scoped(rows, projectId)
  }

  async function version(projectId: string, id: string, revision: number): Promise<ArtifactVersion> {
    const { db, guard } = connection(projectId)
    const r = checked(await db.from('artifact_revision_details').select('*').eq('project_id', projectId)
      .eq('artifact_id', id).eq('revision', revision).single()) as Row
    guard()
    if (!r) throw new Error('Drawing version unavailable. Reload to check access.')
    scoped([r], projectId)
    const sourceStatus = checked(await db.from('artifact_source_status').select('source_state,source_reasons')
      .eq('project_id', projectId).eq('artifact_id', id).eq('revision', revision).maybeSingle()) as DrawingSourceStatus | null
    guard()
    const refs = checked(await db.from('artifact_measurement_details').select('*')
      .eq('project_id', projectId).eq('artifact_id', id).eq('artifact_revision', revision)
      .order('measurement_id').limit(20)) as Row[]
    guard()
    const generated = r.generator ? await generation(projectId, id, revision) : null
    const parametric = await recipes(projectId, [{ id, revision }])
    let roomLayout: RoomLayoutDetails | null = null
    if (r.has_room_layout) {
      const layout = checked(await db.from('artifact_room_layout_details').select('*').eq('project_id', projectId)
        .eq('artifact_id', id).eq('artifact_revision', revision).maybeSingle())
      guard()
      if (layout) roomLayout = checkedRoomLayout(layout, projectId, id, revision)
    }
    let stairStudy: StairDetails | null = null
    if (r.has_stair_study) {
      const study = checked(await db.from('artifact_stair_details').select('*').eq('project_id', projectId)
        .eq('artifact_id', id).eq('artifact_revision', revision).maybeSingle())
      guard()
      if (study) stairStudy = checkedStairStudy(study, projectId, id, revision)
    }
    let multifloorPlan: BuildingPlanDetails | null = null
    if (r.has_multifloor_plan) {
      const plan = checked(await db.from('artifact_multifloor_details').select('*').eq('project_id', projectId)
        .eq('artifact_id', id).eq('artifact_revision', revision).maybeSingle())
      guard()
      if (plan) multifloorPlan = checkedBuildingPlan(plan, projectId, id, revision)
    }
    const cad = checked(await db.from('artifact_cad_revisions').select('*').eq('project_id',projectId).eq('artifact_id',id).eq('artifact_revision',revision).maybeSingle()) as CadDrawing | null
    if(cad?.source_artifact_id){
      const parent=checked(await db.from('artifacts').select('current_revision').eq('project_id',projectId).eq('id',cad.source_artifact_id).maybeSingle())
      cad.source_changed=!parent||parent.current_revision!==cad.source_revision
    }
    guard()
    return {
      sourceStatus: sourceStatus ?? { source_state: 'unavailable', source_reasons: ['source_unavailable'] },
      cad,
      multifloorPlan,
      stairStudy,
      ...artifact({ ...r, parametric_recipe: parametric[0]?.recipe ?? null }),
      measurements: scoped(refs, projectId).map(measurement),
      generation: generated,
      roomLayout,
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
      const page = scoped(rows.slice(0, 24), projectId)
      const parametric = await recipes(projectId, page.map(r => ({ id: r.id, revision: r.revision })))
      guard()
      return { items: page.map(r => artifact({ ...r, parametric_recipe: parametric.find(p => p.artifact_id === r.id && p.artifact_revision === r.revision)?.recipe })), hasMore: rows.length > 24 }
    },
    async history(projectId: string, id: string, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('artifact_revision_details').select('*').eq('project_id', projectId).eq('artifact_id', id)
        .order('revision', { ascending: false }).range(offset, offset + 12)) as Row[]
      guard()
      const page = scoped(rows.slice(0, 12), projectId)
      const parametric = await recipes(projectId, page.map(r => ({ id, revision: r.revision })))
      guard()
      return { items: page.map(r => artifact({ ...r, parametric_recipe: parametric.find(p => p.artifact_revision === r.revision)?.recipe })), hasMore: rows.length > 12 }
    },
    async edit(projectId: string, action: ArtifactEditAction, id: string, expected: number, data: Record<string, unknown> = {}) {
      const { db, guard } = connection(projectId)
      const generated = action === 'generate' || action === 'regenerate'
      const box = action === 'generate_box' || action === 'regenerate_box'
      const saved = checked(await db.rpc(box ? 'artifact_box_command' : generated ? 'artifact_geometry_command' : 'artifact_command', {
        p_project: projectId,
        p_action: action === 'generate' || action === 'generate_box' ? 'create' : action === 'regenerate_box' ? 'regenerate' : action,
        p_artifact: id,
        p_expected: expected,
        p_data: data,
      })) as Row
      guard()
      return version(projectId, id, saved.revision)
    },
  }
}
