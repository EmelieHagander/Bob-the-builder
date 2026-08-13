/**
 * The ONE OpenAI service, shared by every app in this Supabase project.
 * Canonical copy — keep byte-identical across repos.
 *
 * Text via the Responses API (/v1/responses), images via /v1/images/generations.
 * Model choice, token ceilings, reasoning effort, prompt overrides and the kill
 * switch all come from the `shared` schema; every call is costed into
 * shared.ai_usage_events.
 *
 * Every caller passes `app` — it selects that app's settings rows and is what
 * the spend is attributed to. Nothing in this file may be app-specific.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

/**
 * Service-role client pinned to the `shared` schema — the cross-app model
 * catalogue (shared.ai_models), per-function settings (shared.ai_settings) and
 * the usage ledger (shared.ai_usage_events).
 *
 * Created here rather than imported so this file stays portable: it is the
 * SAME module in every app's repo, and it may not depend on any one app's
 * client factory. It is only ever used for AI configuration and accounting,
 * never for app data.
 *
 * Exported so the prompt loader can reach shared.ai_prompts through the same
 * client, rather than each repo growing its own copy of this factory.
 */
export function createAiClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, {
    db: { schema: "shared" },
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as SupabaseClient;
}

/**
 * Label used in the `model` field of error responses returned BEFORE a model
 * has been resolved (missing API key, missing Supabase credentials). It is
 * never actually called — the real choice always comes from shared.ai_models.
 */
const FALLBACK_MODEL = 'gpt-4.1-2025-04-14';

/* ── model catalogue (shared `ai` schema) ──────────────────────────────────
 * Which models may be called, and what they cost, both live in shared.ai_models —
 * the single source of truth shared by every app in this project. There is
 * deliberately NO hardcoded model list or price table in this file any more:
 *
 *   * the old VALID_MODELS array meant adding a model to the database still
 *     required a code change before it could actually be used;
 *   * the old MODEL_COST_PER_1K_USD fallback had drifted badly (it billed
 *     gpt-4o-mini at $0.60/1M input against a real $0.15, and gpt-4.1 at
 *     $5.00/1M against a real $2.00), so anything falling through to it
 *     reported 3-4x the true cost;
 *   * the old cache never expired, so a warm instance kept billing at the
 *     prices it happened to read first, forever.
 *
 * Adding or repricing a model is now a row edit. The TTL below is what makes
 * that edit take effect without a deploy.
 * ───────────────────────────────────────────────────────────────────────── */

interface AiModelRow {
  model_name: string;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  cached_input_cost_per_1m_tokens: number | null;
  max_output_tokens: number;
  is_default: boolean;
  /** The model GENERATES images. Distinct from reading one as input. */
  supports_image_output: boolean;
  /** The model accepts a reasoning budget (reasoning.effort). */
  supports_reasoning: boolean;
}

const MODEL_CACHE_TTL_MS = 60_000;
let modelCache: { rows: AiModelRow[]; at: number } | null = null;

async function loadModels(aiClient: SupabaseClient): Promise<AiModelRow[]> {
  const now = Date.now();
  if (modelCache && now - modelCache.at < MODEL_CACHE_TTL_MS) return modelCache.rows;

  const { data, error } = await aiClient
    .from('ai_models')
    .select('model_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,cached_input_cost_per_1m_tokens,max_output_tokens,is_default,supports_image_output,supports_reasoning')
    .eq('is_active', true);

  if (error) {
    console.error(`[OpenAI Service] Model catalogue lookup failed: ${error.message}`);
    // Serve a stale cache rather than failing a call outright.
    return modelCache?.rows ?? [];
  }

  const rows = (data ?? []) as AiModelRow[];
  modelCache = { rows, at: now };
  return rows;
}

/**
 * Cost of one call in USD, from the model's own price row. Returns null when
 * the model has no pricing — honestly unknown, rather than the previous
 * silent $0.002-per-1k guess that invented plausible numbers.
 */
function computeCostUsd(
  model: AiModelRow | undefined,
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number }
): number | null {
  if (!model) return null;

  const cached = Math.min(usage.cached_input_tokens ?? 0, usage.input_tokens);
  const uncachedInput = usage.input_tokens - cached;
  const cachedRate = model.cached_input_cost_per_1m_tokens ?? model.input_cost_per_1m_tokens;

  const cost =
    (uncachedInput / 1_000_000) * Number(model.input_cost_per_1m_tokens) +
    (cached / 1_000_000) * Number(cachedRate) +
    (usage.output_tokens / 1_000_000) * Number(model.output_cost_per_1m_tokens);

  return Number(cost.toFixed(6));
}

export interface OpenAIServiceOptions {
  /** Owning app, by schema name: 'hearth' | 'akr' | 'bob' | 'maidin'.
   *  Selects the app's shared.ai_settings rows and attributes the spend. */
  app: string;
  prompt?: string;
  systemMessage?: string;
  schemaName?: string;
  schemaDescription?: string;
  schema?: Record<string, unknown>;
  module: string;
  aiFunction: string;
  coworkerId: string;
  functionName: string;
  workspaceId?: string;
  userId?: string;
  model?: string; // Override model selection (e.g., 'gpt-5-mini')
  maxOutputTokens?: number;
  timeoutMs?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  images?: Array<{
    type: 'base64' | 'url';
    data?: string;
    url?: string;
    mimeType?: string;
  }>;
  fileName?: string;
  previousResponseId?: string;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };
  useHardcodedPrompt?: boolean;
}

export interface OpenAIServiceResponse<T = unknown> {
  success: boolean;
  data: T | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    reasoning_tokens?: number;
  };
  model: string;
  error?: string;
  responseId?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  estimatedCostUsd?: number;
}

function sanitizeJsonSchema(schema: Record<string, unknown>, strict: boolean = false): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return schema;
  
  const sanitized = { ...schema };
  
  const isObjectType =
    sanitized.type === 'object' ||
    (Array.isArray(sanitized.type) && sanitized.type.includes('object'));

  if (isObjectType && sanitized.properties && typeof sanitized.properties === 'object') {
    const properties = sanitized.properties as Record<string, unknown>;
    const propertyKeys = Object.keys(properties);
    
    if (Array.isArray(sanitized.required)) {
      const reqSet = new Set(sanitized.required as string[]);
      propertyKeys.forEach((k) => reqSet.add(k));
      sanitized.required = Array.from(reqSet);
    } else {
      sanitized.required = propertyKeys;
    }
    
    if (strict && sanitized.additionalProperties === undefined) {
      sanitized.additionalProperties = false;
    }
    
    sanitized.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        sanitizeJsonSchema(value as Record<string, unknown>, strict)
      ])
    );
  }
  
  if (sanitized.type === 'array' && sanitized.items) {
    sanitized.items = sanitizeJsonSchema(sanitized.items as Record<string, unknown>, strict);
  }
  
  return sanitized;
}

