-- Owner decision 2026-10-29, after an independent review of the material
-- tables: the combined lookup matches whole words and lists exact hits first,
-- and stock at home is null (not recorded) instead of an empty list.
--
-- The first version also matched when the query merely contained an alias of
-- three or more characters, so "utomhusskruv" returned six indoor screws
-- through their alias "skruv", "gipsskruv" returned gypsum boards and wood
-- screws, and "12x45" returned 45 × 95. Now every word of the query must equal
-- a word of the definition (its name, aliases, material, size label or their
-- aliases), or be the last part of a Swedish compound word in it ("skruv"
-- finds "träskruv"). Decimal commas, "4,0" = "4" and "45x95" = "45 × 95" are
-- normalized, and the words mm, cm and st are ignored. Definitions whose words
-- all match exactly come first. The cursor format is unchanged; a cursor whose
-- definition no longer matches is rejected instead of ending the list early.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.material_tokens(p text) returns text[]
 language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct w order by w),'{}') from (
  select btrim(w,'.') w from regexp_split_to_table(
   regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p,'')),
    '([0-9])[.,]([0-9])','\1.\2','g'),
    '([0-9])\.0+(?![0-9])','\1','g'),
    '([0-9])\s*[x×*]\s*(?=[0-9])','\1 x ','g'),
   '[^0-9a-zåäöéüæø.]+') w
 ) words where w not in ('','.')
$$;
revoke all on function bob_private.material_tokens(text) from public,anon,authenticated;

create or replace function bob.material_lookup(p_project text,p_input jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); words text[]; v_id uuid; c_item uuid; c_article uuid; c_rank integer; required_categories text[]; households uuid[];
 ids uuid[]; ranks integer[]; rows jsonb; n integer; result jsonb;
 none constant uuid:='00000000-0000-0000-0000-000000000000';
