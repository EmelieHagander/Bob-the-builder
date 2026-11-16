-- Building knowledge handbook passages (owner decision 2026-11-15: give Bob and
-- Konrad real reference knowledge "in the vector"). A source is a whole,
-- openly licensed reference book; passages are its text split by chapter and
-- page; embeddings are a disposable index of those passages. Only sources whose
-- licence permits storing and showing their text are admitted.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table bob_private.knowledge_sources (
  id text primary key check (id ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  title text not null check (char_length(title) between 1 and 300),
  publisher text not null check (char_length(publisher) between 1 and 300),
  edition text not null check (char_length(edition) between 1 and 200),
  url text not null check (url ~ '^https://'),
  document_url text not null check (document_url ~ '^https://'),
  -- A licence that permits storing, embedding and quoting the full text.
  rights text not null check (rights in ('us_federal_public_domain')),
  jurisdiction text not null check (jurisdiction in ('SE','general')),
  language text not null check (language ~ '^[a-z]{2}$'),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  extraction text not null check (char_length(extraction) between 1 and 500),
  limitations text not null check (char_length(limitations) between 1 and 1000),
  status text not null default 'active' check (status in ('active','withdrawn')),
  reviewed_at date not null,
  created_at timestamptz not null default clock_timestamp()
);

create table bob_private.knowledge_passages (
  id text primary key check (id ~ '^[a-z0-9_.:-]{1,80}$'),
  source_id text not null references bob_private.knowledge_sources(id) on delete cascade,
  ordinal integer not null check (ordinal >= 1),
  chapter integer check (chapter >= 1),
  chapter_title text check (char_length(chapter_title) <= 200),
  page_label text check (char_length(page_label) <= 20),
  pdf_page integer not null check (pdf_page >= 1),
  text text not null check (char_length(text) between 1 and 4000),
  fingerprint text generated always as (md5(text)) stored,
  unique (source_id, ordinal)
);
create index knowledge_passages_fts on bob_private.knowledge_passages
  using gin (to_tsvector('pg_catalog.english'::regconfig, text));

create table bob_private.knowledge_passage_embeddings (
  passage_id text not null references bob_private.knowledge_passages(id) on delete cascade,
  model text not null check (char_length(model) between 1 and 120),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{32}$'),
  embedding extensions.vector(256) not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (passage_id, model)
);

alter table bob_private.knowledge_sources enable row level security;
alter table bob_private.knowledge_passages enable row level security;
alter table bob_private.knowledge_passage_embeddings enable row level security;
revoke all on bob_private.knowledge_sources, bob_private.knowledge_passages, bob_private.knowledge_passage_embeddings
  from public, anon, authenticated;

-- A bounded batch of passages without a current embedding for this model.
create function bob.knowledge_index_pending(p_limit integer, p_model text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare rows jsonb; total integer;
begin
  if p_limit is null or p_limit not between 1 and 256 or p_model is null or char_length(p_model) not between 1 and 120 then
    raise exception 'invalid_knowledge_index' using errcode='22023'; end if;
  with pending as (
    select p.id,p.fingerprint,p.text from bob_private.knowledge_passages p
    join bob_private.knowledge_sources s on s.id=p.source_id and s.status='active'
    where not exists(select 1 from bob_private.knowledge_passage_embeddings e
      where e.passage_id=p.id and e.model=p_model and e.source_fingerprint=p.fingerprint)
    order by p.source_id,p.ordinal limit p_limit+1
  ), numbered as (select *,row_number() over(order by id) n from pending)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'fingerprint',fingerprint,'text',text) order by id) filter(where n<=p_limit),'[]'::jsonb),
    count(*) into rows,total from numbered;
  return jsonb_build_object('passages',rows,'hasMore',total>p_limit,
    'remaining',(select count(*) from bob_private.knowledge_passages p join bob_private.knowledge_sources s on s.id=p.source_id and s.status='active'
      where not exists(select 1 from bob_private.knowledge_passage_embeddings e where e.passage_id=p.id and e.model=p_model and e.source_fingerprint=p.fingerprint)));
end $$;
revoke all on function bob.knowledge_index_pending(integer,text) from public,anon,authenticated;
grant execute on function bob.knowledge_index_pending(integer,text) to service_role;

