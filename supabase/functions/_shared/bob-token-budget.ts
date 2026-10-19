import { countTokens, encode, decode } from 'gpt-tokenizer/encoding/o200k_base'

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

/** Longest prefix of text, in whole Unicode characters, whose own count is
 * within tokens. Encodes once instead of re-counting every bisection step. */
export function contextTokenPrefix(text: string, tokens: number): string {
  const ids = encode(text, { disallowedSpecial: new Set<string>() })
  if (ids.length <= tokens) return text
  // A token can end inside a multi-byte character; keep whole characters only.
  let chars = Array.from(decode(ids.slice(0, tokens)))
  while (chars.length && !text.startsWith(chars.join(''))) chars.pop()
  // Re-encoding a cut can merge differently; shrink to a prefix that fits.
  let low = 0, high = chars.length
  if (countContextTokens(chars.join('')) <= tokens) return chars.join('')
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (countContextTokens(chars.slice(0, middle).join('')) <= tokens) low = middle
    else high = middle - 1
  }
  return chars.slice(0, low).join('')
}
