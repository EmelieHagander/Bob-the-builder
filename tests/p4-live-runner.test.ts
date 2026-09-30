import { test } from 'node:test'
import assert from 'node:assert/strict'
import { p4Config, modelChecks } from '../scripts/check-live-p4.mjs'

const env = { VITE_SUPABASE_URL: 'https://yuobtgoidmmmwfqenkau.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_fixture', BOB_P4_LIVE_CONFIRM: 'disposable-fixtures-only' }

test('P4 preflight refuses unbounded scope, wrong deployment and privileged credentials', () => {
  assert.equal(p4Config(env).group, 'all')
  for (const bad of [{ BOB_P4_LIVE_CONFIRM: undefined }, { VITE_SUPABASE_URL: 'https://other.supabase.co' },
    { VITE_SUPABASE_ANON_KEY: 'sb_secret_fixture' }, { BOB_P4_GROUP: 'production' }]) {
    assert.throws(() => p4Config({ ...env, ...bad }))
  }
})

test('P4 source acceptance cannot pass with absent, foreign or wrong records', () => {
  const answer = { backend: 'openai', projectId: 'A', summary: 'Synthetic result',
    evidence: { sources: [{ projectId: 'A', recordId: 'known' }] } }
  assert(Object.values(modelChecks(answer, 'A', ['known'])).every(Boolean))
  for (const sources of [[], [{ projectId: 'B', recordId: 'known' }], [{ projectId: 'A', recordId: 'another' }]]) {
    assert(Object.values(modelChecks({ ...answer, evidence: { sources } }, 'A', ['known'])).some(value => !value))
  }
  assert.equal(modelChecks(answer, 'A', []).exactSources, false)
  assert.equal(modelChecks({ ...answer, evidence: { ...answer.evidence, writes: [{}] } }, 'A', ['known']).noWrites, false)
})
