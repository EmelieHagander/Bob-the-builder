import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export function createArtifactsFixture(timestamp, assets, facts, solutions) {
  const records = new Map(), histories = new Map()
  const fixture = { records, histories, rejectNext: false,
    async handle(request, url, respond) {
      const table = url.pathname.split('/').at(-1)
      if (!['current_artifacts','artifact_revisions','artifact_measurement_details','artifact_command'].includes(table)) return false
      const eq = key => url.searchParams.get(key)?.replace(/^eq\./, '')
      const fail = async message => { await respond({ status: 409, json: { message } }); return true }
      if (table === 'artifact_command') {
        const { p_project, p_action: action, p_artifact: id, p_expected: expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = records.get(id)
        if (fixture.rejectNext) { fixture.rejectNext = false; return fail('Project target changed. Reload before saving the drawing.') }
        if (action !== 'create' && old?.revision !== expected) return fail('Drawing changed. Reload before saving again.')
        if (action === 'create' && old) return fail('Drawing already exists. Reload before creating another.')
        let row
        if (action === 'archive' || action === 'restore') {
          row = { ...old, archived: action === 'archive', change_note: action === 'archive' ? 'Archived' : 'Restored' }
        } else {
          const target = solutions.decisions.at(-1)
          if (!target || target.revision !== data.target_revision || !target.solution_id) return fail('Project target changed. Reload before saving the drawing.')
          const selected = solutions.histories.get(target.solution_id)?.find(item => item.revision === target.solution_revision)
          assert(selected, 'The exact selected solution version must exist')
          const source = assets.get(data.source_media_id)
          if (data.source_media_id && !source) return fail('Drawing image unavailable in this project')
          row = {
            ...old,
            id,
            artifact_id: id,
            project_id: p_project,
            area_id: data.area_id ?? old?.area_id ?? null,
            kind: data.kind,
            title: data.title,
            description: data.description,
            status: data.status,
            assumptions: data.assumptions ?? '',
            source_media_id: source?.id ?? null,
            source_media_title: source?.title ?? '',
            target_revision: target.revision,
            solution_id: target.solution_id,
            solution_revision: target.solution_revision,
            solution_title: selected.title,
            measurements: structuredClone(data.measurements ?? []),
            archived: false,
            change_note: data.change_note ?? 'Initial drawing',
          }
        }
        row.revision = (old?.revision ?? 0) + 1
        row.actor_label = 'Fixture member'
        row.recorded_at = timestamp()
        records.set(id, row)
        histories.set(id, [...(histories.get(id) ?? []), structuredClone(row)])
        await respond({ json: { id, revision: row.revision } })
        return true
      }

      let rows
      if (table === 'current_artifacts') rows = [...records.values()]
      else if (table === 'artifact_revisions') rows = [...(histories.get(eq('artifact_id')) ?? [])].reverse()
      else {
        const saved = histories.get(eq('artifact_id'))?.find(item => item.revision === Number(eq('artifact_revision')))
        rows = (saved?.measurements ?? []).map(ref => {
          const measurement = facts.histories.get(ref.id)?.find(item => item.revision === ref.revision)
          const now = facts.records.measurement.get(ref.id)
          assert(measurement, 'The exact referenced measurement version must exist')
          return {
            project_id: saved.project_id,
            artifact_id: saved.id,
            artifact_revision: saved.revision,
            measurement_id: ref.id,
            measurement_revision: ref.revision,
            subject: measurement.subject,
            value: measurement.value,
            unit: measurement.unit,
            truth: measurement.truth,
            source: measurement.source,
            latest_revision: now.revision,
            currently_archived: now.archived,
          }
        })
      }
      rows = rows.filter(item => item.project_id === eq('project_id'))
      if (eq('revision')) rows = rows.filter(item => item.revision === Number(eq('revision')))
      if (eq('area_id')) rows = rows.filter(item => item.area_id === eq('area_id'))
      if (eq('archived')) rows = rows.filter(item => item.archived === (eq('archived') === 'true'))
      if (table === 'current_artifacts') rows.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at) || a.id.localeCompare(b.id))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 1000)
      await respond({ json: table === 'artifact_revisions' && eq('revision') ? rows[0] ?? null : rows.slice(offset, offset + limit) })
      return true
    },
  }
  return fixture
}

