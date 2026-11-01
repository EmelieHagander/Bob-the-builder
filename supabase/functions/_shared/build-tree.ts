import { rethrowContinuation } from './bob-job-journal.ts'

/** Owner decisions 2026-11-01 ("Bob för stora byggen"): the project is a tree
 * that follows the house (building, level, room) down to sub-builds and their
 * builds. A build with no room sits in Snickeriet. Each level carries a summary
 * counted by code, so Bob and his colleagues zoom in from an outline instead of
 * reading everything, and search runs down (what is inside) and up (where it sits). */
export type BuildKind = 'sub_build' | 'construction' | 'drawing'
export type FlatBuild = { id: string; kind: BuildKind; title: string; revision: number; area_id: string | null; parent_id: string | null; space_id: string | null; parts: number | null; in_sub_builds: string[] }
export type FlatSpace = { space_id: string; name: string; level_id: string | null; level_name: string | null; level_position: number | null; building_id: string; building_name: string }
export type FlatTree = { version: 1; spaces: FlatSpace[]; builds: FlatBuild[] }
export type NodeKind = 'project' | 'building' | 'level' | 'room' | 'workshop' | BuildKind
export type TreeNode = { kind: NodeKind; id: string; name: string; children: TreeNode[]; build?: FlatBuild }
export type Summary = { rooms: number; sub_builds: number; constructions: number; drawings: number; parts: number; parts_unknown: number }

export const WORKSHOP_ID = 'workshop'
export const WORKSHOP_NAME = 'Snickeriet'
const NO_LEVEL = 'no_level:'

const nullable = { type: ['string', 'null'] }
const tool = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function' as const, function: { name, description, parameters: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } })
export const BUILD_TREE_TOOLS = [
  tool('read_build_tree', 'Read the project as a tree that follows the house: buildings, levels, rooms, sub-builds and the constructions and drawings inside them. Builds with no room sit in Snickeriet. focus null shows the outline from the top; an id from an earlier read zooms into that place, with the path above it, its summary and what is directly inside. query searches the place in focus and everything below it by name, and each match comes with the path up to where it sits. Summaries are counted by the server.',
    { focus: nullable, query: nullable }),
  tool('place_build', 'Place a sub-build, construction or drawing in the tree: inside a sub-build (sub_build_id) or in a room (room_id), using ids from read_build_tree. Inside a sub-build it belongs to that sub-build\'s room. Sub-builds nest two levels: one inside another, never deeper. Both null moves it back to Snickeriet.',
    { build_id: { type: 'string' }, sub_build_id: nullable, room_id: nullable }),
]

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: unknown, keys: string[]): v is Record<string, any> => object(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max
const id = (v: unknown) => typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v)

export function validFlatTree(v: unknown): v is FlatTree {
  return object(v) && v.version === 1 && Array.isArray(v.spaces) && Array.isArray(v.builds)
    && v.spaces.every((s: any) => object(s) && id(s.space_id) && typeof s.name === 'string' && id(s.building_id) && typeof s.building_name === 'string')
    && v.builds.every((b: any) => object(b) && id(b.id) && ['sub_build', 'construction', 'drawing'].includes(b.kind) && typeof b.title === 'string'
      && (b.parent_id === null || id(b.parent_id)) && (b.space_id === null || id(b.space_id)) && Array.isArray(b.in_sub_builds))
}

/** Nest the flat rows: building > level > room > sub-builds > builds, and Snickeriet last.
 * A drawing with no place of its own sits in the one sub-build that pins it as a piece. */