function getModelParams(_model: string, maxOutputTokens: number = 1000) {
  return { max_output_tokens: maxOutputTokens };
}

// Retry wrapper for network resilience - creates fresh AbortController per attempt
async function fetchWithRetry(
  url: string, 
  options: Omit<RequestInit, 'signal'>, 
  timeoutMs: number,
  maxRetries: number = 0
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Create fresh AbortController for each attempt to avoid timeout carryover
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      const isNetworkError = error instanceof Error && 
        (error.message.includes('connection') || 
         error.message.includes('network') ||
         error.message.includes('abort') ||
         error.message.includes('timeout') ||
         error.name === 'AbortError');
      
      if (!isNetworkError || attempt === maxRetries) throw error;
      
      const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
      console.log(`[OpenAI Service] Network error, retry ${attempt + 1}/${maxRetries} after ${delay}ms:`, 
        error instanceof Error ? error.message : 'Unknown error');
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

export async function callOpenAIResponses<T = unknown>(
  options: OpenAIServiceOptions
): Promise<OpenAIServiceResponse<T>> {
  const {
    prompt,
    systemMessage,
    schemaName,
    schema,
    module,
    aiFunction,
    // `workspaceId` is still accepted on the options for call-site
    // compatibility but is no longer recorded: the shared ledger partitions by
    // `app`, and every Hearth call only ever passed 'default'.
    coworkerId,
    functionName,
    userId,
    timeoutMs = 120000
  } = options;

  const maxOutputTokens = options.maxOutputTokens || 4000;

  const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openAIApiKey) {
    console.error('[OpenAI Service] Missing OPENAI_API_KEY');
    return {
      success: false,
      data: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      model: FALLBACK_MODEL,
      error: 'Missing OpenAI API key'
    };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[OpenAI Service] Missing Supabase credentials');
    return {
      success: false,
      data: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      model: FALLBACK_MODEL,
      error: 'Missing Supabase credentials'
    };
  }

  // service-role: read the shared AI catalogue/settings and write the usage
  // ledger — no end-user JWT is in scope inside the shared service.
  const aiClient = createAiClient();

  // Settings and catalogue in parallel; both live in the shared `ai` schema.
  const [modelsResult, settingsResult] = await Promise.all([
    loadModels(aiClient),
    aiClient
      .from('ai_settings')
      .select('model, max_output_tokens, temperature, reasoning_effort, module_id, prompt_template, is_enabled, metadata')
      .eq('app', options.app)
      .eq('coworker_id', coworkerId)
      .eq('function_name', functionName)
      .in('module_id', [module, 'global']),
  ]);

  const models = modelsResult;
  const { data: allSettings, error: settingsError } = settingsResult;

  if (settingsError) {
    console.warn(`[OpenAI Service] Settings lookup failed: ${settingsError.message}`);
  }

  const settings = allSettings?.find((s: { module_id: string }) => s.module_id === module) ||
                   allSettings?.find((s: { module_id: string }) => s.module_id === 'global') || null;

  // The kill switch: the owner turned this function off. Reported as a normal
  // failure so the caller's existing error path handles it.
  if (settings && settings.is_enabled === false) {
    return {
      success: false,
      data: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      model: FALLBACK_MODEL,
      error: 'AI function is disabled'
    };
  }

  // Explicit override, else the setting row, else the catalogue default.
  const defaultModelRow = models.find((m) => m.is_default) || models[0];
  const configuredModel = options.model || settings?.model || defaultModelRow?.model_name;

  // The catalogue IS the allow-list — no hardcoded array to keep in sync.
  let modelRow = models.find((m) => m.model_name === configuredModel);
  if (!modelRow) {
    if (configuredModel) {
      console.warn(
        `[OpenAI Service] Model "${configuredModel}" is not in the active catalogue, falling back to ${defaultModelRow?.model_name}`
      );
    }
    modelRow = defaultModelRow;
  }

  if (!modelRow) {
    console.error('[OpenAI Service] No active models in shared.ai_models');
    return {
      success: false,
      data: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      model: FALLBACK_MODEL,
      error: 'No active AI model is configured'
    };
  }

  const currentModel = modelRow.model_name;
  console.log(`[OpenAI Service] Using model: ${currentModel}`);

  // Never ask for more than the model can actually produce.
  const dbMaxTokens = settings?.max_output_tokens || 0;
  const configuredMaxTokens = Math.min(
    Math.max(dbMaxTokens, maxOutputTokens),
    modelRow.max_output_tokens
  );

  // Determine effective system message
  const dbPromptTemplate = settings?.prompt_template?.trim() || '';
  let effectiveSystemMessage: string;
  
  if (options.useHardcodedPrompt === true) {
    effectiveSystemMessage = systemMessage || '';
  } else if (dbPromptTemplate) {
    effectiveSystemMessage = dbPromptTemplate;
  } else {
    effectiveSystemMessage = systemMessage || '';
  }
  
  try {
    const modelParams = getModelParams(currentModel, configuredMaxTokens);
    const inputMessages: Array<Record<string, unknown>> = [];
    
    // Build input messages
    if (options.messages && options.messages.length > 0) {
      for (const msg of options.messages) {
        if (msg.role === 'system') continue;
        
        if (msg.role === 'tool') {
          inputMessages.push({
            type: 'function_call_output',
            call_id: msg.tool_call_id,
            output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          });
          continue;
        }
        
        let content: Array<Record<string, unknown>>;
        if (typeof msg.content === 'string') {
          content = [{ type: msg.role === 'user' ? 'input_text' : 'output_text', text: msg.content }];
        } else if (Array.isArray(msg.content)) {
          content = (msg.content as Array<Record<string, unknown>>).map((c) => {
            if (c.type === 'text' || c.type === 'input_text' || c.type === 'output_text') {
              return { type: msg.role === 'user' ? 'input_text' : 'output_text', text: c.text };
            }
            if (c.type === 'image_url') {
              return { type: 'input_image', image_url: c.image_url };
            }
            if (c.text) {
              return { type: msg.role === 'user' ? 'input_text' : 'output_text', text: c.text };
            }
            return null;
          }).filter(Boolean) as Array<Record<string, unknown>>;
        } else {
          content = [{ type: 'input_text', text: '' }];
        }
        
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
          if (msg.content) {
            inputMessages.push({ role: 'assistant', content });
          }
          for (const tc of msg.tool_calls) {
            inputMessages.push({
              type: 'function_call',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments
            });
          }
          continue;
        }
        
        inputMessages.push({ role: msg.role === 'user' ? 'user' : msg.role, content });
      }
    } else {
      // Build from prompt
      const userContent: Array<Record<string, unknown>> = [];
      userContent.push({ type: "input_text", text: prompt || '' });
      
      // Add images/files
      if (options.images && options.images.length > 0) {
        for (let i = 0; i < options.images.length; i++) {
          const img = options.images[i];
          if (img.mimeType === 'application/pdf') {
            // PDF as file input - use URL directly if available (preferred)
            if (img.url) {
              userContent.push({
                type: "input_file",
                file_url: img.url
              });
            } else if (img.data) {
              // Fallback to base64 - raw bytes only, no data URL prefix!
              userContent.push({
                type: "input_file",
                filename: options.fileName || `document_${i + 1}.pdf`,
                file_data: img.data
              });
            }
          } else {
            // Image input - handle both URL and base64 formats
            let imageUrl: string | undefined;
            
            if (img.type === 'base64' && img.data) {
              // Base64 encoded image
              imageUrl = `data:${img.mimeType || 'image/jpeg'};base64,${img.data}`;
            } else if (img.type === 'url' && img.url) {
              // Direct URL (e.g., from Supabase Storage)
              imageUrl = img.url;
            } else if (img.data) {
              // Fallback to img.data if provided
              imageUrl = img.data;
            }
            
            if (imageUrl) {
              userContent.push({
                type: "input_image",
                image_url: imageUrl
              });
            } else {
              console.warn('[OpenAI Service] Invalid image format - skipping image:', JSON.stringify(img).slice(0, 100));
            }
          }
        }
      }
      
      inputMessages.push({ role: "user", content: userContent });
    }
    
    const requestBody: Record<string, unknown> = {
      model: currentModel,
      input: inputMessages,
      ...modelParams
    };
    
    // Add reasoning effort ONLY for reasoning-capable models.
    //
    // Capability comes from the CATALOGUE (shared.ai_models.supports_reasoning), not
    // from a list in this file. There used to be a hardcoded array here, and
    // it was the same trap as the old VALID_MODELS: adding gpt-5.4 to the
    // catalogue would have left it off the list, so reasoning.effort would be
    // silently dropped and the cost dial would quietly stop working.
    //
    // The DB setting wins over the caller's value: on a reasoning model,
    // effort is the main cost and latency dial, and it belongs next to the
    // model choice in shared.ai_settings rather than compiled into each function.
    // Call sites that pass reasoningEffort still work as a fallback.
    const effectiveEffort = settings?.reasoning_effort || options.reasoningEffort;
    if (effectiveEffort && modelRow.supports_reasoning) {
      requestBody.reasoning = { effort: effectiveEffort };
    } else if (effectiveEffort) {
      console.log(`[OpenAI Service] Skipping reasoning.effort for ${currentModel} (not reasoning-capable)`);
    }
    
    if (effectiveSystemMessage) {
      requestBody.instructions = effectiveSystemMessage;
    }
    
    if (options.previousResponseId) {
      requestBody.previous_response_id = options.previousResponseId;
    }
    
    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map((tool) => {
        if ((tool as Record<string, unknown>).name && !(tool as Record<string, unknown>).function) return tool;
        if (tool.type === 'function' && tool.function) {
          return {
            type: 'function',
            name: tool.function.name,
            description: tool.function.description,
            parameters: sanitizeJsonSchema(tool.function.parameters, true),
            strict: false,
          };
        }
        return tool;
      });
      // tool_choice needs the same Chat-Completions -> Responses flattening the
      // tools above get. The Responses API wants { type: 'function', name },
      // not { type: 'function', function: { name } }, and rejects the nested
      // form with "Missing required parameter: 'tool_choice.name'".
      //
      // A plain string ('auto' | 'required') is already valid, which is why
      // photo and URL import worked while "Fråga kocken" and nutrition — the
      // two that name a specific tool — did not. They were never called before
      // the capability was switched on, so the mismatch stayed hidden.
      if (options.tool_choice) {
        const choice = options.tool_choice;
        requestBody.tool_choice = typeof choice === 'string'
          ? choice
          : choice.function?.name
            ? { type: 'function', name: choice.function.name }
            : choice;
      }
    }
    
    // Add structured output format
    if (schema && schemaName && !options.tools) {
      requestBody.text = {
        format: {
          type: "json_schema",
          name: schemaName,
          schema: sanitizeJsonSchema(schema, true),
          strict: true
        }
      };
    }

    console.log(`[OpenAI Service] Request body keys:`, Object.keys(requestBody));

    const requestBodyStr = JSON.stringify(requestBody);
    const payloadSizeBytes = new TextEncoder().encode(requestBodyStr).length;
    const payloadSizeMB = payloadSizeBytes / (1024 * 1024);
    
    if (payloadSizeMB > 25) {
      return {
        success: false,
        data: null,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        model: currentModel,
        error: `Payload size ${payloadSizeMB.toFixed(2)}MB exceeds 25MB limit. Try using a smaller or compressed image.`
      };
    }
    
    console.log(`[OpenAI Service] Payload size: ${payloadSizeMB.toFixed(2)}MB`);

    // fetchWithRetry now handles timeout internally per attempt
    const response = await fetchWithRetry(
      'https://api.openai.com/v1/responses', 
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: requestBodyStr,
      },
      timeoutMs
    );
    const responseText = await response.text();
    
    console.log(`[OpenAI Service] Response status: ${response.status}`);

    if (!response.ok) {
      console.error(`[OpenAI Service] API error:`, responseText);
      return {
        success: false,
        data: null,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        model: currentModel,
        error: `OpenAI API error: ${response.status} - ${responseText}`
      };
    }

    const responseData = JSON.parse(responseText);
    
    // Debug: log response structure
    console.log('[OpenAI Service] Response keys:', Object.keys(responseData));
    console.log('[OpenAI Service] Output type:', typeof responseData?.output, Array.isArray(responseData?.output) ? `array[${responseData.output.length}]` : '');
    
    // Log ALL output item types for debugging reasoning models
    if (Array.isArray(responseData?.output)) {
      console.log('[OpenAI Service] All output item types:', 
        responseData.output.map((item: Record<string, unknown>) => item.type));
    }
    console.log('[OpenAI Service] output_text exists:', !!responseData?.output_text);
    
    // Usage and cost are computed HERE, before any branch that returns, so
    // every outcome is accounted for. This used to sit further down, past the
    // tool-call early return below — which meant every tool-calling function
    // (photo import, URL import, nutrition, shopping lists, meal plans, store
    // offers) recorded nothing at all. That is most of the AI spend in this
    // app, and it was invisible.
    const usage = {
      input_tokens: responseData.usage?.input_tokens || 0,
      output_tokens: responseData.usage?.output_tokens || 0,
      total_tokens: responseData.usage?.total_tokens || 0
    };
    const cachedInputTokens = responseData.usage?.input_tokens_details?.cached_tokens || 0;
    const reasoningTokens = responseData.usage?.output_tokens_details?.reasoning_tokens || 0;
    const estimatedCostUsd = computeCostUsd(modelRow, { ...usage, cached_input_tokens: cachedInputTokens });
    console.log(`[OpenAI Service] Cost: ${estimatedCostUsd === null ? 'unknown (no price row)' : `$${estimatedCostUsd}`}`);

    /** Everything the usage ledger needs that is constant for this call. */
    const usageBase = {
      app: options.app,
      module,
      aiFunction,
      model: currentModel,
      userId,
      inputTokens: usage.input_tokens,
      cachedInputTokens,
      outputTokens: usage.output_tokens,
      reasoningTokens,
      totalTokens: usage.total_tokens,
      costUsd: estimatedCostUsd,
      inputPricePer1m: modelRow.input_cost_per_1m_tokens,
      outputPricePer1m: modelRow.output_cost_per_1m_tokens,
    };

    // Check for tool calls
    const functionCallItems = responseData?.output?.filter(
      (item: Record<string, unknown>) => item.type === 'function_call'
    ) || [];

    if (functionCallItems.length > 0) {
      const toolCalls = functionCallItems.map((fc: Record<string, unknown>) => ({
        id: fc.call_id,
        type: 'function',
        function: { name: fc.name, arguments: fc.arguments }
      }));
      
      await logAIUsage(aiClient, { ...usageBase, success: true });

      return {
        success: true,
        data: null,
        toolCalls,
        responseId: responseData.id,
        usage,
        model: currentModel,
        estimatedCostUsd,
      };
    }
    
    // Parse output - IMPORTANT: Skip 'reasoning' type items (internal AI thinking)
    const messageOutput = responseData?.output?.find(
      (item: Record<string, unknown>) => item.type === 'message'
    );
    
    // Fallback: find any non-reasoning output if no message found
    const fallbackOutput = !messageOutput 
      ? responseData?.output?.find((item: Record<string, unknown>) => 
          item.type !== 'reasoning' && item.type !== undefined)
      : null;
    
    const outputToUse = messageOutput || fallbackOutput;
    console.log('[OpenAI Service] Using output type:', outputToUse?.type || 'none');
    
    // Try various content extraction paths
    let content: string = '';
    
    // Path 1: output_text (direct text response from Responses API)
    if (responseData?.output_text) {
      content = responseData.output_text;
    }
    // Path 2: Structured output - extract from message content array
    else if (outputToUse?.content && Array.isArray(outputToUse.content)) {
      const textContent = outputToUse.content.find(
        (c: Record<string, unknown>) => c.type === 'output_text' || c.type === 'text'
      );
      content = textContent?.text || '';
    }
    // Path 3: message output with direct text field
    else if (outputToUse?.text) {
      content = outputToUse.text;
    }
    // Path 4: choices array (Chat Completions format fallback)
    else if (responseData?.choices?.[0]?.message?.content) {
      content = responseData.choices[0].message.content;
    }
    
    console.log('[OpenAI Service] Extracted content length:', content.length);
    if (content.length > 0) {
      console.log('[OpenAI Service] Content preview:', content.substring(0, 200));
    }
    
    if (!content) {
      // Check if we got reasoning tokens but no output
      const hasReasoningOnly = responseData?.output?.some(
        (item: Record<string, unknown>) => item.type === 'reasoning'
      ) && !responseData?.output?.some(
        (item: Record<string, unknown>) => item.type === 'message' || item.type === 'text'
      );
      
      if (hasReasoningOnly) {
        console.log('[OpenAI Service] Model returned only reasoning tokens, no usable output');
        return {
          success: false,
          data: null,
          usage: {
            input_tokens: responseData?.usage?.input_tokens || 0,
            output_tokens: responseData?.usage?.output_tokens || 0,
            total_tokens: responseData?.usage?.total_tokens || 0,
            reasoning_tokens: responseData?.usage?.reasoning_tokens || 0
          },
          model: currentModel,
          error: 'Model returned only internal reasoning. Response too complex - try simplifying the request.'
        };
      }
      
      return {
        success: false,
        data: null,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        model: currentModel,
        error: 'No content in OpenAI response'
      };
    }

    // Determine if we should parse JSON
    const hasTools = Array.isArray(options.tools) && options.tools.length > 0;
    const hasSchema = !!(options.schema && options.schemaName);
    
    if (hasTools || !hasSchema) {
      await logAIUsage(aiClient, { ...usageBase, success: true });
      
      return {
        success: true,
        data: content as T,
        usage,
        model: currentModel,
        responseId: responseData.id,
        estimatedCostUsd
      };
    }

    // Parse JSON
    let parsedData: T | null = null;
    try {
      parsedData = JSON.parse(content);
    } catch (_parseError) {
      try {
        // Try to extract JSON from markdown code blocks
        const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          parsedData = JSON.parse(codeBlockMatch[1]);
        } else {
          // Try to find raw JSON object
          const match = content.match(/\{[\s\S]*\}/);
          if (match) parsedData = JSON.parse(match[0]);
        }
      } catch (_extractError) {
        console.error(`[OpenAI Service] Failed to parse JSON. Content preview:`, content.substring(0, 500));
        
        // Attempt to recover truncated JSON (common with large responses)
        // Strategy A: Products array recovery (for store offers)
        if (content.includes('"products"') && content.includes('[')) {
          console.log('[OpenAI Service] Attempting products JSON recovery...');
          
          // Strategy 1: Find last complete }] which closes the products array
          let recoveryPoint = content.lastIndexOf('}]');
          
          if (recoveryPoint > 0) {
            try {
              const truncated = content.substring(0, recoveryPoint + 2) + '}';
              parsedData = JSON.parse(truncated);
              console.log('[OpenAI Service] Recovered JSON (strategy 1) with', (parsedData as Record<string, unknown[]>)?.products?.length || 0, 'products');
            } catch (_e1) {
              recoveryPoint = -1; // Try next strategy
            }
          }
          
          // Strategy 2: Find last complete product object (ends with },)
          if (!parsedData) {
            const lastCompleteEntry = content.lastIndexOf('},');
            if (lastCompleteEntry > 0) {
              try {
                const truncated = content.substring(0, lastCompleteEntry + 1);
                const recovered = truncated + ']}';
                parsedData = JSON.parse(recovered);
                console.log('[OpenAI Service] Recovered JSON (strategy 2) with', (parsedData as Record<string, unknown[]>)?.products?.length || 0, 'products');
              } catch (_e2) {
                // Try strategy 3
              }
            }
          }
          
          // Strategy 3: Find last complete } and close everything
          if (!parsedData) {
            const lastBrace = content.lastIndexOf('}');
            if (lastBrace > 0) {
              try {
                // Check what comes before - if it looks like a product, close array
                const beforeBrace = content.substring(Math.max(0, lastBrace - 50), lastBrace);
                if (beforeBrace.includes('"name"') || beforeBrace.includes('"offer_price"')) {
                  const truncated = content.substring(0, lastBrace + 1);
                  const recovered = truncated + ']}';
                  parsedData = JSON.parse(recovered);
                  console.log('[OpenAI Service] Recovered JSON (strategy 3) with', (parsedData as Record<string, unknown[]>)?.products?.length || 0, 'products');
                }
              } catch (_e3) {
                console.log('[OpenAI Service] Products recovery strategies failed');
              }
            }
          }
        }
        
        // Strategy B: Meal plan suggestions recovery (improved with multiple truncation patterns)
        if (!parsedData && content.includes('"suggestions"') && content.includes('[')) {
          console.log('[OpenAI Service] Attempting meal plan JSON recovery...');
          
          // Recovery patterns in order of preference
          const recoveryPatterns = [
            // Pattern 1: Last complete suggestion with recipe object (ends with }},)
            { regex: /\}\s*\}\s*,\s*$/, suffix: ']}' },
            // Pattern 2: Last complete ingredient (ends with },) inside recipe
            { regex: /\}\s*,\s*$/, suffix: ']}]}' },
            // Pattern 3: String property ends (ends with ",)
            { regex: /"\s*,\s*$/, suffix: '"}]}' },
            // Pattern 4: Number/boolean ends (ends with , after value)
            { regex: /[0-9]\s*,\s*$/, suffix: ']}' },
          ];
          
          // First try: find last complete suggestion object (ends with },)
          const lastCompleteEntry = content.lastIndexOf('},');
          if (lastCompleteEntry > 0) {
            // Check if this looks like a complete suggestion (has dish_name nearby)
            const nearbyContent = content.substring(Math.max(0, lastCompleteEntry - 200), lastCompleteEntry);
            if (nearbyContent.includes('"dish_name"') || nearbyContent.includes('"is_from_cookbook"')) {
              try {
                const truncated = content.substring(0, lastCompleteEntry + 1);
                // Just close the suggestions array - no shopping_list needed (generated separately now)
                const recovered = truncated + ']}';
                parsedData = JSON.parse(recovered);
                console.log('[OpenAI Service] Recovered meal plan with', 
                  (parsedData as Record<string, unknown[]>)?.suggestions?.length || 0, 'suggestions');
              } catch (_e) {
                // Try with weekly_notes
                try {
                  const truncated = content.substring(0, lastCompleteEntry + 1);
                  const recovered = truncated + '], "weekly_notes": "Delvis genererad"}';
                  parsedData = JSON.parse(recovered);
                  console.log('[OpenAI Service] Recovered meal plan (with notes) with',
                    (parsedData as Record<string, unknown[]>)?.suggestions?.length || 0, 'suggestions');
                } catch (_e2) {
                  // Continue to pattern matching
                }
              }
            }
          }
          
          // Second try: pattern-based recovery
          if (!parsedData) {
            for (const { regex, suffix } of recoveryPatterns) {
              const match = content.match(regex);
              if (match) {
                try {
                  const truncated = content.substring(0, content.lastIndexOf(match[0]) + match[0].length - 1);
                  const recovered = truncated + suffix;
                  parsedData = JSON.parse(recovered);
                  console.log('[OpenAI Service] Recovered meal plan (pattern match) with',
                    (parsedData as Record<string, unknown[]>)?.suggestions?.length || 0, 'suggestions');
                  break;
                } catch (_e) {
                  continue;
                }
              }
            }
          }
          
          if (!parsedData) {
            console.log('[OpenAI Service] All meal plan recovery strategies failed');
          }
        }
      }
    }

    await logAIUsage(aiClient, { ...usageBase, success: parsedData !== null });

    if (parsedData) {
      return {
        success: true,
        data: parsedData,
        usage,
        model: currentModel,
        responseId: responseData.id,
        estimatedCostUsd
      };
    } else {
      return {
        success: false,
        data: null,
        usage,
        model: currentModel,
        error: 'Failed to parse JSON response',
        estimatedCostUsd
      };
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Request failed';
    console.error(`[OpenAI Service] Request error:`, errorMessage);
    return {
      success: false,
      data: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      model: currentModel,
      error: `Network error: ${errorMessage}`
    };
  }
}

