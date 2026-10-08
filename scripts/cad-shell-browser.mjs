import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

/** A shell drawing places two saved pieces; the bed has a newer saved version the owner can adopt.
 * The walls are in the build plan and have a material list; the bed is in neither, and says so. */
export async function verifyCadShellBrowser(page, base, fixture, width) {
  const room = randomUUID(), bed = randomUUID(), shell = randomUUID()
  const box = (x, y, z) => ({ min: [0, 0, 0], max: [x, y, z], size: [x, y, z] })
  const material = (name, unit, required_quantity) => ({ id: randomUUID(), revision: 1, name, category: 'Timber', unit, required_quantity, artifact_revision: 1, from_pinned_version: true, needs_review: false })
  fixture.shellPieces.set(room, { title: 'Bedroom walls', revision: 1, archived: false, boxes: { 1: box(4000, 3200, 2400) },
    steps: [{ id: randomUUID(), title: 'Frame the walls', position: 1, state: 'active' }],
    materials: [material('Studs 45x95', 'pcs', '10.0000'), material('Plasterboard', 'm2', '12.5000')] })
  fixture.shellPieces.set(bed, { title: 'Bunk bed', revision: 2, archived: false, boxes: { 1: box(2000, 900, 1600), 2: box(2100, 900, 1600) } })
  const template = [...fixture.records.values()].find(r => r.project_id === 'A' && !r.archived)
  assert(template, 'Expected an earlier drawing to copy target fields from')
  const row = { ...structuredClone(template), id: shell, artifact_id: shell, area_id: 'areaA', revision: 1, kind: 'plan', status: 'concept',
    title: 'Cabin bedroom', description: 'Bedroom walls with the bunk bed placed inside.', assumptions: 'Positions are proposals.',
    source_media_id: null, source_media_title: '', measurements: [], generator: null, generator_version: null, archived: false,
    change_note: 'Bob combined two saved pieces', recorded_at: new Date(Date.UTC(2026, 9, 8, 12)).toISOString(),
    has_room_layout: false, has_stair_study: false, has_multifloor_plan: false }
  fixture.records.set(shell, row); fixture.histories.set(shell, [structuredClone(row)])
  fixture.shells.set(`${shell}:1`, { id: shell, revision: 1, title: row.title, description: row.description, assumptions: row.assumptions, archived: false, area_id: 'areaA', components: [
    { component_key: 'room', child_artifact_id: room, child_revision: 1, x_mm: 0, y_mm: 0, z_mm: 0, rz: 0, placement_basis: 'shared_origin', reason: 'Planned together' },
    { component_key: 'bed', child_artifact_id: bed, child_revision: 1, x_mm: 3800, y_mm: 200, z_mm: 0, rz: 90, placement_basis: 'owner_placed', reason: 'Against the east wall' },
  ] })

  await page.goto(base + '#/artifacts?area=areaA')
  await page.reload()
  const card = page.getByRole('article', { name: 'Cabin bedroom', exact: true })
  await card.getByText('Version 1', { exact: true }).waitFor()
  await card.getByRole('button', { name: /View evidence|Open drawing/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Cabin bedroom · Version 1', exact: true })
  const view = dialog.getByRole('region', { name: 'Combined drawing', exact: true })
  await view.waitFor()
  await view.getByRole('img', { name: 'Plan view of Cabin bedroom', exact: true }).waitFor()
  const pieces = view.getByRole('list', { name: 'Pieces in this drawing', exact: true })
  assert.equal(await pieces.getByRole('listitem').count(), 2)
  await view.getByText('One piece has changed since this drawing pinned it.', { exact: false }).waitFor()
  await pieces.getByText('Newer version saved', { exact: true }).waitFor()
  await pieces.getByText('Placed by you', { exact: true }).waitFor()
  await pieces.getByText(/turned 90°/).waitFor()
  // Plan: pieces in build order, linked Step or an explicit gap.
  await view.getByText('1 of 2 pieces are in the build plan. Ask Bob to link the rest to plan steps.', { exact: true }).waitFor()
  const rows = pieces.getByRole('listitem')
  await rows.nth(0).getByRole('link', { name: 'Step 1 · Frame the walls', exact: true }).waitFor()
  assert.match(await rows.nth(0).innerText(), /Bedroom walls/, 'Linked piece comes first in build order')
  assert.match(await rows.nth(1).innerText(), /Bunk bed[\s\S]*Not in the plan yet[\s\S]*Materials: Not counted yet/)
  assert.match(await rows.nth(0).innerText(), /Materials: 2 lines on this piece/)
  // Materials: summed from the pieces, with the uncounted piece named, never a zero.
  const totals = view.getByRole('region', { name: 'Materials for the whole drawing', exact: true })
  await totals.getByRole('heading', { name: 'Materials so far', exact: true }).waitFor()
  await totals.getByText('Not counted yet: Bunk bed.', { exact: false }).waitFor()
  const lines = totals.getByRole('list', { name: 'Material totals', exact: true }).getByRole('listitem')
  assert.equal(await lines.count(), 2)
  assert.match(await lines.nth(1).innerText(), /Studs 45x95: 10 pcs/)
  assert.match(await lines.nth(0).innerText(), /Plasterboard: 12\.5 m2/)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal page scroll')
  await page.screenshot({ path: `test-results/cad-shell-${width}.png`, fullPage: true })
  await pieces.screenshot({ path: `test-results/cad-shell-pieces-${width}.png` })
  await totals.screenshot({ path: `test-results/cad-shell-materials-${width}.png` })

  await pieces.getByRole('button', { name: 'Use newest version (2)', exact: true }).click()
  const updated = page.getByRole('dialog', { name: 'Cabin bedroom · Version 2', exact: true })
  await updated.waitFor()
  assert.equal(await updated.getByRole('button', { name: /Use newest version/ }).count(), 0)
  assert.equal(await updated.getByText('Up to date', { exact: true }).count(), 2)
  assert.equal(fixture.shells.get(`${shell}:2`).components.find(c => c.component_key === 'bed').child_revision, 2)
  assert.equal(fixture.shells.get(`${shell}:1`).components.find(c => c.component_key === 'bed').child_revision, 1, 'Old shell version keeps its pin')
  await page.screenshot({ path: `test-results/cad-shell-adopted-${width}.png`, fullPage: true })
  await page.keyboard.press('Escape')
  await card.getByText('Version 2', { exact: true }).waitFor()
  // Later scenarios count drawings; leave the fixture as it was.
  fixture.records.delete(shell); fixture.histories.delete(shell)
  for (const key of [...fixture.shells.keys()]) if (key.startsWith(shell)) fixture.shells.delete(key)
}
