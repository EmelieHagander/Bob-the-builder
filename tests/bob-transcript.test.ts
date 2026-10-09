import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBobTranscript, readDrawingTurnRecovery, reconcileDrawingTurnRecovery, type TranscriptRow } from '../src/data/bobTranscript.ts'
import { readOutgoing, reconcileOutgoing } from '../src/lib/bobOutgoing.ts'

const original = '70291598-05c2-4ea9-b015-441685cbd7c7'
const event = '899a8892-6e8e-452f-ace2-faaa2cf8909c'
const next = '11111111-1111-4111-8111-111111111111'
const thread = '6b91f79d-ed33-4eb7-bd1f-f2738cc24c0a'
const row = (role: string, turn: string, state: string, seq: number): TranscriptRow => ({ role, turn_id: turn, delivery_state: state, seq, text: `${role} ${seq}`, updated_at: new Date().toISOString() })

test('failed shelf instruction stays visible before independently completed drawing events', () => {
  const rows = [row('user', original, 'failed', 1), row('assistant', event, 'completed', 2)]
  const result = readBobTranscript(rows, 'test', new Map())
  assert.deepEqual(result.messages.map(m => m.text), ['user 1', 'assistant 2'])
  assert.equal(result.messages[0].deliveryState, 'failed')
  assert.equal(result.unfinished?.turnId, original)
  assert.equal(result.latestSeq, 2)
})

test('new pending complement is not settled by an unrelated event answer', () => {
  const rows = [row('user', original, 'failed', 1), row('user', next, 'pending', 2), row('assistant', event, 'completed', 3)]
  const result = readBobTranscript(rows, 'test', new Map([[next, 'Delegated']]))
  assert.equal(result.unfinished?.turnId, next)
  assert.equal(result.unfinished?.pending, true)
  assert.equal(result.messages.filter(m => m.from === 'user').length, 2)
  assert.equal(result.messages.filter(m => m.text === 'Delegated').length, 1)
})

test('exact saved recovery settles the real failed bed turn without rewriting historical delivery state', () => {
  const failedTurn = '6aa673cd-5d1f-4f6f-94b5-611d404969cb'
  const completedJob = '75d8631f-44f1-4fda-b1d0-188b2cec2d1c'
  const request = '3bc79294-7c78-4ca0-a97a-0e5dea4f672b'
  const transcript = readBobTranscript([
    { ...row('user', failedTurn, 'failed', 12), text: 'Fortsätt där vi slutade tack :)' },
    { ...row('assistant', completedJob, 'completed', 13), text: 'Ritningen är sparad.' },
  ], 'p_barnrum_vaningssang', new Map())
  assert.equal(transcript.unfinished?.turnId, failedTurn, 'event prose alone never settles an owner turn')
  const recovered = reconcileDrawingTurnRecovery(transcript, failedTurn,
    readDrawingTurnRecovery({ scope: 'drawing', status: 'completed', requestIds: [request] }), true)
  assert.equal(recovered.unfinished, undefined)
  assert.equal(recovered.messages[0].deliveryState, 'failed', 'retain actual old execution history')
  assert.equal(recovered.messages[0].deliveryRecovery, 'completed')
  assert.deepEqual(recovered.messages.map(message => message.text), ['Fortsätt där vi slutade tack :)', 'Ritningen är sparad.'])
})

test('same-origin active drawing recovery uses the event expiry rather than the failed chat lease', () => {
  const now = Date.now(), expiresAt = now + 10 * 60_000
  const transcript = readBobTranscript([{ ...row('user', original, 'failed', 1), updated_at: new Date(now - 60 * 60_000).toISOString() }], 'test', new Map(), now)
  const recovery = readDrawingTurnRecovery({ scope: 'drawing', status: 'running', requestIds: [event], expiresAt: new Date(expiresAt).toISOString(), progress: { stage: 'tool', tool: 'design_project_cad', step: 6, saved: 0 } }, now)
  const active = reconcileDrawingTurnRecovery(transcript, original, recovery)
  assert.equal(active.unfinished?.pending, true)
  assert.equal(active.unfinished?.expiresAt, expiresAt)
  assert.equal(active.messages[0].deliveryRecovery, 'pending')
  assert.equal(active.messages[0].deliveryState, 'failed')
})

