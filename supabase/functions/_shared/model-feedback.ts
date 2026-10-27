import type { ProjectWriter } from './project-write.ts'
import { parseSolutionPresentation } from '../../../src/domain/modelFeedback.ts'
import { rethrowContinuation } from './bob-job-journal.ts'

const tool = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function' as const, function: { name, description,
  parameters: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } })
export const MODEL_FEEDBACK_TOOLS = [
  tool('read_model_feedback', 'Read the exact model presentation attached to this user turn and its latest scoped feedback. Includes source freshness and user/Bob authority. not_shown means this turn has no displayed model binding; selection or alignment prose does not prove a preview was seen. Historical feedback is context, not acceptance of changed sources. No geometry reread. before_feedback_id=null reads the latest page; reuse next_feedback_id to read earlier responses.', { before_feedback_id: { type: ['string', 'null'] } }),
  tool('record_model_feedback', 'Record the meaning of the ordinary response to the shown model, without a second confirmation. Consider the whole response: agreement with a correction is change_requested; silence or ambiguity is not acceptance. Scope concerns intended form/function, never safety or technical verification. The server binds actor, shown revision and current turn. user records this reply; delegated preserves an explicit mandate without accepting the model. bob acceptance reuses mandate_id from a current delegated response. No private chat text is shared. A stale presentation requires reconciliation, not rebinding the old reply to a new version.', {
    outcome: { type: 'string', enum: ['accepted', 'change_requested', 'unclear', 'delegated'] },
    authority: { type: 'string', enum: ['user', 'bob'] }, mandate_id: { type: ['string', 'null'] },
    scope: { type: 'string', enum: ['whole_model', 'components'] },
    component_ids: { type: 'array', items: { type: 'string' }, maxItems: 48, description: 'Exact active concept component IDs for limited scope. Empty for whole_model; the server expands that scope.' },
    has_corrections: { type: 'boolean' }, has_uncertainty: { type: 'boolean' },
  }),
]
export interface ModelFeedbackOptions {
  projectId: string; message: string; writer?: ProjectWriter
  read: (before: string | null) => PromiseLike<{ data: unknown; error: unknown }>
}
/** Stateless: retries use the turn's immutable server presentation and normal
 * journal/receipt machinery, including after process restart. */
export async function executeModelFeedback(opts: ModelFeedbackOptions, name: string, value: unknown): Promise<any> {
  const v = value as Record<string, unknown>
  if (name === 'read_model_feedback') {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => k !== 'before_feedback_id')
      || !(v.before_feedback_id == null || typeof v.before_feedback_id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v.before_feedback_id))) return { status: 'invalid' }
    try {
      const { data, error } = await opts.read(v.before_feedback_id as string | null ?? null)
      if (error) return { status: 'unavailable' }
      const result = data as { status: string; presentation?: unknown }
      if (result?.status === 'not_shown') return { status: 'not_shown' }
      const p = result?.status === 'ok' && parseSolutionPresentation(result.presentation, opts.projectId)
      return p ? { status: 'ok', presentation: p } : { status: 'unavailable' }
    } catch (error) { rethrowContinuation(error); return { status: 'unavailable' } }
  }
  if (!opts.writer) return { status: 'denied' }
  const keys = ['outcome', 'authority', 'mandate_id', 'scope', 'component_ids', 'has_corrections', 'has_uncertainty']
  const valid = name === 'record_model_feedback' && v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).sort().join(',') === keys.sort().join(',')
    && ['accepted','change_requested','unclear','delegated'].includes(String(v.outcome)) && ['user','bob'].includes(String(v.authority))
    && ['whole_model','components'].includes(String(v.scope)) && Array.isArray(v.component_ids) && v.component_ids.length <= 48
    && v.component_ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 40) && new Set(v.component_ids).size === v.component_ids.length
    && (v.scope === 'whole_model' ? v.component_ids.length === 0 : v.component_ids.length > 0)
    && typeof v.has_corrections === 'boolean' && typeof v.has_uncertainty === 'boolean'
    && (!v.has_corrections || v.outcome === 'change_requested') && (!v.has_uncertainty || ['unclear','change_requested'].includes(String(v.outcome)))
    && (v.outcome !== 'change_requested' || v.has_corrections) && (v.outcome !== 'unclear' || v.has_uncertainty)
    && (v.authority === 'user' ? v.mandate_id === null : v.outcome === 'accepted' && typeof v.mandate_id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v.mandate_id))
  return opts.writer.commitBound(name, 'shown_model', valid ? { kind: 'form_feedback', record_id: null, expected_updated_at: null, expected_revision: null,
    request_quote: Array.from(opts.message).slice(0, 500).join(''), data: structuredClone(v) } : null)
}
