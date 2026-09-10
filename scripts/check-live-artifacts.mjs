// Deployed Auth/PostgREST proof in the existing disposable foundation project.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const checked = r => { if (r.error) throw new Error(r.error.message); return r.data }
export async function verifyArtifacts(client, projectId, areaId, taskId, imageId, solutions) {
  const id = randomUUID()
  const command = (action, expected, data = {}) => client.rpc('artifact_command', {
    p_project: projectId, p_action: action, p_artifact: id, p_expected: expected, p_data: data,
  })
  const choose = (s, revision, expected) => client.rpc('solution_command', { p_project: projectId, p_action: 'select',
    p_solution: s, p_expected: expected, p_data: { solution_revision: revision, reason: 'Disposable drawing basis check' } })
  const draft = { title: 'Disposable porch plan', kind: 'plan', notes: 'Temporary manual reference', source: 'Verification fixture',
    unresolved: 'Construction readiness unverified', source_media_id: imageId, reviewed: true, expected_target_revision: 4 }
  const version = async revision => checked(await client.from('artifact_versions').select('*').eq('project_id', projectId).eq('artifact_id', id).eq('revision', revision).single())
  const link = (action, expected, previous) => command(action, expected, { task_id: taskId, expected_link_revision: previous })
  assert((await command('create', 0, { ...draft, area_id: areaId })).error, 'A cleared target blocks new references')
  checked(await choose(solutions.a, 4, 3))
  assert((await command('create', 0, { ...draft, reviewed: false })).error)
  checked(await command('create', 0, { ...draft, area_id: areaId }))
  checked(await link('attach', 1, 0))
  const first = await version(1)
  assert.equal(first.solution_revision, 4); assert.equal(first.target_changed, false)
  assert.equal(first.evidence_changed, true, 'Older selected measurement is visibly stale')
  checked(await choose(solutions.b, 1, 4))
  assert.equal((await version(1)).target_changed, true)
  assert((await command('revise', 1, { ...draft, change_note: 'Old target' })).error)
  checked(await command('revise', 1, { ...draft, expected_target_revision: 5, change_note: 'Reviewed for changed target' }))
  const second = await version(2)
  assert.equal(second.solution_id, solutions.b); assert.equal(second.target_changed, false); assert.equal(second.evidence_changed, false)
  const pinned = async () => checked(await client.from('task_artifacts').select('*').eq('project_id', projectId).eq('task_id', taskId).eq('artifact_id', id).single())
  assert.equal((await pinned()).revision, 1); assert.equal((await pinned()).latest_revision, 2)
  assert((await link('attach', 2, 0)).error)
  checked(await link('attach', 2, 1))
  assert((await link('detach', 2, 1)).error)
  assert((await command('revise', 1, { ...draft, expected_target_revision: 5, change_note: 'Old artifact' })).error)
  assert((await command('revise', 2, { ...draft, expected_target_revision: 5, recorded_by: randomUUID(), change_note: 'Spoof' })).error)
  assert((await client.from('artifact_revisions').update({ title: 'Overwrite history' }).eq('artifact_id', id)).error)
  checked(await command('archive', 2)); assert.equal((await pinned()).currently_archived, true)
  assert((await link('attach', 3, 2)).error)
  checked(await command('restore', 3))
  checked(await link('detach', 4, 2)); checked(await link('attach', 4, 0))
  assert.equal((await pinned()).revision, 4)
  assert.deepEqual(checked(await client.from('current_artifacts').select('id').eq('project_id', 'p_bygga_in_entren')), [])
  assert((await client.rpc('artifact_command', { p_project: 'p_bygga_in_entren', p_action: 'create', p_artifact: randomUUID(), p_expected: 0, p_data: draft })).error)
  console.log('Live artifacts: selected basis, stale evidence/target, version history, pinned task references, explicit update/detach, conflict/forgery denial and archive/restore passed. No AI invoked.')
  return { id, taskId }
}
export async function verifyArtifactImageCleanup(client, projectId, records) {
  const rows = checked(await client.from('artifact_versions').select('*').eq('project_id', projectId).eq('artifact_id', records.id))
  assert.equal(rows.length, 4)
  assert(rows.every(r => r.source_media_id === null && r.source_media_title === 'Disposable foundation image' && !r.image_ready))
  const pin = checked(await client.from('task_artifacts').select('revision,image_ready').eq('project_id', projectId).eq('task_id', records.taskId).eq('artifact_id', records.id).single())
  assert.equal(pin.revision, 4); assert.equal(pin.image_ready, false)
  assert.equal(checked(await client.from('target_revisions').select('revision').eq('project_id', projectId)).length, 5)
  console.log('Live artifacts: image removal preserved four revisions, five target decisions and the exact task reference.')
}
