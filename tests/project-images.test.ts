import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectContext } from '../supabase/functions/_shared/project-context/dispatcher.ts'
import { createMediaAdapter, readImageResponse, validImageSignature, type MediaRow, type MediaTransport } from '../supabase/functions/_shared/project-context/media.ts'
import { responseMessageContent, hasImageContent } from '../supabase/functions/_shared/openai-content.ts'
import type { ProjectSource } from '../src/data/provenance.ts'

const id = (n = 1) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ref = (n = 1) => `image:${id(n)}`
// Parser fixture only. A real generated PNG is used in the hosted vision smoke.
const png = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3])
function fixture(count = 1) {
  let allowed = true, downloads = 0, reads = 0
  const sources: ProjectSource[] = []
  const rows: MediaRow[] = Array.from({ length: count }, (_, n) => ({
    id: id(n+1), project_id: 'A', title: `Untitled ${n+1}`, purpose: 'current_state', content_type: 'image/png',
    byte_size: png.length, width: 10, height: 10, state: 'ready', created_at: '2026-09-20T10:00:00Z',
    updated_at: '2026-09-20T10:00:00Z', bucket_id: 'bob-project-media', object_path: `A/${id(n+1)}`,
  }))
  const transport: MediaTransport = {
    count: async () => rows.length,
    list: async r => rows.filter(x => !r.after_id || x.id > r.after_id).slice(0,13),
    read: async id => { reads++; return structuredClone(rows.find(r => r.id === id) ?? null) },
    download: async () => { downloads++; return png },
  }
  const make = () => createProjectContext({ adapters: [createMediaAdapter('A', transport)], hasAccess: async () => allowed, sources })
  return { rows, sources, transport, make, ctx: make(), get downloads() { return downloads }, get reads() { return reads }, revoke() { allowed = false } }
}
const list = { category: 'images', query: null, area_id: null, after_id: null }

test('catalog and paged manifests never fetch pixels or claim visual evidence', async () => {
  const f = fixture(15)
  assert.equal((await f.ctx.catalog()).categories[0].count, 15)
  const first = await f.ctx.execute('list_project_category', list)
  assert.equal(first.status, 'ok'); assert('items' in first && first.items.length === 12)
  assert('next_cursor' in first && first.next_cursor === id(12))
  const second = await f.ctx.execute('list_project_category', { ...list, after_id: id(12) })
  assert('items' in second && second.items.length === 3)
  assert.equal(f.downloads, 0); assert.deepEqual(f.sources, []); assert.deepEqual(f.ctx.carrier(), [])
  assert.doesNotMatch(JSON.stringify(first), /bucket|object_path|data:image|base64|auth_user/)
})

test('open transports actual bytes separately from JSON and only records successful model delivery', async () => {
  const f = fixture()
  const r = await f.ctx.execute('open_project_item', { refs: [ref()] })
  assert.equal(r.status, 'ok'); assert.equal(f.downloads, 1); assert.equal(f.sources.length, 0)
  assert.doesNotMatch(JSON.stringify(r), /base64|bucket|object_path/)
  const carrier = f.ctx.carrier()
  assert(hasImageContent(carrier))
  const parts = responseMessageContent('user', carrier[0].content)
  const image = parts.find(x => x.type === 'input_image')!
  assert.equal(image.image_url, 'data:image/png;base64,' + Buffer.from(png).toString('base64'))
  assert.equal(await f.ctx.validate(), true)
  f.ctx.confirmDelivery()
  assert.equal(f.sources[0].dataset, 'image_pixels'); assert.equal(f.sources[0].recordId, id())
  assert.deepEqual(f.ctx.carrier(), [])
})

test('an image can be reopened within a turn and in a fresh turn, without permanent seen suppression', async () => {
  const f = fixture()
  await f.ctx.execute('open_project_item', { refs: [ref()] }); f.ctx.confirmDelivery()
  await f.ctx.execute('open_project_item', { refs: [ref()] })
  assert(hasImageContent(f.ctx.carrier())); f.ctx.confirmDelivery()
  const next = f.make(); await next.execute('open_project_item', { refs: [ref()] })
  assert(hasImageContent(next.carrier())); assert.equal(f.downloads, 3)
  assert.equal(f.sources.length, 1, 'same-version evidence is deduplicated, not image access')
})

