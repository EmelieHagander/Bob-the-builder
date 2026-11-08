import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusedWorkerStep, savedFormPieceEvidence } from '../supabase/functions/_shared/worker-form-piece.ts'

const plan = { status: 'ok', projectId: 'p1', record: { id: 'p1', project_id: 'p1', revision: 9,
  status: 'approved', focus_step_id: 's1', steps: [{ id: 's1', title: 'Window walls', goal: 'Place seven windows',
    state: 'active', area_id: null, notes: 'One facade at a time', requirements: [
      { id: 'r1', title: 'East side', description: 'Show position', resolution: 'open', status: 'open' },
      { id: 'r2', title: 'West side', description: 'Show position', resolution: 'open', status: 'open' },
    ] }, { id: 's2', title: 'Order timber', requirements: [] }] } }

const receipt = { tool: 'edit_construction_parts', record_id: 'construction-1', revision: 3 }
const before = { status: 'ok', projectId: 'p1', artifact_id: 'construction-1', revision: 2,
  form_refinement: { version: 1, mappings: [{ component_id: 'window_east', instance_ids: ['window_e'] }] },
  recipe: { instances: [{ id: 'window_e', definition_id: 'opening' }], definitions: [{ id: 'opening', primitive: 'box' }] },
  parameters: { nodes: [], bindings: [] }, instance_policy: { instances: [] }, materials: [], joints: [] }
const after = { ...before, revision: 3, current_revision: 3, source_state: 'current', archived: false,
  form_refinement: { version: 1, mappings: [
    { component_id: 'window_east', instance_ids: ['window_e'] }, { component_id: 'window_west', instance_ids: ['window_w'] },
  ] }, form_scope: { component_ids: ['window_east', 'window_west'], pending_component_ids: ['window_south'],
    pending_choice_ids: ['window_type'], verification: 'unverified' },
  recipe: { instances: [...before.recipe.instances, { id: 'window_w', definition_id: 'opening' }], definitions: before.recipe.definitions } }

test('focused plan Step is sourced and compact, not treated as the assignment or completion proof', () => {
  const packet = focusedWorkerStep(plan, 'p1')
  assert.equal(packet.status, 'ok')
  assert.deepEqual(packet.source, { project_id: 'p1', plan_revision: 9 })
  assert.equal(packet.focus.step_id, 's1')
  assert.equal(packet.requirements.total, 2)
  assert.equal(packet.requirements.items[0].id, 'r1')
  assert.equal(packet.assignment_confirmed, false)
  assert.equal(packet.requirement_completion_inferred, false)
  assert.deepEqual(focusedWorkerStep({ ...plan, record: { ...plan.record, focus_step_id: null } }, 'p1').status, 'no_focused_step')
  assert.equal(focusedWorkerStep({ ...plan, record: { ...plan.record, focus_step_id: 'missing' } }, 'p1').status, 'focus_missing')
  assert.equal(focusedWorkerStep(plan, 'other-project').status, 'unavailable')
  assert.equal(focusedWorkerStep({ status: 'unavailable' }, 'p1').status, 'unavailable')
})

test('one saved window is distinguished from remaining windows, with exact component ids', () => {
  const evidence = savedFormPieceEvidence(receipt, after, before, 'p1',
    { changes: { instances: { upsert: [{ id: 'window_w' }], remove: [] } } })
  assert.equal(evidence.status, 'form_scoped')
  assert.deepEqual(evidence.newly_mapped_components, { count: 1, ids: ['window_west'], omitted: 0 })
  assert.deepEqual(evidence.observed_component_changes.ids, ['window_west'])
  assert.deepEqual(evidence.scope_check_ids, ['window_west'])
  assert.equal(evidence.pending_components.count, 1)
  assert.equal(evidence.pending_choices.count, 1)
  assert.equal(evidence.explicit_instance_changes.not_observed.count, 0)
  assert.equal(evidence.functional_fidelity, 'unverified')
  assert.equal(evidence.user_confirmation, 'not_recorded')
})

test('parameter changes are explicitly unresolved, not misreported as a complete local scope', () => {
  const changed = { ...after, parameters: { nodes: [{ id: 'distance', value: 100 }], bindings: [] } }
  const evidence = savedFormPieceEvidence(receipt, changed, before, 'p1')
  assert.equal(evidence.status, 'form_scoped')
  assert.equal(evidence.affected_scope_complete, false)
  assert.deepEqual(evidence.scope_check_ids, [])
  assert.deepEqual(evidence.affected_scope_gaps, ['parameter_or_binding_effects_not_traced'])
})

test('removed FORM mappings are not passed to the current local checker', () => {
  const removed = { ...after,
    form_refinement: { version: 1, mappings: [{ component_id: 'window_west', instance_ids: ['window_w'] }] },
    form_scope: { ...after.form_scope, component_ids: ['window_west'], pending_component_ids: ['window_east', 'window_south'] },
    recipe: { ...after.recipe, instances: [{ id: 'window_w', definition_id: 'opening' }] } }
  const evidence = savedFormPieceEvidence(receipt, removed, before, 'p1')
  assert.equal(evidence.status, 'form_scoped')
  assert.equal(evidence.affected_scope_complete, false)
  assert.deepEqual(evidence.scope_check_ids, [])
  assert.deepEqual(evidence.affected_scope_gaps, ['removed_form_mapping_needs_review'])
})

test('stale, foreign, absent and inconsistent saves fail closed without invented zero counts', () => {
  assert.deepEqual(savedFormPieceEvidence(receipt, { ...after, current_revision: 4 }, before, 'p1'),
    { status: 'unavailable', reason: 'exact_current_construction_missing' })
  assert.equal(savedFormPieceEvidence(receipt, { ...after, projectId: 'foreign' }, before, 'p1').status, 'unavailable')
  assert.equal(savedFormPieceEvidence(receipt, after, null, 'p1').reason, 'prior_construction_revision_missing')
  assert.equal(savedFormPieceEvidence(receipt, { ...after, form_scope: { ...after.form_scope, pending_component_ids: ['window_east'] } }, before, 'p1').reason,
    'saved_form_scope_inconsistent')
  const unscoped = savedFormPieceEvidence(receipt, { ...after, form_refinement: null }, null, 'p1')
  assert.equal(unscoped.status, 'no_form_scope')
  assert.equal('pending_components' in unscoped, false)
})

test('a newly created Construction revision can report its mapped scope without a predecessor', () => {
  const fresh = savedFormPieceEvidence({ ...receipt, revision: 1 }, { ...after, revision: 1, current_revision: 1 }, null, 'p1')
  assert.equal(fresh.status, 'form_scoped')
  assert.equal(fresh.newly_mapped_components.count, 2)
  assert.deepEqual(fresh.scope_check_ids, ['window_east', 'window_west'])
})

test('a legacy delta has exact whole-construction evidence and never gains invented FORM mapping',()=>{
 const current={...after,form_refinement:null,form_scope:null},prior={...before,form_refinement:null}
 const evidence=savedFormPieceEvidence(receipt,current,prior,'p1',{},true);assert.equal(evidence.status,'construction_scoped');assert.equal(evidence.form_mapping,false);assert.equal(evidence.verification,'unverified');assert.equal(evidence.changed_instances.count,1)
 assert.equal(savedFormPieceEvidence(receipt,current,{...prior,projectId:'other'},'p1',{},true).status,'unavailable')
 assert.equal(savedFormPieceEvidence(receipt,current,prior,'p1',{}).status,'no_form_scope','old jobs retain their contract')
})
