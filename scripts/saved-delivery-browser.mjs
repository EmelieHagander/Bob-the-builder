import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

/** Read-only delivery fixtures. No model calls, database writes or stock mutations. */
export function createSavedDeliveryFixture() {
  const fixture = { active: false, source: null, drawing: null, requirement: null, plan: null,
    failIndex: false, failPlan: false, wrongSource: false, empty: false, calls: [],
    async handle(request, url, respond) {
      if (!fixture.active) return false
      const name = url.pathname.split('/').at(-1)
      const reply = async options => { await respond(options); return true }
      if (name === 'read_construction_delivery') {
        const b = request.postDataJSON(); fixture.calls.push(b)
        if (fixture.failIndex) return reply({ status: 503, json: { message: 'Synthetic read interruption' } })
        assert.equal(b.p_project, 'A'); assert.equal(b.p_artifact, fixture.source); assert.equal(b.p_revision, 1)
        let records = fixture.empty ? [] : b.p_resource === 'drawings' ? [{ id: fixture.drawing, revision: 1, current_revision: 2,
          title: b.p_after ? 'Another saved view' : 'Saved panel drawing', archived: false, step_links: [] }]
          : b.p_resource === 'requirements' ? [{ id: fixture.requirement, revision: 1, current_revision: 2, name: 'Panel blank', archived: false }]
          : [{ id: fixture.plan.id, revision: 1, current_revision: 2 }]
        records = records.map(r => ({ ...r, source: { artifact_id: fixture.source, revision: 1 } }))
        const truncated = !fixture.empty && b.p_resource === 'drawings' && !b.p_after
        return reply({ json: { status: 'ok', projectId: 'A', artifact_id: fixture.source, revision: 1, current_revision: 2,
          source_state: 'changed', description: 'Saved panel', resource: b.p_resource, index_only: true,
          records, truncated, next_after: truncated ? fixture.drawing : null } })
      }
      if (name === 'read_material_cut_plan') {
        const b = request.postDataJSON(); fixture.calls.push(b)
        assert.equal(b.p_project, 'A'); assert.equal(b.p_plan, fixture.plan.id); assert.equal(b.p_revision, 1)
        return fixture.failPlan ? reply({ status: 403, json: { message: 'Synthetic source denial' } })
          : reply({ json: { ...fixture.plan, ...(fixture.wrongSource ? { artifact_revision: 9 } : {}) } })
      }
      if (name === 'read_construction_fasteners') return reply({ json: null })
      if (name === 'read_project_work' && request.postDataJSON().p_input.resource === 'cut_plan') {
        return reply({ json: { projectId: 'A', records: [], truncated: false, next_cursor: null } })
      }
      return false
    } }
  return fixture
}

