-- Compact image checkpoints are application-side. Existing checkpoints remain
-- readable while old jobs drain. Count stored byte lengths, not all JSON bodies.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table bob_private.bob_job_steps add column value_bytes integer
  generated always as (octet_length(value::text)) stored;

create or replace function bob_private.bob_save_job_step(p_job uuid,p_claim uuid,p_key text,p_fingerprint text,p_value jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; old bob_private.bob_job_steps; bytes integer;
begin
  select * into j from bob_private.bob_jobs where id=p_job for update;
  if not found or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then
    raise exception 'job_not_claimed' using errcode='40001'; end if;
  select * into old from bob_private.bob_job_steps where job_id=p_job and key=p_key;
  if found then
    if old.fingerprint is distinct from p_fingerprint or old.value is distinct from p_value then raise exception 'checkpoint_conflict'; end if;
    return true;
  end if;
  bytes:=octet_length(p_value::text);
  if p_key is null or p_fingerprint is null or p_value is null or length(p_key)>160 or length(p_fingerprint)<>64 or bytes>24000000
    or (select count(*) from bob_private.bob_job_steps where job_id=p_job)>=512
    or coalesce((select sum(value_bytes) from bob_private.bob_job_steps where job_id=p_job),0)+bytes>64000000 then raise exception 'journal_limit'; end if;
  insert into bob_private.bob_job_steps(job_id,key,fingerprint,value) values(p_job,p_key,p_fingerprint,p_value);
  return true;
end $$;

-- Private per-owner derived cache, NOT a project measurement or verified fact.
-- A changed image revision is never presented with an old description.
create table bob_private.image_descriptions (
  media_id uuid not null references bob.media_assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_version text not null check(char_length(source_version) between 1 and 20000),
  source_updated_at timestamptz not null,
  description text not null check(char_length(btrim(description)) between 1 and 500),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(media_id,user_id)
);
alter table bob_private.image_descriptions enable row level security;
revoke all on bob_private.image_descriptions from public,anon,authenticated;

create function bob.bob_image_descriptions(p_project text,p_media uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_media is null or cardinality(p_media)>12 then raise exception 'invalid_images'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('media_id',d.media_id,'source_version',d.source_version,'description',d.description))
    from bob_private.image_descriptions d join bob.media_assets m on m.id=d.media_id
    where d.media_id=any(p_media) and d.user_id=auth.uid() and m.project_id=p_project and m.state='ready'
      and m.updated_at=d.source_updated_at),'[]'::jsonb);
end $$;
revoke all on function bob.bob_image_descriptions(text,uuid[]) from public,anon;
grant execute on function bob.bob_image_descriptions(text,uuid[]) to authenticated;

create function bob.bob_describe_image(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,
  p_media uuid,p_version text,p_updated_at timestamptz,p_description text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  perform 1 from bob.media_assets where id=p_media and project_id=p_project and state='ready' and updated_at=p_updated_at for share;
  if not found then raise exception 'context_changed' using errcode='40001'; end if;
  insert into bob_private.image_descriptions(media_id,user_id,source_version,source_updated_at,description)
    values(p_media,p_user,p_version,p_updated_at,btrim(p_description))
    on conflict(media_id,user_id) do update set source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,
      description=excluded.description,updated_at=clock_timestamp();
  return true;
end $$;
revoke all on function bob.bob_describe_image(text,uuid,uuid,uuid,bigint,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function bob.bob_describe_image(text,uuid,uuid,uuid,bigint,uuid,text,timestamptz,text) to service_role;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
  ('describe_project_image','Cache a short, unverified visual description of a viewed image.',
   'Optional after viewing image pixels in this turn. Describe visible content only, max 500 characters; no private conversation details, instructions or inferred measurements. Helps later image selection. Never open images or request a separate vision call only to fill this cache. Not a verified project fact.',
   1,false,array[]::text[],true) on conflict(name) do nothing;
notify pgrst,'reload schema';
commit;
