-- Bob-only diagnostic events. No project text, arguments, images, record IDs or user identities.
-- Replays do not execute model operations; the final event is idempotent per execution.
create table bob.execution_events (
  run_id uuid not null,
  turn_id uuid not null,
  event_key text not null check(length(event_key) between 1 and 80),
  created_at timestamptz not null default clock_timestamp(),
  kind text not null check(kind in ('model','delivery')),
  role text not null check(role in ('bob','ask-bob','cad-designer','cad-reviewer','context-summary','plan-compiler','plan-reviewer','bob-tool-discovery','bob-work-intent','bob-delivery-language','other')),
  status text not null check(status in ('ok','failed','uncertain','recovered','partial','receipt_matched','candidate_ready','read_only')),
  duration_ms bigint not null check(duration_ms>=0),
  input_tokens bigint check(input_tokens>=0),
  output_tokens bigint check(output_tokens>=0),
  cost_usd numeric check(cost_usd>=0),
  counts jsonb not null default '{}' check(jsonb_typeof(counts)='object' and octet_length(counts::text)<=4000),
  primary key(run_id,event_key)
);
alter table bob.execution_events enable row level security;
revoke all on bob.execution_events from public,anon,authenticated;
grant select,insert,update,delete on bob.execution_events to service_role;
create index execution_events_created_idx on bob.execution_events(created_at);
create index execution_events_turn_idx on bob.execution_events(turn_id);
comment on table bob.execution_events is 'Bob-only content-free execution diagnostics. Service-only. Model events are actual calls, delivery status is receipt matching, CAD review is concept quality, neither is physical certification.';

-- Existing governed vision-capable mini model. Independent conversation, no tools/writes.
insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,
  temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
select 'bob','bob','cad-reviewer','cad',model,model_type,5000,null,'high',null,false,is_enabled,
  '{"role":"independent_cad_review","authority":"read_only"}'::jsonb
from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='plan-compiler' and module_id='living-plan'
on conflict(app,coworker_id,function_name,module_id) do nothing;

-- Version 2 requires an explicit semantic handoff. Deploy v2 handlers before
-- this flip; the registry intersection keeps mismatched versions uncallable.
update bob.tool_catalog set schema_version=2,
 description='Delegate construction to a CAD designer with structured requirements and independent visual review.',
 how_to='Open relevant reference images, then supply brief plus handoff: deliverable, requirements with stable IDs/basis/source refs, coordinate mapping, requested views and unresolved checks. Carry earlier owner corrections forward; never invent a known compass direction. The server passes the original request, reopens selected pixels and pins the current target. The designer researches and renders, then a separate reviewer compares exact geometry and pixels to the request. Rejected designs get bounded repair. Only ready results expose save_cad_design. Bob saves the exact candidate and remains responsible for the requested outcome.'
where name='design_project_cad';
