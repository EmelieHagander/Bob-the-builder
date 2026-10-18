-- Source-linked retrieval for one claimed private conversation. Original text and
-- project truth stay in their existing tables; embeddings are disposable indexes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table bob_private.bob_message_embeddings (
  thread_id uuid not null,
  seq bigint not null,
  chunk_start integer not null check (chunk_start >= 0 and chunk_start % 2000 = 0),
  model text not null check (char_length(model) between 1 and 120),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{32}$'),
  embedding extensions.vector(256) not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (thread_id, seq, chunk_start, model),
  foreign key (thread_id, seq) references bob.bob_messages(thread_id, seq) on delete cascade
);
alter table bob_private.bob_message_embeddings enable row level security;
revoke all on bob_private.bob_message_embeddings from public, anon, authenticated;
-- Cover source-completeness checks without loading vector payloads.
create index bob_message_embeddings_source on bob_private.bob_message_embeddings
  (thread_id, model, seq, source_fingerprint, chunk_start);
-- A private thread is deliberately searched exactly. A global approximate index
-- could drop scoped matches; no project/member's text enters another scope.
create index bob_messages_memory_fts on bob.bob_messages
  using gin (to_tsvector('pg_catalog.simple'::regconfig, text));

create function bob.bob_read_context_message(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_seq bigint,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare m bob.bob_messages; total integer; scope jsonb;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  if p_seq is null or p_seq<1 or p_offset is null or p_offset<0 then
    raise exception 'invalid_history_source' using errcode='22023'; end if;
  scope:=jsonb_build_object('projectId',p_project,'threadId',p_thread);
  select * into m from bob.bob_messages where thread_id=p_thread and seq=p_seq;
  if not found then return scope||jsonb_build_object('status','missing'); end if;
  total:=char_length(m.text);
  if p_offset>=total then return scope||jsonb_build_object('status','invalid_offset','totalCharacters',total); end if;
  return scope||jsonb_build_object('status','ok',
    'message',jsonb_build_object('seq',m.seq,'role',m.role,'state',m.delivery_state,'text',substring(m.text from p_offset+1 for 4000)),
    'source',jsonb_build_object('seq',m.seq,'messageId',m.id,'fingerprint',md5(m.text),'createdAt',m.created_at),
    'offset',p_offset,'totalCharacters',total,'nextOffset',case when p_offset+4000<total then p_offset+4000 else null end);
end $$;
revoke all on function bob.bob_read_context_message(text,uuid,uuid,uuid,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function bob.bob_read_context_message(text,uuid,uuid,uuid,bigint,bigint,integer) to service_role;

-- A bounded batch, including old conversations, is selected on demand. The
-- current user request is indexed on a later turn, after it becomes history.
create function bob.bob_context_index_pending(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_limit integer,p_model text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare rows jsonb; total integer;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  if p_limit is null or p_limit not between 1 and 8 or p_model is null or char_length(p_model) not between 1 and 120 then
    raise exception 'invalid_memory_index' using errcode='22023'; end if;
  -- Skip complete messages before expanding offsets. The count is over at
  -- most 50 compact index entries per message, including holes after an
  -- interrupted/rebuilt cache; checking only the final chunk would hide holes.
  with candidates as materialized (
    select m.seq,m.text,md5(m.text) fingerprint from bob.bob_messages m
    where m.thread_id=p_thread and not(m.turn_id=p_turn and m.role='user')
      and (select count(*) from bob_private.bob_message_embeddings e where e.thread_id=m.thread_id and e.seq=m.seq
        and e.model=p_model and e.source_fingerprint=md5(m.text) and e.chunk_start<char_length(m.text)) < (char_length(m.text)+1999)/2000
    order by m.seq limit p_limit+1
  ), pending as (
    select m.seq,c.chunk_start,m.fingerprint,substring(m.text from c.chunk_start+1 for 2000) text
    from candidates m cross join lateral generate_series(0,char_length(m.text)-1,2000) c(chunk_start)
    where not exists(select 1 from bob_private.bob_message_embeddings e where e.thread_id=p_thread and e.seq=m.seq
      and e.chunk_start=c.chunk_start and e.model=p_model and e.source_fingerprint=m.fingerprint)
    order by m.seq,c.chunk_start limit p_limit+1
  ), numbered as (select *,row_number() over(order by seq,chunk_start) n from pending)
  select coalesce(jsonb_agg(jsonb_build_object('seq',seq,'chunkStart',chunk_start,'fingerprint',fingerprint,'text',text) order by seq,chunk_start)
    filter(where n<=p_limit),'[]'::jsonb),count(*) into rows,total from numbered;
  return jsonb_build_object('projectId',p_project,'threadId',p_thread,'chunks',rows,'hasMore',total>p_limit);
end $$;
revoke all on function bob.bob_context_index_pending(text,uuid,uuid,uuid,bigint,integer,text) from public,anon,authenticated;
grant execute on function bob.bob_context_index_pending(text,uuid,uuid,uuid,bigint,integer,text) to service_role;

create function bob.bob_context_index_save(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_items jsonb,p_model text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare item jsonb; original text; source_seq bigint; start_at integer; stored integer:=0; value extensions.vector(256);
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 8
    or p_model is null or char_length(p_model) not between 1 and 120 then
    raise exception 'invalid_memory_index' using errcode='22023'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' or not(item ?& array['seq','chunkStart','fingerprint','embedding'])
      or jsonb_typeof(item->'embedding')<>'array' or jsonb_array_length(item->'embedding')<>256
      or exists(select 1 from jsonb_array_elements(item->'embedding') v where jsonb_typeof(v)<>'number') then
      raise exception 'invalid_memory_index' using errcode='22023'; end if;
    source_seq:=(item->>'seq')::bigint; start_at:=(item->>'chunkStart')::integer;
    select text into original from bob.bob_messages where thread_id=p_thread and seq=source_seq and not(turn_id=p_turn and role='user');
    if not found or start_at<0 or start_at%2000<>0 or start_at>=char_length(original)
      or item->>'fingerprint' is distinct from md5(original) then
      raise exception 'context_source_changed' using errcode='40001'; end if;
    value:=(item->'embedding')::text::extensions.vector(256);
    if (value operator(extensions.<#>) value)>=0 then raise exception 'invalid_memory_index' using errcode='22023'; end if;
    insert into bob_private.bob_message_embeddings(thread_id,seq,chunk_start,model,source_fingerprint,embedding)
      values(p_thread,source_seq,start_at,p_model,md5(original),value)
      on conflict(thread_id,seq,chunk_start,model) do update set source_fingerprint=excluded.source_fingerprint,
        embedding=excluded.embedding,updated_at=clock_timestamp();
    stored:=stored+1;
  end loop;
  return jsonb_build_object('projectId',p_project,'threadId',p_thread,'saved',stored);
end $$;
revoke all on function bob.bob_context_index_save(text,uuid,uuid,uuid,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_context_index_save(text,uuid,uuid,uuid,bigint,jsonb,text) to service_role;

-- RRF ranks each query's text and semantic matches. A source fingerprint is
-- rechecked against the original on every retrieval; stale vectors cannot win.
-- Ranked search returns excerpts + direct source references, not a misleading
-- chronological cursor. Empty-query browsing keeps chronological pagination.
create function bob.bob_search_context_memory(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_query text,p_before_seq bigint default null,p_embedding extensions.vector(256) default null,p_model text default '')
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare rows jsonb:='[]'::jsonb; sources jsonb:='[]'::jsonb; r record; more boolean:=false; cursor bigint; has_semantic boolean;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  if p_query is null or char_length(p_query)>200 or (p_before_seq is not null and p_before_seq<1)
    or p_model is null or char_length(p_model)>120 or (p_embedding is not null and (p_model='' or (p_embedding operator(extensions.<#>) p_embedding)>=0)) then
    raise exception 'invalid_history_search' using errcode='22023'; end if;
  if btrim(p_query)='' then
    for r in select * from bob.bob_messages where thread_id=p_thread and not(turn_id=p_turn and role='user')
      and (p_before_seq is null or seq<p_before_seq) order by seq desc limit 6 loop
      if jsonb_array_length(rows)=5 then more:=true; exit; end if;
      rows:=rows||jsonb_build_array(jsonb_build_object('seq',r.seq,'role',r.role,'state',r.delivery_state,'text',left(r.text,1600)));
      sources:=sources||jsonb_build_array(jsonb_build_object('seq',r.seq,'messageId',r.id,'fingerprint',md5(r.text),'offset',0,'totalCharacters',char_length(r.text)));
      cursor:=r.seq;
    end loop;
    return jsonb_build_object('projectId',p_project,'threadId',p_thread,'messages',rows,'sources',sources,
      'searchMode','browse','truncated',more,'nextBeforeSeq',case when more then cursor else null end);
  end if;
  for r in
    with scoped as not materialized (
      select m.*,md5(m.text) fingerprint from bob.bob_messages m where m.thread_id=p_thread
        and not(m.turn_id=p_turn and m.role='user') and (p_before_seq is null or m.seq<p_before_seq)
    ), lexical as (
      select seq,greatest(position(lower(p_query) in lower(text))-201,0) chunk_start,row_number() over(order by (position(lower(p_query) in lower(text))>0) desc,
        ts_rank_cd(to_tsvector('pg_catalog.simple'::regconfig,text),websearch_to_tsquery('pg_catalog.simple'::regconfig,p_query)) desc,seq desc) rank
      from scoped where position(lower(p_query) in lower(text))>0
        or to_tsvector('pg_catalog.simple'::regconfig,text) @@ websearch_to_tsquery('pg_catalog.simple'::regconfig,p_query)
      order by rank limit 24
    ), distances as (
      select m.seq,min(e.embedding operator(extensions.<=>) p_embedding) distance,
        (array_agg(e.chunk_start order by e.embedding operator(extensions.<=>) p_embedding,e.chunk_start))[1] chunk_start
      from scoped m join bob_private.bob_message_embeddings e on e.thread_id=m.thread_id and e.seq=m.seq and e.source_fingerprint=m.fingerprint
      where p_embedding is not null and e.model=p_model group by m.seq
    ), semantic as (
      select seq,chunk_start,row_number() over(order by distance,seq desc) rank from distances where distance<0.8 order by distance,seq desc limit 24
    ), ranked as (
      select coalesce(l.seq,s.seq) seq,coalesce(s.chunk_start,l.chunk_start,0) chunk_start,
        coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+s.rank),0) score
      from lexical l full join semantic s using(seq)
    ) select m.*,chosen.chunk_start,chosen.score from ranked chosen join scoped m using(seq) order by chosen.score desc,m.seq desc limit 6
  loop
    if jsonb_array_length(rows)=5 then more:=true; exit; end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('seq',r.seq,'role',r.role,'state',r.delivery_state,'text',substring(r.text from r.chunk_start+1 for 1600)));
    sources:=sources||jsonb_build_array(jsonb_build_object('seq',r.seq,'messageId',r.id,'fingerprint',r.fingerprint,
      'offset',r.chunk_start,'totalCharacters',char_length(r.text)));
  end loop;
  -- Coverage is intentionally not counted over the whole transcript. Exact
  -- and text retrieval work immediately; semantic indexing fills on demand.
  select exists(select 1 from bob_private.bob_message_embeddings e join bob.bob_messages m on m.thread_id=e.thread_id and m.seq=e.seq
    where e.thread_id=p_thread and e.model=p_model and e.source_fingerprint=md5(m.text)
      and not(m.turn_id=p_turn and m.role='user') and (p_before_seq is null or m.seq<p_before_seq)) into has_semantic;
  return jsonb_build_object('projectId',p_project,'threadId',p_thread,'messages',rows,'sources',sources,
    'searchMode',case when p_embedding is not null and has_semantic then 'hybrid' else 'lexical' end,
    'truncated',more,'nextBeforeSeq',null,'refineQuery',more,'semanticCoverage','on_demand');
end $$;
revoke all on function bob.bob_search_context_memory(text,uuid,uuid,uuid,bigint,text,bigint,extensions.vector,text) from public,anon,authenticated;
grant execute on function bob.bob_search_context_memory(text,uuid,uuid,uuid,bigint,text,bigint,extensions.vector,text) to service_role;

-- Repack an existing completed summary without moving its source watermark.
-- The exact prior text participates in CAS so concurrent refreshes cannot win.
create function bob.bob_refresh_context_summary(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_expected_seq bigint,p_expected_summary text,p_summary text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare frame jsonb;
begin
  frame:=bob.bob_load_context(p_project,p_user,p_thread,p_turn,p_generation);
  if p_summary is null or char_length(btrim(p_summary)) not between 1 and 12000
    or p_expected_seq is distinct from (frame->>'lastFoldedSeq')::bigint
    or p_expected_summary is distinct from frame->>'summary'
    or jsonb_array_length(frame->'older')<>0 or (frame->>'hasMore')::boolean then
    raise exception 'context_changed' using errcode='40001'; end if;
  update bob_private.bob_thread_summary set summary=p_summary,updated_at=clock_timestamp() where thread_id=p_thread;
  return jsonb_build_object('lastFoldedSeq',p_expected_seq);
end $$;
revoke all on function bob.bob_refresh_context_summary(text,uuid,uuid,uuid,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function bob.bob_refresh_context_summary(text,uuid,uuid,uuid,bigint,bigint,text,text) to service_role;
notify pgrst,'reload schema';
commit;
