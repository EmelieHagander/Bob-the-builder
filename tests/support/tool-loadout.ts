import { seedToolPolicy } from '../../supabase/functions/_shared/project-answer.ts'
import type { ToolPolicyReader } from '../../supabase/functions/_shared/project-tools/session.ts'

/** Explicit initial policy for existing domain/SQL scenarios. This changes only
 * catalog configuration, never dispatch, schema validation, budgets or authority.
 * Default discovery/list/load behavior has its own tool-catalog-runtime suite. */
export function domainToolLoadout(...names: string[]): ToolPolicyReader {
  return async () => {
    const seed = await seedToolPolicy()
    for (const name of names) if (!seed.tools.some(row => row.name === name)) throw new Error('Unknown fixture tool: ' + name)
    return { phase: 'design', tools: seed.tools.map(row => ({ ...row, preload_phases: names.includes(row.name) ? ['design'] : [] })) }
  }
}
