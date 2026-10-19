import { readFileSync } from 'node:fs'
import { CONSTRUCTION_SAVE_TOOL } from '../supabase/functions/_shared/construction-draft.ts'
import { schemaIssues } from '../supabase/functions/_shared/schema-issues.ts'
import { parseCadAssemblyRequest } from '../supabase/functions/_shared/cad-adapter.ts'
import { compileCadParameters, parseParameterPlan } from '../supabase/functions/_shared/cad-parameters.ts'
import { constructionInstancePolicy } from '../supabase/functions/_shared/construction-instance-policy.ts'

// Offline diagnostics of explicitly supplied native function arguments only.
// No provider reasoning, models, network, RPC, writes or customer content output.
// Input: [{ round: number, args: <save_construction_draft arguments> }].
const index = process.argv.indexOf('--calls')
if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: node --import tsx scripts/audit-bob-construction-trace.ts --calls /path/to/private-calls.json')
const rows = JSON.parse(readFileSync(process.argv[index + 1], 'utf8')) as { round: number; args: Record<string, any> }[]
if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row.round) || !row.args || typeof row.args !== 'object')) throw new Error('invalid_audit_input')
const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))
let previous: Record<string, any> | undefined
const report = rows.map(({ round, args }) => {
  // Actual dispatch injects the owner quote. A dummy is sufficient to check
  // shape here; it is NOT authority, source-read or commit verification.
  const issues = schemaIssues(CONSTRUCTION_SAVE_TOOL.function.parameters, { ...args, request_quote: 'Offline shape validation only' })
  let policyValid = false, parameterPlanValid = false, sourceFreeCompile: boolean | null = null
  try { constructionInstancePolicy(args.recipe, args.instance_policy); policyValid = true } catch { /* counted below */ }
  try {
    const plan = parseParameterPlan(args.parameter_plan)
    parameterPlanValid = true
    if (!plan.frames.length && !plan.nodes.some(node => node.role === 'source')) {
      sourceFreeCompile = false
      compileCadParameters('offline-audit', structuredClone(args.recipe), plan, new Map(), new Map())
      sourceFreeCompile = true
    }
  } catch { /* no source data or error text is printed */ }
  const joints = Array.isArray(args.joints) ? args.joints : []
  const changedTopLevelFields = previous ? [...new Set([...Object.keys(previous), ...Object.keys(args)])]
    .filter(key => !same(previous![key], args[key])).sort() : null
  const result = {
    round, compactArgumentCharacters: JSON.stringify(args).length, schemaIssues: issues,
    recipeParses: !!parseCadAssemblyRequest(args.recipe), policyValid, parameterPlanValid, sourceFreeCompile,
    selfJointCount: joints.filter(j => j?.first?.instance_id && j.first.instance_id === j?.second?.instance_id).length,
    changedTopLevelFields,
  }
  previous = args
  return result
})
console.log(JSON.stringify({ note: 'Shape and source-free compilation only. Not a replay of historical RPC outcomes, current-source checks or successful construction validation.', calls: report }, null, 2))
