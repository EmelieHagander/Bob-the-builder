import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createArtifacts } from '../src/data/artifacts'

// Construction sources share titles with the drawings rendered from them; the
// drawing library marks the exact listed construction versions (2026-10-21).
test('the drawing list marks exact construction-source versions apart from rendered drawings', async () => {
  const row = (id: string, revision: number) => ({ id, artifact_id: id, project_id: 'A', area_id: null, revision, kind: 'detail', title: 'Bunk bed left gable',
    description: '', status: 'concept', assumptions: '', target_revision: 1, solution_id: 's', solution_revision: 1, solution_title: 'Bunk bed', archived: false,
    change_note: '', actor_label: '', recorded_at: '2026-10-21T17:52:00Z', generator: null, generator_version: null })
  const ids = { drawing: '4f7274ae-d76e-4cdc-94c9-eb51827f7ee4', construction: 'dafa721c-3aa6-406d-aa18-fb658c00223b' }
  const tables: Record<string, unknown[]> = {
    current_artifacts: [row(ids.drawing, 1), row(ids.construction, 14)],
    artifact_parametric_recipes: [], artifact_source_status: [],
    // An older construction version of the drawing's id must not mark the current drawing.
    artifact_construction_revisions: [{ artifact_id: ids.construction, artifact_revision: 14 }, { artifact_id: ids.drawing, artifact_revision: 7 }],
  }
  const filters: Record<string, string> = {}
  const fake = { from(table: string) {
    const result = { data: tables[table], error: null }
    const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      or: (filter: string) => { filters[table] = filter; return chain }, range: () => Promise.resolve(result),
      then: (resolve: (value: unknown) => void) => resolve(result) }
    return chain
  } }
  const { items } = await createArtifacts(fake as any, () => () => {}).list('A')
  assert.deepEqual(items.map(item => [item.id, item.isConstruction]), [[ids.drawing, false], [ids.construction, true]])
  assert.match(filters.artifact_construction_revisions, /artifact_revision\.eq\.14/)
})
