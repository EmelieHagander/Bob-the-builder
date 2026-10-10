import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
const machined = JSON.parse(readFileSync(new URL('../tests/fixtures/cad-wireframes.json',import.meta.url),'utf8')).machined

const place = (x = 0, y = 0, z = 0, rz = 0) => ({ x, y, z, rx: 0, ry: 0, rz })
const recipe = (id, definitions, instances) => ({ contract_version: 1, units: 'mm', assembly_id: id, definitions, instances, views: ['isometric'] })
const box = (id, x_mm, y_mm, z_mm) => ({ id, primitive: 'box', material_ref: null, x_mm, y_mm, z_mm })
const ROOM = recipe('room', [box('wall_long', 4000, 100, 2400), box('wall_short', 100, 3000, 2400), box('floor', 4000, 3200, 22)], [
  { id: 'south', definition_id: 'wall_long', placement: place() }, { id: 'north', definition_id: 'wall_long', placement: place(0, 3100) },
  { id: 'west', definition_id: 'wall_short', placement: place(0, 100) }, { id: 'east', definition_id: 'wall_short', placement: place(3900, 100) },
  { id: 'floor', definition_id: 'floor', placement: place() },
])
const bunk = length => recipe('bunk', [box('rail', length, 45, 95), box('deck', length, 900, 22), { id: 'post', primitive: 'cylinder', material_ref: null, diameter_mm: 70, length_mm: 1600 }], [
  ...[0, 855].flatMap((y, i) => [{ id: `rail${i}.low`, definition_id: 'rail', placement: place(0, y, 300) }, { id: `rail${i}.high`, definition_id: 'rail', placement: place(0, y, 1300) }]),
  { id: 'deck.low', definition_id: 'deck', placement: place(0, 0, 395) }, { id: 'deck.high', definition_id: 'deck', placement: place(0, 0, 1395) },
  ...[[35, 35], [length - 35, 35], [35, 865], [length - 35, 865]].map(([x, y], i) => ({ id: `post${i}`, definition_id: 'post', placement: place(x, y) })),
])

/** A shell drawing places three saved pieces; the bed has a newer saved version the owner can adopt, and the seat has no saved recipe.
 * The walls are in the build plan and have a material list; the bed and seat are in neither, and say so. */
