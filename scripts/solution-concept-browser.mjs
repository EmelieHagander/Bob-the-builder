import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { conceptFixture } from '../tests/support/solution-concept-fixtures.ts'

/** Production UI/data seam, intercepted HTTP only; never a real-model claim. */
export async function verifyConceptsBrowser(page, base, fixture, width) {
  const rows = new Map()
  const latest = Math.max(...[...fixture.records.values()].map(r => Date.parse(r.recorded_at)), Date.now())
  for (const [n, kind] of ['box', 'bed', 'barn'].entries()) {
    const id = randomUUID(), row = { id, solution_id: id, project_id: 'A', area_id: null, revision: 1, title: `Concept ${kind}`, description: 'Synthetic early design fixture', assumptions: 'Concept only', tradeoffs: '',
      source_media_id: null, source_media_title: '', archived: false, change_note: 'Initial concept', actor_label: 'Bob fixture', recorded_at: new Date(latest + n + 1).toISOString(), measurements: [], design_intent: conceptFixture(kind) }
    fixture.records.set(id, row); fixture.histories.set(id, [structuredClone(row)]); rows.set(kind, row)
  }
  await page.goto(base + '#/solutions'); await page.reload()
  for (const kind of ['box', 'bed', 'barn']) {
    const card = page.getByRole('article', { name: `Concept ${kind}`, exact: true })
    await card.getByRole('button', { name: 'View evidence', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Concept ${kind} · Version 1`, exact: true }), model = dialog.getByRole('region', { name: 'Concept model', exact: true })
    await model.getByRole('img', { name: /Plan.*XY projection/ }).waitFor()
    await model.getByRole('button', { name: /Longitudinal.*XZ/ }).click()
    await model.getByRole('img', { name: /Longitudinal.*XZ/ }).waitFor()
    if (kind === 'barn') {
      await model.getByText(/Rooms, floor, loft, roof and foundation.*4000 mm > 3500 mm/).waitFor()
      assert.equal(await model.locator('tbody tr').count(), 7)
      await model.getByRole('button', { name: 'Front wall section · XZ', exact: true }).click()
      assert.equal(await model.locator('tbody tr').count(), 11)
    }
    await model.getByRole('button', { name: 'Zoom concept in' }).click()
    await model.getByRole('button', { name: 'Fit concept', exact: true }).click()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No page overflow')
    await page.screenshot({ path: `test-results/concept-${kind}-${width}.png`, fullPage: true })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  }
  // Simulate a canonical Bob receipt followed by a fresh navigation/read.
  const bed = rows.get('bed'), updated = structuredClone(bed)
  updated.revision = 2; updated.design_intent.model.nodes.find(n => n.id === 'ladder_x').value = 100
  fixture.records.set(bed.id, updated); fixture.histories.get(bed.id).push(updated)
  await page.reload()
  await page.getByRole('article', { name: 'Concept bed', exact: true }).getByRole('button', { name: 'View evidence', exact: true }).click()
  const revised = page.getByRole('dialog', { name: 'Concept bed · Version 2', exact: true })
  await revised.getByRole('row').filter({ hasText: 'Wall mounted ladder envelope' }).getByText('100 / 0', { exact: true }).waitFor()
  await revised.getByRole('row').filter({ hasText: 'Drawer envelope' }).getByText('1000 / 0', { exact: true }).waitFor()
  await revised.getByRole('button', { name: 'Close', exact: true }).click()
  const box = rows.get('box')
  box.design_intent.model.nodes[1] = { id: 'length', role: 'unknown', unit: 'mm', reason: 'Length not supplied' }
  fixture.histories.set(box.id, [structuredClone(box)])
  await page.reload()
  await page.getByRole('article', { name: 'Concept box', exact: true }).getByRole('button', { name: 'View evidence', exact: true }).click()
  const unknown = page.getByRole('dialog', { name: 'Concept box · Version 1', exact: true })
  await unknown.getByText('No components can be shown in this view. Check unknown dimensions and the section position.', { exact: true }).waitFor()
  assert.equal(await unknown.locator('tbody tr').count(), 0)
  await unknown.getByRole('button', { name: 'Close', exact: true }).click()
  fixture.wrongVersionProjectOnce = true
  await page.getByRole('article', { name: 'Concept bed', exact: true }).getByRole('button', { name: 'View evidence', exact: true }).click()
  const failed = page.getByRole('dialog')
  await failed.getByRole('button', { name: 'Reload solutions', exact: true }).click()
  await failed.getByRole('heading', { name: 'Concept model · Version 2', exact: true }).waitFor()
  await failed.getByRole('button', { name: 'Close', exact: true }).click()
  console.log(`FORM concepts, slices, gaps, correction/readback and retry at ${width}px; HTTP fixtures only.`)
}