/**
 * Write one row to the shared usage ledger (`shared.ai_usage_events`).
 *
 * AWAITED, deliberately. This was fire-and-forget, which loses rows: an edge
 * isolate can be torn down the moment the response is returned, and an insert
 * still in flight simply never lands. Observed in practice — two successful
 * parses recorded nothing at all, which makes the cost ledger quietly
 * under-report rather than visibly break.
 *
 * The insert costs a few milliseconds against a call that already took
 * seconds. It still never throws: a ledger failure must not fail a call that
 * already produced an answer.
 *
 * Two deliberate changes from the previous version:
 *   * `cost_usd` is persisted, along with the price snapshot it was computed
 *     from, so what a call cost stays true after the price list is edited;
 *   * prompt/response previews are NOT stored. Nothing read them (admin-stats
 *     only ever selected ai_function and total_tokens), and keeping excerpts
 *     of users' recipes and meal plans in a cross-app table is a privacy cost
 *     with no reader to justify it.
 */
async function logAIUsage(
  aiClient: SupabaseClient,
  params: {
    app: string;
    userId?: string;
    module: string;
    aiFunction: string;
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costUsd: number | null;
    inputPricePer1m: number;
    outputPricePer1m: number;
    success: boolean;
  }
): void {
  const { error } = await aiClient.from('ai_usage_events').insert({
    app: params.app,
    user_id: params.userId || null,
    module: params.module,
    ai_function: params.aiFunction,
    model: params.model,
    input_tokens: params.inputTokens,
    cached_input_tokens: params.cachedInputTokens,
    output_tokens: params.outputTokens,
    reasoning_tokens: params.reasoningTokens,
    total_tokens: params.totalTokens,
    input_price_per_1m: params.inputPricePer1m,
    output_price_per_1m: params.outputPricePer1m,
    cost_usd: params.costUsd,
    success: params.success
  });
  if (error) console.error(`[OpenAI Service] Usage log failed: ${error.message}`);
}

