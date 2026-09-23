import type { PGlite } from '@electric-sql/pglite'

/** External app contracts verified from the shared project catalog. No real data. */
export async function setupSharedSocial(pg: PGlite) {
  await pg.exec(`
    create schema shared;
    create type shared.access_status as enum ('invited','active','revoked');
    create type shared.access_level as enum ('member','admin');
    -- Minimal cross-app AI catalogue/settings contract. Bob migrations may seed
    -- their own function configuration, but tests never need real provider data.
    create type shared.ai_model_type as enum ('nano','mini','standard','image','embedding');
    create type shared.ai_reasoning_effort as enum ('minimal','low','medium','high');
    create table shared.ai_models(
      model_name text primary key,
      is_active boolean not null default true
    );
    insert into shared.ai_models(model_name,is_active)
      values('gpt-5.4-mini',true),('gpt-5.4-nano',true);
    create table shared.ai_settings(
      id uuid primary key default gen_random_uuid(),
      app text not null,
      coworker_id text not null,
      function_name text not null,
      module_id text not null,
      model text references shared.ai_models(model_name),
      model_type shared.ai_model_type,
      max_output_tokens integer,
      temperature numeric,
      reasoning_effort shared.ai_reasoning_effort,
      prompt_template text,
      web_search boolean,
      is_enabled boolean,
      metadata jsonb,
      updated_at timestamptz not null default clock_timestamp(),
      unique(app,coworker_id,function_name,module_id)
    );
    create table shared.households(id uuid primary key default gen_random_uuid(),name text not null);
    create table shared.members(id uuid primary key default gen_random_uuid(),household_id uuid not null references shared.households(id),display_name text not null,unique(id,household_id));
    create table shared.household_access(id uuid primary key default gen_random_uuid(),household_id uuid not null references shared.households(id),
      user_id uuid not null references auth.users(id),member_id uuid,access_level shared.access_level not null default 'member',
      status shared.access_status not null default 'invited',unique(household_id,user_id),foreign key(member_id,household_id) references shared.members(id,household_id));
    create schema hearth;
    create table hearth.profiles(user_id uuid primary key references auth.users(id),username text,display_name text);
    create table hearth.friendships(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
      friend_user_id uuid not null references auth.users(id),status text not null check(status in ('pending','accepted','declined')),
      unique(user_id,friend_user_id),check(user_id<>friend_user_id));
    alter table shared.households enable row level security;
    alter table shared.members enable row level security;
    alter table shared.household_access enable row level security;
    alter table hearth.profiles enable row level security;
    alter table hearth.friendships enable row level security;
    -- Normal Bob users cannot query these fixture tables directly. The guarded
    -- Bob definer seam must therefore actually supply its own caller checks.
  `)
}
