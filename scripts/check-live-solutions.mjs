// Deployed API proof in the existing foundation script's disposable project.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const checked = r => { if (r.error) throw new Error(r.error.message); return r.data }
export async function verifySolutions(client, projectId, areaId, imageId, facts) {
  const a = randomUUID(), b = randomUUID()
  const command = (action, id, expected, data = {}) => client.rpc('solution_command', {
    p_project: projectId, p_action: action, p_solution: id, p_expected: expected, p_data: data,
  })
  const proposal = { title: 'Disposable retained porch', description: 'Temporary solution check', assumptions: 'Unverified foundation',
    tradeoffs: 'Less room', source_media_id: imageId, measurements: [{ id: facts.measurementId, revision: 2 }] }
  const target = async () => checked(await client.from('current_target').select('*').eq('project_id', projectId).single())
  checked(await command('create', a, 0, { ...proposal, area_id: areaId }))
  checked(await command('create', b, 0, { title: 'Disposable extension', description: 'Alternative option' }))
  checked(await command('select', a, 0, { solution_revision: 1, reason: 'Preserve first option' }))
  checked(await command('revise', a, 1, { ...proposal, description: 'New candidate, not yet selected', change_note: 'Compare another door position' }))
  assert.equal((await target()).solution_revision, 1, 'Target stays on the selected revision')
  const evidence = checked(await client.from('solution_measurement_details').select('*').eq('project_id', projectId).eq('solution_id', a).eq('solution_revision', 1))
  assert.equal(evidence.length, 1); assert.equal(evidence[0].truth, 'estimated')
  assert.equal(Number(evidence[0].value), 1.25); assert.equal(evidence[0].measurement_revision, 2); assert.equal(evidence[0].latest_revision, 3)
  assert((await command('select', a, 1, { solution_revision: 1, reason: 'Stale candidate' })).error)
  assert((await command('select', b, 0, { solution_revision: 1, reason: 'Stale decision' })).error)
  assert((await command('archive', a, 2)).error, 'Selected alternative cannot be archived')
  assert((await command('revise', a, 2, { ...proposal, recorded_by: randomUUID(), change_note: 'Spoof' })).error)
  assert((await client.from('solution_revisions').update({ title: 'Overwrite history' }).eq('solution_id', a)).error)
  checked(await command('select', b, 1, { solution_revision: 1, reason: 'Explore the extension' }))
  checked(await command('archive', a, 2)); checked(await command('restore', a, 3))
  checked(await command('clear', null, 2, { reason: 'Wait for site inspection' }))
  assert.equal((await target()).solution_id, null)
  const trail = checked(await client.from('target_revisions').select('*').eq('project_id', projectId).order('revision'))
  assert.deepEqual(trail.map(r => r.solution_id), [a, b, null])
  assert.equal(trail[0].recorded_by, (await client.auth.getUser()).data.user.id)
  assert.deepEqual(checked(await client.from('current_solutions').select('id').eq('project_id', 'p_bygga_in_entren')), [])
  assert((await client.rpc('solution_command', { p_project: 'p_bygga_in_entren', p_action: 'create', p_solution: randomUUID(), p_expected: 0, p_data: proposal })).error)
  console.log('Live solutions: alternatives, pinned target/evidence, retained revisions, stale/forged write denial, archive/restore, decision history and project authority passed. No AI invoked.')
  return { a, b }
}
export async function verifySolutionImageCleanup(client, projectId, records) {
  const rows = checked(await client.from('solution_revisions').select('revision,source_media_id,source_media_title').eq('project_id', projectId).eq('solution_id', records.a))
  assert.equal(rows.length, 4)
  assert(rows.every(r => r.source_media_id === null && r.source_media_title === 'Disposable foundation image'))
  assert.equal(checked(await client.from('target_revisions').select('revision').eq('project_id', projectId).lte('revision', 3)).length, 3)
  console.log('Live solutions: image deletion preserved all four alternative versions and the decision trail.')
}
