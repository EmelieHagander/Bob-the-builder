import { checkedStairStudy, type StairDetails } from '../lib/stairStudy'
import { checkedBuildingPlan, type BuildingPlanDetails } from '../lib/buildingPlan'
import { checkedRoomLayout, type RoomLayoutDetails } from '../lib/roomLayout'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MeasurementTruth } from './projectFacts'
import type { StudWallRole } from '../lib/artifactGeometry'
import type { StorageBoxRecipe } from '../lib/storageBox'
import type { CadShell } from '../lib/cadShell'
import { parseDrawingSourceChanges, type DrawingSourceStatus } from './drawingSources'
import { parseCadViewerPin, parseCadWireframe, type CadViewerResult } from '../../supabase/functions/_shared/cad-wireframe.ts'
import { DataError, UserError, toDataError } from '../lib/userErrors'

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
  sourceStatus?: DrawingSourceStatus
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
  /** A saved construction source (parts, joints, materials) that drawings are rendered from, not a drawing itself. */
  isConstruction?: boolean
}

export interface CadDrawing { recipe: Record<string, any>; manifest: Record<string, any>; files: Record<string, string>; step_id: string | null; source_artifact_id: string | null; source_revision: number | null; source_changed?: boolean }

export interface ArtifactVersion extends ProjectArtifact {
  latestRevision?: number
  sourceStatus?: DrawingSourceStatus
  cad?: CadDrawing | null
  /** Present when this drawing combines saved CAD pieces. */
  shell?: CadShell | null
  measurements: ArtifactMeasurement[]
  generation: ArtifactGeneration | null
  stairStudy?: StairDetails | null
  multifloorPlan?: BuildingPlanDetails | null
  roomLayout?: RoomLayoutDetails | null
}

type Row = Record<string, any>

