import {
  BoxGeometry, Color, CylinderGeometry, EdgesGeometry, Group, InstancedMesh, LineDashedMaterial,
  LineSegments, MeshLambertMaterial, StaticDrawUsage, type BufferGeometry, type Material,
} from 'three'
import type { ShellScene3D } from './shell3d'

/** Marker colour for pieces that changed since the shell pinned them (theme --clay). */
export const FLAGGED_MARKER = '#934418'

/**
 * three.js objects for a composed shell: one InstancedMesh per primitive kind and
 * piece colour, plus one dashed outline per flagged piece. Needs no WebGL context,
 * so draw calls and build time are testable in Node.
 */
export function createShellObjects(scene: ShellScene3D) {
  const box = new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)
  const cylinder = new CylinderGeometry(0.5, 0.5, 1, 16).rotateX(Math.PI / 2).translate(0, 0, 0.5)
  const geometries: BufferGeometry[] = [box, cylinder], materials: Material[] = []
  const group = new Group()
  const colours = new Map<number, MeshLambertMaterial>()
  for (const batch of scene.batches) {
    let material = colours.get(batch.colorIndex)
    if (!material) {
      material = new MeshLambertMaterial({ color: new Color().setStyle(scene.pieces[batch.colorIndex].color) })
      colours.set(batch.colorIndex, material); materials.push(material)
    }
    const mesh = new InstancedMesh(batch.kind === 'box' ? box : cylinder, material, batch.count)
    mesh.instanceMatrix.setUsage(StaticDrawUsage)
    ;(mesh.instanceMatrix.array as Float32Array).set(batch.matrices)
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.name = batch.key
    mesh.userData.pieceKey = batch.pieceKey
    group.add(mesh)
  }
  // Dashes are in mm; size them from the whole shell so they stay visible at house scale.
  const span = scene.bounds ? Math.max(...[0, 1, 2].map(i => scene.bounds!.max[i] - scene.bounds!.min[i])) : 1000
  // Drawn through walls so a changed piece is never hidden inside the house.
  const marker = new LineDashedMaterial({ color: FLAGGED_MARKER, dashSize: span / 60, gapSize: span / 120, depthTest: false, transparent: true })
  materials.push(marker)
  for (const piece of scene.pieces) {
    if (!piece.flagged || !piece.bounds) continue
    const size = [0, 1, 2].map(i => piece.bounds!.max[i] - piece.bounds!.min[i])
    const pad = Math.max(20, Math.max(...size) * 0.02)
    const outer = new BoxGeometry(size[0] + 2 * pad, size[1] + 2 * pad, size[2] + 2 * pad)
    const edges = new EdgesGeometry(outer)
    outer.dispose()
    geometries.push(edges)
    const outline = new LineSegments(edges, marker)
    outline.position.set(...([0, 1, 2].map(i => (piece.bounds!.min[i] + piece.bounds!.max[i]) / 2)) as [number, number, number])
    outline.computeLineDistances()
    outline.renderOrder = 1
    outline.name = `marker:${piece.key}`
    group.add(outline)
  }
  const drawCalls = group.children.length
  return {
    group,
    drawCalls,
    dispose() { for (const g of geometries) g.dispose(); for (const m of materials) m.dispose() },
  }
}
