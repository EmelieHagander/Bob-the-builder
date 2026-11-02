import { fingerprint, rethrowContinuation } from './bob-job-journal.ts'
import { parseDesignIntent } from './project-design-intent.ts'
import { evaluateConcept } from './solution-concept.ts'
import type { DesignReadiness } from './project-design-intent.ts'
import { constructionPurpose, constructionReadiness } from './write-state.ts'
import { SOLUTION_PROSE, type ProjectWriter, type WritePayload, type WriteResult } from './project-write.ts'
import { humanTextRejection, proseFields, type HumanTextRejection } from './human-text.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'
import { PROJECT_DESCRIPTION_MAX } from '../../../src/domain/projectDescription.ts'

const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const text = { type: 'string' }
const tool = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function' as const, function: { name, description, parameters: object(properties), strict: true } })
export const CONCEPT_EDIT_GUIDE = ' Early 2D design uses an optional concept model on this same Solution, before target selection. Start it once with set_concept_model; extend it with add_concept_node, add_concept_component, add_concept_view or add_concept_constraint; replace a node with replace_concept_node at its index, keeping the same id. No measured/source nodes. Include an XY projection and a profile view; a section names its perpendicular coordinate in at. Components and constraints link features and choices through the returned concept_links. Change single fields at /design_intent/model/<nodes|components|views|constraints>/<index>/<field>, or set /design_intent/model/frame or /design_intent/model/unsupported. Components deactivate via active=false; do not replace lists or identities. Unknowns/conflicts stay saved and visible. Every view derives from this model; openings are annotated volumes, not boolean cuts. Unsupported forms belong in unsupported. Saving is not construction or safety approval.'
// New design features and choices have fixed, typed shapes. They are their own
// change operations so a strict tool schema decides the shape before the call,
// instead of a guessed value_json that the server can only reject afterwards
// (2026-11-02: ten rejected feature saves in Ladan).
export const DESIGN_FEATURE_ITEM = object({
  description: { type: 'string' },
  basis: { type: 'string', enum: ['user_request', 'project_record', 'working_assumption'] },
})
export const DESIGN_CHOICE_ITEM = object({
  question: { type: 'string' },
  alternatives: { type: 'array', maxItems: 4, items: { type: 'string' } },
  recommendation: { type: 'string' },
  basis: { type: 'string' },
  consequences: { type: 'string' },
  geometry_dependency: { type: 'boolean' },
  status: { type: 'string', enum: ['open', 'resolved', 'deferred'] },
  selected_direction: { type: ['string', 'null'], description: 'The chosen alternative when resolved; otherwise null.' },
  decision_authority: { type: 'string', enum: ['owner', 'bob'] },
  decision_basis: { type: 'string' },
  deferral: { anyOf: [object({ scope: { type: 'string', enum: ['illustration', 'concept'] }, reason: { type: 'string' } }), { type: 'null' }], description: 'Only when deferred; otherwise null.' },
})
const conceptId = { type: 'string', description: 'Local id: letters, digits, underscore or hyphen, starting with a letter, max 32.' }
const conceptUnit = { type: 'string', enum: ['mm', 'scalar'] }
const plane = { type: 'string', enum: ['XY', 'XZ', 'YZ'] }
const nullableText = { type: ['string', 'null'] }
export const CONCEPT_NODE_ITEM = { anyOf: [
  object({ id: conceptId, role: { type: 'string', enum: ['decision', 'estimate'] }, value: { type: 'number' }, unit: conceptUnit, reason: text }),
  object({ id: conceptId, role: { type: 'string', enum: ['unknown'] }, unit: conceptUnit, reason: text }),
  object({ id: conceptId, role: { type: 'string', enum: ['derived'] }, operation: { type: 'string', enum: ['add_v1', 'subtract_v1', 'multiply_v1', 'divide_v1'] }, operands: { type: 'array', minItems: 2, maxItems: 2, items: text }, rounding: { type: 'string', enum: ['exact', 'half_away_6'] } }),
] }
const nodeTriple = { type: 'array', minItems: 3, maxItems: 3, items: text, description: 'Node ids for x, y and z.' }
export const CONCEPT_COMPONENT_ITEM = object({ id: conceptId, label: text, kind: { type: 'string', enum: ['solid', 'space', 'opening'] }, active: { type: 'boolean' }, position: nodeTriple, size: nodeTriple, features: { type: 'array', items: text, description: 'Feature ids from concept_links.' }, choices: { type: 'array', items: text, description: 'Choice ids from concept_links.' } })
export const CONCEPT_VIEW_ITEM = object({ id: conceptId, label: text, plane, kind: { type: 'string', enum: ['projection', 'section'] }, at: { ...nullableText, description: 'Node id of the perpendicular coordinate for a section; null for a projection.' } })
export const CONCEPT_CONSTRAINT_ITEM = { anyOf: [
  object({ id: conceptId, label: text, relation: { type: 'string', enum: ['equal', 'at_most'] }, left: text, right: text, feature: nullableText }),
  object({ id: conceptId, label: text, relation: { type: 'string', enum: ['view_plane'] }, view: text, plane, feature: nullableText }),
] }
export const CONCEPT_MODEL_ITEM = object({
  version: { type: 'integer', enum: [1] },
  frame: object({ origin: text, x: text, y: text, z: text }),
  nodes: { type: 'array', minItems: 1, maxItems: 64, items: CONCEPT_NODE_ITEM },
  components: { type: 'array', minItems: 1, maxItems: 48, items: CONCEPT_COMPONENT_ITEM },
  views: { type: 'array', minItems: 2, maxItems: 6, items: CONCEPT_VIEW_ITEM },
  constraints: { type: 'array', maxItems: 24, items: CONCEPT_CONSTRAINT_ITEM },
  unsupported: { type: 'array', maxItems: 12, items: text },
})
export const CONTENT_CHANGE_ITEM = { anyOf: [
  object({ op: { type: 'string', enum: ['set', 'append_text', 'remove'] }, path: text, value_json: { type: ['string', 'null'], description: 'JSON-encoded new value. null only for remove. append_text appends the decoded string verbatim.' } }),
  object({ op: { type: 'string', enum: ['add_feature'] }, feature: DESIGN_FEATURE_ITEM }),
  object({ op: { type: 'string', enum: ['add_choice'] }, choice: DESIGN_CHOICE_ITEM }),
  object({ op: { type: 'string', enum: ['set_concept_model'] }, model: CONCEPT_MODEL_ITEM }),
  object({ op: { type: 'string', enum: ['add_concept_node'] }, node: CONCEPT_NODE_ITEM }),
  object({ op: { type: 'string', enum: ['replace_concept_node'] }, index: { type: 'integer' }, node: CONCEPT_NODE_ITEM }),
  object({ op: { type: 'string', enum: ['add_concept_component'] }, component: CONCEPT_COMPONENT_ITEM }),
  object({ op: { type: 'string', enum: ['add_concept_view'] }, view: CONCEPT_VIEW_ITEM }),
  object({ op: { type: 'string', enum: ['add_concept_constraint'] }, constraint: CONCEPT_CONSTRAINT_ITEM }),
] }
export const PROJECT_EDIT_TOOLS = [
  tool('read_project_edit_context', 'Read complete editable project descriptions or solutions. Returns server-bound edit_ref selections and content; never construct a database identity or version. selected_solutions includes each selected scope separately. Use next_ref unchanged for the next page. Re-read after a conflict and reconsider the intended change.', {
    resource: { type: 'string', enum: ['project_description', 'selected_solutions', 'solutions'] },
    query: { type: ['string', 'null'] }, next_ref: { type: ['string', 'null'] },
  }),
  tool('edit_project_record', 'Revise the record returned by read_project_edit_context using only the requested changes. Never creates an alternative. Existing fields, measurements, image links and nested decisions are preserved. Editing a selected solution also advances that same selection atomically. Changes use content paths and JSON-encoded values. Text fields: /description, /title, /assumptions, /tradeoffs. The project description tells what is being built, for whom and why, its character and where the project stands in its current phase; it holds no measurements, which live in measurements and the selected solution. Rewrite it when the project moves to a new phase. Design fields: /design_intent/summary or /design_intent/purpose; features and choices use zero-based indices from the read. Add a new feature or choice with op add_feature or add_choice; the server assigns its identity and source link. Replace individual content fields; remove a feature/choice explicitly. Identity and source-link edits are unavailable here. A null design_intent can be initialized by setting its summary (purpose defaults to concept). Changes reset alignment to draft unless /design_intent/alignment is explicitly set with an honest status and basis. A failed edit must never be replaced with a create.', {
    edit_ref: text,
    changes: { type: 'array', minItems: 1, maxItems: 40, items: CONTENT_CHANGE_ITEM },
    reason: text, request_quote: text,
  }),
]
/** Published with write_state_version 1 (2026-10-29); older manifests keep their own text. */
export const WRITE_STATE_EDIT_NOTE = ' Saving a selected solution returns a fresh edit_ref for the saved revision and, for purpose=construction, construction_readiness; reuse them instead of reading again.'
PROJECT_EDIT_TOOLS[1].function.description += CONCEPT_EDIT_GUIDE + WRITE_STATE_EDIT_NOTE