export async function verifyCadShellBrowser(page, base, fixture, width) {
  const room = randomUUID(), bed = randomUUID(), seat = randomUUID(), shell = randomUUID()
  const box = (x, y, z) => ({ min: [0, 0, 0], max: [x, y, z], size: [x, y, z] })
  const material = (name, unit, required_quantity) => ({ id: randomUUID(), revision: 1, name, category: 'Timber', unit, required_quantity, artifact_revision: 1, from_pinned_version: true, needs_review: false })
  fixture.shellPieces.set(room, { title: 'Bedroom walls', revision: 1, archived: false, boxes: { 1: box(4000, 3200, 2400) },
    steps: [{ id: randomUUID(), title: 'Frame the walls', position: 1, state: 'active' }],
    materials: [material('Studs 45x95', 'pcs', '10.0000'), material('Plasterboard', 'm2', '12.5000')] })
  fixture.shellPieces.set(bed, { title: 'Bunk bed', revision: 2, archived: false, boxes: { 1: box(2000, 900, 1600), 2: box(2100, 900, 1600) } })
  fixture.shellPieces.set(seat, { title: 'Window seat', revision: 1, archived: false, boxes: { 1: box(1200, 450, 450) } })
  // Saved CAD recipes (artifact_cad_revisions rows) for the pinned piece revisions. The seat has none.
  const cadRow = (artifact_id, artifact_revision, recipe) => [`${artifact_id}:${artifact_revision}`, { project_id: 'A', artifact_id, artifact_revision, recipe, manifest: {}, files: {}, step_id: null, source_artifact_id: null, source_revision: null }]
  const pieceRows = [cadRow(room, 1, ROOM), cadRow(bed, 1, bunk(2000)), cadRow(bed, 2, bunk(2100))]
  for (const [key, value] of pieceRows) fixture.cad.set(key, value)
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
    { component_key: 'seat', child_artifact_id: seat, child_revision: 1, x_mm: 300, y_mm: 2600, z_mm: 22, rz: 0, placement_basis: 'bob_decision', reason: 'Under the north window' },
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
  assert.equal(await pieces.getByRole('listitem').count(), 3)
  await view.getByText('One piece has changed since this drawing pinned it.', { exact: false }).waitFor()
  await pieces.getByText('Newer version saved', { exact: true }).waitFor()
  await pieces.getByText('Placed by you', { exact: true }).waitFor()
  await pieces.getByText(/turned 90°/).waitFor()
  // Plan: pieces in build order, linked Step or an explicit gap.
  await view.getByText('1 of 3 pieces are in the build plan. Ask Bob to link the rest to plan steps.', { exact: true }).waitFor()
  const rows = pieces.getByRole('listitem')
  await rows.nth(0).getByRole('link', { name: 'Step 1 · Frame the walls', exact: true }).waitFor()
  assert.match(await rows.nth(0).innerText(), /Bedroom walls/, 'Linked piece comes first in build order')
  assert.match(await rows.nth(1).innerText(), /Bunk bed[\s\S]*Not in the plan yet[\s\S]*Materials: Not counted yet/)
  assert.match(await rows.nth(0).innerText(), /Materials: 2 lines on this piece/)
  // Materials: summed from the pieces, with the uncounted piece named, never a zero.
  const totals = view.getByRole('region', { name: 'Materials for the whole drawing', exact: true })
  await totals.getByRole('heading', { name: 'Materials so far', exact: true }).waitFor()
  await totals.getByText('Not counted yet: Bunk bed, Window seat.', { exact: false }).waitFor()
  const lines = totals.getByRole('list', { name: 'Material totals', exact: true }).getByRole('listitem')
  assert.equal(await lines.count(), 2)
  assert.match(await lines.nth(1).innerText(), /Studs 45x95: 10 pcs/)
  assert.match(await lines.nth(0).innerText(), /Plasterboard: 12\.5 m2/)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal page scroll')
  await page.screenshot({ path: `test-results/cad-shell-${width}.png`, fullPage: true })
  const webgl = await verifyShell3D(page, view, fixture, width)
  console.log(`cad-shell 3D view at ${width}px: ${webgl ? 'WebGL rendered the composed shell' : 'no WebGL in this Chromium, fallback asserted only'}`)
  await pieces.screenshot({ path: `test-results/cad-shell-pieces-${width}.png` })
  await totals.screenshot({ path: `test-results/cad-shell-materials-${width}.png` })

  await pieces.getByRole('button', { name: 'Use newest version (2)', exact: true }).click()
  const updated = page.getByRole('dialog', { name: 'Cabin bedroom · Version 2', exact: true })
  await updated.waitFor()
  assert.equal(await updated.getByRole('button', { name: /Use newest version/ }).count(), 0)
  assert.equal(await updated.getByText('Up to date', { exact: true }).count(), 3)
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
  await verifySingleWireframe(page,base,fixture,width,row)
  // Later scenarios count drawings; leave the fixture as it was.
  fixture.records.delete(shell); fixture.histories.delete(shell); fixture.shellCommands.length = 0
  for (const [key] of pieceRows) fixture.cad.delete(key)
  for (const key of [...fixture.shells.keys()]) if (key.startsWith(shell)) fixture.shells.delete(key)
}

