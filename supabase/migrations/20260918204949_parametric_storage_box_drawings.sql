-- 2D parametric drawings remain revisions of the existing Artifact, not a new
-- document/project silo. No existing measurements or shared-app tables change.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function bob_private.valid_storage_box_recipe(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; n numeric; w numeric; h numeric; d numeric; t numeric;
begin
  if p is null or jsonb_typeof(p)<>'object'
    or p - array['generator','version','width_mm','height_mm','depth_mm','thickness_mm']::text[] <> '{}'::jsonb
    or (select count(*) from jsonb_object_keys(p))<>6
    or p->>'generator' is distinct from 'storage_box_v1'
    or p->'version' is distinct from '1'::jsonb then return false; end if;
  foreach k in array array['width_mm','height_mm','depth_mm','thickness_mm'] loop
    if jsonb_typeof(p->k) is distinct from 'number' then return false; end if;
    n := (p->>k)::numeric;
    if n<=0 or n>(case when k='thickness_mm' then 100 else 10000 end)
      or trunc(n*1000)<>n*1000 then return false; end if;
  end loop;
  w:=(p->>'width_mm')::numeric; h:=(p->>'height_mm')::numeric;
  d:=(p->>'depth_mm')::numeric; t:=(p->>'thickness_mm')::numeric;
  return w>2*t and d>2*t and h>t;
end $$;
revoke all on function bob_private.valid_storage_box_recipe(jsonb) from public,anon;
grant execute on function bob_private.valid_storage_box_recipe(jsonb) to authenticated;

create table bob.artifact_parametric_recipes (
  project_id text not null references bob.projects(id) on delete cascade,
  artifact_id uuid not null,
  artifact_revision integer not null,
  recipe jsonb not null check (bob_private.valid_storage_box_recipe(recipe)),
  primary key(artifact_id,artifact_revision),
  foreign key(artifact_id,artifact_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade
);
create index artifact_parametric_recipes_project_idx on bob.artifact_parametric_recipes(project_id);
alter table bob.artifact_parametric_recipes enable row level security;
revoke all on bob.artifact_parametric_recipes from public,anon,authenticated;
grant select on bob.artifact_parametric_recipes to authenticated;
create policy project_read on bob.artifact_parametric_recipes for select to authenticated
  using (bob_private.has_project_access(project_id));
create view bob.current_parametric_recipes with (security_invoker=true) as
select p.* from bob.artifact_parametric_recipes p join bob.artifacts h
  on h.id=p.artifact_id and h.current_revision=p.artifact_revision and h.project_id=p.project_id;
revoke all on bob.current_parametric_recipes from public,anon,authenticated;
grant select on bob.current_parametric_recipes to authenticated;

-- Archive, restore and metadata edits carry the same recipe forward. Regenerate
-- replaces ONLY the newly created revision inside the command transaction.
create function bob_private.carry_parametric_artifact()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into bob.artifact_parametric_recipes(project_id,artifact_id,artifact_revision,recipe)
    select new.project_id,new.artifact_id,new.revision,p.recipe
    from bob.artifact_parametric_recipes p
    where p.project_id=new.project_id and p.artifact_id=new.artifact_id and p.artifact_revision=new.revision-1;
  return new;
end $$;
revoke all on function bob_private.carry_parametric_artifact() from public,anon,authenticated;
create trigger carry_parametric_artifact after insert on bob.artifact_revisions
  for each row execute function bob_private.carry_parametric_artifact();

create function bob_private.check_single_artifact_recipe()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from bob.artifact_parametric_recipes p join bob.artifact_generations g
    on g.artifact_id=p.artifact_id and g.artifact_revision=p.artifact_revision
    where p.artifact_id=new.artifact_id and p.artifact_revision=new.artifact_revision) then
    raise exception 'A drawing revision cannot have two geometry recipes';
  end if;
  return null;
end $$;
revoke all on function bob_private.check_single_artifact_recipe() from public,anon,authenticated;
create constraint trigger parametric_recipe_exclusive after insert or update on bob.artifact_parametric_recipes
  deferrable initially deferred for each row execute function bob_private.check_single_artifact_recipe();
create constraint trigger wall_recipe_exclusive after insert or update on bob.artifact_generations
  deferrable initially deferred for each row execute function bob_private.check_single_artifact_recipe();

create function bob_private.artifact_box_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; body jsonb; allowed text[];
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action is null or p_action<>all(array['create','regenerate']) or p_artifact is null or p_expected is null
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>24000
    or not bob_private.valid_storage_box_recipe(p_data->'recipe') then raise exception 'Invalid storage box drawing' using errcode='22023'; end if;
  allowed:=array['title','description','assumptions','target_revision','recipe','measurements'] ||
    case when p_action='create' then array['area_id'] else array['change_note'] end;
  if p_data-allowed<>'{}'::jsonb then raise exception 'Unsupported storage box fields' using errcode='22023'; end if;
  if p_action='regenerate' and not exists(select 1 from bob.artifact_parametric_recipes p
    join bob.artifacts a on a.id=p.artifact_id and a.project_id=p.project_id and a.current_revision=p.artifact_revision
    where p.project_id=p_project and p.artifact_id=p_artifact) then
    raise exception 'Current storage box drawing unavailable' using errcode='42501';
  end if;
  body:=jsonb_build_object('title',p_data->'title','description',p_data->'description','assumptions',p_data->'assumptions',
    'kind','detail','status','concept','source_media_id',null,'target_revision',p_data->'target_revision',
    'measurements',coalesce(p_data->'measurements','[]'::jsonb));
  body:=body || case when p_action='create' then jsonb_build_object('area_id',p_data->'area_id')
    else jsonb_build_object('change_note',p_data->'change_note') end;
  -- Canonical command owns target/Area binding, caller/project identity, evidence,
  -- optimistic revision checks, project locking and append-only history.
  saved:=bob_private.artifact_command(p_project,case when p_action='create' then 'create' else 'revise' end,p_artifact,p_expected,body);
  delete from bob.artifact_parametric_recipes where project_id=p_project and artifact_id=p_artifact and artifact_revision=(saved->>'revision')::integer;
  insert into bob.artifact_parametric_recipes(project_id,artifact_id,artifact_revision,recipe)
    values(p_project,p_artifact,(saved->>'revision')::integer,p_data->'recipe');
  return saved;
end $$;
create function bob.artifact_box_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.artifact_box_command(p_project,p_action,p_artifact,p_expected,p_data)
$$;
revoke all on function bob_private.artifact_box_command(text,text,uuid,integer,jsonb),bob.artifact_box_command(text,text,uuid,integer,jsonb) from public,anon;
grant execute on function bob_private.artifact_box_command(text,text,uuid,integer,jsonb),bob.artifact_box_command(text,text,uuid,integer,jsonb) to authenticated;

-- Caller-RLS research enrichment. Keep v2 available for old Edge deployments.
create function bob.search_bob_project_data_v3(p_project_id text,p_dataset text,p_query text default null,p_status text default null,
  p_area_id text default null,p_record_id text default null,p_after_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; rows jsonb; links jsonb; n integer;
begin
  result:=bob.search_bob_project_data_v2(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
  if p_dataset<>'artifacts' then return result; end if;
  select coalesce(jsonb_agg(item.value || jsonb_build_object('parametric_recipe',p.recipe) order by item.ord),'[]'::jsonb) into rows
    from jsonb_array_elements(result->'records') with ordinality item(value,ord)
    left join bob.artifact_parametric_recipes p on p.project_id=p_project_id and p.artifact_id::text=item.value->>'id'
      and p.artifact_revision=(item.value->>'revision')::integer;
  result:=jsonb_set(result,'{records}',rows);
  while octet_length(result::text)>30000 loop
    n:=jsonb_array_length(result->'records');
    if n=0 then raise exception 'Research result too large' using errcode='22023'; end if;
    rows:=(result->'records')-(n-1);
    select coalesce(jsonb_agg(value),'[]'::jsonb) into links from jsonb_array_elements(result->'related')
      where value->>'parent_id' in(select r->>'id' from jsonb_array_elements(rows) r);
    result:=result || jsonb_build_object('records',rows,'related',links,'truncated',true,'next_cursor',rows->-1->>'id');
  end loop;
  return result;
end $$;
revoke all on function bob.search_bob_project_data_v3(text,text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data_v3(text,text,text,text,text,text,text) to authenticated;

-- New bounded write kind, using the SAME claimed turn, quota, receipts and retry
-- settlement. The model cannot choose a project, actor, approval or raw SQL.
create function bob_private.bob_project_write_v2(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; rid uuid; prior jsonb; record jsonb; result jsonb; message text; quote text;
  key text; existing bob_private.bob_write_receipts; expected integer; creating boolean;
begin
  if p_payload->>'kind' is distinct from 'drawing' then
    return bob_private.bob_project_write(p_project,p_thread,p_turn,p_generation,p_payload);
  end if;
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  d:=p_payload->'data'; quote:=p_payload->>'request_quote';
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>24000
    or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'::jsonb
    or (select count(*) from jsonb_object_keys(p_payload))<>6
    or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
    or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
    or (p_payload->>'expected_revision')!~'^\d+$'
    or jsonb_typeof(p_payload->'request_quote') is distinct from 'string'
    or coalesce(length(quote),0) not between 1 and 500
    or jsonb_typeof(d) is distinct from 'object'
    or (p_payload->'record_id'<>'null'::jsonb and jsonb_typeof(p_payload->'record_id')<>'string') then
    raise exception 'invalid_write' using errcode='22023';
  end if;
  select text into message from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if position(quote in message)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
  creating:=p_payload->'record_id'='null'::jsonb;
  expected:=(p_payload->>'expected_revision')::integer;
  if creating and expected<>0 or not creating and expected<1 then raise exception 'invalid_write' using errcode='22023'; end if;
  key:='drawing:' || coalesce(p_payload->>'record_id',concat_ws(':','new',d->>'area_id',lower(btrim(d->>'title'))));
  select * into existing from bob_private.bob_write_receipts
    where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=key;
  if found then
    if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    return existing.receipt;
  end if;
  if(select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023'; end if;
  if creating then rid:=gen_random_uuid();
  else
    rid:=(p_payload->>'record_id')::uuid;
    select jsonb_build_object('id',a.id,'revision',a.revision,'title',a.title,'area_id',a.area_id,
      'target_revision',a.target_revision,'recipe',p.recipe) into prior
      from bob.current_artifacts a join bob.artifact_parametric_recipes p on p.project_id=a.project_id and p.artifact_id=a.id and p.artifact_revision=a.revision
      where a.project_id=p_project and a.id=rid;
    if not found then raise exception 'project_denied' using errcode='42501'; end if;
  end if;
  perform bob_private.artifact_box_command(p_project,case when creating then 'create' else 'regenerate' end,rid,expected,d);
  select jsonb_build_object('id',a.id,'title',a.title,'area_id',a.area_id,'revision',a.revision,'status',a.status,
    'target_revision',a.target_revision,'solution_id',a.solution_id,'solution_revision',a.solution_revision,'recipe',p.recipe) into record
    from bob.current_artifacts a join bob.artifact_parametric_recipes p on p.project_id=a.project_id and p.artifact_id=a.id and p.artifact_revision=a.revision
    where a.project_id=p_project and a.id=rid;
  if record is null then raise exception 'write_readback_failed'; end if;
  result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',rid,'label',record->>'title',
    'operation',case when creating then 'created' else 'updated' end,'savedAt',clock_timestamp(),
    'revision',(record->>'revision')::integer,'areaId',record->'area_id','record',record);
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,key,p_payload,prior,result);
  return result;
end $$;
create function bob.bob_project_write_v2(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.bob_project_write_v2(p_project,p_thread,p_turn,p_generation,p_payload)
$$;
revoke all on function bob_private.bob_project_write_v2(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v2(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v2(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v2(text,uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