/* ══════════════════════════════════════════════════════════════════════════
 * IMAGE GENERATION
 *
 * Same catalogue, same settings, same ledger as the text path above — so an
 * image call is as visible in shared.ai_usage_events as any other, which
 * matters because images are the most expensive thing any of these apps call.
 *
 * This deliberately does NOT touch storage. It returns raw PNG bytes and the
 * calling app decides where they belong: Hearth writes recipe cards to
 * hearth-recipe-images, Akr's asset pipeline writes elsewhere. Bucket names,
 * path conventions and RLS around them are app concerns, not this file's.
 *
 * Prompts are likewise the app's. This service supplies the pipe, never the
 * words — a per-app prompt is the normal case, and shared.ai_settings
 * .prompt_template can override one without a deploy.
 * ══════════════════════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════════════════
 * IMAGE POST-PROCESSING
 *
 * The provider gives back one flat PNG. Several apps need something else from
 * it — a cut-out icon, four growth stages as separate assets, a normalised
 * size — and that work is identical wherever it happens, so it lives here
 * rather than in each app.
 *
 * The three steps compose:
 *
 *   clean   the background becomes transparent
 *   split   the cleaned image is cut into its separate sub-images
 *   scale   each result is normalised to a size
 *
 * `split` IMPLIES `clean`: sub-images are found as connected regions of
 * non-background pixels, so there is nothing to find until the background is
 * gone. It is not a meaningful option on its own.
 *
 * WHY THE PIPELINE EDITS THE PROMPT
 * ---------------------------------
 * Cleaning is only reliable against a flat, uniform, shadowless background,
 * and that has to be asked for at generation time. Leaving it to each caller
 * means one app eventually forgets and gets ragged cut-outs with a grey halo.
 * So when clean/split is requested this file appends the background contract
 * to the prompt itself — the pipeline owns both halves of it.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Appended to the prompt whenever the result will be cut out. */
