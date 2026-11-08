import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMediaAdapter, type MediaRow, type MediaTransport } from '../supabase/functions/_shared/project-context/media.ts'
import type { Item } from '../supabase/functions/_shared/project-context/dispatcher.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

// Deep audit 2026-11-08: listed images without a description were described in
// parallel, each inside an outer journal step wrapping its journaled open, model
// call and save. Live, the inner calls took positions in the order the network
// answered; on replay in call order, so a resumed turn stopped with
// continuation_changed. They now run one after another, each call journaled once.
// The wiring copies ask-openai.ts describeListedImage (a closure there).

const project = 'p'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = (n: number): MediaRow => ({ id: id(n), project_id: project, title: 'Bild ' + n, purpose: 'reference', content_type: 'image/jpeg',
  byte_size: 10, width: 100, height: 100, state: 'ready', updated_at: '2026-11-06T00:00:00Z', created_at: '2026-11-06T00:00:00Z', bucket_id: 'bob-project-media',
  object_path: `${project}/${id(n)}`, source_kind: 'owner_upload', media_links: [] })
const rows = [row(1), row(2)]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const items = rows.map(r => ({ ref: 'image:' + r.id, title: r.title })) as Item[]

function wire(journal: ReturnType<typeof createBobJournal>, readDelay: Record<string, number>, ready: (ref: string) => 'ok' | 'ai_wait' | 'provider_retry') {
  const memo = <T>(stream: string, input: unknown, work: () => Promise<T>, reserve = 0, signal?: AbortSignal) => journal.run(stream, input, work, reserve, signal)
  const transport: MediaTransport = {
    count: async () => rows.length, list: async () => rows, download: async () => { throw new Error('no pixels') },
    read: async rid => { await sleep(readDelay[rid] ?? 0); return rows.find(r => r.id === rid) ?? null },
    descriptions: async () => [],
  }
  let open: (ref: string, signal: AbortSignal) => Promise<any>
  const adapter = createMediaAdapter(project, transport, true, async (listed, signal) => {
    const opened = await open(listed.ref, signal)
    const response = await memo('model:image-describer', { title: opened.item.title }, async () => {
      const state = ready(opened.item.ref)
      if (state === 'ai_wait') throw new BobContinuation('yield', 'ai_wait', { id: 'ai-' + opened.item.ref, accepted: true, role: 'image-describer' })
      if (state === 'provider_retry') throw new BobContinuation('yield', 'provider_retry')
      return { success: true, data: { description: 'Beskriven ' + opened.item.title } }
    })
    const text = (response as any).data.description as string
    await memo('media:describe', { ref: opened.item.ref, description: text }, async () => true)
    return text
  })
  open = (ref, signal) => memo('media:open', ref, () => adapter.open(ref, signal), 0, signal)
  return adapter
}

for (const pause of ['ai_wait', 'provider_retry'] as const) test(`a batch paused by ${pause} on its first image resumes and describes both`, async () => {
  const stored: JournalEntry[] = []
  const store = { entries: stored, save: async (e: JournalEntry) => { stored.push(e) } }
  // The first image's read is the slower one, as when the network answers out of order.
  await assert.rejects(wire(createBobJournal(store, Infinity), { [id(1)]: 30, [id(2)]: 1 }, ref => ref === items[0].ref ? pause : 'ok').describeMissing!(items, AbortSignal.timeout(5000)),
    (e: unknown) => e instanceof BobContinuation && e.message === pause)
  const described = await wire(createBobJournal({ entries: [...stored], save: store.save }, Infinity), {}, () => 'ok').describeMissing!(items, AbortSignal.timeout(5000))
  assert.deepEqual(described.map(i => i.description !== undefined), [true, true])
  // Each image's model call holds its own position, in call order.
  assert.deepEqual(stored.map(e => e.key).filter(k => /^model:image-describer:\d+$/.test(k)), ['model:image-describer:0', 'model:image-describer:1'])
})