test('revoked, foreign, pending, deleted and forged sources yield no pixels', async () => {
  for (const changes of [{ project_id: 'B' }, { state: 'pending' }, { state: 'deleting' }, { object_path: 'B/secret' }, { bucket_id: 'public' }]) {
    const f = fixture(); Object.assign(f.rows[0], changes)
    assert.equal((await f.ctx.execute('open_project_item', { refs: [ref()] })).status, 'unavailable')
    assert.equal(f.downloads, 0); assert.deepEqual(f.ctx.carrier(), []); assert.deepEqual(f.sources, [])
  }
  const f = fixture(); f.revoke()
  assert.equal((await f.ctx.execute('open_project_item', { refs: [ref()] })).status, 'denied')
  assert.equal(f.reads, 0)
})

test('mid-download changes and post-delivery revocation block subsequent use', async () => {
  const f = fixture()
  f.transport.download = async () => { f.rows[0].state = 'deleting'; return png }
  assert.equal((await f.ctx.execute('open_project_item', { refs: [ref()] })).status, 'unavailable')
  const g = fixture(); await g.ctx.execute('open_project_item', { refs: [ref()] }); g.ctx.confirmDelivery()
  g.rows[0].state = 'deleting'
  assert.equal(await g.ctx.validate(), false)
})

test('partial batches identify only the images actually prepared; failures are not empty lists', async () => {
  const f = fixture()
  const r = await f.ctx.execute('open_project_item', { refs: [ref(), ref(2)] })
  assert.equal(r.status, 'ok'); assert('items' in r)
  assert.equal((r.items[0] as any).status, 'prepared'); assert.equal((r.items[1] as any).status, 'unavailable')
  assert.equal(f.ctx.partial, true); f.ctx.confirmDelivery(); assert.equal(f.sources.length, 1)
  f.transport.list = async () => { throw new Error('private backend internals') }
  const fail = await f.ctx.execute('list_project_category', list)
  assert.equal(fail.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(fail), /private backend/)
})

test('untrusted tool shapes cannot select project, tables, URLs or duplicate unbounded batches', async () => {
  const f = fixture()
  for (const bad of [{ refs: [ref()], projectId: 'B' }, { refs: ['https://evil.test/image'] }, { refs: [ref(), ref()] }, { refs: Array(5).fill(ref()) }, { refs: ['image:../../private'] }]) {
    const r = await f.ctx.execute('open_project_item', bad)
    assert.notEqual(r.status, 'ok')
  }
  for (const bad of [{ ...list, category: 'users' }, { ...list, sql: 'SELECT' }, { category: 'images' }]) {
    assert.equal((await f.ctx.execute('list_project_category', bad)).status, 'invalid')
  }
  assert.equal(f.downloads, 0)
})

test('explicit image and call budgets stop repetitive opens without disabling future turns', async () => {
  const f = fixture()
  for (let i=0; i<8; i++) { assert.equal((await f.ctx.execute('open_project_item', { refs: [ref()] })).status, 'ok'); f.ctx.confirmDelivery() }
  assert.equal((await f.ctx.execute('open_project_item', { refs: [ref()] })).status, 'budget_exhausted')
  assert.equal(f.downloads, 8)
  assert.equal((await f.make().execute('open_project_item', { refs: [ref()] })).status, 'ok')
})

test('signature, byte size and MIME checks reject wrong files; stream limits do not trust headers', async () => {
  assert(validImageSignature(png, 'image/png')); assert(!validImageSignature(png, 'image/jpeg'))
  const f = fixture(); f.transport.download = async () => new Uint8Array(png.length)
  assert.equal((await f.ctx.execute('open_project_item', { refs: [ref()] })).status, 'unavailable')
  const signal = new AbortController().signal
  assert.deepEqual(await readImageResponse(new Response(png), png.length, signal), png)
  await assert.rejects(readImageResponse(new Response(png), 2, signal), /image_too_large/)
  await assert.rejects(readImageResponse(new Response(png), 20, signal), /image_size_changed/)
  await assert.rejects(readImageResponse(new Response(null, { status: 404 }), 20, signal), /unavailable/)
})

test('generic Responses multimodal mapping supports flat/nested URLs and never silently drops unsupported content', () => {
  const r = responseMessageContent('user', [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' } }])
  assert.deepEqual(r, [{ type: 'input_text', text: 'Look' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'high' }])
  assert.deepEqual(responseMessageContent('assistant', 'Answer'), [{ type: 'output_text', text: 'Answer' }])
  assert.throws(() => responseMessageContent('assistant', [{ type: 'image_url', image_url: 'data:invalid' }]))
  assert.throws(() => responseMessageContent('user', [{ type: 'file' } as any]))
})
