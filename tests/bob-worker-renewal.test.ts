import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorker, type WorkerProgress } from '../supabase/functions/_shared/bob-workers.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Entrén, 2026-11-07 (job 016d8a42): Konrad's context passed 105k tokens after
// a saved revision and a workpad note. The renewal attempt ran after the step
// was saved and did not renew; the job yielded, resumed from that save, and the
// next step's attempt met the earlier attempt's journal entry with another
// location: continuation_changed at workpad:load, and Bob's turn failed.

const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const catalog = {
  definition: () => ({ metadata: {} }),
  role: () => ({ systemMessage: 'Role.', providerAdapter: 'openai-responses-v1' }),
  schema: (name: string) => ({ name, schema: { type: 'object' } }),
  text: (key: string) => key,
  tool,
} as unknown as AiCatalogSession
const call = (id: string, name: string) => ({ id, type: 'function' as const, function: { name, arguments: '{}' } })

test('a renewal attempt that does not renew is covered by the step save, so the resumed job continues', async () => {
  const stored: JournalEntry[] = []
  const store = { entries: stored, save: async (e: JournalEntry) => { stored.push(e) } }
  let saved: { progress: WorkerProgress; journal: unknown } | undefined
  let n = 0
  const run = async (journal: ReturnType<typeof createBobJournal>, restored?: WorkerProgress) => runWorker({
    aiCatalog: catalog, worker: { role: 'role.structure-worker', tool: 'ask_structure_worker', tools: ['edit_construction_parts'], reads: ['read_construction_draft'], max_steps: 6 } as any,
    // Step 1 saves a revision and notes the workpad; later steps read. Every answer is past 105k input tokens.
    callModel: async () => {
      n++
      return { success: true, model: 'fixture', responseId: 'r' + n, data: null, outputPhase: 'tool_calls',
        usage: { input_tokens: 110_000, output_tokens: 10, total_tokens: 110_010 },
        toolCalls: n === 1 ? [call('a', 'edit_construction_parts'), call('b', 'update_workpad')] : [call('c' + n, 'read_construction_draft')] } as OpenAIServiceResponse<any>
    },
    userId: 'u', job: { job: 'Lägg till en regel.', findings: null }, history: [], workpadEnabled: true,
    session: { prepare: async () => ['edit_construction_parts', 'update_workpad', 'read_construction_draft'].map(tool),
      execute: async (name: string) => name === 'edit_construction_parts' ? { status: 'saved', receipt: { dataset: 'artifacts', recordId: 'c1', revision: 2, operation: 'updated' } }
        : name === 'update_workpad' ? { status: 'noted', revision: 5 } : { status: 'ok' } },
    readCurrent: async () => null, readKnowledge: async () => ({}), readback: async () => [], hasAccess: async () => true, deadline: Infinity,
    releaseChain: () => {},
    // The note read back is older than the one Konrad wrote: no renewal.
    verifiedRenewal: { loadWorkpad: (step: number) => journal.run('workpad:load', { agent: 'structure', location: 'renewal:' + step },
      async () => ({ status: 'ok' as const, revision: 4, note: { status: 'working', next_step: 'Fortsätt.' } as any })) },
    progress: { ...(restored ? { restored } : {}), save: async (progress: WorkerProgress) => { saved = { progress: structuredClone(progress), journal: journal.exportState() } },
      afterStep: () => { throw new BobContinuation('yield', 'worker_step') } },
  } as any)
  // First claim: step 1 saves, notes, tries to renew, and yields.
  const first = createBobJournal(store, Infinity)
  await assert.rejects(run(first), (e: unknown) => e instanceof BobContinuation && e.message === 'worker_step')
  assert.deepEqual(stored.map(e => e.key), ['workpad:load:0'])
  // Each later claim resumes from the last save; its attempt never meets an earlier one.
  for (let claim = 2; claim <= 3; claim++) {
    const next = createBobJournal(store, Infinity)
    next.restoreState(saved!.journal as any)
    await assert.rejects(run(next, saved!.progress), (e: unknown) => e instanceof BobContinuation && e.message === 'worker_step',
      'the resumed job yields after its step instead of stopping with continuation_changed')
  }
  assert.deepEqual(stored.map(e => e.key), ['workpad:load:0', 'workpad:load:1', 'workpad:load:2'])
  assert.deepEqual(stored.map(e => (e as any).value?.result?.revision ?? null).length, 3)
})

