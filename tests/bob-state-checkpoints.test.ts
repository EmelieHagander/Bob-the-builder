import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ProjectSource } from '../src/data/provenance.ts'
import type { CurrentView } from '../src/domain/bobScreen.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter, type WritePayload, type WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { createProjectContext, type Opened } from '../supabase/functions/_shared/project-context/dispatcher.ts'
import { createCurrentViewGuard } from '../supabase/functions/_shared/current-view-guard.ts'

const T1 = '2026-10-19T10:00:00.000Z', T2 = '2026-10-19T10:01:00.000Z'
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const readProject = { dataset: 'project', query: null, status: null, area_id: null, record_id: null, after_id: null }
const receipt = (savedAt = T1): WriteReadback => ({ projectId: 'A', dataset: 'tasks', recordId: 'task', label: 'Task', operation: 'updated', savedAt,
  record: { id: 'task', name: 'Task', instructions: savedAt, updated_at: savedAt } })
const payload: WritePayload = { kind: 'task', record_id: 'task', expected_updated_at: T1, expected_revision: null, request_quote: 'Update task', data: { name: 'Task' } }
const noError = (data: unknown) => ({ data, error: null })

test('lookup checkpoints restore observations and counters into the original shared source array without reads', async () => {
  let reads = 0
  const make = (observed: string, project = 'A') => createProjectLookup(project, async () => {
    reads++; return noError({ records: [{ id: 'A', name: 'Project', updated_at: T1 }], related: [], truncated: false })
  }, 1000, 10, undefined, { observationTime: async () => observed })
  const first = make(T1)
  await first.search(readProject)
  await first.search({ invalid: true })
  const saved = json(first.exportState()), restored = make(T2), shared = restored.sources
  restored.restoreState(saved)
  assert.equal(reads, 1)
  assert.strictEqual(restored.sources, shared)
  assert.deepEqual(restored.exportState(), saved)
  assert.equal(restored.remaining, first.remaining); assert.equal(restored.partial, true)
  saved.sources[0].label = 'Mutated exported copy'
  assert.equal(restored.sources[0].label, 'Project')
  await restored.search(readProject)
  assert.deepEqual(shared.map(source => source.retrievedAt), [T1, T2])
  const before = restored.exportState()
  assert.throws(() => restored.restoreState({ ...before, version: 2 } as any), /lookup_checkpoint_invalid/)
  assert.throws(() => make(T2, 'B').restoreState(before), /lookup_checkpoint_invalid/)
  assert.deepEqual(restored.exportState(), before, 'invalid state is rejected before any mutation')
})

test('writer checkpoints retain historical receipt identities so older recovery cannot roll back newer readbacks', async () => {
  const old = receipt(T1), latest = receipt(T2)
  let writes = 0
  const make = () => createProjectWriter('A', 'Update task', async () => { writes++; return noError(old) },
    async () => noError([old, latest]), async () => noError({ generation: 3, receipts: [latest] }))
  const first = make()
  await first.recover()
  assert.equal((await first.commit(payload)).status, 'saved')
  await first.commitBound('edit_work_record', 'unbound', null)
  await first.write('save_project_task', { record_id: 'other', area_id: 'area', step_id: null, name: 'Other', instructions: 'Keep', expected_updated_at: null, request_quote: 'Update task' })
  const saved = json(first.exportState()), restored = make(), shared = restored.receipts
  restored.restoreState(saved)
  assert.equal(writes, 1, 'restoring state never executes or recovers writes')
  assert.strictEqual(restored.receipts, shared)
  assert.deepEqual(restored.exportState(), saved)
  assert.deepEqual(restored.unresolvedTools, ['edit_work_record', 'save_project_task'])
  assert.equal(restored.correctionsRemaining, first.correctionsRemaining)
  assert.equal(restored.remaining, first.remaining)
  await restored.recover()
  assert.equal((await restored.commit(payload)).status, 'saved')
  assert.equal(shared[0].savedAt, T2, 'old receipt identity remains remembered after restoration')
  assert.deepEqual(restored.executedReceipts, [old], 'recovery must not leak future writes into model-visible executed receipts')
  saved.receipts[0].record.instructions = 'Caller mutation'
  assert.equal(shared[0].record.instructions, T2)
  const before = restored.exportState()
  assert.throws(() => restored.restoreState({ ...before, version: 2 } as any), /writer_checkpoint_invalid/)
  assert.throws(() => restored.restoreState({ ...before, receipts: [{ ...old, projectId: 'B' }] }), /writer_checkpoint_invalid/)
  assert.deepEqual(restored.exportState(), before)
})

test('writer uncertain and settled checkpoints keep all subsequent writes fenced', async () => {
  let writes = 0
  const make = () => createProjectWriter('A', 'Update task', async () => { writes++; throw new Error('Unknown commit outcome') },
    async () => noError([receipt()]), async () => noError({ generation: 3, receipts: [receipt()] }))
  const first = make()
  assert.equal((await first.commit(payload)).status, 'unknown')
  const uncertain = make(); uncertain.restoreState(json(first.exportState()))
  assert.equal(uncertain.uncertain, true); assert.equal(uncertain.remaining, 0)
  assert.equal((await uncertain.commit(payload)).status, 'unknown'); assert.equal(writes, 1)
  assert.equal(await uncertain.settle(), 3)
  const settled = make(); settled.restoreState(json(uncertain.exportState()))
  assert.equal((await settled.commit(payload)).status, 'denied'); assert.equal(writes, 1)
  assert.deepEqual(settled.receipts, uncertain.receipts)
})

