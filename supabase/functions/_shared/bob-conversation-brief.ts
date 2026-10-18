import { CONTEXT_TOKEN_ENCODING, countSerializedTokens } from './bob-token-budget.ts'

/** Conversation memory: a narrative plus pointers to exact private transcript
 * messages. Current project/action state is delivered separately, never folded. */
export interface ConversationBrief { gist: string; index: { seq: number; descriptor: string }[] }
export const BRIEF_LIMITS = { characters: 12000, gist: 6000, entries: 40, descriptor: 200 } as const
/** V1 keeps its character-based replay contract. V2 bounds the entire serialized
 * memory, including its references, using the active model-family encoding. */
export const BRIEF_TOKEN_POLICY = {
  version: 2, encoding: CONTEXT_TOKEN_ENCODING, targetTokens: { min: 800, max: 1200 }, maxTokens: 1600,
  maxCharacters: BRIEF_LIMITS.characters, maxEntries: BRIEF_LIMITS.entries, maxDescriptorCharacters: BRIEF_LIMITS.descriptor,
} as const
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
function briefParts(value: unknown, through: number, maxGistCharacters: number): ConversationBrief {
  const v = value as ConversationBrief
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['gist','index'].includes(k))
    || typeof v.gist !== 'string' || !v.gist.trim() || !Array.isArray(v.index)) throw new InvalidConversationBrief('shape')
  if (v.index.length > BRIEF_LIMITS.entries || v.index.some(e => !e || Object.keys(e).some(k => !['seq','descriptor'].includes(k))
      || !Number.isSafeInteger(e.seq) || e.seq < 1 || e.seq > through
      || typeof e.descriptor !== 'string' || !e.descriptor.trim() || [...e.descriptor].length > BRIEF_LIMITS.descriptor)
    || new Set(v.index.map(e => e.seq)).size !== v.index.length) throw new InvalidConversationBrief('pointers')
  if ([...v.gist].length > maxGistCharacters) throw new InvalidConversationBrief('size')
  return { gist: v.gist, index: v.index.slice().sort((a,b) => a.seq-b.seq) }
}
const briefCharacters = (brief: ConversationBrief) => [...JSON.stringify(brief)].length
export function checkedBrief(value: unknown, through: number, maxGistCharacters: number = BRIEF_LIMITS.characters): ConversationBrief {
  const brief = briefParts(value, through, maxGistCharacters)
  if (briefCharacters(brief) > BRIEF_LIMITS.characters) throw new InvalidConversationBrief('size')
  return brief
}

/** The model maintains meaning; the manager owns bounded navigation. Original
 * messages remain in the private transcript even when an old hint leaves T2.
 * Never invent a topic for a missing model pointer: use only source metadata. */
export function manageConversationBrief(value: unknown, previous: ConversationBrief,
  older: readonly { seq: number; role: 'user' | 'assistant'; state: 'pending' | 'completed' | 'failed' }[], through: number): ConversationBrief {
  const candidate = briefParts(value, through, BRIEF_LIMITS.gist)
  const known = new Set([...previous.index.map(e => e.seq), ...older.map(m => m.seq)])
  if (candidate.index.some(e => !known.has(e.seq))) throw new InvalidConversationBrief('coverage')
  const required = new Map(older.map(m => [m.seq, {
    seq: m.seq, descriptor: `Message ${m.seq}: ${m.role}, ${m.state}`,
  }]))
  if (required.size !== older.length || required.size > 16) throw new InvalidConversationBrief('coverage')
  const brief: ConversationBrief = { gist: candidate.gist, index: [...required.values()] }
  // Reserve every newly folded source before selecting optional older hints.
  // Even escaped JSON must fit the stored character budget. The gist is never
  // sliced, and an invalid gist still follows the ordinary semantic repair.
  checkedBrief(brief, through, BRIEF_LIMITS.gist)
  for (const entry of candidate.index.filter(e => required.has(e.seq))) {
    const at = brief.index.findIndex(e => e.seq === entry.seq), fallback = brief.index[at]
    brief.index[at] = entry
    if (briefCharacters(brief) > BRIEF_LIMITS.characters) brief.index[at] = fallback
  }
  // The model selects useful historical topics. If its selection is too large,
  // keep newer selected hints first; omitted originals remain exactly searchable.
  for (const entry of candidate.index.filter(e => !required.has(e.seq)).reverse()) {
    if (brief.index.length >= BRIEF_LIMITS.entries) break
    brief.index.push(entry)
    if (briefCharacters(brief) > BRIEF_LIMITS.characters) brief.index.pop()
  }
  return checkedBrief(brief, through, BRIEF_LIMITS.gist)
}

/** The assistant may rewrite the whole brief and omit any old or new pointer.
 * Coverage belongs to the persisted fold cursor, not an ever-growing list of
 * message hints. A rejected candidate is repaired as a whole, never sliced or
 * silently stripped of references to meet the token limit. */
export function manageConversationBriefV2(value: unknown, previous: ConversationBrief,
  older: readonly { seq: number }[], through: number): ConversationBrief {
  const brief = checkedBrief(value, through)
  const available = new Set([...previous.index.map(entry => entry.seq), ...older.map(message => message.seq)])
  if (brief.index.some(entry => !available.has(entry.seq))) throw new InvalidConversationBrief('coverage')
  if (countSerializedTokens(brief) > BRIEF_TOKEN_POLICY.maxTokens) throw new InvalidConversationBrief('size')
  return brief
}

export function briefFitsTokenBudget(brief: ConversationBrief): boolean {
  return briefCharacters(brief) <= BRIEF_TOKEN_POLICY.maxCharacters
    && countSerializedTokens(brief) <= BRIEF_TOKEN_POLICY.maxTokens
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
