import { parseStairInspection } from './project-stair.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { stairSummary, withDerivedStair } from '../../../src/lib/stairStudy.ts'
import { buildingPlanGeometry, checkedBuildingPlan, withDerivedBuildingPlan } from '../../../src/lib/buildingPlan.ts'
import { parseProjection } from './project-building-plan.ts'
import { withDerivedRoomLayout } from '../../../src/lib/roomLayout.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'
import { storageBoxGeometry, BOX_LIMITS } from '../../../src/lib/storageBox.ts'

export const DATASETS = ['project', 'areas', 'tasks', 'materials', 'crew', 'events', 'announcements', 'measurements', 'components', 'solutions', 'target', 'artifacts', 'requirements', 'physical_spaces', 'physical_elements', 'physical_buildings', 'physical_levels', 'physical_relationships', 'physical_proposals', 'physical_space_measurements', 'plan'] as const
export const LIMITS = { lookups: 3, rows: 25, joinedRows: 25, bytes: 32 * 1024, queryChars: 200, timeoutMs: 10_000 } as const
export interface LookupInput {
  dataset: typeof DATASETS[number]
  query: string | null
  status: string | null
  area_id: string | null
  record_id: string | null
  after_id?: string | null
}
type Row = Record<string, unknown> & { id: string; updated_at?: string | null }
export interface LookupPayload { records: Row[]; related: Row[]; truncated: boolean; next_cursor?: string | null }
export interface LookupResult {
  status: 'ok' | 'empty' | 'denied' | 'invalid' | 'unavailable' | 'budget_exhausted' | 'record_too_large'
  projectId: string
  dataset?: LookupInput['dataset']
  retrievedAt: string
  records: Row[]
  related: Row[]
  truncated: boolean
  next_cursor?: string | null
  /** True even for a complete filtered page: this is not a whole-project census. */
  partial: boolean
  truth: 'unknown'
}
export type LookupTransport = (projectId: string, input: LookupInput, signal: AbortSignal) =>
  PromiseLike<{ data: unknown; error: { code?: string } | null }>

export function parseLookup(value: unknown): LookupInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['dataset', 'query', 'status', 'area_id', 'record_id', 'after_id'].includes(k))) return null
  if (!DATASETS.includes(v.dataset as LookupInput['dataset'])) return null
  for (const key of ['query', 'status', 'area_id', 'record_id']) {
    if (v[key] !== null && (typeof v[key] !== 'string' || (v[key] as string).length > LIMITS.queryChars)) return null
  }
  if (v.after_id !== undefined && v.after_id !== null && (typeof v.after_id !== 'string' || v.after_id.length > LIMITS.queryChars)) return null
  if (v.area_id !== null && !['tasks', 'measurements', 'components', 'solutions', 'target', 'artifacts', 'requirements'].includes(String(v.dataset))) return null
  const statuses: Record<string, string[]> = {
    tasks: ['todo', 'doing', 'done', 'blocked'],
    materials: ['needed', 'ordered', 'delivered', 'backorder'], events: ['going', 'open'],
  }
  if (v.status !== null && !statuses[String(v.dataset)]?.includes(v.status as string)) return null
  return v as unknown as LookupInput
}

export const SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    // The canonical shared service uses non-strict provider tools. parseLookup
    // independently enforces this exact argument shape before database access.
    name: 'search_project_data',
    description: 'inspect authorised project records relevant to the question.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        dataset: { type: 'string', enum: [...DATASETS], description: 'physical_buildings/levels/spaces/elements/relationships and physical_space_measurements expose only current context scoped to this project; plan exposes the approved living Project Plan or an exact proposal revision; physical_proposals is separate and never accepted reality. Query can match a known building_id to narrow a physical dataset. Above/below is topology, not measured alignment; connects_to is not an inferred door. Measurements, components, selected target, solutions, artifacts (text and supported parametric recipes with deterministic part dimensions, not pixels), requirements and collaboration data. Follow next_cursor with after_id using identical filters.' },
        query: { type: ['string', 'null'], description: 'Literal search text, max 200 characters.' },
        status: { type: ['string', 'null'], description: 'Task, material or event status only; otherwise null.' },
        area_id: { type: ['string', 'null'], description: 'Exact area id for task/design datasets; otherwise null. For target: an empty area result inherits record_id=project; an explicit row with null solution_id means cleared, not inherited.' },
        after_id: { type: ['string', 'null'], description: 'Pagination: copy next_cursor from the previous result, keep filters unchanged. Start with null.' },
        record_id: { type: ['string', 'null'], description: 'Exact record id, or null. For plan, use the revision as a string to read a saved proposal or historical plan; null reads only the approved plan. The pending proposal record_id is in the project working_plan briefing. Other plan filters must be null.' },
      },
      required: ['dataset', 'query', 'status', 'area_id', 'record_id', 'after_id'],
    },
  },
}

