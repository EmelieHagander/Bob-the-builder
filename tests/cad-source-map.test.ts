import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import React, { createElement } from 'react'
import { CadSourceMap } from '../src/components/CadSourceMap.tsx'
import { CadDrawingView } from '../src/components/CadDrawingView.tsx'
import { readCadSourceMap, cadSourceIdentity } from '../src/lib/cadSourceMap.ts'
import { compileCadParameters, type ParameterPlan } from '../supabase/functions/_shared/cad-parameters.ts'
import { buildCadLineage } from '../supabase/functions/_shared/cad-lineage.ts'
import type { CadAssemblyRequest } from '../supabase/functions/_shared/cad-adapter.ts'

// tsx uses the repository root tsconfig; the frontend project uses react-jsx.
Object.assign(globalThis, { React })

const projectId = '90000000-0000-4000-8000-000000000001'
const measurement = '90000000-0000-4000-8000-000000000002'
const specification = '90000000-0000-4000-8000-000000000003'
export function fixture(contextProject = projectId) {
  const recipe: CadAssemblyRequest = { contract_version: 1, units: 'mm', assembly_id: 'source-test',
    definitions: [{ id: 'panel', primitive: 'box', material_ref: null, x_mm: 980, y_mm: 18, z_mm: 300 }],
    instances: [{ id: 'panel', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front'] }
  const plan: ParameterPlan = { version: 1, frames: [], nodes: [
    { id: 'width', role: 'source', source: { kind: 'project_measurement', id: measurement, revision: 2 } },
    { id: 'thickness', role: 'source', source: { kind: 'project_measurement', id: specification, revision: 3 } },
    { id: 'allowance', role: 'estimate', value: 20, unit: 'mm', reason: 'Estimated fit allowance, verify on site' },
    { id: 'inside', role: 'derived', operation: 'subtract_v1', operands: ['width', 'allowance'], rounding: 'exact' },
    { id: 'height', role: 'decision', value: 300, unit: 'mm', reason: 'Chosen height for concept' },
    { id: 'zero', role: 'decision', value: 0, unit: 'mm', reason: 'Local assembly datum' },
    { id: 'angle', role: 'decision', value: 0, unit: 'deg', reason: 'Local assembly axes' },
  ], bindings: [
    { path: 'definitions/panel/x_mm', node: 'inside' }, { path: 'definitions/panel/y_mm', node: 'thickness' }, { path: 'definitions/panel/z_mm', node: 'height' },
    ...['x', 'y', 'z', 'rx', 'ry', 'rz'].map(key => ({ path: `instances/panel/placement/${key}`, node: key.startsWith('r') ? 'angle' : 'zero' })),
  ] }
  const sources = new Map([
    [measurement, { id: measurement, project_id: contextProject, revision: 2, value: '1', unit: 'm', truth: 'measured', source: 'Tape between marked endpoints' }],
    [specification, { id: specification, project_id: contextProject, revision: 3, value: '18', unit: 'mm', truth: 'provided_spec', source: 'Supplier thickness specification' }],
  ])
  return { recipe, plan, sources }
}

test('source map preserves original units, source IDs/revisions, formula inputs and truth classes', () => {
  const { recipe, plan, sources } = fixture()
  const parameters = compileCadParameters(projectId, recipe, plan, sources, new Map())
  const map = readCadSourceMap(recipe, { bob_parameters: parameters }, projectId)
  assert.equal(map.state, 'complete')
  assert.deepEqual(map.rows.map(row => row.category), ['Measured', 'Estimate', 'Calculation', 'Provided specification', 'Design choice', 'Design choice', 'Design choice'])
  const width = map.rows.find(row => row.id === 'width')!
  assert.equal(width.sources[0].value, '1'); assert.equal(width.sources[0].unit, 'm')
  assert.equal(width.value, 1000); assert.match(cadSourceIdentity(width.sources[0]), /revision 2/)
  assert.deepEqual(map.rows.find(row => row.id === 'inside')!.operands, ['width', 'allowance'])
  assert.equal(map.rows.find(row => row.id === 'inside')!.category, 'Calculation', 'An estimate-dependent calculation must never be shown as measured')
})

test('unknown orientation remains unknown and exact image version is retained', () => {
  const { recipe, plan, sources } = fixture()
  const source = 'image:90000000-0000-4000-8000-000000000004'
  plan.frames = [{ id: 'photo', kind: 'image', source_ref: source, required: false, reason: 'Photo direction not established', placement: null }]
  const parameters = compileCadParameters(projectId, recipe, plan, sources, new Map(), new Map([[source, 'sha256:' + 'a'.repeat(64)]]))
  const map = readCadSourceMap(recipe, { bob_parameters: parameters }, projectId)
  assert.equal(map.frames[0].axes, null); assert.equal(map.frames[0].placement, null)
  assert.equal(map.frames[0].source_version, 'sha256:' + 'a'.repeat(64))
})

for (const [name, mutate] of [
  ['wrong project', (parameters: any) => { parameters.project_id = specification }],
  ['missing binding', (parameters: any) => { parameters.bindings.pop() }],
  ['tampered derived value', (parameters: any) => { parameters.nodes.find((node: any) => node.id === 'inside').normalized.value = 981 }],
  ['unknown promoted to zero', (parameters: any) => { parameters.nodes.find((node: any) => node.id === 'zero').role = 'unknown' }],
  ['duplicate source ID', (parameters: any) => { parameters.nodes.push(parameters.nodes[0]) }],
  ['truth upgrade', (parameters: any) => { parameters.nodes.find((node: any) => node.id === 'width').sources[0].truth = 'verified' }],
] as const) test(`source map rejects ${name} without falling back to legacy`, () => {
  const { recipe, plan, sources } = fixture(), parameters = compileCadParameters(projectId, recipe, plan, sources, new Map())
  mutate(parameters)
  assert.equal(readCadSourceMap(recipe, { bob_parameters: parameters }, projectId).state, 'invalid')
})

test('partial lineage labels untracked decisions and placements as unknown', () => {
  const { recipe, sources } = fixture()
  recipe.definitions[0].x_mm = 1000
  const lineage = buildCadLineage(projectId, recipe, [{ definition_id: 'panel', dimension: 'x_mm', measurement_id: measurement, revision: 2 }], sources, { origin: null, positive_x: null, positive_y: null, positive_z: null })
  const map = readCadSourceMap(recipe, { bob_lineage: lineage }, projectId)
  assert.equal(map.state, 'partial'); assert.equal(map.rows[0].category, 'Measured')
  assert(map.rows.slice(1).every(row => row.category === 'Unknown'))
  assert.equal(readCadSourceMap(recipe, {}, projectId).state, 'legacy_untracked')
  assert.equal(readCadSourceMap(recipe, { bob_lineage: null }, projectId).state, 'invalid')
  assert.equal(readCadSourceMap(recipe, { bob_parameters: null, bob_lineage: lineage }, projectId).state, 'invalid')
  assert.equal(readCadSourceMap(recipe, {}, undefined).state, 'unavailable')
})

test('rendered source map explains partial coverage, uncertainty and escaped evidence', () => {
  const { recipe, plan, sources } = fixture()
  sources.get(measurement)!.source = '<script>bad()</script>'
  const manifest = { bob_parameters: compileCadParameters(projectId, recipe, plan, sources, new Map()) }
  const html = renderToStaticMarkup(createElement(CadSourceMap, { recipe, manifest, projectId, sourceStatus: { source_state: 'changed', source_reasons: ['measurements_changed'] } }))
  assert(html.includes('not construction approval')); assert(html.includes('Design choice')); assert(html.includes('Provided specification'))
  assert(html.includes('Exact changed source identities are unavailable'))
  assert(!html.includes('<script>')); assert(html.includes('&lt;script&gt;'))
})

test('authorised source delta shows exact affected IDs while retaining the saved values', () => {
  const { recipe, plan, sources } = fixture()
  const manifest = { bob_parameters: compileCadParameters(projectId, recipe, plan, sources, new Map()) }
  const html = renderToStaticMarkup(createElement(CadSourceMap, { recipe, manifest, projectId, sourceStatus: {
    source_state: 'changed', source_reasons: ['measurements_changed'], changes: [{ kind: 'project_measurement', id: measurement,
      saved_revision: 2, current_revision: 5, parameter_ids: ['width', 'inside'], state: 'changed' }], changesTruncated: true,
  } }))
  assert(html.includes(`>${measurement}</p>`))
  assert(html.includes('Saved revision: 2 · current revision: 5'))
  assert(html.includes('Affected parameter IDs: width, inside'))
  assert(html.includes('Saved value: 980 mm')); assert(html.includes('Original value: 1 m'))
  assert(html.includes('Only part of the source change list'))
  assert(!html.includes('Exact changed source identities are unavailable'))
  assert.equal(recipe.definitions[0].x_mm, 980, 'Reading change status must never regenerate old geometry')
})

test('revoked source delta exposes no hidden identity and describes current state as unavailable', () => {
  const { recipe, plan, sources } = fixture()
  const manifest = { bob_parameters: compileCadParameters(projectId, recipe, plan, sources, new Map()) }
  const html = renderToStaticMarkup(createElement(CadDrawingView, { value: { recipe, manifest, files: { front: 'SECRET_SVG', step: 'SECRET_STEP' } }, title: 'Drawing', projectId, sourceStatus: {
    source_state: 'unavailable', source_reasons: ['physical_source_unavailable'], changes: [{ kind: 'space_measurement', id: null,
      parameter_ids: [], state: 'unavailable' }],
  } }))
  assert(html.includes('Source identity unavailable with current access'))
  assert(html.includes('Space measurement</strong> · Unavailable'))
  assert(!html.includes(measurement)); assert(!html.includes('current revision: 0'))
  assert(!html.includes('SECRET_')); assert(!html.includes('Tape between marked endpoints'))
  assert(!html.includes('Download 3D model')); assert(!html.includes('Saved value'))
})

test('complete graph cannot hide malformed retained lineage', () => {
  const { recipe, plan, sources } = fixture()
  const manifest = { bob_parameters: compileCadParameters(projectId, recipe, plan, sources, new Map()), bob_lineage: { coverage: 'complete' } }
  assert.equal(readCadSourceMap(recipe, manifest, projectId).state, 'invalid')
})