begin
 if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>4000 or p_input-array['query','categories','after','id']<>'{}'
   or (select count(*) from jsonb_object_keys(p_input))<>4 or jsonb_typeof(p_input->'categories') is distinct from 'array' or jsonb_array_length(p_input->'categories')>12
   or exists(select 1 from jsonb_array_elements(p_input->'categories') c where jsonb_typeof(c)<>'string')
   or (p_input->'query'<>'null'::jsonb and (jsonb_typeof(p_input->'query')<>'string' or char_length(btrim(p_input->>'query')) not between 1 and 200))
   or (p_input->'after'<>'null'::jsonb and (jsonb_typeof(p_input->'after')<>'string'
     or p_input->>'after'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-))?$')) then
   raise exception 'material_lookup_invalid' using errcode='22023'; end if;
 begin
  v_id:=case when p_input->'id'='null'::jsonb then null else (p_input->>'id')::uuid end;
 exception when invalid_text_representation then raise exception 'material_lookup_invalid' using errcode='22023'; end;
 if p_input->'after'<>'null'::jsonb then
  c_item:=split_part(p_input->>'after',':',1)::uuid;
  -- A bare combination id continues after all of that combination's rows.
  c_article:=case split_part(p_input->>'after',':',2) when '' then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid when '-' then none else split_part(p_input->>'after',':',2)::uuid end;
 end if;
 select coalesce(array_agg(c),'{}') into required_categories from jsonb_array_elements_text(p_input->'categories') c;
 if exists(select 1 from unnest(required_categories) c where not exists(select 1 from bob.catalog_categories where code=c)) then raise exception 'catalog_unknown_category' using errcode='22023'; end if;
 if p_input->'query'<>'null'::jsonb then
  words:=bob_private.material_tokens(p_input->>'query');
  -- Unit words carry no meaning on their own; keep them only if nothing else is left.
  if cardinality(array(select w from unnest(words) w where w not in ('mm','cm','st','x')))>0 then
   words:=array(select w from unnest(words) w where w not in ('mm','cm','st','x')); end if;
 end if;
 -- Stock is shown only for households the caller actively belongs to.
 select coalesce(array_agg(a.household_id),'{}') into households from shared.household_access a where a.user_id=uid and a.status='active';
 with recursive descendants as (
   select code as root,code from bob.catalog_categories where code=any(required_categories)
   union select d.root,c.code from bob.catalog_categories c join descendants d on c.parent_code=d.code
 ), candidates as (
  select h.id,case when words is null then '{}'::text[] else bob_private.material_tokens(concat_ws(' ',r.name,array_to_string(r.aliases,' '),t.name,s.label,
    (select string_agg(a.alias,' ') from bob.material_aliases a
      where a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id))) end as tokens
  from bob.catalog_items h join bob.catalog_item_revisions r on r.item_id=h.id and r.revision=h.current_revision
   left join bob.material_types t on t.id=h.material_type_id left join bob.material_sizes s on s.id=h.material_size_id
  where h.kind='material' and (h.project_id is null or h.project_id=p_project) and (v_id is null or h.id=v_id)
   and not exists(select 1 from unnest(required_categories) c where not exists(select 1 from bob.catalog_item_categories ic join descendants d on d.code=ic.category_code
     where d.root=c and ic.item_id=h.id and ic.item_revision=h.current_revision))
 ), matched as (
  select c.id,case when words is null or words<@c.tokens then 0 else 1 end as rank from candidates c
  where words is null or not exists(select 1 from unnest(words) q where not exists(select 1 from unnest(c.tokens) w
    where w=q or (char_length(q)>=4 and char_length(w)>char_length(q) and right(w,char_length(q))=q)))
 ) select coalesce(array_agg(id order by rank,id),'{}'),coalesce(array_agg(rank order by rank,id),'{}') into ids,ranks from matched;
 if c_item is not null then
  c_rank:=ranks[array_position(ids,c_item)];
  if c_rank is null then raise exception 'material_lookup_cursor_stale' using errcode='22023'; end if;
 end if;
 with page as (
  select m.id as item_id,m.rank,a.id as article_id from unnest(ids,ranks) m(id,rank) left join bob.store_articles a on a.catalog_item_id=m.id
  where c_item is null or (m.rank,m.id,coalesce(a.id,none))>(c_rank,c_item,c_article)
  order by m.rank,m.id,coalesce(a.id,none) limit 13
 ) select coalesce(jsonb_agg(bob_private.material_lookup_row(page.item_id,page.article_id,households) order by page.rank,page.item_id,coalesce(page.article_id,none)),'[]'::jsonb)
   into rows from page;
 n:=jsonb_array_length(rows);
 if n>12 then rows:=rows-12; end if;
 result:=jsonb_build_object('status',case when n=0 then 'empty' else 'ok' end,'projectId',p_project,'grain','combination_store_article',
  'items',rows,'truncated',n>12,'next_cursor',case when n>12 then (rows->-1->>'id')||':'||coalesce(rows->-1->>'store_article_id','-') else null end);
 -- Same envelope cap as other Bob reads: drop trailing rows and page on.
 while octet_length(result::text)>30000 loop
  n:=jsonb_array_length(result->'items');
  if n<=1 then raise exception 'material_lookup_too_large' using errcode='22023'; end if;
  rows:=(result->'items')-(n-1);
  result:=result||jsonb_build_object('items',rows,'truncated',true,'next_cursor',(rows->-1->>'id')||':'||coalesce(rows->-1->>'store_article_id','-'));
 end loop;
 return result;
end $$;
revoke all on function bob.material_lookup(text,jsonb) from public,anon;
grant execute on function bob.material_lookup(text,jsonb) to authenticated;

-- Stock at home: null when nothing is recorded for the caller's households.
-- There is no write path yet, and an empty list would read as "none at home".
do $stock_unknown$
declare definition text;
 anchor constant text:=$a$order by x.updated_at desc limit 10) st
    left join shared.households hh on hh.id=st.household_id),'[]'::jsonb),$a$;
 replacement constant text:=$a$order by x.updated_at desc limit 10) st
    left join shared.households hh on hh.id=st.household_id)),$a$;
 head_from constant text:=$a$'stock_at_home',coalesce((select$a$;
 head_to constant text:=$a$'stock_at_home',((select$a$;
begin
 definition:=pg_get_functiondef('bob_private.material_lookup_row(uuid,uuid,uuid[])'::regprocedure);
 if (char_length(definition)-char_length(replace(definition,anchor,'')))/char_length(anchor)<>1
   or (char_length(definition)-char_length(replace(definition,head_from,'')))/char_length(head_from)<>1 then
  raise exception 'material_stock_anchor'; end if;
 execute replace(replace(definition,anchor,replacement),head_from,head_to);
end $stock_unknown$;
commit;