type Resource = 'project_description' | 'selected_solutions' | 'solutions'
export type EditSnapshot = {
  project_id: string; key: string; resource: Resource; scope_label: string;
  record: Record<string, any>;
  measurements: { id: string; revision: number }[];
  measurement_evidence?: Record<string, unknown>[];
  head_revision?: number;
  target: { area_id: string | null; revision: number; solution_id: string; solution_revision: number } | null;
}
type ReadTransport = (input: { resource: Resource; query: string | null; after: string | null }) => PromiseLike<{ data: unknown; error: unknown }>
export type ProjectEditsState = {
  version: 1; projectId: string; reads: number; partial: boolean;
  contexts: [string, EditSnapshot][];
  pages: [string, { resource: Resource; query: string | null; after: string }][];
  sources: ProjectSource[];
}
const exact = (v: unknown, keys: string[]): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const fail = (message: string): WriteResult => ({ status: 'invalid', message: 'No change made. ' + message })

/** Prose this call supplies through content changes (decoded value_json at its
 * path), plus the saved reason. Unchanged saved text is never re-checked. */
export function changeProseRejection(changes: unknown, reason: unknown): HumanTextRejection | null {
  const fields: [string, unknown][] = Array.isArray(changes) ? changes.flatMap(change => {
    try { const { path, value } = readChange(change); return value === undefined ? [] : proseFields(value, SOLUTION_PROSE, path.split('/').slice(1)) } catch { return [] }
  }) : []
  return humanTextRejection([...fields, ['reason', reason]])
}
const safeText = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && v.length <= max && (empty || !!v.trim())

