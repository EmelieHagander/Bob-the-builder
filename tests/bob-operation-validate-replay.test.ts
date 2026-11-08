import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerOperations } from '../supabase/functions/_shared/worker-operations.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

// Deep audit 2026-11-08: a worker write checks its references (the construction
// at its current revision) before it runs. That check read the database live,
// outside the journal. When a step yielded after its own write and before its
// save, the resumed claim replayed the step from the earlier state while the
// database was already at the new revision: the replayed write was refused as
// operation_reference_changed and its journal entry left behind. The check is
// now journaled (ask-openai.ts validateMany, a closure copied here).

const C = '11111111-1111-4111-8111-111111111111'
const db = { current: 2 }
const make = (journal: ReturnType<typeof createBobJournal>) => createWorkerOperations({ version: 2, projectId: 'p', hasAccess: async () => true,
  load: async () => ({ status: 'ready', source: { artifact_id: C, revision: 2 }, entries: [{ kind: 'construction', id: C, revision: 2, label: 'Vägg' }], area_id: null }),
  // As bob.check_worker_operation_refs for constructions: the current revision only.
  validateMany: async entries => journal.run('operation:validate', { refs: entries.map(({ kind, id, revision }) => ({ kind, id, revision })) },
    async () => entries.every(e => e.kind !== 'construction' || (e.id === C && e.revision === db.current))),
  prepareDrawing: async () => ({ status: 'unavailable' }), drawingArguments: () => null, drawingWork: () => undefined } as any)

// The worker session wrapper (bob-tools.ts) around a journaled write.
const execute = async (ops: ReturnType<typeof make>, journal: ReturnType<typeof createBobJournal>) => {
  const prepared = await ops.before('structure', 'edit_construction_parts', { changes: { instances: { upsert: [{ id: 'a' }], remove: [] } }, request_quote: 'x' })
  if (prepared.status !== 'ready' || !prepared.args) return prepared.result ?? { status: prepared.status, reason: prepared.reason, saved: false }
  const args = prepared.args
  const written = await journal.run('rpc:bob_project_write', { record: args.record_id, expected: args.expected_revision }, async () => {
    db.current = Number(args.expected_revision) + 1
    return { status: 'saved', receipt: { projectId: 'p', recordId: C, revision: db.current, dataset: 'artifacts', operation: 'updated' } }
  })
  return ops.observe('structure', 'edit_construction_parts', args, written)
}

test('a worker write replayed after its step yielded is saved again from the journal, not refused', async () => {
  const stored: JournalEntry[] = []
  const store = { entries: stored, save: async (e: JournalEntry) => { stored.push(e) } }
  let clock = 0
  const first = createBobJournal(store, 140_000, () => clock, new Map(), { unlimitedWork: true })
  const ops1 = make(first)
  await ops1.prepare('structure', [{ artifact_id: C, revision: 2 }])
  const saved = { ops: ops1.exportState(), journal: first.exportState() }
  assert.equal((await execute(ops1, first)).status, 'saved')
  // The next read of the step meets the segment wall.
  clock = 133_000
  await assert.rejects(first.run('rpc:read_construction_draft', { id: C }, async () => ({})), (e: unknown) => e instanceof BobContinuation && e.kind === 'yield')
  // Resume from the save before the write; the database is at revision 3.
  const second = createBobJournal({ entries: [...stored], save: store.save }, Infinity, Date.now, new Map(), { unlimitedWork: true })
  second.restoreState(saved.journal as any)
  const ops2 = make(second); ops2.restoreState(saved.ops)
  const replayed = await execute(ops2, second)
  assert.equal(replayed.status, 'saved', JSON.stringify(replayed))
  assert.equal((replayed as any).receipt.revision, 3)
})
