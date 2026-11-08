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
  const long = await tool.execute({ expected_revision: 1, note: { ...note, steps: Array(7).fill('steg'), goal: 7 } })
  assert.equal(long.status, 'invalid'); assert.equal(saved.length, 1)
  assert.deepEqual(long.validation.fields, ['goal: text', 'steps: at most 6 text items'])
  assert.match(long.message, /^Note not saved\. Fix: goal/)
  for (const bad of ['not json', '[1,2]', JSON.stringify({ ...note, extra: 1 })])
    assert.equal((await tool.execute({ expected_revision: 1, note: bad })).status, 'invalid', bad)
  assert.equal((await tool.execute({ expected_revision: -1, note })).status, 'invalid')
})

// Owner runs 2026-11-08: four notes refused for length alone (workpad_note_bounds).
test('long text is shortened and named; missing lists are saved empty; a wrong status, missing goal or too many steps still refuse', async () => {
  const { tool, saved } = store()
  const long = 'Bygg om sängens gavel så att stegen hamnar på rätt sida och kontrollera alla förband '.repeat(8)
  const result = await tool.execute({ expected_revision: 0, note: { status: 'working', goal: long, next_step: long, steps: ['Läs', long] } })
  assert.equal(result.status, 'noted')
  assert.deepEqual(result.normalized.trimmed, ['goal', 'next_step', 'steps.1']); assert.deepEqual(result.normalized.filled_empty, ['blockers', 'references'])
  const [kept] = saved
  assert(kept.goal.length <= 500 && kept.goal.endsWith('…') && long.startsWith(kept.goal.slice(0, -1).trimEnd()))
  assert(kept.next_step.length <= 250 && kept.steps[1].length <= 180 && kept.steps[0] === 'Läs')
  assert.deepEqual([kept.blockers, kept.references], [[], []])
  assert.equal((await tool.execute({ expected_revision: 1, note })).normalized, undefined, 'a note within bounds is saved unchanged')
  for (const bad of [{ ...note, status: 'klar' }, { ...note, goal: undefined }, { ...note, steps: Array(7).fill('steg') }, { ...note, steps: [1] }, { ...note, extra: 1 }])
    assert.equal((await tool.execute({ expected_revision: 2, note: bad })).status, 'invalid', JSON.stringify(bad))
  assert.equal(saved.length, 2)
})
