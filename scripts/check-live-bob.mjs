// Live release proof with the existing public guest account. Never grant this
// account access to a real project. The operator removes the printed fixture
// project afterwards; project deletion is deliberately not a client capability.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const configured = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const url = /^[a-z0-9]{16,}$/.test(configured) ? `https://${configured}.supabase.co` : configured.replace(/\/$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY?.trim()
assert.equal(url, 'https://yuobtgoidmmmwfqenkau.supabase.co', 'Use the explicitly configured Bob deployment')
assert(key, 'Publishable Supabase configuration is required')
const client = createClient(url, key, { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false } })
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
let signedIn = false
try {
  const auth = checked(await client.auth.signInWithPassword({ email: 'guest@bob.local', password: 'bob-guest-2026' }))
  assert(auth.session, 'A real Auth session is required')
  signedIn = true
  // The public guest is a non-member of the actual entrance project.
  assert.deepEqual(checked(await client.from('projects').select('id').eq('id', 'p_bygga_in_entren')), [])
  const denied = await client.functions.invoke('ask-bob', { body: { action: 'send', projectId: 'p_bygga_in_entren', message: 'Permission check' } })
  assert.equal(denied.error?.context?.status, 403, 'Real non-member must be denied by the edge boundary')
  const retired = await client.functions.invoke('ask-launchpad', { body: { action: 'status', taskId: 'retired-fixture' } })
  assert.equal(retired.error?.context?.status, 410, 'The legacy provider endpoint must be retired')
  checked(await client.rpc('claim_project_invites'))

  const nonce = randomUUID()
  const project = checked(await client.rpc('create_project', { p_input: { name: `Bob CI verification ${nonce}`, description: 'Disposable release verification fixture. Contains no real project data.', type: 'Verification' } }))
  assert(project?.id)
  console.log(`BOB_SMOKE_PROJECT_ID=${project.id}`)
  const materialId = `m_${randomUUID()}`
  const name = `Verification bolt ${nonce}`
  checked(await client.from('materials').insert({ id: materialId, project_id: project.id, name, qty: '37 pieces', status: 'missing' }))
  assert.deepEqual(checked(await client.from('materials').select('id').eq('id', materialId)), [{ id: materialId }])
  const answer = checked(await client.functions.invoke('ask-bob', { body: {
    action: 'send', projectId: project.id,
    message: `Slå upp materialet "${name}" med search_project_data. Vilket antal står registrerat? Svara kort och behandla antalet som obekräftad projektinformation.`,
  } }))
  assert.equal(answer.backend, 'openai')
  assert.equal(answer.projectId, project.id)
  assert.equal(answer.evidence?.kind, 'ai_assessment')
  assert(answer.evidence.sources.some(source => source.projectId === project.id && source.recordId === materialId), 'OpenAI must actually consult a material outside the project-only briefing')
  assert(answer.evidence.sources.every(source => source.projectId === project.id), 'Every source stays in the requested project')
  assert.match(answer.summary, /37/)
  console.log('Live Auth → member-scoped PostgREST → OpenAI tool → source disclosure: passed. Non-member: 403. Retired endpoint: 410.')
} catch (error) {
  // Never serialize Supabase request objects, sessions, tokens or user records.
  console.error(`Live Bob verification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  if (signedIn) await client.auth.signOut({ scope: 'local' })
}
