-- Explicit Bob sharing. Shared household identity and Hearth friendships remain
-- read-only external authorities; no shared grants or profiles are copied.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('shared.households') is null or to_regclass('shared.household_access') is null
    or to_regclass('shared.members') is null or to_regclass('hearth.friendships') is null
    or to_regclass('hearth.profiles') is null then
    raise exception 'Bob sharing requires the existing shared family and Hearth friendship contracts';
  end if;
end $$;

create type bob.project_access_origin as enum ('direct','derived');
alter table bob.people add column access_origin bob.project_access_origin not null default 'direct';
comment on column bob.people.access_origin is
  'Direct rows grant project membership; derived rows only project an independently current household or accepted Bob invitation entitlement into the crew.';

create table bob.building_household_shares (
  building_id uuid primary key references bob.buildings(id) on delete cascade,
  household_id uuid references shared.households(id) on delete set null,
  revision integer not null default 1 check (revision > 0),
  changed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index building_household_shares_household_idx on bob.building_household_shares(household_id);
create index building_household_shares_actor_idx on bob.building_household_shares(changed_by);
comment on table bob.building_household_shares is
  'Opt-in household editing of one persistent building. Null household disables sharing while retaining its conflict revision.';

create table bob.project_household_shares (
  project_id text primary key references bob.projects(id) on delete cascade,
  household_id uuid references shared.households(id) on delete set null,
  building_id uuid references bob.buildings(id) on delete set null,
  revision integer not null default 1 check (revision > 0),
  changed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (num_nonnulls(household_id,building_id) <= 1)
);
create index project_household_shares_household_idx on bob.project_household_shares(household_id);
create index project_household_shares_building_idx on bob.project_household_shares(building_id);
create index project_household_shares_actor_idx on bob.project_household_shares(changed_by);
comment on table bob.project_household_shares is
  'Explicit project household audience, either direct or inherited from one exactly linked building. A physical association alone grants no household project access.';

create type bob.project_invitation_status as enum ('pending','accepted','declined','revoked');
create table bob.project_friend_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references bob.projects(id) on delete cascade,
  inviter_id uuid references auth.users(id) on delete set null,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  status bob.project_invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (inviter_id is null or inviter_id <> invitee_id)
);
create unique index project_friend_invitations_open_idx on bob.project_friend_invitations(project_id,invitee_id)
  where status in ('pending','accepted');
create index project_friend_invitations_invitee_idx on bob.project_friend_invitations(invitee_id,status);
create index project_friend_invitations_inviter_idx on bob.project_friend_invitations(inviter_id);
create index project_friend_invitations_project_idx on bob.project_friend_invitations(project_id,created_at,id);
comment on table bob.project_friend_invitations is
  'Bob-only project invitation and explicit accepted membership. Acceptance requires current friendship and inviter authority; accepted access lasts until revoked or left.';

create function bob_private.sharing_revision() returns trigger
language plpgsql set search_path='' as $$ begin
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger sharing_revision before update on bob.building_household_shares
  for each row execute function bob_private.sharing_revision();
create trigger sharing_revision before update on bob.project_household_shares
  for each row execute function bob_private.sharing_revision();
create trigger set_updated_at before update on bob.project_friend_invitations
  for each row execute function bob.set_updated_at();

-- Internal cross-principal checks are callable only by their owning definers.
-- They never depend on has_project_access, avoiding recursive RLS predicates.
create function bob_private.project_exactly_links_building(p_project text,p_building uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from bob.project_physical_scope s
    where s.project_id=p_project and s.building_id=p_building
      and s.target_kind in ('building','space','element')
  )
