/*
 * Date formatting for the account level (calendar, schedules, notes).
 * Everything works on plain ISO dates (YYYY-MM-DD) so no timezone maths
 * can shift a build day.
 */

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
})

/** Local date as ISO (YYYY-MM-DD) — without any UTC shift. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** "2026-07-10" → "10 July 2026". Tolerates full ISO timestamps too. */
export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(date.getTime())) return iso
  return dateFormatter.format(date)
}

/** "July 2026" for a calendar month. */
export function formatMonth(year: number, monthIndex: number): string {
  return monthFormatter.format(new Date(year, monthIndex, 1))
}

/** One day → "10 July 2026", otherwise "5 July 2026 – 15 August 2026". */
export function formatDateRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatDate(startIso)
  return `${formatDate(startIso)} – ${formatDate(endIso)}`
}

/** ISO timestamp → "just now" / "35 min ago" / "2 h ago" / "3 days ago" / a date. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return formatDate(iso)
}
