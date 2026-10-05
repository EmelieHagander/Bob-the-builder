/** Only sum authored task hours when every saved task has a recognisable estimate.
 * This describes saved tasks, never a promise that all project work is captured. */
export function savedTaskEstimate(hours: string[]): string | null {
  if (!hours.length) return null
  let low = 0, high = 0
  for (const text of hours) {
    const match = text.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:[–—-]\s*(\d+(?:[.,]\d+)?))?\s*(?:h|hr|hrs|hours?)?$/i)
    if (!match) return null
    const a = Number(match[1].replace(',', '.')), b = Number((match[2] ?? match[1]).replace(',', '.'))
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < a) return null
    low += a; high += b
  }
  const format = (n: number) => String(Math.round(n * 10) / 10)
  return low === high ? `${format(low)} h` : `${format(low)}–${format(high)} h`
}