$$;
create function bob_private.project_access_for_user(p_project text,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and p_user is not null and (
    exists(select 1 from bob.people p where p.project_id=p_project
      and p.auth_user_id=p_user and p.access_origin='direct')
    or exists(select 1 from bob.project_household_shares s
      left join bob.building_household_shares b on b.building_id=s.building_id
      join shared.household_access a on a.household_id=coalesce(s.household_id,b.household_id)
        and a.user_id=p_user and a.status='active'
      where s.project_id=p_project and (s.household_id is not null
        or (s.building_id is not null and bob_private.project_exactly_links_building(p_project,s.building_id))))
    or exists(select 1 from bob.project_friend_invitations i
      where i.project_id=p_project and i.invitee_id=p_user and i.status='accepted')
  )
$$;
create or replace function bob_private.has_project_access(p_project_id text) returns boolean
language sql stable security definer set search_path='' as $$
  select bob_private.project_access_for_user(p_project_id,auth.uid())
$$;
comment on function bob_private.has_project_access(text) is
  'Current caller project authority: direct membership, explicit active household share, or accepted Bob invitation. Derived crew rows never grant access.';

create function bob_private.can_edit_building(p_building uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (bob_private.has_building_direct_access(p_building)
    or exists(select 1 from bob.building_household_shares s join shared.household_access a
      on a.household_id=s.household_id and a.user_id=auth.uid() and a.status='active'
      where s.building_id=p_building))
$$;
comment on function bob_private.can_edit_building(uuid) is
  'Current direct or explicit household building editor. This does not grant physical deletion or building-sharing administration.';
create function bob.can_edit_building(p_building uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select bob_private.can_edit_building(p_building) $$;

create or replace function bob_private.has_building_access(p_building uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (bob_private.can_edit_building(p_building) or exists(
    select 1 from bob.project_physical_scope s join bob.buildings b on b.id=p_building
    where bob_private.has_project_access(s.project_id)
      and (s.building_id=p_building or (s.target_kind='site' and s.site_id=b.site_id))))
$$;

create or replace function bob_private.keep_last_member() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if old.auth_user_id is not null and old.access_origin='derived'
    and exists(select 1 from bob.projects where id=old.project_id)
    and bob_private.project_access_for_user(old.project_id,old.auth_user_id) then
    raise exception 'Change household sharing or revoke the project invitation first' using errcode='23514';
  end if;
  if old.auth_user_id is not null and old.access_origin='direct' then
    perform pg_advisory_xact_lock(hashtextextended(old.project_id,1));
    if exists(select 1 from bob.projects where id=old.project_id) and not exists(
      select 1 from bob.people where project_id=old.project_id and id<>old.id
        and auth_user_id is not null and access_origin='direct') then
      raise exception 'last_project_member' using errcode='23514';
    end if;
  end if;
  return old;
end $$;

create function bob_private.ensure_project_person(p_project text) returns jsonb
language plpgsql security definer set search_path='' as $$
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
  if label is null then select coalesce(nullif(display_name,''),nullif(username,'')) into label from hearth.profiles where user_id=uid; end if;
  label:=coalesce(nullif(btrim(label),''),'Project member');
  insert into bob.people(id,project_id,name,initials,role,auth_user_id,access_origin)
    values('m_'||replace(gen_random_uuid()::text,'-',''),p_project,left(label,200),upper(left(label,2)),'Volunteer',uid,'derived') returning * into person;
  return to_jsonb(person);
end $$;
comment on function bob_private.ensure_project_person(text) is
  'Projects an already entitled caller into stable crew identity; never creates an entitlement or copies household access.';
create or replace function bob.join_project(p_project_id text) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.ensure_project_person(p_project_id) $$;

-- An explicit legacy invitation is an independent direct grant. If its exact
-- confirmed identity already has a derived crew row, preserve that row and all
-- attribution while promoting its origin instead of creating a shadow invite.
create or replace function bob_private.invite_person(p_project_id text,p_name text,p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person bob.people; matches uuid[]; target uuid;
begin
  if not bob_private.has_project_access(p_project_id) then raise exception 'project_denied' using errcode='42501'; end if;
  if coalesce(length(trim(p_name)),0) not between 1 and 200 or coalesce(length(trim(p_email)),0) not between 3 and 320 or position('@' in p_email)<2 then
    raise exception 'invalid_invitation' using errcode='22023'; end if;
  select array_agg(id) into matches from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
  if cardinality(matches)=1 then
    target:=matches[1];
    perform pg_advisory_xact_lock(hashtextextended(p_project_id || target::text,27));
    select * into person from bob.people where project_id=p_project_id and auth_user_id=target for update;
    if found then
      if person.access_origin='derived' then
        update bob.people set access_origin='direct' where id=person.id returning * into person;
      end if;
      return to_jsonb(person);
    end if;
  end if;
  insert into bob.people(id,project_id,name,initials)
    values('i_'||replace(gen_random_uuid()::text,'-',''),p_project_id,trim(p_name),upper(left(trim(p_name),2))) returning * into person;
  insert into bob.person_emails(person_id,project_id,email) values(person.id,p_project_id,lower(trim(p_email)));
  return to_jsonb(person);
end $$;

create function bob_private.sharing_directory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); households jsonb; friends jsonb;
begin
  if uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'name',h.name) order by h.name,h.id),'[]'::jsonb)
    into households from shared.households h join shared.household_access a on a.household_id=h.id
    where a.user_id=uid and a.status='active';
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',coalesce(nullif(p.display_name,''),nullif(p.username,''),'Friend')) order by f.id),'[]'::jsonb)
    into friends from (select distinct case when user_id=uid then friend_user_id else user_id end id
      from hearth.friendships where status='accepted' and (user_id=uid or friend_user_id=uid)) f
    left join hearth.profiles p on p.user_id=f.id;
  return jsonb_build_object('households',households,'friends',friends);
end $$;

create function bob_private.project_sharing_state(p_project text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
    'name',coalesce(nullif(p.display_name,''),nullif(p.username,''),'Friend'),'status',i.status) order by i.created_at,i.id),'[]'::jsonb)
    into invitations from bob.project_friend_invitations i left join hearth.profiles p on p.user_id=i.invitee_id where i.project_id=p_project;
  return jsonb_build_object('projectId',p_project,'householdId',s.household_id,'buildingId',s.building_id,'revision',coalesce(s.revision,0),
    'buildings',buildings,'invitations',invitations,'canManage',true);
end $$;

