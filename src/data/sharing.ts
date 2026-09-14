import type { SupabaseClient } from '@supabase/supabase-js'

export interface SharingChoice { id: string; name: string }
export interface SharingDirectory {
  households: SharingChoice[]
  friends: SharingChoice[]
}
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked'
export interface ProjectFriendInvitation {
  id: string
  inviteeId: string
  name: string
  status: InvitationStatus
}
export interface IncomingProjectInvitation {
  id: string
  projectId: string
  projectName: string
  inviterName: string
  status: InvitationStatus
}
export interface SharedBuildingChoice extends SharingChoice {
  householdId: string | null
  householdName: string | null
}
export interface ProjectSharingState {
  projectId: string
  householdId: string | null
  buildingId: string | null
  revision: number
  canManage: boolean
  buildings: SharedBuildingChoice[]
  invitations: ProjectFriendInvitation[]
}
export interface BuildingSharingState {
  buildingId: string
  householdId: string | null
  revision: number
  canManage: boolean
  projects: Array<SharingChoice & {
    buildingId: string | null
    householdId: string | null
    revision: number
  }>
}

/** Bob owns the sharing command boundary; the browser never reads another
 * app's profiles, household tables or friendship graph directly. */
export function createSharing(
  client: SupabaseClient<any, any, any> | null,
  capture: () => () => void,
  changed: () => void,
) {
  async function request<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const guard = capture()
    if (!client) throw new Error('Sharing needs a connected account. Demo data is not shared.')
    const session = await client.auth.getSession()
    guard()
    if (session.error || !session.data.session) throw new Error('Sign in to manage sharing.')
    const result = await client.rpc(name, args)
    guard()
    if (result.error) {
      if (result.error.code === 'PGRST202') {
        throw new Error('Sharing is not available on this server yet. No sharing change was confirmed.')
      }
      throw new Error(result.error.message)
    }
    if (result.data === null) throw new Error('The server did not confirm the sharing result. Reload before trying again.')
    return result.data as T
  }

  async function project(projectId: string) {
    const state = await request<ProjectSharingState>('project_sharing_state', { p_project: projectId })
    if (state.projectId !== projectId) throw new Error('Project sharing context changed. Reopen the project.')
    return state
  }

  async function building(buildingId: string) {
    const state = await request<BuildingSharingState>('building_sharing_state', { p_building: buildingId })
    if (state.buildingId !== buildingId) throw new Error('Building sharing context changed. Reopen the building.')
    return state
  }

  return {
    directory: () => request<SharingDirectory>('sharing_directory'),
    bindAccount: (householdId: string) => request<unknown>('bind_account_household', { p_household: householdId }),
    project,
    building,
    async saveProject(input: { projectId: string; householdId: string | null; buildingId: string | null; expected: number }) {
      const state = await request<ProjectSharingState>('set_project_household', {
        p_project: input.projectId, p_household: input.householdId,
        p_building: input.buildingId, p_expected: input.expected,
      })
      if (state.projectId !== input.projectId) throw new Error('The project sharing result could not be confirmed. Reload before trying again.')
      if (!state.canManage) changed()
      return state
    },
    async saveBuilding(input: { buildingId: string; householdId: string | null; expected: number; projectIds: string[] }) {
      const state = await request<BuildingSharingState>('set_building_household', {
        p_building: input.buildingId, p_household: input.householdId,
        p_expected: input.expected, p_projects: input.projectIds,
      })
      if (state.buildingId !== input.buildingId) throw new Error('The building sharing result could not be confirmed. Reload before trying again.')
      return state
    },
    async inviteFriend(projectId: string, friendId: string) {
      return request<ProjectFriendInvitation>('invite_project_friend', { p_project: projectId, p_friend: friendId })
    },
    invitations: () => request<IncomingProjectInvitation[]>('project_invitations'),
    async respondInvitation(id: string, accept: boolean) {
      const result = await request<{ projectId: string }>('respond_project_invitation', { p_invite: id, p_accept: accept })
      return result
    },
    async revokeInvitation(id: string) {
      const result = await request<{ revoked: boolean }>('revoke_project_invitation', { p_invite: id })
      return result
    },
  }
}
