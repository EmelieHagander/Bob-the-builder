-- Preserve content-free role attribution for new CAD source-collection calls.
-- Apply before deploying the matching Bob metrics writer. Existing 'other'
-- events lack enough provenance to relabel and are deliberately preserved.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table bob.execution_events drop constraint execution_events_role_check;
alter table bob.execution_events add constraint execution_events_role_check
  check (role in ('bob','tool','ask-bob','cad-research','cad-designer','cad-reviewer',
    'context-summary','plan-compiler','plan-reviewer','bob-tool-discovery',
    'bob-work-intent','bob-delivery-language','other'));

commit;
