import { fingerprint, rethrowContinuation } from './bob-job-journal.ts'
import type { ProjectWriter, WritePayload } from './project-write.ts'

const nullable = { type: ['string', 'null'] }
const tool = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function' as const, function: { name, description, parameters: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } })
export const BUILDING_SCOPE_TOOLS = [
  tool('read_building_scope', 'Read the buildings this project can use, the rooms of one of them, or this project\'s Areas. buildings lists only buildings you can edit and buildings this project already links, with how the project links each (whole, site, rooms_only or none). rooms needs a building_ref from a buildings read and shows which rooms the project covers and their Areas. areas shows where each Area is mapped. Choose returned refs; identities and link rows stay on the server. next_ref continues the same filter.',
    { resource: { type: 'string', enum: ['buildings', 'rooms', 'areas'] }, building_ref: nullable, query: nullable, next_ref: nullable }),
  tool('change_building_scope', 'Change which building, rooms and Area mappings this project covers, using refs from read_building_scope. Without rooms or area, link or unlink the whole building: linking needs edit rights and shares the whole building, with its rooms, notes and measurements, with every project member; unlinking also removes this project\'s room marks and Area mappings there. With room_refs, mark or unmark those rooms. With area_ref, map or unmap that Area to the given rooms, or to the whole building when no rooms are given. Rooms and Areas need the whole building linked first; create a missing Area with the Area tools first. The result carries fresh refs for the next change.',
    { action: { type: 'string', enum: ['link', 'unlink'] }, building_ref: { type: 'string' }, room_refs: { type: 'array', maxItems: 16, items: { type: 'string' } }, area_ref: nullable, request_quote: { type: 'string' } }),
]
export type BuildingScopeResource = 'buildings' | 'rooms' | 'areas'
export type BuildingScopeSnapshot = { project_id: string; resource: BuildingScopeResource; key: string; scope_label: string; record: Record<string, any> }
type Cursor = { resource: BuildingScopeResource; building: string | null; query: string | null; after: string }
export type BuildingScopeState = {
  version: 1; projectId: string; reads: number; partial: boolean;
  snapshots: [string, BuildingScopeSnapshot][]; pages: [string, Cursor][];
}
const RESOURCES: BuildingScopeResource[] = ['buildings', 'rooms', 'areas']
const PAGE: Record<BuildingScopeResource, number> = { buildings: 6, rooms: 16, areas: 8 }
const READ_BUDGET = 24
const exact = (v: unknown, keys: string[]): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const nonempty = (v: unknown, max = 1000): v is string => typeof v === 'string' && !!v.trim() && v.length <= max
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

function valid(s: unknown, projectId: string, resource?: BuildingScopeResource, building?: string | null): s is BuildingScopeSnapshot {
  if (!object(s) || s.project_id !== projectId || !RESOURCES.includes(s.resource) || (resource && s.resource !== resource)
    || !nonempty(s.key, 200) || !object(s.record) || s.record.id !== s.key || typeof s.scope_label !== 'string') return false
  const r = s.record
  if (s.resource === 'buildings') return typeof r.name === 'string' && ['whole', 'site', 'rooms_only', 'none'].includes(r.link)
  if (s.resource === 'rooms') return typeof r.name === 'string' && typeof r.building_id === 'string' && (!building || r.building_id === building) && Array.isArray(r.area_targets)
  return typeof r.name === 'string' && Array.isArray(r.targets)
}
/** What Bob sees: names and link state, never identities or link rows. */
function display(s: BuildingScopeSnapshot) {
  const r = s.record
  if (s.resource === 'buildings') return { name: r.name, link: r.link, can_edit: r.can_edit, marked_rooms: r.marked_rooms, area_mappings: r.area_targets,
    ...(r.site_link ? { site_link: true } : {}), ...(r.household_follow ? { household_follow: true } : {}) }
  if (s.resource === 'rooms') return { name: r.name, kind: r.kind || null, level: r.level ?? null, marked: r.marked, areas: r.area_targets.map((t: any) => t.area_name) }
  return { name: r.name, mapped_to: r.targets.map((t: any) => ({ target: t.target_kind, building: t.building_name ?? null, room: t.space_name ?? null })) }
}
const SAVED: Record<string, string> = {
  linked: 'The whole building, with its rooms, notes and measurements, is now visible to every member of this project. Tell the owner what is now shared.',
  already_linked: 'The project already linked this whole building; nothing new was shared.',
}

