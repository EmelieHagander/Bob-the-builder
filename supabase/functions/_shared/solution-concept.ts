import { compileParameterGraph, parseParameterPlan, type ParameterInput } from './cad-parameters.ts'
import type { DesignIntent } from './project-design-intent.ts'
import type { CadAssemblyRequest } from './cad-adapter.ts'

type Node = Exclude<ParameterInput, { role: 'source' }>
type Triple = [string, string, string]
export type ConceptModel = {
  version: 1
  frame: { origin: string; x: string; y: string; z: string }
  nodes: Node[]
  components: { id: string; label: string; kind: 'solid' | 'space' | 'opening'; active: boolean; position: Triple; size: Triple; features: string[]; choices: string[] }[]
  views: { id: string; label: string; plane: 'XY' | 'XZ' | 'YZ'; kind: 'projection' | 'section'; at: string | null }[]
  constraints: ({ id: string; label: string; relation: 'equal' | 'at_most'; left: string; right: string; feature: string | null }
    | { id: string; label: string; relation: 'view_plane'; view: string; plane: 'XY' | 'XZ' | 'YZ'; feature: string | null })[]
  unsupported: string[]
}
export type ConceptIssue = { code: string; ids: string[]; message: string }
export type ConceptBox = ConceptModel['components'][number] & { min: number[]; size_mm: number[] }
const exact = (v: any, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && !!v.trim() && Array.from(v).length <= max
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(v)
const list = (v: unknown, max: number): v is any[] => Array.isArray(v) && v.length <= max
const unique = (xs: string[]) => new Set(xs).size === xs.length

/** Strict, bounded data only. The owning Solution supplies revision and authority. */
export function parseConceptModel(raw: unknown): ConceptModel | null {
  const m = raw as ConceptModel
  if (!exact(m, ['version', 'frame', 'nodes', 'components', 'views', 'constraints', 'unsupported']) || m.version !== 1
    || !exact(m.frame, ['origin', 'x', 'y', 'z']) || !Object.values(m.frame).every(v => text(v))
    || !list(m.nodes, 64) || !m.nodes.length || !list(m.components, 48) || !m.components.length
    || !list(m.views, 6) || m.views.length < 2 || !list(m.constraints, 24) || !list(m.unsupported, 12) || !m.unsupported.every(v => text(v, 500))) return null
  try { parseParameterPlan({ version: 1, frames: [], nodes: m.nodes, bindings: [] }) } catch { return null }
  if (m.nodes.some(n => !id(n.id) || !['decision', 'estimate', 'unknown', 'derived'].includes(n.role) || ('unit' in n && !['mm', 'scalar'].includes(n.unit)))) return null
  const nodes = new Set(m.nodes.map(n => n.id))
  const ref = (v: unknown) => id(v) && nodes.has(v)
  const triple = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(ref)
  for (const n of m.nodes) if (n.role === 'derived' && !n.operands.every(ref)) return null
  for (const c of m.components) {
    if (!exact(c, ['id', 'label', 'kind', 'active', 'position', 'size', 'features', 'choices']) || !id(c.id) || !text(c.label)
      || !['solid', 'space', 'opening'].includes(c.kind) || typeof c.active !== 'boolean' || !triple(c.position) || !triple(c.size)
      || !list(c.features, 24) || !c.features.every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(v)) || !unique(c.features)
      || !list(c.choices, 16) || !c.choices.every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v)) || !unique(c.choices)) return null
  }
  for (const v of m.views) {
    if (!exact(v, ['id', 'label', 'plane', 'kind', 'at']) || !id(v.id) || !text(v.label) || !['XY', 'XZ', 'YZ'].includes(v.plane)
      || !['projection', 'section'].includes(v.kind) || (v.kind === 'section' ? !ref(v.at) : v.at !== null)) return null
  }
  if (!m.views.some(v => v.plane === 'XY' && v.kind === 'projection') || !m.views.some(v => v.plane !== 'XY')) return null
  for (const c of m.constraints) {
    if (!c || !id(c.id) || !text(c.label) || !(c.feature === null || typeof c.feature === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(c.feature))) return null
    if (c.relation === 'view_plane') {
      if (!exact(c, ['id', 'label', 'relation', 'view', 'plane', 'feature']) || !m.views.some(v => v.id === c.view) || !['XY', 'XZ', 'YZ'].includes(c.plane)) return null
    } else if (!exact(c, ['id', 'label', 'relation', 'left', 'right', 'feature']) || !['equal', 'at_most'].includes(c.relation) || !ref(c.left) || !ref(c.right)) return null
  }
  if (![m.nodes, m.components, m.views, m.constraints].every(xs => unique(xs.map(x => x.id)))) return null
  return structuredClone(m)
}

