import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export function createArtifactsFixture(timestamp, assets, solutions, facts) {
  const records = new Map(), histories = new Map(), links = new Map()
  const fixture = { records, histories, links, conflictNext: false, failRead: false,
    async handle(request, url, respond) {
      const table = url.pathname.split('/').at(-1)
      if (!['current_artifacts','artifact_versions','task_artifacts','artifact_command'].includes(table)) return false
      const eq = key => url.searchParams.get(key)?.replace(/^eq\./, '')
      const fail = async message => { await respond({ status: 409, json: { message } }); return true }
      if (table === 'artifact_command') {
        const { p_project, p_action: action, p_artifact: id, p_expected: expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = records.get(id), target = solutions.decisions.at(-1)
        if (action === 'attach' || action === 'detach') {
          const key = data.task_id + ':' + id, previous = links.get(key)
          if ((previous?.artifact_revision ?? 0) !== data.expected_link_revision) return fail('Task reference changed. Reload before saving again.')
          if (action === 'attach') {
            if (old.revision !== expected || old.archived) return fail('Drawing/reference changed. Reload before attaching.')
            links.set(key, { task_id: data.task_id, artifact_id: id, artifact_revision: old.revision, project_id: p_project, linked_at: timestamp(), linked_by: 'Fixture member' })
          } else links.delete(key)
          await respond({ json: { id, revision: old.revision } }); return true
        }
        if (action !== 'create' && old.revision !== expected) return fail('Drawing/reference changed. Reload before saving again.')
        if (action === 'create' || action === 'revise') {
          if (fixture.conflictNext) {
            fixture.conflictNext = false
            solutions.decisions.push({ ...target, revision: target.revision + 1, recorded_at: timestamp() })
            return fail('Target changed. Reload before reviewing this drawing/reference again.')
          }
          if (!target?.solution_id || target.revision !== data.expected_target_revision) return fail('Target changed. Reload before reviewing this drawing/reference again.')
          assert.equal(data.reviewed, true); assert.equal(assets.get(data.source_media_id)?.state, 'ready')
        }
        const row = action === 'archive' || action === 'restore' ? { ...old, archived: action === 'archive', change_note: action === 'archive' ? 'Archived' : 'Restored' }
          : { ...old, id, artifact_id: id, project_id: p_project, area_id: data.area_id ?? old?.area_id ?? null,
            ...data, source_media_title: assets.get(data.source_media_id).title, target_revision: target.revision, archived: false,
            change_note: data.change_note ?? 'Initial reference reviewed against selected target' }
        row.revision = (old?.revision ?? 0) + 1; row.recorded_at = timestamp(); row.actor_label = 'Fixture member'
        records.set(id, row); histories.set(id, [...(histories.get(id) ?? []), structuredClone(row)])
        await respond({ json: { id, revision: row.revision } }); return true
      }
      if (fixture.failRead) { fixture.failRead = false; return fail('Reference list temporarily unavailable') }
      const details = r => {
        const t = solutions.decisions.find(t => t.revision === r.target_revision), now = solutions.decisions.at(-1)
        const s = solutions.histories.get(t.solution_id).find(s => s.revision === t.solution_revision), head = records.get(r.id)
        return { ...r, latest_revision: head.revision, currently_archived: head.archived,
          solution_id: t.solution_id, solution_revision: t.solution_revision, solution_title: s.title,
          target_changed: now?.solution_id !== t.solution_id || now?.solution_revision !== t.solution_revision,
          evidence_changed: (s.measurements ?? []).some(m => facts.records.measurement.get(m.id).revision !== m.revision),
          image_ready: assets.get(r.source_media_id)?.state === 'ready' }
      }
      let rows = table === 'current_artifacts' ? [...records.values()].map(details)
        : table === 'artifact_versions' ? [...histories.values()].flat().map(details).sort((a,b) => b.revision - a.revision)
        : [...links.values()].map(l => ({ ...details(histories.get(l.artifact_id).find(r => r.revision === l.artifact_revision)), ...l }))
      for (const key of ['project_id','area_id','artifact_id','task_id']) if (eq(key)) rows = rows.filter(r => r[key] === eq(key))
      if (eq('revision')) rows = rows.filter(r => r.revision === Number(eq('revision')))
      if (eq('archived')) rows = rows.filter(r => r.archived === (eq('archived') === 'true'))
      if (table !== 'artifact_versions') rows.sort((a,b) => (b.linked_at ?? b.recorded_at).localeCompare(a.linked_at ?? a.recorded_at) || a.id.localeCompare(b.id))
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
      await respond({ json: table === 'artifact_versions' && eq('revision') ? rows[0] ?? null : rows.slice(offset, offset + limit) }); return true
    },
  }
  return fixture
}

export async function verifyArtifactsBrowser(page, base, fixture, solutions, width) {
  // Remove only the synthetic pagination rows after the preceding solution proof.
  for (const [id, row] of solutions.records) if (row.title.startsWith('Other alternative ')) solutions.records.delete(id)
  await page.goto(base)
  await page.getByRole('link', { name: /Drawings & references/ }).click()
  await page.getByText('Select a project target before adding or revising a drawing/reference.', { exact: true }).waitFor()
  assert(await page.getByRole('button', { name: 'Add drawing/reference', exact: true }).isDisabled())
  async function choose(title) {
    await page.goto(base + '#/solutions')
    await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: 'Select target', exact: true }).click()
    const d = page.getByRole('dialog', { name: 'Select target', exact: true })
    await d.getByLabel('Reason for decision', { exact: true }).fill('Review drawing basis')
    await d.getByRole('button', { name: 'Select target', exact: true }).click(); await d.waitFor({ state: 'hidden' })
  }
  await choose('Extend the porch')
  await page.goto(base + '#/artifacts?area=areaA')
  await page.getByRole('button', { name: 'Add drawing/reference', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Add drawing/reference', exact: true })
  await editor.getByLabel('Reference name', { exact: true }).fill('Porch plan')
  await editor.getByLabel('Drawing kind', { exact: true }).selectOption('plan')
  await editor.getByLabel('Source and preparation', { exact: true }).fill('Manual sketch from site notes')
  await editor.getByLabel('Unresolved checks', { exact: true }).fill('Check foundation condition')
  await editor.getByLabel('Notes', { exact: true }).fill('Door position for review')
  await editor.getByRole('button', { name: 'Choose drawing image', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a drawing image', exact: true })
  await picker.getByRole('button', { name: 'Use image', exact: true }).click()
  await editor.getByRole('checkbox').check()
  fixture.conflictNext = true
  await editor.getByRole('button', { name: 'Save reference', exact: true }).click()
  await editor.getByText('Target changed. Reload before reviewing this drawing/reference again.', { exact: true }).waitFor()
  assert.equal(await editor.getByLabel('Notes', { exact: true }).inputValue(), 'Door position for review')
  await editor.getByRole('button', { name: 'Reload selected target', exact: true }).click()
  await editor.getByText('Extend the porch · Solution version 1', { exact: true }).waitFor()
  await editor.getByRole('checkbox').check()
  await editor.getByRole('button', { name: 'Save reference', exact: true }).click(); await editor.waitFor({ state: 'hidden' })
  const card = page.getByRole('article', { name: 'Porch plan', exact: true })
  await card.waitFor()
  await page.reload(); await card.waitFor()
  await page.locator('.artifacts-page').evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)) })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'References must fit phone width')
  for (const button of await page.locator('.artifacts-page').getByRole('button').all()) {
    const box = await button.boundingBox(); assert(!box || box.width >= 44 && box.height >= 44, 'Reference action needs 44px: ' + await button.textContent())
  }
  await page.screenshot({ path: 'test-results/artifacts-' + width + '.png', fullPage: true })
  const task = page.getByRole('region', { name: 'Task drawings and references', exact: true })
  async function taskPage() { await page.goto(base + '#/tasks/taskA'); await task.waitFor() }
  await taskPage()
  await task.getByRole('button', { name: 'Attach drawing/reference', exact: true }).click()
  await page.getByRole('dialog', { name: 'Attach drawing/reference', exact: true }).getByRole('button', { name: 'Attach version 1', exact: true }).click()
  await task.getByRole('button', { name: 'View attached version', exact: true }).click()
  const detail = page.getByRole('dialog', { name: 'Porch plan · Version 1', exact: true })
  await detail.getByRole('button', { name: 'Open original image', exact: true }).click()
  const original = page.getByRole('dialog', { name: 'Entry before work', exact: true })
  await original.locator('img.project-image-original').waitFor()
  assert.equal(await original.locator('img').evaluate(img => getComputedStyle(img).objectFit), 'contain')
  await original.getByRole('button', { name: 'Close', exact: true }).click()
  await detail.getByRole('button', { name: 'Close', exact: true }).click()
  await choose('Keep the porch')
  await page.goto(base + '#/artifacts')
  await card.getByText(/Project target changed or cleared/).waitFor()
  await card.getByRole('button', { name: 'Revise', exact: true }).click()
  const revision = page.getByRole('dialog', { name: 'Revise drawing/reference', exact: true })
  await revision.getByText('Keep the porch · Solution version 4', { exact: true }).waitFor()
  await revision.getByRole('checkbox').check()
  await revision.getByLabel('Reason for change', { exact: true }).fill('Reviewed for retained porch')
  await revision.getByRole('button', { name: 'Save new version', exact: true }).click(); await revision.waitFor({ state: 'hidden' })
  await card.getByText(/Measurements changed since the selected solution version/).waitFor()
  await taskPage()
  await task.getByText('Newer reference available: version 2. This reference keeps version 1.', { exact: true }).waitFor()
  await task.getByRole('button', { name: 'Update reference', exact: true }).click()
  const update = page.getByRole('dialog', { name: 'Update task reference', exact: true })
  await update.getByRole('button', { name: 'Review version 2', exact: true }).click()
  const second = page.getByRole('dialog', { name: 'Porch plan · Version 2', exact: true })
  await second.getByRole('heading', { name: 'Measurements used by this version', exact: true }).waitFor()
  await second.getByText(/Measurement changed since this version/).waitFor()
  await second.getByRole('button', { name: 'Close', exact: true }).click()
  await update.getByRole('button', { name: 'Use version 2', exact: true }).click(); await update.waitFor({ state: 'hidden' })
  await task.getByText('Plan · Version 2 · Manual reference', { exact: true }).waitFor()
  await page.goto(base + '#/artifacts')
  await card.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('dialog', { name: 'Archive drawing/reference', exact: true }).getByRole('button', { name: 'Archive reference', exact: true }).click()
  await card.waitFor({ state: 'hidden' })
  await taskPage(); await task.getByText('Drawing/reference archived.', { exact: true }).waitFor()
  await page.goto(base + '#/artifacts')
  await page.getByLabel('Show references', { exact: true }).selectOption('archived'); await card.waitFor()
  await card.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore drawing/reference', exact: true }).getByRole('button', { name: 'Restore reference', exact: true }).click()
  await card.waitFor({ state: 'hidden' })
  await page.getByLabel('Show references', { exact: true }).selectOption('active'); await card.waitFor()
  await card.getByRole('button', { name: 'History', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Drawing/reference history', exact: true })
  await history.getByText('Restored', { exact: true }).waitFor(); assert.equal(await history.locator('li').count(), 4)
  await history.getByRole('button', { name: 'View version', exact: true }).last().click()
  await detail.getByText('Door position for review', { exact: true }).waitFor()
  await detail.getByRole('button', { name: 'Close', exact: true }).click()
  await taskPage()
  await task.getByRole('button', { name: 'Detach', exact: true }).click()
  await page.getByRole('dialog', { name: 'Detach task reference', exact: true }).getByRole('button', { name: 'Detach reference', exact: true }).click()
  await task.getByText('No drawing/reference attached on this page.', { exact: true }).waitFor()
  // Only fixture rows are added for paging; the production data layer/UI does every read.
  const seed = [...fixture.records.values()][0]
  for (let i = 0; i < 25; i++) { const id = randomUUID(); const r = { ...seed, id, artifact_id: id, title: 'Other reference ' + i }; fixture.records.set(id, r); fixture.histories.set(id, [r]) }
  await page.goto(base + '#/artifacts')
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.artifact-list > article').length === 2)
  await page.getByRole('button', { name: 'Previous page', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.artifact-list > article').length === 24)
  await taskPage()
  await task.getByRole('button', { name: 'Attach drawing/reference', exact: true }).click()
  const attach = page.getByRole('dialog', { name: 'Attach drawing/reference', exact: true })
  await attach.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.querySelectorAll('article').length === 2)
  await attach.getByRole('button', { name: 'Close', exact: true }).click()
  fixture.failRead = true
  await page.goto(base + '#/artifacts')
  await page.getByText('Reference list temporarily unavailable', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Reload drawings/references', exact: true }).click()
  await page.getByRole('button', { name: 'Next page', exact: true }).waitFor()
  console.log('Artifacts create/reload/target conflict/review/image/pinned task versions/update/history/archive/restore/detach/paging/retry passed at ' + width + 'px; HTTP fixtures, no AI.')
}
