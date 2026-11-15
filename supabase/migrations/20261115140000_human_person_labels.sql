-- Owner report 2026-11-15: inviting someone showed odd automatic names, such
-- as "kock-3fe81acec71b495e" (an app's generated username) for a friend, and
-- every project creator was saved as "Project creator".
-- Root cause: each sharing function picked its own label and fell back to the
-- generated username; create_project never looked up a name at all.
-- Fix: one label for a person, used everywhere Bob names an account:
-- the name in a household both people share, then the chosen display name,
-- then the account email. A generated username is never a name.
-- Existing "Project creator" crew rows get the creator's real label.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function bob_private.person_label(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce(
    (select nullif(btrim(m.display_name),'') from shared.household_access a
       join shared.members m on m.id=a.member_id and m.household_id=a.household_id
      where a.user_id=p_user and a.status='active' and nullif(btrim(m.display_name),'') is not null
        and (auth.uid() is null or auth.uid()=p_user or exists(select 1 from shared.household_access mine
          where mine.household_id=a.household_id and mine.user_id=auth.uid() and mine.status='active'))
      order by a.household_id limit 1),
    (select nullif(btrim(p.display_name),'') from hearth.profiles p where p.user_id=p_user),
    (select nullif(btrim(u.email),'') from auth.users u where u.id=p_user))
$$;
revoke all on function bob_private.person_label(uuid) from public,anon,authenticated;
comment on function bob_private.person_label(uuid) is
  'One human label for an account: shared-household member name, then chosen display name, then account email. Never a generated username.';

CREATE OR REPLACE FUNCTION bob_private.ensure_project_person(p_project text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); person bob.people; label text;
begin
  if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project || uid::text,27));
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select * into person from bob.people where project_id=p_project and auth_user_id=uid;
  if found then return to_jsonb(person); end if;
  select m.display_name into label from shared.household_access a
    join shared.members m on m.id=a.member_id and m.household_id=a.household_id
    join bob.project_household_shares s on s.project_id=p_project
    left join bob.building_household_shares b on b.building_id=s.building_id
    where a.user_id=uid and a.status='active' and a.household_id=coalesce(s.household_id,b.household_id)
    order by a.household_id limit 1;
  label:=coalesce(nullif(btrim(label),''),bob_private.person_label(uid),'Project member');
  insert into bob.people(id,project_id,name,initials,role,auth_user_id,access_origin)
    values('m_'||replace(gen_random_uuid()::text,'-',''),p_project,left(label,200),upper(left(label,2)),'Volunteer',uid,'derived') returning * into person;
  return to_jsonb(person);
end $function$
;

CREATE OR REPLACE FUNCTION bob_private.invite_project_friend(p_project text, p_friend uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); invitation bob.project_friend_invitations;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_friend is null or p_friend=uid then raise exception 'Invalid friend invitation' using errcode='22023'; end if;
  if not exists(select 1 from hearth.friendships f where f.status='accepted'
    and ((f.user_id=uid and f.friend_user_id=p_friend) or (f.user_id=p_friend and f.friend_user_id=uid))) then
    raise exception 'accepted_friend_required' using errcode='42501'; end if;
  insert into bob.project_friend_invitations(project_id,inviter_id,invitee_id) values(p_project,uid,p_friend)
    on conflict(project_id,invitee_id) where status in ('pending','accepted') do nothing returning * into invitation;
  if not found then select * into invitation from bob.project_friend_invitations where project_id=p_project and invitee_id=p_friend and status in ('pending','accepted'); end if;
  return jsonb_build_object('id',invitation.id,'inviteeId',invitation.invitee_id,'name',coalesce(bob_private.person_label(p_friend),'Friend'),'status',invitation.status);
end $function$
;

