import { schemaIssues } from './schema-issues.ts'
import { BOB_WRITE_LIMIT } from '../../../src/data/bobEvidence.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { OPERATION_WRITE_TOOLS, parseOperationalWrite } from './project-operations.ts'
import { EXPERT_TOOLS, parseExpertWrite } from './project-expert-tools.ts'
import { CATALOG_WRITE_TOOL, parseCatalogWrite } from './material-catalog.ts'
import { PLAN_WRITE_TOOLS, parsePlanWrite } from './project-plan.ts'
import { STAIR_WRITE_TOOL, parseStairWrite } from './project-stair.ts'
import { withDerivedStair } from '../../../src/lib/stairStudy.ts'
import { BUILDING_PLAN_TOOL, parseBuildingPlanWrite } from './project-building-plan.ts'
import { withDerivedBuildingPlan } from '../../../src/lib/buildingPlan.ts'
import { BUILDING_INTAKE_TOOL, parseBuildingIntake } from './building-intake.ts'
import { ROOM_LAYOUT_TOOLS, parseRoomLayoutWrite } from './project-room-layout.ts'
import { withDerivedRoomLayout } from '../../../src/lib/roomLayout.ts'
import type { ProjectWriteReceipt } from '../../../src/data/provenance.ts'
import { isProjectWriteReceipt } from '../../../src/data/bobEvidence.ts'
import { DRAWING_PROPERTIES, DRAWING_DESCRIPTION, parseDrawingWrite } from './project-drawing-write.ts'

const nullableText = { type: ['string', 'null'] }
const text = { type: 'string' }
const quote = { type: 'string', description: 'Exact 1–500 character quote from the CURRENT user message authorising this action, including a clear approval of an earlier option.' }
function tool(name: string, description: string, properties: Record<string, unknown>) {
  return { type: 'function' as const, function: { name, description, parameters: {
    type: 'object', additionalProperties: false, properties, required: Object.keys(properties),
  } } }
}
export const WRITE_TOOLS = [
  ...OPERATION_WRITE_TOOLS,
  ...EXPERT_TOOLS,
  CATALOG_WRITE_TOOL,
  ...PLAN_WRITE_TOOLS,
  STAIR_WRITE_TOOL,
  BUILDING_PLAN_TOOL,
  BUILDING_INTAKE_TOOL,
  ...ROOM_LAYOUT_TOOLS,
  tool('save_project_drawing', DRAWING_DESCRIPTION, DRAWING_PROPERTIES),
  tool('link_project_drawing', 'Link or unlink a saved drawing and a current work Step without redrawing. One drawing can support several Steps. Saved drawings appear on Project home automatically; Planning is a phase, not a mandatory Step.', {
    record_id: text, expected_revision: { type: 'integer' }, step_id: text,
    action: { type: 'string', enum: ['link', 'unlink'] }, request_quote: quote,
  }),
  tool('save_project_description', 'Save the requested project description/plan. Read the current project first; preserve unrelated content. This does not select a SolutionVersion or certify a design.', {
    description: { ...text, description: 'Full replacement description, at most 12000 characters.' },
    expected_updated_at: text, request_quote: quote,
  }),
  tool('save_project_area','Create or revise an optional Area grouping of Steps, not a physical room. Read and reuse current Areas before creating.', {record_id:nullableText,name:text,description:text,expected_updated_at:nullableText,request_quote:quote}),
  tool('save_project_task', 'Create a todo task or revise its name/instructions in this project. Read Areas/tasks to resolve exact IDs. Does not assign people, change status, certify readiness or complete checks.', {
    record_id: { ...nullableText, description: 'Existing task ID; null to create.' }, area_id: {...nullableText,description:'Optional Area; derived from the primary Step when step_id is supplied.'}, step_id:{...nullableText,description:'Exact current Plan Step UUID. Creates/updates primary ownership in the same save; null preserves existing ownership or creates legacy Area work.'},
    name: text, instructions: { ...text, description: 'Practical task instructions, at most 12000 characters. Preserve existing content unless asked to replace it.' },
    expected_updated_at: { ...nullableText, description: 'Current task timestamp when editing; null when creating.' }, request_quote: quote,
  }),
  tool('save_project_measurement', 'Create or revise a measurement using canonical version history. A chosen/design dimension is provided_spec, NOT measured. Preserve other fields. Read current measurements before revising; never duplicate an existing observation.', {
    record_id: { ...nullableText, description: 'Existing measurement UUID; null to create.' },
    create_area_id: { ...nullableText, description: 'Optional exact Area ID on create; null when revising.' },
    create_component_id: { ...nullableText, description: 'Optional existing component UUID on create; null when revising. Never guess an ID.' },
    expected_revision: { type: 'integer', description: '0 on create; current revision number on edit.' },
    subject: text, value: { ...nullableText, description: 'Non-negative decimal, max 3 decimal places, <=1000000. Null only for unknown.' },
    unit: { type: 'string', enum: ['mm', 'cm', 'm'] },
    truth: { type: 'string', enum: ['measured', 'provided_spec', 'estimated', 'unknown'] },
    source: { ...text, description: 'Actual user-provided source or explicitly identified estimate. Never invent measurement/inspection evidence.' },
    notes: text, required: { type: 'boolean' }, change_note: text, request_quote: quote,
  }),
]
export interface WritePayload {
  kind: 'operational' | 'drawing_link' | 'image_reserve' | 'image_finalize' | 'image_link' | 'cad' | 'measurement_state' | 'solution' | 'target' | 'task_work' | 'project' | 'area' | 'task' | 'measurement' | 'drawing' | 'room_layout' | 'building_context' | 'multifloor' | 'stair' | 'catalog' | 'plan_proposal' | 'plan_decision' | 'plan_evidence' | 'plan_task' | 'plan_focus'
  record_id: string | null
  expected_updated_at: string | null
  expected_revision: number | null
  request_quote: string
  data: Record<string, unknown>
}
export interface WriteReadback extends ProjectWriteReceipt { record: Record<string, unknown> }
export interface WriteResult {
  status: 'saved' | 'invalid' | 'conflict' | 'denied' | 'unknown' | 'budget_exhausted'
  receipt?: WriteReadback
  message?: string
  validation?: Pick<WriteValidationIssue, 'code' | 'fields'>
}
export interface WriteValidationIssue {
  code: 'tool_shape' | 'request_quote' | 'field_value' | 'task_location' | 'domain_fields'
  fields: string[]
  message: string
}
export type WriteTransport = (payload: WritePayload) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
export type ReceiptTransport = () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isText = (x: unknown, max: number, empty = false): x is string => typeof x === 'string' && x.length <= max && (empty || x.trim().length > 0)
const isTime = (x: unknown) => isText(x, 60) && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x))