type ContentChange = { op: 'set' | 'append_text' | 'remove'; path: string; value: any }
/** One supplied change in the internal path form. Typed add operations are the
 * only way to append a design feature or choice. */
function readChange(change: any): ContentChange {
  const typed = TYPED_CHANGES[change?.op as keyof typeof TYPED_CHANGES]
  if (typed) {
    const keys = typed.index ? ['op', 'index', typed.field] : ['op', typed.field]
    if (!exact(change, keys) || typed.index && (!Number.isSafeInteger(change.index) || change.index < 0)) throw new Error('Invalid change shape.')
    return { op: 'set', path: typed.path + (typed.index ? change.index : ''), value: change[typed.field] }
  }
  if (!exact(change, ['op', 'path', 'value_json']) || !['set', 'append_text', 'remove'].includes(change.op) || !safeText(change.path, 160)) throw new Error('Invalid change shape.')
  if (change.op === 'remove' ? change.value_json !== null : !safeText(change.value_json, 16000, true)) throw new Error('Supply a JSON value; remove uses null.')
  if (/^\/design_intent\/(features|choices)\/-$/.test(change.path)) throw new Error('Add a new design feature or choice with op add_feature or add_choice.')
  if (/^\/design_intent\/model(\/(nodes|components|views|constraints)\/-|\/nodes\/[0-9]+)?$/.test(change.path) && change.op === 'set') throw new Error('Start, extend or replace concept model items with their typed op (set_concept_model, add_concept_*, replace_concept_node).')
  return { op: change.op, path: change.path, value: change.op === 'remove' ? undefined : JSON.parse(change.value_json) }
}
const TYPED_CHANGES = {
  add_feature: { field: 'feature', path: '/design_intent/features/-' },
  add_choice: { field: 'choice', path: '/design_intent/choices/-' },
  set_concept_model: { field: 'model', path: '/design_intent/model' },
  add_concept_node: { field: 'node', path: '/design_intent/model/nodes/-' },
  add_concept_component: { field: 'component', path: '/design_intent/model/components/-' },
  add_concept_view: { field: 'view', path: '/design_intent/model/views/-' },
  add_concept_constraint: { field: 'constraint', path: '/design_intent/model/constraints/-' },
  replace_concept_node: { field: 'node', path: '/design_intent/model/nodes/', index: true },
} as const satisfies Record<string, { field: string; path: string; index?: true }>

