import test from 'node:test'
import assert from 'node:assert/strict'
import { countBoards, countSheets, profileLength } from '../src/domain/stockCount.ts'

// Owner design 2026-11-08: the size seen in the shop gives the count; code only counts.
test('boards: longest first, kerf between parts and a margin at both ends', () => {
  const pieces = [{ label: 'A', length: 1540 }, { label: 'B', length: 1540 }, { label: 'C', length: 1200 }, { label: 'D', length: 900 }]
  const result = countBoards(pieces, 3600, 3, 10)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  // Usable 3580: A+B = 3083; C+D = 2103 → 2 boards.
  assert.deepEqual(result.boards.map(b => b.pieces.map(p => p.label)), [['A', 'B'], ['C', 'D']])
  assert.equal(result.boards[0].offcut, 3580 - 3083)
  // Usable 1980: no two parts share a board.
  const short = countBoards(pieces, 2000, 3, 10)
  assert.equal(short.status === 'ok' && short.boards.length, 4)
})

test('boards: a part longer than the usable board is named, never split', () => {
  const result = countBoards([{ label: 'Post', length: 2990 }], 3000, 3, 10)
  assert.deepEqual(result, { status: 'too_long', labels: ['Post'], usable: 2980 })
  assert.equal(countBoards([], 0, 3, 10).status, 'invalid')
})

test('a board part\'s length is the axis left after thickness and width', () => {
  assert.equal(profileLength({ x: 45, y: 60, z: 70 }, 45, 70), 60)
  assert.equal(profileLength({ x: 1540, y: 45, z: 70 }, 45, 70), 1540)
  assert.equal(profileLength({ x: 21, y: 45, z: 800 }, null, null), 800)
})

test('sheets: counts whole sheets with the guillotine check', () => {
  const parts = [{ definitionId: 'd1', label: 'Back', quantity: 2, dimensions: { x: 1200, y: 800, z: 15 } }]
  const result = countSheets(parts, { id: 'm', revision: 1, thickness: 15 }, { length: 2440, width: 1220 }, 3, 10)
  assert.equal(result.status, 'ok')
  if (result.status === 'ok') { assert.equal(result.sheets, 1); assert.equal(result.placements.length, 2) }
  const three = countSheets([{ ...parts[0], quantity: 3, dimensions: { x: 2000, y: 1100, z: 15 } }], { id: 'm', revision: 1, thickness: 15 }, { length: 2440, width: 1220 }, 3, 10)
  assert.equal(three.status === 'ok' && three.sheets, 3)
})
