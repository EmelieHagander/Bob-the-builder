import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskStatus, ThemeName } from './types'

export interface VolunteerPreview { linkId: string; projectId: string; projectName: string; hasFood: boolean; expiresAt: string }
export interface VolunteerState {
  projectId: string; linkId: string; hasFood: boolean; expiresAt: string
  project: { name: string; description: string; location: string; theme: ThemeName; startLabel: string; startDate: string | null; endDate: string | null }
  person: { id: string; name: string; allergies: string | null; updatedAt: string }
}
export interface VolunteerTaskSummary { id: string; name: string; area: string; status: TaskStatus; skill: string; hours: string; mine: boolean }
export interface VolunteerTask extends VolunteerTaskSummary {
  projectId: string; instructions: string; updatedAt: string
  steps: { id: string; title: string; instructions: string; required: boolean; isCheckpoint: boolean; completedAt: string | null; revision: number }[]
  images: { id: string; title: string }[]
}
export interface VolunteerEvent { id: string; title: string; day: string; time: string; place: string; food: string; going: boolean }
export interface VolunteerUpdate { id: string; text: string; pinned: boolean; createdAt: string }
export interface VolunteerMeal { id: string; meal: string; time: string; dish: string; notes: string }
export interface VolunteerFeed<T> { projectId: string; items: T[]; nextCursor: string | null }
export interface VolunteerLink { id: string; label: string; expiresAt: string; revokedAt: string | null; createdAt: string; participants: number }
export interface VolunteerLinkState {
  projectId: string; links: VolunteerLink[]
  participants: { id: string; linkId: string; personId: string; name: string; revokedAt: string | null; createdAt: string }[]
}

/** Separate secrets for shared invitation and individual device access. */
export function volunteerSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
}
export const validVolunteerSecret = (value: string) => /^[0-9a-f]{64}$/.test(value)

type MediaRequest = { session: string; taskId: string; mediaId: string }
/** Keep binary responses intact. FunctionsClient.invoke parses image/* as text. */
export function createVolunteerMediaTransport(url: string, anonKey: string, fetcher: typeof fetch = fetch) {
  const endpoint = `${url.replace(/\/$/, '')}/functions/v1/volunteer-media`
  return (body: MediaRequest) => fetcher(endpoint, {
    method: 'POST', cache: 'no-store', credentials: 'omit',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The guest client has no persisted Auth session and never signs a person up.
 * Only the narrowly scoped capability RPCs are available through this adapter. */
export function createVolunteers(manager: SupabaseClient<any, any, any> | null, guest: SupabaseClient<any, any, any> | null, capture: () => () => void, media?: (body: MediaRequest) => Promise<Response>) {
  async function request<T>(name: string, args: Record<string, unknown>, projectId?: string, management = false): Promise<T> {
    const client = management ? manager : guest
    const guard = management ? capture() : () => {}
    if (!client) throw new Error('Volunteer links need the connected app. Demo data cannot create real access.')
    if (management) {
      const auth = await client.auth.getSession()
      guard()
      if (auth.error || !auth.data.session) throw new Error('Sign in to manage volunteer links.')
    }
    const result = await client.rpc(name, args)
    guard()
    if (result.error?.code === 'PGRST202') throw new Error('Volunteer links are not available on this server yet. No change was confirmed.')
    if (result.error) throw new Error(result.error.message)
    if (!result.data || (projectId && result.data.projectId !== projectId)) throw new Error('The project could not be confirmed. Reopen your invitation.')
    return result.data as T
  }
  return {
    list: (projectId: string) => request<VolunteerLinkState>('volunteer_links_state', { p_project: projectId }, projectId, true),
    create: (projectId: string, label: string, secret: string, days: number) => request<{ projectId: string; id: string; label: string; expiresAt: string }>('create_volunteer_link', { p_project: projectId, p_label: label, p_secret: secret, p_days: days }, projectId, true),
    revoke: (projectId: string, linkId: string | null, sessionId: string | null) => request<{ projectId: string; revoked: true }>('revoke_volunteer_access', { p_project: projectId, p_link: linkId, p_session: sessionId }, projectId, true),
    preview: (invite: string) => request<VolunteerPreview>('volunteer_preview', { p_secret: invite }),
    state: (secret: string, projectId: string) => request<VolunteerState>('volunteer_state', { p_secret: secret }, projectId),
    join: (invite: string, secret: string, projectId: string, name: string, allergies: string | null) => request<VolunteerState>('volunteer_join', { p_invite: invite, p_session: secret, p_name: name, p_allergies: allergies }, projectId),
    profile: (secret: string, state: VolunteerState, name: string, allergies: string | null) => request<VolunteerState>('volunteer_profile', { p_secret: secret, p_name: name, p_allergies: allergies, p_expected: state.person.updatedAt }, state.projectId),
    feed: <T>(secret: string, projectId: string, section: 'tasks' | 'events' | 'updates' | 'meals', after: string | null = null) => request<VolunteerFeed<T>>('volunteer_feed', { p_secret: secret, p_section: section, p_after: after, p_limit: 30 }, projectId),
    rsvp: (secret: string, projectId: string, eventId: string, going: boolean) => request<{ projectId: string; eventId: string; going: boolean }>('volunteer_rsvp', { p_secret: secret, p_event: eventId, p_going: going }, projectId),
    task: (secret: string, projectId: string, taskId: string) => request<VolunteerTask>('volunteer_task', { p_secret: secret, p_task: taskId }, projectId),
    taskAction: (secret: string, projectId: string, taskId: string, action: 'claim' | 'release' | 'status' | 'check', data: Record<string, unknown> = {}) => request<VolunteerTask>('volunteer_task_action', { p_secret: secret, p_task: taskId, p_action: action, p_data: data }, projectId),
    async image(secret: string, taskId: string, mediaId: string): Promise<Blob> {
      if (!guest || !media) throw new Error('Images need the connected app.')
      const response = await media({ session: secret, taskId, mediaId })
      const type = response.headers.get('Content-Type')?.split(';')[0].trim()
      if (!response.ok || !type || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new Error('The image could not be loaded. Your access may have changed; refresh the project and try again.')
      const blob = await response.blob()
      if (!blob.size || blob.size > 6291456) throw new Error('The image response was incomplete or too large. Refresh the task and try again.')
      return blob
    },
  }
}
