import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSharing } from '../src/data/sharing.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const session = { data: { session: { user: { id: 'fixture-user' } } }, error: null }
const unchanged = () => () => {}
const noChange = () => {}

test('a sign-in or project change during session resolution stops the write before RPC', async () => {
  const pending = deferred<typeof session>()
  let epoch = 0, calls = 0
  const client = { auth: { getSession: () => pending.promise }, rpc: () => { calls++; throw new Error('must not send') } }
  const sharing = createSharing(client as unknown as SupabaseClient<any, any, any>, () => {
    const started = epoch
    return () => { if (started !== epoch) throw new Error('context changed') }
  }, noChange)
  const result = sharing.inviteFriend('project-A', 'friend')
  epoch++
  pending.resolve(session)
  await assert.rejects(result, /context changed/)
  assert.equal(calls, 0)
})

test('an old sharing response is discarded after switching away and back', async () => {
  const pending = deferred<{ data: unknown; error: null }>()
  let epoch = 0
  const client = { auth: { getSession: async () => session }, rpc: () => pending.promise }
  const sharing = createSharing(client as unknown as SupabaseClient<any, any, any>, () => {
    const started = epoch
    return () => { if (started !== epoch) throw new Error('context changed') }
  }, noChange)
  const result = sharing.project('project-A')
  await Promise.resolve()
  epoch += 2
  pending.resolve({ data: { projectId: 'project-A' }, error: null })
  await assert.rejects(result, /context changed/)
})

test('a response for another project or building cannot confirm sharing', async () => {
  const client = { auth: { getSession: async () => session }, rpc: async () => ({ data: { projectId: 'B', buildingId: 'building-B' }, error: null }) }
  const sharing = createSharing(client as unknown as SupabaseClient<any, any, any>, unchanged, noChange)
  await assert.rejects(sharing.project('A'), /context changed/)
  await assert.rejects(sharing.saveBuilding({ buildingId: 'building-A', householdId: 'household', expected: 0, projectIds: [] }), /could not be confirmed/)
})

test('absent auth and uninstalled backend are explicit failures, never fake success', async () => {
  await assert.rejects(createSharing(null, unchanged, noChange).directory(), /Demo data is not shared/)
  let calls = 0
  const signedOut = { auth: { getSession: async () => ({ data: { session: null }, error: null }) }, rpc: () => { calls++ } }
  await assert.rejects(createSharing(signedOut as unknown as SupabaseClient<any, any, any>, unchanged, noChange).directory(), /Sign in/)
  assert.equal(calls, 0)
  const missing = { auth: { getSession: async () => session }, rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }) }
  await assert.rejects(createSharing(missing as unknown as SupabaseClient<any, any, any>, unchanged, noChange).directory(), /No sharing change was confirmed/)
})
