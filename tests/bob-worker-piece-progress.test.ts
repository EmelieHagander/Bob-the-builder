import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorker, verifiedConstructionPiece, type WorkerDefinition, type WorkerProgress } from '../supabase/functions/_shared/bob-workers.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Pure fixtures: no hosted function, model, GitHub Action or live database call.
const catalog = { text: (key: string) => key } as AiCatalogSession
const worker: WorkerDefinition = { role: 'role.structure-worker', tool: 'ask_structure_worker',
  tools: ['edit_construction_parts'], reads: ['read_construction_draft'], max_steps: 8 }
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const model = (id: string, calls: ReturnType<typeof call>[] = []): OpenAIServiceResponse<string> => ({ success: true,
  model: 'fixture', responseId: id, data: calls.length ? null : 'I changed the two pieces.',
  usage: { input_tokens: 3000, output_tokens: 100, total_tokens: 3100 },
  ...(calls.length ? { toolCalls: calls } : {}) })

function harness(pieces: ReturnType<typeof model>[], opts: { enabled: boolean; readback?: (revision: number) => unknown;
  checkInSave?: boolean; serverCheck?: 'checked' | 'unavailable'; inspect?: (revision: number) => Record<string, unknown>;
  pauseForDesignReview?: boolean }) {
  const commands: { name: string; revision: number | null }[] = []
  const scopedChecks: string[][] = []
  const observed: OpenAIServiceOptions[] = [], checkpoints: WorkerProgress[] = []
  let saved = 2
  const result = runWorker({ aiCatalog: catalog, worker,
    callModel: async req => { observed.push(req); return pieces[observed.length - 1] ?? model('end') },
    userId: 'member', job: { job: 'Add two openings on one existing wall, then the next.', findings: null },
    history: [], readKnowledge: async () => ({ current: true }), readCurrent: async () => null,
    session: {
      prepare: async () => [tool('read_construction_draft'), tool('edit_construction_parts'), tool('update_workpad')],
      execute: async (name: string) => {
        commands.push({ name, revision: name === 'edit_construction_parts' ? ++saved : null })
        return name === 'edit_construction_parts'
          ? { status: 'saved', receipt: { dataset: 'artifacts', recordId: 'c1', revision: saved, operation: 'updated' },
            ...(opts.checkInSave !== false ? { check: { status: 'checked', concept_ready: true } } : {}) }
          : name === 'update_workpad' ? { status: 'noted', revision: 3 } : { status: 'ok' }
      },
    },
    readback: async () => [], hasAccess: async () => true, deadline: Date.now() + 60_000, workpadEnabled: true,
    autoCheck: async targets => targets.map(t => {
      commands.push({ name: 'check_exact_revision', revision: t.revision })
      scopedChecks.push(t.component_ids ?? [])
      return { ...t, status: opts.serverCheck ?? 'checked', concept_ready: true }
    }),
    ...(opts.enabled ? { pieceProgress: { readSaved: async (receipt: Record<string, unknown>) => {
      const revision = receipt.revision as number
      commands.push({ name: 'verify_exact_revision', revision })
      return opts.readback?.(revision) ?? { status: 'ok', artifact_id: 'c1', revision,
        current_revision: revision, source_state: 'current', archived: false }
    }, ...(opts.pauseForDesignReview ? { pauseForDesignReview: true } : {}), ...(opts.inspect ? { inspectSaved: async (receipt: Record<string, unknown>) => {
      commands.push({ name: 'inspect_saved_form', revision: receipt.revision as number })
      return opts.inspect!(receipt.revision as number)
    } } : {}) } } : {}),
    progress: { save: async p => { checkpoints.push(structuredClone(p)) } },
  })
  return { result, commands, observed, checkpoints, scopedChecks }
}

test('Konrad sees one save and exact code readback before issuing the next construction change', async () => {
  const steps = [model('one', [call('a', 'read_construction_draft'), call('b', 'edit_construction_parts'),
    call('c', 'edit_construction_parts')]), model('note', [call('d', 'update_workpad')]),
    model('two', [call('e', 'edit_construction_parts')]), model('done')]
  const { result, commands, observed, checkpoints } = harness(steps, { enabled: true })
  assert.equal((await result).status, 'ok')
  assert.deepEqual(commands.map(c => c.name), [
    'read_construction_draft', 'edit_construction_parts', 'verify_exact_revision',
    'update_workpad', 'edit_construction_parts', 'verify_exact_revision',
  ])
  assert.deepEqual(commands.filter(c => c.name === 'verify_exact_revision').map(c => c.revision), [3, 4])
  assert.equal(JSON.parse(String(observed[1].messages![2].content)).status, 'deferred',
    'a second mutation in the same model batch must not execute')
  const saved = JSON.parse(String(observed[1].messages![1].content))
  assert.deepEqual(saved.piece_readback, { status: 'verified', artifact_id: 'c1', revision: 3, approval_not_implied: true })
  assert.equal(checkpoints[0].receipts.length, 2)
  assert.equal(checkpoints[2].receipts.length, 4)
})