create function bob_private.building_sharing_state(p_building uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s bob.building_household_shares; projects jsonb;
begin
  if not bob_private.can_edit_building(p_building) then raise exception 'building_denied' using errcode='42501'; end if;
  select * into s from bob.building_household_shares where building_id=p_building;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'buildingId',ps.building_id,'householdId',ps.household_id,'revision',coalesce(ps.revision,0)) order by p.name,p.id),'[]'::jsonb)
    into projects from bob.projects p left join bob.project_household_shares ps on ps.project_id=p.id
    where bob_private.has_project_access(p.id) and bob_private.project_exactly_links_building(p.id,p_building);
  return jsonb_build_object('buildingId',p_building,'householdId',s.household_id,'revision',coalesce(s.revision,0),
    'canManage',bob_private.has_building_direct_access(p_building),'projects',projects);
end $$;

create function bob_private.set_project_household(p_project text,p_household uuid,p_building uuid,p_expected integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.project_household_shares;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_expected is null or p_expected<0 or num_nonnulls(p_household,p_building)>1 then raise exception 'Invalid project sharing' using errcode='22023'; end if;
  perform 1 from bob.projects where id=p_project for update;
  select * into s from bob.project_household_shares where project_id=p_project for update;
  if p_expected is distinct from coalesce(s.revision,0) then raise exception 'Project sharing changed. Reload before saving.' using errcode='40001'; end if;
  if p_household is not null and not exists(select 1 from shared.household_access a where a.household_id=p_household and a.user_id=auth.uid() and a.status='active') then
    raise exception 'household_denied' using errcode='42501'; end if;
  if p_building is not null and (not bob_private.project_exactly_links_building(p_project,p_building) or not exists(
    select 1 from bob.building_household_shares b join shared.household_access a on a.household_id=b.household_id
    where b.building_id=p_building and a.user_id=auth.uid() and a.status='active')) then raise exception 'building_denied' using errcode='42501'; end if;
  insert into bob.project_household_shares(project_id,household_id,building_id,changed_by)
    values(p_project,p_household,p_building,auth.uid()) on conflict(project_id) do update
    set household_id=excluded.household_id,building_id=excluded.building_id,changed_by=excluded.changed_by;
  -- A user may remove the very share granting their access. Return the accepted
  -- command's receipt without attempting a now-forbidden expanded read-back.
  if not bob_private.has_project_access(p_project) then
    return jsonb_build_object('projectId',p_project,'householdId',p_household,'buildingId',p_building,'revision',p_expected+1,
      'buildings','[]'::jsonb,'invitations','[]'::jsonb,'canManage',false);
  end if;
  return bob_private.project_sharing_state(p_project);
end $$;

create function bob_private.set_building_household(p_building uuid,p_household uuid,p_expected integer,p_projects text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.building_household_shares; ps bob.project_household_shares; pid text;
begin
  if not bob_private.has_building_direct_access(p_building) then raise exception 'building_denied' using errcode='42501'; end if;
  if p_expected is null or p_expected<0 or p_projects is null or cardinality(p_projects)>200
    or array_position(p_projects,null) is not null or (p_household is null and cardinality(p_projects)>0) then raise exception 'Invalid building sharing' using errcode='22023'; end if;
  if p_household is not null and not exists(select 1 from shared.household_access a where a.household_id=p_household and a.user_id=auth.uid() and a.status='active') then
    raise exception 'household_denied' using errcode='42501'; end if;
  perform 1 from bob.buildings where id=p_building for update;
  select * into s from bob.building_household_shares where building_id=p_building for update;
  if p_expected is distinct from coalesce(s.revision,0) then raise exception 'Building sharing changed. Reload before saving.' using errcode='40001'; end if;
  -- Validate every explicitly selected project before changing any audience.
  for pid in select distinct p from unnest(p_projects) p order by p loop
    if not bob_private.has_project_access(pid) or not bob_private.project_exactly_links_building(pid,p_building) then raise exception 'project_denied' using errcode='42501'; end if;
    perform 1 from bob.projects where id=pid for update;
    select * into ps from bob.project_household_shares where project_id=pid for update;
    if ps.project_id is not null and ps.building_id is distinct from p_building then
      raise exception 'Project sharing has an existing choice. Review and change that project separately.' using errcode='40001'; end if;
  end loop;
  insert into bob.building_household_shares(building_id,household_id,changed_by)
    values(p_building,p_household,auth.uid()) on conflict(building_id) do update
    set household_id=excluded.household_id,changed_by=excluded.changed_by;
  for pid in select distinct p from unnest(p_projects) p order by p loop
    insert into bob.project_household_shares(project_id,building_id,changed_by)
      values(pid,p_building,auth.uid()) on conflict(project_id) do update
      set household_id=null,building_id=excluded.building_id,changed_by=excluded.changed_by;
  end loop;
  return bob_private.building_sharing_state(p_building);
end $$;

create function bob_private.invite_project_friend(p_project text,p_friend uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); invitation bob.project_friend_invitations; label text;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_friend is null or p_friend=uid then raise exception 'Invalid friend invitation' using errcode='22023'; end if;
  if not exists(select 1 from hearth.friendships f where f.status='accepted'
    and ((f.user_id=uid and f.friend_user_id=p_friend) or (f.user_id=p_friend and f.friend_user_id=uid))) then
    raise exception 'accepted_friend_required' using errcode='42501'; end if;
  insert into bob.project_friend_invitations(project_id,inviter_id,invitee_id) values(p_project,uid,p_friend)
    on conflict(project_id,invitee_id) where status in ('pending','accepted') do nothing returning * into invitation;
  if not found then select * into invitation from bob.project_friend_invitations where project_id=p_project and invitee_id=p_friend and status in ('pending','accepted'); end if;
  select coalesce(nullif(display_name,''),nullif(username,'')) into label from hearth.profiles where user_id=p_friend;
  return jsonb_build_object('id',invitation.id,'inviteeId',invitation.invitee_id,'name',coalesce(label,'Friend'),'status',invitation.status);
end $$;

create function bob_private.project_invitations() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'projectId',i.project_id,'projectName',p.name,
    'inviterName',coalesce(nullif(profile.display_name,''),nullif(profile.username,''),'Project member'),'status',i.status) order by i.created_at,i.id),'[]'::jsonb)
    into result from bob.project_friend_invitations i join bob.projects p on p.id=i.project_id
    left join hearth.profiles profile on profile.user_id=i.inviter_id
    where i.invitee_id=auth.uid() and i.status='pending'
      and bob_private.project_access_for_user(i.project_id,i.inviter_id)
      and exists(select 1 from hearth.friendships f where f.status='accepted'
        and ((f.user_id=auth.uid() and f.friend_user_id=i.inviter_id) or (f.friend_user_id=auth.uid() and f.user_id=i.inviter_id)));
  return result;