/** A gap affects only dependent components/views; unknown is never a zero. */
export function evaluateConcept(intent: DesignIntent) {
  const model = parseConceptModel(intent.model)
  const issues: ConceptIssue[] = [], boxes: ConceptBox[] = []
  const values = new Map<string, { value: number; unit: string }>()
  const add = (code: string, ids: string[], message: string) => issues.push({ code, ids, message })
  if (!model) { add('invalid_model', [], 'The concept model is unavailable or unsupported.'); return { model, issues, boxes, values } }
  const nodes = new Map(model.nodes.map(n => [n.id, n]))
  // Reuse the existing decimal graph evaluator, one reachable subgraph at a time.
  for (const n of model.nodes) {
    const needed = new Set<string>(), active = new Set<string>()
    const visit = (key: string) => {
      if (active.has(key)) throw Error('parameter_cycle')
      if (needed.has(key)) return
      active.add(key)
      const node = nodes.get(key)!
      if (node.role === 'derived') node.operands.forEach(visit)
      active.delete(key); needed.add(key)
    }
    try {
      visit(n.id)
      const graph = compileParameterGraph('concept', model.nodes.filter(node => needed.has(node.id)), [n.id], new Map(), new Map())
      values.set(n.id, graph.outputs[0].normalized)
    } catch { add('parameter_unresolved', [n.id], 'A concept dimension is unknown or its formula cannot be evaluated.') }
  }
  const mm = (key: string) => { const n = values.get(key); return n?.unit === 'mm' ? n.value : null }
  for (const c of model.components.filter(c => c.active)) {
    const xyz = c.position.map(mm), size = c.size.map(mm)
    if ([...xyz, ...size].some(n => n === null || Math.abs(n) > 1e6) || size.some(n => n !== null && n <= 0)) {
      add('component_unresolved', [c.id], `${c.label}: dimensions or placement are unknown, invalid or outside supported bounds.`); continue
    }
    boxes.push({ ...c, min: xyz as number[], size_mm: size as number[] })
  }
  if (!model.components.some(c => c.active)) add('empty_model', [], 'The concept has no active components. Restore or add the intended geometry before construction.')
  for (const v of model.views) if (v.at !== null && (mm(v.at) === null || Math.abs(mm(v.at)!) > 1e6)) add('section_unresolved', [v.id], `${v.label}: the section position is unknown or invalid.`)
  for (const c of model.constraints) {
    if (c.relation === 'view_plane') {
      if (model.views.find(v => v.id === c.view)?.plane !== c.plane) add('view_plane_conflict', [c.id, c.view], `${c.label}: this view must use the ${c.plane} plane.`)
      continue
    }
    const a = values.get(c.left), b = values.get(c.right)
    if (!a || !b || a.unit !== b.unit) add('constraint_unresolved', [c.id], `${c.label}: values are unknown or units disagree.`)
    else if (c.relation === 'equal' ? a.value !== b.value : a.value > b.value) add('constraint_conflict', [c.id], `${c.label}: ${a.value} ${a.unit} ${c.relation === 'equal' ? '≠' : '>'} ${b.value} ${b.unit}.`)
  }
  const features = new Set(intent.features.map(f => f.id)), choices = new Set(intent.choices.map(c => c.id))
  for (const c of model.components) if (c.features.some(f => !features.has(f)) || c.choices.some(f => !choices.has(f))) add('design_link_missing', [c.id], `${c.label}: a linked design feature or choice is missing.`)
  for (const c of model.constraints) if (c.feature !== null && !features.has(c.feature)) add('design_link_missing', [c.id], `${c.label}: a linked feature is missing.`)
  for (const f of intent.features) if (!model.components.some(c => c.active && c.features.includes(f.id))) add('feature_missing', [f.id], `Not represented in the concept: ${f.description}`)
  for (const c of intent.choices) if (c.geometry_dependency && !model.components.some(p => p.active && p.choices.includes(c.id))) add('choice_missing', [c.id], `Not linked to concept geometry: ${c.question}`)
  model.unsupported.forEach(message => add('unsupported', [], message))
  return { model, issues, boxes, values }
}

