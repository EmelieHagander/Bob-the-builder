-- Owner decision 2026-11-07 (after the entry turn; construction_sketch_version
-- 2): a new construction can be built in a sketch too, in parts under one key,
-- and saved once. Entry, 09:18-09:30: one new wall was too large for Konrad to
-- write within the 120 s answer window, seven times. Same rules as the sketches
-- of existing constructions (20261107090000): private to the job, never
-- project truth, gone when the job ends.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.construction_new_sketches (
  thread_id uuid not null references bob.bob_threads(id) on delete cascade,
  turn_id uuid not null,
  project_id text not null references bob.projects(id) on delete cascade,
  sketch_key text not null check (sketch_key ~ '^[A-Za-z0-9_-]{1,80}$'),
  revision integer not null check (revision between 1 and 100000),
  sketch jsonb not null check (jsonb_typeof(sketch)='object' and octet_length(sketch::text)<=524288),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (thread_id,turn_id,sketch_key)
);
alter table bob_private.construction_new_sketches enable row level security;
revoke all on bob_private.construction_new_sketches from public,anon,authenticated,service_role;

create function bob.construction_new_sketch(
  p_project text,p_thread uuid,p_turn uuid,p_generation bigint,
  p_action text,p_key text,p_expected_revision integer,p_sketch jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior bob_private.construction_new_sketches; exists_prior boolean;
begin
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  if p_action is null or p_action not in ('read','put','drop','list') then
    raise exception 'invalid_sketch_action' using errcode='22023';
  end if;
  delete from bob_private.construction_new_sketches where thread_id=p_thread and turn_id<>p_turn;
  if p_action='list' then
    if p_key is not null or p_expected_revision is not null or p_sketch is not null then
      raise exception 'invalid_sketch_request' using errcode='22023';
    end if;
    return jsonb_build_object('status','ok','sketches',coalesce((select jsonb_agg(jsonb_build_object(
        'new_key',s.sketch_key,'part_count',s.sketch->'part_count','updated_at',s.updated_at)
      order by s.updated_at,s.sketch_key) from bob_private.construction_new_sketches s where s.thread_id=p_thread and s.turn_id=p_turn),'[]'::jsonb));
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'invalid_sketch_request' using errcode='22023'; end if;
  select * into prior from bob_private.construction_new_sketches
    where thread_id=p_thread and turn_id=p_turn and sketch_key=p_key for update;
  exists_prior:=found;
  if p_action='read' then
    if p_expected_revision is not null or p_sketch is not null then
      raise exception 'invalid_sketch_request' using errcode='22023';
    end if;
    return jsonb_build_object('status','ok','revision',case when exists_prior then prior.revision else 0 end,
      'sketch',case when exists_prior then prior.sketch else null end);
  end if;
  if p_action='drop' then
    if p_expected_revision is not null or p_sketch is not null then
      raise exception 'invalid_sketch_request' using errcode='22023';
    end if;
    delete from bob_private.construction_new_sketches where thread_id=p_thread and turn_id=p_turn and sketch_key=p_key;
    return jsonb_build_object('status','dropped','existed',exists_prior);
  end if;
  if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>99999
    or jsonb_typeof(p_sketch) is distinct from 'object' or octet_length(p_sketch::text)>524288 then
    raise exception 'invalid_sketch' using errcode='22023';
  end if;
  if exists_prior and prior.sketch is not distinct from p_sketch then
    return jsonb_build_object('status','stored','revision',prior.revision,'unchanged',true);
  end if;
  if (case when exists_prior then prior.revision else 0 end)<>p_expected_revision then
    raise exception 'sketch_changed' using errcode='PT409';
  end if;
  insert into bob_private.construction_new_sketches(thread_id,turn_id,project_id,sketch_key,revision,sketch)
    values(p_thread,p_turn,p_project,p_key,p_expected_revision+1,p_sketch)
    on conflict(thread_id,turn_id,sketch_key) do update
      set revision=excluded.revision,sketch=excluded.sketch,updated_at=clock_timestamp();
  return jsonb_build_object('status','stored','revision',p_expected_revision+1);
end $$;
revoke all on function bob.construction_new_sketch(text,uuid,uuid,bigint,text,text,integer,jsonb) from public,anon,service_role;
grant execute on function bob.construction_new_sketch(text,uuid,uuid,bigint,text,text,integer,jsonb) to authenticated;

-- A finished job leaves no sketch of either kind behind.
create or replace function bob_private.drop_job_construction_sketches()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from bob_private.construction_sketches where thread_id=new.thread_id and turn_id=new.turn_id;
  delete from bob_private.construction_new_sketches where thread_id=new.thread_id and turn_id=new.turn_id;
  return null;
end $$;
commit;
