import type { OpenAIServiceOptions } from './openai-service.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import { countContextTokens } from './bob-token-budget.ts'
import type { WorkflowCard } from './project-tools/session.ts'

type Shelf = { name: string; group: string; state: 'offered' | 'waiting' | 'budget_exhausted'; waitingFor?: string; description?: string; instructionLoaded?: boolean }

/** A directory entry describes an implemented delegation path, never a new tool. */
export function bobColleagues(aiCatalog: AiCatalogSession, visibleTools: string[]) {
  const directory = aiCatalog.definition('bob.colleagues', 'agent_contract').definition
  const entries = directory.colleagues as { role_key: string; invocation_tools: string[]; instructions: string }[]
  return entries.flatMap(entry => {
    const tools = entry.invocation_tools.filter(name => visibleTools.includes(name))
    if (!tools.length) return []
    const role = aiCatalog.definition(entry.role_key, 'role').definition
    if (role.enabled === false) return []
    if (countContextTokens(`${role.name} ${role.title} ${role.purpose}`) > 80) throw new Error('colleague_card_too_large')
    return [{ name: String(role.name), title: String(role.title), purpose: String(role.purpose), invocation_tools: tools, instructions: entry.instructions }]
  })
}

/** Catalog workflows: a method per kind of delegated outcome and the tools it
 * uses. Absent from older pinned manifests, which keep the plain directory. */
export function bobWorkflows(aiCatalog: AiCatalogSession): WorkflowCard[] {
  const defs = aiCatalog.manifest().definitions
  if (!defs.some(row => row.prompt_key === 'bob.workflows' && row.definition_kind === 'agent_contract')) return []
  const entries = aiCatalog.definition('bob.workflows', 'agent_contract').definition.workflows as WorkflowCard[]
  return entries.map(entry => {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(entry.name) || defs.some(row => row.prompt_key === 'tools.' + entry.name)) throw new Error('workflow_name_invalid')
    if (countContextTokens(entry.card) > 80) throw new Error('workflow_card_too_large')
    return { name: entry.name, card: String(entry.card), method: String(entry.method), tools: entry.tools.map(String) }
  })
}

/** Database instructions plus the server-owned toolbox prepared for this call. */
export function buildBobHands(aiCatalog: AiCatalogSession, tools: OpenAIServiceOptions['tools'] = [], shelf: Shelf[] = []): string {
  const offered = tools.map(tool => tool.function.name)
  const text = (key: string) => aiCatalog.text('bob.toolbox.' + key)
  const lazy = shelf.some(entry => entry.instructionLoaded !== undefined)
  if (lazy) {
    const colleagues = bobColleagues(aiCatalog, shelf.map(entry => entry.name))
    const lines = [text('intro-lazy')]
    const workflows = bobWorkflows(aiCatalog).filter(w => w.tools.some(name => shelf.some(entry => entry.name === name)))
    if (workflows.length) lines.push(aiCatalog.text('bob.workflows'), ...workflows.map(w => `- ${w.name}: ${w.card}`))
    if (colleagues.length) lines.push(aiCatalog.text('bob.colleagues.intro'), ...colleagues.map(c => `- ${c.name} — ${c.title}: ${c.purpose} (${c.invocation_tools.join(', ')})`))
    for (const group of [...new Set(shelf.map(entry => entry.group))]) {
      lines.push(group)
      for (const entry of shelf.filter(entry => entry.group === group)) {
        const state = entry.state === 'offered' ? (offered.includes(entry.name) ? 'callable' : 'describe_tool')
          : entry.state === 'budget_exhausted' ? text('used-up') : entry.waitingFor ?? text('waiting')
        lines.push(`- ${entry.name}: ${entry.description ?? ''} [${state}]`)
      }
    }
    return lines.join('\n')
  }
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