test('a stale or mismatched saved revision stops further construction work and keeps the receipt', async () => {
  const calls = [model('one', [call('a', 'edit_construction_parts'), call('b', 'edit_construction_parts')]), model('should-not-run')]
  const { result, observed, commands } = harness(calls, { enabled: true, readback: revision => ({
    status: 'ok', artifact_id: 'c1', revision, current_revision: revision + 1, source_state: 'stale', archived: false,
  }) })
  const report = await result
  assert.equal(report.status, 'needs_verification')
  assert.deepEqual(report.saved_receipt, { tool: 'edit_construction_parts', dataset: 'artifacts', record_id: 'c1', revision: 3, operation: 'updated' })
  assert.equal(observed.length, 1, 'no second model request on unverified persisted state')
  assert.equal(commands.filter(c => c.name === 'edit_construction_parts').length, 1)
})

test('the new boundary is pinned: older workers keep their existing batch semantics', async () => {
  const calls = [model('batch', [call('a', 'edit_construction_parts'), call('b', 'edit_construction_parts')]), model('end')]
  const { result, commands } = harness(calls, { enabled: false })
  assert.equal((await result).status, 'ok')
  assert.equal(commands.filter(c => c.name === 'edit_construction_parts').length, 2)
  assert.equal(commands.some(c => c.name === 'verify_exact_revision'), false)
})

test('writes lacking a bundled check get one code check before the next piece', async () => {
  const calls = [model('first', [call('a', 'edit_construction_parts')]), model('end')]
  const { result, commands, observed } = harness(calls, { enabled: true, checkInSave: false })
  assert.equal((await result).status, 'ok')
  assert.deepEqual(commands.map(c => c.name), ['edit_construction_parts', 'verify_exact_revision', 'check_exact_revision'])
  const output = JSON.parse(String(observed[1].messages![0].content))
  assert.deepEqual(output.piece_check, { status: 'checked', concept_ready: true })
})

test('a saved revision whose server check is unavailable is paused, never called approved', async () => {
  const calls = [model('first', [call('a', 'edit_construction_parts')]), model('should-not-run')]
  const { result, observed } = harness(calls, { enabled: true, checkInSave: false, serverCheck: 'unavailable' })
  assert.deepEqual({ status: (await result).status, reason: (await result).reason },
    { status: 'needs_verification', reason: 'saved_revision_check_incomplete' })
  assert.equal(observed.length, 1)
})

test('verification requires an exact current, unarchived construction revision', () => {
  const receipt = { tool: 'edit_construction_parts', record_id: 'c1', revision: 4 }
  const current = { status: 'ok', artifact_id: 'c1', revision: 4, current_revision: 4,
    source_state: 'current', archived: false }
  assert.deepEqual(verifiedConstructionPiece(receipt, current), { artifact_id: 'c1', revision: 4 })
  assert.equal(verifiedConstructionPiece(receipt, { ...current, archived: true }), null)
  assert.equal(verifiedConstructionPiece(receipt, { ...current, revision: 3 }), null)
  assert.equal(verifiedConstructionPiece(receipt, { ...current, source_state: 'stale' }), null)
  assert.equal(verifiedConstructionPiece({ ...receipt, revision: undefined }, current), null)
})

test('v2 adds code-authored FORM evidence to Konrad and Bob receipts, then a targeted check', async () => {
  const { result, commands, scopedChecks, observed } = harness([
    model('one', [call('a', 'edit_construction_parts')]), model('done'),
  ], { enabled: true, inspect: revision => ({ status: 'form_scoped', revision,
    observed_component_changes: { count: 1, ids: ['window_west'], omitted: 0 },
    affected_scope_complete: true, scope_check_ids: ['window_west'], verification: 'unverified' }) })
  const report = await result
  assert.equal(report.status, 'ok')
  assert.deepEqual(commands.map(c => c.name), ['edit_construction_parts', 'verify_exact_revision', 'inspect_saved_form', 'check_exact_revision'])
  assert.deepEqual(scopedChecks, [['window_west']])
  const toolReply = JSON.parse(String(observed[1].messages![0].content))
  assert.equal(toolReply.piece_evidence.verification, 'unverified')
  assert.deepEqual(toolReply.piece_local_check.component_ids, ['window_west'])
  assert.equal((report.receipts as Record<string, any>[])[0].piece_evidence.status, 'form_scoped')
  assert.equal((report.receipts as Record<string, any>[]).some(r => r.by === 'code_local'), true)
})

