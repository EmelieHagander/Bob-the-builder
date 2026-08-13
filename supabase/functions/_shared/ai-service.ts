/*
 * ai-service.ts — the ONE AI service. Canonical copy; keep repos in sync.
 * ============================================================================
 *
 * Every AI call in every app goes through `callAi()`. No edge function talks to
 * a provider directly, and OPENAI_API_KEY is read ONLY in this file.
 *
 * It speaks the OpenAI **Responses API** (`/v1/responses`) — not chat
 * completions — which is what gives us structured JSON output, prompt caching
 * and reasoning effort from one call shape.
 *
 * WHERE THE CONFIGURATION LIVES
 * -----------------------------
 * Not here. The shared `ai` schema owns it (see the migration
 * 20260813092414_shared_ai_schema.sql in the hearthandlarder repo):
 *
 *   ai.models        the catalogue AND price list. THE gate on which models
 *                    may be called — there is deliberately no allow-list in
 *                    this file to drift out of sync with it. Adding a model is
 *                    a row insert, never a deploy.
 *   ai.settings      per (app, coworker, function, module): model, token
 *                    ceiling, temperature, prompt override, kill switch.
 *   ai.usage_events  one row per call, with the price snapshot used, so the
 *                    cost of a call stays true after the price list changes.
 *
 * Resolution order for the model: an explicit `options.model` override, else
 * the setting row, else the catalogue's `is_default` row. Whatever comes out
 * must exist in `ai.models` and be active, or the default is used instead and
 * a warning is logged.
 *
 * FAILURE POSTURE
 * ---------------
 * `callAi()` never throws. It returns a discriminated result so callers fall
 * back to honest non-AI behavior rather than showing an error page. Usage
 * logging is fire-and-forget and can never fail a call that already succeeded.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

/** How long resolved config is reused inside one warm instance, in ms.
 *  The previous implementation cached prices forever, so a warm instance
 *  billed at last week's rates indefinitely after a change. A short TTL means
 *  an edit to ai.models or ai.settings is live within a minute without adding
 *  a database round-trip to every single call. */
const CONFIG_TTL_MS = 60_000;

/* ── public types ─────────────────────────────────────────────────────────── */

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCallOptions {
  /** Owning app, by schema name: 'hearth' | 'akr' | 'bob' | 'maidin'. */
  app: string;
  /** Which AI persona this is, e.g. 'gardener', 'bob', 'meal-planner'. */
  coworkerId: string;
  /** Which function, e.g. 'journal-message'. With app + coworker + module this
   *  is the key into ai.settings. */
  functionName: string;
  /** Optional sub-scope; falls back to the app's 'global' row. */
  module?: string;
  /** Who the call is for — recorded on the usage row. */
  userId?: string;
  /** The system prompt. A non-empty ai.settings.prompt_template replaces it. */
  systemPrompt?: string;
  /** The conversation, oldest first. */
  messages: AiMessage[];
  /** Ask for structured output. `strict` JSON schema — the model must conform. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Override the configured model. Still validated against the catalogue. */
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface AiUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export type AiCallResult<T = unknown> =
  | {
    ok: true;
    /** The raw assistant text. With a jsonSchema this is the JSON source. */
    text: string;
    /** Parsed output when a jsonSchema was requested, else null. */
    data: T | null;
    model: string;
    usage: AiUsage;
    /** USD for this call, or null when the model has no price row. */
    costUsd: number | null;
  }
  | {
    /** Honest, stable error codes: not_configured, disabled, no_model,
     *  rate_limited, bad_api_key, timeout, openai_error, empty_response,
     *  bad_json, openai_unreachable. */
    ok: false;
    error: string;
  };

/* ── configuration ────────────────────────────────────────────────────────── */

interface ModelRow {
  model_name: string;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  cached_input_cost_per_1m_tokens: number | null;
  max_output_tokens: number;
  supports_reasoning: boolean;
  is_active: boolean;
  is_default: boolean;
}

interface SettingRow {
  model: string | null;
  max_output_tokens: number | null;
  temperature: number | null;
  reasoning_effort: string | null;
  prompt_template: string | null;
  is_enabled: boolean;
}

interface CacheEntry<T> {
  value: T;
  at: number;
}

const modelCache = new Map<string, CacheEntry<ModelRow[]>>();
const settingCache = new Map<string, CacheEntry<SettingRow | null>>();

function fresh<T>(entry: CacheEntry<T> | undefined, now: number): entry is CacheEntry<T> {
  return Boolean(entry) && now - entry!.at < CONFIG_TTL_MS;
}

/** Service-role client pinned to the shared `ai` schema. Only ever used to read
 *  configuration and write usage rows — never for app data, and never with an
 *  end-user's token, because no end-user JWT is in scope inside this service. */
function aiClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { db: { schema: "ai" } });
}

