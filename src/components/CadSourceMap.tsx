import { useMemo, useState } from 'react'
import { cadSourceIdentity, readCadSourceMap } from '../lib/cadSourceMap'
import type { DrawingSourceStatus } from '../data/drawingSources'

const messages = {
  complete: 'Every controlling value has a recorded source, design choice, estimate or calculation. This is provenance coverage, not construction approval.',
  partial: 'Partial source tracking. Only the recorded bindings identify sources; other saved values have unknown provenance.',
  legacy_untracked: 'Legacy drawing — parameter sources were not tracked. Saved numbers do not prove they were measured or chosen deliberately.',
  invalid: 'Source map unavailable: the recorded metadata could not be validated. Check the original evidence before using this drawing.',
  unavailable: 'Recorded parameter evidence is withheld from this preview while project scope or current source access cannot be checked.',
}
const sourceKinds = { project_measurement: 'Project measurement', space_measurement: 'Space measurement', drawing: 'Source drawing', target: 'Selected target', image: 'Image' }

export function CadSourceMap({ recipe, manifest, projectId, sourceStatus }: {
  recipe: Record<string, unknown>; manifest?: Record<string, unknown>; projectId?: string; sourceStatus?: DrawingSourceStatus
}) {
  const map = useMemo(() => sourceStatus?.source_state === 'unavailable'
    ? { state: 'unavailable' as const, rows: [], frames: [], coordinates: null }
    : readCadSourceMap(recipe, manifest, projectId), [recipe, manifest, projectId, sourceStatus?.source_state])
  const [limit, setLimit] = useState(50)
  return <details className="cad-source-map fact-card">
    <summary>Parameter sources and changes</summary>
    <p className="foundation-hint">{messages[map.state]}</p>
    {sourceStatus?.source_state === 'changed' && <p className="solution-attention">Sources have changed. Saved parameter values below still belong to this drawing revision.</p>}
    {sourceStatus?.source_state === 'unavailable' && <p className="solution-attention">Current source access or freshness could not be checked.</p>}
    {sourceStatus?.source_state === 'current' && <p className="foundation-hint">Tracked sources match the checked current records. Estimates and design choices retain their recorded classifications.</p>}
    {!!sourceStatus?.changes?.length && <div aria-label="Recorded source changes">
      <h3>What changed since this revision</h3>
      <ul className="fact-list">{sourceStatus.changes.map((change, index) => <li key={`${change.kind}:${change.id ?? 'unavailable'}:${index}`} className="fact-source">
        <p><strong>{sourceKinds[change.kind]}</strong> · {change.state === 'changed' ? 'Changed' : 'Unavailable'}</p>
        <p>{change.id ?? 'Source identity unavailable with current access'}</p>
        {change.saved_revision !== undefined && <p>Saved revision: {change.saved_revision} · current revision: {change.current_revision ?? 'unavailable'}</p>}
        {change.saved_version !== undefined && <p>Saved version / hash: {change.saved_version}</p>}
        {change.saved_version !== undefined && <p>Current version / hash: {change.current_version ?? 'unavailable'}</p>}
        {!!change.parameter_ids.length && <p>Affected parameter IDs: {change.parameter_ids.join(', ')}</p>}
      </li>)}</ul>
    </div>}
    {sourceStatus?.changesTruncated && <p className="solution-attention">Only part of the source change list is available. Review all original evidence before using this drawing.</p>}
    {(sourceStatus?.changesUnavailable || (sourceStatus?.source_state !== 'current' && !sourceStatus?.changes?.length)) && <p className="foundation-hint">Exact changed source identities are unavailable in this source-status response. No replacement geometry is inferred.</p>}
    {map.rows.length > 0 && <ul className="fact-list">{map.rows.slice(0, limit).map(row => <li key={row.id} className="fact-source">
      <p><strong>{row.id}</strong> · {row.category}</p>
      <p>Saved value: {row.value ?? 'unknown'} {row.unit}</p>
      {row.reason && <p>{row.reason}</p>}
      {row.paths.length > 0 && <details><summary>Controls {row.paths.length} recipe {row.paths.length === 1 ? 'value' : 'values'}</summary><ul>{row.paths.map(path => <li key={path}>{path}</li>)}</ul></details>}
      {row.sources.map(source => <div key={`${source.kind}:${source.id}`}>
        <p>{cadSourceIdentity(source)}</p>
        <p>Original value: {source.value} {source.unit} · truth: {source.truth}</p>
        <p>{source.description}</p>
      </div>)}
      {row.operands.length > 0 && <p>Calculation: {row.operation} · inputs {row.operands.join(', ')} · rounding {row.rounding}. Input uncertainty remains in the source and estimate rows.</p>}
    </li>)}</ul>}
    {map.rows.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + 50)}>Show next {Math.min(50, map.rows.length - limit)} parameters ({limit} of {map.rows.length} shown)</button>}
    {map.coordinates && <div className="fact-source"><strong>Recorded coordinate description</strong>{Object.entries(map.coordinates).map(([key, value]) => <p key={key}>{key}: {value ?? 'unknown'}</p>)}</div>}
    {map.frames.map(frame => <div key={frame.id} className="fact-source">
      <p><strong>Coordinate frame {frame.id}</strong> · {frame.kind}</p>
      <p>Source: {frame.source_ref}</p>
      {frame.source_version && <p>Saved source version / hash: {frame.source_version}</p>}
      <p>{frame.reason}</p>
      {frame.placement ? <><p>Translation (mm): {frame.translation_mm?.join(', ')}</p><p>Rotation (degrees): {frame.rotation_degrees?.join(', ')}</p></> : <p>Origin and orientation unknown. No transform was recorded.</p>}
    </div>)}
  </details>
}
