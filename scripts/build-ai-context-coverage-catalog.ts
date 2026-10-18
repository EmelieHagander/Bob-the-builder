/** Context coverage corrections. Old prompt versions and manifests are evidence;
 * retired definitions are excluded from every new active manifest. */
import { readFileSync, writeFileSync } from 'node:fs'
import { LINK_CAD_SHELL_STEPS_TOOL } from '../supabase/functions/_shared/cad-shell.ts'
import { ORIENTATION_DIRECTORY_TOOL, ORIENTATION_DIRECTORY_LIMITS } from '../supabase/functions/_shared/bob-orientation-directory.ts'

const publication = 'bob-context-coverage-v1'
const retired = [
  'agent-contract.cad-designer', 'agent-contract.cad-research',
  'cad-designer.contract', 'cad-designer.first-layout', 'cad-designer.persona', 'cad-designer.repair', 'cad-designer.repair-with-delta', 'cad-designer.workflow',
  'cad-research.contract', 'cad-research.invalid-assessment', 'cad-research.persona', 'cad-research.readiness-rules', 'feedback.cad-research.rules.71bceb4a3f00',
  'profile.cad-designer', 'profile.cad-research', 'role.cad-designer', 'role.cad-research', 'routing.cad-designer', 'routing.cad-research',
  'schema.dimension_bindings', 'schema.intake', 'calculator.schema-phase',
  'tools.finish_cad_research', 'tools.render_cad_candidate', 'tools.render_saved_cad_candidate', 'tools.report_cad_blocker', 'tools.revise_cad_candidate',
]
const linkPolicy = { name: 'link_cad_shell_steps', description: 'Link the pieces of a shell drawing to current plan Steps in one go, or unlink them.', how_to: 'Read the shell with read_cad_shell and the current plan first. Each link names a component_key from the shell and an exact current Step id; the link is held by the piece, as link_project_drawing would. Use the shell revision as expected_revision. Link each piece to the Step that builds it, in build order (for example walls before the bed that stands against them). When a piece has no fitting Step, add the Step with edit_project_plan first, then link. One piece can serve several Steps.', schema_version: 1, always_load: false, preload_phases: ['design', 'planning'], active: true }
const orientationPolicy = { name: ORIENTATION_DIRECTORY_TOOL.function.name, description: 'Read exact deferred Steps, completion requirements and shared facts from this project overview, with source revisions.', how_to: ORIENTATION_DIRECTORY_TOOL.function.description, schema_version: 1, always_load: false, preload_phases: [], active: true }
const policies = [linkPolicy, orientationPolicy]
const readShellAppend = ' Each piece also lists its linked plan Steps and its material requirements; plan_summary sums the pieces\' requirements by name and unit, lists pieces not counted yet (no requirement) and pieces not in the plan yet. A piece placed twice is counted once and named in counted_once. Link pieces to Steps with link_cad_shell_steps.'
const specialistInstructions = 'Your tool_directory contains only tools assigned to this role and permitted for the current project. Read describe_tool with the exact tool name before its first use. Its complete manual and input schema are returned, and the native function becomes callable on the next model step. After context renewal, read its manual again before reuse. Tools never grant access to other roles or project records. Use calculate_project for arithmetic; preserve exact source IDs/revisions, units, rounding and provenance. Return your original structured result once the assigned work is complete; no calculation is required when the task needs none.'
const additions = [
  { key: 'specialist.tools', kind: 'instruction_fragment', content: specialistInstructions },
  { key: 'tools.read_project_orientation', kind: 'tool_contract', metadata: { server_fields: [] }, definition: { ...ORIENTATION_DIRECTORY_TOOL.function, card_description: orientationPolicy.description, additional_description: orientationPolicy.how_to, handler: orientationPolicy.name, envelope: { schema_version: 1 }, required_parameters: ORIENTATION_DIRECTORY_TOOL.function.parameters.required, optional_parameters: [] } },
]
const edits = [
  { key: 'agent-contract.ask-bob', metadata: { specialist_tool_instructions_version: 1, continuation_retention_version: 2, orientation_directory_version: 1, orientation_max_tokens: ORIENTATION_DIRECTORY_LIMITS.initial, orientation_page_max_tokens: ORIENTATION_DIRECTORY_LIMITS.page } },
  ...['plan-compiler', 'plan-reviewer', 'cad-reviewer'].map(role => ({ key: 'role.' + role, append_prompt_keys: ['specialist.tools'], append_tool_keys: ['tools.describe_tool'] })),
  { key: 'tools.link_cad_shell_steps', definition: { ...LINK_CAD_SHELL_STEPS_TOOL.function, card_description: linkPolicy.description, additional_description: linkPolicy.how_to, required_parameters: LINK_CAD_SHELL_STEPS_TOOL.function.parameters.required, optional_parameters: [] } },
  { key: 'tools.read_cad_shell', append_manual: readShellAppend },
  { key: 'bob.colleagues', remove_roles: ['role.cad-designer', 'role.cad-research'], colleague_edits: [
    { role_key: 'role.plan-compiler', invocation_tools: ['compile_project_plan', 'audit_project_plan'], instructions: 'Give Plantus the intended plan and relevant project evidence through compile_project_plan, or request an audit with audit_project_plan. Plantus creates a validated proposal; Bob chooses strategy and handles any save and approval. edit_project_plan applies a focused edit deterministically and does not invoke Plantus or Vera.' },
    { role_key: 'role.plan-reviewer', invocation_tools: ['compile_project_plan', 'audit_project_plan'], instructions: 'Vera reviews Plantus’s proposal through compile_project_plan or audit_project_plan. Her advice does not approve or save the plan and does not replace Bob’s judgement. Focused edit_project_plan changes use server validation without a reviewer model.' },
  ] },
]
const initialCatalog = readFileSync('supabase/migrations/20261009144206_ai_definition_catalog.sql', 'utf8')
const snapshot = initialCatalog.match(/create function shared\.ai_catalog_snapshot\(p_app text\) returns jsonb[\s\S]+?\n\$\$;/)![0]
  .replace('create function', 'create or replace function').replace('where p.app=p_app\n', 'where p.app=p_app and p.retired_at is null\n')
