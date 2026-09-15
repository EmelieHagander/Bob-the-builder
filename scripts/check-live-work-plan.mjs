// Hosted executable-work/readiness proof inside the existing disposable foundation project.
// Uses the ordinary authenticated Bob client and never touches real project data. No AI calls.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }

export async function verifyWorkPlanReadiness(client, anonymous, projectId, areaId) {
  const prerequisiteTaskId = 't_ready_pre_' + randomUUID()
  const targetTaskId = 't_ready_target_' + randomUUID()
  const dependencyId = randomUUID()
  const toolNeedId = randomUUID()
  const informationNeedId = randomUUID()
  const requirementId = randomUUID()

  const work = (task, action, item = null, expected = 0, data = {}) => client.rpc('work_plan_command', {
    p_project: projectId, p_task: task, p_action: action, p_item: item, p_expected: expected, p_data: data,
  })
  const step = (task, action, item = null, data = {}) => client.rpc('task_steps_command', {
    p_project: projectId, p_task: task, p_action: action, p_step: item, p_data: data,
  })
  const requirement = (action, expected, data = {}) => client.rpc('material_requirement_command', {
    p_project: projectId, p_action: action, p_requirement: requirementId, p_expected: expected, p_data: data,
  })
  const readiness = async task => checked(await client.from('current_task_readiness').select('*')
    .eq('project_id', projectId).eq('task_id', task).single())

  // The earlier phase verifier deliberately finishes this Area as Complete. Reality
  // moving back to Build is an allowed explicit transition and gives readiness the
  // exact phase context it promises to consume.
  checked(await client.rpc('phase_command', {
    p_project: projectId, p_scope: 'area', p_area: areaId, p_phase: 'build',
    p_reason: 'Hosted readiness verification: execute disposable work',
  }))

  checked(await client.from('tasks').insert([
    { id: prerequisiteTaskId, area_id: areaId, name: 'Hosted readiness prerequisite', status: 'todo' },
    { id: targetTaskId, area_id: areaId, name: 'Hosted readiness target', status: 'todo' },
  ]))

  let current = await readiness(targetTaskId)
  assert.equal(current.area_phase, 'build')
  assert.equal(current.readiness_state, 'unreviewed')
  assert.equal(current.blocker_count, 0)
  checked(await work(targetTaskId, 'confirm_readiness', null, 0, { note: 'Initial blocker-free hosted fixture' }))
  current = await readiness(targetTaskId)
  assert.equal(current.readiness_state, 'ready')
  assert(current.reviewed_at)

  checked(await step(prerequisiteTaskId, 'create', null, {
    title: 'Hosted prerequisite checkpoint',
    instructions: 'Disposable readiness checkpoint.',
    is_checkpoint: true,
    required: false,
  }))
  const checkpoint = checked(await client.from('task_steps').select('id,revision,completed_at')
    .eq('project_id', projectId).eq('task_id', prerequisiteTaskId).single())
  assert.equal(checkpoint.revision, 1)
  assert.equal(checkpoint.completed_at, null)

  checked(await work(targetTaskId, 'add_dependency', dependencyId, 0, {
    prerequisite_task_id: prerequisiteTaskId,
    prerequisite_step_id: checkpoint.id,
    note: 'Checkpoint must be complete before target work starts',
  }))
  checked(await work(targetTaskId, 'add_need', toolNeedId, 0, {
    kind: 'tool', label: 'Hosted circular saw', notes: 'Disposable tool readiness fixture',
  }))
  checked(await work(targetTaskId, 'add_need', informationNeedId, 0, {
    kind: 'information', label: 'Hosted opening dimension', notes: 'Disposable information readiness fixture',
  }))

  const areaTarget = checked(await client.from('current_target').select('*')
    .eq('project_id', projectId).eq('area_id', areaId).single())
  const materialData = (quantity, changeNote = undefined) => ({
    name: 'Hosted readiness boards',
    category: 'Timber',
    area_id: areaId,
    task_id: targetTaskId,
    unit: 'pcs',
    required_quantity: String(quantity),
    waste_percent: '0',
    purchase_increment: '1',
    basis: 'Disposable hosted readiness material fixture.',
    assumptions: 'Verification only; not a construction recommendation.',
    artifact_id: null,
    artifact_revision: null,
    target_revision: areaTarget.revision,
    stock_allocations: [],
    component_allocations: [],
    ...(changeNote ? { change_note: changeNote } : {}),
  })
  checked(await requirement('create', 0, materialData(2)))

  current = await readiness(targetTaskId)
  assert.equal(current.readiness_state, 'blocked')
  const blockerText = JSON.stringify(current.blockers)
  for (const expected of ['Hosted prerequisite checkpoint', 'Hosted readiness boards', 'Hosted circular saw', 'Hosted opening dimension']) {
    assert.match(blockerText, new RegExp(expected), `Readiness must name blocker: ${expected}`)
  }

  assert((await client.from('task_needs').insert({
    id: randomUUID(), project_id: projectId, task_id: targetTaskId, kind: 'tool', label: 'Forged raw need',
    created_by: randomUUID(), updated_by: randomUUID(), actor_label: 'forged',
  })).error, 'Normal clients must not bypass work_plan_command with raw readiness writes')
  assert((await anonymous.from('current_task_readiness').select('task_id').eq('task_id', targetTaskId)).error,
    'Unsigned users must not read project readiness')
  assert((await client.rpc('work_plan_command', {
    p_project: 'p_bygga_in_entren', p_task: targetTaskId, p_action: 'confirm_readiness',
    p_item: null, p_expected: 0, p_data: {},
  })).error, 'Disposable membership must not grant readiness authority in the real porch project')

  checked(await step(prerequisiteTaskId, 'complete', checkpoint.id, { revision: checkpoint.revision, completed: true }))
  checked(await work(targetTaskId, 'set_need_ready', toolNeedId, 1, { ready: true }))
  checked(await work(targetTaskId, 'set_need_ready', informationNeedId, 1, { ready: true }))
  current = await readiness(targetTaskId)
  assert.equal(current.readiness_state, 'blocked')
  assert.equal(current.blocker_count, 1)
  assert.match(JSON.stringify(current.blockers), /Send Hosted readiness boards to Shopping/)

  const published = checked(await requirement('publish', 1, {}))
  let material = checked(await client.from('task_material_readiness').select('*')
    .eq('project_id', projectId).eq('task_id', targetTaskId).single())
  assert.equal(material.ready, false)
  assert.match(material.reason, /still needs buying/)
  checked(await client.from('materials').update({ status: 'delivered' })
    .eq('project_id', projectId).eq('id', published.material_id))
  material = checked(await client.from('task_material_readiness').select('*')
    .eq('project_id', projectId).eq('task_id', targetTaskId).single())
  assert.equal(material.ready, true)
  assert.equal(material.reason, 'Delivered')

  current = await readiness(targetTaskId)
  assert.equal(current.blocker_count, 0)
  assert.equal(current.readiness_state, 'unreviewed', 'Clearing blockers must not silently promote a task to Ready')
  checked(await work(targetTaskId, 'confirm_readiness', null, 0, { note: 'Hosted blockers reviewed and cleared' }))
  assert.equal((await readiness(targetTaskId)).readiness_state, 'ready')

  // A newer material-plan revision is project truth after the Ready confirmation.
  // It must immediately invalidate readiness and require both Shopping review and a
  // new explicit Ready confirmation after the material source is synchronized.
  checked(await requirement('revise', 1, materialData(3, 'Hosted readiness source change')))
  current = await readiness(targetTaskId)
  assert.equal(current.readiness_state, 'blocked')
  assert.match(JSON.stringify(current.blockers), /Update Shopping from latest Hosted readiness boards requirement/)
  checked(await requirement('publish', 2, {}))
  material = checked(await client.from('task_material_readiness').select('*')
    .eq('project_id', projectId).eq('task_id', targetTaskId).single())
  assert.equal(material.ready, true, 'Updating Shopping must preserve delivered status')
  current = await readiness(targetTaskId)
  assert.equal(current.blocker_count, 0)
  assert.equal(current.readiness_state, 'unreviewed', 'Newer material truth must invalidate the prior Ready review')
  checked(await work(targetTaskId, 'confirm_readiness', null, 0, { note: 'Hosted revised material source reviewed' }))
  assert.equal((await readiness(targetTaskId)).readiness_state, 'ready')

  checked(await client.from('tasks').update({ status: 'blocked' }).eq('id', targetTaskId))
  current = await readiness(targetTaskId)
  assert.equal(current.readiness_state, 'blocked')
  assert.match(JSON.stringify(current.blockers), /manually marked Blocked/)
  const today = checked(await client.from('today_tasks').select('id,status,area_phase')
    .eq('project_id', projectId).eq('id', targetTaskId).single())
  assert.equal(today.status, 'blocked')
  assert.equal(today.area_phase, 'build')
  checked(await client.from('tasks').update({ status: 'todo' }).eq('id', targetTaskId))

  console.log('Live executable readiness: Build phase, checkpoint dependency, tool/information needs, canonical material/Shopping state, explicit Ready confirmation, source-change invalidation, manual Blocked visibility, raw/anonymous denial and project isolation passed. No AI invoked.')
  return { prerequisiteTaskId, targetTaskId, requirementId, materialId: published.material_id }
}
