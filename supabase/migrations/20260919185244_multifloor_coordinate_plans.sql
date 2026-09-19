-- Shared-frame coordinate studies. Existing canonical physical identities and
-- Artifact revisions; no accepted physical geometry or source measurements change.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.plan_number(v jsonb,lo numeric,hi numeric) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(v)='number' then (v::text)::numeric between lo and hi
   and trunc((v::text)::numeric*1000)=(v::text)::numeric*1000 else false end
$$;
create function bob_private.plan_rect(v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if v is null or jsonb_typeof(v)<>'object' then return false; end if;
 return (select count(*) from jsonb_object_keys(v))=4 and v-array['x_mm','y_mm','width_mm','depth_mm']::text[]='{}'::jsonb
   and bob_private.plan_number(v->'x_mm',-100000,100000) and bob_private.plan_number(v->'y_mm',-100000,100000)
   and bob_private.plan_number(v->'width_mm',0.001,50000) and bob_private.plan_number(v->'depth_mm',0.001,50000);
end $$;
create function bob_private.valid_multifloor_recipe(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare v jsonb; ids uuid[]:='{}'; rooms uuid[]:='{}'; heights numeric[]:='{}'; keys text[]:='{}'; n numeric; u uuid;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(p))<>9
   or p-array['generator','version','building_id','building_revision','frame','origin','levels','spaces','probes']::text[]<>'{}'::jsonb
   or p->>'generator' is distinct from 'multifloor_v1' or p->'version' is distinct from '1'::jsonb
   or p->>'frame' is distinct from 'east_north_up'
   or jsonb_typeof(p->'origin') is distinct from 'string' or length(btrim(p->>'origin')) not between 1 and 500
   or jsonb_typeof(p->'building_id') is distinct from 'string'
   or not bob_private.plan_number(p->'building_revision',1,2147483647) or (p->>'building_revision')::numeric<>trunc((p->>'building_revision')::numeric)
   or jsonb_typeof(p->'levels') is distinct from 'array' or jsonb_typeof(p->'spaces') is distinct from 'array'
   or jsonb_typeof(p->'probes') is distinct from 'array' then return false; end if;
 u:=(p->>'building_id')::uuid;
 if jsonb_array_length(p->'levels') not between 2 and 6 or jsonb_array_length(p->'spaces')>32 or jsonb_array_length(p->'probes')>4 then return false; end if;
 for v in select * from jsonb_array_elements(p->'levels') loop
   if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>8
     or v-array['level_id','level_revision','bounds','wall_mm','floor_z_mm','slab_mm','basis','source']::text[]<>'{}'::jsonb
     or not bob_private.plan_rect(v->'bounds') or not bob_private.plan_number(v->'wall_mm',0,2000)
     or not bob_private.plan_number(v->'level_revision',1,2147483647) or (v->>'level_revision')::numeric<>trunc((v->>'level_revision')::numeric)
     or jsonb_typeof(v->'level_id') is distinct from 'string'
     or (v->'floor_z_mm'<>'null'::jsonb and not bob_private.plan_number(v->'floor_z_mm',-100000,100000))
     or (v->'slab_mm'<>'null'::jsonb and not bob_private.plan_number(v->'slab_mm',0,2000))
     or coalesce(v->>'basis','')<>all(array['estimated','provided_spec'])
     or jsonb_typeof(v->'source') is distinct from 'string' or length(btrim(v->>'source')) not between 1 and 500 then return false; end if;
   u:=(v->>'level_id')::uuid;
   if u=any(ids) or (v->>'wall_mm')::numeric*2>=least((v->'bounds'->>'width_mm')::numeric,(v->'bounds'->>'depth_mm')::numeric) then return false; end if;
   ids:=array_append(ids,u);
   if v->'floor_z_mm'<>'null'::jsonb then
     n:=(v->>'floor_z_mm')::numeric;
     if n=any(heights) then return false; end if;
     heights:=array_append(heights,n);
   end if;
 end loop;
 for v in select * from jsonb_array_elements(p->'spaces') loop
   if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>6
     or v-array['space_id','space_revision','level_id','bounds','basis','source']::text[]<>'{}'::jsonb
     or (v->'bounds'<>'null'::jsonb and not bob_private.plan_rect(v->'bounds'))
     or jsonb_typeof(v->'space_id') is distinct from 'string' or jsonb_typeof(v->'level_id') is distinct from 'string'
     or not bob_private.plan_number(v->'space_revision',1,2147483647) or (v->>'space_revision')::numeric<>trunc((v->>'space_revision')::numeric)
     or coalesce(v->>'basis','')<>all(array['estimated','provided_spec'])
     or jsonb_typeof(v->'source') is distinct from 'string' or length(btrim(v->>'source')) not between 1 and 500 then return false; end if;
   u:=(v->>'space_id')::uuid;
   if u=any(rooms) or not (v->>'level_id')::uuid=any(ids) then return false; end if;
   rooms:=array_append(rooms,u);
 end loop;
 for v in select * from jsonb_array_elements(p->'probes') loop
   if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>5
     or v-array['key','label','from_level_id','to_level_id','bounds']::text[]<>'{}'::jsonb
     or jsonb_typeof(v->'key') is distinct from 'string' or (v->>'key')!~'^[a-z][a-z0-9_-]{0,39}$'
     or jsonb_typeof(v->'label') is distinct from 'string' or length(btrim(v->>'label')) not between 1 and 80
     or jsonb_typeof(v->'from_level_id') is distinct from 'string' or jsonb_typeof(v->'to_level_id') is distinct from 'string'
     or not bob_private.plan_rect(v->'bounds') then return false; end if;
   if v->>'key'=any(keys) or not (v->>'from_level_id')::uuid=any(ids) or not (v->>'to_level_id')::uuid=any(ids)
     or (v->>'from_level_id')::uuid=(v->>'to_level_id')::uuid then return false; end if;
   keys:=array_append(keys,v->>'key');
 end loop;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function bob_private.plan_number(jsonb,numeric,numeric),bob_private.plan_rect(jsonb),bob_private.valid_multifloor_recipe(jsonb) from public,anon;
grant execute on function bob_private.plan_number(jsonb,numeric,numeric),bob_private.plan_rect(jsonb),bob_private.valid_multifloor_recipe(jsonb) to authenticated;

-- A whole-building coordinate study requires an explicit whole-building or site
-- scope. Membership in some other project/Building must not widen this context.
create function bob_private.multifloor_context_access(p_project text,p_building uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and bob_private.has_project_access(p_project)
   and bob_private.has_building_access(p_building) and exists(
     select 1 from bob.project_physical_scope s join bob.buildings b on b.id=p_building
     where s.project_id=p_project and ((s.target_kind='building' and s.building_id=b.id)
       or (s.target_kind='site' and s.site_id=b.site_id)))
$$;
revoke all on function bob_private.multifloor_context_access(text,uuid) from public,anon;
grant execute on function bob_private.multifloor_context_access(text,uuid) to authenticated;

alter table bob.artifacts add column has_multifloor_plan boolean not null default false;
create table bob.artifact_multifloor_plans (
 project_id text not null references bob.projects(id) on delete cascade,
 artifact_id uuid not null, artifact_revision integer not null,
 building_id uuid not null references bob.buildings(id),
 recipe jsonb not null check(bob_private.valid_multifloor_recipe(recipe)),
 names jsonb not null check(jsonb_typeof(names)='object'),
 primary key(artifact_id,artifact_revision),
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 foreign key(artifact_id,artifact_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade,
 check(building_id=(recipe->>'building_id')::uuid)
);
create index multifloor_project_idx on bob.artifact_multifloor_plans(project_id);
create index multifloor_building_idx on bob.artifact_multifloor_plans(building_id);
create index multifloor_parent_idx on bob.artifact_multifloor_plans(artifact_id,project_id);
alter table bob.artifact_multifloor_plans enable row level security;
revoke all on bob.artifact_multifloor_plans from public,anon,authenticated;
grant select on bob.artifact_multifloor_plans to authenticated;
create policy scoped_read on bob.artifact_multifloor_plans for select to authenticated
 using(bob_private.multifloor_context_access(project_id,building_id));

create function bob_private.carry_multifloor_plan() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into bob.artifact_multifloor_plans
   select p.project_id,p.artifact_id,new.revision,p.building_id,p.recipe,p.names
   from bob.artifact_multifloor_plans p where p.artifact_id=new.artifact_id and p.artifact_revision=new.revision-1;
 return new;
end $$;
revoke all on function bob_private.carry_multifloor_plan() from public,anon,authenticated;
create trigger carry_multifloor_plan after insert on bob.artifact_revisions for each row execute function bob_private.carry_multifloor_plan();

create or replace function bob_private.check_single_artifact_recipe() returns trigger
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 select (exists(select 1 from bob.artifact_parametric_recipes where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
 +(exists(select 1 from bob.artifact_generations where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
 +(exists(select 1 from bob.artifact_room_layouts where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
 +(exists(select 1 from bob.artifact_multifloor_plans where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int into n;
 if n>1 then raise exception 'A drawing revision cannot have two geometry recipes'; end if;
 return null;
end $$;
create constraint trigger multifloor_exclusive after insert or update on bob.artifact_multifloor_plans
 deferrable initially deferred for each row execute function bob_private.check_single_artifact_recipe();

-- Marker belongs to the Artifact identity and survives physical access revocation.
create or replace view bob.artifact_revision_details with(security_invoker=true) as
 select r.*,g.generator,g.generator_version,(l.artifact_id is not null) as has_room_layout,h.has_multifloor_plan
 from bob.artifact_revisions r join bob.artifacts h on h.id=r.artifact_id and h.project_id=r.project_id
 left join bob.artifact_generations g on g.artifact_id=r.artifact_id and g.artifact_revision=r.revision
 left join bob.artifact_room_layouts l on l.artifact_id=r.artifact_id and l.artifact_revision=r.revision;
create or replace view bob.current_artifacts with(security_invoker=true) as
 select h.id,h.area_id,r.*,g.generator,g.generator_version,(l.artifact_id is not null) as has_room_layout,h.has_multifloor_plan
 from bob.artifacts h join bob.artifact_revisions r on r.artifact_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id
 left join bob.artifact_generations g on g.artifact_id=r.artifact_id and g.artifact_revision=r.revision
 left join bob.artifact_room_layouts l on l.artifact_id=r.artifact_id and l.artifact_revision=r.revision;

create view bob.artifact_multifloor_details with(security_invoker=true) as
 select p.*,
 (target.revision is distinct from ar.target_revision or target.solution_id is distinct from ar.solution_id or target.solution_revision is distinct from ar.solution_revision
 or exists(select 1 from bob.artifact_measurements m where m.artifact_id=p.artifact_id and m.artifact_revision=p.artifact_revision and not exists(
   select 1 from bob.current_measurements c where c.id=m.measurement_id and c.revision=m.measurement_revision and not c.archived))
 or not exists(select 1 from bob.current_buildings b where b.id=p.building_id and b.revision=(p.recipe->>'building_revision')::int and not b.archived)
 or exists(select 1 from jsonb_array_elements(p.recipe->'levels') l where not exists(
   select 1 from bob.current_levels c where c.id=(l->>'level_id')::uuid and c.building_id=p.building_id and c.revision=(l->>'level_revision')::int and not c.archived))
 or exists(select 1 from jsonb_array_elements(p.recipe->'spaces') s where not exists(
   select 1 from bob.current_spaces c where c.id=(s->>'space_id')::uuid and c.building_id=p.building_id and c.revision=(s->>'space_revision')::int and c.level_id=(s->>'level_id')::uuid and not c.archived))) as sources_changed,
 exists(select 1 from jsonb_array_elements(p.recipe->'spaces') s join bob.building_spaces h on h.id=(s->>'space_id')::uuid where h.latest_revision<>h.accepted_revision) as physical_pending
 from bob.artifact_multifloor_plans p
 join bob.artifacts a on a.id=p.artifact_id and a.project_id=p.project_id
 join bob.artifact_revisions ar on ar.artifact_id=p.artifact_id and ar.revision=p.artifact_revision
 left join lateral(select t.* from bob.current_target t where t.project_id=p.project_id
   and (t.area_id is not distinct from a.area_id or (a.area_id is not null and t.area_id is null))
   order by case when t.area_id is not distinct from a.area_id then 0 else 1 end limit 1) target on true;
revoke all on bob.artifact_multifloor_details from public,anon,authenticated;
grant select on bob.artifact_multifloor_details to authenticated;

create function bob_private.artifact_multifloor_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb; old bob.artifact_multifloor_plans; ar bob.artifact_revisions; v jsonb; n text; names jsonb:='{}'; body jsonb; saved jsonb;
 refs jsonb; oldrefs jsonb; before_shape jsonb; after_shape jsonb; bid uuid;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action<>all(array['create','revise','refresh_sources']) or p_artifact is null or p_expected is null
   or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>24000 then raise exception 'invalid_multifloor_plan' using errcode='22023'; end if;
 if p_data-array['recipe','target_revision','title','description','assumptions','measurements','change_note','area_id']::text[]<>'{}'::jsonb
   or not bob_private.valid_multifloor_recipe(p_data->'recipe') or jsonb_typeof(p_data->'change_note') is distinct from 'string'
   or coalesce(length(btrim(p_data->>'change_note')),0) not between 1 and 1000 then raise exception 'Invalid coordinate recipe or fields' using errcode='22023'; end if;
 p:=p_data->'recipe';bid:=(p->>'building_id')::uuid;refs:=p_data->'measurements';
 if not bob_private.multifloor_context_access(p_project,bid) then raise exception 'project_denied' using errcode='42501'; end if;
 -- Same order as the existing Artifact boundary, then stable physical source locks.
 perform 1 from bob.projects where id=p_project for no key update;
 perform 1 from bob.project_physical_scope where project_id=p_project for share;
 perform 1 from bob.buildings where id=bid for share;
 perform 1 from bob.building_levels where id in(select (x->>'level_id')::uuid from jsonb_array_elements(p->'levels') x) order by id for share;
 perform 1 from bob.building_spaces where id in(select (x->>'space_id')::uuid from jsonb_array_elements(p->'spaces') x) order by id for share;
 if not bob_private.multifloor_context_access(p_project,bid) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action<>'create' then
   select l.* into old from bob.artifact_multifloor_plans l join bob.artifacts a on a.id=l.artifact_id and a.current_revision=l.artifact_revision
     where l.project_id=p_project and l.artifact_id=p_artifact;
   if not found then raise exception 'Coordinate plan unavailable' using errcode='42501'; end if;
   if old.artifact_revision<>p_expected then raise exception 'Drawing changed. Reload before saving.' using errcode='40001'; end if;
   select * into ar from bob.artifact_revisions where artifact_id=p_artifact and revision=p_expected;
   if old.building_id<>bid or p_data ? 'area_id' then raise exception 'Cannot move a saved plan to another Building or Area' using errcode='22023'; end if;
   if p_action<>'refresh_sources' and (ar.target_revision is distinct from (p_data->>'target_revision')::int
     or old.recipe->'building_revision' is distinct from p->'building_revision') then raise exception 'Read and explicitly refresh sources first' using errcode='40001'; end if;
   -- Existing identities cannot disappear or jump levels during a geometry edit.
   for v in select * from jsonb_array_elements(old.recipe->'levels') loop
     if not exists(select 1 from jsonb_array_elements(p->'levels') x where (x->>'level_id')::uuid=(v->>'level_id')::uuid
       and (p_action='refresh_sources' or x->'level_revision'=v->'level_revision')) then raise exception 'Preserve existing level identities and source versions' using errcode='22023'; end if;
   end loop;
   for v in select * from jsonb_array_elements(old.recipe->'spaces') loop
     if not exists(select 1 from jsonb_array_elements(p->'spaces') x where (x->>'space_id')::uuid=(v->>'space_id')::uuid
       and (x->>'level_id')::uuid=(v->>'level_id')::uuid and (p_action='refresh_sources' or x->'space_revision'=v->'space_revision')) then
       raise exception 'Preserve existing space identities, levels and source versions' using errcode='22023'; end if;
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('id',measurement_id,'revision',measurement_revision)),'[]'::jsonb) into oldrefs
     from bob.artifact_measurements where artifact_id=p_artifact and artifact_revision=p_expected;
   if jsonb_typeof(refs) is distinct from 'array' then raise exception 'Invalid measurement links' using errcode='22023'; end if;
   for v in select * from jsonb_array_elements(oldrefs) loop
     if not exists(select 1 from jsonb_array_elements(refs) x where (x->>'id')::uuid=(v->>'id')::uuid
       and (p_action='refresh_sources' or x->'revision'=v->'revision')) then raise exception 'Preserve linked evidence' using errcode='22023'; end if;
   end loop;
   -- Source refresh cannot silently resize/move anything or add/remove identities.
   if p_action='refresh_sources' then
     before_shape:=old.recipe-'building_revision';after_shape:=p-'building_revision';
     before_shape:=jsonb_set(before_shape,'{levels}',(select jsonb_agg(x-'level_revision') from jsonb_array_elements(old.recipe->'levels') x));
     after_shape:=jsonb_set(after_shape,'{levels}',(select jsonb_agg(x-'level_revision') from jsonb_array_elements(p->'levels') x));
     before_shape:=jsonb_set(before_shape,'{spaces}',(select coalesce(jsonb_agg(x-'space_revision'),'[]'::jsonb) from jsonb_array_elements(old.recipe->'spaces') x));
     after_shape:=jsonb_set(after_shape,'{spaces}',(select coalesce(jsonb_agg(x-'space_revision'),'[]'::jsonb) from jsonb_array_elements(p->'spaces') x));
     if before_shape is distinct from after_shape then raise exception 'Refresh source versions without changing geometry' using errcode='22023'; end if;
   end if;
 end if;
 select name into n from bob.current_buildings where id=bid and revision=(p->>'building_revision')::int and not archived;
 if not found then raise exception 'Building source changed' using errcode='40001'; end if;
 names:=jsonb_build_object(bid::text,n);
 for v in select * from jsonb_array_elements(p->'levels') loop
   select name into n from bob.current_levels where id=(v->>'level_id')::uuid and building_id=bid and revision=(v->>'level_revision')::int and not archived;
   if not found then raise exception 'Level source changed or unavailable' using errcode='40001'; end if;
   names:=names||jsonb_build_object(((v->>'level_id')::uuid)::text,n);
 end loop;
 for v in select * from jsonb_array_elements(p->'spaces') loop
   select name into n from bob.current_spaces where id=(v->>'space_id')::uuid and building_id=bid and revision=(v->>'space_revision')::int
     and level_id=(v->>'level_id')::uuid and not archived;
   if not found then raise exception 'Space source changed, unavailable or belongs to another level' using errcode='40001'; end if;
   names:=names||jsonb_build_object(((v->>'space_id')::uuid)::text,n);
 end loop;
 if jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs)>20 then raise exception 'Invalid measurement links' using errcode='22023'; end if;
 for v in select * from jsonb_array_elements(refs) order by value->>'id' loop
   perform 1 from bob.measurements where id=(v->>'id')::uuid and project_id=p_project and current_revision=(v->>'revision')::int for share;
   if not found then raise exception 'Measurement sources changed or unavailable' using errcode='40001'; end if;
 end loop;
 if octet_length(p::text)+octet_length(names::text)>16000 then raise exception 'Coordinate study too large; use concise source descriptions' using errcode='22023'; end if;
 body:=(p_data-'recipe')||jsonb_build_object('kind','plan','status','concept','source_media_id',null);
 if p_action='create' then body:=body-'change_note'; end if;
 saved:=bob_private.artifact_command(p_project,case when p_action='create' then 'create' else 'revise' end,p_artifact,p_expected,body);
 update bob.artifacts set has_multifloor_plan=true where id=p_artifact and project_id=p_project;
 delete from bob.artifact_multifloor_plans where artifact_id=p_artifact and artifact_revision=(saved->>'revision')::int;
 insert into bob.artifact_multifloor_plans values(p_project,p_artifact,(saved->>'revision')::int,bid,p,names);
 return saved;
end $$;
create function bob.artifact_multifloor_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select bob_private.artifact_multifloor_command(p_project,p_action,p_artifact,p_expected,p_data)
$$;
revoke all on function bob_private.artifact_multifloor_command(text,text,uuid,integer,jsonb),bob.artifact_multifloor_command(text,text,uuid,integer,jsonb) from public,anon;
grant execute on function bob_private.artifact_multifloor_command(text,text,uuid,integer,jsonb),bob.artifact_multifloor_command(text,text,uuid,integer,jsonb) to authenticated;

-- Preserve old research versions for rollback. Large recipes are returned only on
-- exact record lookup; the list retains a marker and bounded source-free metadata.
create function bob.search_bob_project_data_v6(p_project_id text,p_dataset text,p_query text default null,p_status text default null,
 p_area_id text default null,p_record_id text default null,p_after_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; rows jsonb;
begin
 r:=bob.search_bob_project_data_v5(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
 if p_dataset<>'artifacts' then return r; end if;
 select coalesce(jsonb_agg(item.value||jsonb_build_object('has_multifloor_plan',a.has_multifloor_plan,
   'multifloor_plan',case when p_record_id is not null then to_jsonb(p) else null end) order by item.ord),'[]'::jsonb) into rows
 from jsonb_array_elements(r->'records') with ordinality item(value,ord)
 join bob.artifacts a on a.id::text=item.value->>'id' and a.project_id=p_project_id
 left join bob.artifact_multifloor_details p on p.project_id=p_project_id and p.artifact_id=a.id and p.artifact_revision=(item.value->>'revision')::int;
 return jsonb_set(r,'{records}',rows);
end $$;
revoke all on function bob.search_bob_project_data_v6(text,text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data_v6(text,text,text,text,text,text,text) to authenticated;
create function bob_private.bob_project_write_v5(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; rid uuid; prior jsonb; record jsonb; result jsonb; message text; quote text; action text;
  key text; existing bob_private.bob_write_receipts; expected integer; creating boolean;
begin
  if p_payload->>'kind' is distinct from 'multifloor' then
    return bob_private.bob_project_write_v4(p_project,p_thread,p_turn,p_generation,p_payload);
  end if;
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  d:=p_payload->'data'; quote:=p_payload->>'request_quote';action:=d->>'action';
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>24000
    or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'::jsonb
    or (select count(*) from jsonb_object_keys(p_payload))<>6
    or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
    or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
    or (p_payload->>'expected_revision')!~'^\d+$'
    or jsonb_typeof(p_payload->'request_quote') is distinct from 'string'
    or coalesce(length(quote),0) not between 1 and 500 or jsonb_typeof(d) is distinct from 'object'
    or (p_payload->'record_id'<>'null'::jsonb and jsonb_typeof(p_payload->'record_id')<>'string') then
    raise exception 'invalid_write' using errcode='22023';
  end if;
  select text into message from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if message is null or position(quote in message)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
  creating:=p_payload->'record_id'='null'::jsonb;expected:=(p_payload->>'expected_revision')::integer;
  if (creating and (expected<>0 or action is distinct from 'create')) or (not creating and (expected<1 or action='create')) then
    raise exception 'invalid_write' using errcode='22023'; end if;
  key:='multifloor:'||coalesce(p_payload->>'record_id',concat_ws(':','new',d->>'area_id',lower(btrim(d->>'title'))));
  select * into existing from bob_private.bob_write_receipts
    where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=key;
  if found then
    if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    return existing.receipt;
  end if;
  if(select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023'; end if;
  if creating then rid:=gen_random_uuid();
  else
    rid:=(p_payload->>'record_id')::uuid;
    select to_jsonb(p) into prior from bob.artifact_multifloor_plans p join bob.artifacts a on a.id=p.artifact_id and a.current_revision=p.artifact_revision
      where p.project_id=p_project and p.artifact_id=rid;
    if not found then raise exception 'project_denied' using errcode='42501'; end if;
  end if;
  perform bob_private.artifact_multifloor_command(p_project,action,rid,expected,d-'action');
  select jsonb_build_object('id',a.id,'title',a.title,'area_id',a.area_id,'revision',a.revision,'status',a.status,
    'target_revision',a.target_revision,'solution_id',a.solution_id,'solution_revision',a.solution_revision,'multifloor_plan',to_jsonb(l)) into record
    from bob.current_artifacts a join bob.artifact_multifloor_details l on l.project_id=a.project_id and l.artifact_id=a.id and l.artifact_revision=a.revision
    where a.project_id=p_project and a.id=rid;
  if record is null then raise exception 'write_readback_failed'; end if;
  result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',rid,'label',record->>'title',
    'operation',case when creating then 'created' else 'updated' end,'savedAt',clock_timestamp(),
    'revision',(record->>'revision')::integer,'areaId',record->'area_id','record',record);
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,key,p_payload,prior,result);
  return result;
end $$;
create function bob.bob_project_write_v5(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.bob_project_write_v5(p_project,p_thread,p_turn,p_generation,p_payload)
$$;
revoke all on function bob_private.bob_project_write_v5(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v5(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v5(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v5(text,uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