const sql = `-- Generated by scripts/build-ai-context-coverage-catalog.ts.
-- Deploy both compatible Bob functions and restore_cad_shell_plan_link first.
-- No old definition versions, manifests, models or unrelated settings change.
-- Installed CLI aborts in native Bun; filename uses observed UTC 2026-10-18T14:49:57Z.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $context_coverage_preflight$ begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('shared.ai_catalog_snapshot(text)')) is distinct from '6a6accee4ffe557ab823ff491c7dd55a' then raise exception 'context_coverage_snapshot_drift'; end if;
end $context_coverage_preflight$;
alter table shared.ai_prompts add column retired_at timestamptz;
${snapshot}

-- Retired heads exist only to own immutable history. No new active graph may use them.
create function shared.ai_catalog_retirement_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.retired_at is not null then raise exception 'ai_catalog_retirement_invalid' using errcode='22023'; end if;
  return new;
 end if;
 if old.retired_at is not null then raise exception 'ai_catalog_definition_retired' using errcode='55000'; end if;
 if new.retired_at is distinct from old.retired_at then
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception 'ai_catalog_service_required' using errcode='42501'; end if;
  if not old.catalog_managed or old.active_version_id is null then raise exception 'ai_catalog_retirement_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:'||new.app,0));
  perform set_config('ai_catalog.validated_'||md5(new.app),'',true);
 end if;
 return new;
end $$;
revoke all on function shared.ai_catalog_retirement_guard() from public,anon,authenticated;
grant execute on function shared.ai_catalog_retirement_guard() to service_role;
create trigger ai_prompts_retirement before insert or update of retired_at,active_version_id on shared.ai_prompts
 for each row execute function shared.ai_catalog_retirement_guard();
create function shared.ai_catalog_retirement_graph_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.retired_at is distinct from old.retired_at then perform shared.ai_catalog_validate(shared.ai_catalog_snapshot(new.app)); end if;
 return null;
end $$;
revoke all on function shared.ai_catalog_retirement_graph_guard() from public,anon,authenticated;
grant execute on function shared.ai_catalog_retirement_graph_guard() to service_role;
create constraint trigger ai_prompts_retirement_graph after update on shared.ai_prompts
 deferrable initially deferred for each row execute function shared.ai_catalog_retirement_graph_guard();

do $context_coverage_catalog$
declare additions jsonb:=$context_coverage_additions$${JSON.stringify(additions, null, 2)}$context_coverage_additions$::jsonb;
 edits jsonb:=$context_coverage_edits$${JSON.stringify(edits, null, 2)}$context_coverage_edits$::jsonb;
 policies jsonb:=$context_coverage_policies$${JSON.stringify(policies, null, 2)}$context_coverage_policies$::jsonb;
 retired jsonb:=$context_coverage_retired$${JSON.stringify(retired, null, 2)}$context_coverage_retired$::jsonb;
 read_shell_append text:=$context_coverage_shell_manual$${readShellAppend}$context_coverage_shell_manual$;
 patch jsonb; policy jsonb; prior shared.ai_prompt_versions; prompt_uuid uuid; version_uuid uuid; next_version integer;
 definition jsonb; metadata jsonb; activation jsonb:='{}'; actual integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 if to_regprocedure('bob_private.read_cad_shell_pieces(text,uuid,integer)') is null
  or position('cad_shell_steps' in pg_get_functiondef('bob_private.bob_project_write_before_consequences(text,uuid,uuid,bigint,jsonb)'::regprocedure))=0
  or position('bob_turn_unlimited_work' in pg_get_functiondef('bob_private.bob_project_write_before_consequences(text,uuid,uuid,bigint,jsonb)'::regprocedure))=0
  or position('plan_summary' in pg_get_functiondef('bob.read_cad_shell(text,uuid,integer)'::regprocedure))=0
 then raise exception 'context_coverage_shell_installation_required'; end if;
 for patch in select value from jsonb_array_elements(additions) loop
  if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key=patch->>'key') then raise exception 'context_coverage_already_published: %',patch->>'key'; end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
   values('bob',patch->>'key',patch->>'key','Context coverage v1',coalesce(patch->>'content',''),'',patch->>'kind') returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prompt_uuid,1,patch->>'kind',1,jsonb_build_object('publication','${publication}')||coalesce(patch->'metadata','{}'::jsonb),coalesce(patch->>'content',''),coalesce(patch->'definition','{}'::jsonb),'','[]') returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 for patch in select value from jsonb_array_elements(edits) loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' and p.prompt_key=patch->>'key' and p.retired_at is null for update of p;
  if not found then raise exception 'context_coverage_definition_missing: %',patch->>'key'; end if;
  definition:=prior.definition||coalesce(patch->'definition','{}'::jsonb);
  if patch ? 'append_prompt_keys' then definition:=jsonb_set(definition,'{prompt_keys}',definition->'prompt_keys'||(select coalesce(jsonb_agg(k),'[]') from jsonb_array_elements(patch->'append_prompt_keys') k where not (definition->'prompt_keys') ? (k#>>'{}'))); end if;
  if patch ? 'append_tool_keys' then definition:=jsonb_set(definition,'{tool_keys}',definition->'tool_keys'||(select coalesce(jsonb_agg(k),'[]') from jsonb_array_elements(patch->'append_tool_keys') k where not (definition->'tool_keys') ? (k#>>'{}'))); end if;
  if patch ? 'append_manual' and position(patch->>'append_manual' in coalesce(definition->>'additional_description',''))=0 then definition:=definition||jsonb_build_object('additional_description',coalesce(definition->>'additional_description','')||(patch->>'append_manual')); end if;
  if patch ? 'remove_roles' then
   definition:=jsonb_set(definition,'{colleagues}',(select jsonb_agg(c||coalesce((select e from jsonb_array_elements(patch->'colleague_edits') e where e->>'role_key'=c->>'role_key'),'{}'::jsonb) order by n) from jsonb_array_elements(definition->'colleagues') with ordinality as colleagues(c,n) where not (patch->'remove_roles') ? (c->>'role_key')));
  end if;
  metadata:=(prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','${publication}')||coalesce(patch->'metadata','{}'::jsonb);
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,metadata,prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' and p.prompt_key='bob.tools' for update of p;
 if not found then raise exception 'context_coverage_toolbox_missing'; end if;
 definition:=prior.definition;
 definition:=jsonb_set(definition,'{contract_keys}',(select jsonb_agg(k order by n) from jsonb_array_elements(definition->'contract_keys') with ordinality as keys(k,n) where not retired ? (k#>>'{}')));
 for policy in select value from jsonb_array_elements(policies) loop
  definition:=jsonb_set(definition,'{catalog}',(select coalesce(jsonb_agg(c order by n),'[]') from jsonb_array_elements(definition->'catalog') with ordinality as cat(c,n) where c->>'name'<>policy->>'name')||jsonb_build_array(policy));
  if not (definition->'contract_keys') ? ('tools.'||(policy->>'name')) then definition:=jsonb_set(definition,'{contract_keys}',definition->'contract_keys'||jsonb_build_array('tools.'||(policy->>'name'))); end if;
  insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
   values(policy->>'name',policy->>'description',policy->>'how_to',(policy->>'schema_version')::integer,(policy->>'always_load')::boolean,array(select jsonb_array_elements_text(policy->'preload_phases')),(policy->>'active')::boolean)
   on conflict(name) do update set description=excluded.description,how_to=excluded.how_to,schema_version=excluded.schema_version,always_load=excluded.always_load,preload_phases=excluded.preload_phases,active=excluded.active;
 end loop;
 definition:=jsonb_set(definition,'{catalog}',(select jsonb_agg(case when c->>'name'='read_cad_shell' and position(read_shell_append in coalesce(c->>'how_to',''))=0 then c||jsonb_build_object('how_to',coalesce(c->>'how_to','')||read_shell_append) else c end order by n) from jsonb_array_elements(definition->'catalog') with ordinality as cat(c,n)));
 definition:=jsonb_set(definition,'{shelves}',(select jsonb_agg(case when s->>'label'='Project records and memory' and not (s->'tools') ? 'read_project_orientation' then jsonb_set(s,'{tools}',s->'tools'||jsonb_build_array('read_project_orientation')) else s end order by n) from jsonb_array_elements(definition->'shelves') with ordinality as shelves(s,n)));
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,(prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','${publication}'),prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 update bob.tool_catalog set how_to=how_to||read_shell_append where name='read_cad_shell' and position(read_shell_append in how_to)=0;
 update shared.ai_prompts set retired_at=clock_timestamp() where app='bob' and retired ? prompt_key and retired_at is null;
 get diagnostics actual=row_count;
 if actual<>jsonb_array_length(retired) then raise exception 'context_coverage_retirement_inventory_changed'; end if;
 delete from shared.ai_settings where app='bob' and coworker_id='bob' and module_id='cad' and function_name in ('cad-designer','cad-research');
 get diagnostics actual=row_count;
 if actual<>2 then raise exception 'context_coverage_dormant_settings_changed'; end if;
 perform shared.activate_ai_catalog('bob',activation);
end $context_coverage_catalog$;
commit;
`
const path = process.argv[2]
if (!path) throw new Error('Pass the new migration path')
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== sql) throw new Error('Context coverage publication differs from source')
  console.log('Verified context coverage publication.')
} else {
  writeFileSync(path, sql)
  const seedPath = 'supabase/functions/_shared/project-tools/catalog-seed.json'
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
  for (const policy of policies) { const index = seed.findIndex((p: any) => p.name === policy.name); if (index < 0) seed.push(policy); else seed[index] = policy }
  const readShell = seed.find((p: any) => p.name === 'read_cad_shell')
  if (!readShell.how_to.includes(readShellAppend)) readShell.how_to += readShellAppend
  writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n')
}
