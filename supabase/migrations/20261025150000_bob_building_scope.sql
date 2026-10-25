-- Bob building scope (owner decisions 2026-10-25). In a claimed turn Bob can
-- find the caller's own Buildings, link or unlink one whole Building, mark the
-- rooms the project covers and map Areas to rooms or the whole Building.
--  * Reads list only Buildings the caller can edit plus Buildings this project
--    already targets (Building, Site or room rows); never a Building reachable
--    only through another project. Archived Buildings, rooms and Areas are left out.
--  * Every change goes through the unchanged bob_private.physical_scope_command,
--    which owns authority: a whole-building link needs can_edit_building; room
--    marks and Area mappings need project access plus the whole-building link.
--  * A whole-building unlink is refused while the project's Site link covers the
--    Building or the project follows it for household sharing.
-- Apply after 20261025133000_project_room_scope.sql. Deploy ask-bob and
-- bob-worker from the same source, then activate the separate catalog publication.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $building_scope_guard$ begin
 if to_regprocedure('bob_private.project_targets_whole_building(text,uuid)') is null then
  raise exception 'Apply 20261025133000_project_room_scope.sql before the building scope writer';
 end if;
end $building_scope_guard$;

-- One complete caller-scoped record, or null when it is not offered. The result
-- does not depend on row security: every name comes from a Building the caller
-- may already read, so the writer can compare pins with the same function.
create function bob.read_bob_building_scope_snapshot(p_project text,p_resource text,p_id text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare label text; bid uuid; site uuid; bname text; whole boolean; via_site boolean; rec jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_resource is null or p_resource not in ('buildings','rooms','areas') or p_id is null or length(p_id)>200 then raise exception 'invalid_building_scope_resource' using errcode='22023';end if;
 select name into label from bob.projects where id=p_project;
 if p_resource='areas' then
  select jsonb_build_object('id',a.id,'name',a.name,'targets',coalesce((
    select jsonb_agg(jsonb_build_object('target_kind',t.target_kind,'building_id',t.building_id,'space_id',t.space_id,'element_id',t.element_id,
      'building_name',case when bob_private.has_building_access(t.building_id) then (select b.name from bob.current_buildings b where b.id=t.building_id) end,
      'space_name',case when t.space_id is not null and bob_private.has_building_access(t.building_id) then (select s.name from bob.current_spaces s where s.id=t.space_id) end)
      order by t.target_kind,t.building_id,t.space_id,t.element_id,t.id)
    from bob.area_physical_targets t where t.project_id=p_project and t.area_id=a.id),'[]'::jsonb)) into rec
  from bob.areas a where a.project_id=p_project and a.id=p_id and a.archived_at is null;
 else
  if p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null;end if;
  bid:=case when p_resource='buildings' then p_id::uuid else (select s.building_id from bob.building_spaces s where s.id=p_id::uuid) end;
  select b.site_id,b.name into site,bname from bob.current_buildings b where b.id=bid and not b.archived;
  if bname is null then return null;end if;
  whole:=exists(select 1 from bob.project_physical_scope s where s.project_id=p_project and s.target_kind='building' and s.building_id=bid);
  via_site:=site is not null and exists(select 1 from bob.project_physical_scope s where s.project_id=p_project and s.target_kind='site' and s.site_id=site);
  if not whole and not via_site and not bob_private.can_edit_building(bid)
   and not exists(select 1 from bob.project_physical_scope s where s.project_id=p_project and s.building_id=bid) then return null;end if;
  if p_resource='buildings' then
   rec:=jsonb_build_object('id',bid,'name',bname,
    'link',case when whole then 'whole' when via_site then 'site'
     when exists(select 1 from bob.project_physical_scope s where s.project_id=p_project and s.building_id=bid) then 'rooms_only' else 'none' end,
    'site_link',via_site,'can_edit',bob_private.can_edit_building(bid),
    'household_follow',exists(select 1 from bob.project_household_shares h where h.project_id=p_project and h.building_id=bid),
    'marked_rooms',(select count(distinct s.space_id) from bob.project_physical_scope s where s.project_id=p_project and s.target_kind='space' and s.building_id=bid),
    'marked_elements',(select count(distinct s.element_id) from bob.project_physical_scope s where s.project_id=p_project and s.target_kind='element' and s.building_id=bid),
    'area_targets',(select count(*) from bob.area_physical_targets t where t.project_id=p_project and t.building_id=bid));
  else
   select jsonb_build_object('id',sp.id,'building_id',sp.building_id,'name',sp.name,'kind',sp.kind,'level',lv.name,
     'marked',exists(select 1 from bob.project_physical_scope s where s.project_id=p_project and s.target_kind='space' and s.space_id=sp.id),
     'area_targets',coalesce((select jsonb_agg(distinct jsonb_build_object('area_id',a.id,'area_name',a.name))
       from bob.area_physical_targets t join bob.areas a on a.id=t.area_id
       where t.project_id=p_project and t.target_kind='space' and t.space_id=sp.id),'[]'::jsonb)) into rec
   from bob.current_spaces sp left join bob.current_levels lv on lv.id=sp.level_id
   where sp.id=p_id::uuid and sp.building_id=bid and not sp.archived;
  end if;
 end if;
 if rec is null then return null;end if;
 return jsonb_build_object('project_id',p_project,'resource',p_resource,'key',p_id,'scope_label','Project: '||label,'record',rec);
end $$;
revoke all on function bob.read_bob_building_scope_snapshot(text,text,text) from public,anon,service_role;
grant execute on function bob.read_bob_building_scope_snapshot(text,text,text) to authenticated;

-- Bounded pages: 6 Buildings, 16 rooms of one offered Building or 8 Areas, plus
-- one more snapshot that only signals a further page.
create function bob.read_bob_building_scope_context(p_project text,p_resource text,p_building uuid default null,p_query text default null,p_after text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; size integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_resource is null or p_resource not in ('buildings','rooms','areas') or (p_resource='rooms')<>(p_building is not null)
  or length(p_query)>200 or length(p_after)>200 then raise exception 'invalid_building_scope_context' using errcode='22023';end if;
 size:=case p_resource when 'buildings' then 6 when 'rooms' then 16 else 8 end;
 if p_resource='rooms' and bob.read_bob_building_scope_snapshot(p_project,'buildings',p_building::text) is null then return '[]'::jsonb;end if;
 with candidates as (
  select b.id::text id,b.name label from bob.current_buildings b where p_resource='buildings' and not b.archived
   and (bob_private.can_edit_building(b.id) or exists(select 1 from bob.project_physical_scope s
    where s.project_id=p_project and (s.building_id=b.id or (s.target_kind='site' and s.site_id=b.site_id))))
  union all select s.id::text,s.name from bob.current_spaces s where p_resource='rooms' and s.building_id=p_building and not s.archived
  union all select a.id,a.name from bob.areas a where p_resource='areas' and a.project_id=p_project and a.archived_at is null
 ), page as (
  select id from candidates where (p_query is null or label ilike '%'||p_query||'%') and (p_after is null or id>p_after) order by id limit size+1
 ), snapshots as (
  select id,bob.read_bob_building_scope_snapshot(p_project,p_resource,id) snapshot from page
 ) select coalesce(jsonb_agg(snapshot order by id),'[]'::jsonb) into result from snapshots where snapshot is not null;
 return result;
end $$;
revoke all on function bob.read_bob_building_scope_context(text,text,uuid,text,text) from public,anon,service_role;
grant execute on function bob.read_bob_building_scope_context(text,text,uuid,text,text) to authenticated;

-- Claimed-turn writer. Other kinds delegate unchanged to v20. Pins are the
-- complete reads Bob chose; identities and link rows stay on the server.
create function bob_private.bob_project_write_v21(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; cmd jsonb:=d->'command'; pins jsonb:=d->'pins'; pin jsonb; actual jsonb; building jsonb; area_pin jsonb;
 uuid_re constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 msg text; op text; saved bob_private.bob_write_receipts; bid uuid; act text; area text; spaces uuid[]; sp uuid; row_id uuid; r jsonb; outcome text;
 rooms_removed integer:=0; targets_removed integer:=0; changes jsonb:='[]'::jsonb; current jsonb:='[]'::jsonb; result jsonb;
begin
 if p_payload->>'kind' is distinct from 'bound_building_scope' then return bob_private.bob_project_write_v20(p_project,p_thread,p_turn,p_generation,p_payload);end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'::jsonb
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or octet_length(p_payload::text)>120000
  or p_payload->'expected_updated_at' is distinct from 'null'::jsonb or p_payload->'expected_revision' is distinct from 'null'::jsonb
  or coalesce(length(p_payload->>'request_quote'),0) not between 1 and 500 or msg is null or position(p_payload->>'request_quote' in msg)=0 then
  raise exception 'invalid_bound_building_scope' using errcode='22023';end if;
 if jsonb_typeof(d) is distinct from 'object' or d-array['pins','command']::text[]<>'{}'::jsonb or (select count(*) from jsonb_object_keys(d))<>2
  or jsonb_typeof(pins) is distinct from 'array' or jsonb_typeof(cmd) is distinct from 'object'
  or cmd-array['action','building_id','space_ids','area_id']::text[]<>'{}'::jsonb or (select count(*) from jsonb_object_keys(cmd))<>4 then
  raise exception 'invalid_bound_building_scope' using errcode='22023';end if;
 if coalesce(cmd->>'action','') not in ('link','unlink') or jsonb_typeof(cmd->'building_id') is distinct from 'string' or cmd->>'building_id'!~uuid_re
  or p_payload->'record_id' is distinct from cmd->'building_id' or jsonb_typeof(cmd->'space_ids') is distinct from 'array'
  or jsonb_array_length(cmd->'space_ids')>16 or coalesce(jsonb_typeof(cmd->'area_id'),'') not in ('string','null')
  or coalesce(length(cmd->>'area_id'),1) not between 1 and 200 then
  raise exception 'invalid_bound_building_scope' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(cmd->'space_ids') v where jsonb_typeof(v)<>'string' or v#>>'{}'!~uuid_re)
  or (select count(distinct v) from jsonb_array_elements(cmd->'space_ids') v)<>jsonb_array_length(cmd->'space_ids') then
  raise exception 'invalid_bound_building_scope' using errcode='22023';end if;
 bid:=(cmd->>'building_id')::uuid; act:=cmd->>'action'; area:=cmd->>'area_id';
 select coalesce(array_agg(v::uuid order by v::uuid),'{}') into spaces from jsonb_array_elements_text(cmd->'space_ids') v;
 -- Same per-project lock as physical_scope_command. Household sharing commands
 -- update the project row, so this share lock keeps the follow check current.
 perform pg_advisory_xact_lock(hashtextextended('bob.physical_scope:'||p_project,0));
 perform 1 from bob.projects where id=p_project for key share;
 op:='bound_building_scope:'||jsonb_build_array(act,bid,area,to_jsonb(spaces),md5(pins::text))::text;
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if saved.payload is distinct from p_payload then raise exception 'record_changed' using errcode='PT409';end if;return saved.receipt;end if;
 if not bob_private.bob_turn_unlimited_work(p_project,p_thread,p_turn,p_generation) and (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then
  raise exception 'write_budget_exhausted' using errcode='22023';end if;
 -- Exactly the Building, each room and the Area, each read for this command.
 if jsonb_array_length(pins)<>1+cardinality(spaces)+(case when area is null then 0 else 1 end)
  or (select count(distinct (value->>'resource')||':'||(value->>'key')) from jsonb_array_elements(pins))<>jsonb_array_length(pins) then
  raise exception 'unbound_building_scope' using errcode='22023';end if;
 for pin in select value from jsonb_array_elements(pins) loop
  if jsonb_typeof(pin) is distinct from 'object' or pin->>'project_id' is distinct from p_project or pin->>'key' is null or pin->>'key' is distinct from pin#>>'{record,id}'
   or (pin->>'resource'='buildings' and pin->>'key'=bid::text
    or pin->>'resource'='rooms' and (pin->>'key')=any(spaces::text[]) and pin#>>'{record,building_id}'=bid::text
    or pin->>'resource'='areas' and pin->>'key'=area) is not true then
   raise exception 'unbound_building_scope' using errcode='22023';end if;
  if pin->>'resource'='buildings' then building:=pin;elsif pin->>'resource'='areas' then area_pin:=pin;end if;
 end loop;
 for pin in select value from jsonb_array_elements(pins) loop
  actual:=bob.read_bob_building_scope_snapshot(p_project,pin->>'resource',pin->>'key');
  if actual is null or actual is distinct from pin then raise exception 'record_changed' using errcode='PT409';end if;
 end loop;
 if area is null and cardinality(spaces)=0 then
  if act='link' then
   r:=bob_private.physical_scope_command(p_project,'project','link',gen_random_uuid(),jsonb_build_object('target_kind','building','building_id',bid));
   changes:=jsonb_build_array(jsonb_build_object('target','building','result',case when r?'existing' then 'already_linked' else 'linked' end));
  else
   -- Owner decision: the Site link or household sharing would still depend on
   -- this Building; the owner changes those choices on their own pages.
   if (building#>>'{record,site_link}')::boolean then raise exception 'building_site_covered' using errcode='22023';end if;
   if (building#>>'{record,household_follow}')::boolean then raise exception 'building_household_follow' using errcode='22023';end if;
   outcome:='not_linked';
   for row_id in select s.id from bob.project_physical_scope s where s.project_id=p_project and s.target_kind='building' and s.building_id=bid order by s.id loop
    r:=bob_private.physical_scope_command(p_project,'project','unlink',row_id,'{}'::jsonb);
    rooms_removed:=rooms_removed+coalesce((r->>'removed_rooms')::integer,0);
    targets_removed:=targets_removed+coalesce((r->>'removed_area_targets')::integer,0);
    outcome:='unlinked';
   end loop;
   if outcome='not_linked' then raise exception 'building_not_linked' using errcode='22023';end if;
   changes:=jsonb_build_array(jsonb_build_object('target','building','result',outcome));
  end if;
 elsif cardinality(spaces)=0 then
  if act='link' then
   r:=bob_private.physical_scope_command(p_project,'area','link',gen_random_uuid(),jsonb_build_object('area_id',area,'target_kind','building','building_id',bid));
   outcome:=case when r?'existing' then 'already_mapped' else 'mapped' end;
  else
   outcome:='not_mapped';
   for row_id in select t.id from bob.area_physical_targets t where t.project_id=p_project and t.area_id=area and t.target_kind='building' and t.building_id=bid order by t.id loop
    perform bob_private.physical_scope_command(p_project,'area','unlink',row_id,'{}'::jsonb); outcome:='unmapped';
   end loop;
  end if;
  changes:=jsonb_build_array(jsonb_build_object('target','area_building','result',outcome));
 else
  foreach sp in array spaces loop
   if act='link' then
    r:=bob_private.physical_scope_command(p_project,case when area is null then 'project' else 'area' end,'link',gen_random_uuid(),
      case when area is null then '{}'::jsonb else jsonb_build_object('area_id',area) end||jsonb_build_object('target_kind','space','building_id',bid,'space_id',sp));
    outcome:=case when area is null then case when r?'existing' then 'already_marked' else 'marked' end else case when r?'existing' then 'already_mapped' else 'mapped' end end;
   elsif area is null then
    outcome:='not_marked';
    for row_id in select s.id from bob.project_physical_scope s where s.project_id=p_project and s.target_kind='space' and s.building_id=bid and s.space_id=sp order by s.id loop
     perform bob_private.physical_scope_command(p_project,'project','unlink',row_id,'{}'::jsonb); outcome:='unmarked';
    end loop;
   else
    outcome:='not_mapped';
    for row_id in select t.id from bob.area_physical_targets t where t.project_id=p_project and t.area_id=area and t.target_kind='space' and t.building_id=bid and t.space_id=sp order by t.id loop
     perform bob_private.physical_scope_command(p_project,'area','unlink',row_id,'{}'::jsonb); outcome:='unmapped';
    end loop;
   end if;
   changes:=changes||jsonb_build_array(jsonb_build_object('target',case when area is null then 'room' else 'area_room' end,'result',outcome,
     'name',(select value#>>'{record,name}' from jsonb_array_elements(pins) where value->>'resource'='rooms' and value->>'key'=sp::text)));
  end loop;
 end if;
 -- Fresh reads of the same records, so the next change can bind without rereading.
 for pin in select value from jsonb_array_elements(pins) loop
  actual:=bob.read_bob_building_scope_snapshot(p_project,pin->>'resource',pin->>'key');
  if actual is not null then current:=current||jsonb_build_array(actual);end if;
 end loop;
 result:=jsonb_build_object('projectId',p_project,'dataset','building_context','recordId',bid,'label',building#>>'{record,name}','operation','updated','savedAt',clock_timestamp(),
  'record',jsonb_build_object('id',bid,'action',act,'area',area_pin#>>'{record,name}','changes',changes,
   'removed_rooms',rooms_removed,'removed_area_targets',targets_removed,'current',current));
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
  values(p_project,auth.uid(),p_turn,op,p_payload,jsonb_build_object('pins',pins),result);
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v21(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v21(text,uuid,uuid,bigint,jsonb) to authenticated;

-- Public adapter: an aborted serialization or deadlock returns once as PT409
-- so Bob rereads instead of PostgREST retrying stale pins.
create function bob.bob_project_write_v21(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return bob_private.bob_project_write_v21(p_project,p_thread,p_turn,p_generation,p_payload);
exception when serialization_failure or deadlock_detected then
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;
revoke all on function bob.bob_project_write_v21(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.bob_project_write_v21(text,uuid,uuid,bigint,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
