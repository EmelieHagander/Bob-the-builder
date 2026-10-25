/*
 * Pure rules for reading a Project's physical scope rows. The backend command
 * owns authority; these helpers only decide what the UI can honestly show.
 */
import type { AreaPhysicalTarget, PhysicalBuilding, ProjectPhysicalScope } from '../data/buildingContext'

/** Rows that make the Project target this whole Building: its own link, or its Site's. */
export function wholeBuildingLinks(scopes: ProjectPhysicalScope[], building: Pick<PhysicalBuilding, 'id' | 'siteId'>): ProjectPhysicalScope[] {
  return scopes.filter(scope => (scope.targetKind === 'building' && scope.buildingId === building.id)
    || (scope.targetKind === 'site' && !!building.siteId && scope.siteId === building.siteId))
}

/** This Project's room marks inside one Building, keyed by room id. */
export function projectRoomMarks(scopes: ProjectPhysicalScope[], buildingId: string): Map<string, ProjectPhysicalScope> {
  return new Map(scopes
    .filter(scope => scope.targetKind === 'space' && scope.buildingId === buildingId && scope.spaceId)
    .map(scope => [scope.spaceId as string, scope]))
}

/** Room mappings for one Area. Other target kinds are not room mappings. */
export function areaRoomTargets(targets: AreaPhysicalTarget[], areaId: string): AreaPhysicalTarget[] {
  return targets.filter(target => target.areaId === areaId && target.targetKind === 'space' && target.spaceId)
}

export interface UnlinkResult { removedRooms: number; removedAreaTargets: number }

export function unlinkResult(row: unknown): UnlinkResult {
  const value = (row ?? {}) as Record<string, unknown>
  const count = (key: string) => typeof value[key] === 'number' ? value[key] as number : 0
  return { removedRooms: count('removed_rooms'), removedAreaTargets: count('removed_area_targets') }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function unlinkSummary(name: string, result: UnlinkResult): string {
  const removed = [
    result.removedRooms ? plural(result.removedRooms, 'room mark', 'room marks') : '',
    result.removedAreaTargets ? plural(result.removedAreaTargets, 'Area room', 'Area rooms') : '',
  ].filter(Boolean)
  return `${name} is no longer used by this project.${removed.length ? ` Removed ${removed.join(' and ')}.` : ''}`
}

/** Plain copy for the guarded scope command's error codes. */
export function scopeErrorMessage(error: unknown, action: 'building' | 'room'): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/\bbuilding_not_linked\b/.test(text)) return 'Link the whole building to this project first.'
  if (/\b(space|element)_not_in_building\b/.test(text)) return 'This room is no longer part of that building. Reload and try again.'
  if (/\bbuilding_denied\b/.test(text)) return action === 'building'
    ? 'Only someone who can edit this building can link it to a project.'
    : 'This room is no longer part of that building. Reload and try again.'
  if (/\bsite_denied\b/.test(text)) return 'You can’t use that site in this project.'
  if (/\bproject_denied\b/.test(text)) return 'You no longer have access to this project.'
  return text
}
