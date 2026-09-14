import { validVolunteerSecret } from '../data/volunteers'

const key = (invite: string) => 'bob:volunteer:' + invite
export interface SavedVolunteer { secret: string; joined: boolean }
export function readVolunteerSession(invite: string): SavedVolunteer | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(invite)) ?? 'null')
    return value && validVolunteerSecret(value.secret) && typeof value.joined === 'boolean' ? value : null
  } catch { return null }
}
/** Save only a random capability, never the person's name or health information. */
export function saveVolunteerSession(invite: string, value: SavedVolunteer): boolean {
  if (!validVolunteerSecret(invite) || !validVolunteerSecret(value.secret)) return false
  try { localStorage.setItem(key(invite), JSON.stringify({ secret: value.secret, joined: value.joined })); return true } catch { return false }
}
export function forgetVolunteerSession(invite: string) {
  try { localStorage.removeItem(key(invite)) } catch { /* memory is cleared by the caller too */ }
}
