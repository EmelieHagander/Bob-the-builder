/**
 * Load one system prompt from the family's prompt store, `shared.ai_prompts`.
 *
 * CANONICAL FILE — byte-identical across every app repo in this Supabase
 * project. Change it here and copy it out; do not fork it.
 *
 * WHERE PROMPTS LIVE
 * ------------------
 * One row per (app, prompt_key). The store used to be `hearth.ai_prompts`,
 * which only Hearth could reach; it now sits in `shared` beside the model
 * catalogue, the per-function settings and the usage ledger, so the family
 * admin can read and edit every app's prompts in one place. `hearth.ai_prompts`
 * survives as a compatibility view over it.
 *
 * ON THE FALLBACK
 * ---------------
 * Every caller passes the prompt it would have used anyway. That is not
 * belt-and-braces: it is what makes the store safe to edit. A missing row, a
 * bad key, an unconfigured environment or a database that is briefly unhappy
 * degrades to the prompt compiled into the function rather than sending the
 * model an empty instruction — and an empty system prompt does not fail
 * loudly, it quietly returns something shaped wrong.
 *
 * The row wins whenever it exists and has content, so an edit takes effect on
 * the next call with no deploy. Blanking a row in the editor therefore hands
 * the function back to its own prompt, which is the honest meaning of empty.
 *
 * Service role, deliberately: prompts are configuration, not user data, and
 * must load the same way for every caller regardless of who is signed in.
 */

import { createAiClient } from './openai-service.ts';

export async function loadPrompt(
  app: string,
  key: string,
  fallback: string,
): Promise<string> {
  try {
    if (!Deno.env.get('SUPABASE_URL') || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      console.log(`[PromptLoader] No service-role config; using the built-in prompt for "${app}/${key}"`);
      return fallback;
    }

    // service-role: shared.ai_prompts is admin-managed configuration with no
    // per-user rows, and must resolve identically for every caller.
    const { data, error } = await createAiClient()
      .from('ai_prompts')
      .select('content')
      .eq('app', app)
      .eq('prompt_key', key)
      .maybeSingle();

    if (error) {
      console.error(`[PromptLoader] Could not load "${app}/${key}":`, error.message);
      return fallback;
    }

    const content = (data as { content?: string } | null)?.content?.trim();
    if (content) {
      console.log(`[PromptLoader] Loaded "${app}/${key}" from shared.ai_prompts`);
      return content;
    }

    console.log(`[PromptLoader] No content for "${app}/${key}"; using the built-in prompt`);
    return fallback;
  } catch (err) {
    console.error(`[PromptLoader] Exception loading "${app}/${key}":`, err);
    return fallback;
  }
}
