/**
 * House-size 3D view of a shell drawing, composed in the browser from each pinned
 * piece's saved CAD recipe (artifact_cad_revisions.recipe). The Modal renderer is
 * never asked to draw the whole shell, so its 512-instance limit per recipe does
 * not apply to the combined view.
 *
 * Pure math, no three.js: the lazy 3D component turns batches into InstancedMeshes.
 * Coordinates follow the CAD contract (cadCoordinateSystem in cad-frames.ts): mm,
 * Z up, build123d 0.13 intrinsic XYZ rotations (R = Rx·Ry·Rz), box origin at its
 * minimum corner, cylinders/tubes centred in XY starting at z=0. The shell places
 * a piece by rotating it a quarter turn about z at the piece origin, then moving it
 * (same as shellFootprint). Matrices are 4×4 column-major, like three.js.
 */
import { parseCadAssemblyRequest, type CadPlacement, type CadPrimitive } from '../../supabase/functions/_shared/cad-adapter.ts'
import type { ShellComponent } from './cadShell'

export type Mat4 = number[]
export type ShellPrimitiveKind = 'box' | 'cylinder'
/** drawn; status unavailable; no recipe row for the pinned revision; recipe that fails the CAD contract. */
export type ShellPieceState = 'drawn' | 'unavailable' | 'no_recipe' | 'invalid_recipe'
export interface ShellPiece3D {
  key: string; title: string; revision: number; status: ShellComponent['status']; state: ShellPieceState
  colorIndex: number; color: string; flagged: boolean; primitives: number
  /** Holes, notches and tube bores are drawn as their blank solids. */
  simplified: boolean
  bounds: { min: number[]; max: number[] } | null
}
export interface ShellBatch { key: string; kind: ShellPrimitiveKind; pieceKey: string; colorIndex: number; count: number; matrices: Float32Array }
export interface ShellScene3D { pieces: ShellPiece3D[]; batches: ShellBatch[]; bounds: { min: number[]; max: number[] } | null; primitives: number }

/** Exact for quarter turns so placed corners land on whole millimetres. */
function cosSin(deg: number): [number, number] {
  const q = deg / 90
  if (Number.isInteger(q)) return ([[1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][])[((q % 4) + 4) % 4]
  const r = deg * Math.PI / 180
  return [Math.cos(r), Math.sin(r)]
}
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return out
}
const translation = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const scale = (x: number, y: number, z: number): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
function rotX(deg: number): Mat4 { const [c, s] = cosSin(deg); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1] }
function rotY(deg: number): Mat4 { const [c, s] = cosSin(deg); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] }
function rotZ(deg: number): Mat4 { const [c, s] = cosSin(deg); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }

/** Instance placement inside its piece: T · Rx · Ry · Rz. */
export const placementMatrix = (p: CadPlacement): Mat4 =>
  multiply(translation(p.x, p.y, p.z), multiply(rotX(p.rx), multiply(rotY(p.ry), rotZ(p.rz))))
/** Piece placement inside the shell: T · Rz(quarter turn). */
export const shellMatrix = (c: Pick<ShellComponent, 'x_mm' | 'y_mm' | 'z_mm' | 'rz'>): Mat4 =>
  multiply(translation(c.x_mm, c.y_mm, c.z_mm), rotZ(c.rz))
/** Scales the unit geometry: a 1 mm cube from the origin, or a 1 mm diameter × 1 mm cylinder along +z centred in XY. */
export function shapeMatrix(d: CadPrimitive): { kind: ShellPrimitiveKind; matrix: Mat4 } {
  if (d.primitive === 'box') return { kind: 'box', matrix: scale(d.x_mm, d.y_mm, d.z_mm) }
  const diameter = d.primitive === 'tube' ? d.outside_diameter_mm : d.diameter_mm
  return { kind: 'cylinder', matrix: scale(diameter, diameter, d.length_mm) }
}
export function transformPoint(m: Mat4, p: number[]): number[] {
  return [0, 1, 2].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
}
const UNIT_CORNERS: Record<ShellPrimitiveKind, number[][]> = {
  box: [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => [x, y, z]))),
  cylinder: [-0.5, 0.5].flatMap(x => [-0.5, 0.5].flatMap(y => [0, 1].map(z => [x, y, z]))),
}