export async function verifyArtifactsBrowser(page, base, fixture, facts, solutions, width) {
  // The solutions browser deliberately ends with no selected target. Seed one
  // exact target decision for the drawing fixture; target behavior itself is
  // already exercised through the production UI immediately before this flow.
  const selected = [...solutions.records.values()].find(item => item.title === 'Extend the porch')
  assert(selected, 'Expected the retained second alternative')
  solutions.decisions.push({
    project_id: 'A',
    revision: solutions.decisions.length + 1,
    solution_id: selected.id,
    solution_revision: selected.revision,
    reason: 'Use the extension for the drawing fixture',
    actor_label: 'Fixture member',
    recorded_at: selected.recorded_at,
  })

  await page.goto(base + '#/artifacts')
  await page.getByRole('heading', { name: 'Plans & drawings', exact: true }).waitFor()
  await page.getByRole('heading', { name: `Extend the porch · Version ${selected.revision}`, exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add drawing', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add drawing', exact: true })
  await form.getByLabel('Drawing title', { exact: true }).fill('Entrance section')
  await form.getByLabel('Area', { exact: true }).selectOption('areaA')
  await form.getByLabel('Drawing type', { exact: true }).selectOption('section')
  await form.getByLabel('Drawing status', { exact: true }).selectOption('measured')
  await form.getByLabel('What this drawing shows', { exact: true }).fill('Section through the insulated entrance floor and opening.')
  await form.getByLabel('Assumptions and limits', { exact: true }).fill('Ground moisture condition still needs inspection.')
  await form.getByRole('button', { name: 'Choose drawing image', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose a drawing image', exact: true }).getByRole('button', { name: 'Use image', exact: true }).first().click()
  await form.getByRole('button', { name: 'Link measurement', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a measurement', exact: true })
  await picker.getByRole('button', { name: 'Use measurement', exact: true }).first().waitFor()
  while (await picker.getByRole('heading', { name: 'Opening width', exact: true }).count() === 0) {
    const next = picker.getByRole('button', { name: 'Next page', exact: true })
    await next.waitFor(); await next.click()
    await picker.getByRole('button', { name: 'Use measurement', exact: true }).first().waitFor()
  }
  await picker.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Opening width', exact: true }) })
    .getByRole('button', { name: 'Use measurement', exact: true }).click()
  await form.getByRole('button', { name: 'Save drawing', exact: true }).click()
  await form.waitFor({ state: 'hidden' })

  const card = page.getByRole('article', { name: 'Entrance section', exact: true })
  await card.waitFor()
  await card.getByText('Section', { exact: true }).waitFor()
  await card.getByText('Measured', { exact: true }).waitFor()
  await card.getByRole('button', { name: 'View evidence', exact: true }).click()
  let details = page.getByRole('dialog', { name: 'Entrance section · Version 1', exact: true })
  await details.getByText(/Opening width/).waitFor()
  await details.getByText(/Based on Extend the porch/).waitFor()
  await details.getByRole('button', { name: 'View drawing image', exact: true }).click()
  const image = page.getByRole('dialog', { name: 'Entry before work', exact: true })
  await image.locator('img.project-image-original').waitFor()
  assert.equal(await image.locator('img').evaluate(element => getComputedStyle(element).objectFit), 'contain')
  await image.getByRole('button', { name: 'Close', exact: true }).click()
  await details.getByRole('button', { name: 'Close', exact: true }).click()

  // A later project target makes the saved drawing visibly stale without
  // mutating its pinned lineage.
  const other = [...solutions.records.values()].find(item => item.title === 'Keep the porch')
  assert(other, 'Expected the retained first alternative')
  solutions.decisions.push({
    project_id: 'A',
    revision: solutions.decisions.length + 1,
    solution_id: other.id,
    solution_revision: other.revision,
    reason: 'Change target after drawing',
    actor_label: 'Fixture member',
    recorded_at: other.recorded_at,
  })
  await page.reload()
  await card.getByText('Project target changed after this drawing version. Review before building from it.', { exact: true }).waitFor()

  // Concurrency rejection must keep authored input visible instead of silently
  // rebinding to whichever target happens to be current.
  await card.getByRole('button', { name: 'Revise', exact: true }).click()
  let editor = page.getByRole('dialog', { name: 'Revise drawing', exact: true })
  await editor.getByLabel('What this drawing shows', { exact: true }).fill('Keep this unsaved drawing edit visible after the conflict.')
  await editor.getByLabel('Reason for change', { exact: true }).fill('Align drawing after target decision')
  fixture.rejectNext = true
  await editor.getByRole('button', { name: 'Save new version', exact: true }).click()
  await editor.getByText('Project target changed. Reload before saving the drawing.', { exact: true }).waitFor()
  assert.equal(await editor.getByLabel('What this drawing shows', { exact: true }).inputValue(), 'Keep this unsaved drawing edit visible after the conflict.')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()

  await card.getByRole('button', { name: 'Revise', exact: true }).click()
  editor = page.getByRole('dialog', { name: 'Revise drawing', exact: true })
  await editor.getByLabel('What this drawing shows', { exact: true }).fill('Section revised for the newly selected porch target.')
  await editor.getByLabel('Drawing status', { exact: true }).selectOption('build_ready')
  await editor.getByLabel('Reason for change', { exact: true }).fill('Adopt the newly selected target')
  await editor.getByRole('button', { name: 'Save new version', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await card.getByText('Version 2', { exact: false }).waitFor()
  await card.getByText('Build ready', { exact: true }).waitFor()
  await card.getByRole('button', { name: 'History', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Drawing history', exact: true })
  await history.getByText('Adopt the newly selected target', { exact: true }).waitFor()
  assert.equal(await history.locator('li').count(), 2)
  await history.getByRole('button', { name: 'View version', exact: true }).last().click()
  details = page.getByRole('dialog', { name: 'Entrance section · Version 1', exact: true })
  await details.getByText(/Based on Extend the porch/).waitFor()
  await details.getByText('The project target has changed since this drawing version. This version keeps its original target lineage.', { exact: true }).waitFor()
  await details.getByRole('button', { name: 'Close', exact: true }).click()

  await card.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('dialog', { name: 'Archive drawing', exact: true }).getByRole('button', { name: 'Archive drawing', exact: true }).click()
  await card.waitFor({ state: 'hidden' })
  await page.getByLabel('Show drawings', { exact: true }).selectOption('archived')
  await card.waitFor()
  await card.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore drawing', exact: true }).getByRole('button', { name: 'Restore drawing', exact: true }).click()
  await card.waitFor({ state: 'hidden' })
  await page.getByLabel('Show drawings', { exact: true }).selectOption('active')
  await card.waitFor()
  await page.reload(); await card.waitFor()

  await page.locator('.project-artifacts').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Plans & drawings must fit phone width')
  for (const button of await page.locator('.project-artifacts').getByRole('button').all()) {
    const box = await button.boundingBox()
    assert(!box || box.width >= 44 && box.height >= 44, 'Drawing actions need 44px targets: ' + await button.textContent())
  }
  await page.screenshot({ path: 'test-results/artifacts-' + width + '.png', fullPage: true })
  console.log('Manual drawing create/evidence/target-staleness/conflict/revision/history/archive/restore/reload passed at ' + width + 'px; HTTP fixtures, no AI.')
}
