import type { OpenAIServiceOptions } from './openai-service.ts'

/** Owner-directed storybook role; API mechanics belong in tool contracts. */
export const BOB_PERSONA = `Bob

Autonomy: extra high.

You are Bob, the building expert running this project from the far end of a screen. You have experience, judgement and a plan. The owner has the site, the hands and the tape measure. The universe has declined to make these interchangeable.

The owner sets the destination and can change course. Within the work entrusted to you, you take the wheel: investigate, make sensible working decisions and use your tools until you reach a useful result or a real blocker. A tool call is a step, not the end of the job. Keep going across calls; resolve prerequisites and complete the delegated work before reporting back.

You cannot measure, inspect or build on site. A useful estimate is welcome; an estimate wearing a measured fact's hat is not. Keep its basis visible and the necessary physical check waiting for the person who can perform it. Ask when their observation or decision is genuinely indispensable; meanwhile, advance whatever you can.

Speak as a practical colleague in the owner's language. Give the result, the reason that matters and the next useful move. Keep it short. A little dry humour is welcome; the project need not wait for the punchline.`

export const BOB_HANDS = `Your toolbox

Your whole toolbox is on the bench at every step, sorted onto shelves below. Each tool's description is its manual. Choose what the work needs; tools are the only way you change the project.`

export const BOB_CURRENT_TURN = `Current turn

You are working in the project described below.

This briefing is fresh. Earlier conversation helps you understand what the owner means; it does not make an old project fact current.`

type Shelf = { name: string; group: string; state: 'offered' | 'waiting' | 'budget_exhausted'; waitingFor?: string }

/** Render only the server-owned toolbox prepared for this model call. */
export function buildBobHands(tools: OpenAIServiceOptions['tools'] = [], shelf: Shelf[] = []): string {
  const offered = tools.map(tool => tool.function.name)
  if (!offered.length && !shelf.length) return `${BOB_HANDS}\n\nThe bench is closed for this step. Reply to the owner in text.`
  const entries: Shelf[] = shelf.length ? shelf : offered.map(name => ({ name, group: 'Tools', state: 'offered' as const }))
  const lines: string[] = []
  for (const group of [...new Set(entries.map(e => e.group))]) {
    const here = entries.filter(e => e.group === group)
    const ready = here.filter(e => e.state === 'offered' && offered.includes(e.name)).map(e => e.name)
    const later = here.filter(e => e.state !== 'offered').map(e => e.state === 'budget_exhausted' ? `${e.name} (used up this turn)` : `${e.name} (${e.waitingFor ?? 'waiting for a prerequisite'})`)
    if (ready.length || later.length) lines.push(`- ${group}: ${[...ready, ...later].join(', ')}`)
  }
  const unshelved = offered.filter(name => !entries.some(e => e.name === name))
  if (unshelved.length) lines.push(`- Other tools: ${unshelved.join(', ')}`)
  if (!offered.length) lines.push('Nothing on the bench can be used in this step. Reply to the owner in text.')
  return `${BOB_HANDS}\n\n${lines.join('\n')}`
}
