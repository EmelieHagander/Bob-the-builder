// Hosted Slice 4B1 proof inside the existing authenticated disposable
// foundation project. No AI calls and no credentials live in this module.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }

const BUILDING_ID = '47000000-0000-4000-8000-000000000001'
const SPACE_ID = '47000000-0000-4000-8000-000000000002'
const BUILDING_NAME = 'Bob 4B1 hosted geometry verification fixture'
const SPACE_NAME = 'Stud wall verification space'

export async function verifyDeterministicArtifactGeometry(client, anonymous, projectId, areaId) {
  let scopeId = null
  let scopeLinked = false

  const buildingCommand = (action, expected, data = {}) => client.rpc('physical_building_command', {
    p_action: action, p_building: BUILDING_ID, p_expected: expected, p_data: data,
  })
  const nodeCommand = (action, expected, data = {}) => client.rpc('physical_node_command', {
    p_building: BUILDING_ID, p_kind: 'space', p_action: action, p_record: SPACE_ID, p_expected: expected, p_data: data,
  })
  const evidenceCommand = (action, id, expected, data = {}) => client.rpc('evidence_command', {
    p_project: projectId, p_kind: 'measurement', p_action: action, p_record: id, p_expected: expected, p_data: data,
  })
  const geometryCommand = (action, id, expected, data = {}) => client.rpc('artifact_geometry_command', {
    p_project: projectId, p_action: action, p_artifact: id, p_expected: expected, p_data: data,
  })

  try {
    let building = checked(await client.from('current_buildings').select('id,revision,name,archived')
      .eq('id', BUILDING_ID).maybeSingle())
    if (!building) {
      checked(await buildingCommand('create', 0, {
        site_id: null,
        name: BUILDING_NAME,
        notes: 'Stable hosted release-verification fixture. Not real project data.',
      }))
      building = checked(await client.from('current_buildings').select('id,revision,name,archived')
        .eq('id', BUILDING_ID).single())
    }
    assert.equal(building.name, BUILDING_NAME, 'The fixed geometry Building id must belong to the verification fixture')
    if (building.archived) {
      checked(await buildingCommand('restore', building.revision, {}))
      building = checked(await client.from('current_buildings').select('id,revision,name,archived')
        .eq('id', BUILDING_ID).single())
    }

    let space = checked(await client.from('current_spaces').select('id,building_id,revision,name,archived,has_proposal')
      .eq('id', SPACE_ID).maybeSingle())
    if (!space) {
      checked(await nodeCommand('create', 0, {
        name: SPACE_NAME,
        kind: 'verification',
        level_id: null,
        notes: 'Stable Space used only by the hosted deterministic-geometry release proof.',
        truth: 'unknown',
        source: '',
        measurements: [],
      }))
      space = checked(await client.from('current_spaces').select('id,building_id,revision,name,archived,has_proposal')
        .eq('id', SPACE_ID).single())
    }
    assert.equal(space.building_id, BUILDING_ID)
    assert.equal(space.name, SPACE_NAME, 'The fixed geometry Space id must belong to the verification fixture')
    assert.equal(space.has_proposal, false, 'The stable geometry verification Space must not carry a proposal')
    if (space.archived) {
      checked(await nodeCommand('restore', space.revision, {}))
      space = checked(await client.from('current_spaces').select('id,building_id,revision,name,archived,has_proposal')
        .eq('id', SPACE_ID).single())
    }

    scopeId = randomUUID()
    checked(await client.rpc('physical_scope_command', {
      p_project: projectId,
      p_kind: 'project',
      p_action: 'link',
      p_record: scopeId,
      p_data: { target_kind: 'building', building_id: BUILDING_ID },
    }))
    scopeLinked = true
    const projectSpace = checked(await client.from('project_spaces').select('id,building_id,revision,name')
      .eq('project_id', projectId).eq('id', SPACE_ID).single())
    assert.equal(projectSpace.building_id, BUILDING_ID)
    assert.equal(projectSpace.revision, space.revision)
    assert.equal(projectSpace.name, SPACE_NAME)

    const target = checked(await client.from('current_target').select('revision,solution_id,solution_revision')
      .eq('project_id', projectId).single())
    assert(target.solution_id, 'The foundation artifact proof must leave one selected target for geometry')

    const measurementIds = {}
    const specs = {
      wall_width: ['Hosted wall width', '4200'],
      wall_height: ['Hosted wall height', '2400'],
      opening_left: ['Hosted opening left offset', '900'],
      opening_sill_height: ['Hosted opening sill height', '850'],
      opening_width: ['Hosted opening width', '1200'],
      opening_height: ['Hosted opening height', '1200'],
    }
    for (const [role, [subject, value]] of Object.entries(specs)) {
      const id = randomUUID()
      measurementIds[role] = id
      checked(await evidenceCommand('create', id, 0, {
        subject, value, unit: 'mm', truth: 'measured', source: 'Hosted 4B1 verification tape reading',
        required: true, source_media_id: null, area_id: areaId,
      }))
    }
    const refs = revisionOverrides => Object.fromEntries(Object.entries(measurementIds).map(([role, id]) => [
      role, { id, revision: revisionOverrides?.[role] ?? 1 },
    ]))

    const artifactId = randomUUID()
    const generationData = (inputs, extra = {}) => ({
      title: 'Hosted deterministic stud wall',
      description: 'Disposable deterministic wall elevation used only for hosted release verification.',
      status: 'measured',
      assumptions: 'Opening-edge framing is conceptual; no structural header or load-path sizing.',
      source_media_id: null,
      target_revision: target.revision,
      building_id: BUILDING_ID,
      space_id: SPACE_ID,
      space_revision: space.revision,
      stud_spacing_mm: 600,
      inputs,
      ...extra,
    })

    checked(await geometryCommand('create', artifactId, 0, generationData(refs(), { area_id: areaId })))
    let current = checked(await client.from('current_artifacts').select('id,revision,area_id,status,generator,generator_version,target_revision')
      .eq('project_id', projectId).eq('id', artifactId).single())
    assert.deepEqual({
      revision: current.revision,
      area_id: current.area_id,
      status: current.status,
      generator: current.generator,
      generator_version: current.generator_version,
      target_revision: current.target_revision,
    }, {
      revision: 1,
      area_id: areaId,
      status: 'measured',
      generator: 'stud_wall_opening_v1',
      generator_version: 1,
      target_revision: target.revision,
    })

    let generation = checked(await client.from('artifact_generation_details').select('*')
      .eq('project_id', projectId).eq('artifact_id', artifactId).eq('artifact_revision', 1).single())
    assert.equal(generation.building_id, BUILDING_ID)
    assert.equal(generation.building_name, BUILDING_NAME)
    assert.equal(generation.space_id, SPACE_ID)
    assert.equal(generation.space_name, SPACE_NAME)
    assert.equal(generation.space_revision, space.revision)
    assert.equal(generation.current_space_revision, space.revision)
    assert.equal(Number(generation.parameters.stud_spacing_mm), 600)

    let inputs = checked(await client.from('artifact_geometry_input_details').select('*')
      .eq('project_id', projectId).eq('artifact_id', artifactId).eq('artifact_revision', 1).order('role'))
    assert.equal(inputs.length, 6)
    assert(inputs.every(row => row.truth === 'measured' && row.measurement_revision === 1))
    assert.equal(Number(inputs.find(row => row.role === 'wall_width').value), 4200)
    assert.equal(Number(inputs.find(row => row.role === 'opening_width').value), 1200)

    assert((await client.from('artifact_generations').update({ parameters: { stud_spacing_mm: 450 } })
      .eq('artifact_id', artifactId).eq('artifact_revision', 1)).error,
    'Raw generated-recipe writes must be denied')
    assert((await client.from('artifact_geometry_inputs').delete()
      .eq('artifact_id', artifactId).eq('artifact_revision', 1)).error,
    'Raw geometry-input deletes must be denied')
    assert((await anonymous.from('artifact_generation_details').select('artifact_id').eq('artifact_id', artifactId)).error,
      'Anonymous clients must not read generated recipes')

    const unknownId = randomUUID()
    checked(await evidenceCommand('create', unknownId, 0, {
      subject: 'Hosted unknown geometry input', value: null, unit: 'mm', truth: 'unknown', source: '',
      required: true, source_media_id: null, area_id: areaId,
    }))
    const unknownInputs = refs()
    unknownInputs.opening_height = { id: unknownId, revision: 1 }
    const unknownArtifactId = randomUUID()
    assert((await geometryCommand('create', unknownArtifactId, 0, generationData(unknownInputs, {
      title: 'Must reject unknown geometry', area_id: areaId,
    }))).error, 'Unknown measurements must not generate geometry')
    assert.deepEqual(checked(await client.from('current_artifacts').select('id').eq('project_id', projectId).eq('id', unknownArtifactId)), [])

    const badLeftId = randomUUID()
    checked(await evidenceCommand('create', badLeftId, 0, {
      subject: 'Hosted invalid opening offset', value: '3500', unit: 'mm', truth: 'measured',
      source: 'Hosted 4B1 verification invalid-boundary fixture', required: true, source_media_id: null, area_id: areaId,
    }))
    const invalidInputs = refs()
    invalidInputs.opening_left = { id: badLeftId, revision: 1 }
    const invalidArtifactId = randomUUID()
    assert((await geometryCommand('create', invalidArtifactId, 0, generationData(invalidInputs, {
      title: 'Must reject out-of-bounds opening', area_id: areaId,
    }))).error, 'An opening outside the wall must fail at the database boundary')
    assert.deepEqual(checked(await client.from('current_artifacts').select('id').eq('project_id', projectId).eq('id', invalidArtifactId)), [],
      'Invalid geometry must roll back its Artifact revision atomically')

    checked(await evidenceCommand('revise', measurementIds.opening_width, 1, {
      subject: specs.opening_width[0], value: '1210', unit: 'mm', truth: 'measured',
      source: 'Hosted 4B1 follow-up tape reading', required: true, source_media_id: null,
      change_note: 'Remeasure opening width for regeneration proof',
    }))
    checked(await geometryCommand('regenerate', artifactId, 1, generationData(refs({ opening_width: 2 }), {
      change_note: 'Use remeasured opening width',
    })))
    current = checked(await client.from('current_artifacts').select('revision,generator,generator_version')
      .eq('project_id', projectId).eq('id', artifactId).single())
    assert.equal(current.revision, 2)
    assert.equal(current.generator, 'stud_wall_opening_v1')
    const oldWidth = checked(await client.from('artifact_geometry_input_details').select('measurement_revision,value,latest_revision')
      .eq('project_id', projectId).eq('artifact_id', artifactId).eq('artifact_revision', 1).eq('role', 'opening_width').single())
    const newWidth = checked(await client.from('artifact_geometry_input_details').select('measurement_revision,value,latest_revision')
      .eq('project_id', projectId).eq('artifact_id', artifactId).eq('artifact_revision', 2).eq('role', 'opening_width').single())
    assert.deepEqual({ revision: oldWidth.measurement_revision, value: Number(oldWidth.value), latest: oldWidth.latest_revision },
      { revision: 1, value: 1200, latest: 2 })
    assert.deepEqual({ revision: newWidth.measurement_revision, value: Number(newWidth.value), latest: newWidth.latest_revision },
      { revision: 2, value: 1210, latest: 2 })

    const artifactCommand = (action, expected, data = {}) => client.rpc('artifact_command', {
      p_project: projectId, p_action: action, p_artifact: artifactId, p_expected: expected, p_data: data,
    })
    checked(await artifactCommand('archive', 2))
    checked(await artifactCommand('restore', 3))
    for (const revision of [1, 2, 3, 4]) {
      generation = checked(await client.from('artifact_generation_details').select('generator,space_id,space_revision')
        .eq('project_id', projectId).eq('artifact_id', artifactId).eq('artifact_revision', revision).single())
      assert.equal(generation.generator, 'stud_wall_opening_v1')
      assert.equal(generation.space_id, SPACE_ID)
      assert.equal(generation.space_revision, space.revision)
      inputs = checked(await client.from('artifact_geometry_input_details').select('role')
        .eq('project_id', projectId).eq('artifact_id', artifactId).eq('artifact_revision', revision))
      assert.equal(inputs.length, 6)
    }

    const fiveRefs = Object.values(refs({ opening_width: 2 })).slice(0, 5)
    assert((await artifactCommand('revise', 4, {
      title: 'Unsafe manual geometry edit',
      description: 'Must fail rather than silently dropping a geometry role.',
      kind: 'elevation',
      status: 'measured',
      assumptions: '',
      source_media_id: null,
      target_revision: target.revision,
      measurements: fiveRefs,
      change_note: 'Try to bypass Regenerate',
    })).error, 'Generated geometry must require Regenerate for geometry-changing revisions')
    assert.equal(checked(await client.from('current_artifacts').select('revision')
      .eq('project_id', projectId).eq('id', artifactId).single()).revision, 4)

    assert((await client.rpc('artifact_geometry_command', {
      p_project: 'p_bygga_in_entren', p_action: 'create', p_artifact: randomUUID(), p_expected: 0, p_data: {},
    })).error, 'The disposable verifier must not gain geometry access to the real porch project')

    console.log('Live deterministic geometry: persistent Space target, six exact measurements, recipe read-back, raw-write/RLS denial, unknown and out-of-bounds rejection, regeneration history and archive/restore carry-forward passed. No AI invoked.')
    return { artifactId, buildingId: BUILDING_ID, spaceId: SPACE_ID }
  } finally {
    if (scopeLinked) {
      const result = await client.rpc('physical_scope_command', {
        p_project: projectId,
        p_kind: 'project',
        p_action: 'unlink',
        p_record: scopeId,
        p_data: {},
      })
      if (result.error) throw new Error('Geometry fixture scope cleanup failed: ' + result.error.message)
      console.log('Stable 4B1 physical verification fixture detached from the disposable project.')
    }
  }
}