export function buildTree(flat: FlatTree): TreeNode {
  const root: TreeNode = { kind: 'project', id: 'project', name: 'Project', children: [] }
  const nodes = new Map<string, TreeNode>()
  const buildings = new Map<string, TreeNode>(), levels = new Map<string, TreeNode>()
  for (const s of flat.spaces) {
    let building = buildings.get(s.building_id)
    if (!building) { building = { kind: 'building', id: s.building_id, name: s.building_name, children: [] }; buildings.set(s.building_id, building); root.children.push(building) }
    const levelKey = s.level_id ?? NO_LEVEL + s.building_id
    let level = levels.get(levelKey)
    if (!level && s.level_id) { level = { kind: 'level', id: s.level_id, name: s.level_name ?? 'Level', children: [] }; levels.set(levelKey, level); building.children.push(level) }
    const room: TreeNode = { kind: 'room', id: s.space_id, name: s.name, children: [] }
    nodes.set(s.space_id, room);
    (level ?? building).children.push(room)
  }
  for (const b of flat.builds) nodes.set(b.id, { kind: b.kind, id: b.id, name: b.title, children: [], build: b })
  const workshop: TreeNode = { kind: 'workshop', id: WORKSHOP_ID, name: WORKSHOP_NAME, children: [] }
  for (const b of flat.builds) {
    const holder = b.parent_id ? nodes.get(b.parent_id)
      : b.space_id ? nodes.get(b.space_id)
      : b.in_sub_builds.length === 1 ? nodes.get(b.in_sub_builds[0]) : undefined
    // A place that is no longer in the tree (an archived sub-build, an unlinked room) sends the build to Snickeriet.
    ;(holder && holder !== nodes.get(b.id) ? holder : workshop).children.push(nodes.get(b.id)!)
  }
  root.children.push(workshop)
  return root
}

export function summarize(node: TreeNode): Summary {
  const sum: Summary = { rooms: 0, sub_builds: 0, constructions: 0, drawings: 0, parts: 0, parts_unknown: 0 }
  const visit = (n: TreeNode) => {
    for (const c of n.children) {
      if (c.kind === 'room') sum.rooms++
      if (c.kind === 'sub_build') sum.sub_builds++
      if (c.kind === 'drawing') sum.drawings++
      if (c.kind === 'construction') { sum.constructions++; if (typeof c.build?.parts === 'number') sum.parts += c.build.parts; else sum.parts_unknown++ }
      visit(c)
    }
  }
  if (node.kind === 'construction') { if (typeof node.build?.parts === 'number') sum.parts = node.build.parts; else sum.parts_unknown = 1 }
  visit(node)
  return sum
}

/** The path from the top to a node (the node itself last), or null when it is not in the tree. */
export function pathTo(root: TreeNode, target: string): TreeNode[] | null {
  const walk = (n: TreeNode, trail: TreeNode[]): TreeNode[] | null => {
    if (n.id === target && n.kind !== 'project') return [...trail, n]
    for (const c of n.children) { const found = walk(c, n.kind === 'project' ? trail : [...trail, n]); if (found) return found }
    return null
  }
  return walk(root, [])
}

const brief = (n: TreeNode) => {
  const s = summarize(n)
  const counts = Object.fromEntries(Object.entries(s).filter(([, v]) => v > 0))
  return { kind: n.kind, id: n.id, name: n.name, ...(n.build ? { revision: n.build.revision, ...(n.build.area_id ? { area_id: n.build.area_id } : {}) } : {}), ...(Object.keys(counts).length ? { summary: counts } : {}) }
}
const MAX_CHILDREN = 40, MAX_MATCHES = 20

/** One zoom: the path above, the node's summary and what is directly inside; with a query, matches below with their path up. */
export function zoom(root: TreeNode, focus: string | null, query: string | null) {
  const path = focus ? pathTo(root, focus) : []
  if (!path) return { status: 'not_found', message: 'That id is not in the tree now. Read it again with focus null.' }
  const node = path.length ? path[path.length - 1] : root
  const children = node.children.slice(0, MAX_CHILDREN).map(brief)
  const result: Record<string, unknown> = {
    status: 'ok',
    path: path.slice(0, -1).map(n => ({ kind: n.kind, id: n.id, name: n.name })),
    node: brief(node),
    children,
    ...(node.children.length > MAX_CHILDREN ? { more_children: node.children.length - MAX_CHILDREN } : {}),
  }
  if (query) {
    const needle = query.trim().toLocaleLowerCase('sv')
    const matches: { kind: NodeKind; id: string; name: string; path: string }[] = []
    let total = 0
    const walk = (n: TreeNode, trail: string[]) => {
      for (const c of n.children) {
        if (c.name.toLocaleLowerCase('sv').includes(needle)) { total++; if (matches.length < MAX_MATCHES) matches.push({ kind: c.kind, id: c.id, name: c.name, path: [...trail, c.name].join(' › ') }) }
        walk(c, [...trail, c.name])
      }
    }
    walk(node, path.map(n => n.name))
    result.matches = matches
    if (total > matches.length) result.more_matches = total - matches.length
  }
  return result
}