test('a recovered old drawing cannot settle a newer owner instruction', () => {
  const transcript = readBobTranscript([row('user', original, 'failed', 1), row('user', next, 'pending', 2), row('assistant', event, 'completed', 3)], 'test', new Map())
  const unrelated = reconcileDrawingTurnRecovery(transcript, original,
    readDrawingTurnRecovery({ scope: 'drawing', status: 'completed', requestIds: [event] }))
  assert.equal(unrelated, transcript)
  assert.equal(unrelated.unfinished?.turnId, next)
  assert.equal(unrelated.messages[0].deliveryRecovery, undefined)
})

test('saved drawing recovery does not declare a non-budget failed mixed instruction finished', () => {
  const transcript = readBobTranscript([row('user', original, 'failed', 1), row('assistant', event, 'completed', 2)], 'test', new Map())
  const recovered = reconcileDrawingTurnRecovery(transcript, original,
    readDrawingTurnRecovery({ scope: 'drawing', status: 'completed', requestIds: [event] }))
  assert.equal(recovered.unfinished?.turnId, original)
  assert.equal(recovered.messages[0].deliveryState, 'failed')
  assert.equal(recovered.messages[0].deliveryRecovery, 'completed', 'only drawing recovery is represented')
})

test('missing, malformed and expired delegation proofs preserve real failure recovery', () => {
  const now = Date.now()
  for (const value of [null, {}, { scope: 'drawing', status: 'completed', requestIds: [] }, { scope: 'drawing', status: 'completed', requestIds: ['bad'] },
    { status: 'failed', requestIds: [event] }, { scope: 'drawing', status: 'running', requestIds: [event] },
    { scope: 'drawing', status: 'queued', requestIds: [event], expiresAt: new Date(now - 1).toISOString() }]) {
    assert.equal(readDrawingTurnRecovery(value, now), undefined)
  }
  const transcript = readBobTranscript([row('user', original, 'failed', 1)], 'test', new Map())
  assert.equal(reconcileDrawingTurnRecovery(transcript, original, undefined), transcript)
})

test('later owner turn supersedes only the old retry action; matching answer completes recovery', () => {
  const rows = [row('user', original, 'failed', 1), row('user', next, 'pending', 2), row('assistant', next, 'completed', 3), row('assistant', event, 'completed', 4)]
  const result = readBobTranscript(rows, 'test', new Map())
  assert.equal(result.unfinished, undefined)
  assert.equal(result.messages.filter(m => m.from === 'user').length, 2)
})

test('409 complement survives old and unrelated pending histories until its own user receipt arrives', () => {
  const outgoing = { text: 'Djupet ska vara 30 cm', turnId: next, threadId: thread, screen: { surface: 'project' as const } }
  const old = readBobTranscript([row('user', original, 'failed', 1), row('assistant', event, 'completed', 2)], 'test', new Map())
  assert.deepEqual(reconcileOutgoing(outgoing, thread, old.messages), outgoing)
  const pending = readBobTranscript([row('user', original, 'pending', 1)], 'test', new Map())
  assert.deepEqual(reconcileOutgoing(outgoing, thread, pending.messages), outgoing)
  const acknowledged = readBobTranscript([row('user', next, 'pending', 3)], 'test', new Map())
  assert.equal(reconcileOutgoing(outgoing, thread, acknowledged.messages), null)
  assert.deepEqual(readOutgoing(JSON.stringify(outgoing)), outgoing)
  assert.equal(reconcileOutgoing(outgoing, event, []), null, 'reset thread never revives the message')
  assert.equal(reconcileOutgoing(outgoing, undefined, []), null)
})

test('malformed tab records are ignored instead of becoming executable retry state', () => {
  for (const value of [null, {}, { text: 'x', turnId: 'bad', threadId: null }, { text: 'x'.repeat(4097), turnId: next, threadId: thread }, { text: 'x', turnId: next, threadId: thread, screen: { surface: 'made_up' } }]) {
    assert.equal(readOutgoing(JSON.stringify(value)), null)
  }
})
