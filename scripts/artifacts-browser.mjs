import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const generationKey = (id, revision) => `${id}:${revision}`

export function createArtifactsFixture(timestamp, assets, facts, solutions) {
  const records = new Map(), histories = new Map(), generations = new Map(), parametric = new Map()
  const physical = {
    buildings: [{
      id: '90000000-0000-0000-0000-000000000001', site_id: null, project_id: 'A', revision: 1,
      name: 'Main house', notes: '', archived: false, change_note: 'Fixture building', actor_label: 'Fixture member', recorded_at: timestamp(),
    }],
    spaces: [{
      id: '90000000-0000-0000-0000-000000000002', building_id: '90000000-0000-0000-0000-000000000001', project_id: 'A',
      source_project_id: 'A', revision: 1, latest_revision: 1, level_id: null, name: 'Children room', kind: 'bedroom', notes: '',
      truth: 'measured', source: 'Fixture accepted room', archived: false, has_proposal: false,
      change_note: 'Fixture room', actor_label: 'Fixture member', recorded_at: timestamp(),
    }],
  }
  const fixture = { records, histories, generations, parametric, physical, rejectNext: false,
    async handle(request, url, respond) {
      const table = url.pathname.split('/').at(-1)
      const handled = [
        'current_artifacts','artifact_revisions','artifact_revision_details','artifact_measurement_details',
        'artifact_generation_details','artifact_geometry_input_details','artifact_command','artifact_geometry_command',
        'project_buildings','project_spaces','artifact_parametric_recipes','artifact_box_command',
      ]
      if (!handled.includes(table)) return false
      const eq = key => url.searchParams.get(key)?.replace(/^eq\./, '')
      const reply = async options => { await respond(options); return true }
      const fail = message => reply({ status: 409, json: { message } })

      if (table === 'project_buildings') return reply({ json: eq('project_id') === 'A' ? physical.buildings : [] })
      if (table === 'project_spaces') return reply({ json: eq('project_id') === 'A' ? physical.spaces : [] })

      const exactTarget = () => {
        const target = solutions.decisions.at(-1)
        if (!target?.solution_id) return null
        const selected = solutions.histories.get(target.solution_id)?.find(item => item.revision === target.solution_revision)
        return selected ? { target, selected } : null
      }
      const finish = async (row, recipe) => {
        const carried = recipe ?? parametric.get(generationKey(row.id, records.get(row.id)?.revision))?.recipe
        row.revision = (records.get(row.id)?.revision ?? 0) + 1
        row.actor_label = 'Fixture member'
        row.recorded_at = timestamp()
        records.set(row.id, row)
        if (carried) parametric.set(generationKey(row.id, row.revision), { project_id: row.project_id, artifact_id: row.id, artifact_revision: row.revision, recipe: structuredClone(carried) })
        histories.set(row.id, [...(histories.get(row.id) ?? []), structuredClone(row)])
        return reply({ json: { id: row.id, revision: row.revision } })
      }

      if (table === 'artifact_parametric_recipes') {
        const pairs = [...(url.searchParams.get('or') ?? '').matchAll(/and\(artifact_id\.eq\.([^,]+),artifact_revision\.eq\.(\d+)\)/g)]
        assert(pairs.length > 0 && pairs.length <= 24, 'Recipe reads must pin exact bounded versions')
        const rows = [...parametric.values()].filter(row => row.project_id === eq('project_id')
          && pairs.some(pair => pair[1] === row.artifact_id && Number(pair[2]) === row.artifact_revision))
        return reply({ json: rows })
      }
      if (table === 'artifact_box_command') {
        const { p_project, p_action: action, p_artifact: id, p_expected: expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = records.get(id)
        if (fixture.rejectNext) { fixture.rejectNext = false; return fail('Project target changed. Reload before saving the drawing.') }
        if (action === 'regenerate' && old?.revision !== expected) return fail('Drawing changed. Reload before saving again.')
        if (action === 'create' && (old || expected !== 0)) return fail('Drawing already exists.')
        const selectedTarget = exactTarget()
        if (!selectedTarget || selectedTarget.target.revision !== data.target_revision) return fail('Project target changed. Reload before saving the drawing.')
        assert.equal(data.recipe.generator, 'storage_box_v1'); assert.equal(data.recipe.version, 1)
        const { width_mm: w, height_mm: h, depth_mm: d, thickness_mm: t } = data.recipe
        assert([w, h, d, t].every(Number.isFinite) && w > 2*t && d > 2*t && h > t)
        return finish({ ...old, id, artifact_id: id, project_id: 'A', area_id: action === 'create' ? data.area_id : old.area_id,
          kind: 'detail', title: data.title, description: data.description, status: 'concept', assumptions: data.assumptions,
          source_media_id: null, source_media_title: '', target_revision: selectedTarget.target.revision,
          solution_id: selectedTarget.target.solution_id, solution_revision: selectedTarget.target.solution_revision,
          solution_title: selectedTarget.selected.title, measurements: structuredClone(data.measurements),
          generator: null, generator_version: null, archived: false, change_note: data.change_note ?? 'Initial drawing',
        }, data.recipe)
      }

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
          const selectedTarget = exactTarget()
          if (!selectedTarget || selectedTarget.target.revision !== data.target_revision) return fail('Project target changed. Reload before saving the drawing.')
          const source = assets.get(data.source_media_id)
          if (data.source_media_id && !source) return fail('Drawing image unavailable in this project')
          row = {
            ...old, id, artifact_id: id, project_id: p_project, area_id: data.area_id ?? old?.area_id ?? null,
            kind: data.kind, title: data.title, description: data.description, status: data.status, assumptions: data.assumptions ?? '',
            source_media_id: source?.id ?? null, source_media_title: source?.title ?? '', target_revision: selectedTarget.target.revision,
            solution_id: selectedTarget.target.solution_id, solution_revision: selectedTarget.target.solution_revision,
            solution_title: selectedTarget.selected.title, measurements: structuredClone(data.measurements ?? []),
            generator: old?.generator ?? null, generator_version: old?.generator_version ?? null,
            archived: false, change_note: data.change_note ?? 'Initial drawing',
          }
        }
        const previousGeneration = old && generations.get(generationKey(id, old.revision))
        const done = await finish(row)
        if (previousGeneration) generations.set(generationKey(id, row.revision), {
          ...structuredClone(previousGeneration), artifact_revision: row.revision,
        })
        return done
      }

      if (table === 'artifact_geometry_command') {
        const { p_project, p_action: action, p_artifact: id, p_expected: expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = records.get(id)
        if (fixture.rejectNext) { fixture.rejectNext = false; return fail('Project target changed. Reload before saving the drawing.') }
        if (action === 'regenerate' && old?.revision !== expected) return fail('Drawing changed. Reload before saving again.')
        if (action === 'create' && old) return fail('Drawing already exists. Reload before creating another.')
        const selectedTarget = exactTarget()
        if (!selectedTarget || selectedTarget.target.revision !== data.target_revision) return fail('Project target changed. Reload before saving the drawing.')
        const building = physical.buildings.find(item => item.id === data.building_id)
        const space = physical.spaces.find(item => item.id === data.space_id && item.building_id === data.building_id && item.revision === data.space_revision)
        if (!building || !space) return fail('Physical Space version unavailable in this project')
        const roles = ['wall_width','wall_height','opening_left','opening_sill_height','opening_width','opening_height']
        assert.deepEqual(Object.keys(data.inputs).sort(), [...roles].sort())
        const generationInputs = roles.map(role => {
          const ref = data.inputs[role]
          const measurement = facts.histories.get(ref.id)?.find(item => item.revision === ref.revision)
          const current = facts.records.measurement.get(ref.id)
          assert(measurement && current, `Geometry measurement ${role} must exist`)
          assert.notEqual(measurement.truth, 'unknown')
          return {
            project_id: 'A', artifact_id: id, artifact_revision: (old?.revision ?? 0) + 1, role,
            measurement_id: ref.id, measurement_revision: ref.revision, subject: measurement.subject,
            value: measurement.value, unit: measurement.unit, truth: measurement.truth, source: measurement.source,
            latest_revision: current.revision, currently_archived: current.archived,
          }
        })
        if (generationInputs.some(item => item.truth === 'estimated') && data.status !== 'concept') return fail('Estimated geometry must stay Concept until those dimensions are verified')
        const row = {
          ...old, id, artifact_id: id, project_id: 'A', area_id: action === 'create' ? data.area_id ?? null : old?.area_id ?? null,
          kind: 'elevation', title: data.title, description: data.description, status: data.status, assumptions: data.assumptions ?? '',
          source_media_id: old?.source_media_id ?? null, source_media_title: old?.source_media_title ?? '',
          target_revision: selectedTarget.target.revision, solution_id: selectedTarget.target.solution_id,
          solution_revision: selectedTarget.target.solution_revision, solution_title: selectedTarget.selected.title,
          measurements: generationInputs.map(item => ({ id: item.measurement_id, revision: item.measurement_revision })),
          generator: 'stud_wall_opening_v1', generator_version: 1, archived: false,
          change_note: action === 'regenerate' ? data.change_note : 'Initial generated drawing',
        }
        await finish(row)
        generations.set(generationKey(id, row.revision), {
          project_id: 'A', artifact_id: id, artifact_revision: row.revision, generator: 'stud_wall_opening_v1', generator_version: 1,
          building_id: building.id, building_name: building.name, space_id: space.id, space_name: space.name,
          space_revision: space.revision, current_space_revision: space.revision, space_has_proposal: false,
          parameters: { stud_spacing_mm: Number(data.stud_spacing_mm) }, inputs: generationInputs,
        })
        return true
      }

      if (table === 'artifact_generation_details') {
        const row = generations.get(generationKey(eq('artifact_id'), Number(eq('artifact_revision')))) ?? null
        return reply({ json: row?.project_id === eq('project_id') ? row : null })
      }
      if (table === 'artifact_geometry_input_details') {
        const generation = generations.get(generationKey(eq('artifact_id'), Number(eq('artifact_revision'))))
        const rows = generation?.project_id === eq('project_id') ? generation.inputs.map(saved => {
          const current = facts.records.measurement.get(saved.measurement_id)
          return { ...saved, latest_revision: current?.revision ?? saved.latest_revision, currently_archived: current?.archived ?? saved.currently_archived }
        }) : []
        return reply({ json: rows.sort((a, b) => a.role.localeCompare(b.role)) })
      }

      let rows
      if (table === 'current_artifacts') rows = [...records.values()]
      else if (table === 'artifact_revisions' || table === 'artifact_revision_details') rows = [...(histories.get(eq('artifact_id')) ?? [])].reverse()
      else {
        const saved = histories.get(eq('artifact_id'))?.find(item => item.revision === Number(eq('artifact_revision')))
        rows = (saved?.measurements ?? []).map(ref => {
          const measurement = facts.histories.get(ref.id)?.find(item => item.revision === ref.revision)
          const now = facts.records.measurement.get(ref.id)
          assert(measurement && now, 'The exact referenced measurement version must exist')
          return {
            project_id: saved.project_id, artifact_id: saved.id, artifact_revision: saved.revision,
            measurement_id: ref.id, measurement_revision: ref.revision, subject: measurement.subject,
            value: measurement.value, unit: measurement.unit, truth: measurement.truth, source: measurement.source,
            latest_revision: now.revision, currently_archived: now.archived,
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
      const exactRevision = (table === 'artifact_revisions' || table === 'artifact_revision_details') && eq('revision')
      return reply({ json: exactRevision ? rows[0] ?? null : rows.slice(offset, offset + limit) })
    },
  }
  return fixture
}

function rememberGeneratedMeasurement(facts, timestamp, subject, value) {
  const id = randomUUID()
  facts.remember('measurement', {
    id, measurement_id: id, project_id: 'A', area_id: 'areaA', revision: 1, component_id: null,
    subject, value, unit: 'mm', millimetres: value, truth: 'measured', source: 'Tape measured for generated wall fixture', required: true,
    source_media_id: null, source_media_title: '', archived: false, notes: '', change_note: 'Initial geometry measurement',
    actor_label: 'Fixture member', recorded_at: timestamp(),
  })
  return id
}

export async function verifyArtifactsBrowser(page, base, fixture, facts, solutions, width) {
  const selected = [...solutions.records.values()].find(item => item.title === 'Extend the porch')
  assert(selected, 'Expected the retained second alternative')
  solutions.decisions.push({
    project_id: 'A', revision: solutions.decisions.length + 1, solution_id: selected.id, solution_revision: selected.revision,
    reason: 'Use the extension for the drawing fixture', actor_label: 'Fixture member', recorded_at: selected.recorded_at,
    area_id: null, scope_key: 'project',
  })

  await page.goto(base + '#/artifacts')
  await page.getByRole('heading', { name: 'Plans & drawings', exact: true }).waitFor()
  await page.getByRole('heading', { name: `Extend the porch · Version ${selected.revision}`, exact: true }).waitFor()
  await page.getByLabel('Drawing scope', { exact: true }).selectOption('areaA')
  await page.getByRole('heading', { name: `Extend the porch · Version ${selected.revision}`, exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add drawing', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add drawing', exact: true })
  await form.getByLabel('Drawing title', { exact: true }).fill('Entrance section')
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
    await next.waitFor(); await next.evaluate(button => button.click())
    await picker.getByRole('button', { name: 'Previous page', exact: true }).waitFor()
    await picker.getByRole('button', { name: 'Use measurement', exact: true }).first().waitFor()
  }
  await picker.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Opening width', exact: true }) })
    .getByRole('button', { name: 'Use measurement', exact: true }).click()
  await form.getByRole('button', { name: 'Save drawing', exact: true }).click(); await form.waitFor({ state: 'hidden' })

  const card = page.getByRole('article', { name: 'Entrance section', exact: true })
  await card.waitFor(); await card.getByText('Section', { exact: true }).waitFor(); await card.getByText('Measured', { exact: true }).waitFor()
  await card.getByRole('button', { name: 'View evidence', exact: true }).click()
  let details = page.getByRole('dialog', { name: 'Entrance section · Version 1', exact: true })
  await details.getByText(/Opening width/).waitFor(); await details.getByText(/Based on Extend the porch/).waitFor()
  await details.getByRole('button', { name: 'View drawing image', exact: true }).click()
  const image = page.getByRole('dialog', { name: 'Entry before work', exact: true })
  await image.locator('img.project-image-original').waitFor()
  assert.equal(await image.locator('img').evaluate(element => getComputedStyle(element).objectFit), 'contain')
  await image.getByRole('button', { name: 'Close', exact: true }).click(); await details.getByRole('button', { name: 'Close', exact: true }).click()

  const other = [...solutions.records.values()].find(item => item.title === 'Keep the porch')
  assert(other, 'Expected the retained first alternative')
  solutions.decisions.push({
    project_id: 'A', revision: solutions.decisions.length + 1, solution_id: other.id, solution_revision: other.revision,
    reason: 'Change target after drawing', actor_label: 'Fixture member', recorded_at: other.recorded_at,
    area_id: null, scope_key: 'project',
  })
  await page.reload(); await card.getByText('The selected target for this scope changed after this drawing version. Review before building from it.', { exact: true }).waitFor()

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
  await editor.getByRole('button', { name: 'Save new version', exact: true }).click(); await editor.waitFor({ state: 'hidden' })
  await card.getByText('Version 2', { exact: false }).waitFor(); await card.getByText('Build ready', { exact: true }).waitFor()
  await card.getByRole('button', { name: 'History', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Drawing history', exact: true })
  await history.getByText('Adopt the newly selected target', { exact: false }).waitFor(); assert.equal(await history.locator('li').count(), 2)
  await history.getByRole('button', { name: 'View version', exact: true }).last().click()
  details = page.getByRole('dialog', { name: 'Entrance section · Version 1', exact: true })
  await details.getByText(/Based on Extend the porch/).waitFor()
  await details.getByText('The selected target for this scope changed after this drawing version. This version keeps its original target lineage.', { exact: true }).waitFor()
  await details.getByRole('button', { name: 'Close', exact: true }).click()

  await card.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('dialog', { name: 'Archive drawing', exact: true }).getByRole('button', { name: 'Archive drawing', exact: true }).click()
  await card.waitFor({ state: 'hidden' }); await page.getByLabel('Show drawings', { exact: true }).selectOption('archived'); await card.waitFor()
  await card.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore drawing', exact: true }).getByRole('button', { name: 'Restore drawing', exact: true }).click()
  await card.waitFor({ state: 'hidden' }); await page.getByLabel('Show drawings', { exact: true }).selectOption('active'); await card.waitFor(); await page.reload(); await card.waitFor()

  const generatedFacts = {
    wall_width: { subject: 'Generated wall width', value: '4200' },
    wall_height: { subject: 'Generated wall height', value: '2400' },
    opening_left: { subject: 'Generated opening left offset', value: '900' },
    opening_sill_height: { subject: 'Generated opening sill height', value: '850' },
    opening_width: { subject: 'Generated opening width', value: '1200' },
    opening_height: { subject: 'Generated opening height', value: '1200' },
  }
  const generatedIds = {}
  for (const [role, spec] of Object.entries(generatedFacts)) generatedIds[role] = rememberGeneratedMeasurement(facts, () => new Date().toISOString(), spec.subject, spec.value)

  await page.getByRole('button', { name: 'Generate wall elevation', exact: true }).click()
  let generator = page.getByRole('dialog', { name: 'Generate wall elevation', exact: true })
  await generator.getByLabel('Space', { exact: true }).selectOption({ label: 'Main house · Children room' })
  const labels = {
    wall_width: 'Wall width', wall_height: 'Wall height', opening_left: 'Opening distance from left edge',
    opening_sill_height: 'Opening sill / bottom height', opening_width: 'Opening width', opening_height: 'Opening height',
  }
  for (const [role, label] of Object.entries(labels)) {
    const roleCard = generator.locator('.card').filter({ hasText: label }).first()
    await roleCard.getByRole('button', { name: 'Choose', exact: true }).click()
    const choose = page.getByRole('dialog', { name: `Choose ${label.toLowerCase()}`, exact: true })
    const factCard = choose.getByRole('article').filter({ has: page.getByRole('heading', { name: generatedFacts[role].subject, exact: true }) })
    await factCard.getByRole('button', { name: 'Use measurement', exact: true }).click()
  }
  await generator.getByLabel('Drawing status', { exact: true }).selectOption('measured')
  await generator.getByRole('img', { name: 'Deterministic elevation of wall and opening', exact: true }).waitFor()
  await generator.getByText('Wall 4200 × 2400 mm', { exact: true }).waitFor()
  await generator.getByText('Opening 1200 × 1200 mm', { exact: true }).waitFor()
  await generator.getByRole('button', { name: 'Save generated drawing', exact: true }).click(); await generator.waitFor({ state: 'hidden' })

  const generatedCard = page.getByRole('article', { name: 'Stud wall elevation', exact: true })
  await generatedCard.getByText('Generated', { exact: true }).waitFor(); await generatedCard.getByText('Measured', { exact: true }).waitFor()
  assert.equal(await generatedCard.getByRole('button', { name: 'Revise', exact: true }).count(), 0)
  await generatedCard.getByRole('button', { name: 'View evidence', exact: true }).click()
  let generatedDetails = page.getByRole('dialog', { name: 'Stud wall elevation · Version 1', exact: true })
  await generatedDetails.getByText(/Generator stud_wall_opening_v1 v1/).waitFor()
  await generatedDetails.getByRole('img', { name: 'Deterministic elevation of wall and opening', exact: true }).waitFor()
  await generatedDetails.getByText(/Opening width: Generated opening width · 1200 mm/).waitFor()
  await generatedDetails.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload(); await generatedCard.waitFor()
  await generatedCard.getByRole('button', { name: 'View evidence', exact: true }).click()
  generatedDetails = page.getByRole('dialog', { name: 'Stud wall elevation · Version 1', exact: true })
  await generatedDetails.getByText('Opening 1200 × 1200 mm', { exact: true }).waitFor(); await generatedDetails.getByRole('button', { name: 'Close', exact: true }).click()

  const changedId = generatedIds.opening_width
  const oldMeasurement = facts.records.measurement.get(changedId)
  facts.remember('measurement', {
    ...oldMeasurement, revision: 2, value: '1210', millimetres: '1210', change_note: 'Remeasured opening width', recorded_at: new Date(Date.now() + 1000).toISOString(),
  })
  await generatedCard.getByRole('button', { name: 'Regenerate', exact: true }).click()
  generator = page.getByRole('dialog', { name: 'Regenerate wall elevation', exact: true })
  const openingRole = generator.locator('.card').filter({ hasText: 'Opening width' }).first()
  await openingRole.getByText('A newer measurement version exists. This selection still pins version 1.', { exact: true }).waitFor()
  await openingRole.getByRole('button', { name: 'Change', exact: true }).click()
  const openingPicker = page.getByRole('dialog', { name: 'Choose opening width', exact: true })
  await openingPicker.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Generated opening width', exact: true }) })
    .getByRole('button', { name: 'Use measurement', exact: true }).click()
  await generator.getByText('Opening 1210 × 1200 mm', { exact: true }).waitFor()
  await generator.getByLabel('Reason for regeneration', { exact: true }).fill('Use remeasured opening width')
  await generator.getByRole('button', { name: 'Save regenerated version', exact: true }).click(); await generator.waitFor({ state: 'hidden' })
  await generatedCard.getByText('Version 2', { exact: false }).waitFor()
  await generatedCard.getByRole('button', { name: 'View evidence', exact: true }).click()
  generatedDetails = page.getByRole('dialog', { name: 'Stud wall elevation · Version 2', exact: true })
  await generatedDetails.getByText(/Opening width: Generated opening width · 1210 mm/).waitFor(); await generatedDetails.getByRole('button', { name: 'Close', exact: true }).click()
  await generatedCard.getByRole('button', { name: 'History', exact: true }).click()
  const generatedHistory = page.getByRole('dialog', { name: 'Drawing history', exact: true })
  await generatedHistory.getByText('Use remeasured opening width', { exact: false }).waitFor()
  await generatedHistory.getByText('Initial generated drawing', { exact: false }).waitFor()
  assert.equal(await generatedHistory.locator('li').count(), 2)
  await generatedHistory.getByRole('button', { name: 'View version', exact: true }).last().click()
  generatedDetails = page.getByRole('dialog', { name: 'Stud wall elevation · Version 1', exact: true })
  await generatedDetails.getByText(/Opening width: Generated opening width · 1200 mm/).waitFor()
  await generatedDetails.getByText('Opening 1200 × 1200 mm', { exact: true }).waitFor()
  await generatedDetails.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator('.project-artifacts').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Plans & drawings must fit phone width')
  for (const button of await page.locator('.project-artifacts').getByRole('button').all()) {
    const box = await button.boundingBox()
    assert(!box || box.width >= 44 && box.height >= 44, 'Drawing actions need 44px targets: ' + await button.textContent())
  }
  await page.screenshot({ path: 'test-results/artifacts-' + width + '.png', fullPage: true })
  console.log('Manual drawing + deterministic stud-wall generate/reload/regenerate/history passed at ' + width + 'px; HTTP fixtures, no AI.')
}
