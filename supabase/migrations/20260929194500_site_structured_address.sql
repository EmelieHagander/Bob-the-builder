-- Structured Site address so multiple Buildings on the same property can share one
-- physical location without duplicating address fields per Building.
-- Extends the shipped persistent Building model; address is optional and revisioned.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table bob.site_revisions
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists postal_code text,
  add column if not exists locality text,
  add column if not exists country_code text;

alter table bob.site_revisions
  drop constraint if exists site_revisions_address_line1_length_check,
  add constraint site_revisions_address_line1_length_check
    check (address_line1 is null or char_length(address_line1) <= 240) not valid,
  drop constraint if exists site_revisions_address_line2_length_check,
  add constraint site_revisions_address_line2_length_check
    check (address_line2 is null or char_length(address_line2) <= 240) not valid,
  drop constraint if exists site_revisions_postal_code_length_check,
  add constraint site_revisions_postal_code_length_check
    check (postal_code is null or char_length(postal_code) <= 40) not valid,
  drop constraint if exists site_revisions_locality_length_check,
  add constraint site_revisions_locality_length_check
    check (locality is null or char_length(locality) <= 160) not valid,
  drop constraint if exists site_revisions_country_code_check,
  add constraint site_revisions_country_code_check
    check (country_code is null or country_code ~ '^[A-Z]{2}$') not valid;

alter table bob.site_revisions validate constraint site_revisions_address_line1_length_check;
alter table bob.site_revisions validate constraint site_revisions_address_line2_length_check;
alter table bob.site_revisions validate constraint site_revisions_postal_code_length_check;
alter table bob.site_revisions validate constraint site_revisions_locality_length_check;
alter table bob.site_revisions validate constraint site_revisions_country_code_check;

comment on column bob.site_revisions.address_line1 is
  'Primary street/postal address line for the physical Site. Shared by Buildings on that Site.';
comment on column bob.site_revisions.address_line2 is
  'Optional secondary address line for the physical Site.';
comment on column bob.site_revisions.postal_code is
  'Postal code as entered; intentionally text to preserve national formatting.';
comment on column bob.site_revisions.locality is
  'Postal locality/city for the physical Site.';
comment on column bob.site_revisions.country_code is
  'Optional ISO 3166-1 alpha-2 country code, uppercase.';

create or replace view bob.current_sites
with (security_invoker=true)
as
select
  s.id,
  r.revision,
  r.name,
  r.notes,
  r.archived,
  r.change_note,
  r.recorded_by,
  r.actor_label,
  r.recorded_at,
  r.address_line1,
  r.address_line2,
  r.postal_code,
  r.locality,
  r.country_code
from bob.sites s
join bob.site_revisions r
  on r.site_id=s.id
 and r.revision=s.current_revision;

create or replace function bob_private.physical_site_command(
  p_action text,
  p_site uuid,
  p_expected integer,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  uid uuid:=auth.uid();
  actor text;
  head bob.sites;
  old bob.site_revisions;
  next_rev integer;
begin
  if uid is null
     or p_site is null
     or p_action not in ('create','revise','archive','restore')
     or p_data is null
     or jsonb_typeof(p_data)<>'object'
  then
    raise exception 'Invalid site command';
  end if;

  actor:=bob_private.physical_actor();

  if p_action='create' then
    if p_expected is distinct from 0
       or exists(select 1 from bob.sites where id=p_site)
    then
      raise exception 'Site changed. Reload before saving.';
    end if;

    if p_data - array[
      'name','notes','address_line1','address_line2','postal_code','locality','country_code'
    ]::text[] <> '{}'::jsonb
    then
      raise exception 'Unsupported site fields';
    end if;

    insert into bob.sites(id) values(p_site);
    insert into bob.site_members(site_id,auth_user_id,member_label)
      values(p_site,uid,actor);

    next_rev:=1;
    insert into bob.site_revisions(
      site_id,revision,name,notes,
      address_line1,address_line2,postal_code,locality,country_code,
      archived,change_note,recorded_by,actor_label
    )
    values(
      p_site,next_rev,
      btrim(p_data->>'name'),
      btrim(coalesce(p_data->>'notes','')),
      nullif(btrim(coalesce(p_data->>'address_line1','')),''),
      nullif(btrim(coalesce(p_data->>'address_line2','')),''),
      nullif(btrim(coalesce(p_data->>'postal_code','')),''),
      nullif(btrim(coalesce(p_data->>'locality','')),''),
      nullif(upper(btrim(coalesce(p_data->>'country_code',''))),''),
      false,'Initial site',uid,actor
    );
  else
    if not bob_private.has_site_access(p_site) then
      raise exception 'site_denied' using errcode='42501';
    end if;

    select * into head
    from bob.sites
    where id=p_site
    for update;

    if not found or p_expected is distinct from head.current_revision then
      raise exception 'Site changed. Reload before saving.';
    end if;

    select * into old
    from bob.site_revisions
    where site_id=p_site
      and revision=head.current_revision;

    if p_action='revise'
       and p_data - array[
         'name','notes','address_line1','address_line2','postal_code','locality',
         'country_code','change_note'
       ]::text[] <> '{}'::jsonb
    then
      raise exception 'Unsupported site fields';
    end if;

    if p_action in ('archive','restore') and p_data <> '{}'::jsonb then
      raise exception 'Unsupported site fields';
    end if;

    next_rev:=head.current_revision+1;

    insert into bob.site_revisions(
      site_id,revision,name,notes,
      address_line1,address_line2,postal_code,locality,country_code,
      archived,change_note,recorded_by,actor_label
    )
    values(
      p_site,next_rev,
      case when p_action='revise' and p_data ? 'name'
        then btrim(p_data->>'name') else old.name end,
      case when p_action='revise' and p_data ? 'notes'
        then btrim(coalesce(p_data->>'notes','')) else old.notes end,
      case when p_action='revise' and p_data ? 'address_line1'
        then nullif(btrim(coalesce(p_data->>'address_line1','')),'') else old.address_line1 end,
      case when p_action='revise' and p_data ? 'address_line2'
        then nullif(btrim(coalesce(p_data->>'address_line2','')),'') else old.address_line2 end,
      case when p_action='revise' and p_data ? 'postal_code'
        then nullif(btrim(coalesce(p_data->>'postal_code','')),'') else old.postal_code end,
      case when p_action='revise' and p_data ? 'locality'
        then nullif(btrim(coalesce(p_data->>'locality','')),'') else old.locality end,
      case when p_action='revise' and p_data ? 'country_code'
        then nullif(upper(btrim(coalesce(p_data->>'country_code',''))),'') else old.country_code end,
      case when p_action='archive' then true
           when p_action='restore' then false
           else old.archived end,
      case p_action
        when 'archive' then 'Archived'
        when 'restore' then 'Restored'
        else coalesce(nullif(btrim(p_data->>'change_note'),''),'Site details updated')
      end,
      uid,actor
    );

    update bob.sites
      set current_revision=next_rev
      where id=p_site;
  end if;

  return jsonb_build_object('id',p_site,'revision',next_rev);
end
$$;

commit;
