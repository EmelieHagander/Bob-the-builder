-- D: role/quantity policy is subordinate to an exact construction revision.
-- Actual UTC filename fallback: the installed migration CLI previously aborted.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.artifact_construction_instance_policies (
 project_id text not null,
 artifact_id uuid not null,
 artifact_revision integer not null,
 policy jsonb not null,
 primary key(artifact_id,artifact_revision),
 foreign key(project_id,artifact_id,artifact_revision)
  references bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision) on delete cascade
);
create index construction_instance_policy_project_idx on bob.artifact_construction_instance_policies(project_id,artifact_id,artifact_revision);
alter table bob.artifact_construction_instance_policies enable row level security;
revoke all on bob.artifact_construction_instance_policies from public,anon,authenticated,service_role;
grant select on bob.artifact_construction_instance_policies to authenticated;
create policy project_read on bob.artifact_construction_instance_policies for select to authenticated using(bob_private.has_project_access(project_id));
create trigger construction_instance_policy_immutable before update on bob.artifact_construction_instance_policies
 for each row execute function bob_private.construction_immutable();

create function bob_private.check_construction_instance_policy(recipe jsonb,policy jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare p jsonb; seen text[]:='{}'; ids text[];
begin
 select array_agg(i->>'id') into ids from jsonb_array_elements(recipe->'instances') i;
 if jsonb_typeof(policy) is distinct from 'object' or policy-array['version','instances']<>'{}'
  or (select count(*) from jsonb_object_keys(policy))<>2 or policy->'version' is distinct from '1'::jsonb
  or jsonb_typeof(policy->'instances') is distinct from 'array' or jsonb_array_length(policy->'instances')<>cardinality(ids)
  then raise exception 'invalid_instance_policy' using errcode='22023'; end if;
 for p in select value from jsonb_array_elements(policy->'instances') loop
  if jsonb_typeof(p) is distinct from 'object' or p-array['instance_id','role','quantity_policy','reason']<>'{}'
   or (select count(*) from jsonb_object_keys(p))<>4 or not coalesce(p->>'instance_id','')=any(ids)
   or p->>'instance_id'=any(seen) or jsonb_typeof(p->'reason') is distinct from 'string'
   or char_length(btrim(p->>'reason')) not between 1 and 2000
   or p->>'quantity_policy' is distinct from (case p->>'role'
    when 'build_part' then 'manufacture' when 'existing_part' then 'retain'
    when 'prefabricated_part' then 'complete_item' when 'reference' then 'exclude' when 'unknown' then 'unknown' end)
   or coalesce(p->>'role','') not in ('build_part','existing_part','prefabricated_part','reference','unknown')
   then raise exception 'invalid_instance_policy' using errcode='22023'; end if;
  seen:=array_append(seen,p->>'instance_id');
 end loop;
end $$;
revoke all on function bob_private.check_construction_instance_policy(jsonb,jsonb) from public,anon,authenticated,service_role;

create function bob_private.validate_construction_instance_policy() returns trigger
language plpgsql security invoker set search_path='' as $$
declare recipe jsonb;
begin
 select c.recipe into recipe from bob.artifact_construction_revisions c
  where c.project_id=new.project_id and c.artifact_id=new.artifact_id and c.artifact_revision=new.artifact_revision;
 if recipe is null then raise exception 'construction_policy_source_missing' using errcode='22023'; end if;
 perform bob_private.check_construction_instance_policy(recipe,new.policy);
 return new;
end $$;
revoke all on function bob_private.validate_construction_instance_policy() from public,anon,authenticated,service_role;
create trigger validate_construction_instance_policy before insert on bob.artifact_construction_instance_policies
 for each row execute function bob_private.validate_construction_instance_policy();

-- Omitted policies on older writes inherit only stable existing IDs. New and
-- historical unclassified IDs remain unknown; no owner data is backfilled.
create function bob_private.inherit_construction_instance_policy() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior jsonb; p jsonb;
begin
 if exists(select 1 from bob.artifact_construction_instance_policies where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision) then return new; end if;
 select policy into prior from bob.artifact_construction_instance_policies where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 if prior is null then return new; end if;
 select jsonb_build_object('version',1,'instances',jsonb_agg(coalesce(
  (select r from jsonb_array_elements(prior->'instances') r where r->>'instance_id'=i->>'id'),
  jsonb_build_object('instance_id',i->>'id','role','unknown','quantity_policy','unknown','reason','New instance role is not recorded. Classify this exact saved instance.')) order by i->>'id')) into p
  from jsonb_array_elements(new.recipe->'instances') i;
 insert into bob.artifact_construction_instance_policies values(new.project_id,new.artifact_id,new.artifact_revision,p);
 return new;
end $$;
revoke all on function bob_private.inherit_construction_instance_policy() from public,anon,authenticated,service_role;
create constraint trigger a_inherit_construction_instance_policy after insert on bob.artifact_construction_revisions
 deferrable initially deferred for each row execute function bob_private.inherit_construction_instance_policy();

alter function bob.read_construction_draft(text,uuid,integer,uuid) rename to read_construction_before_instance_roles;
alter function bob.read_construction_before_instance_roles(text,uuid,integer,uuid) set schema bob_private;
revoke all on function bob_private.read_construction_before_instance_roles(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob_private.read_construction_before_instance_roles(text,uuid,integer,uuid) to authenticated;
create function bob.read_construction_draft(p_project text,p_artifact uuid default null,p_revision integer default null,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; p jsonb;
begin
 result:=bob_private.read_construction_before_instance_roles(p_project,p_artifact,p_revision,p_after);
 if result->>'status'='ok' and p_artifact is not null then
  select policy into p from bob.artifact_construction_instance_policies where project_id=p_project and artifact_id=p_artifact and artifact_revision=(result->>'revision')::integer;
  result:=result||jsonb_build_object('instance_policy',p);
 end if;
 return result;
end $$;
revoke all on function bob.read_construction_draft(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob.read_construction_draft(text,uuid,integer,uuid) to authenticated;

create function bob_private.construction_build_instances(c bob.artifact_construction_revisions) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p jsonb; result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(c.project_id) then raise exception 'project_denied' using errcode='42501'; end if;
 select policy into p from bob.artifact_construction_instance_policies where project_id=c.project_id and artifact_id=c.artifact_id and artifact_revision=c.artifact_revision;
 if p is null or exists(select 1 from jsonb_array_elements(p->'instances') i where i->>'role'='unknown') then raise exception 'construction_instance_roles_required' using errcode='22023'; end if;
 perform bob_private.check_construction_instance_policy(c.recipe,p);
 select coalesce(jsonb_agg(i order by ordinal),'[]') into result from jsonb_array_elements(c.recipe->'instances') with ordinality as item(i,ordinal)
  where exists(select 1 from jsonb_array_elements(p->'instances') r where r->>'instance_id'=i->>'id' and r->>'quantity_policy'='manufacture');
 return result;
end $$;
revoke all on function bob_private.construction_build_instances(bob.artifact_construction_revisions) from public,anon,service_role;
grant execute on function bob_private.construction_build_instances(bob.artifact_construction_revisions) to authenticated;

create function bob.prepare_construction_role_change(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; msg text; saved bob_private.bob_write_receipts; draft jsonb; policy jsonb; changes jsonb; r jsonb; seen text[]:='{}';
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>150000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or p_payload->>'kind' is distinct from 'construction_roles' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'record_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$'
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','changes','change_note','computed']<>'{}' or (select count(*) from jsonb_object_keys(d))<>4
  or d->'computed' is distinct from 'null'::jsonb or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$'
  or jsonb_typeof(d->'changes') is distinct from 'array' or jsonb_array_length(d->'changes') not between 1 and 512
  or jsonb_typeof(d->'change_note') is distinct from 'string' or char_length(btrim(d->>'change_note')) not between 1 and 1000
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  then raise exception 'invalid_construction_role_change' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction_roles:'||(d->>'key');
 if found then
  if saved.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return jsonb_build_object('status','saved','receipt',saved.receipt);
 end if;
 draft:=bob.read_construction_draft(p_project,(p_payload->>'record_id')::uuid,null,null);
 if draft->>'status' is distinct from 'ok' then raise exception 'not_a_construction_draft' using errcode='22023'; end if;
 if draft->'revision' is distinct from p_payload->'expected_revision' or draft->'archived' is distinct from 'false'::jsonb or draft->>'source_state' is distinct from 'current'
  then raise exception 'construction_changed' using errcode='PT409'; end if;
 policy:=draft->'instance_policy';
 if policy is null or policy='null'::jsonb then
  select jsonb_build_object('version',1,'instances',jsonb_agg(jsonb_build_object('instance_id',i->>'id','role','unknown','quantity_policy','unknown','reason','Historical instance role is not recorded.') order by i->>'id')) into policy
   from jsonb_array_elements(draft->'recipe'->'instances') i;
 end if;
 for r in select value from jsonb_array_elements(d->'changes') loop
  if r->>'instance_id'=any(seen) or not exists(select 1 from jsonb_array_elements(policy->'instances') i where i->>'instance_id'=r->>'instance_id')
   then raise exception 'invalid_instance_policy_identity' using errcode='22023'; end if;
  seen:=array_append(seen,r->>'instance_id');
 end loop;
 select jsonb_agg(coalesce((select delta from jsonb_array_elements(d->'changes') delta where delta->>'instance_id'=i->>'instance_id'),i) order by i->>'instance_id') into changes from jsonb_array_elements(policy->'instances') i;
 policy:=jsonb_build_object('version',1,'instances',changes);
 perform bob_private.check_construction_instance_policy(draft->'recipe',policy);
 return jsonb_build_object('status','ready','draft',draft,'policy',policy);
end $$;
revoke all on function bob.prepare_construction_role_change(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.prepare_construction_role_change(text,uuid,uuid,bigint,jsonb) to authenticated;

alter function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_instance_roles;
revoke all on function bob_private.bob_project_write_before_instance_roles(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v14(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; ready jsonb; draft jsonb; policy jsonb; payload jsonb; result jsonb; existing bob_private.bob_write_receipts; msg text;
begin
 if p_payload->>'kind'='construction_roles' then
  ready:=bob.prepare_construction_role_change(p_project,p_thread,p_turn,p_generation,p_payload);
  if ready->>'status'='saved' then return ready->'receipt'; end if;
  draft:=ready->'draft';
  payload:=p_payload||jsonb_build_object('kind','construction','data',jsonb_build_object(
   'key',d->>'key','title',draft->>'title','description',draft->>'description','area_id',draft->'area_id','target_revision',draft->'target_revision',
   'change_note',d->>'change_note','recipe',draft->'recipe','parameters',draft->'parameters','materials',draft->'materials','joints',draft->'joints',
   'open_questions',draft->'open_questions','instance_policy',ready->'policy'));
  result:=bob_private.bob_project_write_v14(p_project,p_thread,p_turn,p_generation,payload);
  update bob_private.bob_write_receipts set operation_key='construction_roles:'||(d->>'key'),payload=p_payload
   where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction:'||(d->>'key');
  return result;
 end if;
 if p_payload->>'kind' is distinct from 'construction' or not d?'instance_policy' then
  return bob_private.bob_project_write_before_instance_roles(p_project,p_thread,p_turn,p_generation,p_payload);
 end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction:'||(d->>'key');
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 policy:=d->'instance_policy';
 if policy is distinct from 'null'::jsonb then perform bob_private.check_construction_instance_policy(d->'recipe',policy); end if;
 payload:=jsonb_set(p_payload,'{data}',d-'instance_policy');
 result:=bob_private.bob_project_write_before_instance_roles(p_project,p_thread,p_turn,p_generation,payload);
 if policy is distinct from 'null'::jsonb then
  insert into bob.artifact_construction_instance_policies values(p_project,(result->>'recordId')::uuid,(result->>'revision')::integer,policy);
 end if;
 update bob_private.bob_write_receipts set payload=p_payload where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction:'||(d->>'key');
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) to authenticated;

-- Role-aware reader exposes the exact drawn policy, never a later construction.
alter function bob.read_cad_artifact(text,uuid,integer) rename to read_cad_before_instance_roles;
alter function bob.read_cad_before_instance_roles(text,uuid,integer) set schema bob_private;
revoke all on function bob_private.read_cad_before_instance_roles(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_cad_before_instance_roles(text,uuid,integer) to authenticated;
create function bob.read_cad_artifact(p_project text,p_artifact uuid,p_revision integer default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; policy jsonb;
begin
 result:=bob_private.read_cad_before_instance_roles(p_project,p_artifact,p_revision);
 if result is null then return null; end if;
 select p.policy into policy from bob.artifact_construction_drawings d join bob.artifact_construction_instance_policies p
  on p.project_id=d.project_id and p.artifact_id=d.construction_artifact_id and p.artifact_revision=d.construction_revision
  where d.project_id=p_project and d.drawing_artifact_id=p_artifact and d.drawing_revision=(result->>'revision')::integer;
 return result||jsonb_build_object('instance_policy',policy);
end $$;
revoke all on function bob.read_cad_artifact(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_cad_artifact(text,uuid,integer) to authenticated;

-- Historical layouts remain readable, but new commitments cannot promote an
-- unclassified legacy quantity to current manufacturing evidence. Release and
-- withdrawal still use the existing commands, preserving held history.
alter function bob_private.read_cut_plan(text,uuid,integer) rename to read_cut_plan_before_instance_roles;
revoke all on function bob_private.read_cut_plan_before_instance_roles(text,uuid,integer) from public,anon,authenticated,service_role;
create function bob_private.read_cut_plan(p_project text,p_plan uuid,p_revision integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; policy jsonb;
begin
 result:=bob_private.read_cut_plan_before_instance_roles(p_project,p_plan,p_revision);
 if result is null then return null; end if;
 select p.policy into policy from bob.artifact_construction_instance_policies p where p.project_id=p_project and p.artifact_id=(result->>'artifact_id')::uuid and p.artifact_revision=(result->>'artifact_revision')::integer;
 if policy is null or exists(select 1 from jsonb_array_elements(policy->'instances') i where i->>'role'='unknown') then
  result:=result||jsonb_build_object('instance_role_state','unknown','source_state','changed','gap','construction_instance_roles_required','stock_reserved',false,'shopping_ready',false);
  if result?'supply' then result:=jsonb_set(result,'{supply}',result->'supply'||jsonb_build_object('stock_commitment_current',false,'purchase_commitment_current',false,'commitments_current',false)); end if;
 else result:=result||jsonb_build_object('instance_role_state','classified'); end if;
 return result;
end $$;
revoke all on function bob_private.read_cut_plan(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_cut_plan(text,uuid,integer) to authenticated;

create function bob_private.assert_cut_plan_instance_roles(p_project text,p_plan uuid,p_expected integer) returns void
language plpgsql security definer set search_path='' as $$
declare source bob.artifact_construction_revisions;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select c.* into source from bob.material_cut_plans h join bob.material_cut_plan_revisions r on r.plan_id=h.id and r.revision=h.current_revision
  join bob.artifact_construction_revisions c on c.project_id=r.project_id and c.artifact_id=r.artifact_id and c.artifact_revision=r.artifact_revision
  where h.project_id=p_project and h.id=p_plan and h.current_revision=p_expected;
 if not found then raise exception 'cut_plan_changed' using errcode='PT409'; end if;
 perform bob_private.construction_build_instances(source);
end $$;
revoke all on function bob_private.assert_cut_plan_instance_roles(text,uuid,integer) from public,anon,authenticated,service_role;

alter function bob_private.cut_plan_stock_command(text,text,uuid,integer,integer,text) rename to cut_plan_stock_before_instance_roles;
revoke all on function bob_private.cut_plan_stock_before_instance_roles(text,text,uuid,integer,integer,text) from public,anon,authenticated,service_role;
create function bob_private.cut_plan_stock_command(p_project text,p_action text,p_plan uuid,p_expected integer,p_reservation_expected integer,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_action='reserve' then perform bob_private.assert_cut_plan_instance_roles(p_project,p_plan,p_expected); end if;
 return bob_private.cut_plan_stock_before_instance_roles(p_project,p_action,p_plan,p_expected,p_reservation_expected,p_note);
end $$;
revoke all on function bob_private.cut_plan_stock_command(text,text,uuid,integer,integer,text) from public,anon,service_role;
grant execute on function bob_private.cut_plan_stock_command(text,text,uuid,integer,integer,text) to authenticated;
alter function bob_private.cut_plan_shopping_command(text,text,uuid,integer,integer,text) rename to cut_plan_shopping_before_instance_roles;
revoke all on function bob_private.cut_plan_shopping_before_instance_roles(text,text,uuid,integer,integer,text) from public,anon,authenticated,service_role;
create function bob_private.cut_plan_shopping_command(p_project text,p_action text,p_plan uuid,p_expected integer,p_shopping_expected integer,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_action='publish' then perform bob_private.assert_cut_plan_instance_roles(p_project,p_plan,p_expected); end if;
 return bob_private.cut_plan_shopping_before_instance_roles(p_project,p_action,p_plan,p_expected,p_shopping_expected,p_note);
end $$;
revoke all on function bob_private.cut_plan_shopping_command(text,text,uuid,integer,integer,text) from public,anon,service_role;
grant execute on function bob_private.cut_plan_shopping_command(text,text,uuid,integer,integer,text) to authenticated;

-- Existing canonical bodies retain all source/authority/layout guards. Only
-- manufacturing-instance selection, method identity and checked policy change.

create or replace function bob_private.material_requirement_cad_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source bob.artifact_construction_revisions; head bob.artifacts; def jsonb; binding jsonb;
 n integer; quantity numeric; unit text; mode text:=p_data->>'quantity_mode'; state text; saved jsonb; payload jsonb; v_basis text; instances jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','revise') or p_requirement is null or p_expected is null
  or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>30000
  or p_data-array['name','category','area_id','task_id','waste_percent','purchase_increment','assumptions','artifact_id','artifact_revision','target_revision','stock_allocations','component_allocations','change_note','definition_id','quantity_mode']<>'{}'
  or coalesce(mode,'') not in ('pieces','length_x','length_y','length_z','area_xy','area_xz','area_yz')
  then raise exception 'invalid_cad_requirement' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select * into source from bob.artifact_construction_revisions where project_id=p_project
  and artifact_id=nullif(p_data->>'artifact_id','')::uuid and artifact_revision=nullif(p_data->>'artifact_revision','')::integer;
 if not found then raise exception 'construction_instance_roles_required' using errcode='22023'; end if;
 select * into head from bob.artifacts where id=source.artifact_id and project_id=p_project for share;
 if not found or head.current_revision<>source.artifact_revision
  or not exists(select 1 from bob.artifact_revisions where artifact_id=head.id and revision=head.current_revision and not archived)
  then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 perform 1 from bob.catalog_items where id in (
  select (m->>'material_id')::uuid from jsonb_array_elements(source.materials) m union
  select (m->>'part_id')::uuid from jsonb_array_elements(source.materials) m where m->>'part_id' is not null) order by id for share;
 select s.source_state into state from bob_private.artifact_source_assessment(p_project,source.artifact_id,source.artifact_revision) s;
 if state is distinct from 'current' then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 if p_data->'stock_allocations' is distinct from '[]'::jsonb or p_data->'component_allocations' is distinct from '[]'::jsonb
  then raise exception 'construction_cut_fit_required' using errcode='22023'; end if;
 select d into def from jsonb_array_elements(source.recipe->'definitions') d where d->>'id'=p_data->>'definition_id';
 select m into binding from jsonb_array_elements(source.materials) m where m->>'definition_id'=p_data->>'definition_id';
 select count(*),jsonb_agg(i->>'id' order by i->>'id') into n,instances from jsonb_array_elements(bob_private.construction_build_instances(source)) i where i->>'definition_id'=p_data->>'definition_id';
 if exists(
  select 1 from bob.material_requirement_construction_sources cs join bob.current_material_requirements r
   on r.id=cs.requirement_id and r.revision=cs.requirement_revision and r.project_id=cs.project_id
  where cs.project_id=p_project and cs.requirement_id<>p_requirement and cs.artifact_id=source.artifact_id and cs.definition_id=p_data->>'definition_id'
   and cs.quantity_mode=mode and not r.archived)
  then raise exception 'construction_requirement_exists' using errcode='PT409'; end if;
 if p_action='revise' and exists(
  select 1 from bob.material_requirement_construction_sources cs where cs.project_id=p_project and cs.requirement_id=p_requirement
   and cs.requirement_revision=p_expected and (cs.artifact_id<>source.artifact_id or cs.definition_id is distinct from p_data->>'definition_id' or cs.quantity_mode<>mode))
  then raise exception 'construction_requirement_identity_changed' using errcode='22023'; end if;
 if def is null or binding is null or n not between 1 and 512 or def->>'primitive'<>'box' or coalesce(jsonb_array_length(def->'cuts'),0)>0
  then raise exception 'unsupported_construction_blank' using errcode='22023'; end if;
 if mode='pieces' then quantity:=n;unit:='pcs';
 elsif mode like 'length_%' then quantity:=n*(def->>(right(mode,1)||'_mm'))::numeric/1000;unit:='m';
 else quantity:=n*(def->>(substr(mode,6,1)||'_mm'))::numeric*(def->>(substr(mode,7,1)||'_mm'))::numeric/1000000;unit:='m2'; end if;
 if quantity is null or quantity<=0 or quantity>1000000000 then raise exception 'invalid_construction_quantity' using errcode='22023'; end if;
 quantity:=ceil(quantity*10000)/10000;
 v_basis:=format('Construction blank role v2: artifact %s revision %s; definition %s; instances %s; local blank %s x %s x %s mm; material %s@%s; part %s@%s; %s = %s %s. Counts each manufacture instance once; retain, complete_item and reference instances are excluded. Dimensions are canonical computed inputs. Concept only: raw-stock format, kerf, grain, fit, hardware and assembly access are unresolved. This is not a purchase, cutting-stock layout or fabrication approval.',source.artifact_id,source.artifact_revision,def->>'id',instances,def->>'x_mm',def->>'y_mm',def->>'z_mm',binding->>'material_id',binding->>'material_revision',binding->>'part_id',binding->>'part_revision',mode,quantity,unit);
 if length(v_basis)>6000 then raise exception 'construction_basis_too_large' using errcode='22023'; end if;
 payload:=(p_data-array['definition_id','quantity_mode'])||jsonb_build_object('required_quantity',quantity::text,'unit',unit,'basis',v_basis);
 saved:=bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,payload);
 update bob.material_requirement_revisions set source_kind='deterministic',method_key='construction_blank_'||mode,method_version='2',basis=v_basis
 where project_id=p_project and requirement_id=p_requirement and revision=(saved->>'revision')::integer;
 if not found then raise exception 'construction_quantity_not_persisted' using errcode='22023'; end if;
 insert into bob.material_requirement_construction_sources values(p_project,p_requirement,(saved->>'revision')::integer,
  source.artifact_id,source.artifact_revision,def->>'id',mode,instances,
  jsonb_build_object('x',def->'x_mm','y',def->'y_mm','z',def->'z_mm'),binding);
 return saved;
end $$;

create or replace function bob_private.check_cut_plan_layout(c bob.artifact_construction_revisions, candidates jsonb, grains jsonb, layout jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare f jsonb; g jsonb; d jsonb; b jsonb; m bob.catalog_item_revisions; p jsonb; cut jsonb; r jsonb; s jsonb;
 pieces jsonb:='[]'; seen jsonb:='[]'; sheet_names jsonb:='[]'; used jsonb:='[]'; dims jsonb; axes text[]; plane text[];
 thickness numeric; x numeric; y numeric; w numeric; h numeric; pos numeric; kerf numeric; idx integer; i integer; k text; found_rect boolean;
begin
 if jsonb_typeof(candidates) is distinct from 'array' or jsonb_array_length(candidates) not between 1 and 8
  or jsonb_typeof(grains) is distinct from 'array' or jsonb_array_length(grains) not between 1 and 24
  or jsonb_typeof(layout) is distinct from 'object' or layout-array['placements','cuts','offcuts','used_sheets']<>'{}'
  or (select count(*) from jsonb_object_keys(layout))<>4 then raise exception 'cut_plan_invalid_layout' using errcode='22023'; end if;
 foreach k in array array['placements','cuts','offcuts','used_sheets'] loop
  if jsonb_typeof(layout->k) is distinct from 'array' then raise exception 'cut_plan_invalid_layout' using errcode='22023'; end if;
 end loop;
 if jsonb_array_length(layout->'placements')<>jsonb_array_length(bob_private.construction_build_instances(c)) or jsonb_array_length(layout->'placements') not between 1 and 24
  or jsonb_array_length(layout->'cuts')>48 or jsonb_array_length(layout->'offcuts')>64 then raise exception 'cut_plan_invalid_layout' using errcode='22023'; end if;
 for g in select value from jsonb_array_elements(grains) loop
  if jsonb_typeof(g) is distinct from 'object' or g-array['definition_id','axis']<>'{}' or (select count(*) from jsonb_object_keys(g))<>2
   or coalesce(g->>'axis','') not in ('x','y','z','none') or not exists(select 1 from jsonb_array_elements(bob_private.construction_build_instances(c)) t where t->>'definition_id'=g->>'definition_id')
   then raise exception 'cut_plan_invalid_grain' using errcode='22023'; end if;
 end loop;
 if (select count(distinct value->>'definition_id') from jsonb_array_elements(grains))<>jsonb_array_length(grains)
  or (select count(distinct value->>'definition_id') from jsonb_array_elements(bob_private.construction_build_instances(c)))<>jsonb_array_length(grains)
  then raise exception 'cut_plan_invalid_grain' using errcode='22023'; end if;
 for f in select value from jsonb_array_elements(candidates) loop
  if jsonb_typeof(f) is distinct from 'object' or f-array['id','material_id','material_revision','length_mm','width_mm','thickness_mm','count','kerf_mm','trim_mm','grain','basis','note']<>'{}'
   or (select count(*) from jsonb_object_keys(f))<>12 or coalesce(f->>'id','')!~'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
   or sheet_names ? (f->>'id') or jsonb_typeof(f->'count') is distinct from 'number' or coalesce(f->>'count','')!~'^[1-9][0-9]?$' or (f->>'count')::integer>16
   or coalesce(f->>'grain','') not in ('length','width','none') or coalesce(f->>'basis','') not in ('design_choice','provided_spec')
   or jsonb_typeof(f->'note') is distinct from 'string' or char_length(btrim(f->>'note')) not between 1 and 1000
   then raise exception 'cut_plan_invalid_candidate' using errcode='22023'; end if;
  sheet_names:=sheet_names||jsonb_build_array(f->>'id');
  foreach k in array array['length_mm','width_mm','thickness_mm'] loop perform bob_private.cut_plan_mm(f->k,true); end loop;
  perform bob_private.cut_plan_mm(f->'kerf_mm'); perform bob_private.cut_plan_mm(f->'trim_mm');
  if not exists(select 1 from jsonb_array_elements(c.materials) t where t->>'material_id'=f->>'material_id' and t->'material_revision'=f->'material_revision')
   then raise exception 'cut_plan_material_mismatch' using errcode='22023'; end if;
  select * into m from bob.catalog_item_revisions where item_id=(f->>'material_id')::uuid and revision=(f->>'material_revision')::integer;
  if not found or m.profile_code<>'sheet_stock' or m.properties->'thickness'->>'value' is null
   or (m.properties->'thickness'->>'value')::numeric<>(f->>'thickness_mm')::numeric then raise exception 'cut_plan_material_mismatch' using errcode='22023'; end if;
  x:=(f->>'trim_mm')::numeric; w:=(f->>'length_mm')::numeric-2*x; h:=(f->>'width_mm')::numeric-2*x;
  if w<=0 or h<=0 then raise exception 'cut_plan_invalid_candidate' using errcode='22023'; end if;
  for i in 1..(f->>'count')::integer loop pieces:=pieces||jsonb_build_array(jsonb_build_object('sheet_id',(f->>'id')||':'||i,'x_mm',x,'y_mm',x,'length_mm',w,'width_mm',h)); end loop;
 end loop;
 if jsonb_array_length(pieces)>16 then raise exception 'cut_plan_invalid_candidate' using errcode='22023'; end if;
 -- Validate the exact placed blanks before replay so cuts cannot reference a
 -- fabricated instance, different material, rotated grain or changed dimensions.
 for p in select value from jsonb_array_elements(layout->'placements') loop
  if jsonb_typeof(p) is distinct from 'object' or p-array['instance_id','definition_id','label','sheet_id','x_mm','y_mm','length_mm','width_mm','thickness_mm','length_axis','width_axis','grain_axis']<>'{}'
   or (select count(*) from jsonb_object_keys(p))<>12 or seen ? (p->>'instance_id') then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  select value into b from jsonb_array_elements(bob_private.construction_build_instances(c)) where value->>'id'=p->>'instance_id';
  if b is null or b->>'definition_id' is distinct from p->>'definition_id' then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  select value into d from jsonb_array_elements(c.recipe->'definitions') where value->>'id'=b->>'definition_id';
  if d->>'primitive' is distinct from 'box' or coalesce(jsonb_array_length(d->'cuts'),0)>0 then raise exception 'cut_plan_unsupported_blank' using errcode='22023'; end if;
  select value into g from jsonb_array_elements(grains) where value->>'definition_id'=b->>'definition_id';
  select value into f from jsonb_array_elements(candidates) where exists(select 1 from generate_series(1,(value->>'count')::integer) serial where p->>'sheet_id'=(value->>'id')||':'||serial);
  if f is null then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  select value into s from jsonb_array_elements(c.materials) where value->>'definition_id'=b->>'definition_id';
  if s->'material_id' is distinct from f->'material_id' or s->'material_revision' is distinct from f->'material_revision'
   then raise exception 'cut_plan_material_mismatch' using errcode='22023'; end if;
  thickness:=bob_private.cut_plan_mm(f->'thickness_mm',true); axes:=array[]::text[]; plane:=array[]::text[];
  foreach k in array array['x','y','z'] loop
   if bob_private.cut_plan_mm(d->(k||'_mm'),true)=thickness then axes:=array_append(axes,k); else plane:=array_append(plane,k); end if;
  end loop;
  if cardinality(axes)<>1 or cardinality(plane)<>2 or g->>'axis'=axes[1]
   or p->>'length_axis'=p->>'width_axis' or not (p->>'length_axis'=any(plane)) or not (p->>'width_axis'=any(plane))
   or p->>'grain_axis' is distinct from g->>'axis' or p->'thickness_mm' is distinct from f->'thickness_mm'
   or bob_private.cut_plan_mm(p->'length_mm',true)<>bob_private.cut_plan_mm(d->((p->>'length_axis')||'_mm'),true)
   or bob_private.cut_plan_mm(p->'width_mm',true)<>bob_private.cut_plan_mm(d->((p->>'width_axis')||'_mm'),true)
   or (g->>'axis'<>'none' and not ((f->>'grain'='length' and p->>'length_axis'=g->>'axis') or (f->>'grain'='width' and p->>'width_axis'=g->>'axis')))
   then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  perform bob_private.cut_plan_mm(p->'x_mm'); perform bob_private.cut_plan_mm(p->'y_mm');
  if p->>'label' is distinct from (select 'P'||ordinality from jsonb_array_elements(c.recipe->'instances') with ordinality where value->>'id'=p->>'instance_id') then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  seen:=seen||jsonb_build_array(p->>'instance_id');
  if not used ? (p->>'sheet_id') then used:=used||jsonb_build_array(p->>'sheet_id'); end if;
 end loop;
 if (select jsonb_agg(value order by value) from jsonb_array_elements(used)) is distinct from (select jsonb_agg(value order by value) from jsonb_array_elements(layout->'used_sheets'))
  then raise exception 'cut_plan_invalid_layout' using errcode='22023'; end if;
 for cut in select value from jsonb_array_elements(layout->'cuts') loop
  if jsonb_typeof(cut) is distinct from 'object' or cut-array['sheet_id','before_instance_id','axis','position_mm','span_start_mm','span_end_mm','kerf_mm']<>'{}'
   or (select count(*) from jsonb_object_keys(cut))<>7 or coalesce(cut->>'axis','') not in ('length','width') then raise exception 'cut_plan_invalid_cut' using errcode='22023'; end if;
  select value into f from jsonb_array_elements(candidates) where exists(select 1 from generate_series(1,(value->>'count')::integer) serial where cut->>'sheet_id'=(value->>'id')||':'||serial);
  select value into p from jsonb_array_elements(layout->'placements') where value->>'instance_id'=cut->>'before_instance_id';
  if f is null or p is null or p->'sheet_id' is distinct from cut->'sheet_id' then raise exception 'cut_plan_invalid_cut' using errcode='22023'; end if;
  pos:=bob_private.cut_plan_mm(cut->'position_mm'); kerf:=bob_private.cut_plan_mm(cut->'kerf_mm');
  perform bob_private.cut_plan_mm(cut->'span_start_mm'); perform bob_private.cut_plan_mm(cut->'span_end_mm');
  if kerf<>(f->>'kerf_mm')::numeric or pos<>(case when cut->>'axis'='length' then (p->>'x_mm')::numeric+(p->>'length_mm')::numeric else (p->>'y_mm')::numeric+(p->>'width_mm')::numeric end)
   then raise exception 'cut_plan_invalid_cut' using errcode='22023'; end if;
  found_rect:=false;
  for r,idx in select value,ordinality::integer-1 from jsonb_array_elements(pieces) with ordinality loop
   x:=(r->>'x_mm')::numeric; y:=(r->>'y_mm')::numeric; w:=(r->>'length_mm')::numeric; h:=(r->>'width_mm')::numeric;
   if r->>'sheet_id'<>cut->>'sheet_id' or x<>(p->>'x_mm')::numeric or y<>(p->>'y_mm')::numeric then continue; end if;
   if cut->>'axis'='length' then
    if y<>(cut->>'span_start_mm')::numeric or y+h<>(cut->>'span_end_mm')::numeric or pos<=x or pos+kerf>x+w then continue; end if;
    pieces:=(pieces-idx)||jsonb_build_array(r||jsonb_build_object('length_mm',pos-x));
    if x+w>pos+kerf then pieces:=pieces||jsonb_build_array(r||jsonb_build_object('x_mm',pos+kerf,'length_mm',x+w-pos-kerf)); end if;
   else
    if x<>(cut->>'span_start_mm')::numeric or x+w<>(cut->>'span_end_mm')::numeric or pos<=y or pos+kerf>y+h then continue; end if;
    pieces:=(pieces-idx)||jsonb_build_array(r||jsonb_build_object('width_mm',pos-y));
    if y+h>pos+kerf then pieces:=pieces||jsonb_build_array(r||jsonb_build_object('y_mm',pos+kerf,'width_mm',y+h-pos-kerf)); end if;
   end if;
   found_rect:=true; exit;
  end loop;
  if not found_rect then raise exception 'cut_plan_invalid_cut' using errcode='22023'; end if;
 end loop;
 for p in select value from jsonb_array_elements(layout->'placements') loop
  r:=p-array['instance_id','definition_id','label','thickness_mm','length_axis','width_axis','grain_axis'];
  select ordinality::integer-1 into idx from jsonb_array_elements(pieces) with ordinality where value=r limit 1;
  if idx is null then raise exception 'cut_plan_unreleased_blank' using errcode='22023'; end if;
  pieces:=pieces-idx;
 end loop;
 if (select jsonb_agg(value order by value::text) from jsonb_array_elements(pieces)) is distinct from (select jsonb_agg(value order by value::text) from jsonb_array_elements(layout->'offcuts'))
  then raise exception 'cut_plan_invalid_offcuts' using errcode='22023'; end if;
end $$;

create or replace function bob_private.bob_project_write_v15(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; c bob.artifact_construction_revisions; existing bob_private.bob_write_receipts; h bob.material_cut_plans;
 msg text; op text; aid uuid; expected integer; n integer; pins jsonb; requested jsonb; rec jsonb; before_row jsonb; result jsonb; actor text; state text; packet bob.artifact_cad_revisions;
begin
 if p_payload->>'kind' is distinct from 'cut_plan' then return bob_private.bob_project_write_v14(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>120000 or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','artifact_id','artifact_revision','requirements','candidates','blank_grain','candidate_sources','layout','change_note']<>'{}'
  or (select count(*) from jsonb_object_keys(d))<>9 or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$'
  or jsonb_typeof(d->'change_note') is distinct from 'string' or char_length(btrim(d->>'change_note')) not between 1 and 1000
  or jsonb_typeof(d->'requirements') is distinct from 'array' or jsonb_array_length(d->'requirements') not between 1 and 24
  then raise exception 'cut_plan_invalid_write' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 op:='cut_plan:'||(d->>'key');
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 select * into c from bob.artifact_construction_revisions where project_id=p_project and artifact_id=(d->>'artifact_id')::uuid and artifact_revision=(d->>'artifact_revision')::integer;
 if not found then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.artifacts where project_id=p_project and id=c.artifact_id and current_revision=c.artifact_revision for share;
 if not found or exists(select 1 from bob.current_artifacts where project_id=p_project and id=c.artifact_id and archived) then raise exception 'cut_plan_construction_changed' using errcode='PT409'; end if;
 packet.project_id:=p_project;packet.artifact_id:=c.artifact_id;packet.artifact_revision:=c.artifact_revision;packet.recipe:=c.recipe;packet.manifest:=jsonb_build_object('bob_parameters',c.parameters);
 perform bob_private.check_cad_parameter_graph(packet,false);
 select source_state into state from bob_private.artifact_source_assessment(p_project,c.artifact_id,c.artifact_revision);
 if state is distinct from 'current' then raise exception 'cut_plan_construction_changed' using errcode='PT409'; end if;
 -- Lock the exact catalog heads alongside the project/source revisions.
 perform 1 from bob.catalog_items where id in (select (value->>'material_id')::uuid from jsonb_array_elements(c.materials)
  union select (value->>'part_id')::uuid from jsonb_array_elements(c.materials) where value->>'part_id' is not null) order by id for share;
 if exists(select 1 from jsonb_array_elements(c.materials) b left join bob.catalog_items m on m.id=(b->>'material_id')::uuid
  where m.id is null or (m.project_id is not null and m.project_id<>p_project) or m.current_revision is distinct from (b->>'material_revision')::integer)
  then raise exception 'cut_plan_material_changed' using errcode='PT409'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision) order by r.id),'[]') into pins
  from bob.current_material_requirements r join bob.material_requirement_construction_sources s on s.project_id=r.project_id and s.requirement_id=r.id and s.requirement_revision=r.revision
  where r.project_id=p_project and not r.archived and s.artifact_id=c.artifact_id and s.artifact_revision=c.artifact_revision and s.quantity_mode='pieces'
   and not r.target_changed and not r.artifact_changed and r.waste_percent=0 and r.purchase_increment=1;
 select jsonb_agg(value order by value->>'id') into requested from jsonb_array_elements(d->'requirements');
 if pins is distinct from requested or jsonb_array_length(pins)<>(select count(distinct value->>'definition_id') from jsonb_array_elements(bob_private.construction_build_instances(c)))
  or exists(select 1 from jsonb_array_elements(bob_private.construction_build_instances(c)) i where not exists(select 1 from bob.material_requirement_construction_sources s join jsonb_array_elements(pins) p
   on p->>'id'=s.requirement_id::text and (p->>'revision')::integer=s.requirement_revision
   where s.project_id=p_project and s.artifact_id=c.artifact_id and s.artifact_revision=c.artifact_revision and s.definition_id=i->>'definition_id' and s.instance_ids ? (i->>'id')))
  then raise exception 'cut_plan_requirements_changed' using errcode='PT409'; end if;
 perform bob_private.check_cut_plan_layout(c,d->'candidates',d->'blank_grain',d->'layout');
 perform bob_private.cut_plan_sources(p_project,d->'candidates',d->'candidate_sources',true);
 expected:=(p_payload->>'expected_revision')::integer; aid:=coalesce((p_payload->>'record_id')::uuid,gen_random_uuid());
 if p_payload->>'record_id' is null then
  if expected<>0 or exists(select 1 from bob.material_cut_plans where project_id=p_project and artifact_id=c.artifact_id) then raise exception 'cut_plan_exists' using errcode='PT409'; end if;
  n:=1; insert into bob.material_cut_plans values(aid,p_project,c.artifact_id,n);
 else
  select * into h from bob.material_cut_plans where project_id=p_project and id=aid for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  if h.current_revision<>expected or h.artifact_id<>c.artifact_id then raise exception 'cut_plan_changed' using errcode='PT409'; end if;
  before_row:=bob_private.read_cut_plan(p_project,aid,null); n:=expected+1;
 end if;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
 insert into bob.material_cut_plan_revisions(plan_id,project_id,revision,artifact_id,artifact_revision,calculation_version,candidates,blank_grain,candidate_sources,layout,change_note,recorded_by,actor_label)
  values(aid,p_project,n,c.artifact_id,c.artifact_revision,'construction-sheet-guillotine-v1',d->'candidates',d->'blank_grain',d->'candidate_sources',d->'layout',d->>'change_note',auth.uid(),actor);
 insert into bob.material_cut_plan_requirements select p_project,aid,n,(value->>'id')::uuid,(value->>'revision')::integer from jsonb_array_elements(pins);
 update bob.material_cut_plans set current_revision=n where id=aid;
 rec:=bob_private.read_cut_plan(p_project,aid,n);
 result:=jsonb_build_object('projectId',p_project,'dataset','cut_plans','recordId',aid,'revision',n,'areaId',null,'label','Construction cut plan',
  'operation',case when expected=0 then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;

create or replace function bob_private.validate_cad_construction_source() returns trigger
language plpgsql security invoker set search_path='' as $$
declare pin jsonb:=new.manifest->'bob_construction'; prior bob.artifact_cad_revisions;
 source bob.artifact_construction_revisions; head bob.artifacts; state text; old_archived boolean; new_archived boolean;
begin
 select * into prior from bob.artifact_cad_revisions where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 if found and to_jsonb(prior)-'artifact_revision'=to_jsonb(new)-'artifact_revision' then
  select archived into old_archived from bob.artifact_revisions where artifact_id=new.artifact_id and revision=new.artifact_revision-1;
  select archived into new_archived from bob.artifact_revisions where artifact_id=new.artifact_id and revision=new.artifact_revision;
  if old_archived is distinct from new_archived then return new; end if;
 end if;
 if pin is null then
  if prior.manifest?'bob_construction' then raise exception 'construction_pin_required' using errcode='22023'; end if;
  return new;
 end if;
 if jsonb_typeof(pin) is distinct from 'object' or pin-array['version','project_id','artifact_id','revision','check']<>'{}'
  or (select count(*) from jsonb_object_keys(pin))<>5 or pin->'version' is distinct from '1'::jsonb or pin->>'project_id' is distinct from new.project_id
  or coalesce(pin->>'artifact_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(pin->>'revision','')!~'^[1-9][0-9]{0,8}$'
  or pin->'check'->>'status' is distinct from 'checked' or coalesce(pin->'check'->>'checker_version','') not in ('orthogonal-butt-v1','orthogonal-butt-role-v1')
  or pin->'check'->>'artifact_id' is distinct from pin->>'artifact_id' or pin->'check'->'revision' is distinct from pin->'revision'
  or pin->'check'->'concept_ready' is distinct from 'true'::jsonb or pin->'check'->'fabrication_ready' is distinct from 'false'::jsonb
  or pin->'check'->'issue_count' is distinct from '0'::jsonb or pin->'check'->'issues' is distinct from '[]'::jsonb
  then raise exception 'invalid_construction_check' using errcode='22023'; end if;
 if prior.manifest?'bob_construction' and prior.manifest->'bob_construction'->>'artifact_id' is distinct from pin->>'artifact_id'
  then raise exception 'construction_identity_changed' using errcode='22023'; end if;
 select * into head from bob.artifacts where project_id=new.project_id and id=(pin->>'artifact_id')::uuid for share;
 if not found or head.current_revision<>(pin->>'revision')::integer then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 if exists(select 1 from bob.artifact_revisions where artifact_id=head.id and revision=head.current_revision and archived)
  then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 select * into source from bob.artifact_construction_revisions where project_id=new.project_id and artifact_id=head.id and artifact_revision=head.current_revision;
 if not found then raise exception 'construction_source_unavailable' using errcode='22023'; end if;
 if pin->'check'->>'checker_version' is distinct from (case when exists(select 1 from bob.artifact_construction_instance_policies where project_id=new.project_id and artifact_id=source.artifact_id and artifact_revision=source.artifact_revision) then 'orthogonal-butt-role-v1' else 'orthogonal-butt-v1' end)
  or coalesce(pin->'check'->'instance_policy','null'::jsonb) is distinct from coalesce((select policy from bob.artifact_construction_instance_policies where project_id=new.project_id and artifact_id=source.artifact_id and artifact_revision=source.artifact_revision),'null'::jsonb) then raise exception 'construction_policy_check_mismatch' using errcode='22023'; end if;
 perform 1 from bob.catalog_items where project_id=new.project_id and id in (
  select (m->>'material_id')::uuid from jsonb_array_elements(source.materials) m union
  select (m->>'part_id')::uuid from jsonb_array_elements(source.materials) m where m->>'part_id' is not null) order by id for share;
 select source_state into state from bob_private.artifact_source_assessment(new.project_id,head.id,head.current_revision);
 if state is distinct from 'current' then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 if new.source_artifact_id is not null or new.source_revision is not null or new.part_ids<>'[]'::jsonb
  or new.recipe-'views' is distinct from source.recipe-'views' or new.manifest->'bob_parameters' is distinct from source.parameters
  then raise exception 'drawing_must_reuse_construction' using errcode='22023'; end if;
 if exists(select 1 from bob.artifacts a join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=new.artifact_revision
  join bob.artifact_revisions s on s.artifact_id=head.id and s.revision=head.current_revision
  where a.id=new.artifact_id and (a.area_id is distinct from head.area_id or r.target_revision is distinct from s.target_revision
   or r.solution_id is distinct from s.solution_id or r.solution_revision is distinct from s.solution_revision))
  then raise exception 'construction_scope_changed' using errcode='PT409'; end if;
 if new.manifest->'annotations'->'version' is distinct from '1'::jsonb or new.manifest->'annotations'->>'coverage' is distinct from 'complete'
  or new.manifest->'drawing_source' is distinct from jsonb_build_object('artifact_id',pin->'artifact_id','revision',pin->'revision')
  then raise exception 'construction_annotations_required' using errcode='22023'; end if;
 return new;
end $$;

commit;
