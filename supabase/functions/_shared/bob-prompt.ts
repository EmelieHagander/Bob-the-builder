import type { OpenAIServiceOptions } from './openai-service.ts'
import type { AiCatalogSession } from './ai-catalog.ts'

type Shelf = { name: string; group: string; state: 'offered' | 'waiting' | 'budget_exhausted'; waitingFor?: string }

/** Database instructions plus the server-owned toolbox prepared for this call. */
export function buildBobHands(aiCatalog: AiCatalogSession, tools: OpenAIServiceOptions['tools'] = [], shelf: Shelf[] = []): string {
  const offered = tools.map(tool => tool.function.name)
  const text = (key: string) => aiCatalog.text('bob.toolbox.' + key)
  const hands = text(offered.includes('describe_tool') ? 'intro-manual' : 'intro')
  if (!offered.length && !shelf.length) return hands + text('closed')
  const entries: Shelf[] = shelf.length ? shelf : offered.map(name => ({ name, group: 'Tools', state: 'offered' as const }))
  const lines: string[] = []
  for (const group of [...new Set(entries.map(e => e.group))]) {
    const here = entries.filter(e => e.group === group)
    const ready = here.filter(e => e.state === 'offered' && offered.includes(e.name)).map(e => e.name)
    const later = here.filter(e => e.state !== 'offered').map(e => `${e.name} (${e.state === 'budget_exhausted' ? text('used-up') : e.waitingFor ?? text('waiting')})`)
    if (ready.length || later.length) lines.push(`- ${group}: ${[...ready, ...later].join(', ')}`)
  }
  const unshelved = offered.filter(name => !entries.some(e => e.name === name))
  if (unshelved.length) lines.push(`- Other tools: ${unshelved.join(', ')}`)
  if (!offered.length) lines.push(text('none'))
  return `${hands}\n\n${lines.join('\n')}`
}
