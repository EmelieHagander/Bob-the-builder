/** Conversation memory: a narrative plus pointers to exact private transcript
 * messages. Current project/action state is delivered separately, never folded. */
export interface ConversationBrief { gist: string; index: { seq: number; descriptor: string }[] }
export const CONVERSATION_BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    gist: { type: 'string' },
    index: { type: 'array', maxItems: 40, items: {
      type: 'object', additionalProperties: false,
      properties: { seq: { type: 'integer' }, descriptor: { type: 'string' } },
      required: ['seq', 'descriptor'],
    } },
  }, required: ['gist', 'index'],
}
export function checkedBrief(value: unknown, through: number): ConversationBrief {
  const v = value as ConversationBrief
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['gist','index'].includes(k))
    || typeof v.gist !== 'string' || !v.gist.trim() || !Array.isArray(v.index) || v.index.length > 40
    || v.index.some(e => !e || Object.keys(e).some(k => !['seq','descriptor'].includes(k))
      || !Number.isSafeInteger(e.seq) || e.seq < 1 || e.seq > through
      || typeof e.descriptor !== 'string' || !e.descriptor.trim() || e.descriptor.length > 200)
    || new Set(v.index.map(e => e.seq)).size !== v.index.length
    || [...JSON.stringify(v)].length > 12000) throw new Error('context_unavailable')
  return { gist: v.gist, index: v.index.slice().sort((a,b) => a.seq-b.seq) }
}
export function readStoredBrief(summary: string, through: number): ConversationBrief {
  // Existing plain-text summaries remain readable until the next incremental fold.
  let decoded: unknown
  try { decoded = JSON.parse(summary) } catch { return { gist: summary, index: [] } }
  if (decoded && typeof decoded === 'object' && Object.hasOwn(decoded, 'gist') && Object.hasOwn(decoded, 'index')) {
    return checkedBrief(decoded, through)
  }
  return { gist: summary, index: [] }
}
