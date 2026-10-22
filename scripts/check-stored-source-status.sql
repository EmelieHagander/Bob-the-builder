-- Rollback-only release proof for 20261022193000_stored_source_status.sql.
-- Fills the stored rows for every project, then, as one direct member of each
-- stored project, compares the view with the live assessment for every
-- revision. Nothing persists: the transaction always rolls back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select bob_private.drain_artifact_source_states(1000, interval '100 seconds') as refreshed;

do $$
declare p record; member uuid; mismatches integer; stored integer; checked integer := 0;
begin
 for p in select f.project_id from bob_private.artifact_source_refreshes f where f.storable order by 1 loop
  select auth_user_id into member from bob.people
   where project_id = p.project_id and access_origin = 'direct' and auth_user_id is not null limit 1;
  if member is null then continue; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  select count(*) into stored from bob.artifact_source_states s
   join bob.artifact_source_epochs e on e.project_id = s.project_id and e.seq = s.computed_seq
   where s.project_id = p.project_id;
  select count(*) into mismatches from (
   (select artifact_id, revision, source_state, source_reasons from bob.artifact_source_status where project_id = p.project_id
    except all
    select r.artifact_id, r.revision, a.source_state, a.source_reasons from bob.artifact_revisions r
     cross join lateral bob_private.artifact_source_assessment(r.project_id, r.artifact_id, r.revision) a
     where r.project_id = p.project_id)
   union all
   (select r.artifact_id, r.revision, a.source_state, a.source_reasons from bob.artifact_revisions r
     cross join lateral bob_private.artifact_source_assessment(r.project_id, r.artifact_id, r.revision) a
     where r.project_id = p.project_id
    except all
    select artifact_id, revision, source_state, source_reasons from bob.artifact_source_status where project_id = p.project_id)
  ) diff;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  if mismatches > 0 then raise exception 'stored_source_status_mismatch in project % (% rows)', p.project_id, mismatches; end if;
  raise notice 'project %: % fresh stored rows, identical to live', p.project_id, stored;
  checked := checked + 1;
 end loop;
 raise notice 'stored source status identical to live for % projects', checked;
end $$;
rollback;
