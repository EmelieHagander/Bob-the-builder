-- Owner decision 2026-11-14: Bob never depends on a provider's copy of an
-- image. He sends our own image reference (resolved to pixels from bob storage
-- for the request that uses it) and, once used, its description.
-- The OpenAI file-id cache (20261019120000) is removed: its ids belonged to
-- the OpenAI account that uploaded them, and after the account switch on
-- 2026-11-02 OpenAI answered 404 "file not found" and the turn died
-- (job d8a24673, 2026-11-14 10:16, ai_unavailable).
-- Release: deploy the Edge first (it no longer calls these); applying this
-- before is also safe, because a failed lookup already fell back to pixels.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
drop function if exists bob.bob_image_provider_file(text,uuid,text);
drop function if exists bob.bob_record_image_provider_file(text,uuid,uuid,uuid,bigint,uuid,text,timestamptz,text,text,timestamptz);
drop table if exists bob_private.image_provider_files;
notify pgrst,'reload schema';
commit;
