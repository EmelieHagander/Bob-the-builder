import { fingerprint, rethrowContinuation } from './bob-job-journal.ts'
import { parseDesignIntent } from './project-design-intent.ts'
import { evaluateConcept } from './solution-concept.ts'
import { SOLUTION_PROSE, type ProjectWriter, type WritePayload, type WriteResult } from './project-write.ts'
import { humanTextRejection, proseFields, type HumanTextRejection } from './human-text.ts'
import type { ProjectSource } from '../../../src/data/provenance.ts'

const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const text = { type: 'string' }
const tool = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function' as const, function: { name, description, parameters: object(properties) } })
export const CONCEPT_EDIT_GUIDE = ' Early 2D design uses optional /design_intent/model on this same Solution, before target selection. Initialize once with {version:1,frame:{origin,x,y,z} (plain axis descriptions),nodes,components,views,constraints,unsupported:[]}. Nodes reuse CAD parameters: {id,role:decision|estimate,value,unit:mm|scalar,reason}, {id,role:unknown,unit,reason}, or {id,role:derived,operation:add_v1|subtract_v1|multiply_v1|divide_v1,operands:[id,id],rounding:exact|half_away_6}. No measured/source nodes. Components: {id,label,kind:solid|space|opening,active:true,position:[node,node,node],size:[node,node,node],features:[feature_id],choices:[choice_id]}. Views: {id,label,plane:XY|XZ|YZ,kind:projection|section,at:null|node}; include an XY projection and a profile; section at names the perpendicular coordinate. Constraints: {id,label,relation:equal|at_most,left:node,right:node,feature:null|feature_id}. View requirements use constraints {id,label,relation:view_plane,view:view_id,plane:XY|XZ|YZ,feature:null|feature_id}. Use returned concept_links. IDs are local letters/digits/underscore/hyphen, start with a letter, max 32. Subsequent changes set /design_intent/model/<nodes|components|views|constraints>/<index>/<field>, append at /-, or set frame/unsupported. Node content may be replaced at its index with the SAME id. Components deactivate via active=false; do not replace lists or identities. Unknowns/conflicts stay saved and visible. Every view derives from this model; openings are annotated volumes, not boolean cuts. Unsupported forms belong in unsupported. Saving is not construction or safety approval.'
export const PROJECT_EDIT_TOOLS = [
  tool('read_project_edit_context', 'Read complete editable project descriptions or solutions. Returns server-bound edit_ref selections and content; never construct a database identity or version. selected_solutions includes each selected scope separately. Use next_ref unchanged for the next page. Re-read after a conflict and reconsider the intended change.', {
    resource: { type: 'string', enum: ['project_description', 'selected_solutions', 'solutions'] },
    query: { type: ['string', 'null'] }, next_ref: { type: ['string', 'null'] },
  }),
  tool('edit_project_record', 'Revise the record returned by read_project_edit_context using only the requested changes. Never creates an alternative. Existing fields, measurements, image links and nested decisions are preserved. Editing a selected solution also advances that same selection atomically. Changes use content paths and JSON-encoded values. Text fields: /description, /title, /assumptions, /tradeoffs. Design fields: /design_intent/summary or /design_intent/purpose; features and choices use zero-based indices from the read. Append a feature or choice at /design_intent/features/- or /design_intent/choices/- without id (feature source_ref is server-owned). Replace individual content fields; remove a feature/choice explicitly. Identity and source-link edits are unavailable here. A null design_intent can be initialized by setting its summary (purpose defaults to concept). Changes reset alignment to draft unless /design_intent/alignment is explicitly set with an honest status and basis. A failed edit must never be replaced with a create.', {
    edit_ref: text,
    changes: { type: 'array', minItems: 1, maxItems: 40, items: object({ op: { type: 'string', enum: ['set', 'append_text', 'remove'] }, path: text, value_json: { type: ['string', 'null'], description: 'JSON-encoded new value. null only for remove. append_text appends the decoded string verbatim.' } }) },
    reason: text, request_quote: text,
  }),
]
PROJECT_EDIT_TOOLS[1].function.description += CONCEPT_EDIT_GUIDE

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
    if (!change || typeof change !== 'object' || typeof change.path !== 'string' || typeof change.value_json !== 'string') return []
    try { return proseFields(JSON.parse(change.value_json), SOLUTION_PROSE, change.path.split('/').slice(1)) } catch { return [] }
  }) : []
  return humanTextRejection([...fields, ['reason', reason]])
}
const safeText = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && v.length <= max && (empty || !!v.trim())

/** Clone the pinned read, never a newly fetched head. Paths deliberately cannot
 * address IDs, parents, versions, evidence links or arbitrary object properties. */
export async function applyProjectDelta(snapshot: EditSnapshot, changes: unknown, reason: string) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 40) throw new Error('Supply 1–40 content changes.')
  const record = structuredClone(snapshot.record)
  let explicitAlignment = false
  for (const [index, change] of changes.entries()) {
    if (!exact(change, ['op', 'path', 'value_json']) || !['set', 'append_text', 'remove'].includes(change.op) || !safeText(change.path, 160)) throw new Error('Invalid change shape.')
    const { op, path } = change
    if (op === 'remove' ? change.value_json !== null : !safeText(change.value_json, 16000, true)) throw new Error('Supply a JSON value; remove uses null.')
    const value = op === 'remove' ? undefined : JSON.parse(change.value_json)
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
  for (const [field, max] of Object.entries(snapshot.resource === 'project_description' ? { description: 12000 } : { title: 200, description: 6000, assumptions: 4000, tradeoffs: 4000 })) {
    if (!safeText(record[field], max, field !== 'title')) throw new Error('Invalid or oversized ' + field + '.')
  }
  if (record.design_intent != null) {
    if (!explicitAlignment) record.design_intent.alignment = { status: 'draft', basis: reason }
    if (!parseDesignIntent(record.design_intent)) throw new Error('Design content is inconsistent or oversized. Preserve honest decisions and uncertainty.')
  }
  return record
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
    edit_paths: { summary: '/design_intent/summary', purpose: '/design_intent/purpose', alignment: '/design_intent/alignment', append_feature: '/design_intent/features/-', append_choice: '/design_intent/choices/-' },
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
  writer?: ProjectWriter; hasAccess: () => Promise<boolean>; sources?: ProjectSource[]; unlimitedWork?: boolean }) {
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
  return {
    tools: PROJECT_EDIT_TOOLS,
    /** Prepare exactly the ordinary content delta without writing. The caller
     * may compose it with a Construction change in one database transaction. */
    prepare:async(value:unknown)=>await opts.hasAccess()?prepare(value):{status:'denied' as const},
    async readSelected(areaId: string | null): Promise<any> {
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
    },
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
      return result.status === 'saved' ? { status: 'saved', selected_updated: snapshot?.target !== null && snapshot?.resource !== 'project_description', message: 'Saved the same record. Read again before another edit.', content: displayEditSnapshot({ ...snapshot!, record: result.receipt!.record }) } : result
    },
  }
}
export type ProjectEdits = ReturnType<typeof createProjectEdits>
