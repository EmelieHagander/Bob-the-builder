import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorker, type WorkerDefinition } from '../supabase/functions/_shared/bob-workers.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-11-07 (sketchbook B): a sketched change saves nothing,
// so several may follow in one model batch; a commit is a save like any other
// piece write; sketches still open when Konrad stops are reported as not saved.
const catalog = { text: (key: string) => key } as AiCatalogSession
const worker: WorkerDefinition = { role: 'role.structure-worker', tool: 'ask_structure_worker',
  tools: ['edit_construction_parts', 'save_construction_draft', 'commit_construction_sketch'], reads: ['read_construction_draft'], max_steps: 8 }
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const model = (id: string, calls: ReturnType<typeof call>[] = []): OpenAIServiceResponse<string> => ({ success: true,
  model: 'fixture', responseId: id, data: calls.length ? null : 'Ramen är skissad.', usage: { input_tokens: 3000, output_tokens: 100, total_tokens: 3100 },
  ...(calls.length ? { toolCalls: calls } : {}) })

function harness(steps: ReturnType<typeof model>[], open: () => Promise<{ artifact_id: string; base_revision: number; change_count: number }[] | null>) {
  const executed: string[] = [], observed: OpenAIServiceOptions[] = []
  let saved = 4
  const result = runWorker({ aiCatalog: catalog, worker,
    callModel: async req => { observed.push(req); return steps[observed.length - 1] ?? model('end') },
    userId: 'member', job: { job: 'Bygg ramen med lådor.', findings: null }, history: [],
    readKnowledge: async () => ({ current: true }), readCurrent: async () => null,
    session: {
      prepare: async () => [tool('read_construction_draft'), tool('edit_construction_parts'), tool('save_construction_draft'), tool('commit_construction_sketch'), tool('update_workpad')],
      execute: async (name: string, args: any) => {
        executed.push(name + (args?.mode ? ':' + args.mode : args?.action ? ':' + args.action : ''))
        if ((name === 'edit_construction_parts' || name === 'save_construction_draft') && args?.mode === 'sketch') return { status: 'sketched', saved: false, change_count: 2 }
        if (name === 'commit_construction_sketch' && args?.action === 'commit')
          return { status: 'saved', receipt: { dataset: 'artifacts', recordId: 'c1', revision: ++saved, operation: 'updated' }, check: { status: 'checked', concept_ready: true } }
        if (name === 'commit_construction_sketch') return { status: 'ok', saved: false }
        return { status: 'ok' }
      },
    },
    readback: async () => [], hasAccess: async () => true, deadline: Date.now() + 60_000, workpadEnabled: true,
    autoCheck: async targets => targets.map(t => ({ ...t, status: 'checked', concept_ready: true })),
    pieceProgress: { gatesAsFacts: true, readSaved: async (receipt: Record<string, unknown>) => ({ status: 'ok', artifact_id: 'c1',
      revision: receipt.revision, current_revision: receipt.revision, source_state: 'current', archived: false }) },
    openSketches: open,
  })
  return { result, executed, observed }
}

test('sketched changes and sketch reads run together in one batch; a commit is one save and defers what follows it', async () => {
  const steps = [
    model('one', [call('a', 'edit_construction_parts', { mode: 'sketch' }), call('b', 'save_construction_draft', { mode: 'sketch' }),
      call('c', 'commit_construction_sketch', { action: 'read' })]),
    model('two', [call('d', 'commit_construction_sketch', { action: 'commit' }), call('e', 'edit_construction_parts', { mode: 'sketch' })]),
    model('done')]
  const { result, executed, observed } = harness(steps, async () => [])
  const report = await result
  assert.equal(report.status, 'ok')
  assert.deepEqual(executed, ['edit_construction_parts:sketch', 'save_construction_draft:sketch', 'commit_construction_sketch:read', 'commit_construction_sketch:commit'])
  const second = observed[2].messages!.map(m => JSON.parse(String(m.content)))
  assert.equal(second[0].status, 'saved'); assert.equal(second[0].piece_readback.status, 'verified')
  assert.equal(second[1].status, 'deferred', 'nothing runs after a save in the same batch')
  assert.equal(report.open_sketches, undefined, 'no open sketch, nothing reported')
})

test('a sketch left open when Konrad stops is reported to Bob as not saved; an unreadable list is reported as unknown', async () => {
  const open = [{ artifact_id: 'c1', base_revision: 4, change_count: 2 }]
  const kept = await harness([model('one', [call('a', 'edit_construction_parts', { mode: 'sketch' })]), model('done')], async () => open).result
  assert.deepEqual(kept.open_sketches, { status: 'not_saved', sketches: open,
    note: 'These sketched changes are not saved. Ask Konrad to commit or discard them in this request; they are dropped when it ends.' })
  const unknown = await harness([model('done')], async () => null).result
  assert.equal((unknown.open_sketches as any).status, 'unavailable')
})