const FLAT_BACKGROUND_INSTRUCTION =
  "IMPORTANT: place the subject on a completely flat, uniform pure white background. " +
  "No shadows, no drop shadow, no gradient, no vignette, no texture, no paper grain, " +
  "no border and no framing. The background must be a single solid colour.";

/**
 * Appended when several sub-images are wanted on one sheet.
 *
 * ORDER IS REQUESTED EXPLICITLY. Splitting returns the pieces in reading order
 * (left to right, top to bottom), which is only the caller's intended order if
 * the model laid them out that way. A first run drew a carrot's four growth
 * stages as mature, young, harvested, seedling — geometrically fine, and
 * semantically scrambled. Callers should still treat order as a strong hint
 * rather than a guarantee, and label the pieces where it matters.
 */
function sheetInstruction(count: number): string {
  return `Draw ${count} SEPARATE subjects arranged in ONE horizontal row, ` +
    `in exactly the order they are listed above, left to right, first to last. ` +
    `Space them clearly apart with generous empty background between them so none of them touch or overlap. ` +
    `All ${count} must be drawn in the same style, palette and lighting, as one matching set.`;
}

export interface ImagePostOptions {
  /** Turn the flat background transparent. */
  clean?: boolean;
  /** Cut the sheet into its sub-images. A number also asks the model for that
   *  many and is validated against what was actually found. Implies clean. */
  split?: boolean | number;
  /** Normalise each result.
   *
   *  A number, or a single dimension, resizes and keeps the aspect ratio.
   *
   *  Giving BOTH width and height with `fit: "contain"` produces an exact
   *  canvas: the subject is scaled to fit inside and centred, and the rest is
   *  left transparent. That is what an asset spec usually means by a size —
   *  Akr's plant assets are "256 x 512", not "about 256 wide" — and a plain
   *  resize would distort or crop instead. */
  scale?: number | {
    width?: number;
    height?: number;
    fit?: "contain" | "stretch";
  };
}