/** Clone the pinned read, never a newly fetched head. Paths deliberately cannot
 * address IDs, parents, versions, evidence links or arbitrary object properties. */
export async function applyProjectDelta(snapshot: EditSnapshot, changes: unknown, reason: string) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 40) throw new Error('Supply 1–40 content changes.')
  const record = structuredClone(snapshot.record)
  let explicitAlignment = false
  for (const [index, change] of changes.entries()) {
    const { op, path, value } = readChange(change)
    const fields = path.split('/').slice(1)
    if (!path.startsWith('/') || fields.some((f: string) => ['__proto__', 'constructor', 'prototype'].includes(f))) throw new Error('Unsupported content path.')
    const plain = snapshot.resource === 'project_description' ? ['description'] : ['title', 'description', 'assumptions', 'tradeoffs']
    let parent: any = record, key: string | number = fields[0]
    if (fields.length === 1 && plain.includes(fields[0])) {
      if (op === 'remove') throw new Error('Clear a text field explicitly with an empty string.')
    } else {
      if (snapshot.resource === 'project_description' || fields[0] !== 'design_intent') throw new Error('Unsupported content path.')
      if (record.design_intent === null && path === '/design_intent/summary' && op === 'set') record.design_intent = { version: 1, purpose: 'concept', summary: value, references: [], features: [], choices: [], alignment: { status: 'draft', basis: reason } }
      const intent = record.design_intent
      if (!intent) throw new Error('Initialize the design summary before changing design details.')
      if (fields[1] === 'model') {
        if (op !== 'set') throw new Error('Concept changes use set; deactivate components explicitly.')
        if (fields.length === 2) {
          if (intent.model !== undefined) throw new Error('Revise named concept fields; do not replace the model.')
          intent.model = value
        } else {
          const model = intent.model
          if (!model) throw new Error('Initialize the concept model first.')
          if (fields.length === 3 && ['frame', 'unsupported'].includes(fields[2])) model[fields[2]] = value
          else {
            if (!['nodes', 'components', 'views', 'constraints'].includes(fields[2])) throw new Error('Unsupported concept path.')
            const list = model[fields[2]]
            if (fields.length === 4 && fields[3] === '-') {
              if (!value || typeof value !== 'object' || list.some((item: any) => item.id === value.id)) throw new Error('A new concept item needs a new identity.')
              list.push(value)
            } else {
              if (!/^(0|[1-9][0-9]*)$/.test(fields[3]) || !list[Number(fields[3])]) throw new Error('Use an index from the saved concept read.')
              const item = list[Number(fields[3])]
              if (fields.length === 4 && fields[2] === 'nodes' && value?.id === item.id) list[Number(fields[3])] = value
              else if (fields.length === 5 && fields[4] !== 'id' && Object.hasOwn(item, fields[4])) item[fields[4]] = value
              else throw new Error('Concept identities and whole components cannot be replaced.')
            }
          }
        }
        continue
      }
      if (fields.length === 2 && ['summary', 'purpose', 'alignment'].includes(fields[1])) {
        parent = intent; key = fields[1]
        if (op === 'remove') throw new Error('Required design fields cannot be removed.')
        if (key === 'alignment') { if (op !== 'set') throw new Error('Set alignment explicitly.'); explicitAlignment = true }
      } else {
        if (!['features', 'choices'].includes(fields[1]) || ![3, 4].includes(fields.length)) throw new Error('Unsupported design content path.')
        const list = intent[fields[1]]
        if (fields[2] === '-' && fields.length === 3 && op === 'set') {
          if (!value || typeof value !== 'object' || Array.isArray(value) || 'id' in value || 'source_ref' in value) throw new Error('New design items contain content only; identity and source links are server-owned.')
          const shape = fields[1] === 'features' ? DESIGN_FEATURE_SHAPE : DESIGN_CHOICE_SHAPE
          const keys = Object.keys(value)
          if (keys.length !== shape.fields.length || !shape.fields.every((field) => keys.includes(field))) throw new Error(shape.message)
          const id = 'edit_' + (await fingerprint({ snapshot, changes, index })).slice(0, 24)
          list.push({ ...value, id, ...(fields[1] === 'features' ? { source_ref: null } : {}) }); continue
        }
        if (!/^(0|[1-9][0-9]*)$/.test(fields[2]) || Number(fields[2]) >= list.length) throw new Error('Use an item index from this edit context.')
        const position = Number(fields[2])
        if (fields.length === 3) {
          if (op !== 'remove') throw new Error('Change individual item fields, or remove the item explicitly.')
          list.splice(position, 1); continue
        }
        const allowed = fields[1] === 'features' ? ['description', 'basis'] : ['question', 'alternatives', 'recommendation', 'basis', 'consequences', 'geometry_dependency', 'status', 'selected_direction', 'decision_authority', 'decision_basis', 'deferral']
        if (!allowed.includes(fields[3]) || op === 'remove') throw new Error('Unsupported item field.')
        parent = list[position]; key = fields[3]
      }
    }
    if (op === 'append_text') {
      if (typeof parent[key] !== 'string' || typeof value !== 'string') throw new Error('append_text requires text.')
      parent[key] += value
    } else parent[key] = value
  }
  for (const [field, max] of Object.entries(snapshot.resource === 'project_description' ? { description: PROJECT_DESCRIPTION_MAX } : { title: 200, description: 6000, assumptions: 4000, tradeoffs: 4000 })) {
    if (!safeText(record[field], max, field !== 'title')) throw new Error('Invalid or oversized ' + field + '.')
  }
  if (record.design_intent != null) {
    if (!explicitAlignment) record.design_intent.alignment = { status: 'draft', basis: reason }
    if (!parseDesignIntent(record.design_intent)) throw new Error('Design content is inconsistent or oversized. Preserve honest decisions and uncertainty.')
  }
  return record
}

