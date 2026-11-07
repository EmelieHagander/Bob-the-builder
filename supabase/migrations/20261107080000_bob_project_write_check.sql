-- Owner decision 2026-11-07 (sketchbook, design A): check a write before saving
-- it. The same caller-authorized write function runs inside a subtransaction
-- and then has its deferred constraint triggers fired (SET CONSTRAINTS ALL
-- IMMEDIATE checks outstanding work retroactively) before it is rolled back on
-- purpose. Every database rule, trigger and readback check applies;
-- nothing is saved, no receipt or change set remains. Callers get either
-- {status:'checked'} or {status:'refused', code, message} with the database's
-- own reason.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob.bob_project_write_check(p_function text, p_project text, p_thread uuid, p_turn uuid, p_generation bigint, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; code text; msg text;
begin
 if p_function not in ('bob_project_write_v16','bob_project_write_v17','bob_project_write_v18','bob_project_write_v19',
   'bob_project_write_v20','bob_project_write_v21','commit_construction_work') then
  raise exception 'write_check_function_invalid' using errcode='22023';
 end if;
 begin
  execute format('select bob.%I($1,$2,$3,$4,$5)',p_function) into result using p_project,p_thread,p_turn,p_generation,p_payload;
  -- Deferred constraint triggers run now, inside the subtransaction, exactly
  -- as they would at commit (retroactive per SET CONSTRAINTS).
  set constraints all immediate;
  raise exception 'write_check_rollback' using errcode='P0D01';
 exception
  when sqlstate 'P0D01' then return jsonb_build_object('status','checked');
  when others then
   get stacked diagnostics code=returned_sqlstate, msg=message_text;
   return jsonb_build_object('status','refused','code',code,'message',left(msg,300));
 end;
end $$;
revoke all on function bob.bob_project_write_check(text,text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.bob_project_write_check(text,text,uuid,uuid,bigint,jsonb) to authenticated;
commit;