export function conceptView(intent: DesignIntent, viewId: string) {
  const result = evaluateConcept(intent), view = result.model?.views.find(v => v.id === viewId)
  if (!view) throw Error('concept_view_missing')
  const axes = view.plane === 'XY' ? [0, 1, 2] : view.plane === 'XZ' ? [0, 2, 1] : [1, 2, 0]
  const at = view.at === null ? null : result.values.get(view.at)?.value ?? null
  const visible = view.kind === 'section' && result.issues.some(i => i.code === 'section_unresolved' && i.ids.includes(view.id)) ? []
    : result.boxes.filter(b => view.kind === 'projection' || at !== null && at >= b.min[axes[2]] && at <= b.min[axes[2]] + b.size_mm[axes[2]])
  return { ...result, view, axes, at, shapes: visible.map(b => ({ id: b.id, label: b.label, kind: b.kind, x: b.min[axes[0]], y: b.min[axes[1]], width: b.size_mm[axes[0]], height: b.size_mm[axes[1]] })) }
}

/** Exact first-slice mapping; never fit a bounding box around unsupported CAD. */
export function conceptConstructionIssues(intent: DesignIntent, recipe: CadAssemblyRequest, referenceIds: Set<string>) {
  if (!intent.model) return []
  const result = evaluateConcept(intent), issues = [...result.issues]
  for (const b of result.boxes) {
    const i = recipe.instances.find(i => i.id === b.id), d = recipe.definitions.find(d => d.id === i?.definition_id)
    if (!i || !d) { issues.push({ code: 'concept_part_missing', ids: [b.id], message: `${b.label}: the construction is missing this concept component.` }); continue }
    if (d.primitive !== 'box' || d.cuts?.length || [i.placement.rx, i.placement.ry, i.placement.rz].some(n => n !== 0)) {
      issues.push({ code: 'concept_mapping_unsupported', ids: [b.id], message: `${b.label}: this concept handoff supports uncut, unrotated boxes with preserved identities.` }); continue
    }
    if ([d.x_mm, d.y_mm, d.z_mm, i.placement.x, i.placement.y, i.placement.z].some((n, k) => n !== [...b.size_mm, ...b.min][k]) || (b.kind !== 'solid') !== referenceIds.has(b.id))
      issues.push({ code: 'concept_geometry_changed', ids: [b.id], message: `${b.label}: construction dimensions, position or physical/reference role differ from the selected concept.` })
  }
  return issues
}

/** All text is escaped. No caller SVG, markup, URL or executable expression. */
export function conceptSvg(intent: DesignIntent, viewId: string) {
  const v = conceptView(intent, viewId)
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
  const xmin = Math.min(0, ...v.shapes.map(s => s.x)), ymin = Math.min(0, ...v.shapes.map(s => s.y))
  const xmax = Math.max(1, ...v.shapes.map(s => s.x + s.width)), ymax = Math.max(1, ...v.shapes.map(s => s.y + s.height))
  const scale = Math.min(620 / (xmax - xmin), 340 / (ymax - ymin)), ox = 60, oy = 405
  const axis = ['X', 'Y', 'Z'], frame = v.model!.frame
  const title = `${v.view.label} · ${v.view.plane} ${v.view.kind === 'section' ? `principle section at ${axis[v.axes[2]]} = ${v.at ?? 'unknown'} mm` : 'projection'}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 470" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="760" height="470" fill="white"/><g fill="#1a291e" font-family="sans-serif" font-size="16"><text x="20" y="25">${esc(title)}</text><text x="20" y="48">Concept · design values, not measured or build-ready</text>${v.shapes.map((s, index) => `<rect x="${ox + (s.x - xmin) * scale}" y="${oy - (s.y + s.height - ymin) * scale}" width="${s.width * scale}" height="${s.height * scale}" fill="${s.kind === 'solid' ? '#e8eedb' : 'none'}" stroke="#1a291e" stroke-width="1.5" ${s.kind !== 'solid' ? 'stroke-dasharray="6 4"' : ''}/><text x="${ox + (s.x - xmin) * scale + 3}" y="${oy - (s.y + s.height - ymin) * scale + 17}">${index + 1}</text>`).join('')}<text x="60" y="435">${esc(`${axis[v.axes[0]]} → ${frame[axis[v.axes[0]].toLowerCase() as 'x' | 'y' | 'z']} · mm`)}</text><text x="60" y="457">${esc(`${axis[v.axes[1]]} ↑ ${frame[axis[v.axes[1]].toLowerCase() as 'x' | 'y' | 'z']} · mm`)}</text></g></svg>`
}
