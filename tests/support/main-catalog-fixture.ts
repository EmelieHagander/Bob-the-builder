/** Domain tests inject the same versioned database seed as the production
 * resolver. There is no runtime prompt or model fallback in this wrapper. */
import { catalogFixture, catalogCall } from './ai-catalog-fixture.ts'
import type { AiCatalogSession } from '../../supabase/functions/_shared/ai-catalog.ts'
import { runProjectAnswer as answer, buildBobSystemMessage as system } from '../../supabase/functions/_shared/project-answer.ts'
import { runClaimedProjectTurn as turn } from '../../supabase/functions/_shared/project-turn.ts'
import { buildBobHands as hands } from '../../supabase/functions/_shared/bob-prompt.ts'
export { seedToolPolicy } from '../../supabase/functions/_shared/project-answer.ts'
export type { ModelCall, ProjectAnswer } from '../../supabase/functions/_shared/project-answer.ts'

export const bobCatalog = catalogFixture()
export const bobPersona = bobCatalog.text('bob.persona')
export const bobContract = bobCatalog.text('bob.contract')
export const bobCurrentTurn = bobCatalog.text('bob.frame.current')

type WithTestCatalog<T> = Omit<T, 'aiCatalog'> & { aiCatalog?: AiCatalogSession }
export function runProjectAnswer(options: WithTestCatalog<Parameters<typeof answer>[0]>) {
  const session = options.aiCatalog ?? catalogFixture()
  return answer({ ...options, aiCatalog: session, callModel: catalogCall(options.callModel, session) })
}
export function runClaimedProjectTurn(options: WithTestCatalog<Parameters<typeof turn>[0]>) {
  const session = options.aiCatalog ?? catalogFixture()
  return turn({ ...options, aiCatalog: session, callModel: catalogCall(options.callModel, session) })
}
export function buildBobSystemMessage(...args: Parameters<typeof system> extends [AiCatalogSession, ...infer T] ? T : never) {
  return system(bobCatalog, ...args)
}
export function buildBobHands(...args: Parameters<typeof hands> extends [AiCatalogSession, ...infer T] ? T : never) {
  return hands(bobCatalog, ...args)
}
