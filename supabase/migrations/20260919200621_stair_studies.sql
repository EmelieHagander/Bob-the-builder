-- Stair studies depend on ONE exact multi-floor Artifact revision. No physical
-- state, floor holes, approvals or source geometry are written by this feature.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function bob_private.valid_stair_spec(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; n numeric; r integer; f integer;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(p))<>18 or p-array['generator','version','from_level_id','to_level_id','start_x_mm','start_y_mm','heading','turn','risers','first_flight_risers','width_mm','going_mm','landing_depth_mm','opening','required_headroom_mm','upper_ceiling_above_floor_mm','basis','source']::text[]<>'{}'::jsonb
  or p->>'generator' is distinct from 'stair_study_v1' or p->'version' is distinct from '1'::jsonb
  or coalesce(p->>'heading','')<>all(array['north','east','south','west']) or coalesce(p->>'turn','')<>all(array['straight','left','right'])
  or jsonb_typeof(p->'from_level_id') is distinct from 'string' or jsonb_typeof(p->'to_level_id') is distinct from 'string'
  or (p->>'from_level_id')::uuid=(p->>'to_level_id')::uuid
  or not bob_private.plan_number(p->'start_x_mm',-100000,100000) or not bob_private.plan_number(p->'start_y_mm',-100000,100000)
  or (p->'opening'<>'null'::jsonb and not bob_private.plan_rect(p->'opening'))
  or coalesce(p->>'basis','')<>all(array['provided_spec','estimated']) or jsonb_typeof(p->'source') is distinct from 'string'
  or length(btrim(p->>'source')) not between 1 and 500 then return false; end if;
 foreach k in array array['risers','width_mm','going_mm','landing_depth_mm','required_headroom_mm'] loop
  if not bob_private.plan_number(p->k,1,4000) then return false; end if;
  n:=(p->>k)::numeric;if trunc(n)<>n then return false;end if;
 end loop;
 r:=(p->>'risers')::int;
 if r not between 3 and 60 or (p->>'width_mm')::int not between 100 and 3000 or (p->>'going_mm')::int not between 50 and 1000
  or (p->>'landing_depth_mm')::int not between 100 and 3000 or (p->>'required_headroom_mm')::int not between 1000 and 4000 then return false; end if;
 if p->>'turn'='straight' then
  if p->'first_flight_risers'<>'null'::jsonb then return false;end if;
 else
  if not bob_private.plan_number(p->'first_flight_risers',2,r-2) or trunc((p->>'first_flight_risers')::numeric)<>(p->>'first_flight_risers')::numeric then return false;end if;
  f:=(p->>'first_flight_risers')::int;
 end if;
 if p->'upper_ceiling_above_floor_mm'<>'null'::jsonb and (not bob_private.plan_number(p->'upper_ceiling_above_floor_mm',100,10000)
  or trunc((p->>'upper_ceiling_above_floor_mm')::numeric)<>(p->>'upper_ceiling_above_floor_mm')::numeric) then return false;end if;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function bob_private.valid_stair_spec(jsonb) from public,anon;
