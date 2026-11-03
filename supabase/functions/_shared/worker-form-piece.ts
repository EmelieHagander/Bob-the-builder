import { stableJsonValue } from './bob-job-journal.ts'
import { parseFormRefinement } from './construction-form.ts'

type Row = Record<string, any>
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter(object) : []
const name = (v: unknown, limit = 320) => typeof v === 'string' ? v.slice(0, limit) : null
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(v)
const compactIds = (values: string[]) => ({ count: values.length, ids: values.slice(0, 12), omitted: Math.max(0, values.length - 12) })

/** Only the approved Plan and its focus pointer own this Step. The focus is a
 * navigation hint, not proof that a free-text handover targets this Step. */
export function focusedWorkerStep(read: unknown, projectId: string): Row {
  const result = object(read) ? read : null
  if (result?.status === 'denied') return { status: 'denied' }
  if (result?.status !== 'ok') return { status: result?.status === 'not_initialized' ? 'no_plan' : 'unavailable' }
  const plan = object(result.record) ? result.record : null
  if (!plan || result.projectId !== projectId || plan.project_id !== projectId || plan.id !== projectId
    || plan.status !== 'approved' || !Number.isSafeInteger(plan.revision)) return { status: 'unavailable' }
  const source = { project_id: projectId, plan_revision: plan.revision }
  if (plan.focus_step_id === null) return { status: 'no_focused_step', source }
  if (typeof plan.focus_step_id !== 'string') return { status: 'unavailable' }
  const step = rows(plan.steps).find(s => s.id === plan.focus_step_id)
  if (!step) return { status: 'focus_missing', source, focus_step_id: plan.focus_step_id }
  const requirements = rows(step.requirements)
  return { status: 'ok', source, focus: { step_id: step.id, area_id: step.area_id ?? null, title: name(step.title),
      goal: name(step.goal, 600), state: step.state ?? null, notes: name(step.notes, 400) },
    requirements: { total: requirements.length, included: Math.min(requirements.length, 16), omitted: Math.max(0, requirements.length - 16),
      items: requirements.slice(0, 16).map(r => ({ id: r.id ?? null, title: name(r.title), description: name(r.description, 360),
        resolution: r.resolution ?? null, status: r.status ?? null, evidence_selector: r.evidence_selector ?? null })) },
    scope: 'project_focus_only', assignment_confirmed: false, requirement_completion_inferred: false,
    reopen: { tool: 'search_project_data', dataset: 'plan', record_id: null } }
}

const same = (a: unknown, b: unknown) => JSON.stringify(stableJsonValue(a)) === JSON.stringify(stableJsonValue(b))
function changedIds(before: unknown, after: unknown, key: string): string[] {
  const prior = new Map<string, Row>(rows(before).filter(r => id(r[key])).map(r => [r[key], r] as const))
  const later = new Map<string, Row>(rows(after).filter(r => id(r[key])).map(r => [r[key], r] as const))
  return [...new Set([...prior.keys(), ...later.keys()])].filter(k => !same(prior.get(k) ?? null, later.get(k) ?? null)).sort()
}

/** Code-only result of inspecting *exact* saved and preceding Construction
 * revisions. It describes persisted change, never infers that a window works,
 * matches a natural-language assignment, or has been approved. */