export function createBuildingScope(opts: {
  projectId: string; writer?: ProjectWriter; hasAccess: () => Promise<boolean>; unlimitedWork?: boolean;
  read: (input: { resource: BuildingScopeResource; building: string | null; query: string | null; after: string | null }) => PromiseLike<{ data: unknown; error: unknown }>;
}) {
  const snapshots = new Map<string, BuildingScopeSnapshot>(), pages = new Map<string, Cursor>()
  let reads = 0, partial = false
  const unavailable = () => { partial = true; return { status: 'unavailable' } }
  const register = async (s: BuildingScopeSnapshot) => {
    const ref = 'building_scope_' + await fingerprint(s)
    snapshots.set(ref, structuredClone(s))
    return { ref, resource: s.resource, scope: s.scope_label, content: display(s) }
  }
  return {
    tools: BUILDING_SCOPE_TOOLS, get remaining() { return opts.unlimitedWork ? Infinity : Math.max(0, READ_BUDGET - reads) }, get partial() { return partial },
    /** Unused state is left out of a checkpoint, so older checkpoints restore as empty. */
    get used() { return reads > 0 || snapshots.size > 0 || partial },
    exportState(): BuildingScopeState {
      return JSON.parse(JSON.stringify({ version: 1, projectId: opts.projectId, reads, partial, snapshots: [...snapshots], pages: [...pages] }))
    },
    restoreState(state: BuildingScopeState) {
      if (!state || state.version !== 1 || state.projectId !== opts.projectId || !Number.isSafeInteger(state.reads) || state.reads < 0 || typeof state.partial !== 'boolean'
        || !Array.isArray(state.snapshots) || !Array.isArray(state.pages)
        || state.snapshots.some(entry => !Array.isArray(entry) || typeof entry[0] !== 'string' || !valid(entry[1], opts.projectId))) throw new Error('invalid_building_scope_state')
      const saved = structuredClone(state)
      snapshots.clear(); for (const [key, value] of saved.snapshots) snapshots.set(key, value)
      pages.clear(); for (const [key, value] of saved.pages) pages.set(key, value)
      reads = saved.reads; partial = saved.partial
    },
    async execute(name: string, value: unknown): Promise<any> {
      if (!await opts.hasAccess()) return { status: 'denied' }
      if (name === 'read_building_scope') {
        if (!exact(value, ['resource', 'building_ref', 'query', 'next_ref']) || !RESOURCES.includes(value.resource)
          || !(value.building_ref === null || nonempty(value.building_ref, 200)) || !(value.query === null || nonempty(value.query, 200))
          || !(value.next_ref === null || nonempty(value.next_ref, 200))) return { status: 'invalid', message: 'Use the offered schema: a resource, building_ref, query and next_ref, each null when unused.' }
        const resource = value.resource as BuildingScopeResource
        let building: string | null = null
        if (resource === 'rooms') {
          const chosen = snapshots.get(value.building_ref)
          if (chosen?.resource !== 'buildings') return { status: 'invalid', message: 'Rooms need a building_ref from read_building_scope(resource=buildings).' }
          building = chosen.key
        } else if (value.building_ref !== null) return { status: 'invalid', message: 'building_ref is used only with resource=rooms.' }
        if (!opts.unlimitedWork && reads >= READ_BUDGET) return { status: 'budget_exhausted' }
        const input = value.next_ref === null ? { resource, building, query: value.query as string | null, after: null } : pages.get(value.next_ref)
        if (!input || input.resource !== resource || input.query !== value.query || input.building !== building) return { status: 'invalid', message: 'next_ref continues only the same resource, building and query.' }
        reads++
        try {
          const { data, error } = await opts.read(input)
          const size = PAGE[resource]
          if (error || !Array.isArray(data) || data.length > size + 1 || JSON.stringify(data).length > 240000
            || !data.every(s => valid(s, opts.projectId, resource, building))) return unavailable()
          const entries = []
          for (const s of data.slice(0, size) as BuildingScopeSnapshot[]) { const { resource: _resource, ...entry } = await register(s); entries.push(entry) }
          let next_ref: string | null = null
          if (data.length > size) {
            const cursor = { ...input, after: (data[size - 1] as BuildingScopeSnapshot).key }
            next_ref = 'page_' + await fingerprint({ project: opts.projectId, ...cursor }); pages.set(next_ref, cursor)
          }
          return { status: 'ok', entries, next_ref }
        } catch (e) { rethrowContinuation(e); return unavailable() }
      }
      if (!opts.writer || name !== 'change_building_scope') return { status: 'denied' }
      const v = value as Record<string, any>
      const building = snapshots.get(v?.building_ref)
      const area = v?.area_ref == null ? null : snapshots.get(v.area_ref)
      let payload: WritePayload | null = null, issue = ''
      try {
        if (!exact(v, ['action', 'building_ref', 'room_refs', 'area_ref', 'request_quote']) || !['link', 'unlink'].includes(v.action)
          || !Array.isArray(v.room_refs) || v.room_refs.length > 16 || !(v.area_ref === null || typeof v.area_ref === 'string') || !nonempty(v.request_quote, 500)) throw Error('Use action link or unlink with refs from read_building_scope.')
        if (building?.resource !== 'buildings') throw Error('Read buildings and choose the intended building ref.')
        const rooms = (v.room_refs as unknown[]).map(ref => typeof ref === 'string' ? snapshots.get(ref) : undefined)
        if (rooms.some(r => r?.resource !== 'rooms' || r.record.building_id !== building.key) || new Set(rooms.map(r => r!.key)).size !== rooms.length) throw Error('Choose distinct room refs read for this building.')
        if (v.area_ref !== null && area?.resource !== 'areas') throw Error('Choose an Area ref from read_building_scope(resource=areas); create a missing Area with the Area tools first.')
        const chosen = (rooms as BuildingScopeSnapshot[]).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        payload = { kind: 'bound_building_scope', record_id: building.key, expected_updated_at: null, expected_revision: null, request_quote: v.request_quote,
          data: { pins: [building, ...chosen, ...(area ? [area] : [])], command: { action: v.action, building_id: building.key, space_ids: chosen.map(r => r.key), area_id: area?.key ?? null } } }
      } catch (e) { rethrowContinuation(e); issue = e instanceof Error ? e.message : 'Invalid change.' }
      const result = await opts.writer.commitBound(name, 'building:' + (building?.key ?? 'unbound') + ':' + (area?.key ?? ''), payload)
      if (result.status !== 'saved') return issue && result.status === 'invalid' ? { ...result, message: 'No change made. ' + issue } : result
      const record = result.receipt?.record as Record<string, any> | undefined
      const current = []
      for (const s of Array.isArray(record?.current) ? record!.current : []) if (valid(s, opts.projectId)) current.push(await register(s))
      const changes = Array.isArray(record?.changes) ? record!.changes : []
      const whole = changes.length === 1 && changes[0]?.target === 'building' ? String(changes[0].result) : ''
      const removed = whole === 'unlinked' ? `The project no longer links this building; ${Number(record?.removed_rooms) || 0} room marks and ${Number(record?.removed_area_targets) || 0} Area mappings there were removed with it.` : ''
      const message = ['Saved.', SAVED[whole] ?? '', removed, 'current holds fresh refs for the next change.'].filter(Boolean).join(' ')
      return { status: 'saved', message, changes, current }
    },
  }
}
export type BuildingScope = ReturnType<typeof createBuildingScope>
