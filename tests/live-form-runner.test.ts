import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { runFormScenario, requestSignal, type FormRunReport, type FormRunTransport } from '../scripts/support/live-form-runner.ts'
import type { FormReader, FormScenario } from '../scripts/form-acceptance-scenarios.ts'

function fixture() {
 const controller = new AbortController(), submitted: string[] = [], cancelled: string[] = [], snapshots: FormRunReport[] = []
 const report: FormRunReport = { turns: [], checks: [], observations: [], passed: false }
 const scenario: FormScenario = { id: 'box', title: 'Offline fixture', steps: ['concept', 'width_change', 'drawing'].map(label => ({ label, message: label,
  after: async ctx => { ctx.check('expected_geometry', true) } })) }
 let time = 0, jobStatus = 'completed'
 const transport: FormRunTransport = {
  send: async turn => { submitted.push(turn); return { status: 'accepted', jobId: 'job-' + turn, expiresAt: new Date(3600000).toISOString() } },
  status: async turn => ({ jobId: 'job-' + turn, status: jobStatus }),
  cancel: async (jobId, signal) => { assert.equal(signal.aborted, false); cancelled.push(jobId); return { ok: true, status: 'cancelled', jobId } },
 }
 const opts = { scenario, report, transport, reader: {} as FormReader, signal: controller.signal,
  persist: async () => { snapshots.push(structuredClone(report)) }, now: () => time,
  wait: async (_ms: number, signal: AbortSignal) => { signal.throwIfAborted(); time += 5000 } }
 return { opts, controller, submitted, cancelled, snapshots, setStatus: (s: string) => { jobStatus = s }, advance: (ms: number) => { time += ms } }
}

test('failed acceptance ends the paid sequence before the next submission and persists the failure', async () => {
 const f = fixture()
 f.opts.scenario.steps[0].after = async ctx => { ctx.check('same_artifact', false) }
 await runFormScenario(f.opts)
 assert.equal(f.submitted.length, 1)
 assert.deepEqual(f.cancelled, [], 'completed work is not cancelled')
 assert.equal(f.opts.report.passed, false)
 assert.match(f.opts.report.error, /Acceptance checks failed/)
 assert.equal(f.snapshots.at(-1)!.checks[0].passed, false)
 assert.equal(f.snapshots[0].turns[0].status, 'submitting', 'reconciliation identity is durable before submission')
})

test('a successful scenario submits each step once and only passes after all checks', async () => {
 const f = fixture()
 await runFormScenario(f.opts)
 assert.equal(f.submitted.length, 3); assert.equal(new Set(f.submitted).size, 3)
 assert.equal(f.opts.report.passed, true); assert.equal(f.opts.report.checks.length, 3)
 assert.deepEqual(f.cancelled, [])
})

test('interruption during a poll cancels the exact accepted job with an independent signal', async () => {
 const f = fixture(); f.setStatus('running')
 f.opts.wait = async () => { f.controller.abort(); f.controller.signal.throwIfAborted() }
 await runFormScenario(f.opts)
 assert.equal(f.submitted.length, 1)
 assert.deepEqual(f.cancelled, ['job-' + f.submitted[0]])
 assert.equal(f.opts.report.turns[0].cancellation, 'confirmed')
 assert.equal(f.opts.report.turns[0].status, 'cancelled'); assert.equal(f.opts.report.passed, false)
})

test('timeout cancels durable work instead of only stopping the polling process', async () => {
 const f = fixture(); f.setStatus('running')
 f.opts.wait = async () => { f.advance(900000) }
 await runFormScenario(f.opts)
 assert.equal(f.submitted.length, 1); assert.equal(f.cancelled.length, 1)
 assert.match(f.opts.report.error, /Timed out/)
})

test('an acceptance lost in transit is reconciled by its original turn and cancelled without resubmission', async () => {
 const f = fixture(); f.setStatus('running')
 f.opts.transport.send = async turn => { f.submitted.push(turn); f.controller.abort(); throw Error('response lost') }
 await runFormScenario(f.opts)
 assert.equal(f.submitted.length, 1)
 assert.deepEqual(f.cancelled, ['job-' + f.submitted[0]])
 assert.equal(f.opts.report.turns[0].cancellation, 'confirmed')
})

test('unknown acceptance and failed cancellation remain explicitly unconfirmed', async t => {
 for (const mode of ['unknown', 'cancel_failed']) await t.test(mode, async () => {
  const f = fixture()
  if (mode === 'unknown') {
   f.opts.transport.send = async turn => { f.submitted.push(turn); throw Error('response lost') }
   f.opts.transport.status = async () => null
  } else {
   f.setStatus('running')
   f.opts.wait = async () => { f.controller.abort(); f.controller.signal.throwIfAborted() }
   f.opts.transport.cancel = async () => { throw Error('unavailable') }
  }
  await runFormScenario(f.opts)
  assert.equal(f.submitted.length, 1)
  assert.equal(f.opts.report.turns[0].cancellation, 'unconfirmed')
  assert.equal(f.opts.report.passed, false)
 })
})

