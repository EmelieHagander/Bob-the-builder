-- Owner decision 2026-11-07 (sketchbook, design B; "Ja kör på rek!"): Konrad
-- works on a construction in a sketch and saves it once per assignment. A
-- sketch is the saved revision it starts from plus the changes made since; it
-- is private to the job (thread + turn), never project truth, never read by
-- drawings, materials, plans or the UI, and is gone when the job ends. The
-- commit goes through the ordinary construction edit path, so every save rule
-- still applies at that moment.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.construction_sketches (
  thread_id uuid not null references bob.bob_threads(id) on delete cascade,
  turn_id uuid not null,
  project_id text not null references bob.projects(id) on delete cascade,
  artifact_id uuid not null,
  revision integer not null check (revision between 1 and 100000),
  sketch jsonb not null check (jsonb_typeof(sketch)='object' and octet_length(sketch::text)<=524288),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (thread_id,turn_id,artifact_id),
  foreign key (artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade
);
alter table bob_private.construction_sketches enable row level security;
revoke all on bob_private.construction_sketches from public,anon,authenticated,service_role;

-- The claimed caller of the current turn only. read/put/drop act on one
-- construction, list names this turn's open sketches. put is a compare-and-set
-- on the sketch revision; the same sketch sent again (a lost response) returns
-- its revision unchanged.
create function bob.construction_sketch(
  p_project text,p_thread uuid,p_turn uuid,p_generation bigint,
  p_action text,p_artifact uuid,p_expected_revision integer,p_sketch jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior bob_private.construction_sketches; exists_prior boolean;
begin
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  if p_action is null or p_action not in ('read','put','drop','list') then
    raise exception 'invalid_sketch_action' using errcode='22023';
  end if;
  -- A sketch belongs to its turn; an earlier turn's sketch is never read again.
  delete from bob_private.construction_sketches where thread_id=p_thread and turn_id<>p_turn;
  if p_action='list' then
    if p_artifact is not null or p_expected_revision is not null or p_sketch is not null then
      raise exception 'invalid_sketch_request' using errcode='22023';
    end if;
    return jsonb_build_object('status','ok','sketches',coalesce((select jsonb_agg(jsonb_build_object(
        'artifact_id',s.artifact_id,'base_revision',s.sketch->'base_revision','change_count',s.sketch->'change_count','updated_at',s.updated_at)
      order by s.updated_at,s.artifact_id) from bob_private.construction_sketches s where s.thread_id=p_thread and s.turn_id=p_turn),'[]'::jsonb));
  end if;
  if p_artifact is null then raise exception 'invalid_sketch_request' using errcode='22023'; end if;
  select * into prior from bob_private.construction_sketches
    where thread_id=p_thread and turn_id=p_turn and artifact_id=p_artifact for update;
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
    delete from bob_private.construction_sketches where thread_id=p_thread and turn_id=p_turn and artifact_id=p_artifact;
    return jsonb_build_object('status','dropped','existed',exists_prior);
  end if;
  if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>99999
    or jsonb_typeof(p_sketch) is distinct from 'object' or octet_length(p_sketch::text)>524288 then
    raise exception 'invalid_sketch' using errcode='22023';
  end if;
  if not exists(select 1 from bob.artifacts where id=p_artifact and project_id=p_project) then
    raise exception 'not_a_construction_draft' using errcode='22023';
  end if;
  if exists_prior and prior.sketch is not distinct from p_sketch then
    return jsonb_build_object('status','stored','revision',prior.revision,'unchanged',true);
  end if;
  if (case when exists_prior then prior.revision else 0 end)<>p_expected_revision then
    raise exception 'sketch_changed' using errcode='PT409';
  end if;
  insert into bob_private.construction_sketches(thread_id,turn_id,project_id,artifact_id,revision,sketch)
    values(p_thread,p_turn,p_project,p_artifact,p_expected_revision+1,p_sketch)
    on conflict(thread_id,turn_id,artifact_id) do update
      set revision=excluded.revision,sketch=excluded.sketch,updated_at=clock_timestamp();
  return jsonb_build_object('status','stored','revision',p_expected_revision+1);
end $$;
revoke all on function bob.construction_sketch(text,uuid,uuid,bigint,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob.construction_sketch(text,uuid,uuid,bigint,text,uuid,integer,jsonb) to authenticated;

-- A finished job leaves no sketch behind.
create function bob_private.drop_job_construction_sketches()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from bob_private.construction_sketches where thread_id=new.thread_id and turn_id=new.turn_id;
  return null;
end $$;
revoke all on function bob_private.drop_job_construction_sketches() from public,anon,authenticated,service_role;
create trigger bob_jobs_drop_construction_sketches
  after update of status on bob_private.bob_jobs
  for each row when (new.status in ('completed','failed') and old.status is distinct from new.status)
  execute function bob_private.drop_job_construction_sketches();
commit;