async function loadModels(supabase: SupabaseClient): Promise<ModelRow[]> {
  const now = Date.now();
  const hit = modelCache.get("all");
  if (fresh(hit, now)) return hit.value;

  const { data, error } = await supabase
    .from("models")
    .select(
      "model_name, input_cost_per_1m_tokens, output_cost_per_1m_tokens, cached_input_cost_per_1m_tokens, max_output_tokens, supports_reasoning, is_active, is_default",
    )
    .eq("is_active", true);

  if (error) {
    console.error(`[ai-service] model catalogue lookup failed: ${error.message}`);
    // Serve a stale cache rather than failing the call outright.
    return hit?.value ?? [];
  }

  const rows = (data ?? []) as ModelRow[];
  modelCache.set("all", { value: rows, at: now });
  return rows;
}

async function loadSetting(
  supabase: SupabaseClient,
  app: string,
  coworkerId: string,
  functionName: string,
  module: string,
): Promise<SettingRow | null> {
  const key = `${app}|${coworkerId}|${functionName}|${module}`;
  const now = Date.now();
  const hit = settingCache.get(key);
  if (fresh(hit, now)) return hit.value;

  // Both the module row and the app's 'global' row in one round trip; the
  // more specific one wins below.
  const { data, error } = await supabase
    .from("settings")
    .select("model, max_output_tokens, temperature, reasoning_effort, prompt_template, is_enabled, module_id")
    .eq("app", app)
    .eq("coworker_id", coworkerId)
    .eq("function_name", functionName)
    .in("module_id", [module, "global"]);

  if (error) {
    console.warn(`[ai-service] settings lookup failed: ${error.message}`);
    return hit?.value ?? null;
  }

  const rows = (data ?? []) as (SettingRow & { module_id: string })[];
  const row = rows.find((r) => r.module_id === module) ??
    rows.find((r) => r.module_id === "global") ?? null;

  settingCache.set(key, { value: row, at: now });
  return row;
}

/* ── cost ─────────────────────────────────────────────────────────────────── */

/**
 * USD for one call, from the model's own price row. Returns null when the
 * model has no pricing — an honestly unknown cost, rather than the previous
 * implementation's silent $0.002-per-1k guess that quietly invented numbers.
 *
 * Cached input is billed at its discounted rate when the catalogue prices it
 * separately, otherwise as ordinary input. Reasoning tokens are already part
 * of `output_tokens` in the Responses API, so they are not added again.
 */
function computeCost(model: ModelRow | undefined, usage: AiUsage): number | null {
  if (!model) return null;

  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInput = usage.inputTokens - cached;
  const cachedRate = model.cached_input_cost_per_1m_tokens ?? model.input_cost_per_1m_tokens;

  const cost = (uncachedInput / 1_000_000) * Number(model.input_cost_per_1m_tokens) +
    (cached / 1_000_000) * Number(cachedRate) +
    (usage.outputTokens / 1_000_000) * Number(model.output_cost_per_1m_tokens);

  return Number(cost.toFixed(6));
}

/* ── the Responses API call ───────────────────────────────────────────────── */

/** Pulls the assistant text out of a Responses payload, tolerating both the
 *  `output_text` convenience field and the full `output` item array. */
function extractText(body: Record<string, unknown>): string {
  const convenience = body.output_text;
  if (typeof convenience === "string" && convenience.trim()) return convenience.trim();

  const output = body.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    // Reasoning items carry no user-visible text — skip them.
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        chunks.push((part as { text: string }).text);
      }
    }
  }
  return chunks.join("").trim();
}

function extractUsage(body: Record<string, unknown>): AiUsage {
  const u = (body.usage ?? {}) as Record<string, unknown>;
  const inDetails = (u.input_tokens_details ?? {}) as Record<string, unknown>;
  const outDetails = (u.output_tokens_details ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  return {
    inputTokens: n(u.input_tokens),
    cachedInputTokens: n(inDetails.cached_tokens),
    outputTokens: n(u.output_tokens),
    reasoningTokens: n(outDetails.reasoning_tokens),
    totalTokens: n(u.total_tokens),
  };
}

/* ── usage logging ────────────────────────────────────────────────────────── */

/** Fire-and-forget. A failure to record usage must never fail a call that
 *  already produced an answer, so this is deliberately not awaited. */
function logUsage(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): void {
  supabase
    .from("usage_events")
    .insert(row)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error(`[ai-service] usage log failed: ${error.message}`);
    });
}

/* ── entry point ──────────────────────────────────────────────────────────── */

