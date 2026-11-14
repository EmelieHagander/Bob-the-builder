-- 2026-11-14: a stored OpenAI file id belongs to the OpenAI account that
-- uploaded it. After the owner switched OpenAI accounts (2026-11-02) Bob kept
-- sending file ids from the old account; OpenAI answered 404 "file not found"
-- and the whole turn died (job d8a24673, 2026-11-14 10:16, ai_unavailable).
-- The account is now part of the cache key: the Edge passes a one-way tag of
-- its API key (first 32 hex of its SHA-256, never the key), a lookup only
-- matches rows from that same account, and a new key simply uploads again.
-- Rows from before have no account and are removed (the image itself stays in
-- bob storage; this table is only a derived, expiring provider link).
-- Release: either order is safe. Until the Edge is deployed, a lookup with the
-- old signature fails and the image is sent as pixels.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

delete from bob_private.image_provider_files;
alter table bob_private.image_provider_files add column account text not null check(account ~ '^[0-9a-f]{32}$');

drop function bob.bob_image_provider_file(text,uuid,text);
create function bob.bob_image_provider_file(p_project text,p_media uuid,p_revision text,p_account text)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  return (select f.file_id from bob_private.image_provider_files f join bob.media_assets m on m.id=f.media_id
    where f.media_id=p_media and f.provider='openai' and f.revision=p_revision and f.account=p_account and m.project_id=p_project and m.state='ready'
      and m.updated_at=f.source_updated_at and f.expires_at>clock_timestamp()+interval '1 hour');
end $$;
revoke all on function bob.bob_image_provider_file(text,uuid,text,text) from public,anon;
grant execute on function bob.bob_image_provider_file(text,uuid,text,text) to authenticated;

drop function bob.bob_record_image_provider_file(text,uuid,uuid,uuid,bigint,uuid,text,timestamptz,text,text,timestamptz);
create function bob.bob_record_image_provider_file(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,
  p_media uuid,p_revision text,p_updated_at timestamptz,p_sha256 text,p_file_id text,p_expires_at timestamptz,p_account text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  perform 1 from bob.media_assets where id=p_media and project_id=p_project and state='ready' and updated_at=p_updated_at for share;
  if not found then raise exception 'context_changed' using errcode='PT409'; end if;
  if p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '31 days' then raise exception 'invalid_expiry'; end if;
  insert into bob_private.image_provider_files(media_id,provider,revision,source_updated_at,byte_sha256,file_id,expires_at,account)
    values(p_media,'openai',p_revision,p_updated_at,p_sha256,p_file_id,p_expires_at,p_account)
    on conflict(media_id,provider) do update set revision=excluded.revision,source_updated_at=excluded.source_updated_at,
      byte_sha256=excluded.byte_sha256,file_id=excluded.file_id,expires_at=excluded.expires_at,account=excluded.account,created_at=clock_timestamp();
  return true;
end $$;
revoke all on function bob.bob_record_image_provider_file(text,uuid,uuid,uuid,bigint,uuid,text,timestamptz,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function bob.bob_record_image_provider_file(text,uuid,uuid,uuid,bigint,uuid,text,timestamptz,text,text,timestamptz,text) to service_role;
notify pgrst,'reload schema';
commit;
