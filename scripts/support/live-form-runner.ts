import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { FormReader, FormScenario } from '../form-acceptance-scenarios.ts'

type Row = Record<string, any>
const recovering = (job: Row) => ['queued', 'running'].includes(job.drawingRecovery?.status)
export type FormRunReport = Row & { turns: Row[]; checks: Row[]; observations: Row[]; passed: boolean }
export type FormRunTransport = {
 send(turn: string, message: string, signal: AbortSignal): Promise<Row>
 status(turn: string, signal: AbortSignal): Promise<Row | null>
 cancel(jobId: string, signal: AbortSignal): Promise<Row>
}

/** Preserve caller cancellation as well as the transport deadline. Cleanup uses
 * its own signal so an interrupted poll cannot abort the cancellation request. */
export function requestSignal(signal?: AbortSignal | null, timeoutMs = 30000) {
 const timeout = AbortSignal.timeout(timeoutMs)
 return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export function handleRunSignals(controller: AbortController) {
 const interrupt = () => controller.abort()
 process.on('SIGINT', interrupt)
 process.on('SIGTERM', interrupt)
 return () => { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt) }
}

/** One paid submission per step. Failed checks, interruptions and terminal job
 * states stop the scenario. Cancellation is acknowledged, never inferred from
 * a stopped HTTP request; an uncertain acceptance is reconciled by turn ID. */
export async function runFormScenario(opts: {
 scenario: FormScenario; reader: FormReader; report: FormRunReport; transport: FormRunTransport
 signal: AbortSignal; persist(): Promise<void>
 now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<void>
}) {
 const { scenario, reader, report, transport, signal, persist } = opts
 const now = opts.now ?? Date.now
 const wait = opts.wait ?? ((ms, signal) => delay(ms, undefined, { signal }))
 const state: Row = {}
 let active: Row | undefined
 try {
  for (const step of scenario.steps) {
   signal.throwIfAborted()
   const started = now()
   const entry: Row = { step: step.label, turn: randomUUID(), jobId: null, status: 'submitting' }
   report.turns.push(entry)
   await persist() // A lost acceptance response still leaves the reconciliation key.
   signal.throwIfAborted()
   active = entry
   const accepted = await transport.send(entry.turn, step.message, signal)
   if (accepted?.status !== 'accepted' || typeof accepted.jobId !== 'string') throw Error('Durable turn acceptance was not confirmed; no resubmission.')
   entry.jobId = accepted.jobId
   entry.status = 'waiting'
   await persist()
   const expires = Date.parse(accepted.expiresAt)
   if (!Number.isFinite(expires)) throw Error('Accepted turn has no valid expiry; stopping the scenario.')
   const deadline = Math.min(started + 15 * 60000, expires - 30000)
   while (true) {
    signal.throwIfAborted()
    if (now() >= deadline) throw Error(`Timed out in ${step.label}; no paid retry was submitted.`)
    const job = await transport.status(entry.turn, signal)
    if (!job || job.jobId !== entry.jobId) throw Error('The submitted turn could not be reconciled.')
    entry.status = job.status
    if (job.drawingRecovery) entry.drawingRecovery = job.drawingRecovery.status
    entry.wallMs = now() - started
    await persist()
    if (job.status === 'completed' && !recovering(job)) { active = undefined; break }
    if (recovering(job) && job.status !== 'cancelled') {
     await wait(Math.min(5000, Math.max(0, deadline - now())), signal)
     continue
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
     active = undefined
     throw Error(`Turn ${step.label} ${job.status}; no paid retry was submitted.`)
    }
    if (!['queued', 'running'].includes(job.status)) throw Error(`Turn ${step.label} stopped before completion.`)
    await wait(Math.min(5000, Math.max(0, deadline - now())), signal)
   }
   signal.throwIfAborted()
   await step.after({ reader, state,
    check: (name, passed, detail) => report.checks.push({ step: step.label, name, passed, ...(detail === undefined ? {} : { detail }) }),
    observe: (name, value) => report.observations.push({ step: step.label, name, value }) })
   await persist()
   if (report.checks.some(c => !c.passed)) throw Error(`Acceptance checks failed after ${step.label}; later paid steps were not submitted.`)
  }
  signal.throwIfAborted()
  report.passed = report.checks.length > 0 && report.checks.every(c => c.passed)
 } catch (error) {
  report.passed = false
  report.error = signal.aborted ? 'Scenario interrupted; no further paid steps were submitted.' : error instanceof Error ? error.message : 'Comparison run failed'
 } finally {
  if (active) {
   active.cancellation = 'unconfirmed'
   await persist().catch(() => {}) // Retain the uncertainty even if the runner is killed during cleanup.
   // Independent, bounded cleanup also works after the caller signal aborted.
   const cleanup = AbortSignal.timeout(5000)
   try {
    if (!active.jobId) {
     const job = await transport.status(active.turn, cleanup)
     if (job?.jobId) { active.jobId = job.jobId; active.status = job.status }
    }
    if (active.jobId) {
     const result = await transport.cancel(active.jobId, cleanup)
     if (result?.ok === true && result.status === 'cancelled' && result.jobId === active.jobId) {
      active.status = 'cancelled'; active.cancellation = 'confirmed'
     } else if (result?.error === 'turn_not_in_flight') {
      const job = await transport.status(active.turn, cleanup)
      if (job && job.jobId === active.jobId && !recovering(job) && ['completed', 'failed', 'cancelled'].includes(job.status)) {
       active.status = job.status; active.cancellation = job.status === 'cancelled' ? 'confirmed' : 'already_terminal'
      }
     }
    }
   } catch { /* Keep unconfirmed in the report; never submit another paid turn. */ }
  }
  report.finishedAt = new Date(now()).toISOString()
  await persist()
 }
}
