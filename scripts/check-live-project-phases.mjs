// Hosted Project/Area phase + scoped-target proof inside the disposable foundation project.
// Uses the already-authenticated ordinary Bob client. No AI calls.
import assert from 'node:assert/strict'

const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }

export async function verifyProjectPhases(client, anonymous, projectId, areaId) {
  const phase = (scope, area, next, reason) => client.rpc('phase_command', {
    p_project: projectId,
    p_scope: scope,
    p_area: area,
    p_phase: next,
    p_reason: reason,
  })
  const target = (action, solution, expected, data) => client.rpc('solution_command', {
    p_project: projectId,
    p_action: action,
    p_solution: solution,
    p_expected: expected,
    p_data: data,
  })

  const projectBefore = checked(await client.from('projects').select('phase').eq('id', projectId).single())
  const areaBefore = checked(await client.from('areas').select('phase').eq('id', areaId).single())
  assert.equal(projectBefore.phase, 'concept', 'Fresh projects start in Concept')
  assert.equal(areaBefore.phase, null, 'Existing/new Area rows are not silently classified by surrounding data')

  checked(await phase('project', null, 'planning', 'Hosted phase verification: project planning'))
  checked(await phase('area', areaId, 'design', 'Hosted phase verification: Area design'))
  assert((await phase('project', null, 'complete', 'Hosted phase verification: premature completion')).error,
    'Project completion must fail while an Area is unfinished')
  checked(await phase('area', areaId, 'planning', 'Hosted phase verification: Area planning'))
  checked(await phase('area', areaId, 'design', 'Hosted phase verification: new evidence requires design review'))
  checked(await phase('area', areaId, 'complete', 'Hosted phase verification: Area complete'))
  checked(await phase('project', null, 'complete', 'Hosted phase verification: all Areas complete'))
  checked(await phase('project', null, 'build', 'Hosted phase verification: reality moved the Project back to Build'))

  const history = checked(await client.from('phase_history').select('scope_kind,area_id,from_phase,to_phase,reason,recorded_by,actor_label')
    .eq('project_id', projectId).order('recorded_at'))
  assert(history.length >= 7, 'Project creation and explicit phase transitions must retain history')
  assert.equal(history[0].scope_kind, 'project')
  assert.equal(history[0].to_phase, 'concept')
  assert(history.some(row => row.scope_kind === 'area' && row.area_id === areaId && row.from_phase === 'planning' && row.to_phase === 'design'),
    'Backward Area transitions must be explicit and retained')
  assert(history.every(row => row.recorded_by && row.actor_label), 'Phase history is server-attributed')
  assert((await anonymous.rpc('phase_command', {
    p_project: projectId, p_scope: 'project', p_area: null, p_phase: 'complete', p_reason: 'Unsigned attempt',
  })).error, 'Unsigned phase changes are denied')
  assert((await client.from('phase_history').insert({
    project_id: projectId, scope_kind: 'project', from_phase: 'build', to_phase: 'complete', reason: 'Raw write',
  })).error, 'Phase history cannot be forged through raw writes')
  assert((await client.from('projects').update({ phase: 'complete' }).eq('id', projectId)).error,
    'Project phase changes must go through the guarded command')
  assert((await client.from('areas').update({ phase: 'build' }).eq('id', areaId)).error,
    'Area phase changes must go through the guarded command')

  const solutionRows = checked(await client.from('current_solutions').select('id,current_revision,area_id,archived')
    .eq('project_id', projectId))
  const areaSolution = solutionRows.find(row => row.area_id === areaId && !row.archived)
  const projectSolution = solutionRows.find(row => row.area_id === null && !row.archived)
  assert(areaSolution, 'The earlier solution proof must leave one active Area-scoped alternative')
  assert(projectSolution, 'The earlier solution proof must leave one active Project-scoped alternative')

  const projectPointerBefore = checked(await client.from('current_target').select('*')
    .eq('project_id', projectId).is('area_id', null).single())
  assert(projectPointerBefore.revision > 0, 'Earlier foundation steps must leave an exact Project target')

  checked(await target('select', areaSolution.id, 0, {
    solution_revision: areaSolution.current_revision,
    reason: 'Hosted phase verification: independent Area target',
    area_id: areaId,
  }))
  const areaPointer = checked(await client.from('current_target').select('*')
    .eq('project_id', projectId).eq('area_id', areaId).single())
  const projectPointerAfterArea = checked(await client.from('current_target').select('*')
    .eq('project_id', projectId).is('area_id', null).single())
  assert.equal(projectPointerAfterArea.revision, projectPointerBefore.revision,
    'Selecting an Area target must not rewrite the Project target pointer')
  assert.notEqual(areaPointer.revision, projectPointerBefore.revision,
    'Area and Project targets keep distinct exact target revisions')

  checked(await target('select', projectSolution.id, projectPointerBefore.revision, {
    solution_revision: projectSolution.current_revision,
    reason: 'Hosted phase verification: change only the Project target',
    area_id: null,
  }))
  const areaPointerAfterProject = checked(await client.from('current_target').select('*')
    .eq('project_id', projectId).eq('area_id', areaId).single())
  const projectPointerAfter = checked(await client.from('current_target').select('*')
    .eq('project_id', projectId).is('area_id', null).single())
  assert.equal(areaPointerAfterProject.revision, areaPointer.revision,
    'A Project target change must not replace an independent Area target pointer')
  assert.notEqual(projectPointerAfter.revision, projectPointerBefore.revision,
    'The Project target receives its own new exact decision revision')
  assert.equal(areaPointerAfterProject.solution_id, areaSolution.id)
  assert.equal(projectPointerAfter.solution_id, projectSolution.id)

  console.log('Live Project/Area phases: Concept default, explicit reversible transitions/history, completion guard, raw/anonymous denial and scope-safe Project/Area targets passed. No AI invoked.')
}
