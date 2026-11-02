-- Claude 5.5 models in the shared model table (Emelie, 2026-11-02):
-- Haiku = nano, Sonnet = mini, Opus = standard.
--
-- Adding rows switches nothing on. No tier is bound to these models, the
-- catalog publish check still accepts only OpenAI, and Bob's code switch
-- ANTHROPIC_ENABLED (supabase/functions/_shared/anthropic-service.ts) is off.
--
-- Shared-schema safety (hearth, akr and bob all read this table):
--   * is_current_for_type stays FALSE. The propagate_current_ai_model_type
--     trigger would otherwise move EVERY app's ai_settings of that type to
--     Claude, and only Bob can call Claude.
--   * is_default stays FALSE: legacy settings callers fall back to the default.
-- Prices are USD per 1M tokens (Anthropic list prices, 2026-10). Haiku 5.5
-- costs more above 100K prompt tokens ($0.50 / $2.50); the ledger uses the
-- base rate, so very long Haiku prompts are under-counted.
insert into shared.ai_models(model_name, provider, display_name, model_type,
  input_cost_per_1m_tokens, output_cost_per_1m_tokens, cached_input_cost_per_1m_tokens,
  max_output_tokens, supports_json_schema, supports_reasoning, supports_images,
  supports_image_output, is_active, is_default, is_current_for_type, notes, capabilities)
values
  ('claude-haiku-5-5', 'anthropic', 'Claude Haiku 5.5', 'nano', 0.10, 0.50, 0.01,
    128000, true, true, true, false, true, false, false,
    'Bob only (anthropic-messages-v1). Never current/default: other apps cannot call Claude.',
    '{"provider_adapter":"anthropic-messages-v1","supports_functions":true,"supports_json_schema":true,"forced_tool_choice":false,"reasoning_efforts":["low","medium","high","xhigh","max"]}'),
  ('claude-sonnet-5-5', 'anthropic', 'Claude Sonnet 5.5', 'mini', 2.00, 10.00, 0.20,
    128000, true, true, true, false, true, false, false,
    'Bob only (anthropic-messages-v1). Never current/default: other apps cannot call Claude.',
    '{"provider_adapter":"anthropic-messages-v1","supports_functions":true,"supports_json_schema":true,"forced_tool_choice":false,"reasoning_efforts":["low","medium","high","xhigh","max"]}'),
  ('claude-opus-5-5', 'anthropic', 'Claude Opus 5.5', 'standard', 4.00, 20.00, 0.20,
    128000, true, true, true, false, true, false, false,
    'Bob only (anthropic-messages-v1). Never current/default: other apps cannot call Claude.',
    '{"provider_adapter":"anthropic-messages-v1","supports_functions":true,"supports_json_schema":true,"forced_tool_choice":false,"reasoning_efforts":["low","medium","high","xhigh","max"]}')
on conflict (model_name) do nothing;