export type BuildTreeTools = ReturnType<typeof createBuildTree>
export function createBuildTree(opts: {
  projectId: string; hasAccess: () => Promise<boolean>
  read: () => PromiseLike<{ data: unknown; error: unknown }>
  place: (build: string, subBuild: string | null, room: string | null) => PromiseLike<{ data: unknown; error: unknown }>
}) {
  let partial = false
  const load = async () => {
    let read: { data: unknown; error: unknown }
    try { read = await opts.read() } catch (error) { rethrowContinuation(error); read = { data: null, error } }
    if (read.error || !validFlatTree(read.data)) { partial = true; return null }
    return buildTree(read.data)
  }
  return {
    tools: BUILD_TREE_TOOLS,
    get partial() { return partial },
    async execute(name: string, value: unknown): Promise<any> {
      if (!await opts.hasAccess()) return { status: 'denied', reason: 'access' }
      if (name === 'read_build_tree') {
        if (!exact(value, ['focus', 'query']) || !(value.focus === null || text(value.focus, 80)) || !(value.query === null || text(value.query, 200)))
          return { status: 'invalid', message: 'Use the offered schema: focus and query, each null when unused.' }
        const tree = await load()
        return tree ? zoom(tree, value.focus, value.query) : { status: 'unavailable' }
      }
      if (name === 'place_build') {
        if (!exact(value, ['build_id', 'sub_build_id', 'room_id']) || !id(value.build_id) || !(value.sub_build_id === null || id(value.sub_build_id)) || !(value.room_id === null || id(value.room_id)))
          return { status: 'invalid', message: 'Use ids from read_build_tree: build_id, and sub_build_id or room_id (null when unused).' }
        let saved: { data: unknown; error: unknown }
        try { saved = await opts.place(value.build_id, value.sub_build_id, value.room_id) } catch (error) { rethrowContinuation(error); saved = { data: null, error } }
        if (saved.error) {
          const code = /build_[a-z_]+|project_denied/.exec(String((saved.error as { message?: unknown })?.message ?? ''))?.[0]
          if (code === 'project_denied') return { status: 'denied', reason: 'access' }
          if (code) return { status: 'invalid', code, message: PLACE_REFUSALS[code] ?? 'The server refused this place.' }
          partial = true; return { status: 'unavailable' }
        }
        const tree = await load()
        const path = tree ? pathTo(tree, value.build_id) : null
        return { ...(object(saved.data) ? saved.data : { status: 'saved' }), ...(path ? { path: path.map(n => n.name).join(' › ') } : {}) }
      }
      return { status: 'not_offered' }
    },
  }
}

const PLACE_REFUSALS: Record<string, string> = {
  build_unavailable: 'Not a sub-build, construction or drawing of this project. Read the tree again.',
  build_archived: 'Archived builds are not placed.',
  build_parent_not_sub_build: 'Only a sub-build holds builds.',
  build_space_from_parent: 'Inside a sub-build the room comes from the sub-build: give sub_build_id or room_id, not both.',
  build_nesting_limit: 'Sub-builds nest two levels: one inside another, never deeper.',
  build_space_unavailable: 'That room is not in a building this project links.',
  build_invalid: 'A build cannot hold itself.',
}
