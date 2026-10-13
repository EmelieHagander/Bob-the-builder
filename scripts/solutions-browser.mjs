import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export function createSolutionsFixture(timestamp, assets, facts) {
  const records = new Map(), histories = new Map(), decisions = []
  const fixture = { records, histories, decisions, rejectNext: false, wrongVersionProjectOnce: false,
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
          const scopeKey = data.area_id ? `area:${data.area_id}` : 'project'
          const current = [...decisions].reverse().find(item => item.project_id === p_project && item.scope_key === scopeKey)
          if (expected !== (current?.revision ?? 0)) return fail('Target changed. Reload before deciding again.')
          if (action === 'select' && old.revision !== data.solution_revision) return fail('Solution changed. Reload before selecting.')
          decisions.push({ project_id: p_project, revision: decisions.length + 1, solution_id: id,
            solution_revision: id ? old.revision : null, reason: data.reason, actor_label: 'Fixture member', recorded_at: timestamp(),
            area_id: data.area_id ?? null, scope_key: scopeKey })
          await respond({ json: { revision: decisions.length } }); return true
        }
        if (action !== 'create' && old.revision !== expected) return fail('Solution changed. Reload before saving again.')
        if (action === 'archive' && decisions.at(-1)?.solution_id === id) return fail('Choose another target or clear it before archiving this alternative.')
        const source = assets.get(data.source_media_id)
        const row = action === 'archive' || action === 'restore' ? { ...old, archived: action === 'archive', change_note: action === 'archive' ? 'Archived' : 'Restored' }
          : { ...old, id, solution_id: id, project_id: p_project, area_id: data.area_id ?? old?.area_id ?? null,
            assumptions: '', tradeoffs: '', ...data, source_media_id: source?.id ?? null,
            source_media_title: source?.title ?? '', archived: false, change_note: data.change_note ?? 'Initial alternative' }
        if (action === 'revise' && old.design_intent && !Object.hasOwn(data, 'design_intent')
          && ['title', 'description', 'assumptions', 'tradeoffs', 'source_media_id', 'measurements'].some(key => JSON.stringify(row[key]) !== JSON.stringify(old[key]))) {
          row.design_intent = structuredClone(old.design_intent)
          row.design_intent.alignment = { status: 'draft', basis: 'The solution text or references changed; reconcile the shared direction.' }
        }
        row.revision = (old?.revision ?? 0) + 1; row.actor_label = 'Fixture member'; row.recorded_at = timestamp()
        records.set(id, row); histories.set(id, [...(histories.get(id) ?? []), structuredClone(row)])
        await respond({ json: { id, revision: row.revision } }); return true
      }
      let rows
      if (table === 'current_target') {
        const latest = new Map()
        for (const item of decisions) latest.set(item.scope_key ?? (item.area_id ? `area:${item.area_id}` : 'project'), item)
        rows = [...latest.values()]
      }
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
      const areaFilter = url.searchParams.get('area_id')
      if (areaFilter === 'is.null') rows = rows.filter(r => r.area_id == null)
      else if (eq('area_id')) rows = rows.filter(r => r.area_id === eq('area_id'))
      if (eq('archived')) rows = rows.filter(r => r.archived === (eq('archived') === 'true'))
      if (table === 'current_solutions') rows.sort((a,b) => b.recorded_at.localeCompare(a.recorded_at) || a.id.localeCompare(b.id))
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
      const single = (request.headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json')
      if (table === 'solution_revisions' && eq('revision') && fixture.wrongVersionProjectOnce && rows.length) {
        fixture.wrongVersionProjectOnce = false
        rows = [{ ...rows[0], project_id: 'B' }]
      }
      await respond({ json: single || (table === 'solution_revisions' && eq('revision')) ? rows[0] ?? null : rows.slice(offset, offset + limit) })
      return true
    },
  }
  return fixture
}

