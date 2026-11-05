import type { OpenAIServiceOptions } from './openai-service.ts'

type Message = NonNullable<OpenAIServiceOptions['messages']>[number]
export const STAGE_CONTEXT_TOOL = 'advance_work_stage'
export {stageImageRef} from './image-context-ref.ts'
export function bobStageContextVersion(checkpoint: boolean, metadata: Record<string, unknown>): { stageContextVersion?: 1 } {
  if (metadata.stage_context_version === undefined) return {}
  if (metadata.stage_context_version !== 1 || metadata.complete_request_version !== 1 || metadata.result_reference_version !== 1 || metadata.context_strategy_version !== 1) throw new Error('stage_context_contract_invalid')
  return checkpoint ? { stageContextVersion: 1 } : {}
}
export type StageContextNote = {
  completed_question: string
  findings: { source_ref: string; observation: string }[]
  unresolved: string[]
  next_step: string
  keep_image_refs: string[]
}
/** Model chooses when a question is settled. Code owns what may be released,
 * exact source identity, native protocol and the immutable operation archive. */
export const STAGE_CONTEXT_SPEC = { type: 'function' as const, function: {
  name: STAGE_CONTEXT_TOOL,
  description: 'Move from a settled question to the next small stage. Replace the short handoff and release older tool payloads and unneeded image pixels from active input. Keep images still needed for a comparison. Original instructions and the exact get_work_history archive remain; this records no project decision or approval. Call alone, after recording source-bound findings.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    completed_question: { type: 'string', minLength: 1, maxLength: 300 },
    findings: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: {
      source_ref: { type: 'string', minLength: 1, maxLength: 300, description: 'Exact active image context_ref, or call:<call_id> for an observed tool result. Historical evidence does not grant fresh authority.' },
      observation: { type: 'string', minLength: 1, maxLength: 300 },
    }, required: ['source_ref', 'observation'] } },
    unresolved: { type: 'array', maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 200 } },
    next_step: { type: 'string', minLength: 1, maxLength: 250 },
    keep_image_refs: { type: 'array', uniqueItems: true, maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 300 }, description: 'Copy exact context_ref values whose pixels are still needed. [] releases registered private pixels. Reopen a released source through open_project_item when it is needed again.' },
  }, required: ['completed_question', 'findings', 'unresolved', 'next_step', 'keep_image_refs'] },
} }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max
export function parseStageContextNote(value: unknown): StageContextNote | null {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'completed_question,findings,keep_image_refs,next_step,unresolved'
    || !text(value.completed_question, 300) || !text(value.next_step, 250)
    || !Array.isArray(value.unresolved) || value.unresolved.length > 6 || !value.unresolved.every(v => text(v, 200))
    || !Array.isArray(value.keep_image_refs) || value.keep_image_refs.length > 16 || !value.keep_image_refs.every(v => text(v, 300))
    || new Set(value.keep_image_refs).size !== value.keep_image_refs.length
    || !Array.isArray(value.findings) || value.findings.length > 12 || !value.findings.every(v => object(v)
      && Object.keys(v).sort().join(',') === 'observation,source_ref' && text(v.source_ref, 300) && text(v.observation, 300))) return null
  return structuredClone(value) as StageContextNote
}
const ordinaryUser = (m: Message) => m.role === 'user' && m.nativeOutput === undefined && !m.tool_calls?.length && !m.tool_call_id

export function prepareStageContext(input: {
  value: unknown; seed: Message[]; history: Message[]; callIds: ReadonlySet<string>
  imageSource: (url: string) => string | undefined
}): { status: 'ready'; note: StageContextNote; seed: Message[]; before: number; after: number } | { status: 'invalid'; reason: string } {
  const note = parseStageContextNote(input.value)
  if (!note) return { status: 'invalid', reason: 'bounded_handoff_required' }
  const known = new Set<string>()
  let before = 0, after = 0
  for (const m of [...input.seed, ...input.history]) for (const p of Array.isArray(m.content) ? m.content : []) {
    if (p.type !== 'image_url') continue
    before++
    if (!ordinaryUser(m)) return { status: 'invalid', reason: 'non_user_image_must_remain' }
    const url = typeof p.image_url === 'string' ? p.image_url : p.image_url.url
    const ref = url.startsWith('private-image:') ? input.imageSource(url) : undefined
    if (ref) known.add(ref)
  }
  if (note.keep_image_refs.some(ref => !known.has(ref))) return { status: 'invalid', reason: 'image_ref_not_active' }
  if (note.findings.some(f => !known.has(f.source_ref) && !(f.source_ref.startsWith('call:') && input.callIds.has(f.source_ref.slice(5))))) {
    return { status: 'invalid', reason: 'finding_source_not_observed' }
  }
  // Preserve every seed text and later user constraint verbatim. Only known
  // private image parts can leave; public/unknown identities stay literal.
  const preserve = (m: Message): Message[] => {
    if (!Array.isArray(m.content)) return [structuredClone(m)]
    const content = m.content.filter(p => {
      if (p.type !== 'image_url') return true
      const url = typeof p.image_url === 'string' ? p.image_url : p.image_url.url
      const ref = url.startsWith('private-image:') ? input.imageSource(url) : undefined
      const keep = !ref || note.keep_image_refs.includes(ref)
      if (keep) after++
      return keep
    })
    return content.length ? [{ ...structuredClone(m), content: structuredClone(content) }] : []
  }
  return { status: 'ready', note, seed: [...input.seed.flatMap(preserve), ...input.history.filter(m => m.role === 'user').flatMap(preserve)], before, after }
}
