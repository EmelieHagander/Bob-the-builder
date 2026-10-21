import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { CAD_VIEW_NAMES, CAD_MAX_VIEWS } from '../supabase/functions/_shared/cad-adapter.ts'
import { parseDesignHandoff } from '../supabase/functions/_shared/cad-review.ts'
import { handoff } from './support/cad-review-fixture.ts'

// 20261021180000: a saved drawing request can be redrawn from other sides.
test('design_project_cad offers a nullable views list, required for strict calls', () => {
  const tool: any = catalogFixture().tool('design_project_cad')
  const parameters = tool.function?.parameters ?? tool.parameters
  const views = parameters.properties.views
  assert.deepEqual(views.type, ['array', 'null'])
  assert.deepEqual(views.items.enum, [...CAD_VIEW_NAMES])
  assert.equal(views.maxItems, CAD_MAX_VIEWS)
  assert.match(views.description, /Null keeps the views saved/)
  assert(parameters.required.includes('views'))
})

test('a stored handoff may carry up to six views', () => {
  const six = ['front', 'back', 'left', 'right', 'top', 'isometric_back_left']
  assert.deepEqual(parseDesignHandoff({ ...structuredClone(handoff), views: six })?.views, six)
  assert.equal(parseDesignHandoff({ ...structuredClone(handoff), views: [...six, 'bottom'] }), null)
})
