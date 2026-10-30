import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { toolRejection } from './tool-rejection.ts'

/** Owner decision 2026-10-30 ("wrench wench"): Bob's tool list stays fixed and
 * every other tool is called through use_tool. When the server rejects the
 * arguments Bob wrote, a small read-only role gets the tool's real function
 * definition and calls it once with the same values in the right shape. The
 * server then checks that no value was added or changed and runs the tool
 * through the same session gates. Results go back to Bob unchanged. */
export const TOOL_REPAIR_LIMIT = 12

type Leaf = string
/** Every scalar value, as text; a string holding JSON counts as the values inside it. */
function leaves(value: unknown, out: Leaf[] = [], depth = 0): Leaf[] {
  if (depth > 40 || value === null || value === undefined) return out
  if (Array.isArray(value)) { for (const item of value) leaves(item, out, depth + 1); return out }
  if (typeof value === 'object') { for (const item of Object.values(value as Record<string, unknown>)) leaves(item, out, depth + 1); return out }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 1) {
      try { return leaves(JSON.parse(trimmed), out, depth + 1) } catch { /* plain text */ }
    }
    out.push(value); return out
  }
  if (typeof value === 'number' || typeof value === 'boolean') out.push(String(value))
  return out
}

/** The repaired call may move, nest, rename or encode Bob's values and add null
 * or empty lists. Every value it carries must already be in Bob's arguments, as
 * often as it is used: nothing added, guessed, rounded or flipped. */
export function repairPreservesValues(original: unknown, repaired: unknown): boolean {
  const available = new Map<Leaf, number>()
  for (const leaf of leaves(original)) available.set(leaf, (available.get(leaf) ?? 0) + 1)
  for (const leaf of leaves(repaired)) {
    const left = available.get(leaf) ?? 0
    if (!left) return false
    available.set(leaf, left - 1)
  }
  return true
}

/** Bob's values the repaired call does not carry (a field the tool does not
 * have). They are reported back to Bob, never dropped silently. */
export function valuesNotUsed(original: unknown, repaired: unknown): string[] {
  const used = new Map<Leaf, number>()
  for (const leaf of leaves(repaired)) used.set(leaf, (used.get(leaf) ?? 0) + 1)
  const missing: string[] = []
  for (const leaf of leaves(original)) {
    const left = used.get(leaf) ?? 0
    if (left) used.set(leaf, left - 1); else missing.push(leaf.length > 120 ? leaf.slice(0, 119) + '…' : leaf)
  }
  return missing.slice(0, 20)
}

export async function repairToolArguments(opts: {
  callModel: (options: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<string>>
  userId: string; tool: NonNullable<OpenAIServiceOptions['tools']>[number]; args: unknown; result: unknown
  catalogSchemaParameters: Record<string, unknown>; catalogToolParameters?: Record<string, unknown>; timeoutMs: number
}): Promise<{ status: 'repaired'; args: Record<string, unknown>; notUsed: string[] } | { status: 'unchanged' | 'changed_values' | 'unavailable' }> {
  const name = opts.tool.function.name
  const rejection = toolRejection(opts.result) ?? { code: 'invalid', fields: [] }
  const issues = Array.isArray((opts.result as { issues?: unknown })?.issues) ? (opts.result as { issues: unknown[] }).issues.slice(0, 20) : undefined
  const response = await opts.callModel({
    app: 'bob', coworkerId: 'bob', functionName: 'tool-repair', aiFunction: 'tool-repair', module: 'global', userId: opts.userId,
    catalogRoleKey: 'tool-repair', tools: [opts.tool], tool_choice: { type: 'function', function: { name } },
    catalogSchemaParameters: opts.catalogSchemaParameters,
    ...(opts.catalogToolParameters ? { catalogToolParameters: { [name]: opts.catalogToolParameters } } : {}),
    messages: [{ role: 'user', content: JSON.stringify({ tool: name, bob_arguments: opts.args ?? null, rejection, ...(issues ? { issues } : {}) }) }],
    maxOutputTokens: 6000, timeoutMs: opts.timeoutMs,
  })
  if (!response.success) {
    if (response.error === 'turn_budget_exhausted') throw new Error('turn_budget_exhausted')
    return { status: 'unavailable' }
  }
  const call = response.toolCalls?.find(item => item.function.name === name)
  let args: unknown
  try { args = call ? JSON.parse(call.function.arguments) : undefined } catch { args = undefined }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { status: 'unavailable' }
  if (JSON.stringify(args) === JSON.stringify(opts.args)) return { status: 'unchanged' }
  if (!repairPreservesValues(opts.args, args)) return { status: 'changed_values' }
  return { status: 'repaired', args: args as Record<string, unknown>, notUsed: valuesNotUsed(opts.args, args) }
}
