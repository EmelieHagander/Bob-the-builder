-- Rollback-only diagnostic, not a schema migration or ordinary app command.
-- A database operator must provide an authorized test actor in the same session:
-- select set_config('bob_status_probe.actor_id', '<authorized-auth-user-uuid>', false);
-- The actor needs ordinary create-project authority. All mutations below use a
-- new disposable project. The service role is used only for the normal turn claim.
-- No real task or conversation is edited; all fixture writes roll back and absence
-- is asserted. A single-transaction checkpoint variation distinguishes snapshots
-- with the same now() timestamp; see the accompanying investigation evidence.

do $$
declare
 actor uuid; project text; area text:='a_probe_'||replace(gen_random_uuid()::text,'-','');
 person text; person_name text;
 task_a text:='t_probe_'||replace(gen_random_uuid()::text,'-',''); task_b text:='t_probe_'||replace(gen_random_uuid()::text,'-','');
 probe_turn uuid:=gen_random_uuid(); thread_id uuid; generation bigint; claim jsonb; pin jsonb; fresh jsonb;
 domain jsonb; payload jsonb; saved jsonb; stale jsonb; result jsonb; version integer; conflicts integer:=0;
 requested_status text; transitions jsonb:='[]'; exact_retries integer:=0; required_check_message text;
 quote text:='Disposable release verification: change task text and exercise status transitions.';
