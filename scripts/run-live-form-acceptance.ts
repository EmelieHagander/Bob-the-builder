// PAID live comparison for FORM package 5. Runs one frozen scenario once on the
// catalog that is active at the time; BOB_FORM_CONFIG only labels the report
// (baseline before scripts/form-package3-enable.sql, candidate after it).
// Ordinary member session, new disposable Verification project, no retries,
// no service key. Costs are read afterwards with scripts/report-form-acceptance.sql.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { FORM_SCENARIOS, type FormReader } from './form-acceptance-scenarios.ts'

const URL = 'https://yuobtgoidmmmwfqenkau.supabase.co'
const MEMBER = '9aa569c3-32f3-4f22-a457-0b145e8850dc'
const env = process.env
const scenario = FORM_SCENARIOS.find(s => s.id === env.BOB_FORM_SCENARIO)
assert(scenario, 'BOB_FORM_SCENARIO must be box or bunk-bed')
assert(['baseline', 'candidate'].includes(env.BOB_FORM_CONFIG ?? ''), 'BOB_FORM_CONFIG must be baseline or candidate')
assert.equal(env.BOB_FORM_LIVE_CONFIRM, 'paid-acceptance-approved', 'Paid model/CAD runs need the owner\'s explicit approval')
assert.equal(env.GITHUB_RUN_ATTEMPT ?? '1', '1', 'Inspect the existing run instead of retrying a paid scenario')
assert.equal(env.VITE_SUPABASE_URL?.replace(/\/$/, ''), URL)
const key = env.VITE_SUPABASE_ANON_KEY?.trim()
const claims = (value: string) => { try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()) } catch { return null } }
assert(key && (key.startsWith('sb_publishable_') || claims(key)?.role === 'anon'), 'Publishable key only')
assert(env.BOB_USER_EMAIL?.trim() && env.BOB_USER_PASSWORD, 'Member credentials are required')

const client = createClient(URL, key, { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
 global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) } })
const ok = (r: any, what: string) => { assert(!r.error, what + ' failed; inspect scoped logs without printing credentials.'); return r.data }
const login = await client.auth.signInWithPassword({ email: env.BOB_USER_EMAIL!.trim(), password: env.BOB_USER_PASSWORD! })
assert(!login.error && login.data.session, 'Sign-in failed')
const jwt = claims(login.data.session.access_token)
assert(jwt?.sub === MEMBER && jwt.role === 'authenticated', 'Only the owner member may run this paid comparison')

const report: any = { scenario: scenario.id, config: env.BOB_FORM_CONFIG, commit: env.GITHUB_SHA ?? null, startedAt: new Date().toISOString(),
 projectId: null, turns: [], checks: [], observations: [], passed: false,
 notProven: ['user judgement of 2D/3D form', 'fabrication or strength', 'cost (read with scripts/report-form-acceptance.sql)'] }
try {
 const project = ok(await client.rpc('create_project', { p_input: { name: `FORM ${scenario.id} ${env.BOB_FORM_CONFIG} ${randomUUID().slice(0, 8)}`,
  description: 'Disposable FORM package 5 comparison, synthetic request, no real project data.', type: 'Verification' } }), 'create_project')
 report.projectId = project.id
 console.log('BOB_FORM_PROJECT_ID=' + project.id)
 const reader: FormReader = {
  constructions: async () => ok(await client.rpc('read_construction_draft', { p_project: project.id }), 'list constructions').items ?? [],
  construction: async (id, revision) => ok(await client.rpc('read_construction_draft', { p_project: project.id, p_artifact: id, ...(revision ? { p_revision: revision } : {}) }), 'read construction'),
  catalogRecord: async (id, revision) => ok(await client.rpc('catalog_read', { p_project: project.id, p_input: { action: 'read', id, revision, kind: null, query: null, after: null, profile_code: null, categories: [], properties: {} } }), 'catalog_read').record,
  drawings: async (artifactId, revision) => ok(await client.rpc('read_construction_delivery', { p_project: project.id, p_artifact: artifactId, p_revision: revision, p_resource: 'drawings', p_after: null }), 'read_construction_delivery').records ?? [],
 }
 const state: Record<string, any> = {}
 for (const step of scenario.steps) {
  const turn = randomUUID(), started = Date.now()
  const accepted = ok(await client.functions.invoke('ask-bob', { body: { action: 'send', projectId: project.id, clientTurnId: turn, message: step.message, background: true } }), 'ask-bob')
  assert(accepted.status === 'accepted' && accepted.jobId, 'A durable member turn is required')
  const entry: any = { step: step.label, turn, jobId: accepted.jobId, status: 'waiting' }
  report.turns.push(entry)
  const deadline = Math.min(Date.now() + 15 * 60000, Date.parse(accepted.expiresAt) - 30000)
  while (entry.status === 'waiting') {
   if (Date.now() > deadline) throw Error(`Timed out in ${step.label}; inspect job ${accepted.jobId} instead of resubmitting.`)
   const job = ok(await client.rpc('bob_job_status', { p_project: project.id, p_turn: turn }), 'bob_job_status')
   if (job.status === 'failed') throw Error(`Turn ${step.label} failed; no paid retry was submitted.`)
   if (job.status === 'completed') { entry.status = 'completed'; entry.wallMs = Date.now() - started; break }
   await delay(5000)
  }
  await step.after({ reader, state,
   check: (name, passed, detail) => report.checks.push({ step: step.label, name, passed, ...(detail === undefined ? {} : { detail }) }),
   observe: (name, value) => report.observations.push({ step: step.label, name, value }) })
 }
 report.passed = report.checks.every((c: any) => c.passed)
 if (!report.passed) process.exitCode = 1
} catch (error) { report.error = error instanceof Error ? error.message : 'Comparison run failed'; process.exitCode = 1 }
finally {
 await client.auth.signOut({ scope: 'local' }).catch(() => {})
 report.finishedAt = new Date().toISOString()
 const path = env.BOB_FORM_REPORT ?? `test-results/form-${scenario.id}-${env.BOB_FORM_CONFIG}.json`
 await mkdir(dirname(path), { recursive: true })
 await writeFile(path, JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({ scenario: scenario.id, config: report.config, projectId: report.projectId, passed: report.passed,
  turns: report.turns.map((t: any) => ({ step: t.step, turn: t.turn, status: t.status, wallMs: t.wallMs ?? null })) }))
}
