import { aiWebhookHandler } from '../_shared/ai-background-http.ts'
import { aiBackgroundRpc } from '../_shared/ai-background-runtime.ts'
Deno.serve(aiWebhookHandler(aiBackgroundRpc(), Deno.env.get('OPENAI_WEBHOOK_SECRET')))
