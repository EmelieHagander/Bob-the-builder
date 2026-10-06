// Acquire an ordinary session in the secure runner, then use the existing K3
// probe. No account creation, grants, seeded construction or privileged tokens.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { K4_RECOVERY_TURN, assertK4RecoveryCheckpoint } from './k4-recovery-checkpoint.mjs'

export const K3_PROJECT = 'p_43702f4cbdfb40f0907f5cd0c12a5143'
export const K3_MEMBER = '9aa569c3-32f3-4f22-a457-0b145e8850dc'
export const K3_PREVIOUS_TURN = '8099b36e-c906-4727-b05d-023b5bedbbf4'
const URL = 'https://yuobtgoidmmmwfqenkau.supabase.co'

export const K4_PREVIOUS_TURN = 'bb5c6de6-59a4-496c-819e-4d70ef07f700'
export const K4_DRAWING = '150f78be-dd33-42e8-8d4f-5af62926a15c'
export const K4_SOURCE = '01349f1c-100b-4ac2-a5b9-de4c839b51a4'
export const runAuthenticatedK3 = (env, deps) => runAuthenticatedConstruction(env, deps, 'K3')
export const runAuthenticatedK4 = (env, deps) => runAuthenticatedConstruction(env, deps, 'K4')
export const runAuthenticatedK4Recovery = (env, deps) => runAuthenticatedConstruction(env, deps, 'K4', true)
async function runAuthenticatedConstruction(env, { makeClient, probe, progress = () => {}, now = Date.now }, stage, recovery = false) {
  const previousTurn = recovery ? K4_RECOVERY_TURN : stage === 'K3' ? K3_PREVIOUS_TURN : K4_PREVIOUS_TURN
  let phase = 'configuration', client, acquired = false
  try {
    assert.equal(env.VITE_SUPABASE_URL?.replace(/\/$/, ''), URL)
    assert.equal(env[`BOB_${stage}_PROJECT_ID`], K3_PROJECT)
    assert.equal(env[`BOB_${stage}_LIVE_CONFIRM`], 'disposable-fixtures-only')
    assert.equal(env.GITHUB_RUN_ATTEMPT ?? '1', '1', 'Inspect the existing job before any retry')
    assert(env.BOB_USER_EMAIL?.trim() && env.BOB_USER_PASSWORD)
    const key = env.VITE_SUPABASE_ANON_KEY?.trim()
    const claims = value => { try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()) } catch { return null } }
    assert(key && (key.startsWith('sb_publishable_') || claims(key)?.role === 'anon'))
    client = makeClient(URL, key, {
      db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) },
    })
    phase = 'authentication'
    const login = await client.auth.signInWithPassword({ email: env.BOB_USER_EMAIL.trim(), password: env.BOB_USER_PASSWORD })
    acquired = !!login.data?.session
    assert(!login.error && acquired)
    const session = login.data.session
    phase = 'member_identity'
    const identity = await client.auth.getUser(session.access_token)
    const user = identity.data?.user
    assert(!identity.error && user?.id === K3_MEMBER && user.email_confirmed_at && user.is_anonymous !== true)
    assert(user.email && user.email.toLowerCase() !== 'guest@bob.local')
    const jwt = claims(session.access_token)
    assert(jwt?.role === 'authenticated' && jwt.sub === K3_MEMBER && jwt.exp * 1000 > now() + 20 * 60000)
    phase = 'project_access'
    const project = await client.from('projects').select('id,name,type').eq('id', K3_PROJECT).single()
    assert(!project.error && project.data?.id === K3_PROJECT && project.data.type === 'Verification'
      && project.data.name.startsWith('K2 model acceptance '))
    phase = 'conversation_checkpoint'
    const thread = await client.from('bob_threads').select('id').eq('project_id', K3_PROJECT)
      .eq('owner_user_id', K3_MEMBER).eq('status', 'active').single()
    assert(!thread.error && thread.data?.id)
    const previous = await client.from('bob_messages').select('turn_id,delivery_state').eq('thread_id', thread.data.id)
      .eq('role', 'user').order('seq', { ascending: false }).limit(1).single()
    assert(!previous.error && previous.data?.turn_id === previousTurn && previous.data.delivery_state !== 'pending')
    const job = await client.rpc('bob_job_status', { p_project: K3_PROJECT, p_turn: previousTurn })
    assert(!job.error && ['failed', 'completed'].includes(job.data?.status))
    const drawings = await client.from('artifact_cad_revisions').select(stage === 'K3' ? 'artifact_id' : 'artifact_id,artifact_revision,manifest').eq('project_id', K3_PROJECT).limit(2)
    assert(!drawings.error && Array.isArray(drawings.data))
    if (stage === 'K3') assert.equal(drawings.data.length, 0)
    else {
      assert.equal(job.data.status, 'completed')
      assert.equal(drawings.data.length, 1)
      assert.equal(drawings.data[0].artifact_id, K4_DRAWING)
      assert.equal(drawings.data[0].artifact_revision, 1)
      assert.equal(drawings.data[0].manifest?.bob_construction?.artifact_id, K4_SOURCE)
      assert.equal(drawings.data[0].manifest?.bob_construction?.revision, 4)
      const requirements = await client.from('current_material_requirements').select(recovery ? '*' : 'id').eq('project_id', K3_PROJECT).limit(2)
      assert(!requirements.error && Array.isArray(requirements.data))
      if (recovery) {
        const sources = await client.from('material_requirement_construction_sources').select('*').eq('project_id', K3_PROJECT).limit(2)
        const history = await client.from('material_requirement_revisions').select('*').eq('project_id', K3_PROJECT).limit(2)
        assert(!sources.error && Array.isArray(sources.data) && !history.error && Array.isArray(history.data))
        assertK4RecoveryCheckpoint(requirements.data, sources.data, history.data)
      } else assert.equal(requirements.data.length, 0)
    }
    progress(`Existing member, project and conversation verified; invoking the ${stage} probe once.`)
    phase = 'probe'
    await probe({
      VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: key,
      BOB_TEST_MEMBER_ID: K3_MEMBER, BOB_TEST_MEMBER_ACCESS_TOKEN: session.access_token,
      [`BOB_${stage}_PROJECT_ID`]: K3_PROJECT, [`BOB_${stage}_LIVE_CONFIRM`]: 'disposable-fixtures-only',
      [`BOB_${stage}_REPORT`]: env[`BOB_${stage}_REPORT`] ?? (stage === 'K3' ? 'test-results/live-construction-drawing.json' : 'test-results/live-construction-lists.json'),
    })
    return { passed: true, phase: 'completed', projectId: K3_PROJECT }
  } catch {
    // SDK/provider errors may contain private data. Only expose the failed stage.
    return { passed: false, phase, projectId: K3_PROJECT,
      error: `${stage} stopped at ${phase}; inspect this checkpoint before any new request.` }
  } finally {
    if (acquired) {
      try {
        const result = await client.auth.signOut({ scope: 'local' })
        if (result.error) progress('Runner-session sign-out could not be confirmed; no other session was revoked.')
      } catch { progress('Runner-session sign-out could not be confirmed; no other session was revoked.') }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createClient } = await import('@supabase/supabase-js')
  const { mkdir, writeFile } = await import('node:fs/promises')
  const report = await runAuthenticatedK3(process.env, {
    makeClient: createClient, progress: text => console.log(text),
    probe: async sessionEnv => {
      const saved = new Map(Object.keys(sessionEnv).map(key => [key, process.env[key]]))
      const email = process.env.BOB_USER_EMAIL, password = process.env.BOB_USER_PASSWORD
      delete process.env.BOB_USER_EMAIL; delete process.env.BOB_USER_PASSWORD
      try {
        Object.assign(process.env, sessionEnv)
        await import('./check-live-construction-drawing.ts')
        assert(!process.exitCode, 'The existing K3 probe did not pass')
      } finally {
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
        process.env.BOB_USER_EMAIL = email; process.env.BOB_USER_PASSWORD = password
      }
    },
  })
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/k3-preflight.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  if (!report.passed) process.exitCode = 1
}