test('a renewal that renews is saved with the step: the resumed job continues on the fresh chain', async () => {
  const stored: JournalEntry[] = []
  const store = { entries: stored, save: async (e: JournalEntry) => { stored.push(e) } }
  let saved: { progress: any; journal: unknown } | undefined
  const released: string[] = []
  let n = 0
  const journal = createBobJournal(store, Infinity)
  await assert.rejects(runWorker({
    aiCatalog: catalog, worker: { role: 'role.structure-worker', tool: 'ask_structure_worker', tools: ['edit_construction_parts'], reads: ['read_construction_draft'], max_steps: 6 } as any,
    callModel: async () => {
      n++
      return { success: true, model: 'fixture', responseId: 'r' + n, data: null, outputPhase: 'tool_calls',
        usage: { input_tokens: 110_000, output_tokens: 10, total_tokens: 110_010 },
        toolCalls: [call('a', 'edit_construction_parts'), call('b', 'update_workpad')] } as OpenAIServiceResponse<any>
    },
    userId: 'u', job: { job: 'Lägg till en regel.', findings: null }, history: [], workpadEnabled: true,
    session: { prepare: async () => ['edit_construction_parts', 'update_workpad', 'read_construction_draft'].map(tool),
      execute: async (name: string) => name === 'edit_construction_parts' ? { status: 'saved', receipt: { dataset: 'artifacts', recordId: 'c1', revision: 2, operation: 'updated' } }
        : { status: 'noted', revision: 5 } },
    readCurrent: async () => null, readKnowledge: async () => ({}), hasAccess: async () => true, deadline: Infinity,
    readback: async () => [{ construction: { status: 'ok', artifact_id: 'c1', revision: 2 } }],
    releaseChain: (id: string) => { released.push(id) },
    verifiedRenewal: { loadWorkpad: (step: number) => journal.run('workpad:load', { agent: 'structure', location: 'renewal:' + step },
      async () => ({ status: 'ok' as const, revision: 5, note: { status: 'working', next_step: 'Fortsätt.' } as any })) },
    progress: { save: async (progress: WorkerProgress) => { saved = { progress: structuredClone(progress), journal: journal.exportState() } },
      afterStep: () => { throw new BobContinuation('yield', 'worker_step') } },
  } as any), (e: unknown) => e instanceof BobContinuation && e.message === 'worker_step')
  // One save per step, after the renewal: the fresh messages, no chain, one reset.
  assert.deepEqual(released, ['r1'])
  assert.equal(saved!.progress.previous, null)
  assert.equal(saved!.progress.renewal.resets, 1)
  assert.ok(JSON.stringify(saved!.progress.messages).includes('context_renewal'))
  assert.deepEqual((saved!.journal as any).positions, { 'workpad:load': 1 })
})

test('a committed sketch is a saved boundary: renewal can follow it (deep audit 2026-11-08)', async () => {
  const stored: JournalEntry[] = []
  const journal = createBobJournal({ entries: stored, save: async (e: JournalEntry) => { stored.push(e) } }, Infinity)
  let saved: any
  await assert.rejects(runWorker({
    aiCatalog: catalog, worker: { role: 'role.structure-worker', tool: 'ask_structure_worker', tools: ['commit_construction_sketch'], reads: ['read_construction_draft'], max_steps: 6 } as any,
    callModel: async () => ({ success: true, model: 'fixture', responseId: 'r1', data: null, outputPhase: 'tool_calls',
      usage: { input_tokens: 110_000, output_tokens: 10, total_tokens: 110_010 }, toolCalls: [call('a', 'commit_construction_sketch'), call('b', 'update_workpad')] }) as OpenAIServiceResponse<any>,
    userId: 'u', job: { job: 'Spara skissen.', findings: null }, history: [], workpadEnabled: true,
    session: { prepare: async () => ['commit_construction_sketch', 'update_workpad', 'read_construction_draft'].map(tool),
      execute: async (name: string) => name === 'commit_construction_sketch' ? { status: 'saved', receipt: { dataset: 'artifacts', recordId: 'c1', revision: 6, operation: 'updated' } } : { status: 'noted', revision: 5 } },
    readCurrent: async () => null, readKnowledge: async () => ({}), hasAccess: async () => true, deadline: Infinity,
    readback: async () => [{ construction: { status: 'ok', artifact_id: 'c1', revision: 6 } }], releaseChain: () => {},
    verifiedRenewal: { loadWorkpad: (step: number) => journal.run('workpad:load', { location: 'renewal:' + step }, async () => ({ status: 'ok' as const, revision: 5, note: { status: 'working', next_step: 'Fortsätt.' } as any })) },
    progress: { save: async (progress: WorkerProgress) => { saved = structuredClone(progress) }, afterStep: () => { throw new BobContinuation('yield', 'worker_step') } },
  } as any), (e: unknown) => e instanceof BobContinuation && e.message === 'worker_step')
  assert.equal(saved.renewal.resets, 1, 'renewed after the commit')
})
