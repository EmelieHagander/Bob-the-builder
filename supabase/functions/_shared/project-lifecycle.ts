import type { WritePayload } from './project-write.ts'

/** Keeping the project tidy: archive/restore, delete, detach, phase and schedule.
 * All go through the claimed-turn writer (bob_project_write_v13) with the same
 * request quote, budget, before-state receipt and project scope as other writes. */
const quote = { type: 'string', description: 'Exact 1–500 character quote from the CURRENT user message authorising this action, including a clear approval of an earlier option.' }
const timestamp = { type: 'string', description: 'The record\'s current updated_at, read just before this call.' }
function tool(name: string, description: string, properties: Record<string, unknown>) {
  return { type: 'function' as const, function: { name, description, parameters: {
    type: 'object', additionalProperties: false, properties, required: Object.keys(properties),
  } } }
}
export const LIFECYCLE_TOOLS = [
  tool('archive_project_area', 'Archive a finished or unused Area, or restore an archived one. History and completed work stay.', {
    area_id: { type: 'string' }, action: { type: 'string', enum: ['archive', 'restore'] }, expected_updated_at: timestamp, request_quote: quote,
  }),
  tool('delete_project_task', 'Delete a Task that no longer belongs, with its checkpoints, assignments, dependencies and attachments. Completed Tasks are kept.', {
    task_id: { type: 'string' }, expected_updated_at: timestamp, request_quote: quote,
  }),
  tool('delete_project_build_day', 'Delete a build day that will not happen. Its scheduled Tasks stay; sign-ups and Task links go.', {
    build_day_id: { type: 'string' }, expected_updated_at: timestamp, request_quote: quote,
  }),
  tool('delete_shopping_item', 'Remove one item from the Shopping list.', {
    shopping_item_id: { type: 'string' }, request_quote: quote,
  }),
  tool('detach_project_image', 'Detach an image from one target. The image stays in the project library.', {
    image_id: { type: 'string', description: 'Exact image UUID.' },
    target_kind: { type: 'string', enum: ['area', 'task', 'step', 'plan_step'], description: 'step = Task instruction step; plan_step = living-plan Step.' },
    target_id: { type: 'string' }, request_quote: quote,
  }),
  tool('set_project_phase', 'Move the project or one Area to a lifecycle phase.', {
    scope: { type: 'string', enum: ['project', 'area'] }, area_id: { type: ['string', 'null'], description: 'Exact Area ID when scope=area; otherwise null.' },
    phase: { type: 'string', enum: ['concept', 'design', 'planning', 'build', 'complete'] },
    reason: { type: 'string', description: 'Short reason kept in the phase history, at most 1000 characters.' }, request_quote: quote,
  }),
  tool('update_project_schedule', 'Set or clear the project\'s build window.', {
    start_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null together with end_date to clear.' },
    end_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, not before start_date, or null together with start_date.' },
    expected_updated_at: { type: 'string', description: 'The project\'s current updated_at.' }, request_quote: quote,
  }),
]
export const LIFECYCLE_TOOL_NAMES = new Set(LIFECYCLE_TOOLS.map(t => t.function.name))

const id = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200
const time = (v: unknown) => typeof v === 'string' && v.length <= 60 && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'))

export function parseLifecycleWrite(name: string, v: Record<string, any>, projectId: string): WritePayload | null {
  const base = { kind: 'lifecycle' as const, expected_revision: null, request_quote: v.request_quote as string }
  if (name === 'archive_project_area') {
    if (!id(v.area_id) || !['archive', 'restore'].includes(v.action) || !time(v.expected_updated_at)) return null
    return { ...base, record_id: v.area_id, expected_updated_at: v.expected_updated_at, data: { action: v.action === 'archive' ? 'archive_area' : 'restore_area' } }
  }
  if (name === 'delete_project_task') {
    if (!id(v.task_id) || !time(v.expected_updated_at)) return null
    return { ...base, record_id: v.task_id, expected_updated_at: v.expected_updated_at, data: { action: 'delete_task' } }
  }
  if (name === 'delete_project_build_day') {
    if (!id(v.build_day_id) || !time(v.expected_updated_at)) return null
    return { ...base, record_id: v.build_day_id, expected_updated_at: v.expected_updated_at, data: { action: 'delete_build_day' } }
  }
  if (name === 'delete_shopping_item') {
    if (!id(v.shopping_item_id)) return null
    return { ...base, record_id: v.shopping_item_id, expected_updated_at: null, data: { action: 'delete_shopping_item' } }
  }
  if (name === 'detach_project_image') {
    if (typeof v.image_id !== 'string' || !uuid.test(v.image_id) || !['area', 'task', 'step', 'plan_step'].includes(v.target_kind) || !id(v.target_id)) return null
    return { ...base, record_id: v.image_id, expected_updated_at: null, data: { action: 'detach_image', target_kind: v.target_kind, target_id: v.target_id } }
  }
  if (name === 'set_project_phase') {
    if (!['project', 'area'].includes(v.scope) || !['concept', 'design', 'planning', 'build', 'complete'].includes(v.phase)
      || typeof v.reason !== 'string' || !v.reason.trim() || v.reason.length > 1000
      || (v.scope === 'project' ? v.area_id !== null : !id(v.area_id))) return null
    return { ...base, record_id: v.scope === 'project' ? projectId : v.area_id, expected_updated_at: null,
      data: { action: v.scope === 'project' ? 'set_project_phase' : 'set_area_phase', phase: v.phase, reason: v.reason.trim() } }
  }
  if (name === 'update_project_schedule') {
    const clear = v.start_date === null && v.end_date === null
    if (!time(v.expected_updated_at) || !(clear || (day(v.start_date) && day(v.end_date) && v.start_date <= v.end_date))) return null
    return { ...base, record_id: projectId, expected_updated_at: v.expected_updated_at, data: { action: 'set_schedule', start_date: v.start_date, end_date: v.end_date } }
  }
  return null
}
