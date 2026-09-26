-- Operator-only, content-free report. A run with calls but no delivery event is
-- unfinished/unobserved, never silently counted as successful. Set the time bound
-- explicitly when comparing releases; elapsed time starts at first execution,
-- includes worker waits and excludes time queued before that execution.
with runs as (
  select run_id,
    max(status) filter(where kind='delivery') as outcome,
    max(duration_ms) filter(where kind='delivery') as elapsed_ms,
    count(*) filter(where kind='model') as model_calls,
    count(*) filter(where kind='model' and status='failed') as failed_calls,
    sum(cost_usd) filter(where kind='model') as known_cost_usd,
    count(*) filter(where kind='model' and cost_usd is null) as unpriced_calls,
    max((counts->>'continuations')::integer) filter(where kind='delivery') as continuations,
    max((counts->>'cad_renders')::integer) filter(where kind='delivery') as cad_renders,
    max((counts->>'cad_review_rejections')::integer) filter(where kind='delivery') as cad_rejections
  from bob.execution_events
  where created_at >= now()-interval '24 hours'
  group by run_id
)
select coalesce(outcome,'unfinished_or_unobserved') as outcome,count(*) as runs,
  round(avg(elapsed_ms)) as mean_elapsed_ms,
  percentile_cont(0.5) within group(order by elapsed_ms) as p50_elapsed_ms,
  percentile_cont(0.95) within group(order by elapsed_ms) as p95_elapsed_ms,
  sum(model_calls) as model_calls,sum(failed_calls) as failed_calls,
  sum(continuations) as continuations,sum(cad_renders) as cad_renders,sum(cad_rejections) as cad_review_rejections,
  sum(known_cost_usd) as known_cost_usd,sum(unpriced_calls) as unpriced_calls
from runs group by outcome order by outcome;

-- Role cost/latency includes actual retry calls, excludes journal replay.
select role,count(*) as calls,count(*) filter(where status='failed') as failures,
  round(avg(duration_ms)) as mean_ms,
  sum(input_tokens) as input_tokens,sum(output_tokens) as output_tokens,
  sum(cost_usd) as known_cost_usd,count(*) filter(where cost_usd is null) as unpriced_calls
from bob.execution_events
where kind='model' and created_at>=now()-interval '24 hours'
group by role order by role;
