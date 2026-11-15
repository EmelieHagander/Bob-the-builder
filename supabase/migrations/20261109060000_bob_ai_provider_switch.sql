-- Owner decision 2026-11-09 ("en switch ska byta instantly så att allt (som
-- går, inte embeddings och inte bilder) byter modell"): one live value per app
-- names the text provider. Bob reads it at every model call (cached ten
-- seconds) and never pins it in a job, so running jobs move with it. Image and
-- embedding tiers keep their catalog binding. Changed by SQL from a thread;
-- there is no UI (owner choice 2026-11-09). Deleting the row returns every
-- job to its pinned catalog model.
--
-- Switch to Claude: update shared.ai_provider_switch set provider='anthropic', updated_at=now() where app='bob';
-- Switch to GPT:    update shared.ai_provider_switch set provider='openai', updated_at=now() where app='bob';
create table if not exists shared.ai_provider_switch (
  app text primary key,
  provider text not null check (provider in ('openai','anthropic')),
  models jsonb not null check (jsonb_typeof(models)='object'),
  updated_at timestamptz not null default now(),
  note text
);
alter table shared.ai_provider_switch enable row level security;
revoke all on shared.ai_provider_switch from public, anon, authenticated;
grant select on shared.ai_provider_switch to service_role;

-- Every named model must exist, be active, belong to the provider and serve the tier.
create or replace function shared.ai_provider_switch_check() returns trigger
language plpgsql security invoker set search_path='' as $$
declare entry record; tiers record;
begin
  for entry in select key provider, value from jsonb_each(new.models) loop
    if entry.provider not in ('openai','anthropic') or jsonb_typeof(entry.value)<>'object' then
      raise exception 'ai_provider_switch_invalid: %', entry.provider using errcode='22023';
    end if;
    for tiers in select key tier, value#>>'{}' model_name from jsonb_each(entry.value) loop
      if tiers.tier not in ('nano','mini','standard') or not exists(select 1 from shared.ai_models m
        where m.model_name=tiers.model_name and m.provider::text=entry.provider and m.is_active and m.model_type::text=tiers.tier
          and m.capabilities->>'provider_adapter'=case entry.provider when 'anthropic' then 'anthropic-messages-v1' else 'openai-responses-v1' end) then
        raise exception 'ai_provider_switch_model_unavailable: % %', entry.provider, tiers.tier using errcode='22023';
      end if;
    end loop;
  end loop;
  if not (new.models ? new.provider) then raise exception 'ai_provider_switch_provider_unmapped' using errcode='22023'; end if;
  return new;
end $$;
drop trigger if exists ai_provider_switch_check on shared.ai_provider_switch;
create trigger ai_provider_switch_check before insert or update on shared.ai_provider_switch
  for each row execute function shared.ai_provider_switch_check();

-- Bob ran on GPT when this was written (tier rollback 2026-11-08 20:24).
insert into shared.ai_provider_switch(app, provider, models, note) values ('bob', 'openai',
  $models${"openai":{"nano":"gpt-5.4-nano","mini":"gpt-5.4-mini","standard":"gpt-5.4"},"anthropic":{"nano":"claude-haiku-5-5","mini":"claude-sonnet-5-5","standard":"claude-opus-5-5"}}$models$::jsonb,
  'Owner decision 2026-11-09: live text provider switch')
on conflict (app) do nothing;
