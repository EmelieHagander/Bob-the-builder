// HTTP fixtures plus browser assertions for the real ProjectFacts UI/data seam.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export function createFactsFixture(timestamp, assets) {
  const records = { measurement: new Map(), component: new Map() }, histories = new Map()
  function remember(kind, row) {
    records[kind].set(row.id, row)
    const entries = histories.get(row.id) ?? []
    entries.push({ ...row, [kind + '_id']: row.id, id: randomUUID() })
    histories.set(row.id, entries)
  }
  return {
    records, remember,
    async handle(request, url, respond) {
      const path = url.pathname
      const tables = ['/rest/v1/current_measurements', '/rest/v1/current_components', '/rest/v1/measurement_revisions', '/rest/v1/component_revisions']
      if (!tables.includes(path) && path !== '/rest/v1/rpc/evidence_command') return false
      const fail = async message => { await respond({ status: 409, json: { message } }); return true }
      const eq = key => url.searchParams.get(key)?.replace(/^eq\./, '')
      if (path === '/rest/v1/rpc/evidence_command') {
        const { p_project, p_kind: kind, p_action: action, p_record: id, p_expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = records[kind].get(id)
        if (action !== 'create' && p_expected !== old?.revision) return fail('Record changed. Reload before saving again.')
        const parent = data.component_id ? records.component.get(data.component_id) : null
        const source = data.source_media_id ? assets.get(data.source_media_id) : null
        const row = action === 'archive' || action === 'restore' ? {
          ...old, archived: action === 'archive', change_note: action === 'archive' ? 'Archived' : 'Restored',
        } : {
          ...old, id, project_id: p_project, area_id: old?.area_id ?? parent?.area_id ?? data.area_id ?? null,
          component_id: old?.component_id ?? data.component_id ?? null,
          notes: '', source: '', required: false, condition: '', specification: '', kind: '', quantity: null, intent: 'inspect',
          ...data, quantity: data.quantity ? Number(data.quantity) : null, archived: false,
          source_media_id: source?.id ?? null, source_media_title: source?.title ?? '',
          change_note: action === 'create' ? 'Initial record' : data.change_note,
        }
        if (kind === 'measurement' && row.value !== null) {
          assert.match(String(row.value), /^\d+(\.\d{1,3})?$/, 'UI must pass an unambiguous decimal string')
          row.millimetres = String(Number(row.value) * (row.unit === 'm' ? 1000 : row.unit === 'cm' ? 10 : 1))
        }
        row.revision = (old?.revision ?? 0) + 1
        row.recorded_at = timestamp(); row.actor_label = 'Fixture member'
        remember(kind, row)
        await respond({ json: { id, revision: row.revision } })
        return true
      }
      const kind = path.includes('measurement') ? 'measurement' : 'component'
      const isHistory = path.endsWith('_revisions')
      let rows = isHistory ? [...(histories.get(eq(kind + '_id')) ?? [])] : [...records[kind].values()]
      rows = rows.filter(r => r.project_id === eq('project_id'))
      if (eq('id')) rows = rows.filter(r => r.id === eq('id'))
      if (eq('area_id')) rows = rows.filter(r => r.area_id === eq('area_id'))
      if (eq('component_id')) rows = rows.filter(r => r.component_id === eq('component_id'))
      if (eq('archived')) rows = rows.filter(r => r.archived === (eq('archived') === 'true'))
      if (url.searchParams.has('truth')) rows = rows.filter(r => ['unknown', 'estimated'].includes(r.truth))
      rows.sort((a, b) => isHistory ? b.revision - a.revision : b.recorded_at.localeCompare(a.recorded_at) || a.id.localeCompare(b.id))
      if (eq('id')) await respond({ json: rows[0] ?? null })
      else {
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
        await respond({ json: rows.slice(offset, offset + limit) })
      }
      return true
    },
  }
}

