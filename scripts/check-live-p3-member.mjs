// Operator-run acceptance with an existing verified named member session.
// Requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, BOB_TEST_MEMBER_ID,
// BOB_TEST_MEMBER_ACCESS_TOKEN and BOB_P3_LIVE_CONFIRM=disposable-fixtures-only.
// Supply the session in a secure runner environment, never chat or logs. No
// guest fallback, Auth-user creation, token generation or permission changes.
// The operator deletes only the printed disposable project after completion.
// This script neither refreshes nor revokes the supplied member session.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { planTestConfig, requirePlanTestMember } from './check-live-plan-assistant.mjs'

const POLL_MS = 5000
const WAIT_MS = 8 * 60_000
const REQUEST_MS = 30_000

export function p3TestConfig(env) {
  assert.equal(env.BOB_P3_LIVE_CONFIRM, 'disposable-fixtures-only', 'Explicit P3 disposable-fixture configuration required')
  const config = planTestConfig({ ...env, BOB_PLAN_LIVE_CONFIRM: env.BOB_P3_LIVE_CONFIRM })
  let expiresAt
  try { expiresAt = Number(JSON.parse(Buffer.from(config.token.split('.')[1], 'base64url').toString()).exp) * 1000 } catch { /* preflight below */ }
  assert(Number.isFinite(expiresAt) && expiresAt > Date.now() + WAIT_MS + 2 * 60_000,
    'Supply an existing named-member session with at least ten minutes remaining')
  return config
}

// Never print request/session objects or provider error bodies. All failures are
// content-free codes; the project id is the only fixture cleanup identifier.
function checked(result, code) {
  assert(!result.error, code)
  return result.data
}

function assertFocus(evidence, projectId, taskId, taskName) {
  assert.equal(evidence?.kind, 'ai_assessment')
  assert.equal(evidence.currentView?.status, 'ok')
  assert.equal(evidence.currentView.projectId, projectId)
  assert.equal(evidence.currentView.surface, 'task')
  assert.equal(evidence.currentView.focus.task?.id, taskId)
  assert.equal(evidence.currentView.focus.task?.name, taskName)
  assert(evidence.sources.every(source => source.projectId === projectId), 'Evidence must remain in the disposable project')
  assert(evidence.sources.some(source => source.dataset === 'tasks' && source.recordId === taskId), 'Exact Task source required')
  assert.equal(evidence.writes?.length ?? 0, 0, 'The read-only request must produce no project writes')
}

