import type { CadShell } from '../lib/cadShell'
import CadWireframeView from './CadWireframeView'

/** Lazy line viewer: shell overview first, one pinned CAD piece on demand. */
export default function CadShell3D({ value, projectId, onFallback }: { value: CadShell; projectId: string; onFallback: (message: string) => void }) {
  return <CadWireframeView projectId={projectId} title={value.title} components={value.components} onFallback={onFallback} />
}