test('terminal failed/cancelled states stop immediately; paused work is cancelled without a new turn', async t => {
 for (const status of ['failed', 'cancelled', 'paused']) await t.test(status, async () => {
  const f = fixture(); f.setStatus(status)
  f.opts.wait = async () => { assert.fail('terminal states must not keep polling') }
  await runFormScenario(f.opts)
  assert.equal(f.submitted.length, 1); assert.equal(f.opts.report.passed, false)
  assert.equal(f.cancelled.length, status === 'paused' ? 1 : 0)
  assert.equal(f.opts.report.turns[0].status, status === 'paused' ? 'cancelled' : status)
 })
})

test('completion racing cancellation is reported as terminal without claiming cancellation', async () => {
 const f = fixture()
 f.opts.transport.send = async turn => { f.submitted.push(turn); throw Error('response lost') }
 f.opts.transport.cancel = async () => ({ ok: false, error: 'turn_not_in_flight' })
 await runFormScenario(f.opts)
 assert.equal(f.opts.report.turns[0].status, 'completed')
 assert.equal(f.opts.report.turns[0].cancellation, 'already_terminal')
 assert.equal(f.submitted.length, 1); assert.equal(f.opts.report.passed, false)
})

test('interruption before submission starts no paid work; a mismatched poll cannot redirect cancellation', async () => {
 const before = fixture(); before.controller.abort()
 await runFormScenario(before.opts)
 assert.equal(before.submitted.length, 0); assert.equal(before.cancelled.length, 0)
 const mismatch = fixture()
 mismatch.opts.transport.status = async () => ({ jobId: 'unrelated-job', status: 'running' })
 await runFormScenario(mismatch.opts)
 assert.deepEqual(mismatch.cancelled, ['job-' + mismatch.submitted[0]])
})

test('transport timeout preserves an already aborted or subsequently aborted caller signal', () => {
 const before = new AbortController(); before.abort()
 assert.equal(requestSignal(before.signal).aborted, true)
 const during = new AbortController(), combined = requestSignal(during.signal)
 assert.equal(combined.aborted, false); during.abort(); assert.equal(combined.aborted, true)
})

test('a completed parent does not finish the step while drawing recovery is running', async () => {
 const f = fixture(); let recovery = 'running', waited = 0
 f.opts.transport.status = async turn => ({ jobId: 'job-' + turn, status: 'completed', drawingRecovery: { status: recovery } })
 f.opts.wait = async () => { waited++; assert.equal(f.opts.report.checks.length, 0); recovery = 'completed' }
 await runFormScenario(f.opts)
 assert.equal(waited, 1); assert.equal(f.opts.report.passed, true)
})

test('a terminal parent cannot falsely confirm that its active recovery was stopped', async () => {
 const f = fixture()
 f.opts.transport.status = async turn => ({ jobId: 'job-' + turn, status: 'completed', drawingRecovery: { status: 'running' } })
 f.opts.wait = async () => { f.controller.abort(); f.controller.signal.throwIfAborted() }
 f.opts.transport.cancel = async () => ({ ok: false, error: 'turn_not_in_flight' })
 await runFormScenario(f.opts)
 assert.equal(f.submitted.length, 1); assert.equal(f.opts.report.passed, false)
 assert.equal(f.opts.report.turns[0].cancellation, 'unconfirmed')
})

test('real process signals reach cleanup and save confirmation before exit', { timeout: 15000 }, async t => {
 for (const signal of ['SIGINT', 'SIGTERM'] as const) await t.test(signal, { timeout: 6500 }, async t => {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
   import {handleRunSignals,runFormScenario} from './scripts/support/live-form-runner.ts';
   const controller=new AbortController(),remove=handleRunSignals(controller);
   const report={turns:[],checks:[],observations:[],passed:false};let cancellations=0;
   await runFormScenario({signal:controller.signal,report,reader:{},
    scenario:{id:'box',title:'Offline',steps:[{label:'concept',message:'Synthetic',after:async()=>{throw Error('Unexpected completion')}}]},
    persist:async()=>{if(report.turns[0]?.status==='running'&&!report.error)console.log('READY')},
    transport:{send:async()=>({status:'accepted',jobId:'owned-job',expiresAt:new Date(Date.now()+3600000).toISOString()}),
     status:async()=>({jobId:'owned-job',status:'running'}),
     cancel:async(jobId,signal)=>{if(signal.aborted)throw Error('cleanup aborted');cancellations++;return {ok:true,status:'cancelled',jobId}}}});
   remove();console.log(JSON.stringify({report,cancellations}));
  `], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  let output = '', errors = '', interrupted = false
  child.stdout.on('data', chunk => {
   output += chunk.toString()
   if (!interrupted && output.includes('READY')) { interrupted = true; child.kill(signal) }
  })
  child.stderr.on('data', chunk => { errors += chunk.toString() })
  const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject) })
  assert.equal(code, 0, errors)
  const result = JSON.parse(output.trim().split('\n').at(-1)!)
  assert.equal(result.cancellations, 1); assert.equal(result.report.passed, false)
  assert.equal(result.report.turns[0].cancellation, 'confirmed')
 })
})