/** Squared RGB distance — cheap, and good enough against a flat background. */
function colourDistance(
  b: Uint8ClampedArray, i: number, r: number, g: number, bl: number,
): number {
  const dr = b[i] - r, dg = b[i + 1] - g, db = b[i + 2] - bl;
  return dr * dr + dg * dg + db * db;
}

/**
 * Background to alpha, flooding inward FROM THE BORDER rather than clearing
 * every pixel that matches. That distinction matters: a white flower petal in
 * the middle of a subject must survive, and it only does if the fill has to
 * reach it from outside.
 *
 * Two thresholds give a soft edge. Anything within `hard` of the background is
 * fully transparent; anything within `soft` that borders it gets proportional
 * alpha, which is what stops watercolour edges showing a grey halo.
 */
function clearBackground(img: InstanceType<typeof Image>): void {
  const w = img.width, h = img.height;
  const bmp = img.bitmap as unknown as Uint8ClampedArray;

  // The background colour is whatever dominates the border.
  const counts = new Map<string, { n: number; r: number; g: number; b: number }>();
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const key = `${bmp[i] >> 3},${bmp[i + 1] >> 3},${bmp[i + 2] >> 3}`;
    const e = counts.get(key) ?? { n: 0, r: bmp[i], g: bmp[i + 1], b: bmp[i + 2] };
    e.n++;
    counts.set(key, e);
  };
  for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y++) { sample(0, y); sample(w - 1, y); }
  let bg = { n: 0, r: 255, g: 255, b: 255 };
  for (const e of counts.values()) if (e.n > bg.n) bg = e;

  const HARD = 18 * 18 * 3;   // fully background
  const SOFT = 46 * 46 * 3;   // edge blend zone

  // Flood inward from every border pixel.
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (seen[p]) return;
    if (colourDistance(bmp, p * 4, bg.r, bg.g, bg.b) > HARD) return;
    seen[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  while (stack.length) {
    const p = stack.pop()!;
    bmp[p * 4 + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  // Feather: soften pixels that still touch transparency.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (bmp[p * 4 + 3] === 0) continue;
      const touches =
        (x > 0 && bmp[(p - 1) * 4 + 3] === 0) ||
        (x < w - 1 && bmp[(p + 1) * 4 + 3] === 0) ||
        (y > 0 && bmp[(p - w) * 4 + 3] === 0) ||
        (y < h - 1 && bmp[(p + w) * 4 + 3] === 0);
      if (!touches) continue;
      const d = colourDistance(bmp, p * 4, bg.r, bg.g, bg.b);
      if (d < SOFT) bmp[p * 4 + 3] = Math.round(255 * (d / SOFT));
    }
  }
}

