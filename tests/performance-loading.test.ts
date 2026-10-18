import test from 'node:test'
import assert from 'node:assert/strict'
import { createSharedRead } from '../src/lib/sharedRead'
import { createAuthIdentityTracker } from '../src/lib/authIdentity'
import { createSharedPoller } from '../src/lib/sharedPoller'
import { createImagePreviewCache } from '../src/lib/imagePreview'
import { createProjectFiles, clearImagePreviews } from '../src/data/projectFiles'

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('concurrent reads share one call, but failures, settlement and scope changes do not cache authority', async () => {
  const reads = createSharedRead(), held = deferred<number>()
  let calls = 0
  const load = () => { calls++; return held.promise }
  const a = reads.run('owner/project', load), b = reads.run('owner/project', load)
  await flush(); assert.equal(calls, 1)
  reads.clear()
  const c = reads.run('owner/project', async () => 2)
  held.resolve(1)
  assert.deepEqual(await Promise.all([a, b, c]), [1, 1, 2])
  await assert.rejects(reads.run('owner/project', async () => { throw Error('offline') }))
  assert.equal(await reads.run('owner/project', async () => 3), 3)
})

test('same-owner refresh and focus SIGNED_IN keep the drawer; owner changes and sign-out reset it', () => {
  const changed = createAuthIdentityTracker()
  assert.equal(changed('INITIAL_SESSION', null), false)
  assert.equal(changed('SIGNED_IN', 'a'), true)
  for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED']) assert.equal(changed(event, 'a'), false)
  assert.equal(changed('SIGNED_IN', 'b'), true)
  assert.equal(changed('SIGNED_OUT', null), true)
  assert.equal(changed('SIGNED_IN', 'b'), true)
})

test('shell and drawer share one poller, skip hidden tabs, coalesce refreshes and stop after unsubscribe', async t => {
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  Object.assign(globalThis, { window, document })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0, fail = false
  const hold = deferred<number>(), a: number[] = [], b: number[] = []
  const subscribe = createSharedPoller(async () => { calls++; if (fail) throw Error('offline'); return calls === 1 ? hold.promise : calls }, 'changed')
  const offA = subscribe(value => a.push(value)), offB = subscribe(value => b.push(value))
  await flush(); assert.equal(calls, 1)
  window.dispatchEvent(new Event('changed')); window.dispatchEvent(new Event('changed'))
  hold.resolve(1); await flush(); assert.deepEqual(a, [1]); assert.deepEqual(b, [1])
  t.mock.timers.tick(0); await flush(); assert.equal(calls, 2)
  t.mock.timers.tick(10_000); await flush(); assert.equal(calls, 3)
  document.visibilityState = 'hidden'
  t.mock.timers.tick(30_000); await flush(); assert.equal(calls, 3)
  document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'))
  await flush(); assert.equal(calls, 4)
  fail = true; t.mock.timers.tick(10_000); await flush(); assert.deepEqual(a, [1, 2, 3, 4])
  fail = false; t.mock.timers.tick(10_000); await flush(); assert.equal(calls, 6)
  offB(); t.mock.timers.tick(10_000); await flush(); assert.equal(calls, 7)
  assert.deepEqual(b, [1, 2, 3, 4, 6])
  offA(); window.dispatchEvent(new Event('focus')); t.mock.timers.tick(30_000); await flush(); assert.equal(calls, 7)
  t.after(() => { Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'document') })
})

test('preview cache is bounded, expires and rejects late bytes after a scope reset', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const cache = createImagePreviewCache(4, 2, 100)
  let calls = 0
  const load = async () => { calls++; return new Blob(['abc']) }
  await cache.read('a', load); await cache.read('a', load); assert.equal(calls, 1)
  await cache.read('b', load); await cache.read('a', load); assert.equal(calls, 3, 'byte budget evicts a')
  t.mock.timers.setTime(1200); await cache.read('a', load); assert.equal(calls, 4)
  const held = deferred<Blob>(), pending = cache.read('late', () => held.promise)
  cache.clear(); held.resolve(new Blob(['old']))
  await assert.rejects(pending, /context changed/)
  await cache.read('a', load); assert.equal(calls, 5)
})

test('cached preview bytes still require fresh RLS metadata; originals always download again', async t => {
  let metadataReads = 0, downloads = 0, allowed = true
  const blob = new Blob(['preview'], { type: 'image/webp' })
  Object.assign(globalThis, {
    createImageBitmap: async () => ({ width: 1920, height: 1080, close() {} }),
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (done: (blob: Blob) => void) => done(blob) }) },
  })
  const row = { id: 'image', project_id: 'A', bucket_id: 'private', object_path: 'A/image', state: 'ready', media_links: [] }
  const client = {
    from() {
      const query = { select() { return query }, eq() { return query }, async single() {
        metadataReads++; return allowed ? { data: row, error: null } : { data: null, error: { message: 'denied' } }
      } }; return query
    },
    storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob(['original']), error: null } } }) },
  }
  const files = createProjectFiles(client as any, project => () => assert.equal(project, 'A'))
  clearImagePreviews()
  await files.downloadImage('A', 'image', { preview: true })
  await files.downloadImage('A', 'image', { preview: true })
  assert.equal(metadataReads, 2); assert.equal(downloads, 1)
  await files.downloadImage('A', 'image'); assert.equal(downloads, 2)
  allowed = false
  await assert.rejects(files.downloadImage('A', 'image', { preview: true }), /denied/)
  assert.equal(downloads, 2)
  t.after(() => { clearImagePreviews(); Reflect.deleteProperty(globalThis, 'createImageBitmap'); Reflect.deleteProperty(globalThis, 'document') })
})