export async function callAi<T = unknown>(options: AiCallOptions): Promise<AiCallResult<T>> {
  const startedAt = Date.now();
  const module = options.module ?? "global";

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("[ai-service] OPENAI_API_KEY is not set");
    return { ok: false, error: "not_configured" };
  }

  const supabase = aiClient();
  if (!supabase) {
    console.error("[ai-service] Supabase service credentials are not set");
    return { ok: false, error: "not_configured" };
  }

  const [models, setting] = await Promise.all([
    loadModels(supabase),
    loadSetting(supabase, options.app, options.coworkerId, options.functionName, module),
  ]);

  // The kill switch: the owner turned this function off. Not an error — the
  // caller falls back to its non-AI behavior.
  if (setting && setting.is_enabled === false) {
    return { ok: false, error: "disabled" };
  }

  const defaultModel = models.find((m) => m.is_default) ?? models[0];
  const requested = options.model ?? setting?.model ?? defaultModel?.model_name;
  let model = models.find((m) => m.model_name === requested);

  if (!model) {
    if (requested) {
      console.warn(
        `[ai-service] model "${requested}" is not in the active catalogue — falling back to "${defaultModel?.model_name}"`,
      );
    }
    model = defaultModel;
  }
  if (!model) {
    // An empty catalogue is a configuration failure, not a model choice.
    console.error("[ai-service] no active models in ai.models");
    return { ok: false, error: "no_model" };
  }

  // Never ask for more than the model can produce.
  const requestedTokens = options.maxOutputTokens ?? setting?.max_output_tokens ?? 1000;
  const maxOutputTokens = Math.min(requestedTokens, model.max_output_tokens);

  const promptOverride = setting?.prompt_template?.trim();
  const instructions = promptOverride || options.systemPrompt || "";

  const payload: Record<string, unknown> = {
    model: model.model_name,
    input: options.messages.map((m) => ({
      role: m.role,
      content: [{ type: m.role === "user" ? "input_text" : "output_text", text: m.content }],
    })),
    max_output_tokens: maxOutputTokens,
  };
  if (instructions) payload.instructions = instructions;

  // Reasoning models reject an explicit temperature; non-reasoning ones accept
  // it. Sending it unconditionally is a 400 on the gpt-5 family.
  if (model.supports_reasoning) {
    const effort = setting?.reasoning_effort;
    if (effort) payload.reasoning = { effort };
  } else {
    // A `numeric` column can come back as a string depending on the client's
    // serialisation, so coerce rather than type-testing — a silently dropped
    // temperature is the kind of bug nobody notices for months.
    const raw = options.temperature ?? setting?.temperature;
    const temperature = raw === null || raw === undefined ? NaN : Number(raw);
    if (Number.isFinite(temperature)) payload.temperature = temperature;
  }

  if (options.jsonSchema) {
    payload.text = {
      format: {
        type: "json_schema",
        name: options.jsonSchema.name,
        schema: options.jsonSchema.schema,
        strict: true,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

  const baseUsageRow = {
    app: options.app,
    user_id: options.userId ?? null,
    module,
    ai_function: options.functionName,
    model: model.model_name,
    input_price_per_1m: model.input_cost_per_1m_tokens,
    output_price_per_1m: model.output_cost_per_1m_tokens,
  };

  try {
    const res = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Status only — an error body can echo the request back, and the prompt
      // may contain the user's own data.
      console.error(`[ai-service] responses API returned ${res.status}`);
      const error = res.status === 429
        ? "rate_limited"
        : res.status === 401 || res.status === 403
        ? "bad_api_key"
        : "openai_error";
      logUsage(supabase, {
        ...baseUsageRow,
        success: false,
        error_code: error,
        latency_ms: Date.now() - startedAt,
      });
      return { ok: false, error };
    }

    const body = (await res.json()) as Record<string, unknown>;
    const text = extractText(body);
    const usage = extractUsage(body);
    const costUsd = computeCost(model, usage);

    if (!text) {
      // A truncated run (hit max_output_tokens mid-answer) lands here too —
      // it cost real tokens, so it is still logged.
      console.error(`[ai-service] responses API returned no text (status: ${body.status})`);
      logUsage(supabase, {
        ...baseUsageRow,
        input_tokens: usage.inputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        output_tokens: usage.outputTokens,
        reasoning_tokens: usage.reasoningTokens,
        total_tokens: usage.totalTokens,
        cost_usd: costUsd,
        success: false,
        error_code: "empty_response",
        latency_ms: Date.now() - startedAt,
      });
      return { ok: false, error: "empty_response" };
    }

    let data: T | null = null;
    if (options.jsonSchema) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        console.error("[ai-service] structured output was not valid JSON");
        logUsage(supabase, {
          ...baseUsageRow,
          input_tokens: usage.inputTokens,
          cached_input_tokens: usage.cachedInputTokens,
          output_tokens: usage.outputTokens,
          reasoning_tokens: usage.reasoningTokens,
          total_tokens: usage.totalTokens,
          cost_usd: costUsd,
          success: false,
          error_code: "bad_json",
          latency_ms: Date.now() - startedAt,
        });
        return { ok: false, error: "bad_json" };
      }
    }

    logUsage(supabase, {
      ...baseUsageRow,
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens,
      output_tokens: usage.outputTokens,
      reasoning_tokens: usage.reasoningTokens,
      total_tokens: usage.totalTokens,
      cost_usd: costUsd,
      success: true,
      latency_ms: Date.now() - startedAt,
    });

    return { ok: true, text, data, model: model.model_name, usage, costUsd };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    const error = timedOut ? "timeout" : "openai_unreachable";
    console.error(`[ai-service] ${error}`, timedOut ? "" : err);
    logUsage(supabase, {
      ...baseUsageRow,
      success: false,
      error_code: error,
      latency_ms: Date.now() - startedAt,
    });
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}
