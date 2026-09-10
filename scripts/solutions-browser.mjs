import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export function createSolutionsFixture(timestamp, assets, facts) {
  const records = new Map(), histories = new Map(), decisions = []
  const fixture = { records, histories, decisions, rejectNext: false,
    async handle(request, url, respond) {
      const table = url.pathname.split('/').at(-1)
      if (!['current_solutions','solution_revisions','solution_measurement_details','current_target','target_revisions','solution_command'].includes(table)) return false
      const eq = key => url.searchParams.get(key)?.replace(/^eq\./, '')
      const fail = async message => { await respond({ status: 409, json: { message } }); return true }
      if (table === 'solution_command') {
        const { p_project, p_action: action, p_solution: id, p_expected: expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = records.get(id)
        if (action === 'select' || action === 'clear') {
          if (fixture.rejectNext) { fixture.rejectNext = false; return fail('Target changed. Reload before deciding again.') }
          if (expected !== decisions.length) return fail('Target changed. Reload before deciding again.')
          if (action === 'select' && old.revision !== data.solution_revision) return fail('Solution changed. Reload before selecting.')
          decisions.push({ project_id: p_project, revision: decisions.length + 1, solution_id: id,
            solution_revision: id ? old.revision : null, reason: data.reason, actor_label: 'Fixture member', recorded_at: timestamp() })
          await respond({ json: { revision: decisions.length } }); return true
        }
        if (action !== 'create' && old.revision !== expected) return fail('Solution changed. Reload before saving again.')
        if (action === 'archive' && decisions.at(-1)?.solution_id === id) return fail('Choose another target or clear it before archiving this alternative.')
        const source = assets.get(data.source_media_id)
        const row = action === 'archive' || action === 'restore' ? { ...old, archived: action === 'archive', change_note: action === 'archive' ? 'Archived' : 'Restored' }
          : { ...old, id, solution_id: id, project_id: p_project, area_id: data.area_id ?? old?.area_id ?? null,
            assumptions: '', tradeoffs: '', ...data, source_media_id: source?.id ?? null,
            source_media_title: source?.title ?? '', archived: false, change_note: data.change_note ?? 'Initial alternative' }
        row.revision = (old?.revision ?? 0) + 1; row.actor_label = 'Fixture member'; row.recorded_at = timestamp()
        records.set(id, row); histories.set(id, [...(histories.get(id) ?? []), structuredClone(row)])
        await respond({ json: { id, revision: row.revision } }); return true
      }
      let rows
      if (table === 'current_target') rows = decisions.length ? [decisions.at(-1)] : []
      else if (table === 'target_revisions') rows = [...decisions].reverse()
      else if (table === 'current_solutions') rows = [...records.values()]
      else if (table === 'solution_revisions') rows = [...(histories.get(eq('solution_id')) ?? [])].reverse()
      else {
        const saved = histories.get(eq('solution_id'))?.find(r => r.revision === Number(eq('solution_revision')))
        rows = (saved?.measurements ?? []).map(ref => {
          const m = facts.histories.get(ref.id)?.find(r => r.revision === ref.revision), now = facts.records.measurement.get(ref.id)
          assert(m, 'The exact referenced measurement version must exist')
          return { project_id: saved.project_id, solution_id: saved.id, solution_revision: saved.revision,
            measurement_id: ref.id, measurement_revision: ref.revision, subject: m.subject, value: m.value, unit: m.unit,
            truth: m.truth, source: m.source, latest_revision: now.revision, currently_archived: now.archived }
        })
      }
      rows = rows.filter(r => r.project_id === eq('project_id'))
      if (eq('revision')) rows = rows.filter(r => r.revision === Number(eq('revision')))
      if (eq('area_id')) rows = rows.filter(r => r.area_id === eq('area_id'))
      if (eq('archived')) rows = rows.filter(r => r.archived === (eq('archived') === 'true'))
      if (table === 'current_solutions') rows.sort((a,b) => b.recorded_at.localeCompare(a.recorded_at) || a.id.localeCompare(b.id))
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
      await respond({ json: table === 'solution_revisions' && eq('revision') ? rows[0] ?? null : rows.slice(offset, offset + limit) })
      return true
    },
  }
  return fixture
}

export async function verifySolutionsBrowser(page, base, fixture, facts, width) {
  await page.goto(base)
  await page.getByRole('link', { name: /Solutions & target/ }).click()
  await page.getByText('No target selected. Add alternatives, then choose one version for the project.', { exact: true }).waitFor()
  async function add(title, evidence = false) {
    await page.getByRole('button', { name: 'Add alternative', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Add alternative', exact: true })
    await form.getByLabel('Alternative name', { exact: true }).fill(title)
    await form.getByLabel('Area', { exact: true }).selectOption('areaA')
    await form.getByLabel('Description and rationale', { exact: true }).fill('Keep the existing footprint and reuse the windows.')
    await form.getByLabel('Assumptions and unknowns', { exact: true }).fill('Foundation condition still needs inspection.')
    await form.getByLabel('Trade-offs', { exact: true }).fill('Less space, fewer new materials.')
    if (evidence) {
      await form.getByRole('button', { name: 'Choose reference image', exact: true }).click()
      await page.getByRole('dialog', { name: 'Choose a reference image', exact: true }).getByRole('button', { name: 'Use image', exact: true }).click()
      await form.getByRole('button', { name: 'Link measurement', exact: true }).click()
      const picker = page.getByRole('dialog', { name: 'Choose a measurement', exact: true })
      // Earlier foundation checks seed enough rows to exercise the real picker paging.
      while (await picker.getByRole('heading', { name: 'Opening width', exact: true }).count() === 0) {
        const next = picker.getByRole('button', { name: 'Next page', exact: true })
        await next.waitFor(); await next.click()
        await picker.getByRole('heading', { name: 'Opening width', exact: true }).waitFor()
      }
      await picker.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Opening width', exact: true }) }).getByRole('button', { name: 'Use measurement', exact: true }).click()
    }
    await form.getByRole('button', { name: 'Save alternative', exact: true }).click(); await form.waitFor({ state: 'hidden' })
    await page.getByRole('article', { name: title, exact: true }).waitFor()
  }
  await add('Keep the porch', true); await add('Extend the porch')
  const a = page.getByRole('article', { name: 'Keep the porch', exact: true }), b = page.getByRole('article', { name: 'Extend the porch', exact: true })
  const target = page.getByRole('region', { name: 'Selected project target', exact: true })
  async function choose(card, reason) {
    await card.getByRole('button', { name: 'Select target', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Select target', exact: true })
    await dialog.getByLabel('Reason for decision', { exact: true }).fill(reason)
    await dialog.getByRole('button', { name: 'Select target', exact: true }).click()
    return dialog
  }
  await (await choose(a, 'Reuse what we have')).waitFor({ state: 'hidden' })
  await target.getByRole('heading', { name: 'Keep the porch · Version 1', exact: true }).waitFor()
  await a.getByRole('button', { name: 'Revise', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Revise alternative', exact: true })
  await editor.getByLabel('Description and rationale', { exact: true }).fill('A newer candidate with a sheltered door.')
  await editor.getByLabel('Reason for change', { exact: true }).fill('Compare a different entrance')
  await editor.getByRole('button', { name: 'Save new version', exact: true }).click(); await editor.waitFor({ state: 'hidden' })
  await a.getByText('Newer alternative version. Target still uses version 1.', { exact: true }).waitFor()
  const measurement = [...facts.records.measurement.values()].find(m => m.subject === 'Opening width')
  facts.remember('measurement', { ...measurement, revision: measurement.revision + 1, value: '1290', truth: 'measured', source: 'Later measurement' })
  await page.reload()
  await target.getByText(/Measurement changed since this version/).waitFor()
  await target.getByRole('button', { name: 'View reference image', exact: true }).click()
  const original = page.getByRole('dialog', { name: 'Entry before work', exact: true })
  await original.locator('img.project-image-original').waitFor()
  assert.equal(await original.locator('img').evaluate(img => getComputedStyle(img).objectFit), 'contain')
  await original.getByRole('button', { name: 'Close', exact: true }).click()
  await a.getByRole('button', { name: 'History', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Alternative history', exact: true })
  await history.getByText('Compare a different entrance', { exact: true }).waitFor()
  assert.equal(await history.locator('li').count(), 2)
  await history.getByRole('button', { name: 'View version', exact: true }).last().click()
  const old = page.getByRole('dialog', { name: 'Keep the porch · Version 1', exact: true })
  await old.getByText('Keep the existing footprint and reuse the windows.', { exact: true }).waitFor()
  await old.getByRole('button', { name: 'Close', exact: true }).click()
  fixture.rejectNext = true
  const conflict = await choose(b, 'Keep this decision input')
  await conflict.getByText('Target changed. Reload before deciding again.', { exact: true }).waitFor()
  assert.equal(await conflict.getByLabel('Reason for decision', { exact: true }).inputValue(), 'Keep this decision input')
  await conflict.getByRole('button', { name: 'Cancel', exact: true }).click()
  await (await choose(b, 'More room required')).waitFor({ state: 'hidden' })
  await target.getByRole('heading', { name: 'Extend the porch · Version 1', exact: true }).waitFor()
  await a.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('dialog', { name: 'Archive alternative', exact: true }).getByRole('button', { name: 'Archive alternative', exact: true }).click()
  await a.waitFor({ state: 'hidden' })
  await page.getByLabel('Show alternatives', { exact: true }).selectOption('archived'); await a.waitFor()
  await a.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore alternative', exact: true }).getByRole('button', { name: 'Restore alternative', exact: true }).click()
  await a.waitFor({ state: 'hidden' })
  await page.getByLabel('Show alternatives', { exact: true }).selectOption('active'); await a.waitFor()
  await target.getByRole('button', { name: 'Clear target', exact: true }).click()
  const clear = page.getByRole('dialog', { name: 'Clear target', exact: true })
  await clear.getByLabel('Reason for decision', { exact: true }).fill('Wait for the site check')
  await clear.getByRole('button', { name: 'Clear target', exact: true }).click(); await clear.waitFor({ state: 'hidden' })
  await target.getByRole('button', { name: 'Decision history', exact: true }).click()
  const decisions = page.getByRole('dialog', { name: 'Target decisions', exact: true })
  await decisions.getByText('Wait for the site check', { exact: true }).waitFor()
  assert.equal(await decisions.locator('li').count(), 3)
  await decisions.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload(); await a.waitFor(); await b.waitFor()
  await page.locator('.solutions-page').evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)) })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Solutions must fit phone width')
  for (const button of await page.locator('.solutions-page').getByRole('button').all()) {
    const box = await button.boundingBox(); assert(!box || box.width >= 44 && box.height >= 44, 'Solution actions need 44px targets: ' + await button.textContent())
  }
  await page.screenshot({ path: 'test-results/solutions-' + width + '.png', fullPage: true })
  const seed = [...fixture.records.values()][0]
  for (let i = 0; i < 25; i++) { const id = randomUUID(); fixture.records.set(id, { ...seed, id, solution_id: id, title: 'Other alternative ' + i }) }
  await page.reload(); await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.solution-list > article').length === 3)
  await page.getByRole('button', { name: 'Previous page', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.solution-list > article').length === 24)
  console.log('Solutions alternatives/evidence/pinned target/revisions/conflict/archive/restore/decisions/reload/paging passed at ' + width + 'px; HTTP fixtures, no AI.')
}
