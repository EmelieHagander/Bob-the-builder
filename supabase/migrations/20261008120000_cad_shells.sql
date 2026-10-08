-- 2026-10-08: a shell drawing combines separately saved CAD pieces (rooms, walls,
-- a bed) by reference. Each shell revision pins exact piece revisions and their
-- placements. Bob and the app move pieces through the same command, so a later
-- drag-and-drop editor uses this path too. Pieces are never copied into the shell:
-- cut lists and materials stay with the pieces and are not double counted.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.artifact_cad_shell_revisions (
 project_id text not null references bob.projects(id) on delete cascade,
 artifact_id uuid not null,
 artifact_revision integer not null,
 primary key(artifact_id,artifact_revision),
 foreign key(artifact_id,artifact_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade
);
create table bob.artifact_cad_shell_components (
 project_id text not null references bob.projects(id) on delete cascade,
 shell_artifact_id uuid not null,
 shell_revision integer not null,
 component_key text not null check(component_key ~ '^[a-z][a-z0-9_-]{0,39}$'),
 child_artifact_id uuid not null,
 child_revision integer not null,
 x_mm integer not null check(abs(x_mm)<=10000000),
 y_mm integer not null check(abs(y_mm)<=10000000),
 z_mm integer not null check(abs(z_mm)<=10000000),
 rz integer not null check(rz in (0,90,180,270)),
 placement_basis text not null check(placement_basis in ('shared_origin','owner_placed','bob_decision')),
 reason text not null check(char_length(btrim(reason)) between 1 and 500),
 primary key(shell_artifact_id,shell_revision,component_key),
 foreign key(shell_artifact_id,shell_revision) references bob.artifact_cad_shell_revisions(artifact_id,artifact_revision) on delete cascade,
 -- Only saved CAD pieces can be placed; a shell is not a CAD revision, so shells do not nest.
 foreign key(child_artifact_id,child_revision) references bob.artifact_cad_revisions(artifact_id,artifact_revision)
);
create index artifact_cad_shell_child_idx on bob.artifact_cad_shell_components(project_id,child_artifact_id);

create function bob_private.cad_shell_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'cad_shell_revision_immutable' using errcode='22023'; end $$;
create trigger cad_shell_revisions_immutable before update on bob.artifact_cad_shell_revisions for each row execute function bob_private.cad_shell_immutable();
create trigger cad_shell_components_immutable before update on bob.artifact_cad_shell_components for each row execute function bob_private.cad_shell_immutable();

do $$ declare t text; begin
 foreach t in array array['artifact_cad_shell_revisions','artifact_cad_shell_components'] loop
  execute format('alter table bob.%I enable row level security',t);
  execute format('revoke all on bob.%I from public,anon,authenticated',t);
  execute format('grant select on bob.%I to authenticated',t);
  execute format('grant all on bob.%I to service_role',t);
  execute format('create policy project_read on bob.%I for select to authenticated using(bob_private.has_project_access(project_id))',t);
 end loop;
end $$;

-- Read model shared by Bob, the app and the command result. Status compares each
-- pinned piece with its current revision; a newer piece is never adopted silently.
create function bob.read_cad_shell(p_project text,p_shell uuid,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare h bob.artifacts; r bob.artifact_revisions; result jsonb;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into h from bob.artifacts where id=p_shell and project_id=p_project;
 if not found then return null; end if;
 select * into r from bob.artifact_revisions where artifact_id=p_shell and revision=coalesce(p_revision,h.current_revision);
 if not found or not exists(select 1 from bob.artifact_cad_shell_revisions where artifact_id=p_shell and artifact_revision=r.revision) then return null; end if;
 select jsonb_build_object('id',p_shell,'revision',r.revision,'current_revision',h.current_revision,'title',r.title,'description',r.description,'assumptions',r.assumptions,
  'archived',r.archived,'area_id',h.area_id,'components',coalesce(jsonb_agg(jsonb_build_object(
   'component_key',c.component_key,'child_artifact_id',c.child_artifact_id,'child_revision',c.child_revision,
   'x_mm',c.x_mm,'y_mm',c.y_mm,'z_mm',c.z_mm,'rz',c.rz,'placement_basis',c.placement_basis,'reason',c.reason,
   'child_title',cr.title,'child_current_revision',ch.current_revision,
   'bounding_box_mm',cad.manifest->'bounding_box_mm',
   'status',case when ch.id is null then 'unavailable' when cur.archived then 'archived'
    when ch.current_revision>c.child_revision and exists(select 1 from bob.artifact_cad_revisions n where n.artifact_id=ch.id and n.artifact_revision=ch.current_revision) then 'newer_revision'
    when ch.current_revision>c.child_revision then 'changed' else 'current' end
  ) order by c.component_key) filter(where c.component_key is not null),'[]'::jsonb)) into result
 from (select 1) one
 left join bob.artifact_cad_shell_components c on c.shell_artifact_id=p_shell and c.shell_revision=r.revision
 left join bob.artifact_revisions cr on cr.artifact_id=c.child_artifact_id and cr.revision=c.child_revision
 left join bob.artifact_cad_revisions cad on cad.artifact_id=c.child_artifact_id and cad.artifact_revision=c.child_revision
 left join bob.artifacts ch on ch.id=c.child_artifact_id and ch.project_id=p_project
 left join bob.artifact_revisions cur on cur.artifact_id=ch.id and cur.revision=ch.current_revision;
 return result;
end $$;
revoke all on function bob.read_cad_shell(text,uuid,integer) from public,anon;
grant execute on function bob.read_cad_shell(text,uuid,integer) to authenticated,service_role;

create function bob_private.cad_shell_component(p_project text,v jsonb,p_current jsonb default null)
returns bob.artifact_cad_shell_components language plpgsql security definer set search_path='' as $$
declare c bob.artifact_cad_shell_components; child_rev integer;
begin
 if jsonb_typeof(v) is distinct from 'object' or v-array['component_key','child_artifact_id','child_revision','x_mm','y_mm','z_mm','rz','placement_basis','reason']<>'{}' then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
 if coalesce(v->>'child_artifact_id','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
 c.project_id:=p_project;c.component_key:=v->>'component_key';c.child_artifact_id:=(v->>'child_artifact_id')::uuid;
 child_rev:=case when jsonb_typeof(v->'child_revision')='number' then (v->>'child_revision')::integer else null end;
 -- Omitted revision pins the piece's current revision.
 if child_rev is null then select current_revision into child_rev from bob.artifacts where id=c.child_artifact_id and project_id=p_project; end if;
 c.child_revision:=child_rev;
 if not exists(select 1 from bob.artifact_cad_revisions where artifact_id=c.child_artifact_id and artifact_revision=c.child_revision and project_id=p_project) then raise exception 'cad_shell_piece_unavailable' using errcode='22023'; end if;
 if exists(select 1 from bob.artifact_revisions where artifact_id=c.child_artifact_id and revision=c.child_revision and archived) then raise exception 'cad_shell_piece_archived' using errcode='22023'; end if;
 c.placement_basis:=v->>'placement_basis';
 if jsonb_typeof(v->'x_mm') is distinct from 'number' or jsonb_typeof(v->'y_mm') is distinct from 'number' or jsonb_typeof(v->'z_mm') is distinct from 'number' or jsonb_typeof(v->'rz') is distinct from 'number'
  or (v->>'x_mm')!~'^-?[0-9]{1,8}$' or (v->>'y_mm')!~'^-?[0-9]{1,8}$' or (v->>'z_mm')!~'^-?[0-9]{1,8}$' or (v->>'rz')!~'^[0-9]{1,3}$' then raise exception 'cad_shell_invalid_placement' using errcode='22023'; end if;
 c.x_mm:=(v->>'x_mm')::integer;c.y_mm:=(v->>'y_mm')::integer;c.z_mm:=(v->>'z_mm')::integer;c.rz:=(v->>'rz')::integer;c.reason:=btrim(coalesce(v->>'reason',''));
 if c.rz not in (0,90,180,270) then raise exception 'cad_shell_invalid_placement' using errcode='22023'; end if;
 return c;
end $$;
revoke all on function bob_private.cad_shell_component(text,jsonb,jsonb) from public,anon,authenticated,service_role;

-- The one write path. p_data: create {title,description,assumptions,area_id,components[]};
-- place {component_key,x_mm,y_mm,z_mm,rz,placement_basis,reason}; add {component};
-- remove {component_key}; adopt {component_key} re-pins the piece's current revision.
create function bob_private.cad_shell_command(p_project text,p_action text,p_shell uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob.artifact_revisions; target integer; saved jsonb; rev integer; comp bob.artifact_cad_shell_components; v jsonb; key text; n integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','place','add','remove','adopt') or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>48000 or p_shell is null then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select current_revision into target from bob.project_targets where project_id=p_project;
 if p_action='create' then
  if p_data-array['title','description','assumptions','area_id','components']<>'{}' or jsonb_typeof(p_data->'components') is distinct from 'array' or jsonb_array_length(p_data->'components') not between 1 and 64 then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
  saved:=bob_private.artifact_command_before_cad(p_project,'create',p_shell,p_expected,jsonb_build_object('title',p_data->>'title','description',p_data->>'description','assumptions',coalesce(p_data->>'assumptions',''),
   'kind','plan','status','concept','target_revision',target,'measurements','[]'::jsonb,'area_id',p_data->'area_id'));
  rev:=(saved->>'revision')::integer;
  insert into bob.artifact_cad_shell_revisions values(p_project,p_shell,rev);
  for v in select * from jsonb_array_elements(p_data->'components') loop
   comp:=bob_private.cad_shell_component(p_project,v);comp.shell_artifact_id:=p_shell;comp.shell_revision:=rev;
   if comp.placement_basis is null or comp.placement_basis not in ('shared_origin','owner_placed','bob_decision') then raise exception 'cad_shell_invalid_placement' using errcode='22023'; end if;
   if exists(select 1 from bob.artifact_cad_shell_components where shell_artifact_id=p_shell and shell_revision=rev and component_key=comp.component_key) then raise exception 'cad_shell_duplicate_key' using errcode='22023'; end if;
   insert into bob.artifact_cad_shell_components select comp.*;
  end loop;
 else
  select ar.* into r from bob.artifacts a join bob.artifact_revisions ar on ar.artifact_id=a.id and ar.revision=a.current_revision
   join bob.artifact_cad_shell_revisions s on s.artifact_id=a.id and s.artifact_revision=a.current_revision where a.id=p_shell and a.project_id=p_project;
  if not found then raise exception 'cad_shell_unavailable' using errcode='22023'; end if;
  if r.archived then raise exception 'cad_shell_archived' using errcode='22023'; end if;
  if p_expected is distinct from r.revision then raise exception 'cad_shell_changed' using errcode='40001'; end if;
  key:=p_data->>(case when p_action='add' then null else 'component_key' end);
  if p_action<>'add' and not exists(select 1 from bob.artifact_cad_shell_components where shell_artifact_id=p_shell and shell_revision=r.revision and component_key=key) then raise exception 'cad_shell_unknown_component' using errcode='22023'; end if;
  saved:=bob_private.artifact_command_before_cad(p_project,'revise',p_shell,p_expected,jsonb_build_object('title',r.title,'description',r.description,'assumptions',r.assumptions,
   'kind','plan','status','concept','target_revision',target,'measurements','[]'::jsonb,'change_note','Shell: '||p_action||coalesce(' '||key,'')));
  rev:=(saved->>'revision')::integer;
  insert into bob.artifact_cad_shell_revisions values(p_project,p_shell,rev);
  insert into bob.artifact_cad_shell_components
   select project_id,shell_artifact_id,rev,component_key,child_artifact_id,child_revision,x_mm,y_mm,z_mm,rz,placement_basis,reason
   from bob.artifact_cad_shell_components where shell_artifact_id=p_shell and shell_revision=r.revision and component_key is distinct from key;
  if p_action='place' then
   select * into comp from bob.artifact_cad_shell_components where shell_artifact_id=p_shell and shell_revision=r.revision and component_key=key;
   comp:=bob_private.cad_shell_component(p_project,(p_data-'component_key')||jsonb_build_object('component_key',key,'child_artifact_id',comp.child_artifact_id,'child_revision',comp.child_revision));
  elsif p_action='adopt' then
   if p_data-'component_key'<>'{}' then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
   select * into comp from bob.artifact_cad_shell_components where shell_artifact_id=p_shell and shell_revision=r.revision and component_key=key;
   comp:=bob_private.cad_shell_component(p_project,jsonb_build_object('component_key',key,'child_artifact_id',comp.child_artifact_id,'child_revision',null,'x_mm',comp.x_mm,'y_mm',comp.y_mm,'z_mm',comp.z_mm,'rz',comp.rz,'placement_basis',comp.placement_basis,'reason',comp.reason));
  elsif p_action='add' then
   if p_data-'component'<>'{}' then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
   comp:=bob_private.cad_shell_component(p_project,p_data->'component');
   if exists(select 1 from bob.artifact_cad_shell_components where shell_artifact_id=p_shell and shell_revision=rev and component_key=comp.component_key) then raise exception 'cad_shell_duplicate_key' using errcode='22023'; end if;
  else
   if p_data-'component_key'<>'{}' then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
   comp:=null;
  end if;
  if comp.component_key is not null then
   if comp.placement_basis is null or comp.placement_basis not in ('shared_origin','owner_placed','bob_decision') then raise exception 'cad_shell_invalid_placement' using errcode='22023'; end if;
   comp.shell_artifact_id:=p_shell;comp.shell_revision:=rev;
   insert into bob.artifact_cad_shell_components select comp.*;
  end if;
  select count(*) into n from bob.artifact_cad_shell_components where shell_artifact_id=p_shell and shell_revision=rev;
  if n not between 1 and 64 then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
 end if;
 return bob.read_cad_shell(p_project,p_shell,rev);
end $$;
revoke all on function bob_private.cad_shell_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob_private.cad_shell_command(text,text,uuid,integer,jsonb) to authenticated;
create function bob.cad_shell_command(p_project text,p_action text,p_shell uuid,p_expected integer,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.cad_shell_command(p_project,p_action,p_shell,p_expected,p_data) $$;
revoke all on function bob.cad_shell_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob.cad_shell_command(text,text,uuid,integer,jsonb) to authenticated;

-- Generic Artifact edits cannot drop a shell's pieces; archive/restore carry them.
alter function bob_private.artifact_command(text,text,uuid,integer,jsonb) rename to artifact_command_before_shell;
revoke all on function bob_private.artifact_command_before_shell(text,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function bob_private.artifact_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior integer; saved jsonb; rev integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select s.artifact_revision into prior from bob.artifact_cad_shell_revisions s join bob.artifacts a on a.id=s.artifact_id and a.current_revision=s.artifact_revision where s.project_id=p_project and s.artifact_id=p_artifact;
 if prior is not null and p_action='revise' then raise exception 'use_cad_shell_command' using errcode='22023'; end if;
 saved:=bob_private.artifact_command_before_shell(p_project,p_action,p_artifact,p_expected,p_data);
 if prior is not null and p_action in ('archive','restore') then
  rev:=(saved->>'revision')::integer;
  insert into bob.artifact_cad_shell_revisions values(p_project,p_artifact,rev);
  insert into bob.artifact_cad_shell_components
   select project_id,shell_artifact_id,rev,component_key,child_artifact_id,child_revision,x_mm,y_mm,z_mm,rz,placement_basis,reason
   from bob.artifact_cad_shell_components where shell_artifact_id=p_artifact and shell_revision=prior;
 end if;
 return saved;
end $$;
revoke all on function bob_private.artifact_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob_private.artifact_command(text,text,uuid,integer,jsonb) to authenticated;

-- Bob writes shells through the same command, behind the existing writer ABI.
alter function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_cad_shells;
revoke all on function bob_private.bob_project_write_before_cad_shells(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; existing bob_private.bob_write_receipts; msg text; op text; before_row jsonb; rec jsonb; result jsonb; aid uuid; expected integer;
begin
 if p_payload->>'kind' is distinct from 'cad_shell' then return bob_private.bob_project_write_before_cad_shells(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>48000 or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$' or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['action','fields']<>'{}' or jsonb_typeof(d->'fields') is distinct from 'object'
  or coalesce(d->>'action','') not in ('create','place','add','remove','adopt')
  or (p_payload->>'record_id' is not null and p_payload->>'record_id'!~'^[0-9a-fA-F-]{36}$')
  or (d->>'action'='create')<>(p_payload->>'record_id' is null)
 then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
 expected:=(p_payload->>'expected_revision')::integer;
 op:='cad_shell:'||coalesce(p_payload->>'record_id',lower(btrim(coalesce(d->'fields'->>'title',''))))||':'||(d->>'action')||':'||expected||':'||coalesce(d->'fields'->>'component_key','');
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 aid:=coalesce((p_payload->>'record_id')::uuid,gen_random_uuid());
 if d->>'action'<>'create' then before_row:=bob.read_cad_shell(p_project,aid,null); end if;
 rec:=bob_private.cad_shell_command(p_project,d->>'action',aid,expected,d->'fields');
 result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',aid,'revision',(rec->>'revision')::integer,'areaId',rec->'area_id',
  'label','Shell drawing '||(rec->>'title'),'operation',case when d->>'action'='create' then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('compose_cad_shell',
 'Combine separately saved CAD pieces into one shell drawing, and move, add, remove or update pieces in it.',
 'A shell places saved CAD pieces (rooms, walls, furniture) by reference: exact piece revision plus x/y/z in mm and a rotation of 0, 90, 180 or 270 degrees about z. action=create needs title, description, assumptions, area_id and components [{component_key,child_artifact_id,child_revision (null = current),x_mm,y_mm,z_mm,rz,placement_basis,reason}]. Pieces made by plan_cad_pieces share one origin: use 0,0,0,0 with placement_basis shared_origin. place moves one piece (component_key plus new placement); add/remove change the piece list; adopt re-pins a piece that has a newer saved revision. Use the returned revision as expected_revision next time. Positions the owner chose are owner_placed; never present a placement as measured. Cut lists and materials stay on the pieces.',
 1,false,array['design'],true);
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('read_cad_shell',
 'Read a shell drawing: pinned pieces, placements, footprints and which pieces have newer saved revisions.',
 'Use before compose_cad_shell on an existing shell, with the shell id from its save receipt or the project drawings. Component keys and the revision come from here. A piece marked newer_revision has a newer saved drawing: tell the owner and adopt it only when they want the update. Footprints are bounding boxes, not measured rooms.',
 1,false,array['design'],true);
notify pgrst,'reload schema';
commit;