-- Saves embeddings for the exact passage text they were made from.
create function bob.knowledge_index_save(p_items jsonb, p_model text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='30s' set lock_timeout='3s' as $$
declare item jsonb; current_fingerprint text; stored integer:=0; value extensions.vector(256);
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 256
    or p_model is null or char_length(p_model) not between 1 and 120 then
    raise exception 'invalid_knowledge_index' using errcode='22023'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' or not(item ?& array['id','fingerprint','embedding'])
      or jsonb_typeof(item->'embedding')<>'array' or jsonb_array_length(item->'embedding')<>256
      or exists(select 1 from jsonb_array_elements(item->'embedding') v where jsonb_typeof(v)<>'number') then
      raise exception 'invalid_knowledge_index' using errcode='22023'; end if;
    select fingerprint into current_fingerprint from bob_private.knowledge_passages where id=item->>'id';
    if not found or current_fingerprint is distinct from item->>'fingerprint' then
      raise exception 'knowledge_source_changed' using errcode='40001'; end if;
    value:=(item->'embedding')::text::extensions.vector(256);
    if (value operator(extensions.<#>) value)>=0 then raise exception 'invalid_knowledge_index' using errcode='22023'; end if;
    insert into bob_private.knowledge_passage_embeddings(passage_id,model,source_fingerprint,embedding)
      values(item->>'id',p_model,current_fingerprint,value)
      on conflict(passage_id,model) do update set source_fingerprint=excluded.source_fingerprint,
        embedding=excluded.embedding,updated_at=clock_timestamp();
    stored:=stored+1;
  end loop;
  return jsonb_build_object('saved',stored);
end $$;
revoke all on function bob.knowledge_index_save(jsonb,text) from public,anon,authenticated;
grant execute on function bob.knowledge_index_save(jsonb,text) to service_role;

-- Hybrid search: English full text and, when an embedding is supplied,
-- semantic distance over current embeddings, combined by reciprocal rank.
-- Stale vectors (text changed) never match. Withdrawn sources are excluded.
create function bob.search_knowledge_passages(p_query text, p_embedding extensions.vector(256) default null, p_model text default '', p_jurisdiction text default 'general', p_limit integer default 4)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare rows jsonb; has_semantic boolean;
begin
  if p_query is null or char_length(btrim(p_query)) not between 1 and 500 or p_limit is null or p_limit not between 1 and 8
    or p_jurisdiction not in ('SE','general') or p_model is null or char_length(p_model)>120
    or (p_embedding is not null and (p_model='' or (p_embedding operator(extensions.<#>) p_embedding)>=0)) then
    raise exception 'invalid_knowledge_search' using errcode='22023'; end if;
  with scoped as not materialized (
    select p.*,s.title source_title,s.edition,s.url,s.document_url,s.rights,s.reviewed_at,s.limitations
    from bob_private.knowledge_passages p join bob_private.knowledge_sources s on s.id=p.source_id
    where s.status='active' and (s.jurisdiction='general' or s.jurisdiction=p_jurisdiction)
  ), lexical as (
    select id,row_number() over(order by ts_rank_cd(to_tsvector('pg_catalog.english'::regconfig,text),websearch_to_tsquery('pg_catalog.english'::regconfig,p_query)) desc,id) rank
    from scoped where to_tsvector('pg_catalog.english'::regconfig,text) @@ websearch_to_tsquery('pg_catalog.english'::regconfig,p_query)
    order by rank limit 24
  ), semantic as (
    select m.id,row_number() over(order by e.embedding operator(extensions.<=>) p_embedding,m.id) rank
    from scoped m join bob_private.knowledge_passage_embeddings e on e.passage_id=m.id and e.source_fingerprint=m.fingerprint
    where p_embedding is not null and e.model=p_model
    order by e.embedding operator(extensions.<=>) p_embedding,m.id limit 24
  ), ranked as (
    select coalesce(l.id,s.id) id,coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+s.rank),0) score
    from lexical l full join semantic s using(id)
  ), chosen as (
    select m.*,r.score from ranked r join scoped m using(id) order by r.score desc,m.id limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'source_id',source_id,'source_title',source_title,'edition',edition,
    'url',url,'document_url',document_url,'rights',rights,'reviewed_at',reviewed_at,'limitations',limitations,
    'chapter',chapter,'chapter_title',chapter_title,'page',page_label,'pdf_page',pdf_page,'text',text) order by score desc,id),'[]'::jsonb)
  into rows from chosen;
  select p_embedding is not null and exists(select 1 from bob_private.knowledge_passage_embeddings e where e.model=p_model) into has_semantic;
  return jsonb_build_object('passages',rows,'searchMode',case when has_semantic then 'hybrid' else 'lexical' end);
end $$;
revoke all on function bob.search_knowledge_passages(text,extensions.vector,text,text,integer) from public,anon,authenticated;
grant execute on function bob.search_knowledge_passages(text,extensions.vector,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