/**
 * Bounding boxes of the connected non-transparent regions, in reading order.
 * This is what makes a sheet splittable without assuming a grid: the cells are
 * found from the pixels rather than from arithmetic, so the model is free to
 * lay them out however it likes.
 */
function findSubImages(
  img: InstanceType<typeof Image>,
  minArea: number,
): { x: number; y: number; w: number; h: number }[] {
  const w = img.width, h = img.height;
  const bmp = img.bitmap as unknown as Uint8ClampedArray;
  const seen = new Uint8Array(w * h);
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const MIN_AREA = minArea;

  for (let start = 0; start < w * h; start++) {
    if (seen[start] || bmp[start * 4 + 3] < 24) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const step = (nx: number, ny: number) => {
        const q = ny * w + nx;
        if (seen[q] || bmp[q * 4 + 3] < 24) return;
        seen[q] = 1;
        stack.push(q);
      };
      if (x > 0) step(x - 1, y);
      if (x < w - 1) step(x + 1, y);
      if (y > 0) step(x, y - 1);
      if (y < h - 1) step(x, y + 1);
    }
    if (area >= MIN_AREA) boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }

  // Reading order: rows first (grouped by vertical overlap), then left to right.
  boxes.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x));
  return boxes;
}

/** Applies the requested post-processing. Always returns at least one image. */
async function applyPost(
  png: Uint8Array,
  post: ImagePostOptions,
): Promise<Uint8Array[]> {
  const wantSplit = post.split === true || typeof post.split === "number";
  if (!post.clean && !wantSplit && post.scale === undefined) return [png];

  const img = await Image.decode(png);
  if (post.clean || wantSplit) clearBackground(img);

  let pieces: InstanceType<typeof Image>[] = [img];
  if (wantSplit) {
    // The speck filter is adaptive, because a legitimately tiny asset and a
    // fleck of stray pigment look identical by area alone. A six-stage plant
    // set includes a SEED, which at honest relative scale is smaller than any
    // fixed threshold that also excludes noise — the first run silently
    // dropped it and returned five stages.
    //
    // So when the caller says how many to expect, that expectation is the
    // signal: start strict, and relax until the count is reached.
    const expected = typeof post.split === "number" ? post.split : 0;
    const full = img.width * img.height;
    let boxes = findSubImages(img, full / 400);
    if (expected > 1) {
      for (const divisor of [1_500, 6_000, 25_000]) {
        if (boxes.length >= expected) break;
        boxes = findSubImages(img, full / divisor);
      }
      // Relaxing can overshoot into noise; keep the largest `expected` regions
      // but restore reading order afterwards.
      if (boxes.length > expected) {
        boxes = boxes
          .map((b, i) => ({ b, i, area: b.w * b.h }))
          .sort((a, z) => z.area - a.area)
          .slice(0, expected)
          .sort((a, z) => a.i - z.i)
          .map((e) => e.b);
      }
    }
    if (boxes.length > 1) {
      pieces = boxes.map((b) => img.clone().crop(b.x, b.y, b.w, b.h));
    } else {
      // One region means the subjects touched, or the model drew a single
      // scene. Returning the whole image is honest; silently handing back one
      // "stage" that is really four would be worse.
      console.warn(`[OpenAI Service] split requested but found ${boxes.length} region(s); returning whole image`);
    }
    if (typeof post.split === "number" && pieces.length !== post.split) {
      console.warn(`[OpenAI Service] split expected ${post.split}, found ${pieces.length}`);
    }
  }

  if (post.scale !== undefined) {
    const target = typeof post.scale === "number"
      ? { width: post.scale, height: undefined, fit: undefined }
      : post.scale;
    const auto = Image.RESIZE_AUTO;

    pieces = pieces.map((piece) => {
      // Exact canvas: fit inside, centre, leave the rest transparent.
      if (target.width && target.height && (target.fit ?? "contain") === "contain") {
        // Never enlarge. Upscaling a small region to fill the canvas both
        // destroys quality — a seed blown up to 256x512 is visibly mushy — and
        // is wrong on a scaled canvas: a seed should not render as large as a
        // mature plant. Anything smaller than the target simply sits centred
        // at its native size, which preserves relative scale for free.
        const ratio = Math.min(target.width / piece.width, target.height / piece.height, 1);
        const w = Math.max(1, Math.round(piece.width * ratio));
        const h = Math.max(1, Math.round(piece.height * ratio));
        const fitted = piece.resize(w, h);
        const canvas = new Image(target.width, target.height);
        canvas.fill(0x00000000);
        canvas.composite(fitted, Math.round((target.width - w) / 2), Math.round((target.height - h) / 2));
        return canvas;
      }
      if (target.width && target.height) return piece.resize(target.width, target.height);
      if (target.width) return piece.resize(target.width, auto);
      if (target.height) return piece.resize(auto, target.height);
      return piece;
    });
  }

  return await Promise.all(pieces.map((piece) => piece.encode() as Promise<Uint8Array>));
}