end $$;

create function bob_private.respond_project_invitation(p_invite uuid,p_accept boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); invitation bob.project_friend_invitations;
begin
  if uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_invite is null or p_accept is null then raise exception 'Invalid invitation response' using errcode='22023'; end if;
  select * into invitation from bob.project_friend_invitations where id=p_invite for update;
  if not found or invitation.invitee_id<>uid then raise exception 'invitation_denied' using errcode='42501'; end if;
  if (p_accept and invitation.status='accepted') or (not p_accept and invitation.status='declined') then return jsonb_build_object('projectId',invitation.project_id); end if;
  if invitation.status<>'pending' then raise exception 'Invitation is no longer pending' using errcode='40001'; end if;
  if p_accept and (not bob_private.project_access_for_user(invitation.project_id,invitation.inviter_id) or not exists(
    select 1 from hearth.friendships f where f.status='accepted'
      and ((f.user_id=uid and f.friend_user_id=invitation.inviter_id) or (f.user_id=invitation.inviter_id and f.friend_user_id=uid)))) then
    raise exception 'Invitation authority has changed' using errcode='42501'; end if;
  update bob.project_friend_invitations set status=case when p_accept then 'accepted'::bob.project_invitation_status else 'declined'::bob.project_invitation_status end,
    accepted_at=case when p_accept then clock_timestamp() else null end where id=p_invite;
  if p_accept then perform bob_private.ensure_project_person(invitation.project_id); end if;
  return jsonb_build_object('projectId',invitation.project_id);
end $$;

