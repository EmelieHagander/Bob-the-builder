import { useState } from 'react'
import * as db from '../data/database'
import type { Artifact } from '../data/types'
import { ARTIFACT_KINDS } from '../data/artifacts'
import { FormError } from './form'
import { Modal } from './Modal'
import { Loading, useAsync } from './ui'
import { StoredImage } from './ProjectImages'
import { SolutionEvidence } from './SolutionEvidence'

export const artifactError = (e: unknown) => e instanceof Error ? e.message : String(e)
export function ArtifactRetry({ error, retry }: { error: Error; retry: () => void }) {
  return <div role="alert"><FormError>{error.message}</FormError><button className="btn" onClick={retry}>Reload drawings/references</button></div>
}
export function ArtifactPager({ offset, size = 24, more, move }: { offset: number; size?: number; more: boolean; move: (n: number) => void }) {
  return <div className="foundation-actions">
    {offset > 0 && <button className="btn" onClick={() => move(Math.max(0, offset - size))}>Previous page</button>}
    {more && <button className="btn" onClick={() => move(offset + size)}>Next page</button>}
  </div>
}
export function ArtifactStatus({ value: v }: { value: Artifact }) {
  return <div className="fact-details">
    <span className="image-purpose">{ARTIFACT_KINDS[v.kind]} · Version {v.revision} · Manual reference</span>
    <p>Based on {v.solutionTitle} · Solution version {v.solutionRevision}</p>
    {v.latestRevision !== v.revision && <p className="solution-attention">Newer reference available: version {v.latestRevision}. This reference keeps version {v.revision}.</p>}
    {(v.archived || v.currentlyArchived) && <p className="solution-attention">Drawing/reference archived.</p>}
    {v.targetChanged && <p className="solution-attention">Project target changed or cleared since this version. Review before use.</p>}
    {v.evidenceChanged && <p className="solution-attention">Measurements changed since the selected solution version. Saved values are retained.</p>}
    {!v.imageReady && <p className="solution-attention">Image removed or unavailable: {v.imageTitle}</p>}
  </div>
}
export function ArtifactDetails({ projectId, id, revision, onClose }: { projectId: string; id: string; revision: number; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0), [image, setImage] = useState(false)
  const { data, loading, error } = useAsync(async () => {
    const value = await db.getArtifactVersion(projectId, id, revision)
    const solution = await db.getSolutionVersion(projectId, value.solutionId, value.solutionRevision)
    return { value, solution }
  }, [projectId, id, revision, attempt])
  const v = data?.value
  return <Modal title={v ? v.title + ' · Version ' + v.revision : 'Drawing/reference version'} onClose={onClose}>
    {loading ? <Loading /> : error ? <ArtifactRetry error={error} retry={() => setAttempt(n => n + 1)} /> : v && data && <>
      <ArtifactStatus value={v} />
      <div className="fact-details"><p>{v.notes}</p><p><strong>Source and preparation:</strong> {v.source}</p>
        <p><strong>Unresolved checks:</strong> {v.unresolved || 'Not recorded'}</p>
        <p className="foundation-hint">{v.actor} · {new Date(v.recordedAt).toLocaleString()} · {v.reason}</p>
        <h3>Recorded solution basis</h3><p>{data.solution.description}</p>
        <p><strong>Assumptions:</strong> {data.solution.assumptions || 'Not recorded'}</p>
        <p>Target decision {v.targetRevision} · Solution version {v.solutionRevision}</p>
      </div>
      <SolutionEvidence items={data.solution.measurements} />
      <p className="foundation-hint">Manually supplied reference. Dimensions and construction readiness are not verified by this record.</p>
      {v.imageReady && v.imageId && <button className="btn" onClick={() => setImage(true)}>Open original image</button>}
      {image && v.imageId && <Modal title={v.imageTitle} wide onClose={() => setImage(false)}>
        <StoredImage projectId={projectId} image={{ id: v.imageId, title: v.imageTitle }} original />
      </Modal>}
    </>}
  </Modal>
}