export async function verifySavedDeliveryBrowser(page, base, fixture, artifacts, construction, materialPlanning, width) {
  const source = randomUUID(), drawing = randomUUID(), requirement = randomUUID(), planId = randomUUID()
  const row = { id: source, artifact_id: source, project_id: 'A', area_id: null, revision: 1, title: 'Delivery construction',
    description: 'Saved panel; physical review remains open.', kind: 'detail', status: 'concept', assumptions: 'Synthetic only',
    target_revision: 1, solution_id: randomUUID(), solution_revision: 1, solution_title: 'Panel concept', archived: false,
    actor_label: 'Fixture member', recorded_at: '2026-10-27T12:00:00Z', change_note: 'Saved checkpoint', measurements: [],
    source_media_id: null, source_media_title: '', generator: null, generator_version: null }
  artifacts.records.set(source, row); artifacts.histories.set(source, [structuredClone(row)])
  // This test does not assert 3D. Mark the source as a Construction and let the
  // existing model reader handle its absent geometry until Saved outputs opens.
  construction.sources.set(source + ':1', { status: 'ok', projectId: 'A', artifact_id: source, revision: 1, title: row.title, materials: [] })
  const drawingRow = { ...row, id: drawing, artifact_id: drawing, title: 'Saved panel drawing' }
  artifacts.records.set(drawing, { ...drawingRow, revision: 2 }); artifacts.histories.set(drawing, [drawingRow, { ...drawingRow, revision: 2 }])
  const need = { id: requirement, requirement_id: requirement, project_id: 'A', revision: 1, name: 'Panel blank', category: 'Timber',
    area_id: null, area_title: '', task_id: null, task_title: '', unit: 'pcs', required_quantity: '1', waste_percent: '0',
    required_with_waste: '1', stock_quantity: '0', component_quantity: '0', net_quantity: '1', purchase_increment: '1', purchase_quantity: '1',
    source_kind: 'deterministic', method_key: 'construction_blank_pieces', method_version: 1, basis: '{}', assumptions: 'Fixture only',
    artifact_id: source, artifact_revision: 1, artifact_title: row.title, target_revision: 1, solution_id: row.solution_id,
    solution_revision: 1, solution_title: row.solution_title, archived: false, actor_label: row.actor_label, recorded_at: row.recorded_at, change_note: 'Saved blank' }
  materialPlanning.requirements.set(requirement, { ...need, revision: 2, required_quantity: '9' })
  materialPlanning.requirementHistory.set(requirement, [need, { ...need, revision: 2, required_quantity: '9' }])
  fixture.source = source; fixture.drawing = drawing; fixture.requirement = requirement
  fixture.plan = { id: planId, project_id: 'A', revision: 1, current_revision: 2, artifact_id: source, artifact_revision: 1,
    source_state: 'changed', saved: true, candidates: [{ id: 'saved:sheet', count: 1, length_mm: 400, width_mm: 200, thickness_mm: 18,
      kerf_mm: 3, trim_mm: 5, grain: 'length', note: 'Hypothetical format; stock has not been inspected.' }],
    candidate_sources: [{ candidate_id: 'saved:sheet', kind: 'hypothetical' }], layout: { used_sheets: ['saved:sheet:1'],
      placements: [{ instance_id: 'panel', label: 'P01', sheet_id: 'saved:sheet:1', x_mm: 5, y_mm: 5, length_mm: 200, width_mm: 100, thickness_mm: 18 }],
      cuts: [{ sheet_id: 'saved:sheet:1', axis: 'length', position_mm: 205, span_start_mm: 5, span_end_mm: 195, kerf_mm: 3 }],
      offcuts: [{ sheet_id: 'saved:sheet:1', x_mm: 208, y_mm: 5, length_mm: 187, width_mm: 190 }] } }
  fixture.active = true
  const go = async () => {
    await page.goto(base + `#/artifacts?drawing=${source}&revision=1`)
    await page.getByRole('button', { name: 'Saved outputs', exact: true }).click()
  }
  const outputs = page.getByRole('region', { name: 'Saved construction outputs', exact: true })
  await go()
  await outputs.getByText(/construction or its sources have changed/).waitFor()
  await outputs.getByRole('link', { name: 'Open saved drawing', exact: true }).waitFor()
  await page.screenshot({ path: `test-results/saved-delivery-${width}.png` })
  await outputs.getByRole('button', { name: 'More results', exact: true }).click()
  await outputs.getByRole('heading', { name: 'Another saved view', exact: true }).waitFor()
  assert.equal(fixture.calls.at(-1).p_after, drawing)
  await outputs.getByRole('button', { name: 'Previous results', exact: true }).click()
  await outputs.getByRole('link', { name: 'Open saved drawing', exact: true }).click()
  await page.getByRole('dialog', { name: /Saved panel drawing.*Version 1/ }).waitFor()
  await page.reload(); await page.getByRole('dialog', { name: /Saved panel drawing.*Version 1/ }).waitFor()
  await go(); await outputs.getByRole('button', { name: 'Material needs', exact: true }).click()
  await outputs.getByRole('link', { name: 'Open saved material need', exact: true }).click()
  await page.getByRole('dialog', { name: 'Panel blank · Version 1', exact: true }).waitFor()
  await page.reload(); await page.getByRole('dialog', { name: 'Panel blank · Version 1', exact: true }).waitFor()
  assert.match(page.url(), /requirement=/)
  await go(); await outputs.getByRole('button', { name: 'Cut plans', exact: true }).click()
  await outputs.getByRole('link', { name: 'Open saved cut plan', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Saved cut plan · Version 1', exact: true })
  await dialog.getByRole('region', { name: 'Sheet 1', exact: true }).waitFor()
  await page.reload(); await dialog.getByRole('img', { name: /Saved placement/ }).waitFor()
  await dialog.getByText(/layout is historical and needs review/).waitFor()
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  await close.scrollIntoViewIfNeeded()
  const closeBox = await close.boundingBox()
  assert(closeBox && closeBox.y >= 0 && closeBox.y + closeBox.height <= page.viewportSize().height && closeBox.width >= 44 && closeBox.height >= 44)
  await page.screenshot({ path: `test-results/saved-cut-plan-${width}.png` })
  await dialog.getByText(/Saved cuts/).click(); await dialog.getByRole('cell', { name: '205', exact: true }).waitFor()
  await dialog.getByRole('cell', { name: '205', exact: true }).scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: `test-results/saved-cut-plan-cuts-${width}.png` })
  const savedPlanUrl = page.url()
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
  assert.equal(new URL(page.url().split('#')[1], 'https://fixture.invalid').searchParams.has('cut_plan'), false)
  await page.goto(savedPlanUrl); await dialog.getByRole('img').waitFor()
  fixture.failPlan = true; await page.reload(); await dialog.getByRole('alert').waitFor()
  assert.equal(await dialog.getByRole('img').count(), 0)
  fixture.failPlan = false; await dialog.getByRole('button', { name: 'Retry', exact: true }).click(); await dialog.getByRole('img').waitFor()
  fixture.wrongSource = true; await page.reload(); await dialog.getByRole('alert').waitFor()
  assert.equal(await dialog.getByRole('img').count(), 0); fixture.wrongSource = false
  await page.goto(base + `#/build-lists?cut_plan=${planId}&revision=0`)
  await page.getByRole('dialog', { name: 'Cut plan unavailable', exact: true }).waitFor()
  fixture.failIndex = true; await go(); await outputs.getByRole('alert').waitFor()
  assert.equal(await outputs.getByRole('link').count(), 0)
  fixture.failIndex = false; fixture.empty = true
  await outputs.getByRole('button', { name: 'Retry', exact: true }).click(); await outputs.getByText(/No drawings saved/).waitFor()
  await page.screenshot({ path: `test-results/saved-delivery-empty-${width}.png` })
  await page.goto(base + '#/project')
  fixture.active = false; fixture.empty = false
  for (const id of [source, drawing]) { artifacts.records.delete(id); artifacts.histories.delete(id) }
  construction.sources.delete(source + ':1'); materialPlanning.requirements.delete(requirement); materialPlanning.requirementHistory.delete(requirement)
  assert.equal(materialPlanning.materials.size, 0, 'reading never publishes purchases')
  console.log(`Saved delivery: exact drawing/need/cut-plan navigation and reload, source binding, paging, denial/retry, historical/empty states at ${width}px; HTTP fixtures only.`)
}