export async function verifyFactsBrowser(page, base, fixture, width) {
  await page.goto(base)
  await page.getByRole('link', { name: /Measurements & existing parts/ }).click()
  await page.getByRole('heading', { name: 'Measurements & existing parts', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add measurement', exact: true }).click()
  let editor = page.getByRole('dialog', { name: 'Add measurement', exact: true })
  await editor.getByLabel('What does it measure?', { exact: true }).fill('Opening width')
  await editor.getByLabel('Area', { exact: true }).selectOption('areaA')
  assert.equal(await editor.getByLabel('How certain is this value?', { exact: true }).inputValue(), 'unknown')
  assert(await editor.getByLabel('Value', { exact: true }).isDisabled())
  await editor.getByLabel('Required measurement', { exact: true }).check()
  await editor.getByRole('button', { name: 'Save measurement', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  const opening = page.getByRole('article', { name: 'Opening width', exact: true })
  await opening.getByText('Not measured yet', { exact: true }).waitFor()
  await opening.getByRole('button', { name: 'Update', exact: true }).click()
  editor = page.getByRole('dialog', { name: 'Update measurement', exact: true })
  await editor.getByLabel('How certain is this value?', { exact: true }).selectOption('estimated')
  await editor.getByLabel('Value', { exact: true }).fill('1,250')
  await editor.getByLabel('Unit', { exact: true }).selectOption('m')
  await editor.getByLabel('How was it obtained?', { exact: true }).fill('Rough estimate at the opening')
  await editor.getByLabel('Reason for change', { exact: true }).fill('First estimate')
  await editor.getByRole('button', { name: 'Choose source image', exact: true }).click()
  const chooser = page.getByRole('dialog', { name: 'Choose a source image', exact: true })
  await chooser.getByRole('button', { name: 'Use image', exact: true }).click()
  await chooser.waitFor({ state: 'hidden' })
  await editor.getByRole('button', { name: 'Save new version', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await opening.getByText('Estimated', { exact: true }).waitFor()
  await page.getByLabel('Show records', { exact: true }).selectOption('missing')
  await opening.getByText('1.250 m', { exact: true }).waitFor()
  await opening.getByRole('button', { name: 'Update', exact: true }).click()
  await editor.getByLabel('How certain is this value?', { exact: true }).selectOption('measured')
  await editor.getByLabel('Value', { exact: true }).fill('1254')
  await editor.getByLabel('Unit', { exact: true }).selectOption('mm')
  await editor.getByLabel('How was it obtained?', { exact: true }).fill('Tape between opening faces')
  await editor.getByLabel('Reason for change', { exact: true }).fill('Measured on site')
  await editor.getByRole('button', { name: 'Save new version', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await opening.waitFor({ state: 'hidden' })
  await page.getByLabel('Show records', { exact: true }).selectOption('active')
  await opening.getByText('1254 mm', { exact: true }).waitFor()
  await page.reload()
  await opening.getByText('Measured', { exact: true }).waitFor()
  await opening.getByRole('button', { name: 'History', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'History: Opening width', exact: true })
  await history.getByText('Version 3 · Measured on site', { exact: true }).waitFor()
  await history.getByText('Version 2 · First estimate', { exact: true }).waitFor()
  await history.getByText('Not measured yet', { exact: true }).waitFor()
  await history.getByRole('button', { name: 'View source image', exact: true }).first().click()
  const original = page.getByRole('dialog', { name: 'Entry before work', exact: true })
  await original.getByRole('img').waitFor()
  assert.deepEqual(await original.getByRole('img').evaluate(img => [img.naturalWidth, img.naturalHeight, getComputedStyle(img).objectFit]), [120, 240, 'contain'])
  await original.getByRole('button', { name: 'Close', exact: true }).click()
  await history.getByRole('button', { name: 'Close', exact: true }).click()

  // Another editor commits while this form is open: keep user input and show conflict.
  await opening.getByRole('button', { name: 'Update', exact: true }).click()
  await editor.getByLabel('Notes', { exact: true }).fill('My unsaved note')
  await editor.getByLabel('Reason for change', { exact: true }).fill('Add note')
  const old = [...fixture.records.measurement.values()].find(r => r.subject === 'Opening width')
  fixture.remember('measurement', { ...old, revision: old.revision + 1, change_note: 'Another editor updated this record' })
  await editor.getByRole('button', { name: 'Save new version', exact: true }).click()
  await editor.getByRole('alert').getByText(/Record changed/).waitFor()
  assert.equal(await editor.getByLabel('Notes', { exact: true }).inputValue(), 'My unsaved note')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.reload()

  await page.getByRole('button', { name: 'Existing parts', exact: true }).click()
  await page.getByRole('button', { name: 'Add existing part', exact: true }).click()
  const partEditor = page.getByRole('dialog', { name: 'Add existing part', exact: true })
  await partEditor.getByLabel('Part name', { exact: true }).fill('Existing window')
  await partEditor.getByLabel('Area', { exact: true }).selectOption('areaA')
  await partEditor.getByLabel('Kind of part', { exact: true }).fill('Window')
  await partEditor.getByLabel('Count', { exact: true }).fill('2')
  await partEditor.getByLabel('Observed condition', { exact: true }).fill('Paint worn; joints not inspected')
  await partEditor.getByRole('button', { name: 'Save existing part', exact: true }).click()
  await partEditor.waitFor({ state: 'hidden' })
  const part = page.getByRole('article', { name: 'Existing window', exact: true })
  await part.getByText('2 items', { exact: true }).waitFor()
  await part.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('dialog', { name: 'Archive Existing window?', exact: true }).getByRole('button', { name: 'Archive record', exact: true }).click()
  await part.waitFor({ state: 'hidden' })
  await page.getByLabel('Show records', { exact: true }).selectOption('archived')
  await part.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore Existing window?', exact: true }).getByRole('button', { name: 'Restore record', exact: true }).click()
  await part.waitFor({ state: 'hidden' })
  await page.getByLabel('Show records', { exact: true }).selectOption('active')
  await part.getByRole('button', { name: 'Measurements for part', exact: true }).click()
  await page.getByText('Measurements for Existing window', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add measurement', exact: true }).click()
  const dimension = page.getByRole('dialog', { name: 'Add measurement', exact: true })
  await dimension.getByLabel('What does it measure?', { exact: true }).fill('Window width')
  await dimension.getByRole('button', { name: 'Save measurement', exact: true }).click()
  await dimension.waitFor({ state: 'hidden' })
  await page.reload()
  await page.getByRole('article', { name: 'Window width', exact: true }).waitFor()
  assert.equal(await opening.count(), 0, 'Part scope must exclude unrelated measurements')
  assert.equal([...fixture.records.measurement.values()].find(r => r.subject === 'Window width').component_id, [...fixture.records.component.keys()][0])
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Facts must fit the viewport')
  for (const button of await page.locator('.project-facts').getByRole('button').all()) {
    const box = await button.boundingBox()
    assert(!box || (box.width >= 44 && box.height >= 44), 'Fact actions need 44px targets')
  }
  await page.screenshot({ path: 'test-results/project-facts-' + width + '.png', fullPage: true })
  for (let i = 0; i < 25; i++) fixture.remember('measurement', {
    ...old, id: randomUUID(), revision: 1, subject: 'Paging length ' + i,
  })
  await page.getByRole('button', { name: 'Show all measurements', exact: true }).click()
  await page.getByRole('button', { name: 'Next records', exact: true }).waitFor()
  assert.equal(await page.locator('.fact-list > article').count(), 24)
  await page.getByRole('button', { name: 'Next records', exact: true }).click()
  await page.getByRole('button', { name: 'Previous records', exact: true }).waitFor()
  assert.equal(await page.locator('.fact-list > article').count(), 3)
  await page.getByRole('button', { name: 'Previous records', exact: true }).click()
  await page.getByRole('button', { name: 'Next records', exact: true }).waitFor()
  assert.equal(await page.locator('.fact-list > article').count(), 24)
  console.log('Project facts unknown/estimate/measured/source/history/conflict/component/archive/restore/reload passed at ' + width + 'px; HTTP fixtures, no AI.')
}