CREATE OR REPLACE FUNCTION bob_private.project_invitations()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'projectId',i.project_id,'projectName',p.name,
    'inviterName',coalesce(bob_private.person_label(i.inviter_id),'Project member'),'status',i.status) order by i.created_at,i.id),'[]'::jsonb)
    into result from bob.project_friend_invitations i join bob.projects p on p.id=i.project_id
    where i.invitee_id=auth.uid() and i.status='pending'
      and bob_private.project_access_for_user(i.project_id,i.inviter_id)
      and exists(select 1 from hearth.friendships f where f.status='accepted'
        and ((f.user_id=auth.uid() and f.friend_user_id=i.inviter_id) or (f.friend_user_id=auth.uid() and f.user_id=i.inviter_id)));
  return result;
end $function$
;

CREATE OR REPLACE FUNCTION bob_private.project_sharing_state(p_project text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s bob.project_household_shares; buildings jsonb; invitations jsonb;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select * into s from bob.project_household_shares where project_id=p_project;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',r.name,'householdId',h.household_id,'householdName',hh.name) order by r.name,b.id),'[]'::jsonb)
    into buildings from bob.buildings b join bob.building_revisions r on r.building_id=b.id and r.revision=b.current_revision
    join bob.building_household_shares h on h.building_id=b.id join shared.households hh on hh.id=h.household_id
    where bob_private.project_exactly_links_building(p_project,b.id) and exists(
      select 1 from shared.household_access a where a.household_id=h.household_id and a.user_id=auth.uid() and a.status='active');
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'inviteeId',i.invitee_id,
    'name',coalesce(bob_private.person_label(i.invitee_id),'Friend'),'status',i.status) order by i.created_at,i.id),'[]'::jsonb)
    into invitations from bob.project_friend_invitations i where i.project_id=p_project;
  return jsonb_build_object('projectId',p_project,'householdId',s.household_id,'buildingId',s.building_id,'revision',coalesce(s.revision,0),
    'buildings',buildings,'invitations',invitations,'canManage',true);
end $function$
;

CREATE OR REPLACE FUNCTION bob_private.sharing_directory()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); households jsonb; friends jsonb;
begin
  if uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'name',h.name) order by h.name,h.id),'[]'::jsonb)
    into households from shared.households h join shared.household_access a on a.household_id=h.id
    where a.user_id=uid and a.status='active';
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',coalesce(bob_private.person_label(f.id),'Friend')) order by f.id),'[]'::jsonb)
    into friends from (select distinct case when user_id=uid then friend_user_id else user_id end id
      from hearth.friendships where status='accepted' and (user_id=uid or friend_user_id=uid)) f;
  return jsonb_build_object('households',households,'friends',friends);
end $function$
;

CREATE OR REPLACE FUNCTION bob_private.create_project(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_project bob.projects;
  v_id text := 'p_' || replace(gen_random_uuid()::text, '-', '');
  v_label text;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if coalesce(length(trim(p_input->>'name')), 0) not between 1 and 200 then
    raise exception 'invalid_project_name' using errcode = '22023';
  end if;
  insert into bob.projects(id,slug,name,description,location,type,theme,start_label,start_date,end_date,phase)
  values(v_id,v_id,trim(p_input->>'name'),coalesce(p_input->>'description',''),
    coalesce(p_input->>'location',''),coalesce(p_input->>'type',''),
    coalesce(p_input->>'theme','birch')::bob.theme_name,coalesce(p_input->>'start_label',''),
    (p_input->>'start_date')::date,(p_input->>'end_date')::date,'concept')
  returning * into v_project;
  v_label := left(coalesce(bob_private.person_label(v_uid),'Project creator'),200);
  insert into bob.people(id,project_id,name,initials,role,auth_user_id)
    values('m_' || replace(gen_random_uuid()::text, '-', ''),v_id,v_label,upper(left(v_label,2)),'Organiser',v_uid);
  insert into bob.phase_history(project_id,scope_kind,from_phase,to_phase,reason,recorded_by,actor_label)
    values(v_id,'project',null,'concept','Project created',v_uid,v_label);
  return to_jsonb(v_project);
end $function$;

update bob.people p set name=left(l.label,200), initials=upper(left(l.label,2))
  from (select id, bob_private.person_label(auth_user_id) label from bob.people
         where name='Project creator' and auth_user_id is not null) l
 where p.id=l.id and l.label is not null;

notify pgrst,'reload schema';
commit;