export async function runLiveP3MemberCheck(env = process.env) {
  const { url, key, token, memberId } = p3TestConfig(env)
  // Bound each HTTP operation as well as the overall polling window. Abort
  // signals are composed so library-supplied cancellation still takes effect.
  const boundedFetch = (input, init = {}) => fetch(input, { ...init,
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_MS)]) : AbortSignal.timeout(REQUEST_MS),
  })
  const client = createClient(url, key, { db: { schema: 'bob' },
    global: { headers: { Authorization: 'Bearer ' + token }, fetch: boundedFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  await requirePlanTestMember(client, token, memberId)
  const project = checked(await client.rpc('create_project', { p_input: {
    name: `Bob P3 member verification ${randomUUID()}`,
    description: 'Disposable synthetic P3 context/history acceptance. No real project data.', type: 'Verification',
  } }), 'p3_fixture_project_failed')
  assert(typeof project?.id === 'string', 'Disposable project id required')
  console.log(`BOB_P3_SMOKE_PROJECT_ID=${project.id}`)
  const taskId = `t_${randomUUID()}`, taskName = `P3 member focus ${randomUUID()}`
  checked(await client.from('tasks').insert({ id: taskId, project_id: project.id, area_id: null,
    name: taskName, instructions: 'Synthetic read-only context fixture. No construction action requested.',
  }), 'p3_fixture_task_failed')
  const clientTurnId = randomUUID(), screen = { surface: 'task', taskId }
  const message = 'Vad heter uppgiften jag tittar på? Återge dess exakta namn i ett kort svar på svenska. Läs det skärmfokus som hör till frågan. Gör inga projektändringar och starta inget annat arbete.'
  const body = { action: 'send', projectId: project.id, clientTurnId, message, background: true }
  const accepted = checked(await client.functions.invoke('ask-bob', { body: { ...body, screen } }), 'p3_background_send_failed')
  assert.equal(accepted?.ok, true)
  assert.equal(accepted.status, 'accepted', 'The first named-member turn must use the durable queue')
  assert.equal(accepted.projectId, project.id)
  assert(typeof accepted.jobId === 'string', 'Durable job id required')
  const expiry = Date.parse(accepted.expiresAt)
  assert(Number.isFinite(expiry) && expiry > Date.now(), 'Valid durable expiry required')
  const deadline = Math.min(Date.now() + WAIT_MS, expiry - REQUEST_MS)
  let completed = false
  while (Date.now() < deadline) {
    const job = checked(await client.rpc('bob_job_status', { p_project: project.id, p_turn: clientTurnId }), 'p3_job_status_failed')
    assert(job && ['queued', 'running', 'completed', 'failed'].includes(job.status), 'Known durable job status required')
    assert.deepEqual(job.screen, screen, 'Stored request focus must survive worker execution and caller polling')
    assert.notEqual(job.status, 'failed', 'Durable P3 turn failed; inspect content-free operational diagnostics')
    if (job.status === 'completed') { completed = true; break }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await delay(Math.min(POLL_MS, remaining))
  }
  assert(completed, 'P3 named-member job did not complete within the eight-minute polling budget; no new turn was submitted')

  // A fresh caller query exercises server persistence/readback independently of
  // the initial enqueue response. It does not use a service client or a fixture.
  const thread = checked(await client.from('bob_threads').select('id,next_seq')
    .eq('project_id', project.id).eq('owner_user_id', memberId).eq('status', 'active').single(), 'p3_private_thread_read_failed')
  const readHistory = async () => checked(await client.from('bob_messages')
    .select('role,text,evidence,delivery_state,seq,turn_id').eq('thread_id', thread.id).order('seq'), 'p3_private_history_read_failed')
  const history = await readHistory()
  assert.equal(history.length, 2, 'One completed user/assistant pair expected')
  const user = history.find(row => row.role === 'user'), answer = history.find(row => row.role === 'assistant')
  assert.equal(user?.turn_id, clientTurnId)
  assert.equal(user.delivery_state, 'completed')
  assert.equal(user.text, message)
  assert.equal(answer?.turn_id, clientTurnId)
  assert.equal(answer.delivery_state, 'completed')
  assert(answer.text.includes(taskName), 'The saved answer must identify the actual focused Task')
  assertFocus(answer.evidence, project.id, taskId, taskName)

  // Re-send the identical completed turn while omitting navigation, as a caller
  // reconnect may do. This is an idempotent read, never a new model request.
  const replay = checked(await client.functions.invoke('ask-bob', { body }), 'p3_completed_turn_read_failed')
  assert.equal(replay?.ok, true)
  assert.equal(replay.status, 'completed')
  assert.equal(replay.projectId, project.id)
  assert.equal(replay.summary, answer.text)
  assertFocus(replay.evidence, project.id, taskId, taskName)
  assert.deepEqual(replay.evidence, answer.evidence, 'Completed re-read must return the original persisted evidence')
  assert.deepEqual(await readHistory(), history, 'Completed re-read must not append another message')
  const after = checked(await client.from('bob_threads').select('id,next_seq').eq('id', thread.id).single(), 'p3_private_thread_recheck_failed')
  assert.deepEqual(after, thread, 'Completed re-read must retain the existing thread cursor')
  const job = checked(await client.rpc('bob_job_status', { p_project: project.id, p_turn: clientTurnId }), 'p3_job_recheck_failed')
  assert.equal(job.status, 'completed')
  assert.deepEqual(job.screen, screen, 'Legacy omission must retain the original stored pointer')
  console.log('P3 named-member Auth → durable task focus → private caller history → idempotent completed readback: passed. Operator cleanup of the printed disposable project remains required.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLiveP3MemberCheck().catch(() => {
    console.error('Live P3 member verification failed. Check secure runner diagnostics and clean up only the printed disposable project; no member session was revoked.')
    process.exitCode = 1
  })
}