// The item shape is stated in the rejection itself so Bob can correct a guessed
// shape in one retry (2026-11-02: ten rejected feature saves in Ladan sent
// title+description and only learned "inconsistent").
const DESIGN_FEATURE_SHAPE = {
  fields: ['description', 'basis'],
  message: 'A new design feature has exactly description (text) and basis (user_request, project_record or working_assumption).',
}
const DESIGN_CHOICE_SHAPE = {
  fields: ['question', 'alternatives', 'recommendation', 'basis', 'consequences', 'geometry_dependency', 'status', 'selected_direction', 'decision_authority', 'decision_basis', 'deferral'],
  message: 'A new design choice has exactly question, alternatives (text list), recommendation, basis, consequences, geometry_dependency (boolean), status (open, resolved or deferred), selected_direction (text when resolved, otherwise null), decision_authority (owner or bob), decision_basis and deferral ({scope, reason} when deferred, otherwise null).',
}

export function displayEditSnapshot(snapshot: EditSnapshot) {
  const r = snapshot.record
  const intent = r.design_intent ? structuredClone(r.design_intent) : null
  if (intent) {
    intent.features = intent.features.map(({ id: _id, source_ref, ...content }: any) => ({ ...content, has_source_reference: source_ref !== null }))
    intent.choices = intent.choices.map(({ id: _id, ...content }: any) => content)
    intent.references = intent.references.map(({ image_id: _id, ...content }: any) => content)
  }
  return snapshot.resource === 'project_description' ? { description: r.description } : {
    edit_paths: { summary: '/design_intent/summary', purpose: '/design_intent/purpose', alignment: '/design_intent/alignment' },
    title: r.title, description: r.description, assumptions: r.assumptions, tradeoffs: r.tradeoffs, design_intent: intent,
    preserved_sources: { measurements: snapshot.measurements.length, source_image: !!r.source_media_id },
    measurements: snapshot.measurement_evidence ?? [],
    ...(r.design_intent?.model ? { concept_check: { issues: evaluateConcept(r.design_intent).issues, views: r.design_intent.model.views } } : {}),
    ...(r.design_intent ? { concept_links: { features: r.design_intent.features.map((f: any) => ({ id: f.id, description: f.description })), choices: r.design_intent.choices.map((c: any) => ({ id: c.id, question: c.question })) } } : {}),
  }
}

