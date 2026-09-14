import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createVolunteers } from '../src/data/volunteers.ts'
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
