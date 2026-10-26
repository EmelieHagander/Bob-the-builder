import type { ConstructionHead, ProjectTargetScope } from '../data/buildPreparation'

export interface PlanningMeasurement {
  subject: string
  areaId: string | null
  required: boolean
}
export interface PlanningArtifact {
  id: string
  areaId: string | null
  targetRevision: number
  solutionId: string
  solutionRevision: number
  archived: boolean
  sourceStatus?: { source_state: string }
}
export interface ProjectPlanningSnapshot {
  missing: PlanningMeasurement[]
  targets: ProjectTargetScope[]
  constructions: ConstructionHead[]
  artifacts: PlanningArtifact[]
}
export interface PlanningAction {
  to: string
  icon: string
  title: string
  text: string
  eyebrow: string
}

const queryArea = (areaId: string | null) => areaId ? '?area=' + encodeURIComponent(areaId) : ''

/** A target and its drawings belong to the same Project-or-Area scope.
 * A construction draft itself must never masquerade as a rendered drawing. */
export function hasCurrentScopeDrawing(snapshot: ProjectPlanningSnapshot): boolean {
  const drafts = new Set(snapshot.constructions.map(item => item.id))
  return snapshot.artifacts.some(artifact => !artifact.archived && !drafts.has(artifact.id)
    && artifact.sourceStatus?.source_state === 'current'
    && snapshot.targets.some(target => target.areaId === artifact.areaId
      && target.revision === artifact.targetRevision
      && target.solutionId === artifact.solutionId
      && target.solutionRevision === artifact.solutionRevision))
}

export function nextProjectPlanningAction(snapshot: ProjectPlanningSnapshot, areaNames: Map<string, string>): PlanningAction {
  const outstanding = snapshot.missing.filter(item => item.required)
  if (outstanding.length) {
    const first = outstanding[0]
    return {
      to: '/facts?kind=measurement&status=missing',
      icon: 'ruler', eyebrow: 'Next step',
      title: 'Check ' + outstanding.length + (outstanding.length === 1 ? ' required measurement' : ' required measurements'),
      text: 'Start with ' + first.subject + (first.areaId ? ' in ' + (areaNames.get(first.areaId) ?? 'its Area') : '')
        + '. Measurements that are already recorded do not need to be taken again.',
    }
  }

  const currentConstruction = snapshot.constructions[0]
  if (currentConstruction) {
    const area = currentConstruction.areaId ? areaNames.get(currentConstruction.areaId) : null
    const to = '/build-lists' + queryArea(currentConstruction.areaId)
      + (currentConstruction.areaId ? '&' : '?') + 'construction=' + encodeURIComponent(currentConstruction.id)
    return {
      to, icon: 'package', eyebrow: 'Next step',
      title: 'Review the cut list and purchasing needs',
      text: 'Construction v' + currentConstruction.revision + (area ? ' for ' + area : '')
        + ' is saved. See the preliminary parts and what Bob still has to finish before cutting and ordering.',
    }
  }

  const scope = snapshot.targets[0]
  if (!scope) return {
    to: '/solutions', icon: 'path', eyebrow: 'Next step',
    title: 'Choose the target',
    text: 'No target is decided for the project or its Areas. Choose the direction before building documents are made.',
  }
  if (!hasCurrentScopeDrawing(snapshot)) return {
    to: '/artifacts' + queryArea(scope.areaId), icon: 'blueprint', eyebrow: 'Next step',
    title: 'Turn the target into a current drawing',
    text: (scope.areaId ? (areaNames.get(scope.areaId) ?? 'The Area') : 'The project')
      + ' has a saved target. Check the drawing\'s source version before moving on.',
  }
  return {
    to: '/areas', icon: 'check-circle', eyebrow: 'Next step',
    title: 'Plan the build steps',
    text: 'A target and a current drawing are recorded. Plan dependencies and tasks before the build starts.',
  }
}
