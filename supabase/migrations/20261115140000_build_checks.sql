-- Owner ask 2026-11-15 (Våningssäng 2): when the build starts, the project's
-- front page is the shopping list, the cut list and then the build guide, and
-- the crew ticks off what is done. Bought stays on bob.materials (status). This
-- table holds the rest: a cut part kind or a finished guide page, bound to the
-- exact saved version it was ticked on, so everyone sees the same progress
-- after reload and on another phone.
--
-- item: 'cut:<definition id>' on a construction version, 'page:<page key>' on a
-- drawing version. A newer version starts with nothing ticked; old ticks stay
-- with the version they were made on.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.build_checks (
 project_id text not null,
 artifact_id uuid not null,
 revision integer not null check(revision>0),
 item text not null check(item ~ '^(cut|page):[A-Za-z0-9_.:-]{1,200}$'),
 checked_by uuid not null default auth.uid(),
 checked_at timestamptz not null default clock_timestamp(),
 primary key(project_id,artifact_id,revision,item),
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 foreign key(artifact_id,revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade
);
alter table bob.build_checks enable row level security;
revoke all on bob.build_checks from public,anon,authenticated;
grant select,insert,delete on bob.build_checks to authenticated;
grant all on bob.build_checks to service_role;
-- Who ticked is the caller, never a value the browser picks.
create policy project_members on bob.build_checks for all to authenticated
 using(bob_private.has_project_access(project_id))
 with check(bob_private.has_project_access(project_id) and checked_by=auth.uid());
comment on table bob.build_checks is 'Build-day ticks per exact saved version: cut part kinds and finished build-guide pages (2026-11-15).';
notify pgrst,'reload schema';
commit;
