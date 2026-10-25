-- Project rooms and Area rooms inside a linked building (owner decision 2026-10-25).
--
-- A project links to a whole Building (or the Site that holds it) and then marks
-- which rooms it covers; an Area can be mapped to rooms of that building.
--  * Linking a Building still requires the caller to edit that Building: it
--    shares the whole Building with every project member.
--  * Marking a room/element or mapping an Area inside a Building the project
--    already targets as a whole needs project access only. It grants no new read
--    access, because the whole-building link already does.
--  * A room/element mark or Area mapping needs that whole-building link.
--  * Unlinking the whole Building (or its Site) also removes this project's room
--    marks and Area mappings for every Building no longer covered.
--  * Repeating a link returns the existing row instead of a duplicate.
-- Existing rows are kept unchanged, including older room-only links.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.project_targets_whole_building(p_project text,p_building uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from bob.project_physical_scope s join bob.buildings b on b.id=p_building
    where s.project_id=p_project
      and ((s.target_kind='building' and s.building_id=p_building) or (s.target_kind='site' and s.site_id=b.site_id)))
$$;
revoke all on function bob_private.project_targets_whole_building(text,uuid) from public,anon,authenticated,service_role;

create or replace function bob_private.physical_scope_command(
  p_project text,p_kind text,p_action text,p_record uuid,p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); area text; target text; sid uuid; bid uuid; spid uuid; eid uuid;
  existing uuid; removed bob.project_physical_scope; rooms integer:=0; targets integer:=0;
begin
  if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_kind not in ('project','area') or p_action not in ('link','unlink') or p_record is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid physical scope command'; end if;
  -- One scope change per project at a time, so an unlink cleanup and a new
  -- room mark cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('bob.physical_scope:'||p_project,0));
  if p_action='unlink' then
    if p_kind='area' then
      delete from bob.area_physical_targets where id=p_record and project_id=p_project;
      return jsonb_build_object('id',p_record,'removed',true);
    end if;
    delete from bob.project_physical_scope where id=p_record and project_id=p_project returning * into removed;
    if removed.target_kind in ('building','site') then
      with lost as (
        select b.id from bob.buildings b
        where ((removed.target_kind='building' and b.id=removed.building_id) or (removed.target_kind='site' and b.site_id=removed.site_id))
          and not bob_private.project_targets_whole_building(p_project,b.id)
      ), gone as (
        delete from bob.project_physical_scope s using lost
        where s.project_id=p_project and s.target_kind in ('space','element') and s.building_id=lost.id returning 1
      ) select count(*) into rooms from gone;
      with lost as (
        select b.id from bob.buildings b
        where ((removed.target_kind='building' and b.id=removed.building_id) or (removed.target_kind='site' and b.site_id=removed.site_id))
          and not bob_private.project_targets_whole_building(p_project,b.id)
      ), gone as (
        delete from bob.area_physical_targets t using lost
        where t.project_id=p_project and t.building_id=lost.id returning 1
      ) select count(*) into targets from gone;
    end if;
    return jsonb_build_object('id',p_record,'removed',true,'removed_rooms',rooms,'removed_area_targets',targets);
  end if;
  target:=p_data->>'target_kind';sid:=nullif(p_data->>'site_id','')::uuid;bid:=nullif(p_data->>'building_id','')::uuid;spid:=nullif(p_data->>'space_id','')::uuid;eid:=nullif(p_data->>'element_id','')::uuid;
  if p_kind='area' then
    area:=p_data->>'area_id';
    if target='site' or p_data - array['area_id','target_kind','building_id','space_id','element_id']::text[] <> '{}'::jsonb then raise exception 'Unsupported area target fields'; end if;
    if not exists(select 1 from bob.areas where id=area and project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  elsif p_data - array['target_kind','site_id','building_id','space_id','element_id']::text[] <> '{}'::jsonb then raise exception 'Unsupported scope fields';
  end if;
  if target='site' then
    if sid is null or not bob_private.has_site_access(sid) then raise exception 'site_denied' using errcode='42501'; end if;
  elsif target='building' and p_kind='project' then
    if bid is null or not bob_private.can_edit_building(bid) then raise exception 'building_denied' using errcode='42501'; end if;
  elsif target in ('building','space','element') then
    -- Inside a Building this project already targets as a whole.
    if bid is null or not bob_private.project_targets_whole_building(p_project,bid) then raise exception 'building_not_linked' using errcode='22023'; end if;
    if target='space' and not exists(select 1 from bob.building_spaces where id=spid and building_id=bid) then raise exception 'space_not_in_building' using errcode='22023'; end if;
    if target='element' and not exists(select 1 from bob.building_elements where id=eid and building_id=bid) then raise exception 'element_not_in_building' using errcode='22023'; end if;
  else raise exception 'Invalid physical scope command';
  end if;
  if p_kind='project' then
    select s.id into existing from bob.project_physical_scope s
      where s.project_id=p_project and s.target_kind=target and s.site_id is not distinct from sid and s.building_id is not distinct from bid
        and s.space_id is not distinct from spid and s.element_id is not distinct from eid limit 1;
    if existing is not null then return jsonb_build_object('id',existing,'target_kind',target,'existing',true); end if;
    insert into bob.project_physical_scope(id,project_id,target_kind,site_id,building_id,space_id,element_id,created_by)
      values(p_record,p_project,target,sid,bid,spid,eid,uid);
  else
    select t.id into existing from bob.area_physical_targets t
      where t.area_id=area and t.target_kind=target and t.building_id=bid and t.space_id is not distinct from spid and t.element_id is not distinct from eid limit 1;
    if existing is not null then return jsonb_build_object('id',existing,'target_kind',target,'existing',true); end if;
    insert into bob.area_physical_targets(id,project_id,area_id,target_kind,building_id,space_id,element_id,created_by)
      values(p_record,p_project,area,target,bid,spid,eid,uid);
  end if;
  return jsonb_build_object('id',p_record,'target_kind',target);
end $$;

notify pgrst, 'reload schema';
commit;
