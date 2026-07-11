-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0003: expose the `bob` schema to the API, in SQL
--
-- Instead of relying on the dashboard checkbox (API settings → Exposed
-- schemas), the exposure is hardcoded here so it is versioned, repeatable and
-- survives config resets. PostgREST reads its exposed-schema list from the
-- `pgrst.db_schemas` setting on the `authenticator` role.
--
-- The database is SHARED, so this migration APPENDS `bob` to whatever list is
-- already configured — it never overwrites another app's exposure. Safe to
-- re-run (a second run is a no-op) and a no-op on databases without an
-- `authenticator` role (plain Postgres: expose the schema in postgrest.conf
-- via `db-schemas = "..., bob"` instead).
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0003_expose_schema_to_api.sql
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  cfg text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    raise notice 'bob 0003: no authenticator role here — not a PostgREST/Supabase database, nothing to expose';
    return;
  end if;

  -- current exposed-schemas list, wherever it is set for the role
  select (regexp_match(c, '^pgrst\.db_schemas=(.*)$'))[1]
    into cfg
  from pg_db_role_setting s
  join pg_roles r on r.oid = s.setrole
  cross join lateral unnest(s.setconfig) as c
  where r.rolname = 'authenticator'
    and c like 'pgrst.db_schemas=%'
  limit 1;

  if cfg is null then
    -- nothing configured yet: start from the Supabase defaults, plus bob
    cfg := 'public, storage, graphql_public, bob';
    raise notice 'bob 0003: no pgrst.db_schemas set — initialising to "%"', cfg;
  elsif cfg ~ '(^|,)\s*bob\s*(,|$)' then
    raise notice 'bob 0003: schema bob already exposed ("%"), nothing to do', cfg;
    return;
  else
    -- shared database: append, never overwrite
    cfg := cfg || ', bob';
    raise notice 'bob 0003: appending bob — exposed schemas now "%"', cfg;
  end if;

  execute format('alter role authenticator set pgrst.db_schemas = %L', cfg);
end $$;

-- Tell PostgREST to pick up the new config AND rebuild its schema cache so the
-- bob tables/relationships are visible immediately. If the API ever serves
-- stale shapes after future DDL migrations, re-run these two notifies.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
