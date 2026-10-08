import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

/** A shell drawing places two saved pieces; the bed has a newer saved version the owner can adopt. */
export async function verifyCadShellBrowser(page, base, fixture, width) {
  const room = randomUUID(), bed = randomUUID(), shell = randomUUID()
  const box = (x, y, z) => ({ min: [0, 0, 0], max: [x, y, z], size: [x, y, z] })
  fixture.shellPieces.set(room, { title: 'Bedroom walls', revision: 1, archived: false, boxes: { 1: box(4000, 3200, 2400) } })
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
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal page scroll')
  await page.screenshot({ path: `test-results/cad-shell-${width}.png`, fullPage: true })

  await pieces.getByRole('button', { name: 'Use newest version (2)', exact: true }).click()
  const updated = page.getByRole('dialog', { name: 'Cabin bedroom · Version 2', exact: true })
  await updated.waitFor()
  assert.equal(await updated.getByRole('button', { name: /Use newest version/ }).count(), 0)
  assert.equal(await updated.getByText('Up to date', { exact: true }).count(), 2)
  assert.equal(fixture.shells.get(`${shell}:2`).components.find(c => c.component_key === 'bed').child_revision, 2)
  assert.equal(fixture.shells.get(`${shell}:1`).components.find(c => c.component_key === 'bed').child_revision, 1, 'Old shell version keeps its pin')
  await page.screenshot({ path: `test-results/cad-shell-adopted-${width}.png`, fullPage: true })

  // Owner placement: buttons, keyboard, a real pointer drag, then a stale-revision conflict.
  const version = n => page.getByRole('dialog', { name: `Cabin bedroom · Version ${n}`, exact: true })
  const plan = () => updated.getByRole('region', { name: 'Combined drawing', exact: true })
  await plan().getByRole('button', { name: 'Move Bunk bed', exact: true }).click()
  // The dialog title follows the saved version, so these locators are not scoped to one title.
  const mover = page.getByRole('dialog').getByRole('group', { name: 'Move Bunk bed', exact: true })
  const readout = mover.locator('.shell-move-readout')
  await readout.getByText('x 3800 mm, y 200 mm, turned 90°', { exact: true }).waitFor()
  for (const button of await mover.getByRole('button').all()) {
    const b = await button.boundingBox()
    assert(b && b.width >= 44 && b.height >= 44, 'Move controls need 44px targets')
  }
  for (let i = 0; i < 6; i++) await mover.getByRole('button', { name: 'Move right 50 mm', exact: true }).click()
  await readout.getByText('x 4100 mm, y 200 mm, turned 90° · not saved yet', { exact: true }).waitFor()
  const overlap = updated.getByRole('status').filter({ hasText: 'Footprints overlap: Bedroom walls and Bunk bed.' })
  await overlap.getByText(/not a measured clash check/).waitFor()
  assert.equal(await mover.getByRole('button', { name: 'Save position', exact: true }).isEnabled(), true, 'Overlap warns, never blocks')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal page scroll while moving')
  await page.screenshot({ path: `test-results/cad-shell-overlap-${width}.png`, fullPage: true })
  await mover.getByRole('button', { name: 'Turn 90°', exact: true }).click()
  await readout.getByText('x 4700 mm, y 1700 mm, turned 180° · not saved yet', { exact: true }).waitFor()
  await updated.locator('.box-drawing-viewport').focus()
  for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowLeft')
  await readout.getByText('x 4000 mm, y 1700 mm, turned 180° · not saved yet', { exact: true }).waitFor()
  await overlap.waitFor({ state: 'detached' })
  await mover.getByLabel('Why it goes here (optional)').fill('Head away from the window')
  await mover.getByRole('button', { name: 'Save position', exact: true }).click()
  await version(3).getByText('This drawing is now version 3.', { exact: false }).waitFor()
  const v3 = fixture.shells.get(`${shell}:3`).components.find(c => c.component_key === 'bed')
  assert.deepEqual([v3.x_mm, v3.y_mm, v3.z_mm, v3.rz, v3.placement_basis, v3.reason], [4000, 1700, 0, 180, 'owner_placed', 'Head away from the window'])
  assert.equal(fixture.shellCommands.at(-1).expected, 2)
  await version(3).getByRole('list', { name: 'Pieces in this drawing', exact: true }).getByText(/turned 180°.*Head away from the window/).waitFor()

  // A real drag with the mouse; the live position shows on the sheet while the button is held.
  const piece = version(3).locator('svg g[data-piece="bed"] rect')
  await piece.scrollIntoViewIfNeeded()
  const at = await piece.boundingBox()
  const x0 = at.x + at.width / 2, y0 = at.y + at.height / 2
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 - 5 * i, y0 - 4 * i)
  const live = await version(3).locator('[data-active-outline] text').textContent()
  const [, liveX, liveY] = live.match(/^x (-?\d+) · y (-?\d+)$/).map(Number)
  assert(liveX < 4000 && liveY > 1700 && liveX % 50 === 0 && liveY % 50 === 0, `Drag snaps to the 50 mm grid: ${live}`)
  await readout.getByText(`x ${liveX} mm, y ${liveY} mm, turned 180° · not saved yet`, { exact: true }).waitFor()
  await page.mouse.up()
  await mover.getByRole('button', { name: 'Save position', exact: true }).click()
  await version(4).waitFor()
  const v4 = fixture.shells.get(`${shell}:4`).components.find(c => c.component_key === 'bed')
  assert.deepEqual([v4.x_mm, v4.y_mm, v4.rz, v4.placement_basis, v4.reason], [liveX, liveY, 180, 'owner_placed', 'Moved in the drawing'])

  // Someone else saves first: the move is kept, the owner reloads and saves on the newest version.
  await mover.getByRole('button', { name: 'Move up 50 mm', exact: true }).click()
  const bob = structuredClone(fixture.shells.get(`${shell}:4`)); bob.revision = 5
  bob.components.find(c => c.component_key === 'room').reason = 'Bob noted the door side'
  fixture.shells.set(`${shell}:5`, bob)
  const row5 = { ...fixture.records.get(shell), revision: 5, change_note: 'Shell: place room' }
  fixture.records.set(shell, row5); fixture.histories.set(shell, [...fixture.histories.get(shell), structuredClone(row5)])
  await mover.getByRole('button', { name: 'Save position', exact: true }).click()
  await version(4).getByRole('alert').getByText(/changed since you opened it, so your move was not saved/).waitFor()
  await readout.getByText(`x ${liveX} mm, y ${liveY + 50} mm, turned 180° · not saved yet`, { exact: true }).waitFor()
  assert.equal(fixture.shells.has(`${shell}:6`), false)
  await page.screenshot({ path: `test-results/cad-shell-conflict-${width}.png`, fullPage: true })
  await version(4).getByRole('button', { name: 'Reload drawing', exact: true }).click()
  await version(5).getByText('Your unsaved move is still shown', { exact: false }).waitFor()
  await version(5).getByText(/Bob noted the door side/).waitFor()
  await readout.getByText(`x ${liveX} mm, y ${liveY + 50} mm, turned 180° · not saved yet`, { exact: true }).waitFor()
  await mover.getByRole('button', { name: 'Save position', exact: true }).click()
  await version(6).waitFor()
  assert.equal(fixture.shellCommands.at(-1).expected, 5)
  assert.equal(fixture.shells.get(`${shell}:6`).components.find(c => c.component_key === 'bed').y_mm, liveY + 50)
  assert.equal(fixture.shells.get(`${shell}:6`).components.find(c => c.component_key === 'room').reason, 'Bob noted the door side', 'The other change survives')
  await page.screenshot({ path: `test-results/cad-shell-placed-${width}.png`, fullPage: true })

  await page.keyboard.press('Escape')
  await card.getByText('Version 6', { exact: true }).waitFor()
  // Later scenarios count drawings; leave the fixture as it was.
  fixture.records.delete(shell); fixture.histories.delete(shell); fixture.shellCommands.length = 0
  for (const key of [...fixture.shells.keys()]) if (key.startsWith(shell)) fixture.shells.delete(key)
}