grant execute on function bob_private.valid_stair_spec(jsonb) to authenticated;
alter table bob.artifacts add column has_stair_study boolean not null default false;
create table bob.artifact_stair_studies(
 project_id text not null references bob.projects(id) on delete cascade,
 artifact_id uuid not null, artifact_revision integer not null,
 building_id uuid not null references bob.buildings(id),
 plan_id uuid not null, plan_revision integer not null,
 recipe jsonb not null check(bob_private.valid_stair_spec(recipe)),
 primary key(artifact_id,artifact_revision),
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 foreign key(artifact_id,artifact_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade,
 foreign key(plan_id,plan_revision) references bob.artifact_multifloor_plans(artifact_id,artifact_revision) on delete cascade
);
create index stair_project_idx on bob.artifact_stair_studies(project_id);
create index stair_building_idx on bob.artifact_stair_studies(building_id);
create index stair_parent_idx on bob.artifact_stair_studies(artifact_id,project_id);
create index stair_plan_idx on bob.artifact_stair_studies(plan_id,plan_revision);
alter table bob.artifact_stair_studies enable row level security;
revoke all on bob.artifact_stair_studies from public,anon,authenticated;
grant select on bob.artifact_stair_studies to authenticated;
create policy scoped_read on bob.artifact_stair_studies for select to authenticated using(bob_private.multifloor_context_access(project_id,building_id));
create function bob_private.carry_stair_study() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into bob.artifact_stair_studies select p.project_id,p.artifact_id,new.revision,p.building_id,p.plan_id,p.plan_revision,p.recipe
 from bob.artifact_stair_studies p where p.artifact_id=new.artifact_id and p.artifact_revision=new.revision-1;
 return new;
end $$;
revoke all on function bob_private.carry_stair_study() from public,anon,authenticated;
create trigger carry_stair_study after insert on bob.artifact_revisions for each row execute function bob_private.carry_stair_study();
create or replace function bob_private.check_single_artifact_recipe() returns trigger language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 select (exists(select 1 from bob.artifact_parametric_recipes where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
 +(exists(select 1 from bob.artifact_generations where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
 +(exists(select 1 from bob.artifact_room_layouts where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
 +(exists(select 1 from bob.artifact_multifloor_plans where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
 +(exists(select 1 from bob.artifact_stair_studies where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int into n;
 if n>1 then raise exception 'A drawing revision cannot have two geometry recipes';end if;return null;
end $$;
create constraint trigger stair_exclusive after insert or update on bob.artifact_stair_studies deferrable initially deferred for each row execute function bob_private.check_single_artifact_recipe();
create or replace view bob.artifact_revision_details with(security_invoker=true) as
 select r.*,g.generator,g.generator_version,(l.artifact_id is not null) as has_room_layout,h.has_multifloor_plan,h.has_stair_study
 from bob.artifact_revisions r join bob.artifacts h on h.id=r.artifact_id and h.project_id=r.project_id
 left join bob.artifact_generations g on g.artifact_id=r.artifact_id and g.artifact_revision=r.revision
 left join bob.artifact_room_layouts l on l.artifact_id=r.artifact_id and l.artifact_revision=r.revision;
create or replace view bob.current_artifacts with(security_invoker=true) as
 select h.id,h.area_id,r.*,g.generator,g.generator_version,(l.artifact_id is not null) as has_room_layout,h.has_multifloor_plan,h.has_stair_study
 from bob.artifacts h join bob.artifact_revisions r on r.artifact_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id
 left join bob.artifact_generations g on g.artifact_id=r.artifact_id and g.artifact_revision=r.revision
 left join bob.artifact_room_layouts l on l.artifact_id=r.artifact_id and l.artifact_revision=r.revision;
create view bob.artifact_stair_details with(security_invoker=true) as
 select s.*,to_jsonb(p) as plan,
 (p.sources_changed or a.current_revision<>s.plan_revision or pr.archived
  or ar.target_revision<>pr.target_revision or ar.solution_id<>pr.solution_id or ar.solution_revision<>pr.solution_revision) as sources_changed
 from bob.artifact_stair_studies s
 join bob.artifact_multifloor_details p on p.project_id=s.project_id and p.building_id=s.building_id and p.artifact_id=s.plan_id and p.artifact_revision=s.plan_revision
 join bob.artifacts a on a.id=s.plan_id and a.project_id=s.project_id
 join bob.artifact_revisions pr on pr.artifact_id=s.plan_id and pr.revision=s.plan_revision
 join bob.artifact_revisions ar on ar.artifact_id=s.artifact_id and ar.revision=s.artifact_revision;
revoke all on bob.artifact_stair_details from public,anon,authenticated;
grant select on bob.artifact_stair_details to authenticated;
create function bob_private.artifact_stair_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare src bob.artifact_multifloor_details; parent bob.artifacts; prior bob.artifact_stair_studies; pr bob.artifact_revisions;
 pid uuid; version integer; recipe jsonb; oldrefs jsonb; body jsonb; saved jsonb; lo numeric; hi numeric;v jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_action is null or p_action<>all(array['create','revise','refresh_source']) or p_artifact is null or p_expected is null
  or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000
  or p_data-array['plan_id','plan_revision','recipe','title','description','assumptions','change_note']::text[]<>'{}'::jsonb
  or (select count(*) from jsonb_object_keys(p_data))<>7
  or not bob_private.valid_stair_spec(p_data->'recipe') or not bob_private.plan_number(p_data->'plan_revision',1,2147483647)
  or trunc((p_data->>'plan_revision')::numeric)<>(p_data->>'plan_revision')::numeric
  or jsonb_typeof(p_data->'change_note') is distinct from 'string' or length(btrim(p_data->>'change_note')) not between 1 and 1000
  or jsonb_typeof(p_data->'assumptions') is distinct from 'string' or length(btrim(p_data->>'assumptions')) not between 1 and 3000 then
   raise exception 'Invalid stair command' using errcode='22023';end if;
 pid:=(p_data->>'plan_id')::uuid;version:=(p_data->>'plan_revision')::int;recipe:=p_data->'recipe';
 perform 1 from bob.projects where id=p_project for no key update;
 select * into parent from bob.artifacts where id=pid and project_id=p_project;
 if not found then raise exception 'Stair source unavailable' using errcode='42501';end if;
 select * into src from bob.artifact_multifloor_details where project_id=p_project and artifact_id=pid and artifact_revision=version;
 if not found or not bob_private.multifloor_context_access(p_project,src.building_id) then raise exception 'Stair source unavailable' using errcode='42501';end if;
 -- Match the physical/source lock order of the parent plan command.
 perform 1 from bob.project_physical_scope where project_id=p_project for share;
 perform 1 from bob.buildings where id=src.building_id for share;
 perform 1 from bob.building_levels where id in(select (x->>'level_id')::uuid from jsonb_array_elements(src.recipe->'levels') x) order by id for share;
 perform 1 from bob.building_spaces where id in(select (x->>'space_id')::uuid from jsonb_array_elements(src.recipe->'spaces') x) order by id for share;
 perform 1 from bob.measurements where id in(select measurement_id from bob.artifact_measurements where artifact_id=pid and artifact_revision=version) order by id for share;
 if not bob_private.multifloor_context_access(p_project,src.building_id) then raise exception 'project_denied' using errcode='42501';end if;
 select * into src from bob.artifact_multifloor_details where project_id=p_project and artifact_id=pid and artifact_revision=version;
 select * into pr from bob.artifact_revisions where artifact_id=pid and revision=version;
 if octet_length(to_jsonb(src)::text)+octet_length(p_data::text)>24000 then raise exception 'Stair source/readback too large' using errcode='22023';end if;
 if parent.current_revision<>version or src.sources_changed or pr.archived then raise exception 'Source plan changed. Review/refresh the plan first.' using errcode='40001';end if;
 select (x->>'floor_z_mm')::numeric into lo from jsonb_array_elements(src.recipe->'levels') x where (x->>'level_id')::uuid=(recipe->>'from_level_id')::uuid;
 select (x->>'floor_z_mm')::numeric into hi from jsonb_array_elements(src.recipe->'levels') x where (x->>'level_id')::uuid=(recipe->>'to_level_id')::uuid;
 if lo is null or hi is null or hi-lo<=0 or hi-lo>10000 then raise exception 'Known source floor elevations required, upper above lower.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(src.recipe->'levels') x where (x->>'level_id')::uuid not in((recipe->>'from_level_id')::uuid,(recipe->>'to_level_id')::uuid)
  and (x->>'floor_z_mm' is null or (x->>'floor_z_mm')::numeric>lo and (x->>'floor_z_mm')::numeric<hi)) then
  raise exception 'Resolve intermediate or unlocated floors' using errcode='22023';end if;
 if p_action<>'create' then
  select s.* into prior from bob.artifact_stair_studies s join bob.artifacts a on a.id=s.artifact_id and a.current_revision=s.artifact_revision
   where s.project_id=p_project and s.artifact_id=p_artifact;
  if not found then raise exception 'Stair study unavailable' using errcode='42501';end if;
  if prior.artifact_revision<>p_expected then raise exception 'Drawing changed' using errcode='40001';end if;
  if prior.plan_id<>pid then raise exception 'Preserve source plan identity' using errcode='22023';end if;
  if p_action='revise' and prior.plan_revision<>version then raise exception 'Explicitly refresh source first' using errcode='40001';end if;
  if p_action='refresh_source' and prior.recipe is distinct from recipe then raise exception 'Refresh source without changing stair parameters' using errcode='22023';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',measurement_id,'revision',measurement_revision)),'[]'::jsonb) into oldrefs
  from bob.artifact_measurements where artifact_id=pid and artifact_revision=version;
 body:=jsonb_build_object('title',p_data->'title','description',p_data->'description','assumptions',p_data->'assumptions',
  'kind','plan','status','concept','source_media_id',null,'target_revision',pr.target_revision,'measurements',oldrefs);
 body:=body||case when p_action='create' then jsonb_build_object('area_id',parent.area_id) else jsonb_build_object('change_note',p_data->'change_note') end;
 saved:=bob_private.artifact_command(p_project,case when p_action='create' then 'create' else 'revise' end,p_artifact,p_expected,body);
 update bob.artifacts set has_stair_study=true where id=p_artifact and project_id=p_project;
 delete from bob.artifact_stair_studies where artifact_id=p_artifact and artifact_revision=(saved->>'revision')::int;
 insert into bob.artifact_stair_studies values(p_project,p_artifact,(saved->>'revision')::int,src.building_id,pid,version,recipe);
 return saved;
end $$;
create function bob.artifact_stair_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$select bob_private.artifact_stair_command(p_project,p_action,p_artifact,p_expected,p_data)$$;
revoke all on function bob_private.artifact_stair_command(text,text,uuid,integer,jsonb),bob.artifact_stair_command(text,text,uuid,integer,jsonb) from public,anon;
grant execute on function bob_private.artifact_stair_command(text,text,uuid,integer,jsonb),bob.artifact_stair_command(text,text,uuid,integer,jsonb) to authenticated;
create function bob.search_bob_project_data_v7(p_project_id text,p_dataset text,p_query text default null,p_status text default null,p_area_id text default null,p_record_id text default null,p_after_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;rows jsonb;
begin
 r:=bob.search_bob_project_data_v6(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
 if p_dataset<>'artifacts' then return r;end if;
 select coalesce(jsonb_agg(item.value||jsonb_build_object('has_stair_study',a.has_stair_study,'stair_study',case when p_record_id is not null then to_jsonb(s) else null end) order by item.ord),'[]'::jsonb) into rows
 from jsonb_array_elements(r->'records') with ordinality item(value,ord)
 join bob.artifacts a on a.id::text=item.value->>'id' and a.project_id=p_project_id
 left join bob.artifact_stair_details s on s.project_id=p_project_id and s.artifact_id=a.id and s.artifact_revision=(item.value->>'revision')::int;
 return jsonb_set(r,'{records}',rows);
end $$;
revoke all on function bob.search_bob_project_data_v7(text,text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data_v7(text,text,text,text,text,text,text) to authenticated;
create function bob_private.bob_project_write_v6(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; rid uuid; prior jsonb; record jsonb; result jsonb; message text; quote text; action text;
  key text; existing bob_private.bob_write_receipts; expected integer; creating boolean;
begin
  if p_payload->>'kind' is distinct from 'stair' then
    return bob_private.bob_project_write_v5(p_project,p_thread,p_turn,p_generation,p_payload);
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
  key:='stair:'||coalesce(p_payload->>'record_id',concat_ws(':','new',d->>'plan_id',lower(btrim(d->>'title'))));
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
    select to_jsonb(p) into prior from bob.artifact_stair_studies p join bob.artifacts a on a.id=p.artifact_id and a.current_revision=p.artifact_revision
      where p.project_id=p_project and p.artifact_id=rid;
    if not found then raise exception 'project_denied' using errcode='42501'; end if;
  end if;
  perform bob_private.artifact_stair_command(p_project,action,rid,expected,d-'action');
  select jsonb_build_object('id',a.id,'title',a.title,'area_id',a.area_id,'revision',a.revision,'status',a.status,
    'target_revision',a.target_revision,'solution_id',a.solution_id,'solution_revision',a.solution_revision,'stair_study',to_jsonb(l)) into record
    from bob.current_artifacts a join bob.artifact_stair_details l on l.project_id=a.project_id and l.artifact_id=a.id and l.artifact_revision=a.revision
    where a.project_id=p_project and a.id=rid;
  if record is null then raise exception 'write_readback_failed'; end if;
  result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',rid,'label',record->>'title',
    'operation',case when creating then 'created' else 'updated' end,'savedAt',clock_timestamp(),
    'revision',(record->>'revision')::integer,'areaId',record->'area_id','record',record);
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,key,p_payload,prior,result);
  return result;
end $$;
create function bob.bob_project_write_v6(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.bob_project_write_v6(p_project,p_thread,p_turn,p_generation,p_payload)
$$;
revoke all on function bob_private.bob_project_write_v6(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v6(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v6(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v6(text,uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
