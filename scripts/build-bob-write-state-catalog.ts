/** Owner decision 2026-10-29: writes return the state they produced. Publishes
 * interface texts, the core bench and deterministic continuations only; no
 * agent prompt, model profile or role changes. Pinned manifests keep theirs. */
import { readFileSync, writeFileSync } from 'node:fs'
import { WRITE_STATE_EDIT_NOTE } from '../supabase/functions/_shared/project-edits.ts'

const CHECK_WRITES = ['save_construction_draft', 'edit_construction_parts', 'change_construction_parameters']
const SAVE_TOOLS = ['save_construction_draft', 'search_material_catalog', 'read_material_catalog']
const specs = [
 {key:'tools.save_construction_draft',replacements:[
  ['You choose parts and typed joints, save this shared checkpoint, then check its exact revision.','You choose parts and typed joints and save this shared checkpoint; the saved result includes the whole-model check of that exact revision.'],
  ['Then check_construction_draft and correct reported issues.','Correct issues reported by that check through the same construction.'],
  ['Check the saved exact revision and correct reported IDs with another revision.','The saved result includes the check of that exact revision; correct reported IDs with another revision.'],
  ['Run check_construction_draft on the receipt revision and correct the same construction if needed.','The save result includes the check of the receipt revision; correct the same construction if needed.'],
 ]},
 {key:'tools.edit_construction_parts',replacements:[
  ['After saving check the receipt revision and complete its affected outputs; this is not a drawing receipt.','The saved result includes the whole-model check of the receipt revision; complete its affected outputs; this is not a drawing receipt.'],
  ['Check the saved revision and read_construction_changes before drawing or claiming completion.','The saved result includes the check of that revision; read_construction_changes before drawing or claiming completion.'],
 ]},
 {key:'tools.change_construction_parameters',replacements:[
  ['After saved, check_construction_draft at the receipt revision and pass that exact construction_revision to design_project_cad.','The saved result includes the check of the receipt revision; pass that exact construction_revision to design_project_cad.'],
  ['Update the Solution before reconciling the construction, then check the saved receipt revision after the final change.','Update the Solution before reconciling the construction; the final saved result includes the check of its receipt revision.'],
  ['Check the receipt revision and pass it as construction_revision to design_project_cad; no drawing is saved by this command.','The saved result includes the check of the receipt revision; pass it as construction_revision to design_project_cad; no drawing is saved by this command.'],
 ]},
 {key:'tools.check_construction_draft',replacements:[
  ['Mandatory before project CAD. Check the exact saved construction revision; correct its reported issues through the construction writer, then check the new receipt revision.','Mandatory before project CAD. Construction saves, part edits and parameter changes already return the whole-model check of their receipt revision; call this tool for a local scope, requirement probes, saved outputs or after sources change.'],
 ]},
 {key:'tools.create_solution_alternative',replacements:[
  ['Creating does not select the alternative. Read the saved alternative before selecting or editing it.','Creating does not select the alternative. The saved result returns its solution_ref for select_solution_alternative with the same scope_ref.'],
 ]},
 {key:'tools.select_solution_alternative',replacements:[],append:' For a construction-purpose solution the saved result includes construction_readiness for the new selection and the selected edit entry (edit_ref and content).'},
 {key:'tools.edit_project_record',replacements:[],append:WRITE_STATE_EDIT_NOTE},
 {key:'bob.tools',replacements:[],
  // Project lookups stay loadable through describe_tool; turn-start project
  // facts already list constructions, drawings and drawing requests.
  core_tools_before:['describe_tool','search_project_data','open_project_item','read_solution_context','read_construction_draft','change_construction_parameters'],
  core_tools:['describe_tool','open_project_item','read_solution_context','read_construction_draft','change_construction_parameters'],
  remove_followups:CHECK_WRITES.map(after_tool=>({after_tool,statuses:['saved'],tools:['check_construction_draft']})),
  add_followups:[
   ...CHECK_WRITES.flatMap(after_tool=>[
    {after_tool,statuses:['saved'],when:{field:'checked_concept_ready',equals:true},tools:['design_project_cad']},
    {after_tool,statuses:['saved'],when:{field:'checked_concept_ready',equals:false},tools:['edit_construction_parts']},
   ]),
   ...['select_solution_alternative','edit_project_record'].flatMap(after_tool=>[
    {after_tool,statuses:['saved'],when:{field:'creation_state',equals:'ready'},tools:SAVE_TOOLS},
    {after_tool,statuses:['saved'],when:{field:'creation_state',equals:'needs_data'},tools:['edit_project_record']},
   ]),
  ]},
]
const sql=`-- Generated by scripts/build-bob-write-state-catalog.ts.
-- Owner decision 2026-10-29: writes return the state they produced.
-- Install both matching Edge runtimes before activation. Existing manifests remain pinned.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $write_state_publication$
declare specs jsonb:=$write_state_spec$${JSON.stringify(specs)}$write_state_spec$::jsonb;
 item jsonb; prior shared.ai_prompt_versions; definition jsonb; replacement jsonb; field text; matched boolean; followup jsonb;
 next_version integer; version_uuid uuid; activation jsonb:='{}';
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for item in select value from jsonb_array_elements(specs) loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=item->>'key' and p.retired_at is null for update of p;
  if not found then raise exception 'write_state_contract_missing: %',item->>'key'; end if;
  if prior.metadata->>'write_state_version'='1' then continue; end if;
  definition:=prior.definition;
  -- Every replaced sentence must exist; a drifted text stops the publication.
  for replacement in select value from jsonb_array_elements(item->'replacements') loop
   matched:=false;
   foreach field in array array['description','additional_description','card_description'] loop
    if definition ? field and position(replacement->>0 in definition->>field)>0 then
     definition:=jsonb_set(definition,array[field],to_jsonb(replace(definition->>field,replacement->>0,replacement->>1)));matched:=true;
    end if;
   end loop;
   if not matched then raise exception 'write_state_text_missing: %',item->>'key'; end if;
  end loop;
  if item ? 'append' then definition:=jsonb_set(definition,'{description}',to_jsonb((definition->>'description')||(item->>'append'))); end if;
  if item ? 'core_tools' then
   if definition->'core_tools' is distinct from item->'core_tools_before' then raise exception 'write_state_core_tools_changed'; end if;
   definition:=jsonb_set(definition,'{core_tools}',item->'core_tools');
  end if;
  if item ? 'remove_followups' then
   if prior.metadata->>'creation_preparation_version' is distinct from '1' then raise exception 'write_state_requires_creation_preparation'; end if;
   for followup in select value from jsonb_array_elements(item->'remove_followups') loop
    if not exists(select 1 from jsonb_array_elements(definition->'operation_followups') f where f.value=followup) then raise exception 'write_state_followup_missing'; end if;
   end loop;
   definition:=jsonb_set(definition,'{operation_followups}',coalesce((select jsonb_agg(f.value order by f.n) from jsonb_array_elements(definition->'operation_followups') with ordinality f(value,n)
    where not exists(select 1 from jsonb_array_elements(item->'remove_followups') r where r.value=f.value)),'[]'::jsonb)||(item->'add_followups'));
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','write-state-v1','write_state_version',1),
    prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(item->>'key',version_uuid);
 end loop;
 if activation<>'{}'::jsonb then perform shared.activate_ai_catalog('bob',activation); end if;
end $write_state_publication$;
commit;
`
const target=process.argv.find(arg=>arg.endsWith('_bob_write_state_catalog.sql'))
if(!target)throw Error('Pass the *_bob_write_state_catalog.sql migration path')
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==sql)throw Error('Write state publication is stale')}
else writeFileSync(target,sql)
