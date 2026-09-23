// Operator-run proof with a verified named member and a new disposable project.
// Requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, BOB_TEST_MEMBER_ID,
// BOB_TEST_MEMBER_ACCESS_TOKEN and BOB_PLAN_LIVE_CONFIRM=disposable-fixtures-only.
// Supply the session through a secure runner environment, never chat or logs.
// Public guest deliberately has no Bob conversation/write authority. No fallback,
// Auth-user creation, grant changes or privileged token generation is permitted.
// Delete only the printed fixture afterward. The supplied session is not revoked.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

import { pathToFileURL } from 'node:url'

export function planTestConfig(env) {
  assert.equal(env.VITE_SUPABASE_URL?.replace(/\/$/, ''), 'https://yuobtgoidmmmwfqenkau.supabase.co')
  assert.equal(env.BOB_PLAN_LIVE_CONFIRM, 'disposable-fixtures-only', 'Explicit disposable-fixture configuration required')
  const key = env.VITE_SUPABASE_ANON_KEY?.trim(), token = env.BOB_TEST_MEMBER_ACCESS_TOKEN?.trim()
  const memberId = env.BOB_TEST_MEMBER_ID?.trim()
  const role = value => { try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role } catch { return null } }
  assert(key && (key.startsWith('sb_publishable_') || role(key) === 'anon'), 'Publishable configuration required')
  assert(token && role(token) === 'authenticated', 'A named test member session is required; never use guest or a service key')
  assert(memberId && /^[0-9a-f-]{36}$/i.test(memberId), 'Expected test member id required')
  return { url: env.VITE_SUPABASE_URL.replace(/\/$/, ''), key, token, memberId }
}

export async function requirePlanTestMember(client, token, memberId) {
  const { data, error } = await client.auth.getUser(token)
  assert(!error && data?.user?.id === memberId && data.user.is_anonymous !== true && data.user.email_confirmed_at
    && data.user.email && data.user.email.toLowerCase() !== 'guest@bob.local', 'Verified named test member required; public guest has no Bob write/conversation authority')
}

export async function runLivePlanCheck(env = process.env) {
  const { url, key, token, memberId } = planTestConfig(env)
  const client = createClient(url, key, { db: { schema: 'bob' }, global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false, autoRefreshToken: false } })
  const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
  await requirePlanTestMember(client, token, memberId)
  const project = checked(await client.rpc('create_project', { p_input: {
    name: `Bob plan release verification ${randomUUID()}`,
    description: 'Disposable synthetic test. A non-load-bearing decorative panel with a centered opening. Width and centering still need measurement.',
    type: 'Verification',
  } }))
  assert(project.id)
  console.log(`BOB_PLAN_SMOKE_PROJECT_ID=${project.id}`)
  const send = async message => {
    const data = checked(await client.functions.invoke('ask-bob', { body: { action: 'send', projectId: project.id, clientTurnId: randomUUID(), message } }))
    assert.equal(data.backend, 'openai'); assert.equal(data.projectId, project.id)
    return data
  }
  const first = await send('Vi ska göra en dekorativ, icke bärande panel med en centrerad öppning. Föreslå en kort arbetsplan med två steg: först kontrollera öppningens bredd och centrering som separata krav, sedan tillverka panelen. Måtten saknas och ska stå som öppna krav. Beskriv upplägget nu men vänta med att spara tills jag säger kör vidare.')
  assert.equal(first.evidence?.writes?.length ?? 0, 0, 'The first request explicitly defers saving')
  console.log('Initial plan discussed without writes; sending scoped continuation.')
  const next = await send('Okej, kör vidare :)')
  const planWrites = next.evidence?.writes?.filter(w => w.dataset === 'plan') ?? []
  assert.equal(planWrites.length, 1, 'Continuation must produce an actual plan write receipt')
  const revisions = checked(await client.from('project_plan_revisions').select('revision,status').eq('project_id', project.id))
  assert.equal(revisions.length, 1); assert.equal(revisions[0].status, 'proposed')
  const plan = checked(await client.rpc('project_plan_read', { p_project: project.id, p_revision: revisions[0].revision }))
  assert.equal(plan.record.status, 'proposed')
  assert.equal(plan.record.steps.filter(s => s.state === 'active').length, 1)
  const requirements = plan.record.steps.flatMap(s => s.requirements)
  assert(requirements.length >= 2, 'Distinct width and centering criteria must be represented')
  assert(requirements.every(q => q.id && q.evidence_selector.id === null && q.status?.state !== 'satisfied'), 'Missing measurements stay open without invented evidence')
  const briefing = checked(await client.rpc('project_plan_briefing', { p_project: project.id }))
  assert.equal(briefing.status, 'not_initialized', 'Proposal must not silently become the approved plan')
  console.log(JSON.stringify({ passed: true, projectId: project.id, revision: revisions[0].revision,
    status: plan.record.status, steps: plan.record.steps.length, requirements: requirements.length,
    writes: planWrites.length, criteria: requirements.map(q => ({ title: q.title, description: q.description, state: q.status?.state, selector: q.evidence_selector })), summary: next.summary }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLivePlanCheck().catch(error => {
    console.error(`Live plan verification failed: ${error.message}`)
    process.exitCode = 1
  })
}
