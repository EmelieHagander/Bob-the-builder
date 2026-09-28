import { aiWorkerHandler } from '../_shared/ai-background-http.ts'
import { aiBackgroundRpc } from '../_shared/ai-background-runtime.ts'
Deno.serve(aiWorkerHandler(aiBackgroundRpc(), Deno.env.get('OPENAI_API_KEY')!))
