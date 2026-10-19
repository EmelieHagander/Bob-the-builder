-- Owner request 2026-10-19: store an image's OpenAI file id as metadata on
-- our own image, so Bob stops re-sending the pixels on every fresh request.
-- The image stays in bob storage as the source of truth; the file id is a
-- derived, expiring provider link for one exact image revision only.
-- Deploy both Bob runtimes before applying; until then nothing calls these.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.image_provider_files (
  media_id uuid not null references bob.media_assets(id) on delete cascade,
  provider text not null check(provider='openai'),
  revision text not null check(revision ~ '^[0-9a-f]{64}$'),
  source_updated_at timestamptz not null,
  byte_sha256 text not null check(byte_sha256 ~ '^[0-9a-f]{64}$'),
  file_id text not null check(file_id ~ '^file-[A-Za-z0-9_-]{1,120}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(media_id,provider)
);
alter table bob_private.image_provider_files enable row level security;
revoke all on bob_private.image_provider_files from public,anon,authenticated;

-- Caller-scoped read: only a project member, only the exact current revision,
-- and only while the provider copy has at least an hour left.
create function bob.bob_image_provider_file(p_project text,p_media uuid,p_revision text)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  return (select f.file_id from bob_private.image_provider_files f join bob.media_assets m on m.id=f.media_id
    where f.media_id=p_media and f.provider='openai' and f.revision=p_revision and m.project_id=p_project and m.state='ready'
      and m.updated_at=f.source_updated_at and f.expires_at>clock_timestamp()+interval '1 hour');
end $$;
revoke all on function bob.bob_image_provider_file(text,uuid,text) from public,anon;
grant execute on function bob.bob_image_provider_file(text,uuid,text) to authenticated;

create function bob.bob_record_image_provider_file(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,
  p_media uuid,p_revision text,p_updated_at timestamptz,p_sha256 text,p_file_id text,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  perform 1 from bob.media_assets where id=p_media and project_id=p_project and state='ready' and updated_at=p_updated_at for share;
  if not found then raise exception 'context_changed' using errcode='40001'; end if;
  if p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '31 days' then raise exception 'invalid_expiry'; end if;
  insert into bob_private.image_provider_files(media_id,provider,revision,source_updated_at,byte_sha256,file_id,expires_at)
    values(p_media,'openai',p_revision,p_updated_at,p_sha256,p_file_id,p_expires_at)
    on conflict(media_id,provider) do update set revision=excluded.revision,source_updated_at=excluded.source_updated_at,
      byte_sha256=excluded.byte_sha256,file_id=excluded.file_id,expires_at=excluded.expires_at,created_at=clock_timestamp();
  return true;
end $$;
revoke all on function bob.bob_record_image_provider_file(text,uuid,uuid,uuid,bigint,uuid,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;
grant execute on function bob.bob_record_image_provider_file(text,uuid,uuid,uuid,bigint,uuid,text,timestamptz,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