create function bob_private.revoke_project_invitation(p_invite uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation bob.project_friend_invitations;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
  select * into invitation from bob.project_friend_invitations where id=p_invite for update;
  if not found or (invitation.invitee_id<>auth.uid() and not bob_private.has_project_access(invitation.project_id)) then raise exception 'invitation_denied' using errcode='42501'; end if;
  update bob.project_friend_invitations set status='revoked' where id=p_invite and status<>'revoked';
  return jsonb_build_object('revoked',true);
end $$;

-- No direct client write can forge sharing, invitations or the crew's origin.
alter table bob.building_household_shares enable row level security;
alter table bob.project_household_shares enable row level security;
alter table bob.project_friend_invitations enable row level security;
revoke all on bob.building_household_shares,bob.project_household_shares,bob.project_friend_invitations from public,anon,authenticated;
grant select on bob.building_household_shares,bob.project_household_shares,bob.project_friend_invitations to authenticated;
grant all on bob.building_household_shares,bob.project_household_shares,bob.project_friend_invitations to service_role;
create policy sharing_read on bob.building_household_shares for select to authenticated using(bob_private.can_edit_building(building_id));
create policy sharing_read on bob.project_household_shares for select to authenticated using(bob_private.has_project_access(project_id));
create policy sharing_read on bob.project_friend_invitations for select to authenticated using(invitee_id=auth.uid() or bob_private.has_project_access(project_id));

create function bob.sharing_directory() returns jsonb language sql stable security invoker set search_path='' as $$ select bob_private.sharing_directory() $$;
create function bob.project_sharing_state(p_project text) returns jsonb language sql stable security invoker set search_path='' as $$ select bob_private.project_sharing_state(p_project) $$;
create function bob.building_sharing_state(p_building uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select bob_private.building_sharing_state(p_building) $$;
create function bob.set_building_household(p_building uuid,p_household uuid,p_expected integer,p_projects text[]) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.set_building_household(p_building,p_household,p_expected,p_projects) $$;
create function bob.set_project_household(p_project text,p_household uuid,p_building uuid,p_expected integer) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.set_project_household(p_project,p_household,p_building,p_expected) $$;
create function bob.invite_project_friend(p_project text,p_friend uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.invite_project_friend(p_project,p_friend) $$;
create function bob.project_invitations() returns jsonb language sql stable security invoker set search_path='' as $$ select bob_private.project_invitations() $$;
create function bob.respond_project_invitation(p_invite uuid,p_accept boolean) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.respond_project_invitation(p_invite,p_accept) $$;
create function bob.revoke_project_invitation(p_invite uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.revoke_project_invitation(p_invite) $$;

-- Explicit invoker/delegate ACL pairs. Unlisted internal helpers stay private.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bob','bob_private') and p.proname=any(array['sharing_directory','project_sharing_state','building_sharing_state',
      'set_building_household','set_project_household','invite_project_friend','project_invitations','respond_project_invitation','revoke_project_invitation',
      'can_edit_building','ensure_project_person']) loop
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;

comment on function bob_private.sharing_revision() is 'Advances audience conflict version and update time even when a referenced household or building disappears.';
comment on function bob_private.project_exactly_links_building(text,uuid) is 'Checks explicit project building/space/element scope; a site shorthand never establishes household inheritance.';
comment on function bob_private.project_access_for_user(text,uuid) is 'Internal cross-principal authority lookup for caller-checked invitations; no client EXECUTE privilege.';
comment on function bob_private.sharing_directory() is 'Minimal caller household/friend selection directory; returns names and principal ids without auth emails or family private facts.';
comment on function bob_private.project_sharing_state(text) is 'Authorized project audience, eligible inherited-building choices and explicit Bob invitations.';
comment on function bob_private.building_sharing_state(uuid) is 'Building editor sharing read-back; lists only caller-authorized projects with exact physical links.';
comment on function bob_private.set_project_household(text,uuid,uuid,integer) is 'Revision-checked explicit project audience command; clearing never removes independent memberships.';
comment on function bob_private.set_building_household(uuid,uuid,integer,text[]) is 'Direct building member command with atomic opt-in of explicitly supplied eligible projects; never overwrites a competing project sharing choice.';
comment on function bob_private.invite_project_friend(text,uuid) is 'Idempotent Bob-only project invitation for a current accepted friend of an authorized project participant.';
comment on function bob_private.project_invitations() is 'Recipient-only actionable pending invitation summaries; invalidated invitations disclose no current project name.';
comment on function bob_private.respond_project_invitation(uuid,boolean) is 'Recipient-only response; acceptance verifies current friendship and inviter authority before granting this project.';
comment on function bob_private.revoke_project_invitation(uuid) is 'Authorized revoke or recipient self-leave affecting only this Bob invitation grant.';

revoke all on function bob_private.project_exactly_links_building(text,uuid),
  bob_private.project_access_for_user(text,uuid),bob_private.sharing_revision() from public,anon,authenticated;

-- Ordinary physical writes now accept explicit household editors. The separate
-- physical deletion functions and direct-membership helper remain unchanged.

create or replace function bob_private.physical_building_command(p_action text,p_building uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); actor text; head bob.buildings; old bob.building_revisions; next_rev integer; sid uuid;
begin
  if uid is null or p_building is null or p_action not in ('create','revise','archive','restore') or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid building command'; end if;
  actor:=bob_private.physical_actor();
  if p_action='create' then
    if p_expected is distinct from 0 or exists(select 1 from bob.buildings where id=p_building) then raise exception 'Building changed. Reload before saving.'; end if;
    if p_data - array['site_id','name','notes']::text[] <> '{}'::jsonb then raise exception 'Unsupported building fields'; end if;
    sid:=nullif(p_data->>'site_id','')::uuid;
    if sid is not null and not bob_private.has_site_access(sid) then raise exception 'site_denied' using errcode='42501'; end if;
    insert into bob.buildings(id,site_id) values(p_building,sid);
    insert into bob.building_members(building_id,auth_user_id,member_label) values(p_building,uid,actor);
    next_rev:=1;
    insert into bob.building_revisions(building_id,revision,name,notes,archived,change_note,recorded_by,actor_label)
      values(p_building,next_rev,btrim(p_data->>'name'),btrim(coalesce(p_data->>'notes','')),false,'Initial building',uid,actor);
  else
    if not bob_private.can_edit_building(p_building) then raise exception 'building_denied' using errcode='42501'; end if;
    select * into head from bob.buildings where id=p_building for update;
    if not found or p_expected is distinct from head.current_revision then raise exception 'Building changed. Reload before saving.'; end if;
    select * into old from bob.building_revisions where building_id=p_building and revision=head.current_revision;
    if p_action='revise' and p_data - array['name','notes','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported building fields'; end if;
    if p_action in ('archive','restore') and p_data <> '{}'::jsonb then raise exception 'Unsupported building fields'; end if;
    next_rev:=head.current_revision+1;
    insert into bob.building_revisions(building_id,revision,name,notes,archived,change_note,recorded_by,actor_label)
      values(p_building,next_rev,
        case when p_action='revise' then btrim(p_data->>'name') else old.name end,
        case when p_action='revise' then btrim(coalesce(p_data->>'notes','')) else old.notes end,
        case when p_action='archive' then true when p_action='restore' then false else old.archived end,
        case p_action when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end,uid,actor);
    update bob.buildings set current_revision=next_rev where id=p_building;
  end if;
  return jsonb_build_object('id',p_building,'revision',next_rev);
end $$;

create or replace function bob_private.physical_node_command(
  p_building uuid,p_kind text,p_action text,p_record uuid,p_expected integer,p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); actor text; next_rev integer; project text; direct boolean;
  level_head bob.building_levels; level_old bob.level_revisions;
  space_head bob.building_spaces; space_old bob.space_revisions; space_new bob.space_revisions;
  element_head bob.building_elements; element_old bob.element_revisions; element_new bob.element_revisions;
  rel_head bob.spatial_relationships; rel_old bob.relationship_revisions; rel_new bob.relationship_revisions;
  measure jsonb; mr bob.measurement_revisions;
begin
  if uid is null or p_building is null or p_record is null or p_kind not in ('level','space','element','relationship')
    or p_action not in ('create','revise','archive','restore','propose','accept')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception 'Invalid physical context command'; end if;
  direct:=bob_private.can_edit_building(p_building);
  if not bob_private.has_building_access(p_building) then raise exception 'building_denied' using errcode='42501'; end if;
  actor:=bob_private.physical_actor();

  if p_kind='level' then
    if p_action not in ('create','revise','archive','restore') or not direct then raise exception 'building_denied' using errcode='42501'; end if;
    if p_action='create' then
      if p_expected is distinct from 0 or exists(select 1 from bob.building_levels where id=p_record) then raise exception 'Level changed. Reload before saving.'; end if;
      if p_data - array['name','position','notes']::text[] <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      insert into bob.building_levels(id,building_id) values(p_record,p_building); next_rev:=1;
      insert into bob.level_revisions(level_id,building_id,revision,name,position,notes,archived,change_note,recorded_by,actor_label)
        values(p_record,p_building,1,btrim(p_data->>'name'),coalesce((p_data->>'position')::integer,0),btrim(coalesce(p_data->>'notes','')),false,'Initial level',uid,actor);
    else
      select * into level_head from bob.building_levels where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from level_head.current_revision then raise exception 'Level changed. Reload before saving.'; end if;
      select * into level_old from bob.level_revisions where level_id=p_record and revision=level_head.current_revision;
      if p_action='revise' and p_data - array['name','position','notes','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      if p_action in ('archive','restore') and p_data <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      next_rev:=level_head.current_revision+1;
      insert into bob.level_revisions(level_id,building_id,revision,name,position,notes,archived,change_note,recorded_by,actor_label)
        values(p_record,p_building,next_rev,
          case when p_action='revise' then btrim(p_data->>'name') else level_old.name end,
          case when p_action='revise' then coalesce((p_data->>'position')::integer,0) else level_old.position end,
          case when p_action='revise' then btrim(coalesce(p_data->>'notes','')) else level_old.notes end,
          case when p_action='archive' then true when p_action='restore' then false else level_old.archived end,
          case p_action when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end,uid,actor);
      update bob.building_levels set current_revision=next_rev where id=p_record;
    end if;
    return jsonb_build_object('id',p_record,'revision',next_rev);
  end if;

  project:=nullif(p_data->>'project_id','');
  if p_action='propose' then
    if project is null or not bob_private.project_scopes_building(project,p_building) then raise exception 'project_denied' using errcode='42501'; end if;
  elsif p_action='accept' or p_action in ('create','revise','archive','restore') then
    if not direct then raise exception 'building_denied' using errcode='42501'; end if;
  end if;

  if p_kind='space' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.building_spaces where id=p_record) then
      insert into bob.building_spaces(id,building_id,latest_revision,accepted_revision)
        values(p_record,p_building,1,case when p_action='create' then 1 else null end);
      next_rev:=1;
      space_new.space_id:=p_record; space_new.building_id:=p_building; space_new.revision:=1;
    else
      select * into space_head from bob.building_spaces where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from space_head.latest_revision then raise exception 'Space changed. Reload before saving.'; end if;
      select * into space_old from bob.space_revisions where space_id=p_record and revision=coalesce(space_head.latest_revision,space_head.accepted_revision);
      if p_action='accept' then
        if space_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=space_head.latest_revision+1;
        space_new:=space_old; space_new.id:=gen_random_uuid(); space_new.revision:=next_rev; space_new.state:='accepted';
        space_new.recorded_by:=uid; space_new.actor_label:=actor; space_new.recorded_at:=clock_timestamp(); space_new.change_note:='Accepted proposal';
      else
        next_rev:=space_head.latest_revision+1;
        space_new.space_id:=p_record; space_new.building_id:=p_building; space_new.revision:=next_rev;
      end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported space fields'; end if;
        space_new.project_id:=space_old.project_id; space_new.level_id:=space_old.level_id; space_new.state:='accepted';
        space_new.name:=space_old.name; space_new.kind:=space_old.kind; space_new.notes:=space_old.notes; space_new.truth:=space_old.truth; space_new.source:=space_old.source;
        space_new.archived:=(p_action='archive'); space_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','level_id','name','kind','notes','truth','source','measurements','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported space fields'; end if;
        space_new.project_id:=case when p_action='propose' then project else null end;
        space_new.level_id:=nullif(p_data->>'level_id','')::uuid;
        if space_new.level_id is not null and not exists(select 1 from bob.building_levels where id=space_new.level_id and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
        space_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;
        space_new.name:=btrim(p_data->>'name'); space_new.kind:=btrim(coalesce(p_data->>'kind','')); space_new.notes:=btrim(coalesce(p_data->>'notes',''));
        space_new.truth:=coalesce(p_data->>'truth','unknown'); space_new.source:=btrim(coalesce(p_data->>'source','')); space_new.archived:=coalesce((p_data->>'archived')::boolean,false);
        space_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial space' end else btrim(p_data->>'change_note') end;
      end if;
      space_new.recorded_by:=uid; space_new.actor_label:=actor; space_new.recorded_at:=clock_timestamp(); space_new.id:=gen_random_uuid();
    end if;
    insert into bob.space_revisions select space_new.*;
    update bob.building_spaces set latest_revision=next_rev,
      accepted_revision=case when space_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    if p_action='accept' then
      insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
      select p_record,p_building,next_rev,m.source_project_id,m.measurement_id,m.measurement_revision,m.subject,m.value,m.unit,m.truth,m.source
      from bob.space_measurements m where m.space_id=p_record and m.space_revision=space_old.revision;
    elsif p_action not in ('archive','restore') and jsonb_typeof(coalesce(p_data->'measurements','[]'::jsonb))='array' then
      for measure in select * from jsonb_array_elements(coalesce(p_data->'measurements','[]'::jsonb)) loop
        select * into mr from bob.measurement_revisions where measurement_id=(measure->>'id')::uuid and revision=(measure->>'revision')::integer;
        if not found or not bob_private.has_project_access(mr.project_id) then raise exception 'Measurement unavailable for this building context' using errcode='42501'; end if;
        insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
          values(p_record,p_building,next_rev,mr.project_id,mr.measurement_id,mr.revision,mr.subject,mr.value,mr.unit,mr.truth,mr.source);
      end loop;
    elsif p_action in ('archive','restore') then
      insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
      select p_record,p_building,next_rev,m.source_project_id,m.measurement_id,m.measurement_revision,m.subject,m.value,m.unit,m.truth,m.source
      from bob.space_measurements m where m.space_id=p_record and m.space_revision=space_old.revision;
    end if;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',space_new.state);
  end if;

  if p_kind='element' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.building_elements where id=p_record) then
      insert into bob.building_elements(id,building_id,latest_revision,accepted_revision) values(p_record,p_building,1,case when p_action='create' then 1 else null end);
      next_rev:=1; element_new.element_id:=p_record; element_new.building_id:=p_building; element_new.revision:=1;
    else
      select * into element_head from bob.building_elements where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from element_head.latest_revision then raise exception 'Element changed. Reload before saving.'; end if;
      select * into element_old from bob.element_revisions where element_id=p_record and revision=element_head.latest_revision;
      if p_action='accept' then
        if element_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=element_head.latest_revision+1; element_new:=element_old; element_new.id:=gen_random_uuid(); element_new.revision:=next_rev; element_new.state:='accepted';
        element_new.recorded_by:=uid;element_new.actor_label:=actor;element_new.recorded_at:=clock_timestamp();element_new.change_note:='Accepted proposal';
      else next_rev:=element_head.latest_revision+1;element_new.element_id:=p_record;element_new.building_id:=p_building;element_new.revision:=next_rev; end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported element fields'; end if;
        element_new.project_id:=element_old.project_id;element_new.space_id:=element_old.space_id;element_new.state:='accepted';element_new.kind:=element_old.kind;element_new.name:=element_old.name;
        element_new.description:=element_old.description;element_new.truth:=element_old.truth;element_new.source:=element_old.source;element_new.archived:=(p_action='archive');
        element_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','space_id','kind','name','description','truth','source','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported element fields'; end if;
        element_new.project_id:=case when p_action='propose' then project else null end;element_new.space_id:=nullif(p_data->>'space_id','')::uuid;
        if element_new.space_id is not null and not exists(select 1 from bob.building_spaces where id=element_new.space_id and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
        element_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;element_new.kind:=btrim(p_data->>'kind');element_new.name:=btrim(p_data->>'name');
        element_new.description:=btrim(coalesce(p_data->>'description',''));element_new.truth:=coalesce(p_data->>'truth','unknown');element_new.source:=btrim(coalesce(p_data->>'source',''));
        element_new.archived:=coalesce((p_data->>'archived')::boolean,false);element_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial element' end else btrim(p_data->>'change_note') end;
      end if;
      element_new.recorded_by:=uid;element_new.actor_label:=actor;element_new.recorded_at:=clock_timestamp();element_new.id:=gen_random_uuid();
    end if;
    insert into bob.element_revisions select element_new.*;
    update bob.building_elements set latest_revision=next_rev,accepted_revision=case when element_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',element_new.state);
  end if;

  if p_kind='relationship' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.spatial_relationships where id=p_record) then
      if not exists(select 1 from bob.building_spaces where id=(p_data->>'subject_space_id')::uuid and building_id=p_building)
        or not exists(select 1 from bob.building_spaces where id=(p_data->>'object_space_id')::uuid and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
      insert into bob.spatial_relationships(id,building_id,subject_space_id,object_space_id,latest_revision,accepted_revision)
        values(p_record,p_building,(p_data->>'subject_space_id')::uuid,(p_data->>'object_space_id')::uuid,1,case when p_action='create' then 1 else null end);
      next_rev:=1;rel_new.relationship_id:=p_record;rel_new.building_id:=p_building;rel_new.revision:=1;
    else
      select * into rel_head from bob.spatial_relationships where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from rel_head.latest_revision then raise exception 'Relationship changed. Reload before saving.'; end if;
      select * into rel_old from bob.relationship_revisions where relationship_id=p_record and revision=rel_head.latest_revision;
      if p_action='accept' then
        if rel_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=rel_head.latest_revision+1;rel_new:=rel_old;rel_new.id:=gen_random_uuid();rel_new.revision:=next_rev;rel_new.state:='accepted';
        rel_new.recorded_by:=uid;rel_new.actor_label:=actor;rel_new.recorded_at:=clock_timestamp();rel_new.change_note:='Accepted proposal';
      else next_rev:=rel_head.latest_revision+1;rel_new.relationship_id:=p_record;rel_new.building_id:=p_building;rel_new.revision:=next_rev; end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported relationship fields'; end if;
        rel_new.project_id:=rel_old.project_id;rel_new.state:='accepted';rel_new.relation:=rel_old.relation;rel_new.truth:=rel_old.truth;rel_new.source:=rel_old.source;rel_new.notes:=rel_old.notes;
        rel_new.archived:=(p_action='archive');rel_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','subject_space_id','object_space_id','relation','truth','source','notes','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported relationship fields'; end if;
        rel_new.project_id:=case when p_action='propose' then project else null end;rel_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;
        rel_new.relation:=p_data->>'relation';rel_new.truth:=coalesce(p_data->>'truth','unknown');rel_new.source:=btrim(coalesce(p_data->>'source',''));rel_new.notes:=btrim(coalesce(p_data->>'notes',''));
        rel_new.archived:=coalesce((p_data->>'archived')::boolean,false);rel_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial relationship' end else btrim(p_data->>'change_note') end;
      end if;
      rel_new.recorded_by:=uid;rel_new.actor_label:=actor;rel_new.recorded_at:=clock_timestamp();rel_new.id:=gen_random_uuid();
    end if;
    insert into bob.relationship_revisions select rel_new.*;
    update bob.spatial_relationships set latest_revision=next_rev,accepted_revision=case when rel_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',rel_new.state);
  end if;
  raise exception 'Unsupported physical context command';
end $$;

create or replace function bob_private.physical_scope_command(
  p_project text,p_kind text,p_action text,p_record uuid,p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); area text; target text; sid uuid; bid uuid; spid uuid; eid uuid;
begin
  if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_kind not in ('project','area') or p_action not in ('link','unlink') or p_record is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid physical scope command'; end if;
  if p_action='unlink' then
    if p_kind='project' then delete from bob.project_physical_scope where id=p_record and project_id=p_project;
    else delete from bob.area_physical_targets where id=p_record and project_id=p_project; end if;
    return jsonb_build_object('id',p_record,'removed',true);
  end if;
  target:=p_data->>'target_kind';sid:=nullif(p_data->>'site_id','')::uuid;bid:=nullif(p_data->>'building_id','')::uuid;spid:=nullif(p_data->>'space_id','')::uuid;eid:=nullif(p_data->>'element_id','')::uuid;
  if target='site' then
    if p_kind<>'project' or sid is null or not bob_private.has_site_access(sid) then raise exception 'site_denied' using errcode='42501'; end if;
  else
    if bid is null or not bob_private.can_edit_building(bid) then raise exception 'building_denied' using errcode='42501'; end if;
    if target='space' and not exists(select 1 from bob.building_spaces where id=spid and building_id=bid) then raise exception 'building_denied' using errcode='42501'; end if;
    if target='element' and not exists(select 1 from bob.building_elements where id=eid and building_id=bid) then raise exception 'building_denied' using errcode='42501'; end if;
  end if;
  if p_kind='project' then
    if p_data - array['target_kind','site_id','building_id','space_id','element_id']::text[] <> '{}'::jsonb then raise exception 'Unsupported scope fields'; end if;
    insert into bob.project_physical_scope(id,project_id,target_kind,site_id,building_id,space_id,element_id,created_by)
      values(p_record,p_project,target,sid,bid,spid,eid,uid);
  else
    if target='site' or p_data - array['area_id','target_kind','building_id','space_id','element_id']::text[] <> '{}'::jsonb then raise exception 'Unsupported area target fields'; end if;
    area:=p_data->>'area_id';
    if not exists(select 1 from bob.areas where id=area and project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
    if not bob_private.project_scopes_building(p_project,bid) then raise exception 'Project must target this building before an Area can map into it'; end if;
    insert into bob.area_physical_targets(id,project_id,area_id,target_kind,building_id,space_id,element_id,created_by)
      values(p_record,p_project,area,target,bid,spid,eid,uid);
  end if;
  return jsonb_build_object('id',p_record,'target_kind',target);
end $$;

-- Apply the companion household_account_sharing migration before releasing the
-- feature: it closes the pre-existing broad account/notes surface without
-- guessing a household for old content.

notify pgrst, 'reload schema';
commit;
