-- Operator-only, content-free FORM package 5 comparison report.
-- Paste the turn ids from the test-results/form-*.json reports of each run into
-- the VALUES list (scenario, config, step, turn). Nothing here reads prompts,
-- answers or project content. A turn without a delivery event is unfinished.
with turns(scenario,config,step,turn_id) as (values
  ('box','baseline','concept','00000000-0000-0000-0000-000000000000'::uuid)
),
events as (
  select t.scenario,t.config,t.step,e.* from turns t join bob.execution_events e on e.turn_id=t.turn_id
)
-- Per scenario and configuration: outcome, elapsed time, calls, tokens and cost.
select scenario,config,
  count(distinct turn_id) as turns,
  count(*) filter(where kind='delivery') as delivered_turns,
  sum(duration_ms) filter(where kind='delivery') as elapsed_ms,
  count(*) filter(where kind='model') as model_calls,
  count(*) filter(where kind='model' and status='failed') as failed_calls,
  count(*) filter(where kind='model' and coalesce((counts->>'attempt')::integer,0)>0) as resent_calls,
  sum(input_tokens) filter(where kind='model') as input_tokens,
  sum(output_tokens) filter(where kind='model') as output_tokens,
  sum(cost_usd) filter(where kind='model') as known_cost_usd,
  count(*) filter(where kind='model' and cost_usd is null) as unpriced_calls,
  sum((counts->>'cad_renders')::integer) filter(where kind='delivery') as cad_renders,
  sum((counts->>'cad_reviews')::integer) filter(where kind='delivery') as cad_reviews,
  sum((counts->>'cad_review_rejections')::integer) filter(where kind='delivery') as cad_rejections
from events group by scenario,config order by scenario,config;

-- Per role and catalog role version: the targeted reviewer logs under the
-- cad-reviewer role and the source reader under "other"; the role version id
-- separates them from Rita and from other roles.
with turns(scenario,config,step,turn_id) as (values
  ('box','baseline','concept','00000000-0000-0000-0000-000000000000'::uuid)
)
select t.scenario,t.config,e.role,e.counts->>'ai_role_version_id' as role_version,
  count(*) as calls,count(*) filter(where e.status='failed') as failures,
  sum(e.input_tokens) as input_tokens,sum(e.output_tokens) as output_tokens,
  sum(e.cost_usd) as known_cost_usd,round(avg(e.duration_ms)) as mean_ms
from turns t join bob.execution_events e on e.turn_id=t.turn_id and e.kind='model'
group by 1,2,3,4 order by 1,2,3,4;
