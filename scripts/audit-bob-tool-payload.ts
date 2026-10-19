import { readFileSync } from 'node:fs'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { countContextTokens, countSerializedTokens } from '../supabase/functions/_shared/bob-token-budget.ts'

// Explicit local input only. This audit never calls a model, project RPC or
// network service, and prints sizes/names rather than source prompt content.
const index = process.argv.indexOf('--manifest')
if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: node --import tsx scripts/audit-bob-tool-payload.ts --manifest /path/to/pinned-manifest.json')
const manifest: unknown = JSON.parse(readFileSync(process.argv[index + 1], 'utf8'))
const catalog = createAiCatalogSession({ rpc: async () => { throw new Error('audit_network_forbidden') } }, { app: 'bob', manifest, unlimitedWork: true })
const workflow = (catalog.definition('bob.workflows').definition.workflows as { name: string; method: string; tools: string[] }[])
  .find(row => row.name === 'workflow_construction_drawing')
if (!workflow) throw new Error('audit_workflow_missing')
const individuallyDescribed = ['search_project_data', 'search_conversation_history', 'read_project_edit_context', 'edit_project_record',
  'read_solution_context', 'read_construction_draft', 'save_construction_draft', 'check_construction_draft']
const names = [...new Set([...workflow.tools, ...individuallyDescribed])]
const full = (name: string) => catalog.tool(name, { server_quote: true, include_manual: true })
const cardSchema = (name: string) => catalog.tool(name, { server_quote: true, card: true })
const rows = names.map(name => {
  const expanded = full(name), base = catalog.tool(name, { server_quote: true })
  return { name, workflowMember: workflow.tools.includes(name), fullTokens: countSerializedTokens(expanded),
    cardAndSchemaTokens: countSerializedTokens(cardSchema(name)), parametersTokens: countSerializedTokens(expanded.function.parameters),
    descriptionTokens: countContextTokens(base.function.description),
    manualTextTokens: countContextTokens(expanded.function.description) - countContextTokens(base.function.description) }
}).sort((a, b) => b.fullTokens - a.fullTokens)
const bodies = individuallyDescribed.map(name => ({ name, manual: full(name).function.description, parameters: full(name).function.parameters }))
const totals = (selected: string[]) => ({ tools: selected.length, fullTokens: countSerializedTokens(selected.map(full)),
  cardAndSchemaTokens: countSerializedTokens(selected.map(cardSchema)),
  parametersTokens: countSerializedTokens(selected.map(name => full(name).function.parameters)) })
console.log(JSON.stringify({ manifestId: catalog.manifest().manifest_id,
  note: 'Pinned catalog size estimates, not observed provider input or billing. Workflow totals assume every member is available; runtime gates can reduce the set. Default schema bindings omit per-request category/evidence enums. Describe bodies count the manual/schema fields only, not whole real tool responses.',
  memorySummaryLimit: catalog.definition('agent-contract.ask-bob').metadata.context_token_limits,
  workflow: { name: workflow.name, methodTokens: countContextTokens(workflow.method), ...totals(workflow.tools) },
  loadedUnion: totals(names), explicitlyRequestedOnly: totals(individuallyDescribed),
  describedManualAndSchemaFieldsTokens: countSerializedTokens(bodies),
  rows,
}, null, 2))
