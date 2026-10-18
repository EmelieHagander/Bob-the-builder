import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'

/** Encoding used by the pinned GPT-5.4 family. These are content tokens, not
 * provider billing totals: call envelopes and image inputs need their own
 * allowance. Never substitute a character/word heuristic for this boundary. */
export const CONTEXT_TOKEN_ENCODING = 'o200k_base' as const

export function countContextTokens(text: string): number {
  // Literal special-token spellings in user data are ordinary text, too.
  return countTokens(text, { disallowedSpecial: new Set<string>() })
}

export function countSerializedTokens(value: unknown): number {
  const text = JSON.stringify(value)
  if (text === undefined) throw new TypeError('context_not_serializable')
  return countContextTokens(text)
}
