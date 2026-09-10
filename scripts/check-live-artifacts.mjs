// Deployed API proof in the existing disposable foundation project. No AI calls.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }

export async function verifyArtifacts(client, projectId, areaId, imageId, facts, solutions) {
  const artifactId = randomUUID()
  const targetCommand = (action, id, expected, data = {}) => client.rpc('solution_command', {
    p_project: projectId,
    p_action: action,
    p_solution: id,
    p_expected: expected,
    p_data: data,
  })
  const command = (action, expected, data = {}) => client.rpc('artifact_command', {
    p_project: projectId,
    p_action: action,
    p_artifact: artifactId,
    p_expected: expected,
    p_data: data,
  })

  // verifySolutions deliberately finishes with a cleared target after three
  // target decisions. Select its second retained alternative again so a manual
  // drawing has one exact target to bind to.
  checked(await targetCommand('select', solutions.b, 3, {
    solution_revision: 1,
    reason: 'Use retained extension for drawing verification',
  }))
  const selected = checked(await client.from('current_target').select('*').eq('project_id', projectId).single())
  assert.equal(selected.revision, 4)
  assert.equal(selected.solution_id, solutions.b)
  assert.equal(selected.solution_revision, 1)

  checked(await command('create', 0, {
    title: 'Disposable entrance section',
    description: 'Manual section used only for deployed foundation verification.',
    kind: 'section',
    status: 'measured',
    assumptions: 'Disposable assumption: ground condition remains unverified.',
    source_media_id: imageId,
    area_id: areaId,
    target_revision: selected.revision,
    measurements: [{ id: facts.measurementId, revision: 3 }],
  }))

  let current = checked(await client.from('current_artifacts').select('*')
    .eq('project_id', projectId).eq('id', artifactId).single())
  assert.equal(current.revision, 1)
  assert.equal(current.area_id, areaId)
  assert.equal(current.target_revision, 4)
  assert.equal(current.solution_id, solutions.b)
  assert.equal(current.solution_revision, 1)
  assert.equal(current.source_media_id, imageId)
  assert.equal(current.source_media_title, 'Disposable foundation image')
  assert.equal(current.status, 'measured')
  assert.equal(current.recorded_by, (await client.auth.getUser()).data.user.id)

  let evidence = checked(await client.from('artifact_measurement_details').select('*')
    .eq('project_id', projectId).eq('artifact_id', artifactId).eq('artifact_revision', 1))
  assert.equal(evidence.length, 1)
  assert.equal(evidence[0].measurement_id, facts.measurementId)
  assert.equal(evidence[0].measurement_revision, 3)
  assert.equal(Number(evidence[0].value), 1254)
  assert.equal(evidence[0].truth, 'measured')

  // Change the source measurement after the drawing. The old drawing must keep
  // the exact value/version it was based on while exposing that a newer fact exists.
  checked(await client.rpc('evidence_command', {
    p_project: projectId,
    p_kind: 'measurement',
    p_action: 'revise',
    p_record: facts.measurementId,
    p_expected: 3,
    p_data: {
      subject: 'Disposable opening width',
      value: '1256',
      unit: 'mm',
      truth: 'measured',
      source: 'Disposable follow-up tape reading',
      required: true,
      source_media_id: imageId,
      change_note: 'Check drawing staleness',
    },
  }))
  evidence = checked(await client.from('artifact_measurement_details').select('*')
    .eq('project_id', projectId).eq('artifact_id', artifactId).eq('artifact_revision', 1))
  assert.equal(Number(evidence[0].value), 1254)
  assert.equal(evidence[0].measurement_revision, 3)
  assert.equal(evidence[0].latest_revision, 4)

  // Select the restored first solution (current revision 4). The old drawing
  // remains bound to target decision 4; trying to save an editor opened against
  // that old decision must fail instead of silently rebinding.
  checked(await targetCommand('select', solutions.a, 4, {
    solution_revision: 4,
    reason: 'Change target after drawing was recorded',
  }))
  assert((await command('revise', 1, {
    title: 'Disposable entrance section',
    description: 'Stale target edit must fail.',
    kind: 'section',
    status: 'measured',
    assumptions: '',
    source_media_id: imageId,
    target_revision: 4,
    measurements: [{ id: facts.measurementId, revision: 3 }],
    change_note: 'Stale target attempt',
  })).error, 'A stale target decision must reject the drawing save')

  checked(await command('revise', 1, {
    title: 'Disposable entrance section',
    description: 'Manual section deliberately revised for the newly selected target.',
    kind: 'section',
    status: 'build_ready',
    assumptions: 'Project label only; not engineering or permit approval.',
    source_media_id: imageId,
    target_revision: 5,
    measurements: [{ id: facts.measurementId, revision: 4 }],
    change_note: 'Adopt newly selected target',
  }))

  current = checked(await client.from('current_artifacts').select('*')
    .eq('project_id', projectId).eq('id', artifactId).single())
  assert.equal(current.revision, 2)
  assert.equal(current.target_revision, 5)
  assert.equal(current.solution_id, solutions.a)
  assert.equal(current.solution_revision, 4)
  assert.equal(current.status, 'build_ready')

  const history = checked(await client.from('artifact_revisions').select('*')
    .eq('project_id', projectId).eq('artifact_id', artifactId).order('revision'))
  assert.equal(history.length, 2)
  assert.equal(history[0].target_revision, 4)
  assert.equal(history[0].solution_id, solutions.b)
  assert.equal(history[0].solution_revision, 1)
  assert.equal(history[1].target_revision, 5)
  assert.equal(history[1].solution_id, solutions.a)
  assert.equal(history[1].solution_revision, 4)

  assert((await command('revise', 1, {
    title: 'Stale revision', description: 'Must fail', kind: 'section', status: 'concept',
    assumptions: '', source_media_id: imageId, target_revision: 5, measurements: [], change_note: 'Stale revision',
  })).error, 'A stale drawing revision must be denied')
  assert((await command('revise', 2, {
    title: 'Forged lineage', description: 'Must fail', kind: 'section', status: 'concept',
    assumptions: '', source_media_id: imageId, target_revision: 5, measurements: [],
    solution_id: solutions.b, change_note: 'Spoof solution parent',
  })).error, 'Client-supplied solution lineage must be denied')
  assert((await client.from('artifact_revisions').update({ status: 'build_ready' }).eq('artifact_id', artifactId)).error,
    'Raw drawing-history writes must be denied')

  checked(await command('archive', 2))
  checked(await command('restore', 3))
  const retained = checked(await client.from('artifact_revisions').select('revision,target_revision,solution_id,solution_revision,archived')
    .eq('project_id', projectId).eq('artifact_id', artifactId).order('revision'))
  assert.deepEqual(retained.map(row => row.archived), [false, false, true, false])
  assert(retained.slice(1).every(row => row.target_revision === 5 && row.solution_id === solutions.a && row.solution_revision === 4))
  const refs = checked(await client.from('artifact_measurements').select('artifact_revision,measurement_revision')
    .eq('project_id', projectId).eq('artifact_id', artifactId).order('artifact_revision'))
  assert.deepEqual(refs.map(row => row.measurement_revision), [3, 4, 4, 4])

  assert.deepEqual(checked(await client.from('current_artifacts').select('id').eq('project_id', 'p_bygga_in_entren')), [])
  assert((await client.rpc('artifact_command', {
    p_project: 'p_bygga_in_entren', p_action: 'create', p_artifact: randomUUID(), p_expected: 0,
    p_data: { title: 'Denied', description: 'Denied', kind: 'plan', status: 'concept', target_revision: 1, measurements: [] },
  })).error, 'No access is granted to the real porch project by the disposable verifier')

  console.log('Live drawings: exact target/solution/measurement lineage, stale target/revision denial, server actor, archive/restore and project authority passed. No AI invoked.')
  return { artifactId }
}

export async function verifyArtifactImageCleanup(client, projectId, records) {
  const rows = checked(await client.from('artifact_revisions').select('revision,source_media_id,source_media_title')
    .eq('project_id', projectId).eq('artifact_id', records.artifactId).order('revision'))
  assert.equal(rows.length, 4)
  assert(rows.every(row => row.source_media_id === null && row.source_media_title === 'Disposable foundation image'))
  const current = checked(await client.from('current_artifacts').select('source_media_id,source_media_title')
    .eq('project_id', projectId).eq('id', records.artifactId).single())
  assert.equal(current.source_media_id, null)
  assert.equal(current.source_media_title, 'Disposable foundation image')
  console.log('Live drawings: image deletion cleared file links while preserving all four drawing versions and recorded titles.')
}