export function createProjectEdits(opts: { projectId: string; read: ReadTransport;
  /** Exact selected scope, using the same caller-bound snapshot contract. */
  readSelected?: (areaId: string | null) => PromiseLike<{ data: unknown; error: unknown }>;
  writer?: ProjectWriter; hasAccess: () => Promise<boolean>; sources?: ProjectSource[]; unlimitedWork?: boolean;
  /** Pinned per manifest (write_state_version 1): a saved selected solution
   * returns its fresh edit entry and, for purpose=construction, its readiness. */
  writeState?: { readiness?: (targetRevision: number, areaId: string | null) => Promise<DesignReadiness> } }) {
  const contexts = new Map<string, EditSnapshot>()
  const pages = new Map<string, { resource: Resource; query: string | null; after: string }>()
  let reads = 0
  let partial = false
  const unavailable = () => { partial = true; return { status: 'unavailable' } }
  const remember = async (snapshot: EditSnapshot) => {
    if (snapshot.project_id !== opts.projectId || !snapshot.record || !Array.isArray(snapshot.measurements)
      || !safeText(snapshot.key, 250) || !safeText(snapshot.record.id, 200)
      || (snapshot.resource === 'project_description' ? !safeText(snapshot.record.updated_at, 60) : !Number.isSafeInteger(snapshot.record.revision))) throw Error('invalid_edit_snapshot')
    const ref = 'edit_' + await fingerprint(snapshot)
    contexts.set(ref, structuredClone(snapshot))
    const dataset = snapshot.resource === 'project_description' ? 'project' : 'solutions'
    if (opts.sources && !opts.sources.some(s => s.dataset === dataset && s.recordId === snapshot.record.id)) opts.sources.push({ projectId: opts.projectId, dataset, recordId: snapshot.record.id, label: snapshot.record.title ?? snapshot.scope_label, retrievedAt: new Date().toISOString(), updatedAt: snapshot.record.updated_at ?? snapshot.record.recorded_at ?? null, truth: 'unknown' })
    return { edit_ref: ref, scope: snapshot.scope_label, selected: snapshot.target !== null, selected_version_is_current: snapshot.target === null || snapshot.head_revision === undefined || snapshot.head_revision === snapshot.record.revision, content: displayEditSnapshot(snapshot) }
  }
  const prepare = async (value: unknown): Promise<{ status: 'ready'; payload: WritePayload; snapshot: EditSnapshot } | WriteResult> => {
    const v = value as Record<string, any>
    const snapshot = v && typeof v.edit_ref === 'string' ? contexts.get(v.edit_ref) : undefined
    try {
      if (!exact(v, ['edit_ref', 'changes', 'reason', 'request_quote']) || !snapshot || !safeText(v.reason, 1000)) throw new Error('Read and choose a server-issued edit_ref, then supply changes and a reason.')
      const humanText = changeProseRejection(v.changes, v.reason)
      if (humanText) return { ...fail(humanText.message), validation: { code: 'human_text', fields: humanText.fields } }
      if (snapshot.target && snapshot.head_revision !== undefined && snapshot.head_revision !== snapshot.record.revision) throw new Error('The selected version is older than this solution’s latest version. Read the alternatives and reconcile the selected direction explicitly before editing; do not overwrite newer work.')
      const record = await applyProjectDelta(snapshot, v.changes, v.reason)
      const payload: WritePayload = snapshot.resource === 'project_description'
        ? { kind: 'bound_project', record_id: opts.projectId, expected_updated_at: snapshot.record.updated_at, expected_revision: null, request_quote: v.request_quote, data: { description: record.description } }
        : { kind: 'bound_solution', record_id: snapshot.record.id, expected_updated_at: null, expected_revision: snapshot.record.revision, request_quote: v.request_quote,
            data: { target: snapshot.target, solution: { title: record.title, description: record.description, assumptions: record.assumptions, tradeoffs: record.tradeoffs, source_media_id: record.source_media_id, design_intent: record.design_intent, measurements: snapshot.measurements, change_note: v.reason } } }
      return { status: 'ready', payload, snapshot: structuredClone(snapshot) }
    } catch (error) { rethrowContinuation(error); return fail(error instanceof Error ? error.message : 'Invalid content changes.') }
  }
  async function readSelected(areaId: string | null): Promise<any> {
    if (!await opts.hasAccess()) return { status: 'denied' }
    if (!opts.readSelected) return unavailable()
    if (!opts.unlimitedWork && reads >= 16) return { status: 'budget_exhausted' }
    reads++
    try {
      const { data, error } = await opts.readSelected(areaId)
      if (!await opts.hasAccess()) return { status: 'denied' }
      if (error || !Array.isArray(data) || data.length > 1 || JSON.stringify(data).length > 240000) return unavailable()
      if (!data.length) return { status: 'empty' }
      const snapshot = data[0] as EditSnapshot
      if (snapshot.resource !== 'selected_solutions' || !snapshot.target
        || snapshot.target.area_id !== areaId || snapshot.target.solution_id !== snapshot.record?.id
        || snapshot.target.solution_revision !== snapshot.record?.revision) return unavailable()
      return { status: 'ok', entry: await remember(snapshot), target: structuredClone(snapshot.target) }
    } catch (error) { rethrowContinuation(error); return unavailable() }
  }
  return {
    tools: PROJECT_EDIT_TOOLS,
    /** Prepare exactly the ordinary content delta without writing. The caller
     * may compose it with a Construction change in one database transaction. */
    prepare:async(value:unknown)=>await opts.hasAccess()?prepare(value):{status:'denied' as const},
    readSelected,
    exportState(): ProjectEditsState {
      return JSON.parse(JSON.stringify({ version: 1, projectId: opts.projectId, reads, partial, contexts: [...contexts], pages: [...pages], sources: opts.sources ?? [] }))
    },
    restoreState(state: ProjectEditsState) {
      if (!state || state.version !== 1 || state.projectId !== opts.projectId || !Number.isSafeInteger(state.reads) || state.reads < 0 || typeof state.partial !== 'boolean'
        || !Array.isArray(state.contexts) || !Array.isArray(state.pages) || !Array.isArray(state.sources)
        || state.contexts.some(entry => !Array.isArray(entry) || typeof entry[0] !== 'string' || entry[1]?.project_id !== opts.projectId)
        || state.sources.some(source => source?.projectId !== opts.projectId)) throw new Error('invalid_project_edits_state')
      const saved = structuredClone(state)
      contexts.clear(); for (const [key, value] of saved.contexts) contexts.set(key, value)
      pages.clear(); for (const [key, value] of saved.pages) pages.set(key, value)
      opts.sources?.splice(0, opts.sources.length, ...saved.sources)
      reads = saved.reads; partial = saved.partial
    },
    get partial() { return partial },
    get remaining() { return opts.unlimitedWork ? Infinity : Math.max(0, 16 - reads) },
    async execute(name: string, value: unknown): Promise<any> {
      if (!await opts.hasAccess()) return { status: 'denied' }
      if (name === 'read_project_edit_context') {
        if (!exact(value, ['resource', 'query', 'next_ref']) || !['project_description', 'selected_solutions', 'solutions'].includes(value.resource)
          || !(value.query === null || safeText(value.query, 200)) || !(value.next_ref === null || typeof value.next_ref === 'string')) return fail('Invalid read selection.')
        if (!opts.unlimitedWork && reads >= 16) return { status: 'budget_exhausted' }
        const input = value.next_ref === null ? { resource: value.resource as Resource, query: value.query, after: null } : pages.get(value.next_ref)
        if (!input || input.resource !== value.resource || input.query !== value.query) return fail('Use the exact next_ref and filter returned by this read.')
        reads++
        try {
          const { data, error } = await opts.read(input)
          if (error || !Array.isArray(data) || data.length > 3 || JSON.stringify(data).length > 240000) return unavailable()
          const entries = []
          for (const snapshot of data.slice(0, 2) as EditSnapshot[]) {
            if (snapshot.resource !== input.resource) return unavailable()
            entries.push(await remember(snapshot))
          }
          let next_ref: string | null = null
          if (data.length > 2) {
            const cursor = { ...input, after: data[1].key }
            next_ref = 'page_' + await fingerprint({ project: opts.projectId, ...cursor }); pages.set(next_ref, cursor)
          }
          return { status: 'ok', entries, next_ref }
        } catch (error) { rethrowContinuation(error); return unavailable() }
      }
      if (name !== 'edit_project_record' || !opts.writer) return { status: 'denied' }
      const v = value as Record<string, any>
      const snapshot = v && typeof v.edit_ref === 'string' ? contexts.get(v.edit_ref) : undefined
      const key = snapshot ? snapshot.resource + ':' + snapshot.key : 'unbound'
      const prepared = await prepare(value)
      if (prepared.status === 'denied') return prepared
      const result = await opts.writer.commitBound('edit_project_record', key, prepared.status === 'ready' ? prepared.payload : null)
      if (prepared.status !== 'ready' && result.status === 'invalid') return prepared
      // The canonical receipt stays in the writer for delivery/recovery. The
      // model gets content and outcome, never a new set of IDs to transcribe.
      if (result.status === 'saved' && opts.writeState && snapshot?.target && snapshot.resource !== 'project_description' && result.receipt) {
        // The exact selected snapshot is read back through the ordinary reader,
        // so a further edit binds the saved revision without a model round.
        const selected = await readSelected(snapshot.target.area_id)
        const fresh = selected.status === 'ok' && selected.target.solution_id === result.receipt.recordId && selected.target.solution_revision === result.receipt.revision ? selected : null
        const readiness = constructionPurpose(result.receipt.record) ? await constructionReadiness(opts.writeState.readiness, opts.projectId,
          fresh ? { ...fresh.target } : { revision: NaN, area_id: snapshot.target.area_id }) : null
        return { status: 'saved', selected_updated: true,
          message: fresh ? 'Saved the same record. Use the returned edit_ref for another change.' : 'Saved the same record. Read again before another edit.',
          content: fresh ? fresh.entry.content : displayEditSnapshot({ ...snapshot, record: result.receipt.record }),
          ...(fresh ? { edit_ref: fresh.entry.edit_ref } : {}),
          ...(readiness ? { construction_readiness: readiness, ...(typeof readiness.creation_state === 'string' ? { creation_state: readiness.creation_state } : {}) } : {}) }
      }
      return result.status === 'saved' ? { status: 'saved', selected_updated: snapshot?.target !== null && snapshot?.resource !== 'project_description', message: 'Saved the same record. Read again before another edit.', content: displayEditSnapshot({ ...snapshot!, record: result.receipt!.record }) } : result
    },
  }
}
export type ProjectEdits = ReturnType<typeof createProjectEdits>