/** One instance per question; the model cannot change its project or budget. */
export function createProjectLookup(projectId: string, transport: LookupTransport, timeoutMs: number = LIMITS.timeoutMs, budget: number = LIMITS.lookups, byteLimit: number = LIMITS.bytes) {
  if(!Number.isSafeInteger(byteLimit)||byteLimit<1024||byteLimit>512*1024)throw new Error('invalid_lookup_budget')
  let used = 0
  const sources: ProjectSource[] = []
  let incomplete = false
  return {
    sources,
    async inspectStairs(value: unknown) {
      if (used>=budget) { incomplete=true; return {status:'budget_exhausted',saved:false} }
      const input=parseStairInspection(value)
      if (!input) { ++used; incomplete=true; return {status:'invalid',saved:false,message:'Use the supported stair candidate shape.'} }
      const result=await this.search({dataset:'artifacts',query:null,status:null,area_id:null,record_id:input.plan_id,after_id:null})
      if(result.status!=='ok')return {status:result.status,saved:false,message:'Source plan unavailable.'}
      const row=result.records.find(r=>r.id===input.plan_id)
      if(!row?.multifloor_plan)return {status:'unavailable',saved:false,message:'No authorised source plan. Never reconstruct it from memory.'}
      if(row.revision!==input.plan_revision)return {status:'conflict',saved:false,message:'Read the current source-plan revision first.'}
      try {
        const d=checkedBuildingPlan(row.multifloor_plan,projectId,input.plan_id,input.plan_revision)
        if(d.sources_changed||row.archived)return {status:'conflict',saved:false,message:'Review/refresh changed source plan before calculating stairs.'}
        const candidates=input.candidates.map(c=>{
          try{return {label:c.label,result:stairSummary(d.recipe,c.recipe)}}
          catch(e){return {label:c.label,error:e instanceof Error?e.message:'Unsupported geometry'}}
        })
        return {status:'ok',saved:false,plan_id:input.plan_id,plan_revision:input.plan_revision,names:d.names,
          physical_pending:d.physical_pending,candidates,assessment:'Geometric study only; no global fit, structural or safety approval.'}
      } catch {return {status:'unavailable',saved:false,message:'Invalid source-plan readback.'}}
    },
    async inspectProjection(value: unknown) {
      if(used>=budget){incomplete=true;return {status:'budget_exhausted',message:'Projection lookup budget exhausted; no change saved.'}}
      const input=parseProjection(value)
      if(!input){++used;incomplete=true;return {status:'invalid',message:'Invalid projection request; no change saved.'}}
      const result=await this.search({dataset:'artifacts',query:null,status:null,area_id:null,record_id:input.record_id,after_id:null})
      if(result.status!=='ok')return {status:result.status,message:'Coordinate plan unavailable; no change saved.'}
      const row=result.records.find(r=>r.id===input.record_id)
      if(!row||!row.multifloor_plan)return {status:'unavailable',message:'No readable coordinate plan. Do not reconstruct from memory.'}
      if(row.revision!==input.expected_revision)return {status:'conflict',message:'Plan revision changed. Read the current plan first.'}
      try{
        const d=checkedBuildingPlan(row.multifloor_plan,projectId,input.record_id,input.expected_revision)
        const g=buildingPlanGeometry({...d.recipe,probes:[{key:'inspection',label:'Read-only study area',from_level_id:input.from_level_id,to_level_id:input.to_level_id,bounds:input.bounds}]})
        return {status:'ok',saved:false,artifact_id:input.record_id,revision:input.expected_revision,unit:'mm',
          projection:g.probes[0],names:d.names,sources_changed:d.sources_changed,physical_pending:d.physical_pending,
          contains_estimates:g.contains_estimates,conflicts:g.conflicts.slice(0,12),conflicts_total:g.conflicts.length,limits:g.limits}
      }catch{return {status:'invalid',message:'Cannot project these inputs in the saved frame. No change saved.'}}
    },
    get remaining() { return Math.max(0, budget - used) },
    get partial() { return incomplete },
    async search(value: unknown): Promise<LookupResult> {
      const base: LookupResult = { status: 'invalid', projectId, retrievedAt: new Date().toISOString(), records: [], related: [], truncated: false, partial: true, truth: 'unknown' }
      // Invalid attempts count too, so malformed/hostile calls cannot loop forever.
      if (++used > budget) { incomplete = true; return { ...base, status: 'budget_exhausted' } }
      const input = parseLookup(value)
      if (!input) { incomplete = true; return base }
      base.dataset = input.dataset
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const { data, error } = await Promise.race([
          Promise.resolve(transport(projectId, input, controller.signal)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, timeoutMs) }),
        ])
        if (error) {
          incomplete = true
          return { ...base, status: error.code === '42501' ? 'denied' : error.code === '22023' ? 'invalid' : 'unavailable' }
        }
        const payload = data as LookupPayload
        if (!payload || !Array.isArray(payload.records) || !Array.isArray(payload.related) || typeof payload.truncated !== 'boolean') throw new Error('invalid_payload')
        if (!payload.records.length && payload.truncated && !payload.next_cursor) {
          incomplete = true
          return { ...base, status: 'record_too_large', truncated: true }
        }
        const result: LookupResult = { ...base, status: 'ok', next_cursor: typeof payload.next_cursor === 'string' ? payload.next_cursor : null, records: payload.records.slice(0, LIMITS.rows), related: payload.related.slice(0, LIMITS.joinedRows), truncated: payload.truncated || payload.records.length > LIMITS.rows || payload.related.length > LIMITS.joinedRows }
        if (input.dataset === 'artifacts') result.records = result.records.map(row => {
          if (row.stair_study || row.has_stair_study) return row.stair_study ? withDerivedStair(row, projectId) : { ...row, stair_detail: input.record_id ? 'unavailable' : 'read_exact_record_id' }
          if (row.multifloor_plan || row.has_multifloor_plan) return row.multifloor_plan ? withDerivedBuildingPlan(row, projectId) : { ...row, coordinate_detail: input.record_id ? 'unavailable' : 'read_exact_record_id' }
          if (row.room_layout || row.has_room_layout) return withDerivedRoomLayout(row, projectId)
          if (!row.parametric_recipe) return row
          try {
            const g = storageBoxGeometry(row.parametric_recipe)
            return { ...row, derived_drawing: { generator: g.recipe.generator, version: g.recipe.version,
              truth: 'provided_spec', unit: 'mm', inside_width: g.innerWidthMm, inside_height: g.innerHeightMm,
              inside_depth: g.innerDepthMm, finished_parts: g.parts, limits: BOX_LIMITS } }
          } catch { return { ...row, drawing_error: 'Unsupported or invalid recipe. Do not infer geometry or overwrite this drawing.' } }
        })
        while (new TextEncoder().encode(JSON.stringify(result)).length > byteLimit) {
          result.truncated = true
          if (result.related.length) result.related.pop()
          else {
            if (result.records.length <= 1) {
              incomplete = true
              return { ...base, status: 'record_too_large', truncated: true }
            }
            result.records.pop()
            result.next_cursor = result.records.at(-1)?.id ?? null
          }
        }
        result.status = result.records.length || result.truncated ? 'ok' : 'empty'
        incomplete ||= result.truncated
        for (const [row, dataset] of [...result.records.map(row => [row, input.dataset] as const), ...result.related.map(row => [row, typeof row.kind === 'string' ? row.kind : input.dataset] as const)]) {
          const label = String(row.name ?? row.subject ?? row.title ?? row.text ?? row.id).slice(0, 120)
          sources.push({ projectId, dataset, recordId: row.id, label, retrievedAt: result.retrievedAt, updatedAt: row.updated_at ?? null, truth: 'unknown' })
        }
        return result
      } catch (error) {
        rethrowContinuation(error)
        incomplete = true
        return { ...base, status: 'unavailable' }
      } finally { clearTimeout(timer) }
    },
  }
}
