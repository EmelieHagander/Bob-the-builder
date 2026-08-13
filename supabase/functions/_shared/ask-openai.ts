/*
 * ask-openai.ts — the direct-OpenAI backend for the Ask seam.
 *
 * This is the tier that answers when the Launchpad builders team isn't
 * configured. The two backends differ in kind, and the UI is told which one
 * answered so it never over-promises:
 *
 *   Launchpad   a team of AI builders, async, minutes, produces artifacts
 *   OpenAI      one model, synchronous, seconds, answers from the briefing
 *
 * Both are info-only: they answer questions, they never write to the app's
 * database. That is a contract the UI copy depends on, so the system prompt
 * states it outright rather than trusting the model to infer it.
 *
 * The caller's JWT is forwarded into the client used to build the briefing,
 * so RLS — not this code — decides what the model is allowed to see.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildContext } from './bob-context.ts'
import { callAi } from './ai-service.ts'

export interface AskOpenAiOptions {
  /** The caller's raw Authorization header, forwarded so RLS applies. */
  authHeader: string
  /** The app's Postgres schema, pinned in the per-app function source. */
  dbSchema: string
  /** The app's name, for ai.settings lookup and usage attribution. */
  app: string
  /** The signed-in user, recorded on the shared usage row. */
  userId?: string
  /** The user's question. */
  message: string
  /** Prior turns of this conversation, oldest first. */
  history?: { role: 'user' | 'assistant'; content: string }[]
}

export type AskOpenAiResult =
  | { ok: true; answer: string }
  | { ok: false; error: string }

const SYSTEM_PROMPT = `You are bob — the coordinator of a community build project.

Who you are:
- Warm, practical and concrete. You talk like an experienced site lead who
  knows everyone by name, not like a chatbot. Short paragraphs, plain words.
- You keep the whole build in your head, so you answer from THE BRIEFING below.

Hard rules:
- Answer ONLY from the briefing. If the answer isn't in it, say plainly that
  you don't have that in front of you and name what would need to be added to
  the project for you to know. Never invent a task, person, material, price,
  date or quantity.
- You are INFO-ONLY. You cannot add, change, assign or buy anything. Never say
  you have done something or will do it — instead point to where in the app the
  person can do it themselves ("open the area page and use Assign").
- Numbers, names and statuses must match the briefing exactly. Percentages and
  quantities are given to you — never estimate over them.
- Be brief. Two or three short paragraphs, or a tight list when the question is
  a list question. Skip pleasantries and get to the substance.
- Match the language the person writes in.`

export async function answerWithOpenAi(opts: AskOpenAiOptions): Promise<AskOpenAiResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) return { ok: false, error: 'not_configured' }

  const supabase = createClient(supabaseUrl, anonKey, {
    db: { schema: opts.dbSchema },
    global: { headers: { Authorization: opts.authHeader } },
  })

  // A failed briefing is not fatal — bob can still answer generally, he just
  // says he can't see the project rather than pretending he can.
  let briefing: string | null = null
  try {
    briefing = (await buildContext(supabase)).briefing
  } catch (err) {
    console.error('ask-openai: could not build the briefing', err)
  }

  // The briefing rides in the system prompt rather than as a turn: it is
  // context, not something the user said, and keeping it in `instructions`
  // makes it the stable prefix that prompt caching can actually reuse.
  const systemPrompt = `${SYSTEM_PROMPT}\n\n${
    briefing
      ? `THE BRIEFING — the current state of the build:\n\n${briefing}`
      : 'THE BRIEFING is empty: there is no project set up yet, or you have no access to one. Say so honestly and suggest starting a project in the app.'
  }`

  const result = await callAi({
    app: opts.app,
    coworkerId: 'bob',
    functionName: 'ask-bob',
    userId: opts.userId,
    systemPrompt,
    messages: [
      ...(opts.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: opts.message },
    ],
    maxOutputTokens: 700,
    temperature: 0.5,
    timeoutMs: 30_000,
  })

  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, answer: result.text }
}
