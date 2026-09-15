// Browser HTTP fixtures only. Actual arithmetic, authority and revision rules are
// exercised separately against the real SQL migrations in sheet-layers.test.ts.
import assert from 'node:assert/strict'

export function installSheetLayerFixture(fixture, timestamp, solutions) {
  const previous = fixture.handle.bind(fixture)
  fixture.sheetProof = { conflictOnce: false, missingRecipe: false }
  fixture.handle = async (request, url, respond) => {
    const table = url.pathname.split('/').at(-1)
    const isMaterialCommand = url.pathname === '/rest/v1/rpc/material_requirement_geometry_command'
      || url.pathname === '/rest/v1/rpc/material_requirement_command'
    const body = isMaterialCommand && request.method() === 'POST' ? request.postDataJSON() : null
    if (table === 'material_requirement_geometry_command' && body?.p_data?.sheet_layer) {
      const { p_project, p_action, p_requirement: id, p_expected, p_data: data } = body
      const fail = async message => { await respond({ status: 409, json: { message } }); return true }
      assert.equal(p_project, 'A')
      assert.equal(data.area_id, 'areaA')
      for (const field of ['required_quantity', 'unit', 'basis', 'purchase_increment', 'source_kind', 'method_key', 'method_version']) {
        assert(!(field in data), 'The UI must not supply derived field ' + field)
      }
      const old = fixture.requirements.get(id)
      if (fixture.sheetProof.conflictOnce) { fixture.sheetProof.conflictOnce = false; return fail('Material requirement changed. Reload before saving again.') }
      if (p_action === 'revise' && old?.revision !== p_expected) return fail('Material requirement changed. Reload before saving again.')
      const artifact = fixture.artifacts.records.get(data.artifact_id)
      assert(artifact && artifact.revision === data.artifact_revision && artifact.area_id === data.area_id)
      const recipe = fixture.artifacts.generations.get(`${artifact.id}:${artifact.revision}`)
      const roles = Object.fromEntries(recipe.inputs.map(item => [item.role, item]))
      const mm = role => Number(roles[role].value) * ({ mm: 1, cm: 10, m: 1000 }[roles[role].unit])
      const area = (mm('wall_width') * mm('wall_height') - mm('opening_width') * mm('opening_height')) / 1000000
      assert.equal(area, 8.628, 'This UI fixture uses the already-proved drawing inputs')
      const layer = data.sheet_layer
      assert(layer.coverage_source && ['provided_spec', 'measured', 'estimated'].includes(layer.coverage_truth))
      const layers = Number(layer.layer_count)
      assert([1, 2].includes(layers))
      const coverage = layer.coverage_kind === 'sheet_dimensions'
        ? Number(layer.sheet_width_mm) * Number(layer.sheet_height_mm) / 1000000 : Number(layer.pack_coverage_m2)
      assert([2.88, 4.314].includes(coverage), 'Use one of the explicit browser scenarios')
      const stock = (data.stock_allocations ?? []).map(ref => {
        const item = fixture.stocks.get(ref.id)
        assert(item && item.unit === 'm2' && item.revision === ref.revision && item.status === 'available')
        return { id: item.id, revision: item.revision, quantity: String(ref.quantity) }
      })
      const stockQuantity = stock.reduce((total, ref) => total + Number(ref.quantity), 0)
      // Integer fixture quantities avoid floating-point presentation drift. The
      // production browser never owns this calculation: it reads the SQL result.
      const requiredUnits = Math.round(area * layers * 10000)
      const withWasteUnits = Math.round(requiredUnits * (1 + Number(data.waste_percent) / 100))
      const coverageUnits = Math.round(coverage * 10000)
      const purchaseUnits = Math.ceil(Math.max(withWasteUnits - Math.round(stockQuantity * 10000), 0) / coverageUnits) * coverageUnits
      const decisions = [...solutions.decisions].reverse().filter(item => item.project_id === p_project)
      const target = decisions.find(item => item.area_id === data.area_id) ?? decisions.find(item => item.area_id == null)
      assert.equal(target.revision, data.target_revision)
      const selected = solutions.histories.get(target.solution_id).find(item => item.revision === target.solution_revision)
      const revision = (old?.revision ?? 0) + 1
      const snapshot = {
        layer_count: layers, coverage_kind: layer.coverage_kind, coverage_truth: layer.coverage_truth, coverage_source: layer.coverage_source,
        sheet_width_mm: layer.coverage_kind === 'sheet_dimensions' ? layer.sheet_width_mm : null,
        sheet_height_mm: layer.coverage_kind === 'sheet_dimensions' ? layer.sheet_height_mm : null,
        pack_coverage_m2: layer.coverage_kind === 'pack_coverage' ? layer.pack_coverage_m2 : null,
        unit_coverage_m2: String(coverage), net_wall_area_m2: String(area),
      }
      const row = {
        id, requirement_id: id, project_id: p_project, revision, name: data.name, category: data.category,
        area_id: data.area_id, area_title: 'Entry', task_id: data.task_id, task_title: data.task_id ? 'Prepare opening' : '',
        unit: 'm2', required_quantity: String(requiredUnits / 10000), waste_percent: data.waste_percent, purchase_increment: String(coverage),
        required_with_waste: String(withWasteUnits / 10000), stock_quantity: String(stockQuantity), component_quantity: '0', purchase_quantity: String(purchaseUnits / 10000),
        source_kind: 'deterministic', method_key: 'stud_wall_sheet_layer', method_version: '1', sheet_layer: snapshot,
        basis: `Drawing ${artifact.title} v${artifact.revision}; ${area} m² × ${layers} layers. AREA-BASED ONLY: not a cut/layout plan. ${layer.coverage_truth === 'estimated' ? 'Contains explicit estimate.' : 'Measured/provided inputs only.'}`,
        assumptions: data.assumptions, artifact_id: artifact.id, artifact_revision: artifact.revision, artifact_title: artifact.title,
        target_revision: target.revision, solution_id: target.solution_id, solution_revision: target.solution_revision, solution_title: selected.title,
        archived: false, change_note: p_action === 'create' ? 'Initial material requirement' : data.change_note, actor_label: 'Fixture member', recorded_at: timestamp(),
      }
      fixture.requirements.set(id, row)
      fixture.requirementHistory.set(id, [...(fixture.requirementHistory.get(id) ?? []), structuredClone(row)])
      fixture.allocations.set(`${id}:${revision}`, { stock, components: [] })
      await respond({ json: { id, revision } })
      return true
    }
    return previous(request, url, async response => {
      if (table === 'material_requirement_command' && body?.p_action === 'publish' && response.json?.material_id) {
        const row = fixture.requirements.get(body.p_requirement)
        if (row?.sheet_layer) {
          const material = fixture.materials.get(response.json.material_id)
          const count = Math.round(Number(row.purchase_quantity) / Number(row.purchase_increment))
          const unit = row.sheet_layer.coverage_kind === 'sheet_dimensions' ? 'sheet' : 'pack'
          material.qty = `${count} ${unit}${count === 1 ? '' : 's'} (${row.purchase_quantity} m²)`
          fixture.shoppingLinks.get(row.id).synced_qty = material.qty
        }
      }
      if (table === 'current_material_requirements' && fixture.sheetProof.missingRecipe && Array.isArray(response.json)) {
        response = { ...response, json: response.json.map(row => row.method_key === 'stud_wall_sheet_layer' ? { ...row, sheet_layer: null } : row) }
      }
      await respond(response)
    })
  }
}

