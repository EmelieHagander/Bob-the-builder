// Called by the existing live foundation proof in its disposable project.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }

export async function verifyProjectFacts(client, projectId, areaId, imageId) {
  const componentId = randomUUID(), measurementId = randomUUID()
  const command = (kind, action, id, expected, data = {}) => client.rpc('evidence_command', {
    p_project: projectId, p_kind: kind, p_action: action, p_record: id, p_expected: expected, p_data: data,
  })
  const read = (table, id) => client.from(table).select('*').eq('project_id', projectId).eq('id', id).single()
  const initial = {
    subject: 'Disposable opening width', value: null, unit: 'mm', truth: 'unknown', source: '', required: true,
    source_media_id: imageId,
  }
  checked(await command('component', 'create', componentId, 0, {
    name: 'Disposable existing window', kind: 'Window', quantity: null, condition: '', intent: 'inspect', area_id: areaId,
    source_media_id: imageId,
  }))
  assert.equal(checked(await read('current_components', componentId)).quantity, null)
  checked(await command('measurement', 'create', measurementId, 0, { ...initial, component_id: componentId }))
  const unknown = checked(await read('current_measurements', measurementId))
  assert.equal(unknown.value, null); assert.equal(unknown.truth, 'unknown')
  assert.equal(unknown.component_id, componentId); assert.equal(unknown.area_id, areaId)
  assert.equal(unknown.source_media_id, imageId)
  const estimate = { ...initial, value: '1.25', unit: 'm', truth: 'estimated', source: 'Disposable estimate', change_note: 'Estimate first' }
  checked(await command('measurement', 'revise', measurementId, 1, estimate))
  assert.equal(Number(checked(await read('current_measurements', measurementId)).millimetres), 1250)
  const measured = { ...initial, value: '1254', truth: 'measured', source: 'Disposable tape reading', change_note: 'Supersede estimate' }
  checked(await command('measurement', 'revise', measurementId, 2, measured))
  assert((await command('measurement', 'revise', measurementId, 2, estimate)).error, 'Stale edit denied')
  assert((await command('measurement', 'revise', measurementId, 3, { ...initial, value: 10, change_note: 'False unknown' })).error, 'Unknown cannot contain a numeric value')
  assert((await command('measurement', 'revise', measurementId, 3, { ...measured, recorded_by: randomUUID() })).error, 'Actor spoofing denied')
  assert((await client.from('measurement_revisions').update({ truth: 'measured' }).eq('measurement_id', measurementId)).error, 'Old provenance cannot be updated directly')
  const history = checked(await client.from('measurement_revisions').select('revision,truth,value,unit,source,recorded_by')
    .eq('project_id', projectId).eq('measurement_id', measurementId).order('revision'))
  assert.deepEqual(history.map(r => r.truth), ['unknown', 'estimated', 'measured'])
  assert.equal(history[1].source, 'Disposable estimate')
  assert.equal(history[2].recorded_by, (await client.auth.getUser()).data.user.id)
  const observed = { name: 'Disposable existing window', kind: 'Window', quantity: 2, condition: 'Test observation only',
    intent: 'reuse', source_media_id: imageId, change_note: 'Record count and intention' }
  checked(await command('component', 'revise', componentId, 1, observed))
  checked(await command('component', 'archive', componentId, 2))
  assert.equal(checked(await read('current_components', componentId)).archived, true)
  assert.equal(checked(await read('current_measurements', measurementId)).archived, false)
  checked(await command('component', 'restore', componentId, 3))
  const restored = checked(await read('current_components', componentId))
  assert.equal(restored.quantity, 2); assert.equal(restored.intent, 'reuse'); assert.equal(restored.archived, false)
  assert.deepEqual(checked(await client.from('current_measurements').select('id').eq('project_id', 'p_bygga_in_entren')), [])
  assert((await client.rpc('evidence_command', { p_project: 'p_bygga_in_entren', p_kind: 'measurement',
    p_action: 'create', p_record: randomUUID(), p_expected: 0, p_data: initial })).error, 'No access granted to real projects')
  console.log('Live project facts: unknown/estimate/measured history, exact units, component dimensions, source image, stale edit denial, archive/restore and project authority passed. No AI invoked.')
  return { measurementId, componentId }
}

export async function verifyFactImageCleanup(client, projectId, records) {
  for (const [table, id] of [['current_measurements', records.measurementId], ['current_components', records.componentId]]) {
    const row = checked(await client.from(table).select('source_media_id,source_media_title').eq('project_id', projectId).eq('id', id).single())
    assert.equal(row.source_media_id, null)
    assert.equal(row.source_media_title, 'Disposable foundation image')
  }
  const revisions = checked(await client.from('measurement_revisions').select('truth,value,source_media_id').eq('project_id', projectId).eq('measurement_id', records.measurementId))
  assert.equal(revisions.length, 3)
  assert(revisions.every(r => r.source_media_id === null))
  console.log('Live project facts: image deletion cleared file links and preserved recorded values and history.')
}
