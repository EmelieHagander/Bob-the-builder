import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVolunteerMediaHandler } from '../supabase/functions/_shared/volunteer-media-request.ts'

const session = 'a'.repeat(64), mediaId = '93000000-0000-0000-0000-000000000001'
const manifest = { bucket: 'bob-project-media', path: 'project/' + mediaId, contentType: 'image/png', byteSize: 3 }
const request = (body: unknown) => new Request('https://example.test/volunteer-media', { method: 'POST', body: JSON.stringify(body) })
test('volunteer images require a valid capability before bytes are read and never return private details on failure', async () => {
  let downloads = 0
  const handler = createVolunteerMediaHandler({ authorize: async () => null, download: async () => { downloads++; return new Blob(['abc']) } })
  assert.equal((await handler(request({ session, taskId: 'task', mediaId }))).status, 403)
  assert.equal(downloads, 0)
  for (const body of [{}, { session, taskId: 'task', mediaId, path: 'another/project' }, { session: 'bad', taskId: 'task', mediaId }]) {
    const response = await handler(request(body))
    assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /aaaaa|another\/project/)
  }
  assert.equal((await handler(request({ session, taskId: 'x'.repeat(5000), mediaId }))).status, 400)
})
test('image proxy rechecks revocation after download and serves exact bytes without caching or a public URL', async () => {
  let checks = 0
  const revoked = createVolunteerMediaHandler({ authorize: async () => ++checks === 1 ? manifest : null, download: async () => new Blob(['abc']) })
  assert.equal((await revoked(request({ session, taskId: 'task', mediaId }))).status, 403)
  assert.equal(checks, 2)
  const handler = createVolunteerMediaHandler({ authorize: async () => manifest, download: async () => new Blob(['abc']) })
  const result = await handler(request({ session, taskId: 'task', mediaId }))
  assert.equal(result.status, 200); assert.equal(await result.text(), 'abc')
  assert.equal(result.headers.get('content-type'), 'image/png')
  assert.equal(result.headers.get('cache-control'), 'private, no-store')
  assert.equal(result.headers.get('location'), null)
  assert.equal((await handler(new Request('https://example.test/volunteer-media'))).status, 405)
  const wrongSize = createVolunteerMediaHandler({ authorize: async () => manifest, download: async () => new Blob(['wrong']) })
  assert.equal((await wrongSize(request({ session, taskId: 'task', mediaId }))).status, 503)
})

test('drawing images bind both checks to the exact revision and reject incomplete drawing context', async () => {
  const drawingId = '93000000-0000-0000-0000-000000000002', calls: unknown[] = []
  const handler = createVolunteerMediaHandler({
    authorize: async (_session, _task, _media, drawing) => { calls.push(drawing); return calls.length === 1 ? manifest : null },
    download: async () => new Blob(['abc']),
  })
  for (const extra of [{ drawingId }, { revision: 2 }, { drawingId, revision: 0 }, { drawingId, revision: 1.5 }]) {
    assert.equal((await handler(request({ session, taskId: 'task', mediaId, ...extra }))).status, 400)
  }
  assert.equal(calls.length, 0)
  assert.equal((await handler(request({ session, taskId: 'task', mediaId, drawingId, revision: 2 }))).status, 403)
  assert.deepEqual(calls, [{ id: drawingId, revision: 2 }, { id: drawingId, revision: 2 }])
})
