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
  tool('save_project_drawing', DRAWING_DESCRIPTION, DRAWING_PROPERTIES),
  tool('save_project_description', 'Save the requested project description/plan. Read the current project first; preserve unrelated content. This does not select a SolutionVersion or certify a design.', {
    description: { ...text, description: 'Full replacement description, at most 12000 characters.' },
    expected_updated_at: text, request_quote: quote,
  }),
  tool('save_project_task', 'Create a todo task or revise its name/instructions in this project. Read Areas/tasks to resolve exact IDs. Does not assign people, change status, certify readiness or complete checks.', {
    record_id: { ...nullableText, description: 'Existing task ID; null to create.' }, area_id: text,
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
  kind: 'project' | 'task' | 'measurement' | 'drawing'
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
}
export type WriteTransport = (payload: WritePayload) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
export type ReceiptTransport = () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isText = (x: unknown, max: number, empty = false): x is string => typeof x === 'string' && x.length <= max && (empty || x.trim().length > 0)
const isTime = (x: unknown) => isText(x, 60) && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x))

export function parseProjectWrite(name: string, value: unknown, projectId: string, userMessage: string): WritePayload | null {
  const definition = WRITE_TOOLS.find(t => t.function.name === name)
  if (!definition || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const keys = definition.function.parameters.required
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) return null
  if (!isText(v.request_quote, 500) || !userMessage.includes(v.request_quote)) return null
  const base = { kind: 'project' as WritePayload['kind'], record_id: projectId as string | null, expected_updated_at: null as string | null,
    expected_revision: null as number | null, request_quote: v.request_quote, data: {} as Record<string, unknown> }
  if (name === 'save_project_description') {
    if (!isText(v.description, 12000, true) || !isTime(v.expected_updated_at)) return null
    return { ...base, expected_updated_at: v.expected_updated_at as string, data: { description: v.description } }
  }
  if (v.record_id !== null && !isText(v.record_id, 200)) return null
  base.record_id = v.record_id as string | null
  if (name === 'save_project_task') {
    if (!isText(v.area_id, 200) || !isText(v.name, 300) || !isText(v.instructions, 12000, true)
      || (v.record_id === null ? v.expected_updated_at !== null : !isTime(v.expected_updated_at))) return null
    return { ...base, kind: 'task', expected_updated_at: v.expected_updated_at as string | null,
      data: { area_id: v.area_id, name: v.name, instructions: v.instructions } }
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
    || (r.dataset === 'artifacts' && (r.record.revision !== r.revision || r.record.area_id !== r.areaId))) throw new Error('Invalid write receipt')
  return r
}
export function compactReceipts(receipts: WriteReadback[]): ProjectWriteReceipt[] {
  return receipts.map(({ record: _record, ...receipt }) => receipt)
}
export function createProjectWriter(projectId: string, userMessage: string, transport: WriteTransport, read: ReceiptTransport, settle: ReceiptTransport) {
  let used = 0
  let uncertain = false
  let settled = false
  const receipts: WriteReadback[] = []
  const remember = (r: WriteReadback) => {
    if (!receipts.some(old => old.dataset === r.dataset && old.recordId === r.recordId)) receipts.push(r)
  }
  return {
    receipts,
    get remaining() { return uncertain || settled ? 0 : Math.max(0, 8 - used) },
    get uncertain() { return uncertain },
    async recover(): Promise<WriteReadback[]> {
      const { data, error } = await read()
      if (error || !Array.isArray(data) || data.length > 8) throw new Error('Write recovery unavailable')
      data.map(r => checkedReceipt(r, projectId)).forEach(remember)
      return receipts
    },
    async settle(): Promise<number> {
      const { data, error } = await settle()
      const result = data as { generation: number; receipts: unknown[] }
      if (error || !result || !Number.isSafeInteger(result.generation) || result.generation < 1
        || !Array.isArray(result.receipts) || result.receipts.length > 8) throw new Error('Write settlement unavailable')
      const confirmed = result.receipts.map(r => checkedReceipt(r, projectId))
      receipts.splice(0, receipts.length, ...confirmed)
      settled = true
      return result.generation
    },
    async write(name: string, value: unknown): Promise<WriteResult> {
      if (settled) return { status: 'denied' }
      if (uncertain) return { status: 'unknown', message: 'A prior write has an uncertain outcome. Stop; do not retry or claim it failed.' }
      if (++used > 8) return { status: 'budget_exhausted' }
      const payload = parseProjectWrite(name, value, projectId, userMessage)
      if (!payload) return { status: 'invalid', message: 'Use exactly the tool schema and an exact quote from the current user request. No change made.' }
      try {
        const { data, error } = await transport(payload)
        if (error) {
          if (error.code === '42501' || error.message?.includes('turn_not_claimed')) return { status: 'denied' }
          if (error.code === '40001' || error.message?.includes('Record changed')) return { status: 'conflict', message: 'Record changed. Read the current record and do not overwrite unrelated changes.' }
          if (['22023', '22P02', '22007', '22008', '23502', '23503', '23514', 'P0001'].includes(error.code ?? '')) return { status: 'invalid', message: 'The database rejected this command. No change made; check fields, source, current revision and record state.' }
          throw new Error('Unknown write result')
        }
        const receipt = checkedReceipt(data, projectId)
        remember(receipt)
        return { status: 'saved', receipt }
      } catch {
        uncertain = true
        return { status: 'unknown', message: 'Could not verify whether the write committed. Do not repeat it. Recovery is required.' }
      }
    },
  }
}
export type ProjectWriter = ReturnType<typeof createProjectWriter>

/** Receipt-only recovery: no second model run or accidental repeated edits. */
export function savedWriteSummary(receipts: WriteReadback[], uncertain = false): string {
  const saved = receipts.length ? `Sparat i projektet:\n${receipts.map(r => `• ${r.label} (${r.operation === 'created' ? 'skapad' : 'uppdaterad'}).`).join('\n')}\n\n` : ''
  return saved + (uncertain
    ? 'En skrivning kunde inte verifieras. Jag har stoppat fler ändringar; kontrollera uppgifterna innan du försöker igen.'
    : 'Ändringarna ovan är verifierade. Svaret kunde inte slutföras normalt, så jag visar sparningskvittot i stället. Jag har inte upprepat ändringarna.')
}
