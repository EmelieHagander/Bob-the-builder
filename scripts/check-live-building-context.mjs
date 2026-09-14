// Hosted Slice 2C proof through real Auth/PostgREST. No AI calls.
// The fixture owns its persistent physical records and removes them through the
// same guarded commands once project/Area scope has been detached.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { verifyProjectPhases } from './check-live-project-phases.mjs'

const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }

export async function verifyBuildingContext(client, anonymous, projectId, areaId, facts = null) {
  const siteId = randomUUID()
  const buildingId = randomUUID()
  const levelId = randomUUID()
  const roomId = randomUUID()
  const officeId = randomUUID()
  const elementId = randomUUID()
  const relationshipId = randomUUID()
  const projectScopeId = randomUUID()
  const areaTargetId = randomUUID()
  let siteCreated = false
  let buildingCreated = false
  let projectLinked = false
  let areaLinked = false

  const site = (action, expected, data = {}) => client.rpc('physical_site_command', {
    p_action: action, p_site: siteId, p_expected: expected, p_data: data,
  })
  const building = (action, expected, data = {}) => client.rpc('physical_building_command', {
    p_action: action, p_building: buildingId, p_expected: expected, p_data: data,
  })
  const node = (kind, action, id, expected, data = {}) => client.rpc('physical_node_command', {
    p_building: buildingId, p_kind: kind, p_action: action, p_record: id, p_expected: expected, p_data: data,
  })
  const scope = (kind, action, id, data = {}) => client.rpc('physical_scope_command', {
    p_project: projectId, p_kind: kind, p_action: action, p_record: id, p_data: data,
  })

  try {
    checked(await site('create', 0, { name: 'Disposable verification site', notes: 'Hosted Slice 2C fixture' }))
    siteCreated = true
    checked(await building('create', 0, { site_id: siteId, name: 'Disposable verification building', notes: 'Hosted Slice 2C fixture' }))
    buildingCreated = true
    checked(await node('level', 'create', levelId, 0, { name: 'Ground floor', position: 0, notes: 'Disposable level' }))
    checked(await node('space', 'create', roomId, 0, {
      name: 'Disposable room', kind: 'bedroom', level_id: levelId, notes: 'Known room only', truth: 'unknown', source: '', measurements: [],
    }))
    checked(await node('space', 'create', officeId, 0, {
      name: 'Disposable office', kind: 'office', level_id: levelId, notes: '', truth: 'unknown', source: '', measurements: [],
    }))
    checked(await node('element', 'create', elementId, 0, {
      space_id: roomId, kind: 'window', name: 'Disposable window', description: 'Hosted fixture', truth: 'unknown', source: '',
    }))
    checked(await node('relationship', 'create', relationshipId, 0, {
      subject_space_id: roomId, object_space_id: officeId, relation: 'shares_boundary_with', truth: 'provided_spec',
      source: 'Hosted fixture plan note', notes: 'Explicit relation for release proof',
    }))

    const anonRead = await anonymous.from('current_spaces').select('id').eq('id', roomId)
    assert(anonRead.error, 'Anonymous clients must not read persistent building context')

    checked(await scope('project', 'link', projectScopeId, { target_kind: 'building', building_id: buildingId }))
    projectLinked = true
    const projectSpaces = checked(await client.from('project_spaces').select('project_id,source_project_id,building_id,id,name')
      .eq('project_id', projectId).eq('building_id', buildingId).order('name'))
    assert.deepEqual(projectSpaces.map(row => row.name), ['Disposable office', 'Disposable room'])
    assert(projectSpaces.every(row => row.project_id === projectId))
    assert(projectSpaces.every(row => row.source_project_id === null), 'Directly recorded accepted truth has no source project')

    const projectElements = checked(await client.from('project_elements').select('id,name').eq('project_id', projectId).eq('building_id', buildingId))
    assert.equal(projectElements.length, 1); assert.equal(projectElements[0].name, 'Disposable window')
    const projectRelations = checked(await client.from('project_relationships').select('id,relation,truth').eq('project_id', projectId).eq('building_id', buildingId))
    assert.equal(projectRelations.length, 1); assert.equal(projectRelations[0].relation, 'shares_boundary_with'); assert.equal(projectRelations[0].truth, 'provided_spec')

    checked(await scope('area', 'link', areaTargetId, {
      area_id: areaId, target_kind: 'space', building_id: buildingId, space_id: roomId,
    }))
    areaLinked = true
    assert.equal(checked(await client.from('area_physical_targets').select('id').eq('project_id', projectId).eq('id', areaTargetId)).length, 1)

    let roomRevision = 1
    if (facts?.measurementId) {
      const measurement = checked(await client.from('current_measurements').select('revision,value,unit,truth,source')
        .eq('project_id', projectId).eq('id', facts.measurementId).single())
      checked(await node('space', 'revise', roomId, roomRevision, {
        name: 'Disposable room', kind: 'bedroom', level_id: levelId, notes: 'Exact project measurement pinned',
        truth: 'measured', source: 'Linked hosted verification measurement',
        measurements: [{ id: facts.measurementId, revision: measurement.revision }], change_note: 'Pin exact project measurement',
      }))
      roomRevision += 1
      const snapshots = checked(await client.from('space_measurement_details').select('measurement_revision,value,unit,truth')
        .eq('space_id', roomId).eq('space_revision', roomRevision))
      assert.equal(snapshots.length, 1)
      assert.equal(snapshots[0].measurement_revision, measurement.revision)
      assert.equal(Number(snapshots[0].value), Number(measurement.value))
      assert.equal(snapshots[0].unit, measurement.unit)
      assert.equal(snapshots[0].truth, measurement.truth)
    }

    const acceptedBefore = checked(await client.from('current_spaces').select('revision,name,latest_revision,has_proposal')
      .eq('id', roomId).single())
    assert.equal(acceptedBefore.revision, roomRevision)
    assert.equal(acceptedBefore.has_proposal, false)

    checked(await node('space', 'propose', roomId, roomRevision, {
      project_id: projectId, name: 'Disposable room + alcove', kind: 'bedroom', level_id: levelId,
      notes: 'Proposed hosted change', truth: 'estimated', source: 'Hosted renovation proposal', measurements: [],
      change_note: 'Propose alcove opening',
    }))
    const proposedRevision = roomRevision + 1
    const currentDuringProposal = checked(await client.from('current_spaces').select('revision,name,latest_revision,has_proposal')
      .eq('id', roomId).single())
    assert.equal(currentDuringProposal.revision, roomRevision)
    assert.equal(currentDuringProposal.name, 'Disposable room')
    assert.equal(currentDuringProposal.latest_revision, proposedRevision)
    assert.equal(currentDuringProposal.has_proposal, true)
    const proposal = checked(await client.from('latest_space_proposals').select('revision,project_id,name,state')
      .eq('id', roomId).single())
    assert.equal(proposal.project_id, projectId)
    assert.equal(proposal.name, 'Disposable room + alcove')
    assert.equal(proposal.state, 'proposed')

    assert((await client.from('space_revisions').update({ name: 'raw write must fail' }).eq('space_id', roomId)).error,
      'Revision history must reject raw client writes')

    checked(await node('space', 'accept', roomId, proposedRevision, {}))
    const acceptedRevision = proposedRevision + 1
    const accepted = checked(await client.from('current_spaces').select('revision,name,source_project_id,has_proposal')
      .eq('id', roomId).single())
    assert.equal(accepted.revision, acceptedRevision)
    assert.equal(accepted.name, 'Disposable room + alcove')
    assert.equal(accepted.source_project_id, projectId, 'Accepted proposal retains project origin as provenance')
    assert.equal(accepted.has_proposal, false)
    const history = checked(await client.from('space_revisions').select('revision,state,name').eq('space_id', roomId).order('revision'))
    assert.equal(history.at(-2).state, 'proposed')
    assert.equal(history.at(-1).state, 'accepted')

    console.log('Live building context: persistent Site/Building/Level/Spaces, project and Area scope, topology, exact measurement snapshot, current/proposal/accept history, RLS and raw-write denial passed. No AI invoked.')
  } finally {
    // Cleanup must use the same public authority boundary as the product. Project
    // context is detached before the persistent physical identities can be removed.
    if (areaLinked) {
      const result = await scope('area', 'unlink', areaTargetId, {})
      if (result.error) throw new Error('Building context Area cleanup failed: ' + result.error.message)
      areaLinked = false
    }
    if (projectLinked) {
      const result = await scope('project', 'unlink', projectScopeId, {})
      if (result.error) throw new Error('Building context project cleanup failed: ' + result.error.message)
      projectLinked = false
    }
    if (buildingCreated) {
      const currentResult = await client.from('current_buildings').select('revision,archived').eq('id', buildingId).maybeSingle()
      if (currentResult.error) throw new Error('Building context building cleanup read failed: ' + currentResult.error.message)
      if (currentResult.data) {
        let revision = currentResult.data.revision
        if (!currentResult.data.archived) {
          checked(await building('archive', revision, {})); revision += 1
        }
        checked(await building('delete', revision, {}))
      }
      buildingCreated = false
    }
    if (siteCreated) {
      const currentResult = await client.from('current_sites').select('revision,archived').eq('id', siteId).maybeSingle()
      if (currentResult.error) throw new Error('Building context site cleanup read failed: ' + currentResult.error.message)
      if (currentResult.data) {
        let revision = currentResult.data.revision
        if (!currentResult.data.archived) {
          checked(await site('archive', revision, {})); revision += 1
        }
        checked(await site('delete', revision, {}))
      }
      siteCreated = false
    }
    assert.deepEqual(checked(await client.from('current_buildings').select('id').eq('id', buildingId)), [])
    assert.deepEqual(checked(await client.from('current_sites').select('id').eq('id', siteId)), [])
    console.log('Live building context fixture removed through guarded physical-authority commands.')
  }

  await verifyProjectPhases(client, anonymous, projectId, areaId)
}