export function savedFormPieceEvidence(receipt: Row, current: unknown, previous: unknown, projectId: string, toolArgs?: unknown): Row {
  const artifactId = typeof receipt.artifact_id === 'string' ? receipt.artifact_id : receipt.record_id
  const revision = receipt.revision
  const now = object(current) ? current : null
  if (!now || now.status !== 'ok' || now.projectId !== projectId || now.artifact_id !== artifactId || now.revision !== revision
    || now.current_revision !== revision || now.archived !== false || now.source_state !== 'current')
    return { status: 'unavailable', reason: 'exact_current_construction_missing' }
  if (now.form_refinement == null) return { status: 'no_form_scope', artifact_id: artifactId, revision,
    verification: 'unverified', note: 'No FORM component mapping exists; a save and a check do not prove requested placement.' }
  let form: ReturnType<typeof parseFormRefinement>
  try { form = parseFormRefinement(now.form_refinement) }
  catch { return { status: 'unavailable', reason: 'invalid_saved_form_mapping' } }
  const scope = object(now.form_scope) ? now.form_scope : null
  const mapped = form.mappings.map(m => m.component_id), pending = scope?.pending_component_ids
  const choices = scope?.pending_choice_ids
  if (!scope || scope.verification !== 'unverified' || !Array.isArray(scope.component_ids) || !Array.isArray(pending)
    || !Array.isArray(choices) || !same([...scope.component_ids].sort(), [...mapped].sort())
    || ![...scope.component_ids, ...pending].every((v: unknown) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(v))
      || new Set([...scope.component_ids, ...pending]).size !== scope.component_ids.length + pending.length
    || choices.some((v: unknown) => typeof v !== 'string'))
    return { status: 'unavailable', reason: 'saved_form_scope_inconsistent' }

  let before: Row | null = null
  if (revision > 1) {
    before = object(previous) ? previous : null
    if (!before || before.status !== 'ok' || before.projectId !== projectId || before.artifact_id !== artifactId
      || before.revision !== revision - 1) return { status: 'unavailable', reason: 'prior_construction_revision_missing' }
  }
  let priorForm: ReturnType<typeof parseFormRefinement> | null = null
  if (before?.form_refinement != null) {
    try { priorForm = parseFormRefinement(before.form_refinement) }
    catch { return { status: 'unavailable', reason: 'prior_form_mapping_invalid' } }
  }
  const newlyMapped = mapped.filter(v => !priorForm?.mappings.some(m => m.component_id === v))
  const currentInstances = rows(now.recipe?.instances), priorInstances = rows(before?.recipe?.instances)
  const changedParts = changedIds(before?.recipe?.instances, now.recipe?.instances, 'id')
  const changedDefinitions = changedIds(before?.recipe?.definitions, now.recipe?.definitions, 'id')
  const changedMaterials = changedIds(before?.materials, now.materials, 'definition_id')
  const changedRoles = changedIds(before?.instance_policy?.instances, now.instance_policy?.instances, 'instance_id')
  const changedJoints = changedIds(before?.joints, now.joints, 'id')
  const changedNodes = changedIds(before?.parameters?.nodes, now.parameters?.nodes, 'id')
  const changedBindings = changedIds(before?.parameters?.bindings, now.parameters?.bindings, 'path')
  const affectedParts = new Set([...changedParts, ...changedRoles])
  const allInstances = [...currentInstances, ...priorInstances]
  for (const instance of allInstances) if ([...changedDefinitions, ...changedMaterials].includes(instance.definition_id)) affectedParts.add(instance.id)
  for (const joint of [...rows(now.joints), ...rows(before?.joints)]) if (changedJoints.includes(joint.id)) {
    if (id(joint.first?.instance_id)) affectedParts.add(joint.first.instance_id)
    if (id(joint.second?.instance_id)) affectedParts.add(joint.second.instance_id)
  }
  // Parameter nodes/bindings may have transitive effects on placements and
  // sizes. Do not silently pretend the directly changed instances are complete.
  const parameterEffectsUnknown = changedNodes.length > 0 || changedBindings.length > 0
  const byInstance = new Map(form.mappings.flatMap(m => m.instance_ids.map(i => [i, m.component_id] as const)))
  const byPriorInstance = new Map((priorForm?.mappings ?? []).flatMap(m => m.instance_ids.map(i => [i, m.component_id] as const)))
  const observedComponents = [...new Set([...affectedParts].flatMap(i => [byInstance.get(i), byPriorInstance.get(i)]).filter((v): v is string => !!v))].sort()
  const currentChangedComponents = [...new Set([...affectedParts].map(i => byInstance.get(i)).filter((v): v is string => !!v))].sort()
  const removedMappings = [...affectedParts].some(i => byPriorInstance.has(i) && !byInstance.has(i))
  const unmappedPartIds = [...affectedParts].filter(i => !byInstance.has(i) && !byPriorInstance.has(i)).sort()
  const requested = object(toolArgs) && object(toolArgs.changes) ? toolArgs.changes : null
  const namedPartIds = requested && object(requested.instances)
    ? [...rows(requested.instances.upsert).map(v => v.id), ...(Array.isArray(requested.instances.remove) ? requested.instances.remove : [])].filter(id) as string[] : []
  const unmatchedNamedParts = namedPartIds.filter(i => !changedParts.includes(i))
  const scoped = !parameterEffectsUnknown && !removedMappings && unmappedPartIds.length === 0 && currentChangedComponents.length <= 48
  return { status: 'form_scoped', artifact_id: artifactId, revision,
    source: { solution_id: now.solution_id ?? null, solution_revision: now.solution_revision ?? null,
      target_revision: now.target_revision ?? null },
    mapped_components: compactIds(mapped), pending_components: compactIds(pending), pending_choices: compactIds(choices),
    newly_mapped_components: compactIds(newlyMapped), observed_component_changes: compactIds(observedComponents),
    explicit_instance_changes: { named: compactIds(namedPartIds), not_observed: compactIds(unmatchedNamedParts) },
    affected_scope_complete: scoped, affected_scope_gaps: [
      ...(parameterEffectsUnknown ? ['parameter_or_binding_effects_not_traced'] : []),
      ...(removedMappings ? ['removed_form_mapping_needs_review'] : []),
      ...(unmappedPartIds.length ? ['changed_instances_without_form_mapping'] : []),
      ...(currentChangedComponents.length > 48 ? ['too_many_components_for_local_check'] : []),
    ],
    scope_check_ids: scoped ? currentChangedComponents : [],
    verification: 'unverified', user_confirmation: 'not_recorded', functional_fidelity: 'unverified',
    note: 'Exact saved parts/FORM coverage, not proof of window count, placement, function, structure or owner acceptance.' }
}
