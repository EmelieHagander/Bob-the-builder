import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasCurrentScopeDrawing, nextProjectPlanningAction, type ProjectPlanningSnapshot } from '../src/domain/projectPlanningAction.ts'

const names = new Map([['a_bed', 'Våningssäng']])
function base(): ProjectPlanningSnapshot {
  return { missing: [], targets: [], constructions: [], artifacts: [] }
}

test('area target and saved construction take priority without a project-level target', () => {
  const value = base()
  value.targets.push({ areaId: 'a_bed', revision: 15, solutionId: 's1', solutionRevision: 6 })
  value.constructions.push({ id: 'c1', title: 'Kärnkonstruktion', areaId: 'a_bed', revision: 20, recordedAt: '2026-10-22' })
  const action = nextProjectPlanningAction(value, names)
  assert.equal(action.to, '/build-lists?area=a_bed&construction=c1')
  assert.match(action.title, /kaplista/)
  assert.match(action.text, /v20/)
})

test('required missing measurements are actionable, optional unknowns do not block', () => {
  const value = base()
  value.missing.push({ subject: 'Optional cosmetic detail', areaId: null, required: false })
  assert.equal(nextProjectPlanningAction(value, names).to, '/solutions')
  value.missing.push({ subject: 'Room height', areaId: 'a_bed', required: true })
  assert.equal(nextProjectPlanningAction(value, names).to, '/facts?kind=measurement&status=missing')
})

test('area-scoped target must match current drawing for its own area and revision', () => {
  const value = base()
  value.targets.push({ areaId: 'a_bed', revision: 15, solutionId: 's1', solutionRevision: 6 })
  value.artifacts.push({
    id: 'd1', areaId: null, targetRevision: 15, solutionId: 's1', solutionRevision: 6, archived: false, sourceStatus: { source_state: 'current' },
  })
  assert.equal(hasCurrentScopeDrawing(value), false)
  assert.equal(nextProjectPlanningAction(value, names).to, '/artifacts?area=a_bed')
  value.artifacts[0].areaId = 'a_bed'
  assert.equal(hasCurrentScopeDrawing(value), true)
  value.artifacts[0].solutionRevision = 5
  assert.equal(hasCurrentScopeDrawing(value), false, 'Revision-mismatched drawing is not current')
  value.artifacts[0].solutionRevision = 6
  value.artifacts[0].sourceStatus = { source_state: 'changed' }
  assert.equal(hasCurrentScopeDrawing(value), false)
})

test('construction source cannot masquerade as a rendered drawing, even when its source is current', () => {
  const value = base()
  value.targets.push({ areaId: 'a_bed', revision: 15, solutionId: 's1', solutionRevision: 6 })
  value.constructions.push({ id: 'c1', title: 'Source', areaId: 'a_bed', revision: 4, recordedAt: '2026-10-22' })
  value.artifacts.push({
    id: 'c1', areaId: 'a_bed', targetRevision: 15, solutionId: 's1', solutionRevision: 6, archived: false, sourceStatus: { source_state: 'current' },
  })
  assert.equal(hasCurrentScopeDrawing(value), false)
  assert.equal(nextProjectPlanningAction(value, names).to, '/build-lists?area=a_bed&construction=c1')
})