test('v3 ends Konrad after one verified, locally checked piece and returns the exact revision for natural visual review', async () => {
  const { result, commands, observed, scopedChecks } = harness([
    model('first', [call('a', 'edit_construction_parts'), call('b', 'edit_construction_parts')]),
    model('must-not-run'),
  ], { enabled: true, pauseForDesignReview: true, inspect: revision => ({ status: 'form_scoped', revision,
    observed_component_changes: { count: 1, ids: ['wall_front'], omitted: 0 },
    affected_scope_complete: true, scope_check_ids: ['wall_front'], verification: 'unverified' }) })
  const report = await result
  assert.deepEqual([report.status, report.reason, report.user_feedback],
    ['awaiting_design_review', 'show_saved_construction', 'not_recorded'])
  assert.deepEqual([(report.saved_receipt as any).record_id, (report.saved_receipt as any).revision], ['c1', 3])
  assert.equal((report.saved_receipt as any).piece_evidence.verification, 'unverified')
  assert.equal(observed.length, 1, 'Konrad must stop even when technical and FORM checks passed')
  assert.equal(commands.filter(c => c.name === 'edit_construction_parts').length, 1)
  assert.deepEqual(scopedChecks, [['wall_front']])
  assert.match(String(report.note), /Show this exact construction revision/)
})

test('v3 does not request a visual review when Konrad only reads and reports', async () => {
  const { result } = harness([model('report', [call('a', 'read_construction_draft')]), model('done')],
    { enabled: true, pauseForDesignReview: true, inspect: () => ({ status: 'form_scoped', affected_scope_complete: true }) })
  assert.equal((await result).status, 'ok')
})

test('v2 pauses before the next piece when FORM evidence cannot be reopened', async () => {
  const { result, observed } = harness([
    model('one', [call('a', 'edit_construction_parts')]), model('should-not-run'),
  ], { enabled: true, inspect: () => ({ status: 'unavailable', reason: 'prior_construction_revision_missing' }) })
  const report = await result
  assert.deepEqual([report.status, report.reason], ['needs_verification', 'saved_form_evidence_unavailable'])
  assert.equal(observed.length, 1)
  assert.equal((report.saved_receipt as Record<string, any>).piece_evidence.reason, 'prior_construction_revision_missing')
})

test('v2 preserves a legacy construction save but stops when no FORM scope can be proven', async () => {
  const { result, observed, commands } = harness([
    model('one', [call('a', 'edit_construction_parts')]), model('must-not-run'),
  ], { enabled: true, inspect: revision => ({ status: 'no_form_scope', revision,
    verification: 'unverified', note: 'Legacy construction without component mapping.' }) })
  const report = await result
  assert.deepEqual([report.status, report.reason], ['needs_verification', 'saved_form_scope_missing'])
  assert.equal(observed.length, 1, 'Konrad must not start the next workpiece just because the save checked')
  assert.equal(commands.filter(c => c.name === 'edit_construction_parts').length, 1)
  assert.equal((report.saved_receipt as Record<string, any>).piece_evidence.status, 'no_form_scope')
})

test('v2 stops on incomplete mapped scope even if the overall construction check passed', async () => {
  const { result, observed, scopedChecks } = harness([
    model('one', [call('a', 'edit_construction_parts')]), model('must-not-run'),
  ], { enabled: true, inspect: () => ({ status: 'form_scoped', affected_scope_complete: false,
    affected_scope_gaps: ['changed_instances_without_form_mapping'], scope_check_ids: [],
    verification: 'unverified' }) })
  const report = await result
  assert.deepEqual([report.status, report.reason], ['needs_verification', 'saved_form_scope_unbounded'])
  assert.equal(observed.length, 1)
  assert.deepEqual(scopedChecks, [], 'an incomplete scope is never sent to the local component checker')
  assert.deepEqual((report.saved_receipt as Record<string, any>).piece_evidence.affected_scope_gaps,
    ['changed_instances_without_form_mapping'])
})

test('v2 fails closed on an unfamiliar FORM status while v1 remains unchanged', async () => {
  const { result, observed } = harness([
    model('one', [call('a', 'edit_construction_parts')]), model('must-not-run'),
  ], { enabled: true, inspect: () => ({ status: 'new_unreviewed_result' }) })
  assert.deepEqual([(await result).status, (await result).reason], ['needs_verification', 'saved_form_evidence_unavailable'])
  assert.equal(observed.length, 1)
})
