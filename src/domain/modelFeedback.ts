/** Shared, bounded metadata. Private conversational text never enters this packet. */
export type ModelFeedbackOutcome = 'accepted' | 'change_requested' | 'unclear' | 'delegated'
export interface ModelFeedback {
  id: string; project_id: string; presentation_id: string; actor_label: string
  outcome: ModelFeedbackOutcome; authority: 'user' | 'bob'; mandate_id: string | null
  area_id: string | null; scope_label: string
  scope: 'whole_model' | 'components'; component_ids: string[]; recorded_at: string
  source_current: boolean; view_id: string
}
export interface SolutionPresentation {
  id: string; project_id: string; solution_id: string; solution_revision: number
  area_id: string | null; scope_label: string; artifact_id: string | null; artifact_revision: number | null
  representation: 'concept_2d' | 'construction_3d'; view_id: string; renderer_version: string
  components: { id: string; label: string }[]
  shown_by: string; shown_at: string; source_current: boolean; can_respond: boolean; feedback: ModelFeedback[]; next_feedback_id: string | null
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
const text = (v: unknown, max = 240): v is string => typeof v === 'string' && !!v.length && v.length <= max
export function parseSolutionPresentation(value: unknown, project: string): SolutionPresentation | null {
  const v = value as SolutionPresentation
  if (!v || v.project_id !== project || !uuid(v.id) || !uuid(v.solution_id) || !Number.isSafeInteger(v.solution_revision) || v.solution_revision < 1
    || !(v.area_id === null || text(v.area_id, 200)) || !text(v.scope_label)
    || !['concept_2d', 'construction_3d'].includes(v.representation) || !text(v.view_id) || !text(v.renderer_version)
    || !text(v.shown_by) || !text(v.shown_at) || !Number.isFinite(Date.parse(v.shown_at))
    || !Array.isArray(v.components) || v.components.length > 48 || v.components.some(c => !c || !text(c.id, 40) || !text(c.label))
    || typeof v.source_current !== 'boolean' || typeof v.can_respond !== 'boolean'
    || (v.representation === 'concept_2d' ? v.artifact_id !== null || v.artifact_revision !== null : !uuid(v.artifact_id) || !Number.isSafeInteger(v.artifact_revision) || v.artifact_revision! < 1)
    || !(v.next_feedback_id === null || uuid(v.next_feedback_id))
    || !Array.isArray(v.feedback) || v.feedback.length > 10 || v.feedback.some(f => !f || !uuid(f.id) || f.project_id !== project || !uuid(f.presentation_id)
      || !text(f.actor_label) || !['accepted', 'change_requested', 'unclear', 'delegated'].includes(f.outcome)
      || !['user', 'bob'].includes(f.authority) || !(f.mandate_id === null || uuid(f.mandate_id))
      || !(f.area_id === null || text(f.area_id, 200)) || !text(f.scope_label)
      || !['whole_model', 'components'].includes(f.scope) || !Array.isArray(f.component_ids) || !f.component_ids.length || f.component_ids.length > 48
      || f.component_ids.some(id => !text(id, 40)) || typeof f.source_current !== 'boolean' || !text(f.view_id)
      || !text(f.recorded_at) || !Number.isFinite(Date.parse(f.recorded_at)))) return null
  return structuredClone(v)
}
