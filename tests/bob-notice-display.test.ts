import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerDisplay } from '../src/lib/bobNotice.ts'
import type { AnswerEvidence, ProjectWriteReceipt } from '../src/data/provenance.ts'

const evidence = (e: Partial<AnswerEvidence>): AnswerEvidence => ({ kind: 'ai_assessment', sources: [], partial: true, ...e })
const write: ProjectWriteReceipt = { projectId: 'p', dataset: 'media', recordId: 'm', label: 'Mockup v5', operation: 'updated', savedAt: '2026-11-06T22:00:00Z' }

test('a notice-only answer becomes the hammer line; nothing saved says so', () => {
  const text = '⚠\n○ Drawing'
  assert.deepEqual(answerDisplay(text, evidence({ writes: [], notices: [{ kind: 'failed', code: 'recovered', text }] })),
    { text: '', line: 'Bob dropped the hammer, nothing was done this turn.' })
})

test('saved changes are named instead of claiming nothing was done', () => {
  const text = 'Endast de listade sparade ändringarna är verifierade.\n\nVerifierade sparade ändringar\n• Mockup v5'
  assert.deepEqual(answerDisplay(text, evidence({ writes: [write], notices: [{ kind: 'failed', code: 'recovered', text }] })),
    { text: '', line: 'Bob dropped the hammer. Only this was saved: Mockup v5.' })
})

test('Bob\'s own words stay; an appended uncertain or sync notice is removed', () => {
  const note = 'Vissa ändringar kunde inte verifieras.'
  const uncertain = answerDisplay(`Klart.\n\n${note}`, evidence({ writes: [write], notices: [{ kind: 'uncertain', code: 'uncertain', text: note }] }))
  assert.equal(uncertain.text, 'Klart.'); assert.match(uncertain.line!, /^Bob dropped the hammer\. Saved: Mockup v5\. .*check before asking again\.$/)
  const sync = answerDisplay(`Klart.\n\n${note}`, evidence({ notices: [{ kind: 'info', code: 'chat_unsynced', text: note }] }))
  assert.deepEqual(sync, { text: 'Klart.', line: null })
})

test('a stopped drawing keeps what the owner still needs to supply', () => {
  const text = 'Ritningen är inte klar.'
  const shown = answerDisplay(text, evidence({ notices: [{ kind: 'failed', code: 'drawing_prerequisite', text, missing: ['Choose the depth.'] }] }))
  assert.equal(shown.line, 'Bob dropped the hammer, nothing was done this turn. Still needed: Choose the depth.')
})

test('unmarked answers are shown unchanged', () => {
  assert.deepEqual(answerDisplay('Hej', evidence({})), { text: 'Hej', line: null })
})
