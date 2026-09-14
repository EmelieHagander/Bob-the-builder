import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readVolunteerSession, saveVolunteerSession, forgetVolunteerSession } from '../src/lib/volunteerSession.ts'

test('volunteer browser persistence stores only the separate credential and cannot carry profile or allergy fields', () => {
  const stored = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } })
  try {
    const invite = 'a'.repeat(64), other = 'b'.repeat(64), secret = 'c'.repeat(64)
    const accidentalExtraFields = { secret, joined: true, name: 'Kim', allergies: 'Peanuts' }
    assert.equal(saveVolunteerSession(invite, accidentalExtraFields), true)
    assert.deepEqual(readVolunteerSession(invite), { secret, joined: true })
    assert.equal(readVolunteerSession(other), null)
    assert.doesNotMatch([...stored.values()].join(''), /Kim|Peanuts|name|allergies/)
    assert.equal(saveVolunteerSession(invite, { secret: 'not a credential', joined: true }), false)
    forgetVolunteerSession(invite)
    assert.equal(readVolunteerSession(invite), null)
    stored.set('bob:volunteer:' + invite, '{corrupt')
    assert.equal(readVolunteerSession(invite), null)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
