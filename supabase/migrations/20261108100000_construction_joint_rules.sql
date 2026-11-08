-- Owner decision 2026-11-08 ("Gå med rek.", after the deep audit): joint
-- rules are stored with the construction. In the first Entrén turn after
-- lean writing Konrad sent no rule and typed 104 joints by hand (54 % of what
-- he wrote): rules lasted only for the call they came with, and every read
-- showed hand joints but no rules. Now a save or part edit may carry
-- data.joint_rules, the rule set of the new revision; reads return it, and
-- code applies it to the parts a later edit adds, changes or moves.
--
-- Like the FORM refinement: one row per construction revision; a revision
-- written without rules (parameter or role changes, lifecycle copies)
-- inherits the previous revision's set. The rules are Konrad's joining
-- decisions; the joints code writes from them are saved as ordinary joints.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.artifact_construction_joint_rules (
 project_id text not null, artifact_id uuid not null, artifact_revision integer not null,
 rules jsonb not null check(jsonb_typeof(rules)='array' and jsonb_array_length(rules)<=32 and octet_length(rules::text)<=64000),
 primary key(artifact_id,artifact_revision),
 foreign key(project_id,artifact_id,artifact_revision) references bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision) on delete cascade
);
create index construction_joint_rules_project_idx on bob.artifact_construction_joint_rules(project_id,artifact_id,artifact_revision);
alter table bob.artifact_construction_joint_rules enable row level security;
revoke all on bob.artifact_construction_joint_rules from public,anon,authenticated,service_role;
grant select on bob.artifact_construction_joint_rules to authenticated;
create policy project_read on bob.artifact_construction_joint_rules for select to authenticated using(bob_private.has_project_access(project_id));
create trigger construction_joint_rules_immutable before update on bob.artifact_construction_joint_rules for each row execute function bob_private.construction_immutable();

-- Rows of plain objects with a string id; code validates the full shape.
create function bob_private.valid_construction_joint_rules(rules jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(rules)='array' and jsonb_array_length(rules)<=32 and octet_length(rules::text)<=64000
  and not exists(select 1 from jsonb_array_elements(rules) r where jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'id') is distinct from 'string'
   or jsonb_typeof(r->'between') is distinct from 'array')
$$;
revoke all on function bob_private.valid_construction_joint_rules(jsonb) from public,anon,authenticated,service_role;

-- A revision written without rules keeps the previous revision's set.
create function bob_private.inherit_construction_joint_rules() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from bob.artifact_construction_joint_rules where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision) then
  insert into bob.artifact_construction_joint_rules select project_id,artifact_id,new.artifact_revision,rules from bob.artifact_construction_joint_rules
   where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 end if;
 return new;
end $$;
revoke all on function bob_private.inherit_construction_joint_rules() from public,anon,authenticated,service_role;
create constraint trigger a_inherit_construction_joint_rules after insert on bob.artifact_construction_revisions deferrable initially deferred for each row execute function bob_private.inherit_construction_joint_rules();

-- A part edit may carry the rule set; preparing it checks only its form.
do $joint_rules_prepare$
declare def text; anchor text; replacement text;
begin
  def:=pg_get_functiondef('bob.prepare_construction_edit(text,uuid,uuid,bigint,jsonb)'::regprocedure);
  anchor:=$a$d-array['key','change_note','changes','computed','target_revision','text','form_refinement']<>'{}'$a$;
  replacement:=$r$d-array['key','change_note','changes','computed','target_revision','text','form_refinement','joint_rules']<>'{}'$r$;
  if (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then raise exception 'prepare_construction_edit_keys_changed'; end if;
  def:=replace(def,anchor,replacement);
  anchor:=$a$+(case when d?'form_refinement' then 1 else 0 end)$a$;
  replacement:=$r$+(case when d?'form_refinement' then 1 else 0 end)+(case when d?'joint_rules' then 1 else 0 end)
  or (d?'joint_rules' and not bob_private.valid_construction_joint_rules(d->'joint_rules'))$r$;
  if (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then raise exception 'prepare_construction_edit_count_changed'; end if;
  execute replace(def,anchor,replacement);
end $joint_rules_prepare$;

-- The writer: the rule set goes to its own table for the new revision; the
-- rest of the payload takes the existing path. An exact retry reuses its
-- receipt, a different rule set under the same key is refused.
alter function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_joint_rules;
-- Only the wrapper below calls it now (it runs as owner); a direct call would skip the rule store.
revoke all on function bob_private.bob_project_write_before_joint_rules(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; rules jsonb; op text; stored jsonb; existing bob_private.bob_write_receipts; result jsonb;
begin
 if coalesce(p_payload->>'kind','') not in ('construction','construction_edit') or not coalesce(d?'joint_rules',false) then
  return bob_private.bob_project_write_before_joint_rules(p_project,p_thread,p_turn,p_generation,p_payload);
 end if;
 rules:=d->'joint_rules';
 if not bob_private.valid_construction_joint_rules(rules) then raise exception 'invalid_joint_rules' using errcode='22023'; end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 op:=p_payload->>'kind'||':'||(d->>'key');
 stored:=case when p_payload->>'kind'='construction_edit' then jsonb_set(p_payload,'{data,computed}','null'::jsonb) else p_payload end;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from stored then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 result:=bob_private.bob_project_write_before_joint_rules(p_project,p_thread,p_turn,p_generation,jsonb_set(p_payload,'{data}',d-'joint_rules'));
 if result->>'recordId' is null or result->>'revision' is null then raise exception 'joint_rules_receipt_missing' using errcode='22023'; end if;
 insert into bob.artifact_construction_joint_rules values(p_project,(result->>'recordId')::uuid,(result->>'revision')::integer,rules);
 update bob_private.bob_write_receipts set payload=stored where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if not found then raise exception 'joint_rules_receipt_missing' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) to authenticated;

-- Reads return the rule set of the revision they show.
alter function bob.read_construction_draft(text,uuid,integer,uuid) rename to read_construction_before_joint_rules;
alter function bob.read_construction_before_joint_rules(text,uuid,integer,uuid) set schema bob_private;
revoke all on function bob_private.read_construction_before_joint_rules(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob_private.read_construction_before_joint_rules(text,uuid,integer,uuid) to authenticated;
create function bob.read_construction_draft(p_project text,p_artifact uuid default null,p_revision integer default null,p_after uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; rules jsonb;
begin
 result:=bob_private.read_construction_before_joint_rules(p_project,p_artifact,p_revision,p_after);
 if result->>'status'='ok' and p_artifact is not null then
  select r.rules into rules from bob.artifact_construction_joint_rules r where r.project_id=p_project and r.artifact_id=p_artifact and r.artifact_revision=(result->>'revision')::integer;
  if rules is not null then result:=result||jsonb_build_object('joint_rules',rules); end if;
 end if;
 return result;
end $$;
revoke all on function bob.read_construction_draft(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob.read_construction_draft(text,uuid,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
