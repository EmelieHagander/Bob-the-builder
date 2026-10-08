-- 2026-10-08: the CAD designer now has a 32k output cap (20261008083000), so
-- one design call can cost about $0.65. A $1 allocation stopped the first real
-- bunk bed after one draft. Owner decision: $3 per drawing request.
-- Open requests below $3 are raised the same way an owner grant is: same
-- request, prior charges kept, the cost stop released, and one drawing event so
-- the queue continues the stopped request when the owner next has Bob open.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob_private.drawing_budgets alter column usd_limit set default 3;

with raised as (
 update bob_private.drawing_budgets b set usd_limit=3,revision=b.revision+1
 from bob_private.project_drawing_requests r
 where r.id=b.request_id and r.status not in ('saved','cancelled') and b.usd_limit<3 and not b.legacy_untracked
 returning r.id,r.project_id
), released as (
 update bob_private.drawing_requests d set payload=jsonb_set(d.payload,'{retry,fingerprint}','""'::jsonb),revision=d.revision+1
 from raised where d.id=raised.id and d.payload#>>'{retry,outcome,reason}'='turn_budget_exhausted'
 returning d.id
), bumped as (
 update bob_private.project_drawing_requests r set revision=r.revision+1 from released where r.id=released.id returning r.id
)
insert into bob_private.drawing_project_events(project_id)
select distinct project_id from raised
on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1;
commit;
