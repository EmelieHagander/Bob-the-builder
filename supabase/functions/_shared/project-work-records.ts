import { fingerprint, rethrowContinuation } from './bob-job-journal.ts'
import { parseProjectWrite, TASK_WORK_VALIDATION_CODES, type ProjectWriter, type WritePayload } from './project-write.ts'
import { schemaIssues } from './schema-issues.ts'
import { WORK_VALUE_TOOL_NAMES } from './project-tools/session.ts'
export { WORK_VALUE_TOOL_NAMES } from './project-tools/session.ts'

const text = { type: 'string' }, nullable = { type: ['string', 'null'] }
const tool = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function' as const, function: { name, description, parameters: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } })
export const WORK_RESOURCES = ['project', 'areas', 'tasks', 'measurements', 'build_days', 'people', 'plan_steps', 'components', 'shopping'] as const
export type WorkResource = typeof WORK_RESOURCES[number]
const changes = { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', additionalProperties: false, properties: { op: { type: 'string', enum: ['set', 'append_text'] }, path: text, value_json: { type: 'string', description: 'JSON-encoded new value. Use the string null to clear an explicitly nullable content field.' } }, required: ['op', 'path', 'value_json'] } }
export const WORK_RECORD_TOOLS = [
  tool('read_work_context', 'Read complete server-bound work records. Choose a returned ref; never copy database identities or versions. Resources include archived Areas and measurements for explicit restore. next_ref continues the same filter. People and current Plan Steps are relation choices. A read is metadata, never proof of inspection or completed work.', { resource: { type: 'string', enum: WORK_RESOURCES }, query: nullable, next_ref: nullable }),
  tool('edit_work_record', 'Edit only the requested content fields on a ref from read_work_context. Paths: Areas /name /description; Tasks /name /instructions; measurements /subject /value /unit /truth /source /notes /required; build_days /title /day /time /place /food; project /start_date /end_date (both null to clear). Operations set or append_text only. Other values, scope, assignments, scheduled Tasks and image evidence are preserved automatically. Unknown remains unknown; never call an inferred size measured. Read again after saving.', { ref: text, changes, reason: text, request_quote: text }),
  tool('create_work_record', 'Explicitly create a new Area, Task, measurement or build day. Read existing records first; never create to repair a rejected edit. scope_ref chooses project for Areas/build days, an Area or current Plan Step for Tasks, project/Area/component for measurements. base_ref optionally copies an existing record of the same resource and its existing content or scheduled task list; provide only differences. With no base use content paths from edit_work_record. New measurements default to unknown until actual evidence is supplied. New Tasks start todo without assignments; copying content does not certify work.', { resource: { type: 'string', enum: ['areas', 'tasks', 'measurements', 'build_days'] }, scope_ref: text, base_ref: nullable, changes, reason: text, request_quote: text }),
  tool('change_work_relation', 'Add or remove one person assignment on a Task, or one scheduled Task on a build day. target_ref and source_ref come from read_work_context. All other members are preserved. This does not change RSVP, readiness or completion.', { target_ref: text, source_ref: text, action: { type: 'string', enum: ['add', 'remove'] }, reason: text, request_quote: text }),
  tool('change_task_readiness', 'Change a Task need or dependency using a task_ref from read_work_context. Existing needs/dependencies use their zero-based item_index; additions and confirmation use null. add_dependency chooses another Task source_ref and optional checkpoint_index from its instruction_steps; all other actions use source_ref/checkpoint_index=null. add_need authors only /kind(tool|information), /label and /notes; edit_need changes only /label or /notes and preserves readiness. set_need_ready uses ready=true/false from actual evidence; other actions ready=null. Dependency addition and readiness confirmation use note; other actions note=null. Unused changes is []. Confirmation still requires no blockers and never invents inspection evidence.', { task_ref: text, action: { type: 'string', enum: ['add_dependency', 'remove_dependency', 'add_need', 'edit_need', 'set_need_ready', 'remove_need', 'confirm_readiness'] }, item_index: { type: ['integer', 'null'] }, source_ref: nullable, checkpoint_index: { type: ['integer', 'null'] }, changes: { ...changes, minItems: 0, maxItems: 10 }, ready: { type: ['boolean', 'null'] }, note: nullable, reason: text, request_quote: text }),
  tool('change_work_state', 'Explicit work state change on a ref from read_work_context. action archive/restore applies to Areas or measurements (value=null); delete to unfinished Tasks, build days or Shopping rows (value=null); status to Tasks (value=todo|doing|done|blocked); phase to project/Area (value=concept|design|planning|build|complete). Preserve all other data. Completed Tasks are retained; canonical readiness/phase rules still apply. A requested state is not invented physical evidence.', { ref: text, action: { type: 'string', enum: ['archive', 'restore', 'delete', 'status', 'phase'] }, value: nullable, reason: text, request_quote: text }),
]
// Keep WORK_RECORD_TOOLS and its v1 parser intact for pinned historical jobs.
// The native variants are closed by operation, path and primitive value type.
const nativeChange = (op: 'set' | 'append_text', paths: string[], value: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false,
  properties: { op: { type: 'string', enum: [op] }, path: { type: 'string', enum: paths }, value },
  required: ['op', 'path', 'value'],
})
const nativeText = { type: 'string', maxLength: 16000 }
const nativeChanges = { type: 'array', minItems: 1, maxItems: 40, items: { anyOf: [
  nativeChange('set', ['/name', '/description', '/instructions', '/subject', '/unit', '/truth', '/source', '/notes', '/title', '/day', '/time', '/place', '/food'], nativeText),
  nativeChange('set', ['/value', '/start_date', '/end_date'], { type: ['string', 'null'], maxLength: 16000 }),
  nativeChange('set', ['/required'], { type: 'boolean' }),
  nativeChange('append_text', ['/description', '/instructions', '/notes', '/food'], nativeText),
] } }
const nativeNeedChanges = { type: 'array', minItems: 0, maxItems: 10, items: { anyOf: [
  nativeChange('set', ['/kind', '/label', '/notes'], { type: 'string', maxLength: 4000 }),
  nativeChange('append_text', ['/notes'], { type: 'string', maxLength: 4000 }),
] } }
export const WORK_RECORD_TOOLS_V2 = WORK_RECORD_TOOLS.map(spec => !(WORK_VALUE_TOOL_NAMES as readonly string[]).includes(spec.function.name) ? spec : ({
  ...spec, function: { ...spec.function, parameters: { ...spec.function.parameters, properties: {
    ...spec.function.parameters.properties,
    changes: spec.function.name === 'change_task_readiness' ? nativeNeedChanges : nativeChanges,
  } } },
}))
export const SUPERSEDED_WORK_TOOLS = ['save_project_area', 'save_project_task', 'save_project_measurement', 'archive_project_measurement', 'update_project_task_work', 'save_project_build_day', 'delete_project_task', 'delete_project_build_day', 'archive_project_area', 'set_project_phase', 'update_project_schedule', 'delete_shopping_item', 'manage_task_readiness']
export type WorkSnapshot = { project_id: string; resource: WorkResource; key: string; scope_label: string; record: Record<string, any>; relations: Record<string, any> }
const exact = (v: unknown, keys: string[]): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const nonempty = (v: unknown, max = 1000): v is string => typeof v === 'string' && !!v.trim() && v.length <= max
const contentFields: Partial<Record<WorkResource, string[]>> = { project: ['start_date', 'end_date'], areas: ['name', 'description'], tasks: ['name', 'instructions'], measurements: ['subject', 'value', 'unit', 'truth', 'source', 'notes', 'required'], build_days: ['title', 'day', 'time', 'place', 'food'] }
const pick = (r: Record<string, any>, keys: string[]) => Object.fromEntries(keys.map(k => [k, r[k]]))
export function applyWorkDelta(resource: WorkResource, record: Record<string, any>, changes: unknown) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 40) throw Error('Provide between 1 and 40 requested changes.')
  const result = structuredClone(record), allowed = contentFields[resource] ?? []
  for (const c of changes) {
    if (!exact(c, ['op', 'path', 'value_json']) || !allowed.some(k => c.path === '/' + k) || !['set', 'append_text'].includes(c.op) || typeof c.value_json !== 'string' || c.value_json.length > 16000) throw Error('Use a supported content path and operation; relationships use change_work_relation.')
    const key = c.path.slice(1), value = JSON.parse(c.value_json)
    if (c.op === 'append_text') {
      if (typeof result[key] !== 'string' || typeof value !== 'string' || !['description', 'instructions', 'notes', 'food'].includes(key)) throw Error('Append only text content.')
      result[key] += value
    } else result[key] = value
  }
  return result
}
export function applyWorkDeltaV2(resource: WorkResource, record: Record<string, any>, changes: unknown) {
  if (schemaIssues(nativeChanges, changes).length) throw Error('Use the advertised content path, operation and native value type. Text is a normal string; do not JSON-encode it.')
  const result = structuredClone(record), allowed = contentFields[resource] ?? []
  for (const c of changes as { op: string; path: string; value: string | boolean | null }[]) {
    const key = c.path.slice(1)
    if (!allowed.includes(key)) throw Error('Use a supported content path for this record; relationships use change_work_relation.')
    if (c.op === 'append_text') {
      if (typeof result[key] !== 'string' || typeof c.value !== 'string') throw Error('Append only existing text content.')
      result[key] += c.value
    } else result[key] = c.value
  }
  return result
}
function display(s: WorkSnapshot): Record<string, unknown> {
  const fields = contentFields[s.resource] ?? (s.resource === 'people' ? ['name', 'initials', 'role'] : s.resource === 'plan_steps' ? ['title', 'goal', 'state', 'notes'] : s.resource === 'components' ? ['name', 'description', 'condition', 'truth'] : ['name', 'quantity', 'unit', 'status'])
  return { ...pick(s.record, fields), ...(s.record.archived !== undefined ? { archived: s.record.archived } : {}), ...(s.record.archived_at !== undefined ? { archived: s.record.archived_at !== null } : {}), ...(s.record.phase ? { phase: s.record.phase } : {}), ...(s.record.status ? { status: s.record.status } : {}), ...(s.resource === 'measurements' ? { has_source_image: !!s.record.source_media_id } : {}), ...Object.fromEntries(Object.entries(s.relations).map(([k, rows]) => [k === 'instructions' ? 'instruction_steps' : k, Array.isArray(rows) ? rows.map((r: any) => k === 'needs' ? pick(r, ['kind', 'label', 'notes', 'ready']) : k === 'dependencies' ? pick(r, ['prerequisite_task_name', 'prerequisite_step_title', 'note', 'satisfied']) : k === 'instructions' ? { ...pick(r, ['title', 'instructions', 'is_checkpoint', 'required']), completed: r.completed_at !== null } : ({ name: r.name ?? r.title })) : k === 'readiness' && rows ? { ...pick(rows, ['readiness_state', 'blocker_count', 'review_note']), blockers: (rows.blockers ?? []).map((b: any) => pick(b, ['kind', 'label'])) } : rows])) }
}
export function createWorkRecords(opts: {
  projectId: string; writer?: ProjectWriter; hasAccess: () => Promise<boolean>; unlimitedWork?: boolean;
  readSnapshot?: (input: { resource: WorkResource; key: string }) => PromiseLike<{ data: unknown; error: unknown }>;
  read: (input: { resource: WorkResource; query: string | null; after: string | null }) => PromiseLike<{ data: unknown; error: unknown }>;
}) {
  const snapshots = new Map<string, WorkSnapshot>(), pages = new Map<string, { resource: WorkResource; query: string | null; after: string }>()
  const latest = new Map<string, { resource: WorkResource; ref: string; scope: string; content: ReturnType<typeof display> }>()
  let reads = 0, partial = false
  const unavailable = () => { partial = true; return { status: 'unavailable' } }
  const register = async (s: WorkSnapshot) => {
    const ref = 'work_' + await fingerprint(s)
    snapshots.set(ref, structuredClone(s))
    const current = { ref, scope: s.scope_label, content: display(s) }
    latest.set(s.resource + ':' + s.key, { resource: s.resource, ...structuredClone(current) })
    return current
  }
  const refresh = async (resource: WorkResource, key: string) => {
    if (!opts.readSnapshot) return null
    try {
      if (!await opts.hasAccess()) return null
      const { data, error } = await opts.readSnapshot({ resource, key })
      if (error || !data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 240000 || !await opts.hasAccess()) return null
      const s = data as WorkSnapshot
      if (s.project_id !== opts.projectId || s.resource !== resource || s.key !== key || s.record?.id !== key || !s.relations || typeof s.relations !== 'object' || Array.isArray(s.relations)) return null
      // New immutable refs preserve stale-read detection and exact-retry keys.
      // A journaled readback rebuilds the same ref after a durable continuation.
      return await register(s)
    } catch (error) { rethrowContinuation(error); return null }
  }
  const canonical = (resource: WorkResource, r: Record<string, any>, s: WorkSnapshot | null, reason: string, quote: string, scope?: WorkSnapshot) => {
    const base = { record_id: s?.record.id ?? null, expected_updated_at: s?.record.updated_at ?? null, expected_revision: s?.record.revision ?? 0, request_quote: quote }
    if (resource === 'areas') return parseProjectWrite('save_project_area', { record_id: base.record_id, expected_updated_at: base.expected_updated_at, name: r.name, description: r.description, request_quote: quote }, opts.projectId, quote)
    if (resource === 'tasks') return parseProjectWrite('save_project_task', { record_id: base.record_id, expected_updated_at: base.expected_updated_at, name: r.name, instructions: r.instructions, area_id: s ? s.record.area_id : scope?.resource === 'areas' ? scope.record.id : null, step_id: s ? s.record.primary_step_id : scope?.resource === 'plan_steps' ? scope.record.id : null, request_quote: quote }, opts.projectId, quote)
    if (resource === 'measurements') return parseProjectWrite('save_project_measurement', { record_id: base.record_id, expected_revision: base.expected_revision, ...pick(r, contentFields.measurements!), create_area_id: !s && scope?.resource === 'areas' ? scope.record.id : null, create_component_id: !s && scope?.resource === 'components' ? scope.record.id : null, change_note: reason, request_quote: quote }, opts.projectId, quote)
    if (resource === 'build_days') return parseProjectWrite('save_project_build_day', { ...base, ...pick(r, contentFields.build_days!), task_ids: (s?.relations.tasks ?? []).map((t: any) => t.id) }, opts.projectId, quote)
    if (resource === 'project') return parseProjectWrite('update_project_schedule', { ...pick(r, contentFields.project!), expected_updated_at: base.expected_updated_at, request_quote: quote }, opts.projectId, quote)
    return null
  }
  return {
    tools: WORK_RECORD_TOOLS, get remaining() { return opts.unlimitedWork ? Infinity : Math.max(0, 24 - reads) }, get partial() { return partial },
    /** Latest authorized snapshots, without server identities or stale versions. */
    get currentRecords() { return structuredClone([...latest.values()]) },
    async execute(name: string, value: unknown, schemaVersion: 1 | 2 = 1, refreshValidation = false): Promise<any> {
      if (!await opts.hasAccess()) return { status: 'denied' }
      if (name === 'read_work_context') {
        if (!exact(value, ['resource', 'query', 'next_ref']) || !WORK_RESOURCES.includes(value.resource) || !(value.query === null || nonempty(value.query, 200)) || !(value.next_ref === null || typeof value.next_ref === 'string')) return { status: 'invalid' }
        if (!opts.unlimitedWork && reads >= 24) return { status: 'budget_exhausted' }
        const input = value.next_ref === null ? { resource: value.resource as WorkResource, query: value.query, after: null } : pages.get(value.next_ref)
        if (!input || input.resource !== value.resource || input.query !== value.query) return { status: 'invalid' }
        reads++
        try {
          const { data, error } = await opts.read(input)
          if (error || !Array.isArray(data) || data.length > 3 || JSON.stringify(data).length > 240000) return unavailable()
          const entries = []
          for (const s of data.slice(0, 2) as WorkSnapshot[]) {
            if (s.project_id !== opts.projectId || s.resource !== input.resource || !s.record || !s.relations || s.key !== s.record.id || !nonempty(s.key, 200)) return unavailable()
            entries.push(await register(s))
          }
          let next_ref: string | null = null
          if (data.length > 2) { const cursor = { ...input, after: data[1].key }; next_ref = 'page_' + await fingerprint({ project: opts.projectId, ...cursor }); pages.set(next_ref, cursor) }
          return { status: 'ok', entries, next_ref }
        } catch (error) { rethrowContinuation(error); return unavailable() }
      }
      if (!opts.writer || !WORK_RECORD_TOOLS.some(t => t.function.name === name)) return { status: 'denied' }
      const v = value as Record<string, any>, s = snapshots.get(v?.ref ?? v?.target_ref ?? v?.task_ref), scope = snapshots.get(v?.scope_ref), base = snapshots.get(v?.base_ref), source = snapshots.get(v?.source_ref)
      let domain: WritePayload | null = null, payload: WritePayload | null = null, issue = '', key = s ? s.resource + ':' + s.key : 'unbound', pins: WorkSnapshot[] = []
      try {
        if (!v || !nonempty(v.reason) || !nonempty(v.request_quote, 500)) throw Error('Provide the reason for the requested change.')
        if (name === 'create_work_record') {
          if (opts.writer.unresolvedTools.some(t => ['edit_work_record', 'change_work_relation', 'change_work_state', 'change_task_readiness'].includes(t))) throw Error('Resolve the failed edit first. Creation cannot repair it.')
          const scopes: Record<string, string[]> = { areas: ['project'], tasks: ['areas', 'plan_steps'], measurements: ['project', 'areas', 'components'], build_days: ['project'] }
          if (!exact(v, ['resource', 'scope_ref', 'base_ref', 'changes', 'reason', 'request_quote']) || !scope || !scopes[v.resource]?.includes(scope.resource) || !(v.base_ref === null || base?.resource === v.resource)) throw Error('Read the destination scope and optional base of the same resource.')
          if (scope.record.archived_at || scope.record.archived || base?.record.archived_at || base?.record.archived) throw Error('Restore an archived record before using it.')
          const defaults: Record<string, Record<string, unknown>> = { areas: { name: '', description: '' }, tasks: { name: '', instructions: '' }, measurements: { subject: '', value: null, unit: 'mm', truth: 'unknown', source: '', notes: '', required: false }, build_days: { title: '', day: '', time: '', place: '', food: '' } }
          const r = (schemaVersion === 2 ? applyWorkDeltaV2 : applyWorkDelta)(v.resource, base?.record ?? defaults[v.resource], v.changes)
          domain = canonical(v.resource, r, null, v.reason, v.request_quote, scope)
          if (domain && v.resource === 'build_days' && base) (domain.data.fields as any).task_ids = base.relations.tasks.map((t: any) => t.id)
          // A new measurement is a new observation: source image copying requires an explicit evidence action.
          if (base?.resource === 'measurements' && base.record.source_media_id) throw Error('Edit the existing observation; copying an image-backed observation needs an explicit evidence operation.')
          pins = [scope, ...(base ? [base] : [])]
          key = 'new:' + v.resource + ':' + scope.key + ':' + String(r.name ?? r.title ?? r.subject).trim().toLowerCase()
        } else {
          if (!s) throw Error('Read and choose the existing work record.')
          pins = [s]
          if (name === 'edit_work_record') {
            if (!exact(v, ['ref', 'changes', 'reason', 'request_quote'])) throw Error('Provide only the target and requested content changes.')
            domain = canonical(s.resource, (schemaVersion === 2 ? applyWorkDeltaV2 : applyWorkDelta)(s.resource, s.record, v.changes), s, v.reason, v.request_quote)
          } else if (name === 'change_work_relation') {
            if (!exact(v, ['target_ref', 'source_ref', 'action', 'reason', 'request_quote']) || !source || !['add', 'remove'].includes(v.action)) throw Error('Read both records and choose add or remove.')
            if (!(s.resource === 'tasks' && source.resource === 'people' || s.resource === 'build_days' && source.resource === 'tasks')) throw Error('Choose a Task and person, or a build day and Task.')
            const members = (s.resource === 'tasks' ? s.relations.people : s.relations.tasks).map((r: any) => r.id)
            const updated = v.action === 'add' ? [...new Set([...members, source.key])] : members.filter((id: string) => id !== source.key)
            pins.push(source)
            if (s.resource === 'tasks') domain = parseProjectWrite('update_project_task_work', { record_id: s.key, expected_updated_at: s.record.updated_at, status: s.record.status, person_ids: updated, request_quote: v.request_quote }, opts.projectId, v.request_quote)
            else { domain = canonical(s.resource, s.record, s, v.reason, v.request_quote); if (domain) (domain.data.fields as any).task_ids = updated }
          } else if (name === 'change_task_readiness') {
            if (!exact(v, ['task_ref', 'action', 'item_index', 'source_ref', 'checkpoint_index', 'changes', 'ready', 'note', 'reason', 'request_quote']) || s.resource !== 'tasks') throw Error('Read the Task and its complete readiness first.')
            if (!['add_dependency', 'remove_dependency', 'add_need', 'edit_need', 'set_need_ready', 'remove_need', 'confirm_readiness'].includes(v.action)) throw Error('Unsupported readiness action.')
            const existing = ['remove_dependency', 'edit_need', 'set_need_ready', 'remove_need'].includes(v.action)
            const items = v.action === 'remove_dependency' ? s.relations.dependencies : s.relations.needs
            const item = existing && Number.isSafeInteger(v.item_index) && v.item_index >= 0 ? items[v.item_index] : undefined
            if (existing ? !item : v.item_index !== null) throw Error('Use an item index from this Task read; additions have no item index.')
            if (v.action !== 'add_dependency' && (v.source_ref !== null || v.checkpoint_index !== null)) throw Error('Only dependency addition takes a prerequisite source.')
            if (v.action === 'set_need_ready' ? typeof v.ready !== 'boolean' : v.ready !== null) throw Error('Only set_need_ready takes ready=true/false.')
            if (['add_dependency', 'confirm_readiness'].includes(v.action) ? typeof v.note !== 'string' || v.note.length > (v.action === 'add_dependency' ? 1000 : 2000) : v.note !== null) throw Error('Only dependency addition and confirmation take a note.')
            let fields: Record<string, any> = {}
            if (['add_need', 'edit_need'].includes(v.action)) {
              fields = v.action === 'add_need' ? { kind: 'tool', label: '', notes: '' } : pick(item, ['label', 'notes', 'ready'])
              const allowed = v.action === 'add_need' ? ['kind', 'label', 'notes'] : ['label', 'notes']
              if (!Array.isArray(v.changes) || !v.changes.length || v.changes.length > 10) throw Error('Give the requested need changes.')
              if (schemaVersion === 2 && schemaIssues(nativeNeedChanges, v.changes).length) throw Error('Use the advertised need content fields with native text values; do not JSON-encode them.')
              for (const c of v.changes) {
                if (schemaVersion === 1 && (!exact(c, ['op', 'path', 'value_json']) || !allowed.some(k => c.path === '/' + k) || typeof c.value_json !== 'string' || c.value_json.length > 4000)
                  || schemaVersion === 2 && !allowed.some(k => c.path === '/' + k)) throw Error('Use only the advertised need content fields.')
                const key = c.path.slice(1), val = schemaVersion === 2 ? c.value : JSON.parse(c.value_json)
                if (typeof val !== 'string') throw Error('Need content must be text.')
                if (c.op === 'set') fields[key] = val
                else if (c.op === 'append_text' && key === 'notes') fields[key] += val
                else throw Error('Unsupported need change.')
              }
              if (!nonempty(fields.label, 200) || typeof fields.notes !== 'string' || fields.notes.length > 2000 || v.action === 'add_need' && !['tool', 'information'].includes(fields.kind)) throw Error('Give a valid need label and notes.')
            } else {
              if (!Array.isArray(v.changes) || v.changes.length) throw Error('This action has no content changes.')
              if (v.action === 'set_need_ready') fields = { ready: v.ready }
              else if (v.action === 'confirm_readiness') fields = { note: v.note }
              else if (v.action === 'add_dependency') {
                if (source?.resource !== 'tasks' || source.key === s.key) throw Error('Choose another Task as the prerequisite.')
                const instruction = v.checkpoint_index === null ? null : Number.isSafeInteger(v.checkpoint_index) && v.checkpoint_index >= 0 ? source.relations.instructions[v.checkpoint_index] : undefined
                if (instruction === undefined || instruction && !instruction.is_checkpoint) throw Error('Choose a checkpoint index from the prerequisite Task read, or null for the entire Task.')
                fields = { prerequisite_task_id: source.key, prerequisite_step_id: instruction?.id ?? null, note: v.note }; pins.push(source)
              }
            }
            domain = parseProjectWrite('manage_task_readiness', { task_id: s.key, record_id: item?.id ?? null, expected_revision: item?.revision ?? 0, expected_updated_at: null, action: v.action === 'edit_need' ? 'revise_need' : v.action, data: fields, request_quote: v.request_quote }, opts.projectId, v.request_quote)
          } else {
            if (!exact(v, ['ref', 'action', 'value', 'reason', 'request_quote'])) throw Error('Use a supported state action.')
            const q = { request_quote: v.request_quote }, timestamp = s.record.updated_at
            if (['archive', 'restore'].includes(v.action) && v.value === null) {
              if (s.resource === 'areas') domain = parseProjectWrite('archive_project_area', { ...q, area_id: s.key, action: v.action, expected_updated_at: timestamp }, opts.projectId, v.request_quote)
              if (s.resource === 'measurements') domain = parseProjectWrite('archive_project_measurement', { ...q, record_id: s.key, action: v.action, expected_revision: s.record.revision }, opts.projectId, v.request_quote)
            } else if (v.action === 'delete' && v.value === null) {
              const commands: Partial<Record<WorkResource, [string, string]>> = { tasks: ['delete_project_task', 'task_id'], build_days: ['delete_project_build_day', 'build_day_id'], shopping: ['delete_shopping_item', 'shopping_item_id'] }
              const command = commands[s.resource]
              if (command) domain = parseProjectWrite(command[0], { ...q, [command[1]]: s.key, ...(s.resource === 'shopping' ? {} : { expected_updated_at: timestamp }) }, opts.projectId, v.request_quote)
            } else if (v.action === 'status' && s.resource === 'tasks') domain = parseProjectWrite('update_project_task_work', { ...q, record_id: s.key, expected_updated_at: timestamp, status: v.value, person_ids: s.relations.people.map((p: any) => p.id) }, opts.projectId, v.request_quote)
            else if (v.action === 'phase' && ['project', 'areas'].includes(s.resource)) domain = parseProjectWrite('set_project_phase', { ...q, scope: s.resource === 'project' ? 'project' : 'area', area_id: s.resource === 'areas' ? s.key : null, phase: v.value, reason: v.reason }, opts.projectId, v.request_quote)
          }
        }
        if (!domain) throw Error('The requested content or action is invalid for this record. No values were guessed.')
        payload = { kind: 'bound_work', record_id: domain.record_id, expected_revision: domain.expected_revision, expected_updated_at: domain.expected_updated_at, request_quote: v.request_quote, data: { pins, domain } }
      } catch (error) { rethrowContinuation(error); issue = error instanceof Error ? error.message : 'Invalid action.' }
      const result = await opts.writer.commitBound(name, key, payload)
      if (result.status === 'unknown' && s) latest.delete(s.resource + ':' + s.key)
      if (refreshValidation && result.status === 'invalid' && (TASK_WORK_VALIDATION_CODES as readonly string[]).includes(result.validation?.code ?? '') && s) {
        const current = await refresh(s.resource, s.key)
        return current ? { ...result, current, message: result.message + ' current is the fresh target. Resolve the reported blocker; do not repeat the unchanged request or invent evidence.' }
          : { ...result, refresh_status: 'unavailable' }
      }
      if (result.status === 'saved' || result.status === 'conflict') {
        const deleted = name === 'change_work_state' && v.action === 'delete' && result.status === 'saved'
        if (deleted && s) latest.delete(s.resource + ':' + s.key)
        const target = s ?? (result.status === 'saved' && result.receipt ? { resource: v.resource as WorkResource, key: result.receipt.recordId } : null)
        // A failed readback cannot advertise the pre-write/conflicted snapshot as current.
        if (target) latest.delete(target.resource + ':' + target.key)
        const current = !deleted && target ? await refresh(target.resource, target.key) : null
        const feedback = result.status === 'saved' ? { status: 'saved', message: deleted ? 'Deleted.' : 'Saved. Read the work record again before further changes.' } : result
        return current ? { ...feedback, current, message: result.status === 'saved'
          ? 'Saved. current is the fresh work record; use current.ref for the next change.'
          : 'No change made. current is the fresh target; reconsider the intended delta using current.ref. Read other scope or source records again if they changed. Never create a replacement.' }
          : { ...feedback, ...(!deleted && opts.readSnapshot ? { refresh_status: 'unavailable' } : {}) }
      }
      return issue && result.status === 'invalid' ? { ...result, message: 'No change made. ' + issue } : result
    },
  }
}
export type WorkRecords = ReturnType<typeof createWorkRecords>
