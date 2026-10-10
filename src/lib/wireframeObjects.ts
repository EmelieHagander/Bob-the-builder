import { BufferAttribute, BufferGeometry, Color, Group, InstancedBufferAttribute, InstancedBufferGeometry, LineBasicMaterial, LineDashedMaterial, LineSegments, ShaderMaterial, type Material } from 'three'
import type { CadWireframe } from '../../supabase/functions/_shared/cad-wireframe.ts'
import { CAD_WIREFRAME_DRAW_SEGMENTS } from '../../supabase/functions/_shared/cad-wireframe.ts'
import { multiply, placementMatrix, shellMatrix, transformPoint, type Mat4 } from './shell3d'
import type { ShellComponent } from './cadShell'

export type WireBounds = { min: number[]; max: number[] }
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const center = (bounds: WireBounds) => bounds.min.map((n, i) => (n + bounds.max[i]) / 2)
const corners = (bounds: WireBounds) => [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => [x ? bounds.max[0] : bounds.min[0], y ? bounds.max[1] : bounds.min[1], z ? bounds.max[2] : bounds.min[2]])))
export function pointBounds(points: number[][]): WireBounds {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const p of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]) }
  return { min, max }
}

/** One selected piece at a time. Geometry is shared by all instances of a definition. */
export function createWireframeObjects(value: CadWireframe, colour: string, outer: Mat4 = IDENTITY, instanceId = '') {
  const instances = instanceId ? value.instances.filter(i => i.id === instanceId) : value.instances
  if (!instances.length) throw new Error('This part is not in the saved drawing.')
  const defs = new Map(value.definitions.map(d => [d.id, d.positions]))
  const segments = instances.reduce((n, i) => n + defs.get(i.definition_id)!.length / 6, 0)
  if (segments > CAD_WIREFRAME_DRAW_SEGMENTS) throw new Error('This piece has too many edges for the mobile view. Choose one part below.')
  let bounds: WireBounds
  if (!instanceId) bounds = pointBounds(corners(value.bounds).map(p => transformPoint(outer, p)))
  else {
    const matrix = multiply(outer, placementMatrix(instances[0].placement)), positions = defs.get(instances[0].definition_id)!
    const points = []
    for (let i = 0; i < positions.length; i += 3) points.push(transformPoint(matrix, positions.slice(i, i + 3)))
    bounds = pointBounds(points)
  }
  const origin = center(bounds), group = new Group(), geometries: BufferGeometry[] = []
  const material = new ShaderMaterial({ uniforms: { ink: { value: new Color(colour) } },
    vertexShader: `attribute vec4 m0; attribute vec4 m1; attribute vec4 m2; attribute vec4 m3;
      void main() { gl_Position = projectionMatrix * modelViewMatrix * mat4(m0,m1,m2,m3) * vec4(position,1.0); }`,
    fragmentShader: 'uniform vec3 ink; void main() { gl_FragColor = vec4(ink,1.0); }',
  })
  for (const [id, positions] of defs) {
    const placed = instances.filter(i => i.definition_id === id)
    if (!placed.length) continue
    const geometry = new InstancedBufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
    const matrices = placed.map(i => {
      const m = multiply(outer, placementMatrix(i.placement))
      for (let k = 0; k < 3; k++) m[12 + k] -= origin[k]
      return m
    })
    for (let c = 0; c < 4; c++) geometry.setAttribute('m' + c, new InstancedBufferAttribute(Float32Array.from(matrices.flatMap(m => m.slice(c * 4, c * 4 + 4))), 4))
    geometry.instanceCount = placed.length
    const lines = new LineSegments(geometry, material)
    lines.name = id; lines.frustumCulled = false // The one bounded chunk owns its full instance bounds.
    group.add(lines); geometries.push(geometry)
  }
  return { group, bounds: { min: bounds.min.map((n, i) => n - origin[i]), max: bounds.max.map((n, i) => n - origin[i]) },
    segments, drawCalls: group.children.length,
    dispose() { for (const g of geometries) g.dispose(); material.dispose() },
  }
}

/** House overview uses only saved bounding boxes; no recipes or detail exports are fetched. */
export function createWireframeOverview(components: ShellComponent[], ink: string, warning: string) {
  const rows = components.filter(c => c.status !== 'unavailable' && c.bounding_box_mm)
  if (!rows.length) return null
  const world = rows.map(c => corners(c.bounding_box_mm!).map(p => transformPoint(shellMatrix(c), p)))
  const bounds = pointBounds(world.flat()), origin = center(bounds), group = new Group()
  const geometries: BufferGeometry[] = [], materials: Material[] = []
  const pairs = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]]
  for (const flagged of [false, true]) {
    const positions: number[] = []
    rows.forEach((c, index) => {
      if ((c.status !== 'current') !== flagged) return
      for (const pair of pairs) for (const p of pair.map(i => world[index][i])) positions.push(...p.map((n, k) => n - origin[k]))
    })
    if (!positions.length) continue
    const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
    const material = flagged ? new LineDashedMaterial({ color: warning, dashSize: 60, gapSize: 40 }) : new LineBasicMaterial({ color: ink })
    const lines = new LineSegments(geometry, material)
    if (flagged) lines.computeLineDistances()
    group.add(lines); geometries.push(geometry); materials.push(material)
  }
  return { group, bounds: { min: bounds.min.map((n, i) => n - origin[i]), max: bounds.max.map((n, i) => n - origin[i]) },
    segments: rows.length * 12, drawCalls: group.children.length,
    dispose() { for (const g of geometries) g.dispose(); for (const m of materials) m.dispose() },
  }
}