export async function verifySheetLayersBrowser(page, base, fixture, width) {
  await page.goto(base + '#/material-plan?area=areaA')
  await page.getByRole('button', { name: 'Add stock', exact: true }).click()
  let modal = page.getByRole('dialog', { name: 'Add material stock', exact: true })
  await modal.getByLabel('Stock item', { exact: true }).fill('Sheet layer stock')
  await modal.getByLabel('Quantity', { exact: true }).fill('2')
  await modal.getByLabel('Unit', { exact: true }).selectOption('m2')
  await modal.getByLabel('Area', { exact: true }).selectOption('areaA')
  await modal.getByRole('button', { name: 'Save stock', exact: true }).click(); await modal.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Calculate from drawing', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Calculate material from drawing', exact: true })
  await modal.getByLabel('Calculation method', { exact: true }).selectOption('sheet_layer')
  await modal.getByLabel('Material / requirement', { exact: true }).fill('Chosen board layer')
  await modal.getByLabel('Number of layers', { exact: true }).fill('2')
  await modal.getByLabel('Sheet width (mm)', { exact: true }).fill('1200')
  await modal.getByLabel('Sheet height (mm)', { exact: true }).fill('2400')
  assert.equal(await modal.getByLabel('Product input certainty').inputValue(), '')
  assert.equal(await modal.getByLabel('Product input source').evaluate(input => input.validity.valueMissing), true)
  await modal.getByLabel('Product input certainty').selectOption('provided_spec')
  await modal.getByLabel('Product input source').fill('Fixture product packaging')
  await modal.getByLabel('Waste / allowance %').fill('10')
  await modal.getByLabel('Allocate Sheet layer stock', { exact: true }).fill('2')
  assert.equal(await modal.getByLabel('Purchase increment', { exact: true }).count(), 0)
  assert.equal(await modal.getByLabel('Base required quantity', { exact: true }).count(), 0)
  await modal.getByText(/Area-based quantity only — not a cut or layout plan/).waitFor()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Sheet inputs must fit the viewport')
  await page.screenshot({ path: `test-results/sheet-layer-input-${width}.png`, fullPage: true })
  await modal.getByRole('button', { name: 'Save calculated requirement', exact: true }).click(); await modal.waitFor({ state: 'hidden' })
  const card = page.getByRole('article', { name: 'Chosen board layer', exact: true })
  await card.getByText('6 sheets to buy', { exact: true }).waitFor()
  await page.reload(); await card.getByText('6 sheets to buy', { exact: true }).waitFor()
  await card.getByRole('button', { name: 'Send to Shopping', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Send to Shopping', exact: true })
  await modal.getByRole('button', { name: 'Send to Shopping', exact: true }).click(); await modal.waitFor({ state: 'hidden' })
  await page.goto(base + '#/shopping')
  const shoppingName = page.getByText('Chosen board layer', { exact: true })
  await shoppingName.locator('..').getByText('6 sheets (17.28 m²)', { exact: true }).waitFor()
  const row = [...fixture.requirements.values()].find(item => item.name === 'Chosen board layer')
  const material = fixture.materials.get(fixture.shoppingLinks.get(row.id).material_id)
  // Seed an existing delivery record; the next publish must preserve it.
  Object.assign(material, { status: 'delivered', supplier: 'Existing supplier', cost: '456 kr' })
  await page.goto(base + '#/material-plan?area=areaA')
  await card.getByRole('button', { name: 'Revise', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Revise calculated requirement', exact: true })
  assert.equal(await modal.getByLabel('Calculation method').inputValue(), 'sheet_layer')
  assert.equal(await modal.getByLabel('Sheet width (mm)').inputValue(), '1200')
  assert.equal(await modal.getByLabel('Number of layers').inputValue(), '2')
  assert.equal(await modal.getByLabel('Product input source').inputValue(), 'Fixture product packaging')
  await modal.getByLabel('Number of layers').fill('1')
  await modal.getByLabel('Reason for change').fill('One layer selected after review')
  fixture.sheetProof.conflictOnce = true
  await modal.getByRole('button', { name: 'Recalculate and save new version' }).click()
  await modal.getByText(/Material requirement changed/).waitFor()
  assert.equal(fixture.requirements.get(row.id).revision, 1, 'Conflict must not pretend to save')
  await modal.getByRole('button', { name: 'Recalculate and save new version' }).click(); await modal.waitFor({ state: 'hidden' })
  await card.getByText('3 sheets to buy', { exact: true }).waitFor()
  assert.equal(material.qty, '6 sheets (17.28 m²)', 'Saving must not silently write Shopping')
  await card.getByRole('button', { name: 'History', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Material requirement history' })
  await history.locator('li').filter({ hasText: 'Version 1' }).getByRole('button', { name: 'View version' }).click()
  const detail = page.getByRole('dialog', { name: 'Chosen board layer · Version 1', exact: true })
  await detail.getByText('6 sheets to buy', { exact: true }).waitFor()
  await detail.getByRole('button', { name: 'Close', exact: true }).click()
  await card.getByRole('button', { name: 'Update Shopping', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Update Shopping', exact: true })
  await modal.getByRole('button', { name: 'Update Shopping', exact: true }).click(); await modal.waitFor({ state: 'hidden' })
  assert.equal(material.qty, '3 sheets (8.64 m²)')
  assert.equal(material.status, 'delivered'); assert.equal(material.supplier, 'Existing supplier'); assert.equal(material.cost, '456 kr')
  await page.getByRole('button', { name: 'Calculate from drawing', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Calculate material from drawing', exact: true })
  await modal.getByLabel('Calculation method').selectOption('sheet_layer')
  await modal.getByLabel('Material / requirement').fill('Pack coverage layer')
  await modal.getByLabel('Purchase unit basis').selectOption('pack_coverage')
  await modal.getByLabel('Coverage per pack (m²)').fill('4,314')
  await modal.getByLabel('Product input certainty').selectOption('estimated')
  await modal.getByLabel('Product input source').fill('Estimated pack coverage — verify before buying')
  await modal.getByRole('button', { name: 'Save calculated requirement' }).click(); await modal.waitFor({ state: 'hidden' })
  await page.getByRole('article', { name: 'Pack coverage layer' }).getByText('2 packs to buy', { exact: true }).waitFor()
  fixture.sheetProof.missingRecipe = true
  await page.reload()
  await page.getByText(/Sheet-layer recipe unavailable/).waitFor()
  assert.equal(await page.getByRole('article', { name: 'Chosen board layer' }).count(), 0)
  fixture.sheetProof.missingRecipe = false
  await page.getByRole('button', { name: 'Reload material plan', exact: true }).click()
  await card.getByText('3 sheets to buy', { exact: true }).waitFor()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: `test-results/sheet-layer-saved-${width}.png`, fullPage: true })
  console.log(`Sheet layers ${width}px: explicit sheet/pack inputs, area/stock/purchase units, history/reload, conflicts, unavailable recipes and explicit Shopping preservation passed; HTTP fixtures, no AI.`)
}