export function parseProjectWrite(name: string, value: unknown, projectId: string, userMessage: string, report?: (issue: WriteValidationIssue) => void): WritePayload | null {
  const invalid = (code: WriteValidationIssue['code'], fields: string[], message: string) => {
    report?.({ code, fields, message }); return null
  }
  const definition = WRITE_TOOLS.find(t => t.function.name === name)
  if (!definition || !value || typeof value !== 'object' || Array.isArray(value)) return invalid('tool_shape', [], 'Use the offered tool with one JSON object matching its schema.')
  const v = {...value} as Record<string, unknown>
  if(name==='propose_project_plan'&&!Object.hasOwn(v,'task_links'))v.task_links=[]
  if(name==='save_project_task'&&!Object.hasOwn(v,'step_id'))v.step_id=null
  const keys = definition.function.parameters.required
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) return invalid('tool_shape', keys.filter(k => !Object.hasOwn(v, k)), 'Supply every required field and remove fields absent from the tool schema. Use null only where allowed.')
  if (!isText(v.request_quote, 500) || !userMessage.includes(v.request_quote)) return invalid('request_quote', ['request_quote'], 'Copy an exact 1–500 character span from the CURRENT user message, preserving its spelling and whitespace. Do not rewrite it or quote an earlier turn. This is not a request for new permission.')
  if (OPERATION_WRITE_TOOLS.some(t=>t.function.name===name)) return parseOperationalWrite(name,v)
  if (name === 'link_project_drawing') {
    if (typeof v.record_id !== 'string' || !uuid.test(v.record_id) || typeof v.step_id !== 'string' || !uuid.test(v.step_id)
      || !Number.isSafeInteger(v.expected_revision) || Number(v.expected_revision) < 1 || !['link', 'unlink'].includes(String(v.action))) return null
    return { kind: 'drawing_link', record_id: v.record_id, expected_updated_at: null, expected_revision: v.expected_revision as number,
      request_quote: v.request_quote, data: { step_id: v.step_id, action: v.action } }
  }
  if (EXPERT_TOOLS.some(t => t.function.name === name)) return parseExpertWrite(name, v)
  if (name === CATALOG_WRITE_TOOL.function.name) return parseCatalogWrite(v)
  if (PLAN_WRITE_TOOLS.some(t => t.function.name === name)) return parsePlanWrite(name, v)
  if (name === STAIR_WRITE_TOOL.function.name) return parseStairWrite(v)
  if (name === BUILDING_PLAN_TOOL.function.name) return parseBuildingPlanWrite(v)
  if (name === BUILDING_INTAKE_TOOL.function.name) return parseBuildingIntake(v, userMessage)
  if (ROOM_LAYOUT_TOOLS.some(t => t.function.name === name)) return parseRoomLayoutWrite(name, v)
  const base = { kind: 'project' as WritePayload['kind'], record_id: projectId as string | null, expected_updated_at: null as string | null,
    expected_revision: null as number | null, request_quote: v.request_quote, data: {} as Record<string, unknown> }
  if (name === 'save_project_description') {
    if (!isText(v.description, 12000, true) || !isTime(v.expected_updated_at)) return null
    return { ...base, expected_updated_at: v.expected_updated_at as string, data: { description: v.description } }
  }
  if (v.record_id !== null && !isText(v.record_id, 200)) return invalid('field_value', ['record_id'], 'Use the exact current record ID when editing, or null when creating.')
  base.record_id = v.record_id as string | null
  if(name==='save_project_area'){
    if(!isText(v.name,200)||!isText(v.description,4000,true)||(v.record_id===null?v.expected_updated_at!==null:!isTime(v.expected_updated_at)))return null
    return {...base,kind:'area',expected_updated_at:v.expected_updated_at as string|null,data:{name:v.name,description:v.description}}
  }
  if (name === 'save_project_task') {
    if (v.area_id !== null && !isText(v.area_id, 200)) return invalid('field_value', ['area_id'], 'Use an exact Area ID from current project records, or null.')
    if (v.step_id !== null && (typeof v.step_id !== 'string' || !uuid.test(v.step_id))) return invalid('field_value', ['step_id'], 'Use an exact current Plan Step UUID. Null preserves existing ownership; a Step title or Task ID is not a Step UUID.')
    if (v.record_id === null && v.area_id === null && v.step_id === null) return invalid('task_location', ['area_id', 'step_id'], 'A new Task needs an existing Area or current Plan Step. Read the project and supply its exact ID.')
    if (!isText(v.name, 300)) return invalid('field_value', ['name'], 'Supply a non-empty Task name of at most 300 characters.')
    if (!isText(v.instructions, 12000, true)) return invalid('field_value', ['instructions'], 'Supply Task instructions as a string of at most 12000 characters, preserving unrelated content.')
    if (v.record_id === null ? v.expected_updated_at !== null : !isTime(v.expected_updated_at)) return invalid('field_value', ['expected_updated_at'], 'For an edit, read and copy the current Task timestamp exactly. For a new Task, use null. Do not invent a timestamp.')
    return { ...base, kind: 'task', expected_updated_at: v.expected_updated_at as string | null,
      data: { area_id: v.area_id, ...(v.step_id!==null?{step_id:v.step_id}:{}), name: v.name, instructions: v.instructions } }
  }
  if (name === 'save_project_drawing') return parseDrawingWrite(v)
  if (v.record_id !== null && !uuid.test(v.record_id as string)) return null
  if (v.create_area_id !== null && !isText(v.create_area_id, 200)) return null
  if (v.create_component_id !== null && (typeof v.create_component_id !== 'string' || !uuid.test(v.create_component_id))) return null
  if (v.record_id !== null && (v.create_area_id !== null || v.create_component_id !== null)) return null
  if (!Number.isInteger(v.expected_revision) || (v.record_id === null ? v.expected_revision !== 0 : Number(v.expected_revision) < 1)) return null
  if (!isText(v.subject, 200) || !['mm', 'cm', 'm'].includes(String(v.unit))
    || !['measured', 'provided_spec', 'estimated', 'unknown'].includes(String(v.truth))
    || !isText(v.source, 2000, v.truth === 'unknown') || !isText(v.notes, 4000, true)
    || typeof v.required !== 'boolean' || !isText(v.change_note, 1000)) return null
  if (v.truth === 'unknown' ? v.value !== null
    : typeof v.value !== 'string' || !/^\d+(?:\.\d{1,3})?$/.test(v.value) || Number(v.value) > 1000000) return null
  const data = Object.fromEntries(['subject', 'value', 'unit', 'truth', 'source', 'notes', 'required', 'change_note'].map(k => [k, v[k]]))
  if (v.record_id === null) {
    // Omitting an unspecified Area lets the canonical command inherit the component's Area.
    if (v.create_area_id !== null) data.area_id = v.create_area_id
    if (v.create_component_id !== null) data.component_id = v.create_component_id
  }
  return { ...base, kind: 'measurement', expected_revision: v.expected_revision as number, data }
}
function checkedReceipt(value: unknown, projectId: string): WriteReadback {
  const r = value as WriteReadback
  if (!isProjectWriteReceipt(r, projectId) || !r.record || r.record.id !== r.recordId
    || (r.dataset === 'artifacts' && (r.record.revision !== r.revision || r.record.area_id !== r.areaId))
    || (['catalog','plan'].includes(r.dataset) && r.record.revision !== r.revision)) throw new Error('Invalid write receipt')
  return { ...r, record: withDerivedStair(withDerivedBuildingPlan(withDerivedRoomLayout(r.record, projectId), projectId), projectId) }
}
export function compactReceipts(receipts: WriteReadback[]): ProjectWriteReceipt[] {
  return receipts.map(({ record: _record, ...receipt }) => receipt)
}
export function createProjectWriter(projectId: string, userMessage: string, transport: WriteTransport, read: ReceiptTransport, settle: ReceiptTransport) {
  let used = 0, invalidAttempts = 0
  let uncertain = false
  let settled = false
  const receipts: WriteReadback[] = []
  const corrections = new Set<string>()
  const remember = (r: WriteReadback) => {
    const i=receipts.findIndex(old=>old.dataset===r.dataset&&old.recordId===r.recordId)
    if(i<0)receipts.push(r);else receipts[i]=r
  }
  return {
    receipts,
    get remaining() { return uncertain || settled ? 0 : invalidAttempts >= 12 ? 0 : Math.max(0, BOB_WRITE_LIMIT - used) },
    get correctionsRemaining() { return Math.max(0, 12 - invalidAttempts) },
    get uncertain() { return uncertain },
    get hasUnresolvedWrites() { return corrections.size > 0 },
    get needsRepair() { return !uncertain && !settled && used < BOB_WRITE_LIMIT && invalidAttempts < 12 && corrections.size > 0 },
    async recover(): Promise<WriteReadback[]> {
      const { data, error } = await read()
      if (error || !Array.isArray(data) || data.length > BOB_WRITE_LIMIT) throw new Error('Write recovery unavailable')
      data.map(r => checkedReceipt(r, projectId)).forEach(remember)
      return receipts
    },
    async settle(): Promise<number> {
      const { data, error } = await settle()
      const result = data as { generation: number; receipts: unknown[] }
      if (error || !result || !Number.isSafeInteger(result.generation) || result.generation < 1
        || !Array.isArray(result.receipts) || result.receipts.length > BOB_WRITE_LIMIT) throw new Error('Write settlement unavailable')
      const confirmed = result.receipts.map(r => checkedReceipt(r, projectId))
      receipts.splice(0, receipts.length, ...confirmed)
      settled = true
      return result.generation
    },
    async write(name: string, value: unknown): Promise<WriteResult> {
      let issue: WriteValidationIssue | undefined
      const payload = parseProjectWrite(name, value, projectId, userMessage, detail => { issue = detail })
      let result = await this.commit(payload)
      if (!payload && result.status === 'invalid') {
        const issues = schemaIssues(WRITE_TOOLS.find(t => t.function.name === name)?.function.parameters ?? {}, value)
        issue ??= { code: 'domain_fields', fields: issues.map(i => i.path), message: 'The command has invalid domain fields. Re-read this tool schema and the current target records; the request quote passed validation.' }
        result = { ...result, validation: { code: issue.code, fields: issue.fields }, ...(issues.length ? { issues } : {}), message: `No change made. ${issue.message} Correct this call within the remaining write budget if the action is authorised.` }
        console.warn('[Bob write validation]', JSON.stringify({ tool: name, code: issue.code, fields: issue.fields }))
      }
      // Track individual targets: saving another Task must not hide a rejected
      // edit. This is review bookkeeping, never authority to replay a write.
      const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      const key = JSON.stringify([name, v.record_id ?? null, v.action ?? null, v.record_id ? null : v.name ?? v.subject ?? v.key ?? null])
      if (result.status === 'invalid' || result.status === 'conflict') corrections.add(key)
      else if (result.status === 'saved') corrections.delete(key)
      return result
    },
    async commit(payload: WritePayload | null): Promise<WriteResult> {
      if (settled) return { status: 'denied' }
      if (uncertain) return { status: 'unknown', message: 'A prior write has an uncertain outcome. Stop; do not retry or claim it failed.' }
      if (used >= BOB_WRITE_LIMIT || invalidAttempts >= 12) return { status: 'budget_exhausted' }
      if (!payload || !payload.request_quote || !userMessage.includes(payload.request_quote)) { invalidAttempts++; return { status: 'invalid', message: 'Use exactly the tool schema and an exact quote from the current user request. No change made.' } }
      try {
        const { data, error } = await transport(payload)
        if (error) {
          invalidAttempts++
          if (error.code === '42501' || error.message?.includes('turn_not_claimed')) return { status: 'denied' }
          if (error.code === '40001' || (payload.kind === 'catalog' && error.code === '23505') || error.message?.includes('Record changed')) return { status: 'conflict', message: 'Record changed or an equivalent catalog definition exists. Read the current record and do not overwrite unrelated changes.' }
          if (['22023', '22P02', '22007', '22008', '23502', '23503', '23514', 'P0001'].includes(error.code ?? '')) {
            if (payload.kind === 'catalog') return { status: 'invalid', message: 'The catalog rejected this definition. No change made. Read the exact part/material profile and pinned material revision. Put required part dimensions in properties using the profile field keys; compatible material properties are inherited server-side, and notes are not dimension fields. If the current definition already matches, reuse it instead of revising metadata.' }
            if (payload.kind.startsWith('plan_')) return { status: 'invalid', message: 'The living plan rejected this command. No canonical plan was silently changed. Read the current plan, reuse only exact Step/Requirement IDs from it, keep completed history, and use current project evidence IDs/revisions.' }
            return { status: 'invalid', message: 'The database rejected this command. No change made; check fields, source, current revision and record state.' }
          }
          throw new Error('Unknown write result')
        }
        const receipt = checkedReceipt(data, projectId)
        used++; remember(receipt)
        return { status: 'saved', receipt }
      } catch (error) {
        rethrowContinuation(error)
        uncertain = true
        return { status: 'unknown', message: 'Could not verify whether the write committed. Do not repeat it. Recovery is required.' }
      }
    },
  }
}
export type ProjectWriter = ReturnType<typeof createProjectWriter>

/** Receipt-only recovery: no second model run or accidental repeated edits. */
export function savedWriteSummary(receipts: WriteReadback[], uncertain = false): string {
  const saved = receipts.length ? `Sparat eller återanvänt i projektet:\n${receipts.map(r => `• ${r.label} (${r.operation === 'created' ? 'skapad' : r.operation === 'reused' ? 'återanvänd, oförändrad' : 'uppdaterad'}).`).join('\n')}\n\n` : ''
  return saved + (uncertain
    ? 'En skrivning kunde inte verifieras. Jag har stoppat fler ändringar; kontrollera uppgifterna innan du försöker igen.'
    : 'Åtgärderna ovan är verifierade. Svaret kunde inte slutföras normalt, så jag visar kvittot i stället. Jag har inte upprepat ändringarna.')
}