async function verifySingleWireframe(page,base,fixture,width,template) {
  const id=randomUUID(),title='Machined CAD block'
  const row={...template,id,artifact_id:id,title,revision:1,description:'Kernel edges of a hole and notch',change_note:'Viewer fixture'}
  fixture.records.set(id,row);fixture.histories.set(id,[row])
  fixture.cad.set(`${id}:1`,{project_id:'A',artifact_id:id,artifact_revision:1,recipe:machined.recipe,manifest:{},files:{
    isometric:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M10 10H110V110H10Z M60 55a5 5 0 1 0 0 10a5 5 0 1 0 0-10" fill="none" stroke="black"/></svg>').toString('base64'),step:Buffer.from('ISO-10303-21').toString('base64')}})
  await page.goto(base+'#/artifacts?area=areaA');await page.reload()
  await page.getByRole('article',{name:title,exact:true}).getByRole('button',{name:/View evidence|Open drawing/}).click()
  const dialog=page.getByRole('dialog',{name:title+' · Version 1',exact:true})
  await dialog.getByRole('button',{name:'View in 3D',exact:true}).click()
  const image=dialog.getByRole('img',{name:'3D line view of '+title,exact:true})
  await image.waitFor()
  await page.waitForFunction(() => Number(document.querySelector('.shell3d-viewport')?.dataset.renders)>0)
  assert.equal(fixture.viewerCalls.at(-1).artifact_id,id);assert.equal(fixture.viewerCalls.at(-1).revision,1)
  const exports=fixture.viewerExports
  await image.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/cad-single-wireframe-${width}.png`,fullPage:true})
  await dialog.getByRole('button',{name:'Close 3D view',exact:true}).click();assert.equal(await dialog.locator('canvas').count(),0)
  await dialog.getByRole('button',{name:'View in 3D',exact:true}).click();await image.waitFor()
  assert.equal(fixture.viewerExports,exports,'single drawing cache survives closing')
  await dialog.getByRole('link',{name:'Download 3D model',exact:true}).waitFor()
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
  fixture.records.delete(id);fixture.histories.delete(id);fixture.cad.delete(`${id}:1`)
}

/** Real kernel fixture edges, phone interaction and bounded on-demand loading. */
async function verifyShell3D(page, view, fixture, width) {
  const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))
  const reads = fixture.recipeReads ?? 0, calls = fixture.viewerCalls.length
  const scripts = () => page.evaluate(() => performance.getEntriesByType('resource').filter(e => /CadShell3D/.test(e.name)).length)
  assert.equal(await scripts(), 0, 'three.js chunk stays lazy')
  if (webgl) {
    await view.getByRole('button', { name: '3D view', exact: true }).click()
    const image = view.getByRole('img', { name: '3D line view of Cabin bedroom', exact: true })
    await image.waitFor()
    await view.getByText('Overview · saved bounding boxes only.', { exact: false }).waitFor()
    assert(await scripts() > 0)
    assert.equal(fixture.recipeReads ?? 0, reads, 'overview never fetches CAD recipes')
    assert.equal(fixture.viewerCalls.length, calls, 'overview never asks the paid worker for detail')
    await page.waitForFunction(() => Number(document.querySelector('.shell3d-viewport')?.dataset.renders)>0)
    assert.equal(await image.getAttribute('data-budget-segments'), '36')
    assert.equal(await image.getAttribute('data-draw-calls'), '2')
    const selector=view.getByLabel('Detail to load')
    await selector.selectOption('bed')
    const bed=view.getByRole('img',{name:'3D line view of Bunk bed',exact:true})
    await bed.waitFor()
    await view.getByText('saved version 1.',{exact:false}).waitFor()
    const first=fixture.viewerCalls.at(-1)
    assert.equal(first.revision,1,'keeps pinned bed version, even with a newer version available')
    const exports=fixture.viewerExports
    await page.waitForFunction(() => Number(document.querySelector('.shell3d-viewport')?.dataset.drawCalls)===3)
    assert.equal(await bed.getAttribute('data-budget-calls'),'3','one draw per definition')
    const canvas=view.locator('canvas.shell3d-canvas');await canvas.scrollIntoViewIfNeeded()
    const size=await canvas.boundingBox();assert(size&&size.width>200&&size.height>=250)
    const before=Number(await bed.getAttribute('data-renders')), network=fixture.viewerCalls.length
    await page.waitForTimeout(250)
    assert.equal(Number(await bed.getAttribute('data-renders')),before,'idle view does not animate')
    assert.equal(fixture.viewerCalls.length,network,'idle view makes no server calls')
    await page.mouse.move(size.x+size.width/2,size.y+size.height/2)
    await page.mouse.down();await page.mouse.move(size.x+size.width/2+45,size.y+size.height/2+25,{steps:5});await page.mouse.up()
    await page.mouse.wheel(0,-200)
    await page.waitForTimeout(100)
    assert(Number(await bed.getAttribute('data-renders'))>before,'rotate and zoom render locally')
    if(width<768) {
      const cdp=await page.context().newCDPSession(page)
      const x=size.x+size.width/2,y=size.y+size.height/2
      const touchBefore=Number(await bed.getAttribute('data-renders'))
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-20,y},{x:x+20,y}]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-45,y:y+10},{x:x+45,y:y+10}]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await page.waitForTimeout(100);assert(Number(await bed.getAttribute('data-renders'))>touchBefore,'pinch and two-finger pan')
      await cdp.detach()
    }
    const fit=view.getByRole('button',{name:'Fit view',exact:true})
    const target=await fit.boundingBox();assert(target&&target.height>=44)
    await fit.click()
    await view.getByLabel('Parts to show').selectOption('post0')
    await page.waitForFunction(() => Number(document.querySelector('.shell3d-viewport')?.dataset.drawCalls)===1)
    assert.equal(fixture.viewerCalls.length,network,'part selection uses the downloaded buffers')
    await view.getByLabel('Parts to show').selectOption('')
    await view.getByRole('button',{name:'Fullscreen',exact:true}).click()
    const full=page.getByRole('dialog',{name:'Bunk bed · 3D fullscreen',exact:true})
    await full.waitFor();assert.equal(fixture.viewerCalls.length,network,'fullscreen reuses downloaded geometry')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth),true)
    await page.screenshot({path:`test-results/cad-wireframe-fullscreen-${width}.png`})
    await page.keyboard.press('Escape');await full.waitFor({state:'detached'})
    await bed.waitFor();assert.equal(await view.count(),1,'Escape keeps the drawing open')
    await page.waitForFunction(() => document.activeElement?.textContent==='Fullscreen')
    await selector.selectOption('');await image.waitFor()
    assert.equal(await view.locator('canvas.shell3d-canvas').count(),1,'only the current scene owns a canvas')
    await selector.selectOption('bed');await bed.waitFor()
    assert.equal(fixture.viewerExports,exports,'reopening the same pin uses its saved export')
    fixture.rejectViewer=true
    await selector.selectOption('room')
    await view.getByRole('button',{name:'Try again',exact:true}).waitFor()
    const failedCalls=fixture.viewerCalls.length
    await page.waitForTimeout(250);assert.equal(fixture.viewerCalls.length,failedCalls,'failure does not retry itself')
    fixture.rejectViewer=false;await view.getByRole('button',{name:'Try again',exact:true}).click()
    await view.getByRole('img',{name:'3D line view of Bedroom walls',exact:true}).waitFor()
    assert.equal(fixture.viewerCalls.at(-1).retry,true)
    await page.screenshot({path:`test-results/cad-shell-wireframe-${width}.png`,fullPage:true})
    await view.getByRole('button',{name:'Plan view',exact:true}).click()
    await view.getByRole('img',{name:'Plan view of Cabin bedroom',exact:true}).waitFor()
    assert.equal(await view.locator('canvas').count(),0,'closing releases the canvas')
  }
  await page.evaluate(() => {
    const original=HTMLCanvasElement.prototype.getContext
    window.__restoreGetContext=()=>{HTMLCanvasElement.prototype.getContext=original}
    HTMLCanvasElement.prototype.getContext=function(type,...rest){return /webgl/.test(type)?null:original.call(this,type,...rest)}
  })
  const lastCalls=fixture.viewerCalls.length
  await view.getByRole('button',{name:'3D view',exact:true}).click()
  await view.getByText('This browser or device cannot draw 3D here (WebGL is off or unavailable). Showing the saved drawing instead.',{exact:true}).waitFor()
  await view.getByRole('img',{name:'Plan view of Cabin bedroom',exact:true}).waitFor()
  assert.equal(fixture.viewerCalls.length,lastCalls,'unsupported devices do not prepare a paid export')
  await page.screenshot({path:`test-results/cad-shell-3d-fallback-${width}.png`,fullPage:true})
  await page.evaluate(() => window.__restoreGetContext())
  return webgl
}