const IMAGES_ENDPOINT = "https://api.openai.com/v1/images/generations";

export interface ImageCallOptions {
  /** Owning app, by schema name: 'hearth' | 'akr' | 'bob' | 'maidin'. */
  app: string;
  coworkerId: string;
  functionName: string;
  module?: string;
  userId?: string;
  /** What to draw. A non-empty prompt_template setting is prepended as art
   *  direction, so the house style can be retuned without a deploy. */
  prompt: string;
  /** Portrait by default — cards and plates are portrait artefacts. */
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "low" | "medium" | "high";
  /** Override the configured model. Still checked against the catalogue. */
  model?: string;
  timeoutMs?: number;
  /** Optional cut-out / split / resize applied to the result. */
  post?: ImagePostOptions;
}

export type ImageCallResult =
  | {
    ok: true;
    /** Always an array — one entry unless `post.split` found more. A result
     *  that is sometimes bytes and sometimes a list is what callers get
     *  wrong, so it is a list either way. */
    images: Uint8Array[];
    model: string;
    costUsd: number | null;
  }
  | { ok: false; error: string };

/** Decodes base64 without blowing the stack on a multi-megabyte image. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Generate one image. Never throws — returns a discriminated result with the
 * same honest error codes as callAi, so a caller can mark a job failed rather
 * than crash.
 */

export async function generateImage(options: ImageCallOptions): Promise<ImageCallResult> {
  const startedAt = Date.now();
  const module = options.module ?? "global";

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("[OpenAI Service] OPENAI_API_KEY is not set");
    return { ok: false, error: "not_configured" };
  }

  // service-role: read the shared AI catalogue/settings and write the usage
  // ledger — no end-user JWT is in scope inside this service.
  const aiClient = createAiClient();

  const [models, settingsResult] = await Promise.all([
    loadModels(aiClient),
    aiClient
      .from('ai_settings')
      .select('model, module_id, prompt_template, is_enabled')
      .eq('app', options.app)
      .eq('coworker_id', options.coworkerId)
      .eq('function_name', options.functionName)
      .in('module_id', [module, 'global']),
  ]);

  const allSettings = settingsResult.data;
  const settings = allSettings?.find((s: { module_id: string }) => s.module_id === module) ||
                   allSettings?.find((s: { module_id: string }) => s.module_id === 'global') || null;

  if (settings && settings.is_enabled === false) return { ok: false, error: "disabled" };

  // Only a model that can actually produce an image. The catalogue flag is the
  // gate, so switching image models stays a row edit like everything else.
  const imageModels = models.filter((m) => m.supports_image_output);
  const requested = options.model ?? settings?.model;
  const model = imageModels.find((m) => m.model_name === requested) ?? imageModels[0];

  if (!model) {
    console.error("[OpenAI Service] No image-capable model in shared.ai_models");
    return { ok: false, error: "no_model" };
  }

  // A prompt override in the database wins as art direction; the caller's
  // prompt is the subject appended to it.
  const artDirection = settings?.prompt_template?.trim();
  let prompt = artDirection ? `${artDirection}\n\n${options.prompt}` : options.prompt;

  // The pipeline owns both halves of the cut-out contract: if the result is
  // going to be matted, the generation has to be asked for a flat background.
  const post = options.post;
  const wantSplit = post?.split === true || typeof post?.split === "number";
  if (post?.clean || wantSplit) {
    if (typeof post?.split === "number" && post.split > 1) {
      prompt += `\n\n${sheetInstruction(post.split)}`;
    }
    prompt += `\n\n${FLAT_BACKGROUND_INSTRUCTION}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000);

  const base = {
    app: options.app,
    userId: options.userId,
    module,
    aiFunction: options.functionName,
    model: model.model_name,
    inputPricePer1m: model.input_cost_per_1m_tokens,
    outputPricePer1m: model.output_cost_per_1m_tokens,
  };

  try {
    const res = await fetch(IMAGES_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.model_name,
        prompt,
        size: options.size ?? "1024x1536",
        quality: options.quality ?? "high",
        n: 1,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Status only — an error body can echo the prompt back.
      console.error(`[OpenAI Service] Images API returned ${res.status}`);
      const error = res.status === 429
        ? "rate_limited"
        : res.status === 401 || res.status === 403
        ? "bad_api_key"
        : "openai_error";
      await logAIUsage(aiClient, {
        ...base, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
        reasoningTokens: 0, totalTokens: 0, costUsd: null, success: false,
      });
      return { ok: false, error };
    }

    const body = await res.json();
    const b64: string | undefined = body?.data?.[0]?.b64_json;

    const usage = {
      input_tokens: body?.usage?.input_tokens || 0,
      output_tokens: body?.usage?.output_tokens || 0,
      total_tokens: body?.usage?.total_tokens || 0,
    };
    const costUsd = computeCostUsd(model, usage);
    console.log(
      `[OpenAI Service] Image in ${Date.now() - startedAt}ms, cost: ${costUsd === null ? "unknown" : `$${costUsd}`}`
    );

    await logAIUsage(aiClient, {
      ...base,
      inputTokens: usage.input_tokens,
      cachedInputTokens: body?.usage?.input_tokens_details?.cached_tokens || 0,
      outputTokens: usage.output_tokens,
      reasoningTokens: 0,
      totalTokens: usage.total_tokens,
      costUsd,
      success: Boolean(b64),
    });

    if (!b64) {
      console.error("[OpenAI Service] Images API returned no image data");
      return { ok: false, error: "empty_response" };
    }

    let images: Uint8Array[];
    try {
      images = await applyPost(base64ToBytes(b64), post ?? {});
    } catch (postErr) {
      // The image cost real money and is fine — hand back the original rather
      // than losing it because the matting failed.
      console.error("[OpenAI Service] Post-processing failed; returning the raw image", postErr);
      images = [base64ToBytes(b64)];
    }

    return { ok: true, images, model: model.model_name, costUsd };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    const error = timedOut ? "timeout" : "openai_unreachable";
    console.error(`[OpenAI Service] Image ${error}`);
    await logAIUsage(aiClient, {
      ...base, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
      reasoningTokens: 0, totalTokens: 0, costUsd: null, success: false,
    });
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}
