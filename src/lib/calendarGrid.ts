import { toIsoDate } from './format'

/*
 * Month grid for the account calendar: 6 weeks × 7 days with Monday as the
 * first day of the week (Swedish convention). Pure logic — no DOM, no data
 * access. Ported from the Djuvanäs farm-portal calendar.
 */

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface GridDay {
  iso: string
  dayOfMonth: number
  inMonth: boolean
  isToday: boolean
}

/** Index Monday=0 … Sunday=6 for a Date (JS has Sunday=0). */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

export function monthGrid(year: number, monthIndex: number, todayIso?: string): GridDay[] {
  const firstOfMonth = new Date(year, monthIndex, 1)
  const start = new Date(year, monthIndex, 1 - mondayIndex(firstOfMonth))
  const today = todayIso ?? toIsoDate(new Date())

  const days: GridDay[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const iso = toIsoDate(date)
    days.push({
      iso,
      dayOfMonth: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      isToday: iso === today,
    })
  }
  return days
}

/** Does the day fall within [startIso, endIso] (both ends inclusive)? */
export function isWithin(dayIso: string, startIso: string, endIso: string): boolean {
  return dayIso >= startIso && dayIso <= endIso
}

/** Where a scheduled window sits relative to today — drives calendar colours. */
export type ScheduleStatus = 'upcoming' | 'ongoing' | 'finished'

export function scheduleStatus(startIso: string, endIso: string, todayIso?: string): ScheduleStatus {
  const today = todayIso ?? toIsoDate(new Date())
  if (today < startIso) return 'upcoming'
  if (today > endIso) return 'finished'
  return 'ongoing'
}
