// Hosted readiness proof composed into the existing disposable foundation run.
// Uses ordinary Auth/PostgREST only. No AI, service key or shared-app mutations.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
async function denied(request, pattern, message) {
  const result = await request
  assert(result.error, message)
  assert.match(result.error.message, pattern, message)
}

export async function verifyWorkPlan(client, anonymous, projectId) {
  // Fail closed if this helper is ever accidentally pointed at a real project.
  const project = checked(await client.from('projects').select('name,type,description').eq('id', projectId).single())
  assert.equal(project.type, 'Verification')
  assert.match(project.name, /^Bob foundations verification [0-9a-f-]{36}$/)
  assert.equal(project.description, 'Disposable media/task foundation verification. No real project data.')
  const user = checked(await client.auth.getUser()).user
  assert(user, 'Use the already-authenticated foundation client')

  const areaId = 'a_readiness_' + randomUUID()
  const prep = 't_readiness_' + randomUUID()
  const frame = 't_readiness_' + randomUUID()
  const close = 't_readiness_' + randomUUID()
  const tool = randomUUID(), information = randomUUID(), dependency = randomUUID()
  const checkpointDependency = randomUUID(), requirementId = randomUUID()
  const work = (task, action, item = null, expected = 0, data = {}) => client.rpc('work_plan_command', {
    p_project: projectId, p_task: task, p_action: action, p_item: item, p_expected: expected, p_data: data,
  })
  const phase = next => client.rpc('phase_command', {
    p_project: projectId, p_scope: 'area', p_area: areaId, p_phase: next,
    p_reason: 'Disposable hosted readiness verification',
  })
  const state = async task => checked(await client.from('current_task_readiness').select('*')
    .eq('project_id', projectId).eq('task_id', task).single())
  const expectState = async (task, expected, kind = null) => {
    const row = await state(task)
    assert.equal(row.readiness_state, expected)
    assert.equal(row.project_id, projectId)
    assert.equal(row.area_id, areaId)
    assert.equal(row.task_id, task)
    if (kind) assert(row.blockers.some(blocker => blocker.kind === kind), 'Expected named ' + kind + ' blocker')
    if (expected === 'ready' || expected === 'unreviewed' || expected === 'complete') assert.equal(row.blocker_count, 0)
    return row
  }
  const setStatus = async (task, status) => {
    const row = checked(await client.from('tasks').update({ status }).eq('id', task).eq('area_id', areaId)
      .select('id,status').single())
    assert.equal(row.status, status)
  }
  const requirement = (action, expected, data = {}) => client.rpc('material_requirement_command', {
    p_project: projectId, p_action: action, p_requirement: requirementId, p_expected: expected, p_data: data,
  })

  // Dedicated Area/tasks avoid changing the fixtures consumed by earlier proofs.
  checked(await client.from('areas').insert({ id: areaId, project_id: projectId, slug: areaId, name: 'Readiness verification' }))
  checked(await client.from('tasks').insert([
    { id: prep, area_id: areaId, name: 'Prepare opening' },
    { id: frame, area_id: areaId, name: 'Frame opening' },
    { id: close, area_id: areaId, name: 'Close wall' },
  ]))
  await expectState(prep, 'unreviewed')
  checked(await phase('design'))
  await expectState(prep, 'unreviewed')
  checked(await work(prep, 'confirm_readiness', null, 0, { note: 'Design work reviewed independently of lifecycle phase' }))
  await expectState(prep, 'ready')
  checked(await phase('build'))
  // Phase changes do not turn reviewed work into a new blocker.
  await expectState(prep, 'ready')
  const ready = await expectState(prep, 'ready')
  assert(ready.reviewed_at && ready.reviewed_by, 'Confirmation must have server attribution')
  const review = checked(await client.from('task_readiness_reviews').select('confirmed_by,note')
    .eq('project_id', projectId).eq('task_id', prep).single())
  assert.equal(review.confirmed_by, user.id)
  assert.equal(review.note, 'Design work reviewed independently of lifecycle phase')
  assert.equal(ready.task_status, 'todo', 'Readiness does not rewrite task status')

  checked(await work(frame, 'add_need', tool, 0, { kind: 'tool', label: 'Circular saw', notes: 'Charged battery' }))
  await expectState(frame, 'blocked', 'tool')
  await denied(work(frame, 'confirm_readiness'), /Resolve named blockers/, 'Missing tools block confirmation')
  checked(await work(frame, 'set_need_ready', tool, 1, { ready: true }))
  await denied(work(frame, 'set_need_ready', tool, 1, { ready: false }), /changed.*Reload/i, 'Stale need changes are rejected')
  await expectState(frame, 'unreviewed')
  checked(await work(frame, 'confirm_readiness'))
  await expectState(frame, 'ready')
  checked(await work(frame, 'add_need', information, 0, { kind: 'information', label: 'Opening width' }))
  await expectState(frame, 'blocked', 'information')
  checked(await work(frame, 'set_need_ready', information, 1, { ready: true }))
  await expectState(frame, 'unreviewed')
  checked(await work(frame, 'confirm_readiness'))
  checked(await work(frame, 'revise_need', information, 2, { label: 'Opening width rechecked', ready: true }))
  await expectState(frame, 'unreviewed')
  checked(await work(frame, 'remove_need', information, 3))

  checked(await work(frame, 'add_dependency', dependency, 0, { prerequisite_task_id: prep, note: 'Prepare before framing' }))
  await expectState(frame, 'blocked', 'dependency')
  await denied(work(prep, 'add_dependency', randomUUID(), 0, { prerequisite_task_id: frame }), /cannot form a cycle/, 'Cycles are rejected')
  await denied(work(frame, 'add_dependency', randomUUID(), 0, { prerequisite_task_id: 'missing_' + randomUUID() }),
    /inside one Project|same Project|project_denied/, 'Missing prerequisite identities cannot grant access')
  await setStatus(prep, 'done')
  await expectState(prep, 'complete')
  await expectState(frame, 'unreviewed')
  const dependencyRow = checked(await client.from('task_dependency_status').select('satisfied,prerequisite_task_id')
    .eq('project_id', projectId).eq('id', dependency).single())
  assert.equal(dependencyRow.satisfied, true)
  assert.equal(dependencyRow.prerequisite_task_id, prep)
  checked(await work(frame, 'confirm_readiness'))
  await expectState(frame, 'ready')
  checked(await work(frame, 'remove_dependency', dependency))
  await expectState(frame, 'unreviewed')

  const stepCommand = (action, step = null, data = {}) => client.rpc('task_steps_command', {
    p_project: projectId, p_task: frame, p_action: action, p_step: step, p_data: data,
  })
  checked(await stepCommand('create', null, { title: 'Opening checked', is_checkpoint: true, required: true }))
  const checkpoint = checked(await client.from('task_steps').select('id,revision,completed_at')
    .eq('project_id', projectId).eq('task_id', frame).single())
  checked(await work(close, 'add_dependency', checkpointDependency, 0, {
    prerequisite_task_id: frame, prerequisite_step_id: checkpoint.id,
  }))
  await expectState(close, 'blocked', 'dependency')
  await denied(client.from('tasks').update({ status: 'done' }).eq('id', frame).eq('area_id', areaId),
    /required|checkpoint|check/i, 'Required checks still guard task completion')
  checked(await stepCommand('complete', checkpoint.id, { revision: checkpoint.revision, completed: true }))
  await expectState(close, 'unreviewed')
  assert.equal((await state(frame)).task_status, 'todo', 'A completed checkpoint is enough without finishing the whole prerequisite')
  checked(await work(close, 'confirm_readiness'))
  await expectState(close, 'ready')

  // Use the current exact Project target, not a cached target from earlier proofs.
  const target = checked(await client.from('current_target').select('revision,solution_id')
    .eq('project_id', projectId).is('area_id', null).single())
  assert(target.solution_id && target.revision > 0, 'Earlier foundations leave an explicit selected Project target')
  const materialData = {
    name: 'Readiness fixture studs', category: 'Timber', area_id: areaId, task_id: close,
    unit: 'pcs', required_quantity: '4', waste_percent: '0', purchase_increment: '1',
    basis: 'Four fixture studs; verification only.', assumptions: '',
    artifact_id: null, artifact_revision: null, target_revision: target.revision,
    stock_allocations: [], component_allocations: [],
  }
  checked(await requirement('create', 0, materialData))
  const materialState = checked(await client.from('task_material_readiness').select('*')
    .eq('project_id', projectId).eq('requirement_id', requirementId).single())
  assert.equal(materialState.ready, false)
  assert.match(materialState.reason, /Send .* to Shopping/)
  await expectState(close, 'blocked', 'material')
  checked(await requirement('publish', 1))
  const shopping = checked(await client.from('material_requirement_shopping').select('material_id')
    .eq('project_id', projectId).eq('requirement_id', requirementId).single())
  const shoppingStatus = async status => checked(await client.from('materials').update({ status })
    .eq('project_id', projectId).eq('id', shopping.material_id).select('status').single())
  await shoppingStatus('ordered')
  await expectState(close, 'blocked', 'material')
  await shoppingStatus('delivered')
  await expectState(close, 'unreviewed')
  checked(await work(close, 'confirm_readiness'))
  await expectState(close, 'ready')

  checked(await requirement('revise', 1, { ...materialData, required_quantity: '5', change_note: 'One more fixture stud' }))
  await expectState(close, 'blocked', 'material')
  checked(await requirement('publish', 2))
  assert.equal(checked(await client.from('materials').select('status').eq('project_id', projectId)
    .eq('id', shopping.material_id).single()).status, 'delivered', 'Shopping update preserves delivery status')
  await expectState(close, 'unreviewed')
  checked(await work(close, 'confirm_readiness'))
  await expectState(close, 'ready')

  // Completion and manual status stay separate from the derived readiness state.
  await setStatus(frame, 'blocked')
  await expectState(frame, 'blocked', 'status')
  const today = checked(await client.from('today_tasks').select('id,status,area_id,area_phase')
    .eq('project_id', projectId).eq('id', frame).single())
  assert.equal(today.status, 'blocked')
  assert.equal(today.area_id, areaId)
  assert.equal(today.area_phase, 'build')
  await setStatus(close, 'done')
  await expectState(close, 'complete')
  await denied(work(close, 'confirm_readiness'), /Only active tasks/, 'Completed tasks cannot receive a new readiness confirmation')

  for (const table of ['task_needs', 'task_dependencies', 'task_readiness_reviews',
    'task_dependency_status', 'task_material_readiness', 'current_task_readiness']) {
    await denied(anonymous.from(table).select('*').eq('project_id', projectId), /permission denied/i,
      'Unsigned callers cannot read ' + table)
    assert.deepEqual(checked(await client.from(table).select('*').eq('project_id', 'p_bygga_in_entren')), [],
      'The verification account must not see the real project through ' + table)
  }
  await denied(anonymous.rpc('work_plan_command', {
    p_project: projectId, p_task: frame, p_action: 'confirm_readiness',
  }), /permission denied|project_denied/i, 'Unsigned work-plan writes are denied')
  await denied(client.rpc('work_plan_command', {
    p_project: 'p_bygga_in_entren', p_task: frame, p_action: 'add_need', p_item: randomUUID(),
    p_expected: 0, p_data: { kind: 'tool', label: 'Denied fixture request' },
  }), /project_denied/, 'A foreign project cannot be used to mutate even a known fixture task')
  await denied(client.from('task_needs').update({ ready: false }).eq('project_id', projectId).eq('id', tool),
    /permission denied/i, 'Raw task-need changes are denied')
  await denied(client.from('task_dependencies').delete().eq('project_id', projectId).eq('id', checkpointDependency),
    /permission denied/i, 'Raw dependency changes are denied')
  await denied(client.from('task_readiness_reviews').delete().eq('project_id', projectId).eq('task_id', close),
    /permission denied/i, 'Raw readiness-confirmation changes are denied')
  // Read back after denied writes: errors alone do not prove preservation.
  assert.equal(checked(await client.from('task_needs').select('ready,revision').eq('project_id', projectId)
    .eq('id', tool).single()).ready, true)
  assert.equal(checked(await client.from('task_dependencies').select('id').eq('project_id', projectId)
    .eq('id', checkpointDependency).single()).id, checkpointDependency)
  await expectState(close, 'complete')
  console.log('Live work readiness: explicit confirmation, phase-independent review, tool/information/dependency blockers, stale writes, checkpoints, canonical Shopping delivery, material revision re-review, Today visibility, completion and project/raw/anonymous denial passed. No AI invoked.')
}
