import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three'
import type { ConstructionModel } from '../domain/constructionModel'

/** Every canonical instance is retained; reference volumes use outlines. */
export function constructionModelObjects(model: ConstructionModel) {
  const geometry = new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)
  const group = new Group(), materials: MeshStandardMaterial[] = []
  const groups = new Map<string, typeof model.parts>()
  for (const part of model.parts) {
    const key = `${part.materialId}@${part.materialRevision}:${part.color}:${part.role}`
    groups.set(key, [...(groups.get(key) ?? []), part])
  }
  for (const [key, parts] of groups) {
    const material = new MeshStandardMaterial({ color: parts[0].color, roughness: 0.8, metalness: 0, wireframe: parts[0].role === 'reference' })
    materials.push(material)
    const mesh = new InstancedMesh(geometry, material, parts.length)
    parts.forEach((part, i) => mesh.setMatrixAt(i, new Matrix4().fromArray(part.matrix)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.name = key
    mesh.userData.instanceIds = parts.map(part => part.id)
    group.add(mesh)
  }
  return { group, dispose() { geometry.dispose(); for (const material of materials) material.dispose() } }
}
