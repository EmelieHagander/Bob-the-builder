import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InstancedMesh, LineSegments } from 'three'
import { buildShellScene, fitDistance, placementMatrix, shellMatrix, transformPoint, multiply, type ShellPieceInput } from '../src/lib/shell3d.ts'
import { createShellObjects } from '../src/lib/shell3dObjects.ts'
import { shellFootprint, type ShellComponent } from '../src/lib/cadShell.ts'
import { intrinsicAxes } from '../supabase/functions/_shared/cad-frames.ts'

const near = (actual: number[], expected: number[], message?: string) =>
  assert.deepEqual(actual.map(v => Math.round(v * 1e6) / 1e6 || 0), expected, message)
const place = (p: Partial<Record<'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz', number>> = {}) => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ...p })
const recipe = (definitions: unknown[], instances: unknown[]) => ({ contract_version: 1, units: 'mm', assembly_id: 'piece', definitions, instances, views: ['isometric'] })
const component = (key: string, p: Partial<ShellComponent> = {}): ShellComponent => ({ component_key: key, child_artifact_id: '00000000-0000-4000-8000-000000000001', child_revision: 1,
  x_mm: 0, y_mm: 0, z_mm: 0, rz: 0, placement_basis: 'shared_origin', reason: 'Fixture', child_title: key, child_current_revision: 1, bounding_box_mm: null, status: 'current', ...p })

test('instance rotation matches the CAD contract (build123d intrinsic XYZ)', () => {
  for (const [rx, ry, rz] of [[90, 0, 0], [0, 90, 0], [0, 0, 90], [90, 0, 90], [30, 45, 60], [-120, 15, 200]]) {
    const m = placementMatrix(place({ rx, ry, rz }))
    const axes = intrinsicAxes([rx, ry, rz])
    for (let i = 0; i < 3; i++) near([m[i * 4], m[i * 4 + 1], m[i * 4 + 2]], axes[i].map(v => Math.round(v * 1e6) / 1e6 || 0), `axis ${i} for ${rx},${ry},${rz}`)
  }
  // rx then rz, intrinsic: x lands on +z.
  near(transformPoint(placementMatrix(place({ rx: 90, rz: 90 })), [1, 0, 0]), [0, 0, 1])
})

test('recipe primitives land at known shell coordinates after offset and quarter turn', () => {
  const box = { id: 'board', primitive: 'box', material_ref: null, x_mm: 100, y_mm: 50, z_mm: 20 }
  const post = { id: 'post', primitive: 'cylinder', material_ref: null, diameter_mm: 40, length_mm: 300 }
  const c = component('bed', { x_mm: 1000, y_mm: 2000, z_mm: 5, rz: 90 })
  const scene = buildShellScene([{ component: c, recipe: recipe([box, post], [
    { id: 'board.1', definition_id: 'board', placement: place({ x: 10, rz: 90 }) },
    { id: 'post.1', definition_id: 'post', placement: place({ x: 500, rx: 90 }) },
  ]) }])
  const boards = scene.batches.find(b => b.kind === 'box')!, posts = scene.batches.find(b => b.kind === 'cylinder')!
  const m = Array.from(boards.matrices)
  // Box far corner (100,50,20): instance Rz90 → (-50,100,20), +x10 → (-40,100,20); shell Rz90 → (-100,-40,20), + offset.
  near(transformPoint(m, [1, 1, 1]), [900, 1960, 25])
  near(transformPoint(m, [0, 0, 0]), [1000, 2010, 5], 'box minimum corner sits at the instance origin')
  // Cylinder axis +z turned by rx90 to -y, then the shell quarter turn takes -y to +x.
  const p = Array.from(posts.matrices)
  near(transformPoint(p, [0, 0, 0]), [1000, 2500, 5])
  near(transformPoint(p, [0, 0, 1]), [1300, 2500, 5])
  near(transformPoint(p, [0.5, 0, 0]), [1000, 2520, 5], 'diameter scaled from the 1 mm unit cylinder')
  assert.equal(scene.primitives, 2)
  near(scene.bounds!.min, [900, 1960, -15])
  near(scene.bounds!.max, [1300, 2520, 25])
})

