-- Close the legacy singleton account's broad anonymous/authenticated surface.
-- No household is guessed. Empty accounts remain unbound until explicit setup.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table bob.account,bob.account_notes in share row exclusive mode;
alter table bob.account add column household_id uuid references shared.households(id) on delete set null;
create index account_household_idx on bob.account(household_id);
comment on column bob.account.household_id is
  'Explicit canonical household permitted to use the legacy account and its notes. Null is inaccessible, never public.';
comment on table bob.account is
  'Legacy single household settings context, independent of project ownership. Access requires active membership in the explicitly bound shared household.';

do $$ declare reviewed uuid:=nullif(current_setting('bob.reviewed_account_household',true),'')::uuid;
begin
  if reviewed is not null then
    if not exists(select 1 from shared.households where id=reviewed) then raise exception 'Reviewed account household does not exist'; end if;
    update bob.account set household_id=reviewed where id='account';
  elsif exists(select 1 from bob.account where name<>'Your build account' or owner_name<>'' or email<>'')
    or exists(select 1 from bob.account_notes) then
    raise exception 'Bob account migration blocked: existing account content requires an explicitly reviewed household mapping';
  end if;
end $$;

create function bob_private.has_account_access() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from bob.account c
    join shared.household_access a on a.household_id=c.household_id
    where c.id='account' and a.user_id=auth.uid() and a.status='active')
$$;
comment on function bob_private.has_account_access() is
  'Caller-bound active canonical household access to the legacy singleton account and notes; project membership never grants this access.';
revoke all on function bob_private.has_account_access() from public,anon;
grant execute on function bob_private.has_account_access() to authenticated;

do $$ declare r record; begin
  for r in select tablename,policyname from pg_policies where schemaname='bob' and tablename in ('account','account_notes') loop
    execute format('drop policy %I on bob.%I',r.policyname,r.tablename);
  end loop;
end $$;
revoke all on bob.account,bob.account_notes from public,anon,authenticated;
grant select on bob.account,bob.account_notes to authenticated;
grant update(name,owner_name,email) on bob.account to authenticated;
grant insert,delete on bob.account_notes to authenticated;
grant update(text,pinned) on bob.account_notes to authenticated;
create policy household_account_read on bob.account for select to authenticated using((select bob_private.has_account_access()));
create policy household_account_update on bob.account for update to authenticated
  using((select bob_private.has_account_access())) with check((select bob_private.has_account_access()));
create policy household_notes on bob.account_notes for all to authenticated
  using((select bob_private.has_account_access())) with check((select bob_private.has_account_access()));

create function bob_private.bind_account_household(p_household uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result bob.account;
begin
  if auth.uid() is null or p_household is null or not exists(select 1 from shared.household_access a
    where a.household_id=p_household and a.user_id=auth.uid() and a.status='active') then
    raise exception 'household_denied' using errcode='42501'; end if;
  select * into result from bob.account where id='account' for update;
  if not found then raise exception 'Account setup unavailable' using errcode='55000'; end if;
  if result.household_id=p_household then return to_jsonb(result); end if;
  if result.household_id is not null then raise exception 'Account already belongs to another household' using errcode='42501'; end if;
  if result.name<>'Your build account' or result.owner_name<>'' or result.email<>'' or exists(select 1 from bob.account_notes) then
    raise exception 'Existing account content needs a reviewed household mapping' using errcode='55000'; end if;
  update bob.account set household_id=p_household where id='account' returning * into result;
  return to_jsonb(result);
end $$;
comment on function bob_private.bind_account_household(uuid) is
  'Explicit one-time setup for an untouched empty legacy account; never reassigns saved content or creates a family grant.';
create function bob.bind_account_household(p_household uuid) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.bind_account_household(p_household) $$;
revoke all on function bob.bind_account_household(uuid),bob_private.bind_account_household(uuid) from public,anon;
grant execute on function bob.bind_account_household(uuid),bob_private.bind_account_household(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
