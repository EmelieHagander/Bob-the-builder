// Release proof using the existing public guest and a new disposable project.
// Never grant the guest access to real projects. Delete only the printed fixture
// after verification; no service key or raw Auth/session data is used or logged.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
assert.equal(url, 'https://yuobtgoidmmmwfqenkau.supabase.co')
const key = process.env.VITE_SUPABASE_ANON_KEY
assert(key, 'Publishable configuration required')
const client = createClient(url, key, { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false } })
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
try {
  checked(await client.auth.signInWithPassword({ email: 'guest@bob.local', password: 'bob-guest-2026' }))
  const denied = await client.functions.invoke('ask-bob', { body: { action: 'send', projectId: 'p_bygga_in_entren', message: 'Permission check' } })
  assert.equal(denied.error?.context?.status, 403)
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
} catch (error) {
  console.error(`Live plan verification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.auth.signOut({ scope: 'local' })
}
