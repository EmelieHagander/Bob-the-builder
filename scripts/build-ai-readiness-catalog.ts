/** Publication builder only. Runtime reads immutable database versions.
 * Tool schemas come from their executable declarations; applied seeds stay intact. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { EXPERT_TOOLS } from '../supabase/functions/_shared/project-expert-tools.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import { CONSTRUCTION_SAVE_TOOL } from '../supabase/functions/_shared/construction-draft.ts'

const migrationRoot = 'supabase/migrations'
const baseline = JSON.parse(readFileSync(path.join(migrationRoot, '20261009150000_seed_bob_ai_catalog.sql'), 'utf8').match(/\$ai_catalog_seed\$([\s\S]+?)\$ai_catalog_seed\$/)![1]) as any[]
const policy = JSON.parse(readFileSync('supabase/functions/_shared/project-tools/catalog-seed.json', 'utf8')) as any[]
const changed = new Map<string, any>()
const row = (key: string) => structuredClone(baseline.find(item => item.key === key) ?? (() => { throw new Error('Missing catalog key ' + key) })())
function publish(item: any) {
  item.metadata = { ...item.metadata, label: item.label, publication: 'expert-advice-and-purpose-specific-readiness', source_revision: undefined, seed_version: undefined }
  changed.set(item.key, item)
}
function text(key: string, content: string) { const item = row(key); item.content = content; publish(item) }

text('bob.persona', row('bob.persona').content.split('\n\n')[0] + '\n\n' +
  'Du driver uppdraget. Ditt byggkunnande hjälper beställaren förstå betydelsefulla val. Du utreder, rekommenderar och väljer inom ditt mandat, utifrån tidigare beslut. Beställaren bidrar med prioriteringar och avvägningar. Du hämtar kollegor och verktyg, håller osäkerheten synlig och ger korta besked som hjälper bygget framåt.')
text('cad-research.contract', row('cad-research.contract').content.replace(
  'Reversible design choices may be nonblocking assumptions for Bob/designer.',
  'Ordinary reversible details may be nonblocking assumptions. Significant unresolved choices that control construction geometry need Bob’s expert investigation, alternatives and recommendation before a supported selection. Explicit delegation permits Bob to choose; it is not itself a chosen direction. Reuse canonical prior decisions. A new significant choice missing from the canonical intent blocks developing dependent construction geometry and returns an advice need to Bob. A limited exploratory form sketch may retain an issue only through an explicit purpose-bound canonical deferral for its exact choice ID. Unknown physical checks may remain honest concept limitations when they do not prevent the requested geometry.'))
text('cad-research.readiness-rules',
  'Assess input readiness for this deliverable’s stated purpose against the pinned selected Solution, original references and every required feature. Identify significant missing decisions and technical dependencies even when Bob omitted them from the handoff; return new controlling choices to Bob for advice and a canonical selection before developed construction. Construction geometry needs supported, settled controlling choices; a missing or assumed owner_decision cannot be waived merely by setting blocking=false. Ordinary reversible details remain autonomous. Explicitly deferred issues may remain open only when their exact canonical choice ID is deferred for this limited output and its geometry does not depend on them. Delegation is a mandate, not a settled design. Reuse prior choices; return advice/research needs to Bob rather than asking the owner to guess technical correctness. The absent drawing is not an input prerequisite. Preserve unavailable evidence as a retrieval need, not a measurement request. For explicit requirements cite requirement:<id>; dataset labels are not source IDs. Known checks are nonblocking with action none. Blocking checks name an actionable next step. Report every requirement once through the structured tool.')
text('cad-designer.contract', row('cad-designer.contract').content + '\n\n' +
  'The canonical design_intent in this task is pinned to one selected Solution revision and its deliverable purpose. Preserve every required feature and the roles of its original reference images, including in the first simplified layout. Resolve geometry-dependent choices from the documented supported selections; delegation alone or a default numeric value cannot settle an open choice. An explicitly deferred issue is permissible only outside this output’s purpose and geometry dependencies. Report contradictions or newly discovered controlling gaps to Bob for advice instead of silently selecting a different project.')
text('cad-designer.first-layout',
  'First deliverable: a compact layout of the whole requested construction within the pinned Solution’s purpose, with main dimensions, orientation and every required functional feature. Reuse simple definitions and repeated instances. Defer optional detail only when the explicit limited scope permits it; a required function is not decoration. Supported controlling choices precede dependent geometry. At most one additional batch of indispensable source reads is available before rendering. Report unavailable essential sources or contradictions with the canonical intent as blockers, keeping the same request.')
text('cad-reviewer.contract', row('cad-reviewer.contract').content + '\n\n' +
  'Review the same pinned selected Solution revision, purpose, canonical design_intent and original references that the designer received. Cover every required feature ID as well as the handoff requirements; a simplified first layout does not waive required functions. Check that documented controlling selections actually support the geometry and that explicit deferrals remain outside the output’s purpose. Flag missing expert advice, an unresolved geometry-dependent choice, a reference-role mismatch or an omitted required feature concretely. Canonical intent records choices, not measured truth or structural certification.')

// Checking an applied publication must retain its historical CAD schema after
// a later append-only handoff publication supersedes it. That newer executable
// contract is independently checked by build-ai-handoff-catalog.ts.
let cadTool=DESIGN_CAD_TOOL
if(process.argv.includes('--check')&&readdirSync(migrationRoot).some(name=>name.endsWith('_cad_handoff_server_ids.sql'))){
  const historical=readFileSync(path.join(migrationRoot,'20261009214611_ai_design_readiness_catalog.sql'),'utf8')
  const definition=JSON.parse(historical.match(/\$ai_catalog_patch\$([\s\S]+?)\$ai_catalog_patch\$/)![1]).find((row:any)=>row.key==='tools.design_project_cad').definition
  cadTool={...DESIGN_CAD_TOOL,function:{...DESIGN_CAD_TOOL.function,description:definition.description,parameters:definition.parameters}}
}
const executable = [EXPERT_TOOLS.find(tool => tool.function.name === 'save_project_solution')!, cadTool, CONSTRUCTION_SAVE_TOOL]
for (const tool of executable) {
  const item = row('tools.' + tool.function.name)
  const entry = policy.find(value => value.name === tool.function.name)
  if (!entry) throw new Error('Missing policy for ' + tool.function.name)
  const required = tool.function.parameters.required as string[]
  item.definition = { ...item.definition, ...tool.function,
    additional_description: entry.how_to,
    required_parameters: required,
    optional_parameters: Object.keys(tool.function.parameters.properties).filter(key => !required.includes(key)),
    envelope: { ...item.definition.envelope, schema_version: entry.schema_version },
  }
  item.label = entry.description
  item.metadata.migrated_from = tool.function.name === 'save_project_solution' ? 'supabase/functions/_shared/project-expert-tools.ts' : tool.function.name === 'design_project_cad' ? 'supabase/functions/_shared/cad-assistant.ts' : 'supabase/functions/_shared/construction-draft.ts'
  publish(item)
}
const tools = row('bob.tools')
tools.definition.catalog = policy
publish(tools)

const records = [...changed.values()].sort((a, b) => a.key.localeCompare(b.key))
const json = JSON.stringify(records, null, 2)
const changedPolicies = policy.filter(item => executable.some(tool => tool.function.name === item.name))
const sql = `-- Generated by scripts/build-ai-readiness-catalog.ts from executable schemas.
-- Append and atomically activate versions; saved manifests and the applied seed stay intact.
begin;
do $readiness_catalog$
declare item jsonb; prompt_uuid uuid; version_uuid uuid; next_version integer;
  activation jsonb := '{}'; existing_kind text;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  for item in select value from jsonb_array_elements($ai_catalog_patch$${json}$ai_catalog_patch$::jsonb) loop
    select id,definition_kind into prompt_uuid,existing_kind from shared.ai_prompts
      where app='bob' and prompt_key=item->>'key' for update;
    if prompt_uuid is null or existing_kind<>item->>'kind' then
      raise exception 'readiness_catalog_definition_mismatch: %',item->>'key';
    end if;
    select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prompt_uuid;
    insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,
      metadata,content,definition,flow,available_variables)
    values(prompt_uuid,next_version,item->>'kind',1,item->'metadata',item->>'content',item->'definition','',item->'variables')
    returning id into version_uuid;
    activation := activation || jsonb_build_object(item->>'key',version_uuid::text);
  end loop;
  for item in select value from jsonb_array_elements($tool_policy_patch$${JSON.stringify(changedPolicies, null, 2)}$tool_policy_patch$::jsonb) loop
    update bob.tool_catalog set description=item->>'description',how_to=item->>'how_to',
      schema_version=(item->>'schema_version')::integer where name=item->>'name';
    if not found then raise exception 'readiness_catalog_tool_missing: %',item->>'name'; end if;
  end loop;
  perform shared.activate_ai_catalog('bob',activation);
end $readiness_catalog$;
commit;
`
const outputArg = process.argv.indexOf('--output')
const output = outputArg >= 0 ? process.argv[outputArg + 1] : readdirSync(migrationRoot).filter(name => name.endsWith('_ai_design_readiness_catalog.sql')).sort().at(-1)
const target = output?.includes('/') ? output : output ? path.join(migrationRoot, output) : undefined
if (process.argv.includes('--json')) process.stdout.write(json + '\n')
else if (process.argv.includes('--check')) {
  if (!target || readFileSync(target, 'utf8') !== sql) throw new Error('Readiness catalog differs from executable declarations; rebuild its publication.')
  console.log('Verified readiness catalog: ' + records.length + ' immutable definition revisions.')
} else if (target) { writeFileSync(target, sql); console.log('Wrote ' + target + ': ' + records.length + ' revisions.') }
else throw new Error('Provide the migration path created by Supabase CLI with --output.')
