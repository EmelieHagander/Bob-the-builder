import type { Area, ProjectPhase } from '../data/types'

export const PROJECT_PHASES: ProjectPhase[] = ['concept', 'design', 'planning', 'build', 'complete']

export const PHASE_META: Record<ProjectPhase, { label: string; short: string; icon: string; purpose: string }> = {
  concept: { label: 'Concept', short: 'Concept', icon: 'lightbulb', purpose: 'Define what should change, where and why.' },
  design: { label: 'Design', short: 'Design', icon: 'pencil-ruler', purpose: 'Understand the existing state and choose the solution.' },
  planning: { label: 'Planning', short: 'Planning', icon: 'blueprint', purpose: 'Turn the selected solution into buildable work.' },
  build: { label: 'Build', short: 'Build', icon: 'hammer', purpose: 'Execute the work against reality.' },
  complete: { label: 'Complete', short: 'Complete', icon: 'check-circle', purpose: 'Close against what was actually built.' },
}

export function phaseLabel(phase: ProjectPhase | null | undefined) {
  return phase ? PHASE_META[phase].label : 'Not classified'
}

export function areaPhaseSummary(areas: Pick<Area, 'phase'>[]) {
  const counts = new Map<ProjectPhase, number>()
  let unclassified = 0
  for (const area of areas) {
    if (!area.phase) unclassified += 1
    else counts.set(area.phase, (counts.get(area.phase) ?? 0) + 1)
  }
  const parts = PROJECT_PHASES.flatMap(phase => {
    const count = counts.get(phase) ?? 0
    return count ? [`${count} ${PHASE_META[phase].label}`] : []
  })
  if (unclassified) parts.push(`${unclassified} not classified`)
  return parts.join(' · ') || 'No Areas yet'
}

export type PhaseAction = { title: string; text: string; to: string; icon: string }

export function areaNextAction(area: Pick<Area, 'id' | 'slug' | 'phase'>): PhaseAction {
  switch (area.phase) {
    case 'concept':
      return { title: 'Capture the current state', text: 'Clarify this Area and collect the evidence that matters.', to: `/areas/${area.slug}?tab=images`, icon: 'camera' }
    case 'design':
      return { title: 'Check evidence and choose a target', text: 'Resolve important unknowns before committing to one solution.', to: `/facts?area=${encodeURIComponent(area.id)}`, icon: 'ruler' }
    case 'planning':
      return { title: 'Turn the target into buildable work', text: 'Review drawings, material need and task readiness.', to: `/artifacts?area=${encodeURIComponent(area.id)}`, icon: 'blueprint' }
    case 'build':
      return { title: 'Continue the next ready task', text: 'Focus on executable work, blockers and what the crew needs now.', to: `/areas/${area.slug}`, icon: 'hammer' }
    case 'complete':
      return { title: 'Review final evidence', text: 'Keep the as-built outcome and remaining follow-up clear.', to: `/areas/${area.slug}?tab=images`, icon: 'check-circle' }
    default:
      return { title: 'Set the Area phase', text: 'Classify this Area before Bob starts prioritising phase-specific actions.', to: `/areas/${area.slug}`, icon: 'signpost' }
  }
}

export function projectFocus(phase: ProjectPhase | null | undefined, areas: Pick<Area, 'phase'>[]): { title: string; text: string; icon: string } {
  const mix = areas.length ? areaPhaseSummary(areas) : 'Use the Plan to organise Steps directly in the Project; Areas are optional'
  switch (phase) {
    case 'concept': return { title: 'Make the project understandable', text: `Describe the intended work and current state. ${mix}.`, icon: 'lightbulb' }
    case 'design': return { title: 'Converge on the right solution', text: `Keep evidence and decisions explicit. ${mix}.`, icon: 'pencil-ruler' }
    case 'planning': return { title: 'Make the selected work buildable', text: `Drawings, materials and readiness should now become executable. ${mix}.`, icon: 'blueprint' }
    case 'build': return { title: 'Keep building while other work takes shape', text: `${mix}. Each Step keeps its own next action.`, icon: 'hammer' }
    case 'complete': return { title: 'Close against reality', text: 'Confirm as-built evidence and leave the Building better known for next time.', icon: 'check-circle' }
    default: return { title: 'Set the Project phase', text: 'Existing projects stay unclassified until a person chooses where the project really is.', icon: 'signpost' }
  }
}