begin
 actor:=nullif(current_setting('bob_status_probe.actor_id',true),'')::uuid;
 if actor is null then raise exception 'verification_actor_missing';end if;
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  set local role authenticated;
  project:=bob.create_project(jsonb_build_object('name','Disposable Bob status verification','type','Verification'))->>'id';
  insert into bob.areas(id,project_id,slug,name) values(area,project,area,'Verification Area');
  insert into bob.tasks(id,project_id,area_id,name,instructions,updated_at) values
   (task_a,project,area,'First verification task','Original',now()-interval '1 day'),
   (task_b,project,area,'Second verification task','Keep this',now()-interval '1 day');
  select id,name into person,person_name from bob.people where project_id=project and auth_user_id=actor order by id limit 1;
  if person is null then raise exception 'verification_fixture_member_missing';end if;
  insert into bob.task_assignees(task_id,person_id) values(task_a,person);
  set local role service_role;
  perform set_config('request.jwt.claims','{}',true);
  claim:=bob.bob_claim_turn(project,actor,probe_turn,quote);
  if claim->>'status'<>'claimed' or claim->>'thread_id' is null then raise exception 'verification_claim_failed';end if;
  thread_id:=(claim->>'thread_id')::uuid;generation:=(claim->>'generation')::bigint;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  set local role authenticated;
  pin:=bob.read_bob_work_snapshot(project,'tasks',task_a);
  domain:=jsonb_build_object('kind','task','record_id',task_a,'expected_updated_at',pin#>'{record,updated_at}','expected_revision',null,
   'request_quote',quote,'data',jsonb_build_object('area_id',area,'name','First verification task','instructions','Original + requested'));
  payload:=domain||jsonb_build_object('kind','bound_work','data',jsonb_build_object('pins',jsonb_build_array(pin),'domain',domain));
  saved:=bob.bob_project_write_v19(project,thread_id,probe_turn,generation,payload);
  if saved->>'recordId' is distinct from task_a or saved#>>'{record,instructions}' is distinct from 'Original + requested' then raise exception 'verification_save_failed';end if;
  if bob.bob_project_write_v19(project,thread_id,probe_turn,generation,payload) is distinct from saved then raise exception 'verification_exact_retry_failed';end if;
  exact_retries:=exact_retries+1;
  -- Every public entry point must return a stale domain write once, unchanged.
  for version in 16..20 loop
   begin
    execute format('select bob.bob_project_write_v%s($1,$2,$3,$4,$5)',version) using project,thread_id,probe_turn,generation,domain;
    raise exception 'verification_expected_conflict_v%',version;
   exception when sqlstate 'PT409' then
    if sqlerrm not in ('record_changed','construction_source_changed') then raise;end if;conflicts:=conflicts+1;
   end;
  end loop;
  stale:=jsonb_set(payload,'{data,domain,data,instructions}','"Incorrect stale replacement"');
  begin
   perform bob.bob_project_write_v19(project,thread_id,probe_turn,generation,stale);raise exception 'verification_stale_bound_write_accepted';
  exception when sqlstate 'PT409' then
   if sqlerrm<>'record_changed' then raise;end if;conflicts:=conflicts+1;
  end;
  -- Status changes use the same current public bound route as deployed Bob.
  foreach requested_status in array array['doing','done','todo','blocked','todo'] loop
   -- Reopening may introduce new work checks. A single SQL transaction uses
   -- one now() timestamp, so this real relation change also distinguishes the
   -- reopened todo snapshot from the initial todo before the first transition.
   if requested_status='blocked' then
    perform bob.task_steps_command(project,task_a,'create',null,jsonb_build_object('title','Optional reopened-work check','instructions','Added after reopening the task','is_checkpoint',true,'required',false));
   end if;
   fresh:=bob.read_bob_work_snapshot(project,'tasks',task_a);
   domain:=jsonb_build_object('kind','task_work','record_id',task_a,'expected_updated_at',fresh#>'{record,updated_at}','expected_revision',null,
    'request_quote',quote,'data',jsonb_build_object('status',requested_status,'person_ids',jsonb_build_array(person)));
   payload:=domain||jsonb_build_object('kind','bound_work','data',jsonb_build_object('pins',jsonb_build_array(fresh),'domain',domain));
   saved:=bob.bob_project_write_v19(project,thread_id,probe_turn,generation,payload);
   if saved->>'recordId' is distinct from task_a or saved#>>'{record,status}' is distinct from requested_status then raise exception 'verification_status_receipt_failed_%',requested_status;end if;
   if bob.bob_project_write_v19(project,thread_id,probe_turn,generation,payload) is distinct from saved then raise exception 'verification_status_retry_failed_%',requested_status;end if;
   exact_retries:=exact_retries+1;
   fresh:=bob.read_bob_work_snapshot(project,'tasks',task_a);
   if fresh#>>'{record,status}' is distinct from requested_status or fresh#>>'{record,instructions}' is distinct from 'Original + requested'
    or fresh#>'{relations,people}' is distinct from jsonb_build_array(jsonb_build_object('id',person,'name',person_name)) then raise exception 'verification_status_readback_failed_%',requested_status;end if;
   transitions:=transitions||jsonb_build_array(jsonb_build_object('requested',requested_status,'saved',true,'readback',fresh#>>'{record,status}'));
  end loop;
  -- Canonical completion protection must survive the transport correction.
  -- This newly required check distinguishes the final todo snapshot too.
  perform bob.task_steps_command(project,task_a,'create',null,jsonb_build_object('title','Required verification check','instructions','Leave uncompleted for rejection proof','is_checkpoint',true,'required',true));
  fresh:=bob.read_bob_work_snapshot(project,'tasks',task_a);
  domain:=jsonb_build_object('kind','task_work','record_id',task_a,'expected_updated_at',fresh#>'{record,updated_at}','expected_revision',null,
   'request_quote',quote,'data',jsonb_build_object('status','done','person_ids',jsonb_build_array(person)));
  payload:=domain||jsonb_build_object('kind','bound_work','data',jsonb_build_object('pins',jsonb_build_array(fresh),'domain',domain));
  begin
   perform bob.bob_project_write_v19(project,thread_id,probe_turn,generation,payload);
   raise sqlstate 'PZ002' using message='verification_required_check_bypassed';
  exception when sqlstate 'P0001' then
   if sqlerrm<>'Complete required checks before marking this task done.' then raise;end if;
   required_check_message:=sqlerrm;
  end;
  pin:=bob.read_bob_work_snapshot(project,'tasks',task_a);
  if pin is distinct from fresh or pin#>>'{record,status}' is distinct from 'todo' then raise exception 'verification_rejection_changed_task';end if;
  pin:=bob.read_bob_work_snapshot(project,'tasks',task_b);
  domain:=jsonb_build_object('kind','task','record_id',task_b,'expected_updated_at',pin#>'{record,updated_at}','expected_revision',null,
   'request_quote',quote,'data',jsonb_build_object('area_id',area,'name','Second verification task','instructions','Next requested edit'));
  payload:=domain||jsonb_build_object('kind','bound_work','data',jsonb_build_object('pins',jsonb_build_array(pin),'domain',domain));
  perform bob.bob_project_write_v19(project,thread_id,probe_turn,generation,payload);
  if (bob.read_bob_work_snapshot(project,'tasks',task_b))#>>'{record,instructions}' is distinct from 'Next requested edit' then raise exception 'verification_second_task_failed';end if;
  for version in 16..20 loop
   begin
    execute format('select bob.bob_project_write_v%s($1,$2,$3,$4,$5)',version) using project,thread_id,probe_turn,generation+100,jsonb_build_object('kind',case version when 16 then 'cut_plan_stock' when 17 then 'bound_project' when 18 then 'bound_solution_create' when 19 then 'bound_work' else 'bound_plan_link' end);
    raise exception 'verification_expired_claim_accepted_v%',version;
   exception when sqlstate 'PT409' then
    if sqlerrm<>'turn_not_claimed' then raise;end if;conflicts:=conflicts+1;
   end;
  end loop;
  result:=jsonb_build_object('saved_actions',7,'exact_retry_count',exact_retries,'conflict_responses',conflicts,'second_task',true,'caller_role',current_user,
   'status_transitions',transitions,'instructions_preserved',true,'assignee_preserved',true,'required_check_rejected',true,'required_check_message',required_check_message,'required_check_status_readback',(bob.read_bob_work_snapshot(project,'tasks',task_a))#>>'{record,status}');
  -- Deliberate subtransaction rollback removes fixture, private turn and receipts.
  raise sqlstate 'PZ001' using message='verification_rollback';
 exception when sqlstate 'PZ001' then
  if sqlerrm<>'verification_rollback' then raise;end if;
 end;
 if exists(select 1 from bob.projects where id=project) or exists(select 1 from bob.bob_threads where id=thread_id)
  or exists(select 1 from bob.tasks where id in (task_a,task_b)) or exists(select 1 from bob.people where id=person)
  or exists(select 1 from bob.bob_messages m where m.turn_id=probe_turn)
  or exists(select 1 from bob_private.bob_write_receipts r where r.turn_id=probe_turn) then raise exception 'verification_cleanup_failed';end if;
 perform set_config('bob_status_probe.result',(result||jsonb_build_object('all_fixture_changes_rolled_back',true))::text,false);
end $$;
select current_setting('bob_status_probe.result')::jsonb as verification;