export async function verifySolutionsBrowser(page, base, fixture, facts, width) {
  await page.goto(base+'#/project')
  await page.getByRole('link', { name: /Solutions & target/ }).click()
  await page.getByText('No target selected for the Project. Add alternatives, then choose one version for this scope.', { exact: true }).waitFor()
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
      // Inspect membership of a loaded page, not the transient empty loading state.
      await picker.getByRole('button', { name: 'Use measurement', exact: true }).first().waitFor()
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
  // A canonical synthetic Bob revision, stored outside the private transcript.
  // The UI reads the selected historical version rather than a newer candidate.
  const advised = [...fixture.records.values()].find(row => row.title === 'Keep the porch')
  advised.design_intent = { version: 1, purpose: 'concept', summary: 'Reuse the porch footprint and windows; investigate the foundation before construction.',
    references: [{ image_id: advised.source_media_id, role: 'layout', note: 'Preserve the existing footprint; the image does not supply measured dimensions.' }],
    features: [{ id: 'reuse_windows', description: 'Preserve the existing windows and entrance footprint.', basis: 'project_record', source_ref: null }],
    choices: [
      { id: 'footprint', question: 'Which footprint should we develop?', alternatives: ['Retain the footprint', 'Extend the porch'],
        recommendation: 'Retain the footprint', basis: 'The owner chose reuse and a smaller material need.', consequences: 'Less space, fewer new materials.', geometry_dependency: true,
        status: 'resolved', selected_direction: 'Keep the existing footprint', decision_authority: 'owner', decision_basis: 'Prior saved owner direction.', deferral: null },
      { id: 'surface', question: 'Which finish should the concept show?', alternatives: ['Opaque coating', 'Clear coating'],
        recommendation: 'Opaque coating', basis: 'A reversible appearance study within the delegated concept.', consequences: 'A uniform proposed appearance; product selection is separate.', geometry_dependency: false,
        status: 'resolved', selected_direction: 'Opaque coating', decision_authority: 'bob', decision_basis: 'The owner delegated ordinary concept details.', deferral: null },
      { id: 'support', question: 'How should the foundation support the porch?', alternatives: [], recommendation: '', basis: '', consequences: 'Construction depends on a site inspection.', geometry_dependency: true,
        status: 'deferred', selected_direction: null, decision_authority: 'bob', decision_basis: '', deferral: { scope: 'concept', reason: 'Inspect the foundation and resolve support before construction.' } },
    ], alignment: { status: 'aligned', basis: 'The prior reuse choice is preserved for this limited concept.' } }
  fixture.histories.get(advised.id)[0].design_intent = structuredClone(advised.design_intent)
  const a = page.getByRole('article', { name: 'Keep the porch', exact: true }), b = page.getByRole('article', { name: 'Extend the porch', exact: true })
  const target = page.getByRole('region', { name: 'Selected Project target', exact: true })
  async function choose(card, reason) {
    await card.getByRole('button', { name: 'Select Project target', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Select target', exact: true })
    await dialog.getByLabel('Reason for decision', { exact: true }).fill(reason)
    await dialog.getByRole('button', { name: 'Select target', exact: true }).click()
    return dialog
  }
  await (await choose(a, 'Reuse what we have')).waitFor({ state: 'hidden' })
  await target.getByRole('heading', { name: 'Keep the porch · Version 1', exact: true }).waitFor()
  const design = target.getByRole('region', { name: 'Design & choices', exact: true })
  await design.getByText(advised.design_intent.summary, { exact: true }).waitFor()
  await design.getByText('Shared direction recorded', { exact: false }).waitFor()
  const ownerChoice = design.locator('.fact-source').filter({ has: page.getByText('Which footprint should we develop?', { exact: true }) })
  await ownerChoice.getByText(/Chosen by the owner/).waitFor()
  await design.getByText(/Chosen by Bob within mandate/).waitFor()
  await design.getByText('Deferred for concept design', { exact: true }).waitFor()
  await ownerChoice.locator('summary').click()
  await ownerChoice.getByText('Decision basis: Prior saved owner direction.', { exact: true }).waitFor()
  await design.getByText('Preserved features & references', { exact: true }).click()
  await design.getByText('Preserve the existing windows and entrance footprint.', { exact: true }).waitFor()
  await design.getByRole('button', { name: 'View layout reference 1', exact: true }).click()
  const designImage = page.getByRole('dialog', { name: 'Entry before work', exact: true })
  await designImage.locator('img.project-image-original').waitFor()
  await designImage.getByRole('button', { name: 'Close', exact: true }).click()
  await page.screenshot({ path: 'test-results/solutions-design-choices-' + width + '.png', fullPage: true })
  await a.getByRole('button', { name: 'Revise', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Revise alternative', exact: true })
  await editor.getByLabel('Description and rationale', { exact: true }).fill('A newer candidate with a sheltered door.')
  await editor.getByLabel('Reason for change', { exact: true }).fill('Compare a different entrance')
  await editor.getByRole('button', { name: 'Save new version', exact: true }).click(); await editor.waitFor({ state: 'hidden' })
  await a.getByText('Newer alternative version. Target still uses version 1.', { exact: true }).waitFor()
  const measurement = [...facts.records.measurement.values()].find(m => m.subject === 'Opening width')
  facts.remember('measurement', { ...measurement, revision: measurement.revision + 1, value: '1290', truth: 'measured', source: 'Later measurement' })
  await page.reload()
  await design.getByText(advised.design_intent.summary, { exact: true }).waitFor()
  await design.getByText('Shared direction recorded', { exact: false }).waitFor()
  await a.getByRole('button', { name: 'View evidence', exact: true }).click()
  const revised = page.getByRole('dialog', { name: 'Keep the porch · Version 2', exact: true })
  await revised.getByText('Direction needs reconciliation', { exact: false }).waitFor()
  await revised.getByText(/Chosen by the owner/).waitFor()
  await revised.getByRole('button', { name: 'Close', exact: true }).click()
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
  await old.getByText('Shared direction recorded', { exact: false }).waitFor()
  await old.getByText(/Chosen by Bob within mandate/).waitFor()
  await old.getByRole('button', { name: 'Close', exact: true }).click()
  fixture.rejectNext = true
  const conflict = await choose(b, 'Keep this decision input')
  await conflict.getByText('Target changed. Reload before deciding again.', { exact: true }).waitFor()
  assert.equal(await conflict.getByLabel('Reason for decision', { exact: true }).inputValue(), 'Keep this decision input')
  await conflict.getByRole('button', { name: 'Cancel', exact: true }).click()
  await (await choose(b, 'More room required')).waitFor({ state: 'hidden' })
  await target.getByRole('heading', { name: 'Extend the porch · Version 1', exact: true }).waitFor()
  await target.getByText('Design advice and choices are not recorded for this version yet.', { exact: true }).waitFor()
  await a.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('dialog', { name: 'Archive alternative', exact: true }).getByRole('button', { name: 'Archive alternative', exact: true }).click()
  await a.waitFor({ state: 'hidden' })
  await page.getByLabel('Show alternatives', { exact: true }).selectOption('archived'); await a.waitFor()
  await a.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore alternative', exact: true }).getByRole('button', { name: 'Restore alternative', exact: true }).click()
  await a.waitFor({ state: 'hidden' })
  await page.getByLabel('Show alternatives', { exact: true }).selectOption('active'); await a.waitFor()
  fixture.wrongVersionProjectOnce = true
  await page.reload()
  await page.getByRole('alert').getByText('Solution project mismatch.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'Design & choices', exact: true }).count(), 0, 'Wrong-project advice must not be rendered')
  await page.getByRole('button', { name: 'Reload solutions', exact: true }).click()
  await target.getByRole('heading', { name: 'Extend the porch · Version 1', exact: true }).waitFor()
  await target.getByRole('button', { name: 'Clear target', exact: true }).click()
  const clear = page.getByRole('dialog', { name: 'Clear target', exact: true })
  await clear.getByLabel('Reason for decision', { exact: true }).fill('Wait for the site check')
  await clear.getByRole('button', { name: 'Clear target', exact: true }).click(); await clear.waitFor({ state: 'hidden' })
  await target.getByRole('button', { name: 'Project target history', exact: true }).click()
  const decisions = page.getByRole('dialog', { name: 'Project target decisions', exact: true })
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
  console.log('Solutions alternatives/advice/choices/reference roles/exact selected version/evidence/revisions/conflict/archive/restore/decisions/reload/paging passed at ' + width + 'px; HTTP fixtures, no AI.')
}
