// Deep audit 2026-11-08: a committed sketch was never read back or checked by
// code, so Bob was shown the superseded revision. The worker is wired as
// project-answer.ts wires it (readback = readbackReads, autoCheck = uncheckedConstructions).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorker, readbackReads, uncheckedConstructions, saveReceipt, type WorkerDefinition } from '../supabase/functions/_shared/bob-workers.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'

const catalog = { text: (key: string) => key } as AiCatalogSession
const worker: WorkerDefinition = { role: 'role.structure-worker', tool: 'ask_structure_worker', tools: ['edit_construction_parts', 'commit_construction_sketch', 'check_construction_draft'], reads: ['read_construction_draft'], max_steps: 8 }
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const model = (id: string, calls: ReturnType<typeof call>[] = []) => ({ success: true, model: 'f', responseId: id, data: calls.length ? null : 'Klart.', usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }, ...(calls.length ? { toolCalls: calls } : {}) }) as any
const saved = (rev: number) => ({ status: 'saved', receipt: { dataset: 'artifacts', recordId: 'A', revision: rev, operation: 'updated' }, check: { status: 'checked', concept_ready: true } })

async function run(steps: any[]) {
  const checked: unknown[] = [], readFor: unknown[] = []
  let n = 0
  const report = await runWorker({ aiCatalog: catalog, worker, callModel: async () => steps[n++] ?? model('end'), userId: 'u', job: { job: 'Ändra väggen.', findings: null }, history: [],
    readKnowledge: async () => ({}), readCurrent: async () => null,
    session: { prepare: async () => worker.tools.concat(worker.reads).map(tool),
      execute: async (name: string, args: any) => name === 'edit_construction_parts' ? (args.mode === 'sketch' ? { status: 'sketched', saved: false } : saved(4))
        : name === 'commit_construction_sketch' ? saved(5) : { status: 'ok' } },
    hasAccess: async () => true, deadline: Date.now() + 60_000,
    // project-answer.ts:661-684, reduced: the same target/read selection.
    autoCheck: async targets => { checked.push(...targets); return targets.map(t => ({ ...t, status: t.revision === 5 ? 'checked' : 'conflict' })) },
    readback: async receipts => readbackReads(receipts).map(r => { readFor.push(r); return { construction: r } }) })
  return { report, checked, readFor }
}

test('a job whose only save is a sketch commit: code reads back and checks the committed revision', async () => {
  const { report, checked, readFor } = await run([model('1', [call('a', 'edit_construction_parts', { mode: 'sketch' })]), model('2', [call('b', 'commit_construction_sketch', { action: 'commit' })]), model('3')])
  assert.deepEqual(checked, [{ artifact_id: 'A', revision: 5 }])
  assert.deepEqual(readFor.map((r: any) => r.arguments?.revision), [5])
  assert.ok(report.readback, 'Bob gets the readback of the commit')
})

test('direct edit rev 4 then sketch commit rev 5: code checks and reads back revision 5', async () => {
  const { checked, readFor } = await run([model('1', [call('a', 'edit_construction_parts', { mode: 'save' })]), model('2', [call('b', 'commit_construction_sketch', { action: 'commit' })]), model('3')])
  assert.deepEqual(checked, [{ artifact_id: 'A', revision: 5 }])
  assert.deepEqual(readFor.map((r: any) => r.arguments?.revision), [5])
})