function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw toDataError(result.error)
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
    if (!client) throw new UserError('This demo does not save plans and drawings. Open a connected project.')
    return { db: client, guard }
  }

  function scoped<T extends Row>(rows: T[], projectId: string): T[] {
    if (rows.some(row => row.project_id !== projectId)) throw new DataError('project_mismatch', 'Drawing project mismatch.')
    return rows
  }

  async function generation(projectId: string, id: string, revision: number): Promise<ArtifactGeneration | null> {
    const { db, guard } = connection(projectId)
    const result = await db.from('artifact_generation_details').select('*')
      .eq('project_id', projectId).eq('artifact_id', id).eq('artifact_revision', revision).maybeSingle()
    if (result.error) throw toDataError(result.error)
    guard()
    if (!result.data) return null
    const row = result.data as Row
    if (row.project_id !== projectId) throw new DataError('project_mismatch', 'Generated drawing project mismatch.')
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
    const exact = <T>(table: string, query: (q: any) => PromiseLike<T>) =>
      query(db.from(table).select('*').eq('project_id', projectId).eq('artifact_id', id).eq('artifact_revision', revision))
    // Independent reads run together: one round trip instead of one per table.
    // Every read still goes through RLS; nothing here is cached.
    const [details, headRead, statusRead, refsRead, parametric, cadRead] = await Promise.all([
      db.from('artifact_revision_details').select('*').eq('project_id', projectId).eq('artifact_id', id).eq('revision', revision).single(),
      db.from('artifacts').select('current_revision').eq('project_id', projectId).eq('id', id).maybeSingle(),
      db.from('artifact_source_status').select('source_state,source_reasons')
        .eq('project_id', projectId).eq('artifact_id', id).eq('revision', revision).maybeSingle(),
      db.from('artifact_measurement_details').select('*')
        .eq('project_id', projectId).eq('artifact_id', id).eq('artifact_revision', revision)
        .order('measurement_id').limit(20),
      recipes(projectId, [{ id, revision }]),
      exact('artifact_cad_revisions', q => q.maybeSingle()),
    ])
    guard()
    const r = checked(details) as Row
    if (!r) throw new UserError('Drawing version unavailable. Reload to check access.')
    scoped([r], projectId)
    const head = checked(headRead) as { current_revision: number } | null
    let sourceStatus = checked(statusRead) as DrawingSourceStatus | null
    const refs = checked(refsRead) as Row[]
    const cad = checked(cadRead as { data: CadDrawing | null; error: { message: string } | null })
    // Second round: reads that depend on what the first round returned.
    const [delta, generated, layout, study, plan, parent, shellRead] = await Promise.all([
      sourceStatus && sourceStatus.source_state !== 'current'
        ? db.rpc('artifact_source_changes', { p_project: projectId, p_artifact: id, p_revision: revision }) : null,
      r.generator ? generation(projectId, id, revision) : null,
      r.has_room_layout ? exact('artifact_room_layout_details', q => q.maybeSingle()) : null,
      r.has_stair_study ? exact('artifact_stair_details', q => q.maybeSingle()) : null,
      r.has_multifloor_plan ? exact('artifact_multifloor_details', q => q.maybeSingle()) : null,
      cad?.source_artifact_id ? db.from('artifacts').select('current_revision').eq('project_id', projectId).eq('id', cad.source_artifact_id).maybeSingle() : null,
      // Until the shell migration is live the function is absent; ordinary drawings still open.
      cad ? null : db.rpc('read_cad_shell', { p_project: projectId, p_shell: id, p_revision: revision }),
    ])
    guard()
    if (sourceStatus && delta) {
      const result = parseDrawingSourceChanges(delta.data)
      sourceStatus = { ...sourceStatus, ...(delta.error || !result
        ? { changesUnavailable: true }
        : result) }
    }
    const layoutRow = layout && checked(layout as { data: Row | null; error: { message: string } | null })
    const roomLayout: RoomLayoutDetails | null = layoutRow ? checkedRoomLayout(layoutRow, projectId, id, revision) : null
    const studyRow = study && checked(study as { data: Row | null; error: { message: string } | null })
    const stairStudy: StairDetails | null = studyRow ? checkedStairStudy(studyRow, projectId, id, revision) : null
    const planRow = plan && checked(plan as { data: Row | null; error: { message: string } | null })
    const multifloorPlan: BuildingPlanDetails | null = planRow ? checkedBuildingPlan(planRow, projectId, id, revision) : null
    if (cad?.source_artifact_id) {
      const source = checked(parent!) as { current_revision: number } | null
      cad.source_changed = !source || source.current_revision !== cad.source_revision
    }
    const shell = !shellRead || shellRead.error?.code === 'PGRST202' ? null : checked(shellRead) as CadShell | null
    return {
      latestRevision: head?.current_revision,
      shell,
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
    async wireframe(projectId: string, id: string, revision: number, signal: AbortSignal, retry = false): Promise<CadViewerResult> {
      const { db, guard } = connection(projectId)
      const pin = parseCadViewerPin({ project_id: projectId, artifact_id: id, revision })
      if (!pin) throw new Error('Invalid drawing revision reference.')
      const { data, error } = await db.functions.invoke('cad-viewer', { body: { ...pin, retry }, signal })
      guard()
      if (signal.aborted) throw new UserError('The 3D view was closed or timed out.')
      if (error) throw new UserError('Could not load this saved 3D view. Check your connection and project access.')
      if (data?.status === 'pending') return { status: 'pending' }
      if (data?.status === 'failed' && typeof data.retry_allowed === 'boolean') return data
      const source = parseCadViewerPin(data?.source), geometry = parseCadWireframe(data?.geometry)
      if (data?.status !== 'ready' || !source || !geometry || source.project_id !== pin.project_id || source.artifact_id !== pin.artifact_id || source.revision !== pin.revision)
        throw new UserError('The 3D view did not match this saved drawing version.')
      return { status: 'ready', source, geometry }
    },
    async list(projectId: string, areaId = '', archived = false, offset = 0) {
      const { db, guard } = connection(projectId)
      let query = db.from('current_artifacts').select('*').eq('project_id', projectId).eq('archived', archived)
      if (areaId) query = query.eq('area_id', areaId)
      const rows = checked(await query.order('recorded_at', { ascending: false }).order('id').range(offset, offset + 24)) as Row[]
      guard()
      const page = scoped(rows.slice(0, 24), projectId)
      const filter = page.map(row => `and(artifact_id.eq.${row.id},revision.eq.${row.revision})`).join(',')
      // The three reads only need the listed versions, so they run together.
      const [parametric, stateRead, constructionRead] = await Promise.all([
        recipes(projectId, page.map(r => ({ id: r.id, revision: r.revision }))),
        filter ? db.from('artifact_source_status').select('artifact_id,revision,source_state,source_reasons')
          .eq('project_id', projectId).or(filter).limit(24) : null,
        // Exact listed versions that are construction sources, not rendered drawings.
        filter ? db.from('artifact_construction_revisions').select('artifact_id,artifact_revision')
          .eq('project_id', projectId).or(page.map(row => `and(artifact_id.eq.${row.id},artifact_revision.eq.${row.revision})`).join(',')).limit(24) : null,
      ])
      guard()
      const states = stateRead ? checked(stateRead) as Row[] : []
      const constructions = constructionRead ? checked(constructionRead) as Row[] : []
      return { items: page.map(r => ({ ...artifact({ ...r, parametric_recipe: parametric.find(p => p.artifact_id === r.id && p.artifact_revision === r.revision)?.recipe }),
        isConstruction: constructions.some(c => c.artifact_id === r.id && c.artifact_revision === r.revision),
        sourceStatus: states.find(state => state.artifact_id === r.id && state.revision === r.revision) as DrawingSourceStatus | undefined
          ?? { source_state: 'unavailable' as const, source_reasons: ['source_unavailable'] },
      })), hasMore: rows.length > 24 }
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
    /** Saved CAD recipes of the exact piece revisions a shell pins, for the browser-composed 3D view.
     * Reads only the recipe (no export files) and keeps the project scope; a missing row stays missing. */
    async shellPieceRecipes(projectId: string, pins: { id: string; revision: number }[]) {
      const { db, guard } = connection(projectId)
      const unique = [...new Map(pins.map(p => [`${p.id}:${p.revision}`, p])).values()]
      if (unique.length > 64 || unique.some(p => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.id)
        || !Number.isSafeInteger(p.revision) || p.revision < 1)) throw new Error('Invalid drawing revision reference.')
      const found = new Map<string, unknown>()
      for (let i = 0; i < unique.length; i += 16) {
        const chunk = unique.slice(i, i + 16)
        const filter = chunk.map(p => `and(artifact_id.eq.${p.id},artifact_revision.eq.${p.revision})`).join(',')
        const rows = checked(await db.from('artifact_cad_revisions').select('project_id,artifact_id,artifact_revision,recipe')
          .eq('project_id', projectId).or(filter)) as Row[]
        guard()
        if (rows.some(row => !chunk.some(p => p.id === row.artifact_id && p.revision === row.artifact_revision))) throw new Error('Drawing recipe revision mismatch.')
        for (const row of scoped(rows, projectId)) found.set(`${row.artifact_id}:${row.artifact_revision}`, row.recipe)
      }
      return found
    },
    /** The one shell write path, shared with Bob: place/add/remove/adopt a piece. */
    async shellCommand(projectId: string, action: 'place' | 'add' | 'remove' | 'adopt', id: string, expected: number, data: Record<string, unknown>) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('cad_shell_command', { p_project: projectId, p_action: action, p_shell: id, p_expected: expected, p_data: data })) as CadShell
      guard()
      return version(projectId, id, saved.revision)
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