function imageFixture(sources: ProjectSource[] = []) {
  let opens = 0, current = 0, allowed = true
  const opened = (ref: string): Opened => ({ item: { ref, title: ref, project_id: 'A' }, version: 'v1', bytes: 4000000,
    image: { type: 'image_url', image_url: `private-image:${ref.slice(6)}/${'a'.repeat(64)}` },
    source: { projectId: 'A', dataset: 'image_pixels', recordId: ref.slice(6), label: ref, retrievedAt: T1, updatedAt: T1, truth: 'unknown' } })
  const context = createProjectContext({ sources, hasAccess: async () => allowed, unlimitedWork: true, imageEvidenceInstruction: 'Image evidence',
    adapters: [{ category: 'images', prefix: 'image', count: async () => 2, list: async () => ({ items: [], next_cursor: null }),
      open: async ref => { opens++; return opened(ref) }, current: async () => { current++; return allowed } }],
    describe: async () => ({ status: 'cached' }),
  })
  return { context, sources, opened, get opens() { return opens }, get current() { return current }, revoke() { allowed = false } }
}

test('image checkpoints retain pending refs separately from delivered evidence without downloading or copying pixels', async () => {
  const first = imageFixture()
  await first.context.execute('open_project_item', { refs: ['image:first'] })
  first.context.confirmDelivery()
  await first.context.execute('open_project_item', { refs: ['image:second'] })
  await first.context.execute('open_project_item', { invalid: true })
  const saved = json(first.context.exportState()), restored = imageFixture(json(first.sources))
  restored.context.restoreState(saved)
  assert.equal(restored.opens, 0); assert.equal(restored.current, 0)
  assert.deepEqual(restored.context.exportState(), saved)
  assert.deepEqual(restored.context.carrier(), first.context.carrier())
  assert.deepEqual(restored.context.openedImageRefs(), ['image:first', 'image:second'])
  assert.equal(saved.delivered[0].image.image_url, '')
  assert(saved.pending[0].image.image_url.startsWith('private-image:'))
  assert.doesNotMatch(JSON.stringify(saved), /data:image|base64/)
  assert.equal(restored.sources.length, 1, 'pending pixels have no delivered evidence')
  assert.equal((await restored.context.execute('describe_project_image', { ref: 'image:second', description: 'Not yet viewed' })).status, 'image_not_viewed')
  assert.equal(await restored.context.validate(), true); assert.equal(restored.current, 2)
  restored.context.confirmDelivery()
  assert.equal(restored.sources.length, 2); assert.equal(restored.context.carrier().length, 0)
  assert.equal(restored.context.exportState().byteCount, 0)
  saved.pending[0].item.title = 'Mutated copy'
  assert.equal(restored.context.exportState().delivered[1].item.title, 'image:second')
  restored.revoke(); assert.equal(await restored.context.validate(), false)
  const before = restored.context.exportState()
  assert.throws(() => restored.context.restoreState({ ...before, version: 2 } as any), /context_checkpoint_invalid/)
  assert.throws(() => restored.context.restoreState({ ...before, pending: [{ ...first.opened('image:third'), image: { type: 'image_url', image_url: 'data:image/png;base64,pixels' } }] }), /context_checkpoint_invalid/)
  assert.deepEqual(restored.context.exportState(), before)
})

test('current-view checkpoints retain frozen input and accepted own-write evidence, while live external edits still fail', async () => {
  const initial: CurrentView = { status: 'ok', projectId: 'A', surface: 'project', project: { id: 'A', name: 'Before' }, focus: {}, warnings: [], retrievedAt: T1,
    sources: [{ projectId: 'A', dataset: 'project', recordId: 'A', label: 'Before', retrievedAt: T1, updatedAt: T1, truth: 'unknown' }] }
  const fresh = json(initial)
  fresh.project!.name = 'After'; fresh.sources[0] = { ...fresh.sources[0], label: 'After', updatedAt: T2 }
  const own: WriteReadback = { projectId: 'A', dataset: 'project', recordId: 'A', label: 'Project', operation: 'updated', savedAt: T2,
    record: { id: 'A', name: 'After', updated_at: T2 } }
  let reads = 0, allowed = true
  const make = () => createCurrentViewGuard({ initial, read: async () => { reads++; return fresh }, hasAccess: async () => allowed, receipts: () => [own] })
  const first = make(); assert.equal(await first.validate(), true)
  const saved = json(first.exportState()), restored = make()
  restored.restoreState(saved)
  assert.equal(reads, 1, 'restoring does not fetch or authorize the current view')
  assert.deepEqual(restored.exportState(), saved)
  assert.equal(restored.exportState().initial.project!.name, 'Before')
  assert.equal(restored.evidence().project!.name, 'After')
  saved.accepted.project!.name = 'Mutated copy'
  assert.equal(restored.evidence().project!.name, 'After')
  assert.equal(await restored.validate(), true)
  fresh.project!.name = 'External edit'
  assert.equal(await restored.validate(), false)
  assert.equal(restored.evidence().project!.name, 'After')
  allowed = false; assert.equal(await restored.validate(), false)
  const before = restored.exportState()
  assert.throws(() => restored.restoreState({ ...before, version: 2 } as any), /current_view_checkpoint_invalid/)
  assert.throws(() => restored.restoreState({ ...before, initial: { ...initial, projectId: 'B' } }), /current_view_checkpoint_invalid/)
  assert.deepEqual(restored.exportState(), before)
})
