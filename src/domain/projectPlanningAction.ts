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
      && target.revision === artifact.targetRevision))
}

export function nextProjectPlanningAction(snapshot: ProjectPlanningSnapshot, areaNames: Map<string, string>): PlanningAction {
  const outstanding = snapshot.missing.filter(item => item.required)
  if (outstanding.length) {
    const first = outstanding[0]
    return {
      to: '/facts?kind=measurement&status=missing',
      icon: 'ruler', eyebrow: 'Nästa steg',
      title: outstanding.length + (outstanding.length === 1 ? ' mått behöver kontrolleras' : ' mått behöver kontrolleras'),
      text: 'Börja med ' + first.subject + (first.areaId ? ' i ' + (areaNames.get(first.areaId) ?? 'området') : '')
        + '. Andra uppgifter som redan är registrerade behöver inte mätas om.',
    }
  }

  const currentConstruction = snapshot.constructions[0]
  if (currentConstruction) {
    const area = currentConstruction.areaId ? areaNames.get(currentConstruction.areaId) : null
    const to = '/build-lists' + queryArea(currentConstruction.areaId)
      + (currentConstruction.areaId ? '&' : '?') + 'construction=' + encodeURIComponent(currentConstruction.id)
    return {
      to, icon: 'package', eyebrow: 'Nästa steg',
      title: 'Granska kaplista och inköpsunderlag',
      text: 'Konstruktion v' + currentConstruction.revision + (area ? ' för ' + area : '')
        + ' är sparad. Se preliminära tillverkningsdelar och vad Bob behöver färdigställa före kapning och beställning.',
    }
  }

  const scope = snapshot.targets[0]
  if (!scope) return {
    to: '/solutions', icon: 'path', eyebrow: 'Nästa steg',
    title: 'Välj konstruktionsmål',
    text: 'Inget beslutat mål hittades för projektet eller dess områden. Välj riktning innan tillverkningsunderlag skapas.',
  }
  if (!hasCurrentScopeDrawing(snapshot)) return {
    to: '/artifacts' + queryArea(scope.areaId), icon: 'blueprint', eyebrow: 'Nästa steg',
    title: 'Ta fram en aktuell ritning',
    text: (scope.areaId ? (areaNames.get(scope.areaId) ?? 'Området') : 'Projektet')
      + ' har ett sparat konstruktionsmål. Granska ritningens källversion innan du går vidare.',
  }
  return {
    to: '/areas', icon: 'check-circle', eyebrow: 'Nästa steg',
    title: 'Ordna byggmomenten',
    text: 'Ett mål och ett aktuellt ritningsunderlag finns registrerade. Planera beroenden och uppgifter innan byggstart.',
  }
}
