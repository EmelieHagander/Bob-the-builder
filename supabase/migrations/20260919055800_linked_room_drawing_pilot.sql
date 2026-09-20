-- Proposed two-room plan; existing physical identities + one pinned furniture
-- drawing. Never modifies accepted building state, furniture geometry or stock.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.valid_room_layout_parameters(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; n numeric;
begin
  if p is null or jsonb_typeof(p)<>'object'
    or (select count(*) from jsonb_object_keys(p))<>11
    or p-array['generator','version','span_mm','depth_mm','wall_thickness_mm','left_width_mm','furniture_room','anchor','gap_mm','offset_mm','rotation']::text[]<>'{}'::jsonb
    or p->>'generator' is distinct from 'room_pair_v1' or p->'version' is distinct from '1'::jsonb
    or coalesce(p->>'furniture_room','')<>all(array['left','right'])
    or coalesce(p->>'anchor','')<>all(array['shared_wall','outer_wall'])
    or p->'rotation' is null or p->'rotation'<>all(array['0'::jsonb,'90'::jsonb]) then return false; end if;
  foreach k in array array['span_mm','depth_mm','wall_thickness_mm','left_width_mm','gap_mm','offset_mm'] loop
    if jsonb_typeof(p->k) is distinct from 'number' then return false; end if;
    n:=(p->>k)::numeric;
    if n>50000 or n<0 or (k<>all(array['gap_mm','offset_mm']) and n=0) or trunc(n*1000)<>n*1000 then return false; end if;
  end loop;
  return (p->>'span_mm')::numeric > (p->>'left_width_mm')::numeric + (p->>'wall_thickness_mm')::numeric;
end $$;
revoke all on function bob_private.valid_room_layout_parameters(jsonb) from public,anon;
grant execute on function bob_private.valid_room_layout_parameters(jsonb) to authenticated;

create table bob.artifact_room_layouts (
  project_id text not null references bob.projects(id) on delete cascade,
  artifact_id uuid not null,
  artifact_revision integer not null,
  building_id uuid not null references bob.buildings(id),
  left_space_id uuid not null,
  left_space_revision integer not null,
  right_space_id uuid not null,
  right_space_revision integer not null,
  wall_element_id uuid not null,
  wall_element_revision integer not null,
  furniture_artifact_id uuid not null,
  furniture_revision integer not null,
  instance_id uuid not null,
  parameters jsonb not null check(bob_private.valid_room_layout_parameters(parameters)),
  primary key(artifact_id,artifact_revision),
  check(left_space_id<>right_space_id and furniture_artifact_id<>artifact_id),
  foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
  foreign key(artifact_id,artifact_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade,
  foreign key(left_space_id,building_id) references bob.building_spaces(id,building_id),
  foreign key(right_space_id,building_id) references bob.building_spaces(id,building_id),
  foreign key(wall_element_id,building_id) references bob.building_elements(id,building_id),
  foreign key(left_space_id,left_space_revision) references bob.space_revisions(space_id,revision),
  foreign key(right_space_id,right_space_revision) references bob.space_revisions(space_id,revision),
  foreign key(wall_element_id,wall_element_revision) references bob.element_revisions(element_id,revision),
  foreign key(furniture_artifact_id,project_id) references bob.artifacts(id,project_id) deferrable initially deferred,
  foreign key(furniture_artifact_id,furniture_revision) references bob.artifact_parametric_recipes(artifact_id,artifact_revision) deferrable initially deferred
);
create index room_layout_project_idx on bob.artifact_room_layouts(project_id);
create index room_layout_building_idx on bob.artifact_room_layouts(building_id);
create index room_layout_left_idx on bob.artifact_room_layouts(left_space_id,left_space_revision);
create index room_layout_right_idx on bob.artifact_room_layouts(right_space_id,right_space_revision);
create index room_layout_wall_idx on bob.artifact_room_layouts(wall_element_id,wall_element_revision);
create index room_layout_furniture_idx on bob.artifact_room_layouts(furniture_artifact_id,furniture_revision);
-- Composite parent indexes also cover the same-project/same-building FK checks.
create index room_layout_parent_idx on bob.artifact_room_layouts(artifact_id,project_id);
create index room_layout_left_building_idx on bob.artifact_room_layouts(left_space_id,building_id);
create index room_layout_right_building_idx on bob.artifact_room_layouts(right_space_id,building_id);
create index room_layout_wall_building_idx on bob.artifact_room_layouts(wall_element_id,building_id);
create index room_layout_furniture_project_idx on bob.artifact_room_layouts(furniture_artifact_id,project_id);
alter table bob.artifact_room_layouts enable row level security;
revoke all on bob.artifact_room_layouts from public,anon,authenticated;
grant select on bob.artifact_room_layouts to authenticated;
create policy project_read on bob.artifact_room_layouts for select to authenticated using(bob_private.has_project_access(project_id));

create function bob_private.carry_room_layout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into bob.artifact_room_layouts
    select p.project_id,p.artifact_id,new.revision,p.building_id,p.left_space_id,p.left_space_revision,
      p.right_space_id,p.right_space_revision,p.wall_element_id,p.wall_element_revision,
      p.furniture_artifact_id,p.furniture_revision,p.instance_id,p.parameters
    from bob.artifact_room_layouts p where p.artifact_id=new.artifact_id and p.artifact_revision=new.revision-1;
  return new;
end $$;
revoke all on function bob_private.carry_room_layout() from public,anon,authenticated;
create trigger carry_room_layout after insert on bob.artifact_revisions for each row execute function bob_private.carry_room_layout();

create or replace function bob_private.check_single_artifact_recipe() returns trigger
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  select (exists(select 1 from bob.artifact_parametric_recipes where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
    +(exists(select 1 from bob.artifact_generations where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int
    +(exists(select 1 from bob.artifact_room_layouts where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision))::int into n;
  if n>1 then raise exception 'A drawing revision cannot have two geometry recipes'; end if;
  return null;
end $$;
create constraint trigger room_layout_exclusive after insert or update on bob.artifact_room_layouts
  deferrable initially deferred for each row execute function bob_private.check_single_artifact_recipe();

-- A small flag remains visible even when a linked source can no longer be read.
-- The client must report unavailable geometry, never fall back to a manual image.
create or replace view bob.artifact_revision_details with(security_invoker=true) as
  select r.*,g.generator,g.generator_version,(l.artifact_id is not null) as has_room_layout
  from bob.artifact_revisions r left join bob.artifact_generations g on g.artifact_id=r.artifact_id and g.artifact_revision=r.revision
  left join bob.artifact_room_layouts l on l.artifact_id=r.artifact_id and l.artifact_revision=r.revision;
create or replace view bob.current_artifacts with(security_invoker=true) as
  select h.id,h.area_id,r.*,g.generator,g.generator_version,(l.artifact_id is not null) as has_room_layout
  from bob.artifacts h join bob.artifact_revisions r on r.artifact_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id
  left join bob.artifact_generations g on g.artifact_id=r.artifact_id and g.artifact_revision=r.revision
  left join bob.artifact_room_layouts l on l.artifact_id=r.artifact_id and l.artifact_revision=r.revision;

create view bob.artifact_room_layout_details with(security_invoker=true) as
select l.*,lp.name as left_name,rp.name as right_name,wp.name as wall_name,fr.title as furniture_title,
  fa.area_id as furniture_area_id,fp.recipe as furniture_recipe,
  lh.accepted_revision as current_left_revision,rh.accepted_revision as current_right_revision,
  wh.accepted_revision as current_wall_revision,fa.current_revision as current_furniture_revision,
  fc.archived as furniture_archived,(lc.archived or rc.archived or wc.archived) as physical_archived,
  (lh.latest_revision<>lh.accepted_revision or rh.latest_revision<>rh.accepted_revision or wh.latest_revision<>wh.accepted_revision) as physical_pending,
  (exists(select 1 from bob.project_spaces where project_id=l.project_id and id=l.left_space_id)
    and exists(select 1 from bob.project_spaces where project_id=l.project_id and id=l.right_space_id)
    and exists(select 1 from bob.project_elements where project_id=l.project_id and id=l.wall_element_id)) as context_available
from bob.artifact_room_layouts l
join bob.space_revisions lp on lp.space_id=l.left_space_id and lp.revision=l.left_space_revision
join bob.space_revisions rp on rp.space_id=l.right_space_id and rp.revision=l.right_space_revision
join bob.element_revisions wp on wp.element_id=l.wall_element_id and wp.revision=l.wall_element_revision
join bob.building_spaces lh on lh.id=l.left_space_id
join bob.building_spaces rh on rh.id=l.right_space_id
join bob.building_elements wh on wh.id=l.wall_element_id
join bob.space_revisions lc on lc.space_id=lh.id and lc.revision=lh.accepted_revision
join bob.space_revisions rc on rc.space_id=rh.id and rc.revision=rh.accepted_revision
join bob.element_revisions wc on wc.element_id=wh.id and wc.revision=wh.accepted_revision
join bob.artifact_parametric_recipes fp on fp.artifact_id=l.furniture_artifact_id and fp.artifact_revision=l.furniture_revision and fp.project_id=l.project_id
join bob.artifact_revisions fr on fr.artifact_id=l.furniture_artifact_id and fr.revision=l.furniture_revision
join bob.artifacts fa on fa.id=l.furniture_artifact_id and fa.project_id=l.project_id
join bob.artifact_revisions fc on fc.artifact_id=fa.id and fc.revision=fa.current_revision
where exists(select 1 from bob.project_buildings b where b.project_id=l.project_id and b.id=l.building_id and not b.archived)
  and exists(select 1 from bob.project_spaces s where s.project_id=l.project_id and s.id=l.left_space_id)
  and exists(select 1 from bob.project_spaces s where s.project_id=l.project_id and s.id=l.right_space_id)
  and exists(select 1 from bob.project_elements e where e.project_id=l.project_id and e.id=l.wall_element_id);
revoke all on bob.artifact_room_layout_details from public,anon,authenticated;
grant select on bob.artifact_room_layout_details to authenticated;

create function bob_private.artifact_room_layout_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l bob.artifact_room_layouts; r bob.artifact_revisions; saved jsonb; body jsonb; allowed text[]; refs jsonb;
  ls bob.space_revisions; rs bob.space_revisions; wall bob.element_revisions; cur integer; m jsonb;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action is null or p_action<>all(array['create','move_wall','place_furniture','refresh_sources'])
    or p_artifact is null or p_expected is null or p_data is null or jsonb_typeof(p_data)<>'object'
    or octet_length(p_data::text)>24000 then raise exception 'invalid_room_layout' using errcode='22023'; end if;
  perform 1 from bob.projects where id=p_project for no key update;
  allowed:=array['target_revision','change_note'] || case p_action
    when 'create' then array['title','description','assumptions','area_id','building_id','left_space_id','left_space_revision','right_space_id','right_space_revision','wall_element_id','wall_element_revision','furniture_artifact_id','furniture_revision','parameters','measurements']
    when 'move_wall' then array['left_width_mm']
    when 'place_furniture' then array['furniture_room','anchor','gap_mm','offset_mm','rotation']
    else array['left_space_revision','right_space_revision','wall_element_revision','furniture_revision','measurements'] end;
  if p_data-allowed<>'{}'::jsonb or jsonb_typeof(p_data->'change_note') is distinct from 'string'
    or coalesce(length(btrim(p_data->>'change_note')),0) not between 1 and 1000 then raise exception 'Unsupported room layout fields' using errcode='22023'; end if;
  if p_action='create' then
    if p_expected<>0 then raise exception 'New drawings start at revision zero' using errcode='40001'; end if;
    l.project_id:=p_project;l.artifact_id:=p_artifact;l.instance_id:=gen_random_uuid();
    l.building_id:=(p_data->>'building_id')::uuid;
    l.left_space_id:=(p_data->>'left_space_id')::uuid;l.left_space_revision:=(p_data->>'left_space_revision')::integer;
    l.right_space_id:=(p_data->>'right_space_id')::uuid;l.right_space_revision:=(p_data->>'right_space_revision')::integer;
    l.wall_element_id:=(p_data->>'wall_element_id')::uuid;l.wall_element_revision:=(p_data->>'wall_element_revision')::integer;
    l.furniture_artifact_id:=(p_data->>'furniture_artifact_id')::uuid;l.furniture_revision:=(p_data->>'furniture_revision')::integer;
    l.parameters:=p_data->'parameters';refs:=coalesce(p_data->'measurements','[]'::jsonb);
    body:=jsonb_build_object('title',p_data->'title','description',p_data->'description','assumptions',p_data->'assumptions','area_id',p_data->'area_id');
  else
    select p.* into l from bob.artifact_room_layouts p join bob.artifacts a on a.id=p.artifact_id and a.current_revision=p.artifact_revision
      where p.project_id=p_project and p.artifact_id=p_artifact;
    if not found then raise exception 'Room layout unavailable' using errcode='42501'; end if;
    if l.artifact_revision<>p_expected then raise exception 'Drawing changed. Reload before saving.' using errcode='40001'; end if;
    select * into r from bob.artifact_revisions where artifact_id=p_artifact and revision=p_expected;
    if p_action<>'refresh_sources' and r.target_revision is distinct from (p_data->>'target_revision')::integer then
      raise exception 'Target changed. Explicitly refresh the drawing sources first.' using errcode='40001'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',measurement_id,'revision',measurement_revision) order by measurement_id),'[]'::jsonb)
      into refs from bob.artifact_measurements where artifact_id=p_artifact and artifact_revision=p_expected;
    body:=jsonb_build_object('title',r.title,'description',r.description,'assumptions',r.assumptions,'change_note',p_data->'change_note');
    if p_action='move_wall' then l.parameters:=jsonb_set(l.parameters,'{left_width_mm}',coalesce(p_data->'left_width_mm','null'::jsonb));
    elsif p_action='place_furniture' then
      l.parameters:=l.parameters||jsonb_build_object('furniture_room',p_data->'furniture_room','anchor',p_data->'anchor',
        'gap_mm',p_data->'gap_mm','offset_mm',p_data->'offset_mm','rotation',p_data->'rotation');
    else
      l.left_space_revision:=(p_data->>'left_space_revision')::integer;l.right_space_revision:=(p_data->>'right_space_revision')::integer;
      l.wall_element_revision:=(p_data->>'wall_element_revision')::integer;l.furniture_revision:=(p_data->>'furniture_revision')::integer;
      -- Source refresh cannot quietly discard evidence identities.
      if jsonb_typeof(p_data->'measurements') is distinct from 'array'
        or exists(select 1 from jsonb_array_elements(refs) oldref where not exists(select 1 from jsonb_array_elements(p_data->'measurements') n where n->>'id'=oldref->>'id')) then
        raise exception 'Preserve linked measurements when refreshing sources' using errcode='22023'; end if;
      refs:=p_data->'measurements';
    end if;
  end if;
  if not bob_private.valid_room_layout_parameters(l.parameters) or l.left_space_id=l.right_space_id
    or l.furniture_artifact_id=p_artifact then raise exception 'Invalid room layout geometry or identity' using errcode='22023'; end if;
  -- Explicit project context, not the caller's access to some other building.
  if not exists(select 1 from bob.project_buildings where project_id=p_project and id=l.building_id and not archived)
    or not exists(select 1 from bob.project_spaces where project_id=p_project and building_id=l.building_id and id=l.left_space_id)
    or not exists(select 1 from bob.project_spaces where project_id=p_project and building_id=l.building_id and id=l.right_space_id)
    or not exists(select 1 from bob.project_elements where project_id=p_project and building_id=l.building_id and id=l.wall_element_id) then
    raise exception 'project_denied' using errcode='42501'; end if;
  -- Hold the exact dependencies stable through commit. Artifact writes serialize
  -- on the same project row; physical edits lock their own identity rows.
  perform 1 from bob.building_spaces where id in(l.left_space_id,l.right_space_id) order by id for share;
  perform 1 from bob.building_elements where id=l.wall_element_id for share;
  select sr.* into ls from bob.space_revisions sr join bob.building_spaces h on h.id=sr.space_id and h.accepted_revision=sr.revision where h.id=l.left_space_id;
  select sr.* into rs from bob.space_revisions sr join bob.building_spaces h on h.id=sr.space_id and h.accepted_revision=sr.revision where h.id=l.right_space_id;
  select er.* into wall from bob.element_revisions er join bob.building_elements h on h.id=er.element_id and h.accepted_revision=er.revision where h.id=l.wall_element_id;
  if ls.revision is distinct from l.left_space_revision or rs.revision is distinct from l.right_space_revision
    or wall.revision is distinct from l.wall_element_revision or ls.archived or rs.archived or wall.archived then
    raise exception 'Physical sources changed. Read and explicitly refresh the drawing sources.' using errcode='40001'; end if;
  if lower(wall.kind)<>'wall' or (wall.space_id is not null and wall.space_id<>all(array[l.left_space_id,l.right_space_id]))
    or (ls.level_id is not null and rs.level_id is not null and ls.level_id<>rs.level_id) then
    raise exception 'Use one wall and two rooms on the same level' using errcode='22023'; end if;
  select a.current_revision into cur from bob.artifacts a join bob.artifact_revisions ar on ar.artifact_id=a.id and ar.revision=a.current_revision
    join bob.artifact_parametric_recipes p on p.artifact_id=a.id and p.artifact_revision=a.current_revision
    where a.project_id=p_project and a.id=l.furniture_artifact_id and not ar.archived;
  if cur is null then raise exception 'Furniture drawing unavailable in this project' using errcode='42501'; end if;
  if cur is distinct from l.furniture_revision then raise exception 'Furniture drawing changed. Read and explicitly refresh the drawing sources.' using errcode='40001'; end if;
  if jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs)>20 then raise exception 'Invalid measurement links' using errcode='22023'; end if;
  for m in select * from jsonb_array_elements(refs) loop
    perform 1 from bob.measurements where id=(m->>'id')::uuid and project_id=p_project and current_revision=(m->>'revision')::integer for share;
    if not found then raise exception 'Measurement sources changed or unavailable' using errcode='40001'; end if;
  end loop;
  body:=body||jsonb_build_object('kind','plan','status','concept','source_media_id',null,'target_revision',p_data->'target_revision','measurements',refs);
  saved:=bob_private.artifact_command(p_project,case when p_action='create' then 'create' else 'revise' end,p_artifact,p_expected,body);
  l.artifact_revision:=(saved->>'revision')::integer;
  delete from bob.artifact_room_layouts where artifact_id=p_artifact and artifact_revision=l.artifact_revision;
  insert into bob.artifact_room_layouts select l.*;
  return saved;
end $$;
create function bob.artifact_room_layout_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.artifact_room_layout_command(p_project,p_action,p_artifact,p_expected,p_data)
$$;
revoke all on function bob_private.artifact_room_layout_command(text,text,uuid,integer,jsonb),bob.artifact_room_layout_command(text,text,uuid,integer,jsonb) from public,anon;
grant execute on function bob_private.artifact_room_layout_command(text,text,uuid,integer,jsonb),bob.artifact_room_layout_command(text,text,uuid,integer,jsonb) to authenticated;

-- Caller-RLS research. Older RPCs remain available during staged deployment.
create function bob.search_bob_project_data_v4(p_project_id text,p_dataset text,p_query text default null,p_status text default null,
  p_area_id text default null,p_record_id text default null,p_after_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; rows jsonb; links jsonb; n integer;
begin
  if not bob_private.has_project_access(p_project_id) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_dataset=any(array['physical_spaces','physical_elements']) then
    if p_status is not null or p_area_id is not null or length(coalesce(p_query,''))>200
      or length(coalesce(p_record_id,''))>200 or length(coalesce(p_after_id,''))>200 then raise exception 'invalid_lookup' using errcode='22023'; end if;
    if p_dataset='physical_spaces' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into rows from (
        select s.id,jsonb_build_object('id',s.id,'building_id',s.building_id,'revision',s.revision,'name',s.name,'kind',s.kind,'level_id',s.level_id,
          'truth',s.truth,'source',s.source,'notes',s.notes,'archived',s.archived,'has_proposal',s.has_proposal) item
        from bob.project_spaces s where s.project_id=p_project_id
          and (p_record_id is null or s.id::text=p_record_id) and (p_after_id is null or s.id::text>p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',s.name,s.kind,s.notes)))>0)
        order by s.id limit 26) bounded;
    else
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into rows from (
        select e.id,jsonb_build_object('id',e.id,'building_id',e.building_id,'revision',e.revision,'name',e.name,'kind',e.kind,'space_id',e.space_id,
          'truth',e.truth,'source',e.source,'description',e.description,'archived',e.archived,'has_proposal',e.has_proposal) item
        from bob.project_elements e where e.project_id=p_project_id
          and (p_record_id is null or e.id::text=p_record_id) and (p_after_id is null or e.id::text>p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',e.name,e.kind,e.description)))>0)
        order by e.id limit 26) bounded;
    end if;
    n:=jsonb_array_length(rows);
    if n>25 then rows:=rows-25; end if;
    result:=jsonb_build_object('records',rows,'related','[]'::jsonb,'truncated',n>25,'next_cursor',case when n>25 then rows->-1->>'id' else null end);
  else
    result:=bob.search_bob_project_data_v3(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
    if p_dataset<>'artifacts' then return result; end if;
    select coalesce(jsonb_agg(item.value||jsonb_build_object('has_room_layout',a.has_room_layout,'room_layout',to_jsonb(l)) order by item.ord),'[]'::jsonb)
      into rows from jsonb_array_elements(result->'records') with ordinality item(value,ord)
      join bob.artifact_revision_details a on a.project_id=p_project_id and a.artifact_id::text=item.value->>'id' and a.revision=(item.value->>'revision')::integer
      left join bob.artifact_room_layout_details l on l.project_id=p_project_id and l.artifact_id=a.artifact_id and l.artifact_revision=a.revision;
    result:=jsonb_set(result,'{records}',rows);
  end if;
  while octet_length(result::text)>30000 loop
    n:=jsonb_array_length(result->'records');
    if n=0 then raise exception 'Research result too large' using errcode='22023'; end if;
    rows:=(result->'records')-(n-1);
    select coalesce(jsonb_agg(value),'[]'::jsonb) into links from jsonb_array_elements(result->'related')
      where value->>'parent_id' in(select r->>'id' from jsonb_array_elements(rows) r);
    result:=result||jsonb_build_object('records',rows,'related',links,'truncated',true,'next_cursor',rows->-1->>'id');
  end loop;
  return result;
end $$;
revoke all on function bob.search_bob_project_data_v4(text,text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data_v4(text,text,text,text,text,text,text) to authenticated;

create function bob_private.bob_project_write_v3(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; rid uuid; prior jsonb; record jsonb; result jsonb; message text; quote text; action text;
  key text; existing bob_private.bob_write_receipts; expected integer; creating boolean;
begin
  if p_payload->>'kind' is distinct from 'room_layout' then
    return bob_private.bob_project_write_v2(p_project,p_thread,p_turn,p_generation,p_payload);
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
  key:='room-layout:'||coalesce(p_payload->>'record_id',concat_ws(':','new',d->>'area_id',lower(btrim(d->>'title'))));
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
    select to_jsonb(p) into prior from bob.artifact_room_layouts p join bob.artifacts a on a.id=p.artifact_id and a.current_revision=p.artifact_revision
      where p.project_id=p_project and p.artifact_id=rid;
    if not found then raise exception 'project_denied' using errcode='42501'; end if;
  end if;
  perform bob_private.artifact_room_layout_command(p_project,action,rid,expected,d-'action');
  select jsonb_build_object('id',a.id,'title',a.title,'area_id',a.area_id,'revision',a.revision,'status',a.status,
    'target_revision',a.target_revision,'solution_id',a.solution_id,'solution_revision',a.solution_revision,'room_layout',to_jsonb(l)) into record
    from bob.current_artifacts a join bob.artifact_room_layout_details l on l.project_id=a.project_id and l.artifact_id=a.id and l.artifact_revision=a.revision
    where a.project_id=p_project and a.id=rid;
  if record is null then raise exception 'write_readback_failed'; end if;
  result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',rid,'label',record->>'title',
    'operation',case when creating then 'created' else 'updated' end,'savedAt',clock_timestamp(),
    'revision',(record->>'revision')::integer,'areaId',record->'area_id','record',record);
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,key,p_payload,prior,result);
  return result;
end $$;
create function bob.bob_project_write_v3(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.bob_project_write_v3(p_project,p_thread,p_turn,p_generation,p_payload)
$$;
revoke all on function bob_private.bob_project_write_v3(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v3(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v3(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v3(text,uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
