-- Bound planning of the allowlisted render joins at the existing capability
-- boundary. Keep default API timeouts, grants, authentication and RLS unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter function bob_volunteer_private.volunteer_drawing(text,text,uuid,integer) set join_collapse_limit=1;
alter function bob_volunteer_private.volunteer_drawing(text,text,uuid,integer) set from_collapse_limit=1;
commit;
