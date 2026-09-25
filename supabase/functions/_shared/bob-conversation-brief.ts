/** Conversation memory: a narrative plus pointers to exact private transcript
 * messages. Current project/action state is delivered separately, never folded. */
export interface ConversationBrief { gist: string; index: { seq: number; descriptor: string }[] }
export const BRIEF_LIMITS = { characters: 12000, gist: 6000, entries: 40, descriptor: 200 } as const
export class InvalidConversationBrief extends Error {
  constructor(readonly reason: 'shape' | 'size' | 'pointers' | 'coverage') { super('context_unavailable') }
}
export const CONVERSATION_BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    gist: { type: 'string', minLength: 1, maxLength: BRIEF_LIMITS.gist },
    index: { type: 'array', maxItems: BRIEF_LIMITS.entries, items: {
      type: 'object', additionalProperties: false,
      properties: { seq: { type: 'integer', minimum: 1 }, descriptor: { type: 'string', minLength: 1, maxLength: BRIEF_LIMITS.descriptor } },
      required: ['seq', 'descriptor'],
    } },
  }, required: ['gist', 'index'],
}
export function checkedBrief(value: unknown, through: number, maxGistCharacters: number = BRIEF_LIMITS.characters): ConversationBrief {
  const v = value as ConversationBrief
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['gist','index'].includes(k))
    || typeof v.gist !== 'string' || !v.gist.trim() || !Array.isArray(v.index)) throw new InvalidConversationBrief('shape')
  if (v.index.length > BRIEF_LIMITS.entries || v.index.some(e => !e || Object.keys(e).some(k => !['seq','descriptor'].includes(k))
      || !Number.isSafeInteger(e.seq) || e.seq < 1 || e.seq > through
      || typeof e.descriptor !== 'string' || !e.descriptor.trim() || [...e.descriptor].length > BRIEF_LIMITS.descriptor)
    || new Set(v.index.map(e => e.seq)).size !== v.index.length) throw new InvalidConversationBrief('pointers')
  if ([...v.gist].length > maxGistCharacters || [...JSON.stringify(v)].length > BRIEF_LIMITS.characters) throw new InvalidConversationBrief('size')
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
