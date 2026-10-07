/*
 * Build-day dates. `events.day` is stored as text: new events save an ISO date
 * (`2026-10-11`) from a date picker, older events hold authored labels such as
 * `Lör 5 juli` or `Sat 5 Jul`. These helpers read both, so "next build day" is
 * the soonest upcoming day rather than whichever event was created first.
 */

const MONTHS: Record<string, number> = {
  jan: 0, januari: 0, january: 0,
  feb: 1, februari: 1, february: 1,
  mar: 2, mars: 2, march: 2,
  apr: 3, april: 3,
  maj: 4, may: 4,
  jun: 5, juni: 5, june: 5,
  jul: 6, juli: 6, july: 6,
  aug: 7, augusti: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  okt: 9, oct: 9, oktober: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, dek: 11, december: 11,
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * The calendar day an event's `day` text names, or null when it names none.
 * A label without a year is read as the nearest such day: this year, unless
 * that is more than six months ago.
 */
export function parseEventDay(day: string, today: Date = new Date()): Date | null {
  const text = day.trim()
  const iso = ISO_DAY.exec(text)
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return date.getMonth() === Number(iso[2]) - 1 ? date : null
  }
  const label = /(\d{1,2})\.?\s+([a-zåäö]+)\.?(?:\s+(\d{4}))?/i.exec(text)
  if (!label) return null
  const month = MONTHS[label[2].toLowerCase()]
  if (month === undefined) return null
  const dayOfMonth = Number(label[1])
  const base = startOfDay(today)
  let year = label[3] ? Number(label[3]) : base.getFullYear()
  let date = new Date(year, month, dayOfMonth)
  if (!label[3] && base.getTime() - date.getTime() > 183 * 86_400_000) date = new Date(++year, month, dayOfMonth)
  return date.getMonth() === month ? date : null
}

/** ISO `YYYY-MM-DD` for a date-picker value, or '' when the text names no day. */
export function eventDayInputValue(day: string, today: Date = new Date()): string {
  const date = parseEventDay(day, today)
  if (!date) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Readable label: ISO dates become `Sat 11 Oct`; authored labels stay as written. */
export function formatEventDay(day: string): string {
  const text = day.trim()
  if (!ISO_DAY.test(text)) return text
  const date = parseEventDay(text)
  return date ? date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '') : text
}

/**
 * The soonest event on or after today. Events whose day cannot be read keep
 * their list order and only count when no dated day is upcoming; past days
 * never count.
 */
export function pickNextEvent<T extends { day: string }>(events: T[], today: Date = new Date()): T | undefined {
  const base = startOfDay(today).getTime()
  let next: { event: T; time: number } | undefined
  let undated: T | undefined
  for (const event of events) {
    const date = parseEventDay(event.day, today)
    if (!date) {
      undated ??= event
      continue
    }
    const time = date.getTime()
    if (time >= base && (!next || time < next.time)) next = { event, time }
  }
  return next?.event ?? undated
}

/** Rewrite the taken half of an authored `taken / capacity` string from the real attendee count. */
export function spotsWithTaken(spots: string, taken: number): string {
  const cap = parseInt(spots.split('/')[1] ?? '', 10) || 0
  return `${taken} / ${cap}`
}
