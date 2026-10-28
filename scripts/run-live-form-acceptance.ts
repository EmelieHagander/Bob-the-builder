// PAID live comparison for FORM package 5. Runs one frozen scenario once on the
// catalog that is active at the time; BOB_FORM_CONFIG only labels the report
// (baseline before scripts/form-package3-enable.sql, candidate after it).
// Ordinary member session, new disposable Verification project, no retries,
// no service key. Costs are read afterwards with scripts/report-form-acceptance.sql.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { FORM_SCENARIOS, type FormReader } from './form-acceptance-scenarios.ts'
import { handleRunSignals, requestSignal, runFormScenario, type FormRunReport } from './support/live-form-runner.ts'
import { validConstructionDelivery } from '../supabase/functions/_shared/construction-delivery.ts'

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
 global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: requestSignal(init.signal ?? (input instanceof Request ? input.signal : null)) }) } })
const ok = (r: any, what: string) => { assert(!r.error, what + ' failed; inspect scoped logs without printing credentials.'); return r.data }
const controller = new AbortController()
const removeSignalHandlers = handleRunSignals(controller)
const report: FormRunReport = { scenario: scenario.id, config: env.BOB_FORM_CONFIG, commit: env.GITHUB_SHA ?? null, startedAt: new Date().toISOString(),
 projectId: null, turns: [], checks: [], observations: [], passed: false,
 notProven: ['user judgement of 2D/3D form', 'fabrication or strength', 'cost (read with scripts/report-form-acceptance.sql)'] }
const path = env.BOB_FORM_REPORT ?? `test-results/form-${scenario.id}-${env.BOB_FORM_CONFIG}.json`
const persist = async () => {
 await mkdir(dirname(path), { recursive: true })
 await writeFile(path + '.tmp', JSON.stringify(report, null, 2) + '\n')
 await rename(path + '.tmp', path)
}
try {
 await persist()
 const login = await client.auth.signInWithPassword({ email: env.BOB_USER_EMAIL!.trim(), password: env.BOB_USER_PASSWORD! })
 assert(!login.error && login.data.session, 'Sign-in failed')
 const jwt = claims(login.data.session.access_token)
 assert(jwt?.sub === MEMBER && jwt.role === 'authenticated', 'Only the owner member may run this paid comparison')
 controller.signal.throwIfAborted()
 const project = ok(await client.rpc('create_project', { p_input: { name: `FORM ${scenario.id} ${env.BOB_FORM_CONFIG} ${randomUUID().slice(0, 8)}`,
  description: 'Disposable FORM package 5 comparison, synthetic request, no real project data.', type: 'Verification' } }), 'create_project')
 report.projectId = project.id
 await persist()
 console.log('BOB_FORM_PROJECT_ID=' + project.id)
 const rpc = async (name: string, args: Record<string, unknown>) => ok(await client.rpc(name, args).abortSignal(controller.signal), name)
 const reader: FormReader = {
  constructions: async () => (await rpc('read_construction_draft', { p_project: project.id })).items ?? [],
  construction: async (id, revision) => rpc('read_construction_draft', { p_project: project.id, p_artifact: id, ...(revision ? { p_revision: revision } : {}) }),
  catalogRecord: async (id, revision) => (await rpc('catalog_read', { p_project: project.id, p_input: { action: 'read', id, revision, kind: null, query: null, after: null, profile_code: null, categories: [], properties: {} } })).record,
  drawings: async (artifactId, revision) => {
   const records: Record<string, any>[] = [], cursors = new Set<string>()
   let after: string | null = null
   do {
    const page = await rpc('read_construction_delivery', { p_project: project.id, p_artifact: artifactId, p_revision: revision, p_resource: 'drawings', p_after: after })
    assert(validConstructionDelivery(page, project.id, artifactId, revision, 'drawings'), 'Invalid drawing index')
    records.push(...page.records)
    after = page.next_after
    if (after) { assert(!cursors.has(after), 'Drawing index cursor did not advance'); cursors.add(after) }
   } while (after)
   for (const record of records) {
    // The delivery index explicitly says not_checked. Reopen the exact current
    // drawing through its existing owner before treating it as delivered.
    const drawing = ok(await client.from('current_drawing_overview').select('id,revision,source_state')
     .eq('project_id', project.id).eq('id', record.id).eq('revision', record.revision).abortSignal(controller.signal).maybeSingle(), 'read drawing')
    record.source_state = drawing?.source_state ?? 'unavailable'
   }
   return records
  },
 }
 await runFormScenario({ scenario, reader, report, signal: controller.signal, persist, transport: {
  send: async (turn, message, signal) => ok(await client.functions.invoke('ask-bob', { signal, body: { action: 'send', projectId: project.id, clientTurnId: turn, message, background: true } }), 'ask-bob'),
  status: async (turn, signal) => ok(await client.rpc('bob_job_status', { p_project: project.id, p_turn: turn }).abortSignal(signal), 'bob_job_status'),
  cancel: async (jobId, signal) => ok(await client.rpc('bob_cancel_job', { p_project: project.id, p_job: jobId }).abortSignal(signal), 'bob_cancel_job'),
 } })
 if (!report.passed) process.exitCode = 1
} catch (error) { report.error = error instanceof Error ? error.message : 'Comparison run failed'; process.exitCode = 1 }
finally {
 report.finishedAt = new Date().toISOString()
 await persist()
 await client.auth.signOut({ scope: 'local' }).catch(() => {})
 removeSignalHandlers()
 console.log(JSON.stringify({ scenario: scenario.id, config: report.config, projectId: report.projectId, passed: report.passed,
  turns: report.turns.map((t: any) => ({ step: t.step, turn: t.turn, status: t.status, cancellation: t.cancellation ?? null, wallMs: t.wallMs ?? null })) }))
}