/** Distinct piece colours: golden-angle hues at a lightness that reads on the light canvas and under shading. */
export function pieceColor(index: number): string {
  const hue = Math.round((index * 137.508 + 28) % 360)
  return `hsl(${hue}, 52%, ${index % 2 ? 48 : 58}%)`
}

export interface ShellPieceInput { component: ShellComponent; recipe: unknown }

/** Builds one batch per piece and primitive kind; each piece has its own colour, so that is one batch per kind and colour. */
export function buildShellScene(inputs: ShellPieceInput[]): ShellScene3D {
  const pieces: ShellPiece3D[] = [], batches: ShellBatch[] = []
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  let primitives = 0
  inputs.forEach(({ component: c, recipe: raw }, colorIndex) => {
    const piece: ShellPiece3D = { key: c.component_key, title: c.child_title ?? c.component_key, revision: c.child_revision, status: c.status,
      state: 'drawn', colorIndex, color: pieceColor(colorIndex), flagged: c.status !== 'current', primitives: 0, simplified: false, bounds: null }
    pieces.push(piece)
    if (c.status === 'unavailable') { piece.state = 'unavailable'; return }
    if (raw === undefined || raw === null) { piece.state = 'no_recipe'; return }
    const recipe = parseCadAssemblyRequest(raw)
    if (!recipe) { piece.state = 'invalid_recipe'; return }
    const outer = shellMatrix(c), defs = new Map(recipe.definitions.map(d => [d.id, d]))
    const shapes = new Map(recipe.definitions.map(d => [d.id, shapeMatrix(d)]))
    const lists: Record<ShellPrimitiveKind, number[]> = { box: [], cylinder: [] }
    const pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity]
    for (const instance of recipe.instances) {
      const def = defs.get(instance.definition_id)!, shape = shapes.get(instance.definition_id)!
      if (def.primitive === 'tube' || def.cuts?.length) piece.simplified = true
      const m = multiply(outer, multiply(placementMatrix(instance.placement), shape.matrix))
      lists[shape.kind].push(...m)
      for (const corner of UNIT_CORNERS[shape.kind]) {
        const p = transformPoint(m, corner)
        for (let i = 0; i < 3; i++) { pmin[i] = Math.min(pmin[i], p[i]); pmax[i] = Math.max(pmax[i], p[i]) }
      }
    }
    for (const kind of ['box', 'cylinder'] as const) {
      const values = lists[kind]
      if (values.length) batches.push({ key: `${kind}:${colorIndex}`, kind, pieceKey: c.component_key, colorIndex, count: values.length / 16, matrices: Float32Array.from(values) })
    }
    piece.primitives = recipe.instances.length
    piece.bounds = { min: pmin, max: pmax }
    primitives += recipe.instances.length
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], pmin[i]); max[i] = Math.max(max[i], pmax[i]) }
  })
  return { pieces, batches, bounds: primitives ? { min, max } : null, primitives }
}

/** Camera distance that fits a bounding sphere in a perspective view, for both the vertical and horizontal field of view. */
export function fitDistance(bounds: { min: number[]; max: number[] }, fovDeg: number, aspect: number) {
  const center = [0, 1, 2].map(i => (bounds.min[i] + bounds.max[i]) / 2)
  const radius = Math.max(1, Math.hypot(...[0, 1, 2].map(i => bounds.max[i] - bounds.min[i])) / 2)
  const vertical = fovDeg * Math.PI / 360, horizontal = Math.atan(Math.tan(vertical) * aspect)
  return { center, radius, distance: radius / Math.sin(Math.min(vertical, horizontal)) * 1.08 }
}
