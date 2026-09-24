import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createVolunteers, createVolunteerMediaTransport } from '../src/data/volunteers.ts'
import { createVolunteerMediaHandler } from '../supabase/functions/_shared/volunteer-media-request.ts'
const client = (value: unknown) => value as SupabaseClient<any, any, any>

test('volunteer participation uses only the isolated guest client and never requests Auth or registration', async () => {
  const called: string[] = []
  const api = createVolunteers(client({ rpc: () => { throw new Error('Wrong client') } }), client({
    auth: { getSession: () => { throw new Error('Auth should not be requested') }, signUp: () => { throw new Error('No registration') } },
    rpc: async (name: string) => { called.push(name); return { data: { projectId: 'A', linkId: 'L' }, error: null } },
  }), () => () => { throw new Error('Guest access does not use account context') })
  await api.preview('invite'); await api.join('invite', 'session', 'A', 'Kim', null); await api.state('session', 'A')
  assert.deepEqual(called, ['volunteer_preview', 'volunteer_join', 'volunteer_state'])
})
test('guest replies for another project and absent backends fail explicitly; manager auth changes stop writes', async () => {
  let calls = 0
  const wrong = createVolunteers(null, client({ rpc: async () => ({ data: { projectId: 'B' }, error: null }) }), () => () => {})
  await assert.rejects(wrong.state('secret', 'A'), /project could not be confirmed/)
  const missing = createVolunteers(null, client({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) }), () => () => {})
  await assert.rejects(missing.join('invite', 'secret', 'A', 'Kim', null), /not available.*No change was confirmed/)
  const changed = createVolunteers(client({ auth: { getSession: async () => ({ data: { session: {} }, error: null }) }, rpc: async () => { calls++; return {} } }), null, () => () => { throw new Error('Sign-in changed') })
  await assert.rejects(changed.create('A', 'Crew', 'secret', 30), /Sign-in changed/)
  assert.equal(calls, 0)
})

test('volunteer image transport preserves binary bytes and rechecks the same capability endpoint', async () => {
  const secret = 'a'.repeat(64), mediaId = '80000000-0000-4000-8000-000000000001'
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255, 128, 0])
  let allowed = true, checks = 0
  const handler = createVolunteerMediaHandler({
    authorize: async (session, task, image) => {
      checks++
      assert.equal(session, secret); assert.equal(task, 'T'); assert.equal(image, mediaId)
      return allowed ? { bucket: 'bob-project-media', path: 'A/' + mediaId, contentType: 'image/png', byteSize: bytes.length } : null
    },
    download: async () => new Blob([bytes], { type: 'image/png' }),
  })
  const transport = createVolunteerMediaTransport('https://fixture.invalid/', 'public-anon-key', async (input, init) => {
    assert.equal(String(input), 'https://fixture.invalid/functions/v1/volunteer-media')
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.credentials, 'omit')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer public-anon-key')
    return handler(new Request(input, init))
  })
  const api = createVolunteers(null, client({}), () => () => { throw new Error('No account session') }, transport)
  const blob = await api.image(secret, 'T', mediaId)
  assert.equal(blob.type, 'image/png')
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes, 'Non-UTF8 bytes must never pass through text decoding')
  assert.equal(checks, 2)
  allowed = false
  await assert.rejects(api.image(secret, 'T', mediaId), /access may have changed/)
  const bad = createVolunteers(null, client({}), () => () => {}, async () => new Response('error', { headers: { 'Content-Type': 'text/html' } }))
  await assert.rejects(bad.image(secret, 'T', mediaId), /image could not be loaded/)
})

test('volunteer drawing replies must match the task and exact revision before render', async () => {
  let result = { projectId: 'A', taskId: 'wrong', id: 'D', revision: 1 }
  const api = createVolunteers(null, client({ rpc: async () => ({ data: result, error: null }) }), () => () => {})
  await assert.rejects(api.drawings('secret', 'A', 'T'), /Task could not be confirmed/)
  await assert.rejects(api.drawing('secret', 'A', 'T', 'D', 1), /Drawing could not be confirmed/)
  result = { ...result, taskId: 'T', revision: 2 }
  await assert.rejects(api.drawing('secret', 'A', 'T', 'D', 1), /Drawing could not be confirmed/)
  assert.equal((await api.drawing('secret', 'A', 'T', 'D', 2)).revision, 2)
})
