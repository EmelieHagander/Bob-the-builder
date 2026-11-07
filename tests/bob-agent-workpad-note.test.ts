import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workpadTool, type AgentWorkpads, type WorkpadNote } from '../supabase/functions/_shared/bob-agent-workpad.ts'

// Bed, 2026-11-07 09:01–09:02: Konrad sent his plan note as JSON text four
// times in a row; each was refused with a message that did not say why, and
// the plan gate kept every construction write closed.
const note: WorkpadNote = { status: 'working', goal: 'Frontlister i bokfacken', next_step: 'Läs delarna', steps: ['Läs', 'Planera', 'Spara'], blockers: [], references: [] }
const store = () => { const saved: WorkpadNote[] = []
  const pads: AgentWorkpads = { load: async () => ({ status: 'ok', revision: 0, note: null }), update: async (_a, r, n) => { saved.push(n); return { status: 'noted', revision: r + 1 } } }
  return { tool: workpadTool(pads, 'structure'), saved } }

test('a note sent as JSON text is the same note; a broken note says which bound it broke', async () => {
  const { tool, saved } = store()
  assert.equal((await tool.execute({ expected_revision: 0, note: JSON.stringify(note) })).status, 'noted')
  assert.deepEqual(saved, [note])
  const long = await tool.execute({ expected_revision: 1, note: { ...note, steps: Array(7).fill('steg'), goal: 'x'.repeat(501) } })
  assert.equal(long.status, 'invalid'); assert.equal(saved.length, 1)
  assert.deepEqual(long.validation.fields, ['goal: text, at most 500 characters', 'steps: at most 6 items of at most 180 characters'])
  assert.match(long.message, /^Note not saved\. Fix: goal/)
  for (const bad of ['not json', '[1,2]', JSON.stringify({ ...note, extra: 1 })])
    assert.equal((await tool.execute({ expected_revision: 1, note: bad })).status, 'invalid', bad)
  assert.equal((await tool.execute({ expected_revision: -1, note })).status, 'invalid')
})
