import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createBobHandler } from '../supabase/functions/_shared/bob-request.ts'

test('published release marker and authenticated HTTP handler identify the same tool release', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/bob-release.json', import.meta.url), 'utf8'))
  const handler = createBobHandler({ authenticate: async () => null, answer: async () => { throw new Error('must not run') } })
  for (const method of ['POST', 'OPTIONS']) {
    const response = await handler(new Request('https://fixture.invalid', { method }))
    assert.equal(response.headers.get('X-Bob-Release'), manifest.release)
    assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'X-Bob-Release')
    assert.equal(response.status, method === 'POST' ? 401 : 204)
  }
  assert.equal(manifest.knowledge_library, 'planned_not_seeded')
})