test('a piece box placed in the shell matches the plan footprint', () => {
  const room = { id: 'floor', primitive: 'box', material_ref: null, x_mm: 2000, y_mm: 900, z_mm: 1600 }
  for (const rz of [0, 90, 180, 270]) {
    const c = component('bed', { x_mm: 300, y_mm: -200, rz, bounding_box_mm: { min: [0, 0, 0], max: [2000, 900, 1600], size: [2000, 900, 1600] } })
    const scene = buildShellScene([{ component: c, recipe: recipe([room], [{ id: 'floor.1', definition_id: 'floor', placement: place() }]) }])
    const f = shellFootprint(c)!, b = scene.pieces[0].bounds!
    near([b.min[0], b.min[1], b.max[0] - b.min[0], b.max[1] - b.min[1]], [f.x, f.y, f.width, f.depth], `rz ${rz}`)
  }
  near(multiply(shellMatrix({ x_mm: 0, y_mm: 0, z_mm: 0, rz: 0 }), placementMatrix(place())), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
})

test('honest piece states: unavailable, no recipe, unreadable recipe, flagged', () => {
  const ok = recipe([{ id: 'b', primitive: 'box', material_ref: null, x_mm: 10, y_mm: 10, z_mm: 10 }], [{ id: 'b.1', definition_id: 'b', placement: place() }])
  const tube = recipe([{ id: 't', primitive: 'tube', material_ref: null, outside_diameter_mm: 40, wall_thickness_mm: 3, length_mm: 100 }], [{ id: 't.1', definition_id: 't', placement: place() }])
  const scene = buildShellScene([
    { component: component('gone', { status: 'unavailable' }), recipe: ok },
    { component: component('none'), recipe: undefined },
    { component: component('bad'), recipe: { contract_version: 2 } },
    { component: component('newer', { status: 'newer_revision' }), recipe: ok },
    { component: component('pipe'), recipe: tube },
  ])
  assert.deepEqual(scene.pieces.map(p => p.state), ['unavailable', 'no_recipe', 'invalid_recipe', 'drawn', 'drawn'])
  assert.deepEqual(scene.pieces.map(p => p.flagged), [true, false, false, true, false])
  assert.equal(scene.pieces[4].simplified, true, 'tube bores are not drawn, and the legend says so')
  assert.equal(new Set(scene.pieces.map(p => p.color)).size, 5)
  const objects = createShellObjects(scene)
  assert.deepEqual(objects.group.children.map(o => o.name), ['box:3', 'cylinder:4', 'marker:newer'])
  objects.dispose()
  assert.equal(buildShellScene([{ component: component('none'), recipe: null }]).bounds, null)
})

test('fit distance keeps the whole bounding sphere in a narrow phone view', () => {
  const { center, radius, distance } = fitDistance({ min: [0, 0, 0], max: [12000, 9000, 6000] }, 45, 0.5)
  near(center, [6000, 4500, 3000])
  assert(distance * Math.sin(Math.atan(Math.tan(45 * Math.PI / 360) * 0.5)) >= radius)
})

/** Synthetic house: 24 pieces, ~5,000 primitives (studs, joists, posts) — well past one 512-instance recipe. */
export function syntheticHouse(pieces = 24, perPiece = 210): ShellPieceInput[] {
  return Array.from({ length: pieces }, (_, n) => {
    const defs = [
      { id: 'stud', primitive: 'box', material_ref: null, x_mm: 45, y_mm: 95, z_mm: 2400 },
      { id: 'joist', primitive: 'box', material_ref: null, x_mm: 45, y_mm: 195, z_mm: 4000 },
      { id: 'post', primitive: 'cylinder', material_ref: null, diameter_mm: 120, length_mm: 2400 },
    ]
    const instances = Array.from({ length: perPiece }, (_, i) => ({ id: `p${i}`, definition_id: defs[i % 3].id,
      placement: place({ x: (i % 30) * 600, y: Math.floor(i / 30) * 600, z: i % 3 === 1 ? 2400 : 0, ry: i % 3 === 1 ? 90 : 0 }) }))
    return { component: component(`piece-${n}`, { x_mm: (n % 6) * 20000, y_mm: Math.floor(n / 6) * 6000, rz: (n % 4) * 90,
      status: n % 7 === 0 ? 'newer_revision' : 'current' }), recipe: recipe(defs, instances) }
  })
}

test('a ~5,000-primitive shell builds quickly with one draw call per kind and colour', () => {
  const inputs = syntheticHouse()
  const started = performance.now()
  const scene = buildShellScene(inputs)
  const objects = createShellObjects(scene)
  const elapsed = performance.now() - started
  assert.equal(scene.primitives, 24 * 210)
  assert(scene.primitives >= 5000)
  const meshes = objects.group.children.filter(o => o instanceof InstancedMesh) as InstancedMesh[]
  const markers = objects.group.children.filter(o => o instanceof LineSegments)
  assert.equal(meshes.length, 24 * 2, 'one InstancedMesh per piece colour and primitive kind (box, cylinder)')
  assert.equal(markers.length, 4, 'one outline per piece flagged newer_revision')
  assert.equal(objects.drawCalls, 52)
  assert.equal(meshes.reduce((n, m) => n + m.count, 0), scene.primitives)
  assert(elapsed < 1500, `built in ${elapsed.toFixed(0)} ms`)
  console.log(`# synthetic shell: ${scene.primitives} primitives, ${objects.drawCalls} draw calls, built in ${elapsed.toFixed(0)} ms`)
  objects.dispose()
})
