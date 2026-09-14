-- Narrow rollout hardening after hosted advisor review of the sharing release.
-- Preserve sharing semantics while adding one covering FK index and letting the
-- invitation SELECT policy evaluate auth.uid() once per statement.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index volunteer_sessions_person_project_idx
  on bob.volunteer_sessions(person_id, project_id);

drop policy if exists sharing_read on bob.project_friend_invitations;
create policy sharing_read on bob.project_friend_invitations
  for select to authenticated
  using (
    invitee_id = (select auth.uid())
    or bob_private.has_project_access(project_id)
  );

commit;
