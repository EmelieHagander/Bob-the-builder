-- Release hardening for executable task readiness.
-- Cover the optional prerequisite checkpoint FK surfaced by the hosted performance advisor.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index task_dependencies_prerequisite_step_idx
  on bob.task_dependencies(prerequisite_step_id);

commit;
