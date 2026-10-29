import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResumeProbe } from '../scripts/benchmark-bob-resume.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { catalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'

test('43 model steps survive a fresh JSON-restored worker after every committed model and tool boundary', async () => {
  const baseline = createResumeProbe({ checkpoint: true, yieldMode: 'none' })
  const expected = await baseline.runToEnd()
  const resumed = createResumeProbe({ checkpoint: true, yieldMode: 'boundary' })
  assert.deepEqual(await resumed.runToEnd(), expected)
  // 43 Bob steps plus one small completion-gate call (v3 targeted note).
  assert.equal(resumed.totals().providerPosts, 44)
  assert.equal(resumed.totals().modelRequests, baseline.totals().modelRequests, 'no historical model-wrapper traversal')
  assert.equal(resumed.totals().toolTraversals, baseline.totals().toolTraversals, 'completed tool handlers are never replayed')
  assert.equal(resumed.totals().lookupRequests, baseline.totals().lookupRequests, 'orientation and completed reads are restored')
  assert.equal(resumed.totals().catalog, 1)
  assert.equal(resumed.totals().imageOpen, 1)
  assert.equal(resumed.totals().writes, 2)
  assert(resumed.claims.length > 200, 'every state transition is a separate simulated worker')
  assert.deepEqual(resumed.receipts, baseline.receipts)
  assert.equal(resumed.state()!.answer.observation.completion_checks, 1)
  assert(resumed.state()!.answer.toolbox.loaded.some(([name]) => name === 'save_project_task'))
})

test('per-step resumed work at step 40 performs the same new work as step 3', async () => {
  const probe = createResumeProbe({ checkpoint: true, yieldMode: 'step' })
  assert.equal((await probe.runToEnd()).ok, true)
  const early = probe.claims.find(row => row.step === 2)!, late = probe.claims.find(row => row.step === 39)!
  for (const field of ['policy', 'modelRequests', 'lookupRequests', 'toolTraversals', 'providerPosts'] as const) assert.equal(late[field], early[field], field)
  assert.equal(late.catalog, 0); assert.equal(late.imageOpen, 0)
  assert.equal(late.access, early.access); assert.equal(late.imageCurrent, early.imageCurrent)
})

test('a write committed before its operation checkpoint is recovered through the ledger without duplicate writes', async () => {
  const probe = createResumeProbe({ checkpoint: true, yieldMode: 'boundary', finalStep: 5, loseWriteCheckpoint: true })
  const result = await probe.runToEnd()
  assert.equal(result.ok, true)
  assert.equal(probe.totals().writes, 2)
  assert.equal(probe.totals().writeTransport, 3, 'only the interrupted active write needs ledger reconciliation')
  assert.equal(probe.receipts.length, 2)
  if (result.ok) assert.equal(result.evidence.writes?.length, 2)
  assert.equal(probe.totals().providerPosts, 7, 'six Bob steps plus the completion gate')
})

test('accepted model waiting survives fresh claims with one provider POST and unchanged pending request', async () => {
  const probe = createResumeProbe({ checkpoint: true, yieldMode: 'none', finalStep: 5, waitModelAt: 1 })
  for (let i = 0; i < 3; i++) assert.deepEqual(await probe.runClaim(), { status: 'yield', reason: 'ai_wait' })
  assert.equal(probe.totals().providerPosts, 1)
  assert.equal(probe.state()!.answer.phase, 'model')
  assert.equal(probe.state()!.journal.positions['model:ask-bob'] ?? 0, 0, 'pending operation is not advanced past its unconsumed result')
  probe.completeWaitingModel()
  assert.equal((await probe.runToEnd()).ok, true)
  assert.equal(probe.totals().providerPosts, 7, 'six Bob steps plus the completion gate')
  assert.equal(probe.totals().writes, 2)
})

test('access revoked between tool calls blocks the remainder of an already accepted batch', async () => {
  const probe = createResumeProbe({ checkpoint: true, yieldMode: 'boundary', finalStep: 5,
    onCheckpoint: (state, revoke) => { if (state.step === 1 && state.phase === 'tools' && state.toolIndex === 1) revoke() },
  })
  assert.deepEqual(await probe.runToEnd(), { ok: false, error: 'project_denied' })
  assert.equal(probe.totals().writes, 1)
  assert.equal(probe.totals().providerPosts, 2)
})

test('malformed checkpoints fail closed before another model or tool dispatch', async () => {
  for (const mutate of [
    (state: any) => { state.version = 2 },
    (state: any) => { state.phase = 'invented' },
    (state: any) => { state.step = -1 },
    (state: any) => { state.toolIndex = -1 },
    (state: any) => { state.projectId = 'B' },
  ]) {
    const probe = createResumeProbe({ checkpoint: true, yieldMode: 'boundary', finalStep: 5 })
    assert.equal((await probe.runClaim()).status, 'yield')
    mutate(probe.state()!.answer)
    await assert.rejects(probe.runClaim(), /turn_checkpoint_invalid/)
    assert.equal(probe.totals().providerPosts, 0)
    assert.equal(probe.totals().writes, 0)
  }
})

