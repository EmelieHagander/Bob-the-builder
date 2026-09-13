import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateStudWallGeometry,
  lengthToThousandthsOfMm,
  type GeometryMeasurement,
  type StudWallInputs,
} from '../src/lib/artifactGeometry'

const m = (value: string | null, unit = 'mm', truth: GeometryMeasurement['truth'] = 'measured'): GeometryMeasurement => ({
  id: crypto.randomUUID(),
  revision: 1,
  subject: 'fixture',
  value,
  unit,
  truth,
  source: truth === 'estimated' ? 'Rough site estimate' : 'Tape measured',
})

const valid = (overrides: Partial<StudWallInputs> = {}): StudWallInputs => ({
  wall_width: m('4.2', 'm'),
  wall_height: m('2400'),
  opening_left: m('900'),
  opening_sill_height: m('850'),
  opening_width: m('1200'),
  opening_height: m('1200'),
  ...overrides,
})

test('length conversion stays exact to the stored three-decimal precision', () => {
  assert.equal(lengthToThousandthsOfMm('1250.125', 'mm'), 1_250_125)
  assert.equal(lengthToThousandthsOfMm('125.012', 'cm'), 1_250_120)
  assert.equal(lengthToThousandthsOfMm('1.250', 'm'), 1_250_000)
})

test('stud wall generator produces deterministic normalized geometry', () => {
  const result = generateStudWallGeometry(valid(), 600)
  assert.deepEqual({ width: result.wallWidthMm, height: result.wallHeightMm }, { width: 4200, height: 2400 })
  assert.deepEqual({ left: result.openingLeftMm, right: result.openingRightMm, bottom: result.openingBottomMm, top: result.openingTopMm },
    { left: 900, right: 2100, bottom: 850, top: 2050 })
  assert.deepEqual(result.regularStudXsMm, [600, 2400, 3000, 3600])
  assert.deepEqual(result.openingEdgeStudXsMm, [900, 2100])
  assert.equal(result.certainty, 'verified_inputs')
  assert.match(result.warnings[0], /conceptual/i)
})

test('estimated geometry stays explicitly concept-only', () => {
  const result = generateStudWallGeometry(valid({ opening_left: m('895', 'mm', 'estimated') }), 600)
  assert.equal(result.certainty, 'contains_estimate')
})

test('unknown dimensions cannot silently become geometry', () => {
  assert.throws(() => generateStudWallGeometry(valid({ opening_width: m(null, 'mm', 'unknown') }), 600), /opening width is unknown/i)
})

test('opening must fit inside the wall', () => {
  assert.throws(() => generateStudWallGeometry(valid({ opening_left: m('3500'), opening_width: m('1000') }), 600), /fit completely inside/i)
  assert.throws(() => generateStudWallGeometry(valid({ opening_sill_height: m('1500'), opening_height: m('1000') }), 600), /fit completely inside/i)
})

test('stud spacing is explicit and bounded', () => {
  assert.throws(() => generateStudWallGeometry(valid(), 0), /200 to 1200/)
  assert.throws(() => generateStudWallGeometry(valid(), 601.5), /whole number/)
})
