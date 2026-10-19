import { fingerprint, rethrowContinuation } from './bob-job-journal.ts'
import { parseProjectWrite, type ProjectWriter, type WritePayload } from './project-write.ts'

const text = { type: 'string' }, nullable = { type: ['string', 'null'] }
const tool = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function' as const, function: { name, description, parameters: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } })
export const PLAN_LINK_TOOLS = [
  tool('read_plan_link_context', 'Read current plan focus, Steps or Tasks for organising existing work. Choose returned refs; identities, revisions and unchanged links stay on the server. next_ref continues the same filter. An absent approved plan needs a plan proposal and authorised decision first. This read does not approve a proposal or certify work.', { resource: { type: 'string', enum: ['plan', 'steps', 'tasks'] }, query: nullable, next_ref: nullable }),
  tool('change_plan_focus', 'Set Bob focus to a Step ref from read_plan_link_context, or explicitly clear focus using its plan ref. Does not change parallel Step states, completion, plan approval or Tasks. Read again after saving.', { ref: text, action: { type: 'string', enum: ['set', 'clear'] }, reason: text, request_quote: text }),
  tool('change_plan_task_link', 'Organise an existing Task and Step read through read_plan_link_context. link assigns an unowned Task or adds a reference; move changes primary ownership; unlink removes only this association. Preserve task content, status, people and other links. This does not create Tasks, approve a plan or complete work. Read again after saving.', { step_ref: text, task_ref: text, action: { type: 'string', enum: ['link', 'move', 'unlink'] }, reason: text, request_quote: text }),
]
export const SUPERSEDED_PLAN_LINK_TOOLS = ['set_project_plan_focus', 'link_project_plan_task']
export type PlanLinkResource = 'plan' | 'steps' | 'tasks'
export type PlanLinkSnapshot = { project_id: string; resource: PlanLinkResource; key: string; scope_label: string; head: Record<string, any>; record: Record<string, any>; links: Record<string, any>[] }
export type PlanLinksState = {
  version: 1; projectId: string; reads: number; partial: boolean;
  snapshots: [string, PlanLinkSnapshot][];
  pages: [string, { resource: PlanLinkResource; query: string | null; after: string }][];
}
const exact = (v: unknown, keys: string[]): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const nonempty = (v: unknown, max = 1000): v is string => typeof v === 'string' && !!v.trim() && v.length <= max
const pick = (r: Record<string, any>, keys: string[]) => Object.fromEntries(keys.map(k => [k, r[k]]))
function display(s: PlanLinkSnapshot) {
  return { ...pick(s.record, s.resource === 'plan' ? ['summary', 'focus_title'] : s.resource === 'steps' ? ['title', 'goal', 'state', 'notes', 'phase', 'area_name'] : ['name', 'instructions', 'status', 'area_name', 'primary_step_title']),
    ...(s.resource === 'steps' ? { is_focus: s.head.focus_step_id === s.key } : {}),
    links: s.links.map(l => pick(l, ['step_title', 'task_name', 'primary'])) }
}
export function createPlanLinks(opts: {
  projectId: string; writer?: ProjectWriter; hasAccess: () => Promise<boolean>; unlimitedWork?: boolean;
  read: (input: { resource: PlanLinkResource; query: string | null; after: string | null }) => PromiseLike<{ data: unknown; error: unknown }>;
}) {
  const snapshots = new Map<string, PlanLinkSnapshot>(), pages = new Map<string, { resource: PlanLinkResource; query: string | null; after: string }>()
  let reads = 0, partial = false
  const unavailable = () => { partial = true; return { status: 'unavailable' } }
  return {
    tools: PLAN_LINK_TOOLS, get remaining() { return opts.unlimitedWork ? Infinity : Math.max(0, 24 - reads) }, get partial() { return partial },
    exportState(): PlanLinksState {
      return JSON.parse(JSON.stringify({ version: 1, projectId: opts.projectId, reads, partial, snapshots: [...snapshots], pages: [...pages] }))
    },
    restoreState(state: PlanLinksState) {
      if (!state || state.version !== 1 || state.projectId !== opts.projectId || !Number.isSafeInteger(state.reads) || state.reads < 0 || typeof state.partial !== 'boolean'
        || !Array.isArray(state.snapshots) || !Array.isArray(state.pages)
        || state.snapshots.some(entry => !Array.isArray(entry) || typeof entry[0] !== 'string' || entry[1]?.project_id !== opts.projectId)) throw new Error('invalid_plan_links_state')
      const saved = structuredClone(state)
      snapshots.clear(); for (const [key, value] of saved.snapshots) snapshots.set(key, value)
      pages.clear(); for (const [key, value] of saved.pages) pages.set(key, value)
      reads = saved.reads; partial = saved.partial
    },
    async execute(name: string, value: unknown): Promise<any> {
      if (!await opts.hasAccess()) return { status: 'denied' }
      if (name === 'read_plan_link_context') {
        if (!exact(value, ['resource', 'query', 'next_ref']) || !['plan', 'steps', 'tasks'].includes(value.resource) || !(value.query === null || nonempty(value.query, 200)) || !(value.next_ref === null || nonempty(value.next_ref, 200))) return { status: 'invalid' }
        if (!opts.unlimitedWork && reads >= 24) return { status: 'budget_exhausted' }
        const input = value.next_ref === null ? { resource: value.resource as PlanLinkResource, query: value.query, after: null } : pages.get(value.next_ref)
        if (!input || input.resource !== value.resource || input.query !== value.query) return { status: 'invalid' }
        reads++
        try {
          const { data, error } = await opts.read(input)
          if (error || !Array.isArray(data) || data.length > 3 || JSON.stringify(data).length > 240000) return unavailable()
          const entries = []
          for (const s of data.slice(0, 2) as PlanLinkSnapshot[]) {
            if (s.project_id !== opts.projectId || s.resource !== input.resource || !s.record || !s.head || !Array.isArray(s.links) || s.key !== s.record.id || !nonempty(s.key, 200) || !Number.isSafeInteger(s.head.current_revision)) return unavailable()
            const ref = 'plan_link_' + await fingerprint(s)
            snapshots.set(ref, structuredClone(s)); entries.push({ ref, scope: s.scope_label, content: display(s) })
          }
          let next_ref: string | null = null
          if (data.length > 2) { const cursor = { ...input, after: data[1].key }; next_ref = 'page_' + await fingerprint({ project: opts.projectId, ...cursor }); pages.set(next_ref, cursor) }
          return { status: 'ok', entries, next_ref }
        } catch (e) { rethrowContinuation(e); return unavailable() }
      }
      if (!opts.writer || !PLAN_LINK_TOOLS.some(t => t.function.name === name)) return { status: 'denied' }
      const v = value as Record<string, any>, target = snapshots.get(v?.ref ?? v?.step_ref), task = snapshots.get(v?.task_ref)
      let payload: WritePayload | null = null, issue = ''
      try {
        if (!target || !nonempty(v.reason) || !nonempty(v.request_quote, 500)) throw Error('Read and choose the intended current plan record.')
        let domain: WritePayload | null = null
        const pins = [target]
        if (name === 'change_plan_focus') {
          if (!exact(v, ['ref', 'action', 'reason', 'request_quote']) || !(v.action === 'set' && target.resource === 'steps' || v.action === 'clear' && target.resource === 'plan')) throw Error('Set focus using a Step ref, or clear using the plan ref.')
          domain = parseProjectWrite('set_project_plan_focus', { plan_revision: target.head.current_revision, step_id: v.action === 'clear' ? null : target.key, request_quote: v.request_quote }, opts.projectId, v.request_quote)
        } else {
          if (!exact(v, ['step_ref', 'task_ref', 'action', 'reason', 'request_quote']) || target.resource !== 'steps' || task?.resource !== 'tasks' || !['link', 'move', 'unlink'].includes(v.action)) throw Error('Read both the Step and Task and choose link, move or unlink.')
          pins.push(task)
          domain = parseProjectWrite('link_project_plan_task', { plan_revision: target.head.current_revision, step_id: target.key, task_id: task.key, action: v.action, request_quote: v.request_quote }, opts.projectId, v.request_quote)
        }
        if (!domain) throw Error('The requested plan action is invalid.')
        payload = { ...domain, kind: 'bound_plan_link', data: { pins, domain } }
      } catch (e) { rethrowContinuation(e); issue = e instanceof Error ? e.message : 'Invalid action.' }
      const key = target ? target.resource + ':' + target.key + ':' + (task?.key ?? '') : 'unbound'
      const result = await opts.writer.commitBound(name, key, payload)
      return result.status === 'saved' ? { status: 'saved', message: 'Saved. Read plan link context again before another change.' } : issue && result.status === 'invalid' ? { ...result, message: 'No change made. ' + issue } : result
    },
  }
}
export type PlanLinks = ReturnType<typeof createPlanLinks>