test('realistic read pages and two private image references survive context rollover and restored checkpoints', async () => {
  const baseline = createResumeProbe({ checkpoint: true, yieldMode: 'none', stress: true })
  const expected = await baseline.runToEnd()
  const restored = createResumeProbe({ checkpoint: true, yieldMode: 'step', stress: true })
  assert.deepEqual(await restored.runToEnd(), expected)
  assert(restored.readDetailTokens >= 1800)
  assert(restored.totals().summaryPosts > 0, 'the actual continuation adapter crosses its pinned context threshold')
  assert.equal(restored.totals().summaryPosts, baseline.totals().summaryPosts, 'completed summaries are restored instead of replayed')
  assert.equal(restored.totals().modelDispatch, 43)
  assert.equal(restored.totals().imageOpen, 2)
  assert.equal(restored.state()!.context.delivered.length, 2)
  assert.equal(restored.state()!.continuation!.chains.length, 1, 'only the live provider head is retained')
  assert.doesNotMatch(JSON.stringify(restored.state()), /data:image|base64/)
  assert(restored.claims.find(row => row.step === 39)!.maxCheckpointBytes > restored.claims.find(row => row.step === 1)!.maxCheckpointBytes,
    'the benchmark records the remaining growing archive cost rather than claiming constant payload size')
})

test('completed answers survive yields before settlement, during settlement and during transcript commit', async () => {
  for (const boundary of ['before-settle', 'settle', 'commit']) {
    const session = catalogFixture(), entries: JournalEntry[] = []
    let saved: any, yielded = false, models = 0, failed = 0, commits = 0, settlements = 0
    const run = async () => {
      const journal = createBobJournal({ entries, save: async entry => { entries.push(JSON.parse(JSON.stringify(entry))) } }, Infinity)
      if (saved) journal.restoreState(saved.journal)
      const lookup = createProjectLookup('A', async () => ({ data: { records: [{ id: 'A', name: 'Project' }], related: [], truncated: false }, error: null }),
        undefined, undefined, undefined, { unlimitedWork: true })
      const writer = createProjectWriter('A', 'Read the project', async () => assert.fail('read-only fixture never writes'), async () => ({ data: [], error: null }),
        () => journal.run('settle', {}, async () => {
          settlements++
          if (boundary === 'settle' && !yielded) { yielded = true; throw new BobContinuation('yield') }
          return { data: { generation: 2, receipts: [] }, error: null }
        }), { unlimitedWork: true })
      if (saved) { lookup.restoreState(saved.lookup); writer.restoreState(saved.writer) }
      return runClaimedProjectTurn({ aiCatalog: session, projectId: 'A', userId: 'owner', message: 'Read the project', lookup, writer,
        unlimitedWork: true, resume: !!saved, hasAccess: async () => true, fail: async () => { failed++ },
        callModel: catalogCall(options => journal.run('model:' + options.catalogRoleKey, options, async () => {
          models++
          return { success: true, model: 'fixture', responseId: 'final-answer', data: options.catalogRoleKey === 'completion-gate' ? JSON.stringify({ work_remaining: false }) : 'The project is named Project.',
            outputPhase: 'final_answer' as const, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
        }), session),
        checkpoint: { state: saved?.answer, save: async answer => {
          saved = JSON.parse(JSON.stringify({ answer, lookup: lookup.exportState(), writer: writer.exportState(), journal: journal.exportState() }))
        } },
        beforeSettle: () => { if (boundary === 'before-settle' && !yielded) { yielded = true; throw new BobContinuation('yield') } },
        commit: async result => {
          assert.equal(result.answer, 'The project is named Project.')
          if (boundary === 'commit' && !yielded) { yielded = true; throw new BobContinuation('yield') }
          commits++
        },
      })
    }
    await assert.rejects(run(), error => error instanceof BobContinuation && error.kind === 'yield', boundary)
    assert(saved.answer.result?.ok, 'the final answer is persisted before finalization')
    const paidBeforeResume = models
    const result = await run()
    assert.equal(result.ok, true, boundary)
    assert.equal(models, paidBeforeResume, 'settlement retry must not regenerate the completed answer')
    assert.equal(failed, 0, 'a resumable yield must not fail the turn')
    assert.equal(commits, 1)
    assert.equal(settlements, boundary === 'settle' ? 2 : 1, 'journal reuses settlement already completed before a commit yield')
  }
})
